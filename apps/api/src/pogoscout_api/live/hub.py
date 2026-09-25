"""Per-mission WebSocket fan-out. Thread-safe: services publish from worker threads and the loop.

Notifications are coalesced per mission: the first change after a quiet period is sent at once;
changes within the next `coalesce_s` are merged (union of topics and hop ids) into a single
trailing message, so a fast replay or a burst of classifications sends at most one `changed`
message per mission per window.
"""

import asyncio
import threading
import time
from collections.abc import Iterable
from dataclasses import dataclass, field

from pogoscout_api.application.notify import Topic

TOPIC_ORDER: tuple[Topic, ...] = ("hops", "cells", "events", "mission", "replay")


@dataclass(eq=False)
class Subscriber:
    queue: asyncio.Queue[dict]
    loop: asyncio.AbstractEventLoop


@dataclass
class _Pending:
    topics: set[str] = field(default_factory=set)
    hop_ids: set[int] = field(default_factory=set)
    last_hop_id: int | None = None

    def add(self, topics: Iterable[Topic], hop_id: int | None) -> None:
        self.topics.update(topics)
        if hop_id is not None:
            self.hop_ids.add(hop_id)
            self.last_hop_id = hop_id

    def message(self, mission_id: str) -> dict:
        return {
            "type": "changed",
            "mission_id": mission_id,
            "topics": [t for t in TOPIC_ORDER if t in self.topics],
            "hop_id": self.last_hop_id,  # the most recent hop among the merged changes
            "hop_ids": sorted(self.hop_ids),
        }


def _offer(queue: asyncio.Queue[dict], message: dict) -> None:
    try:
        queue.put_nowait(message)
    except asyncio.QueueFull:
        pass  # a slow client refetches on the next notification anyway


class LiveHub:
    def __init__(self, queue_size: int = 256, coalesce_s: float = 0.25) -> None:
        self._subscribers: dict[str, set[Subscriber]] = {}
        self._pending: dict[str, _Pending] = {}
        self._last_sent: dict[str, float] = {}
        self._lock = threading.Lock()
        self._queue_size = queue_size
        self.coalesce_s = coalesce_s

    def subscribe(self, mission_id: str) -> Subscriber:
        subscriber = Subscriber(asyncio.Queue(self._queue_size), asyncio.get_running_loop())
        with self._lock:
            self._subscribers.setdefault(mission_id, set()).add(subscriber)
        return subscriber

    def unsubscribe(self, mission_id: str, subscriber: Subscriber) -> None:
        with self._lock:
            subscribers = self._subscribers.get(mission_id)
            if subscribers is not None:
                subscribers.discard(subscriber)
                if not subscribers:
                    del self._subscribers[mission_id]

    def subscriber_count(self, mission_id: str) -> int:
        with self._lock:
            return len(self._subscribers.get(mission_id, ()))

    def publish(self, mission_id: str, topics: Iterable[Topic], hop_id: int | None = None) -> None:
        with self._lock:
            subscribers = list(self._subscribers.get(mission_id, ()))
            if not subscribers:
                return  # nobody listening: clients refetch from REST when they connect
            pending = self._pending.get(mission_id)
            if pending is not None:  # a trailing flush is already scheduled
                pending.add(topics, hop_id)
                return
            now = time.monotonic()
            wait = self._last_sent.get(mission_id, -1e9) + self.coalesce_s - now
            pending = _Pending()
            pending.add(topics, hop_id)
            if wait <= 0:
                self._last_sent[mission_id] = now
                message = pending.message(mission_id)
            else:
                self._pending[mission_id] = pending
                message = None
        if message is not None:
            self._deliver(mission_id, subscribers, message)
            return
        loop = subscribers[0].loop
        try:
            loop.call_soon_threadsafe(loop.call_later, wait, self._flush, mission_id)
        except RuntimeError:  # that loop is closed; deliver now rather than lose the change
            self._flush(mission_id)

    def _flush(self, mission_id: str) -> None:
        with self._lock:
            pending = self._pending.pop(mission_id, None)
            subscribers = list(self._subscribers.get(mission_id, ()))
            if pending is None or not subscribers:
                return
            self._last_sent[mission_id] = time.monotonic()
        self._deliver(mission_id, subscribers, pending.message(mission_id))

    def _deliver(self, mission_id: str, subscribers: list[Subscriber], message: dict) -> None:
        for subscriber in subscribers:
            try:
                subscriber.loop.call_soon_threadsafe(_offer, subscriber.queue, message)
            except RuntimeError:
                self.unsubscribe(mission_id, subscriber)  # its loop is closed
