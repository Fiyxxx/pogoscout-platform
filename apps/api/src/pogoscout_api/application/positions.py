"""Cheap grid positions from the integer dx/dy columns (no payload parsing).

Hop N is placed iff hops 1..N are all stored (ids start at 1 and are unique, so that is exactly
`count(hop_id <= N) == N`); its position is the sum of their movements from the origin.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from pogoscout_api.persistence.db import HopRow


def prefix_sum(session: Session, mission_id: str, hop_id: int) -> tuple[int, int, int]:
    """(count, sum dx, sum dy) over stored hops with id <= hop_id."""
    count, sx, sy = session.execute(
        select(
            func.count(),
            func.coalesce(func.sum(HopRow.dx), 0),
            func.coalesce(func.sum(HopRow.dy), 0),
        )
        .where(HopRow.mission_id == mission_id)
        .where(HopRow.hop_id <= hop_id)
    ).one()
    return int(count), int(sx), int(sy)


def hop_position(session: Session, mission_id: str, hop_id: int) -> tuple[int, int] | None:
    """Grid position of a placed hop, or None while it is pending or unknown."""
    count, x, y = prefix_sum(session, mission_id, hop_id)
    if count != hop_id or session.get(HopRow, (mission_id, hop_id)) is None:
        return None
    return x, y


def placed_count(session: Session, mission_id: str) -> int:
    """Length of the contiguous run of hops from 1 (the number of placed hops)."""
    placed = 0
    for hop_id in session.scalars(
        select(HopRow.hop_id).where(HopRow.mission_id == mission_id).order_by(HopRow.hop_id)
    ):
        if hop_id != placed + 1:
            break
        placed = hop_id
    return placed
