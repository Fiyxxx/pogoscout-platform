"""Change-notification port. Services publish after commit; the live hub fans out to clients."""

from collections.abc import Iterable
from typing import Literal, Protocol

Topic = Literal["hops", "cells", "events", "mission", "replay"]


class Notifier(Protocol):
    def publish(
        self, mission_id: str, topics: Iterable[Topic], hop_id: int | None = None
    ) -> None: ...


class NullNotifier:
    def publish(self, mission_id: str, topics: Iterable[Topic], hop_id: int | None = None) -> None:
        return None
