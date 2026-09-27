from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from pogoscout_api.adapters.classifier import ClassifierClient
from pogoscout_api.adapters.ground import GroundClient
from pogoscout_api.api import export_routes, ground_routes, replay_routes, routes, tile_routes
from pogoscout_api.api.schemas import HealthOut
from pogoscout_api.config import Settings, settings
from pogoscout_api.context import build_context
from pogoscout_api.live import ws
from pogoscout_api.tiles.cache import TileCache


def create_app(
    config: Settings = settings,
    classifier: ClassifierClient | None = None,
    ground_client: GroundClient | None = None,
) -> FastAPI:
    ctx = build_context(config, classifier, ground_client)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if config.worker_enabled:
            ctx.worker.start()
        if config.ground_enabled:
            await ctx.ground.start()
        try:
            yield
        finally:
            await ctx.ground.shutdown()
            await ctx.replay.shutdown()
            await ctx.worker.stop()
            await app.state.tiles.close()

    app = FastAPI(title="PogoScout Platform API", version="0.2.0", lifespan=lifespan)
    app.state.ctx = ctx
    app.state.tiles = TileCache(config.tile_cache_dir)
    # Cells and mission JSON compress about tenfold.
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/v1/health", response_model=HealthOut)
    async def health() -> HealthOut:
        classifier_status, model_version = await ctx.classifier.health()
        return HealthOut(
            status="ok",
            classifier=ctx.classifier.name,
            classifier_status=classifier_status,
            model_version=model_version,
        )

    app.include_router(routes.router)
    app.include_router(replay_routes.router)
    app.include_router(ground_routes.router)
    app.include_router(export_routes.router)
    app.include_router(tile_routes.router)
    app.include_router(ws.router)
    return app


def run() -> None:
    import uvicorn

    uvicorn.run("pogoscout_api.main:create_app", factory=True, reload=True, port=8000)
