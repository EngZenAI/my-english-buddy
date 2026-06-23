from contextlib import asynccontextmanager

import gradio as gr
from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from backend.app import app as gradio_app
from backend.database import create_db_schema, init_db
from backend.routers.auth import router as auth_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    await create_db_schema()
    yield


api = FastAPI(lifespan=lifespan)
api.include_router(auth_router)


@api.get("/")
async def root():
    return RedirectResponse(url="/app")


app = gr.mount_gradio_app(
    api,
    gradio_app,
    path="/app",
)
