"""Per-mission WebSocket fan-out. Thread-safe: services publish from worker threads and the loop."""

import asyncio
import threading
from collections.abc import Iterable
from dataclasses import dataclass

from pogoscout_api.application.notify import Topic

TOPIC_ORDER: tuple[Topic, ...] = ("hops", "cells", "events", "mission", "replay")


@dataclass(eq=False)
class Subscriber:
    queue: asyncio.Queue[dict]
    loop: asyncio.AbstractEventLoop


def _offer(queue: asyncio.Queue[dict], message: dict) -> None:
    try:
        queue.put_nowait(message)
    except asyncio.QueueFull:
        pass  # a slow client refetches on the next notification anyway


class LiveHub:
    def __init__(self, queue_size: int = 256) -> None:
        self._subscribers: dict[str, set[Subscriber]] = {}
        self._lock = threading.Lock()
        self._queue_size = queue_size

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
        wanted = set(topics)
        message = {
            "type": "changed",
            "mission_id": mission_id,
            "topics": [t for t in TOPIC_ORDER if t in wanted],
            "hop_id": hop_id,
        }
        with self._lock:
            subscribers = list(self._subscribers.get(mission_id, ()))
        for subscriber in subscribers:
            try:
                subscriber.loop.call_soon_threadsafe(_offer, subscriber.queue, message)
            except RuntimeError:
                self.unsubscribe(mission_id, subscriber)  # its loop is closed
