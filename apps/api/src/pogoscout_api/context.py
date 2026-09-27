"""Process-wide collaborators, built once per app and shared by routes, worker and replay."""

from dataclasses import dataclass

from pogoscout_api.adapters.classifier import ClassifierClient, build_classifier
from pogoscout_api.adapters.ground import GroundClient
from pogoscout_api.application.ground import GroundDemo
from pogoscout_api.application.worker import InferenceWorker
from pogoscout_api.config import Settings
from pogoscout_api.evidence.store import ImageStore
from pogoscout_api.live.hub import LiveHub
from pogoscout_api.persistence.db import Database
from pogoscout_api.replay.runner import ReplayManager


@dataclass
class AppContext:
    config: Settings
    db: Database
    store: ImageStore
    hub: LiveHub
    classifier: ClassifierClient
    worker: InferenceWorker
    replay: ReplayManager
    ground: GroundDemo


def build_context(
    config: Settings,
    classifier: ClassifierClient | None = None,
    ground_client: GroundClient | None = None,
) -> AppContext:
    db = Database(config.database_url)
    db.create_all()
    store = ImageStore(config.image_dir)
    hub = LiveHub(coalesce_s=config.live_coalesce_s)
    classifier = classifier or build_classifier(config)
    worker = InferenceWorker(db, store, classifier, hub, config)
    replay = ReplayManager(db, store, config, hub)
    ground_client = ground_client or GroundClient(
        config.ground_service_url, config.ground_timeout_s
    )
    ground = GroundDemo(db, store, config, hub, ground_client)
    return AppContext(config, db, store, hub, classifier, worker, replay, ground)
