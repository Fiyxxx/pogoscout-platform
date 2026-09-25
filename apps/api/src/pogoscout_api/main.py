from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pogoscout_api.config import settings


def create_app() -> FastAPI:
    app = FastAPI(title="PogoScout Platform API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "classifier": settings.classifier}

    return app


app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run("pogoscout_api.main:app", reload=True, port=8000)
