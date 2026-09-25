"""Registry of deterministic fixture builders (`uv run pogoscout-dev fixtures`)."""

from pogoscout_api.replay.generate import SMALL_BUILDERS
from pogoscout_api.replay.large import LARGE_BUILDERS

BUILDERS = {**SMALL_BUILDERS, **LARGE_BUILDERS}

__all__ = ["BUILDERS", "LARGE_BUILDERS", "SMALL_BUILDERS"]
