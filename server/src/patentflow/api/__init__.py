from __future__ import annotations

from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    from . import admin, auth, patents, planning

    app.include_router(auth.router, prefix="/api")
    app.include_router(patents.router, prefix="/api")
    app.include_router(planning.router, prefix="/api")
    app.include_router(admin.router, prefix="/api")
