from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pogoscout_api.api.routes import router
from pogoscout_api.config import Settings, settings
from pogoscout_api.persistence.db import Database


def create_app(config: Settings = settings) -> FastAPI:
    app = FastAPI(title="PogoScout Platform API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.db = Database(config.database_url)
    app.state.db.create_all()

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "classifier": config.classifier}

    app.include_router(router)
    return app


def run() -> None:
    import uvicorn

    uvicorn.run("pogoscout_api.main:create_app", factory=True, reload=True, port=8000)
