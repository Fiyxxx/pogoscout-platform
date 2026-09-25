"""Background inference worker: drains the SQLite outbox without ever blocking hop ingestion."""

import asyncio
import contextlib
import logging

from pogoscout_api.adapters.classifier.base import (
    ClassifierClient,
    ClassifyRequest,
    ClassifyResult,
    RetryableClassifierError,
)
from pogoscout_api.application import inference
from pogoscout_api.application.notify import Notifier
from pogoscout_api.config import Settings
from pogoscout_api.evidence.store import ImageStore
from pogoscout_api.persistence.db import Database, utcnow

log = logging.getLogger(__name__)


class InferenceWorker:
    def __init__(
        self,
        db: Database,
        store: ImageStore,
        classifier: ClassifierClient,
        notifier: Notifier,
        config: Settings,
    ) -> None:
        self.db = db
        self.store = store
        self.classifier = classifier
        self.notifier = notifier
        self.config = config
        self._task: asyncio.Task | None = None

    async def run_pending_jobs(self) -> int:
        """Run every job that is due now (up to the concurrency limit). Returns jobs run."""
        with self.db.session_scope() as session:
            tickets = inference.claim_due(session, utcnow(), self.config.worker_concurrency)
        if tickets:
            await asyncio.gather(*(self._run(t) for t in tickets))
        return len(tickets)

    async def drain(self, max_rounds: int = 1000) -> int:
        """Run due jobs until none remain due. Used by tests and the CLI."""
        total = 0
        for _ in range(max_rounds):
            ran = await self.run_pending_jobs()
            if ran == 0:
                break
            total += ran
        return total

    async def _run(self, ticket: inference.JobTicket) -> None:
        try:
            outcome = await self._classify(ticket)
        except Exception as exc:  # never let one job kill the worker
            log.exception("inference job %s crashed", ticket.job_id)
            outcome = ClassifyResult(status="failed", error=f"worker error: {exc}")
        with self.db.session_scope() as session:
            if isinstance(outcome, RetryableClassifierError):
                inference.record_retryable(
                    session,
                    ticket,
                    outcome,
                    max_attempts=self.config.max_attempts,
                    retry_base_s=self.config.retry_base_s,
                )
            else:
                inference.record_result(session, ticket, outcome)
        self.notifier.publish(ticket.mission_id, ["cells", "events", "mission"], ticket.hop_id)

    async def _classify(
        self, ticket: inference.JobTicket
    ) -> ClassifyResult | RetryableClassifierError:
        if ticket.image_path is None:
            return ClassifyResult(status="failed", error="screenshot record missing")
        try:
            image = self.store.read(ticket.image_path)
        except OSError:
            return ClassifyResult(status="failed", error="screenshot file missing from store")
        request = ClassifyRequest(
            request_id=ticket.job_id,
            mission_id=ticket.mission_id,
            hop_id=ticket.hop_id,
            image_sha256=ticket.image_sha256,
            taxonomy_version=self.config.taxonomy_version,
            image=image,
            content_type=ticket.content_type,
            label_hint=ticket.label_hint,
            confidence_hint=ticket.confidence_hint,
        )
        try:
            return await self.classifier.classify(request)
        except RetryableClassifierError as exc:
            return exc

    async def _loop(self) -> None:
        """Keep up to `worker_concurrency` jobs in flight, claiming more as each one finishes."""
        in_flight: set[asyncio.Task] = set()
        try:
            while True:
                free = self.config.worker_concurrency - len(in_flight)
                tickets: list[inference.JobTicket] = []
                if free > 0:
                    try:
                        with self.db.session_scope() as session:
                            tickets = inference.claim_due(session, utcnow(), free)
                    except Exception:
                        log.exception("inference worker poll failed")
                for ticket in tickets:
                    task = asyncio.create_task(self._run(ticket))
                    in_flight.add(task)
                    task.add_done_callback(in_flight.discard)
                if not in_flight:
                    await asyncio.sleep(self.config.worker_poll_s)
                elif len(tickets) < free:  # queue drained: wait for a slot or a poll tick
                    await asyncio.wait(
                        in_flight,
                        timeout=self.config.worker_poll_s,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                else:
                    await asyncio.wait(in_flight, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in in_flight:
                task.cancel()  # left `running`; reset to queued on the next start

    def start(self) -> None:
        with self.db.session_scope() as session:
            inference.reset_running(session)
        self._task = asyncio.create_task(self._loop(), name="inference-worker")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
