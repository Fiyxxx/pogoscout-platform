"""SQLAlchemy models. Hops, images, classifications, rejections and events are append-only.

Only `missions` (status, replay cursor) and `inference_jobs` (the outbox) are ever updated.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    event,
    inspect,
    text,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.types import TypeDecorator

from pogoscout_api.domain.geo import CELL_M, GeoAnchor


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator):
    """Stores naive UTC (SQLite has no time zones) and always returns aware UTC datetimes."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        return None if value is None else value.replace(tzinfo=UTC)


class Base(DeclarativeBase):
    pass


class MissionRow(Base):
    __tablename__ = "missions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    source: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    status: Mapped[str] = mapped_column(String(16), default="live", server_default="live")
    status_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    scenario_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    replay_cursor: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # GPS anchor of cell (0, 0); null when the scout has no fix.
    geo_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    geo_lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    geo_heading_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    geo_cell_m: Mapped[float | None] = mapped_column(Float, nullable=True)

    @property
    def geo(self) -> "GeoAnchor | None":
        if self.geo_lat is None or self.geo_lon is None:
            return None
        return GeoAnchor(
            lat=self.geo_lat,
            lon=self.geo_lon,
            heading_deg=self.geo_heading_deg or 0.0,
            # Missions stored before the cell size was fixed read back at the fixed size.
            cell_m=CELL_M,
        )

    def set_geo(self, geo: "GeoAnchor | None") -> None:
        self.geo_lat = geo.lat if geo else None
        self.geo_lon = geo.lon if geo else None
        self.geo_heading_deg = geo.heading_deg if geo else None
        self.geo_cell_m = geo.cell_m if geo else None


class HopRow(Base):
    """Append-only: a stored hop is never updated."""

    __tablename__ = "hops"

    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), primary_key=True)
    hop_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    content_hash: Mapped[str] = mapped_column(String(64))
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    # Movement copied out of the payload on insert so positions are integer sums in SQL.
    # Nullable only for dev databases created before the columns existed (backfilled on start).
    dx: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dy: Mapped[int | None] = mapped_column(Integer, nullable=True)


class HopRejectionRow(Base):
    """A conflicting resend of a stored hop identity. Kept as evidence, never projected."""

    __tablename__ = "hop_rejections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), index=True)
    hop_id: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JSON)
    content_hash: Mapped[str] = mapped_column(String(64))
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ImageRow(Base):
    """Screenshot metadata. The bytes live in the filesystem store at `path`."""

    __tablename__ = "images"

    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), primary_key=True)
    hop_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sha256: Mapped[str] = mapped_column(String(64))
    content_type: Mapped[str] = mapped_column(String(32))
    bytes: Mapped[int] = mapped_column(Integer)
    path: Mapped[str] = mapped_column(String(500))
    label_hint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confidence_hint: Mapped[float | None] = mapped_column(Float, nullable=True)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class InferenceJobRow(Base):
    """Persisted outbox: one job per stored image, drained by the background worker."""

    __tablename__ = "inference_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), index=True)
    hop_id: Mapped[int] = mapped_column(Integer)
    image_sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ClassificationRow(Base):
    """Append-only classification state per hop: queued, retrying, then a terminal result."""

    __tablename__ = "classifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), index=True)
    hop_id: Mapped[int] = mapped_column(Integer)
    request_id: Mapped[str] = mapped_column(String(64))
    image_sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    taxonomy_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    requested_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_response: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class EventRow(Base):
    """Append-only mission event log shown in the operator timeline."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), index=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime)
    kind: Mapped[str] = mapped_column(String(40))
    level: Mapped[str] = mapped_column(String(16))
    hop_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    y: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message: Mapped[str] = mapped_column(String(500))


def _enable_sqlite_pragmas(dbapi_connection, _record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")  # durable across app crashes in WAL mode
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


class Database:
    def __init__(self, url: str) -> None:
        sqlite = url.startswith("sqlite")
        connect_args = {"check_same_thread": False} if sqlite else {}
        self.engine: Engine = create_engine(url, connect_args=connect_args)
        if sqlite:
            event.listen(self.engine, "connect", _enable_sqlite_pragmas)
        self._sessions = sessionmaker(self.engine, expire_on_commit=False)

    def create_all(self) -> None:
        Base.metadata.create_all(self.engine)
        self._add_missing_columns()
        self._backfill()

    def _backfill(self) -> None:
        """Derived columns for rows stored before they existed. Copies, never rewrites facts."""
        if self.engine.dialect.name != "sqlite":
            return
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE hops SET dx = json_extract(payload, '$.movement.dx'), "
                    "dy = json_extract(payload, '$.movement.dy') WHERE dx IS NULL OR dy IS NULL"
                )
            )

    def _add_missing_columns(self) -> None:
        """Additive upgrade for dev databases created before a column existed (no migrations)."""
        inspector = inspect(self.engine)
        with self.engine.begin() as conn:
            for table in Base.metadata.sorted_tables:
                existing = {c["name"] for c in inspector.get_columns(table.name)}
                for column in table.columns:
                    if column.name in existing:
                        continue
                    ddl = column.type.compile(self.engine.dialect)
                    default = column.server_default.arg if column.server_default else None
                    suffix = f" DEFAULT '{default}'" if default is not None else ""
                    conn.execute(
                        text(f'ALTER TABLE {table.name} ADD COLUMN "{column.name}" {ddl}{suffix}')
                    )

    def session(self) -> Iterator[Session]:
        with self._sessions() as session:
            yield session

    @contextmanager
    def session_scope(self) -> Iterator[Session]:
        with self._sessions() as session:
            yield session
