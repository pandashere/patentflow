"""专利与阶段 API(Bearer Token 或会话均可调用)。"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ..db import Database
from ..deps import Auth, current_auth, get_db
from ..domain import access, patents, reviews
from ..domain.constants import STAGE_KEYS
from ..domain.errors import not_found
from ..domain.repo import load_patent, load_patents, load_transitions, load_versions, public_patent
from ._util import patent_out, run

router = APIRouter(tags=["patents"])

Vis = Literal["private", "team", "public"]
Stage = Literal["draft", "patentability", "implementation", "search", "doi"]


class CreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    visibility: Vis = "team"


class StageIn(BaseModel):
    data: dict[str, Any]
    note: str = ""
    baseVersion: int | None = None  # 乐观锁:编辑时拿到的版本号;不传则不校验


class ReasonIn(BaseModel):
    reason: str
    rev: int | None = None


class RollbackIn(ReasonIn):
    to: Stage


class VisIn(BaseModel):
    visibility: Vis


class ArchiveIn(BaseModel):
    kind: Literal["completed", "abandoned"]
    reason: str


class IdsIn(BaseModel):
    userIds: list[str]


class TransferIn(BaseModel):
    to: str
    keepAsCollaborator: bool = True


class BatchTransferIn(BaseModel):
    items: list[dict[str, str]]  # [{patentId, toUserId}]
    keepAsCollaborator: bool = True


class TeamIn(BaseModel):
    teamId: str


class RestoreIn(BaseModel):
    version: int


class ScoreIn(BaseModel):
    difficulty: int
    nonObviousness: int
    novelty: int
    comment: str = ""
    verdict: Literal["pass", "reject"]


class InviteIn(BaseModel):
    userId: str


class DeclineIn(BaseModel):
    reason: str


async def _visible(db: Database, auth: Auth, pid: str) -> dict[str, Any]:
    p = await load_patent(db.reader, pid)  # type: ignore[arg-type]
    if not p or not access.can_see(auth.user, p):
        raise not_found("专利")
    return p


@router.get("/patents")
async def list_patents(
    scope: Literal["mine", "team", "all", "archived"] = "all", stage: Stage | None = None, q: str = "",
    auth: Auth = Depends(current_auth), db: Database = Depends(get_db),
) -> list[dict[str, Any]]:
    me = auth.user
    out = []
    for p in await load_patents(db.reader):  # type: ignore[arg-type]
        if not access.can_see(me, p):
            continue
        if scope == "archived" and not p["archived"]:
            continue
        if scope != "archived" and p["archived"]:
            continue
        if scope == "mine" and me["id"] not in (p["ownerId"], *p["collaborators"]):
            continue
        if scope == "team" and p["teamId"] != me["teamId"]:
            continue
        if stage and p["stage"] != stage:
            continue
        if q and q not in p["title"] and q not in p["code"]:
            continue
        out.append(public_patent(p))
    return out


@router.post("/patents", status_code=201)
async def create_patent(body: CreateIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    pid = await run(request, auth, lambda ctx: patents.create(ctx, body.title, body.visibility))
    return await patent_out(request, pid)  # type: ignore[return-value]


@router.get("/patents/{pid}")
async def get_patent(pid: str, auth: Auth = Depends(current_auth), db: Database = Depends(get_db)) -> dict[str, Any]:
    p = await _visible(db, auth, pid)
    return {
        **public_patent(p),
        "versions": await load_versions(db.reader, [pid]),  # type: ignore[arg-type]
        "transitions": await load_transitions(db.reader, [pid]),  # type: ignore[arg-type]
    }


@router.get("/patents/{pid}/stages/{stage}")
async def get_stage(pid: str, stage: Stage, auth: Auth = Depends(current_auth),
                    db: Database = Depends(get_db)) -> dict[str, Any]:
    p = await _visible(db, auth, pid)
    row = await db.one("SELECT COALESCE(MAX(version), 0) v FROM stage_data WHERE patent_id=? AND stage=?", (pid, stage))
    return {"stage": stage, "version": row["v"] if row else 0, "data": p["stageData"][stage]}


@router.patch("/patents/{pid}/stages/{stage}")
async def save_stage(pid: str, stage: Stage, body: StageIn, request: Request,
                     auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    v = await run(request, auth, lambda ctx: patents.save_stage(ctx, pid, stage, body.data, body.note, body.baseVersion))
    return {"version": v, "patent": await patent_out(request, pid)}


@router.get("/patents/{pid}/stages/{stage}/versions")
async def stage_versions(pid: str, stage: Stage, auth: Auth = Depends(current_auth),
                         db: Database = Depends(get_db)) -> list[dict[str, Any]]:
    await _visible(db, auth, pid)
    return [v for v in await load_versions(db.reader, [pid]) if v["stage"] == stage]  # type: ignore[arg-type]


@router.post("/patents/{pid}/stages/{stage}/restore")
async def restore_version(pid: str, stage: Stage, body: RestoreIn, request: Request,
                          auth: Auth = Depends(current_auth), db: Database = Depends(get_db)) -> dict[str, Any]:
    """恢复旧版本 = 以旧内容生成新版本,历史永不丢失。"""
    await _visible(db, auth, pid)
    row = await db.one("SELECT data FROM stage_data WHERE patent_id=? AND stage=? AND version=?", (pid, stage, body.version))
    if not row:
        raise not_found("版本")
    import json

    data = json.loads(row["data"])
    v = await run(request, auth, lambda ctx: patents.save_stage(ctx, pid, stage, data, f"恢复自 v{body.version}", None))
    return {"version": v, "patent": await patent_out(request, pid)}


def _act(path: str):  # type: ignore[no-untyped-def]
    return router.post(f"/patents/{{pid}}/{path}")


@_act("advance")
async def advance(pid: str, body: ReasonIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: patents.advance(ctx, pid, body.reason, body.rev))
    return await patent_out(request, pid)  # type: ignore[return-value]


@_act("rollback")
async def rollback(pid: str, body: RollbackIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: patents.rollback(ctx, pid, body.to, body.reason, body.rev))
    return await patent_out(request, pid)  # type: ignore[return-value]


@router.patch("/patents/{pid}/visibility")
async def visibility(pid: str, body: VisIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: patents.set_visibility(ctx, pid, body.visibility))
    return await patent_out(request, pid)  # type: ignore[return-value]


@_act("archive")
async def archive(pid: str, body: ArchiveIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: patents.archive(ctx, pid, body.kind, body.reason))
    return await patent_out(request, pid)  # type: ignore[return-value]


@_act("unarchive")
async def unarchive(pid: str, body: ReasonIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: patents.unarchive(ctx, pid, body.reason))
    return await patent_out(request, pid)  # type: ignore[return-value]


@router.put("/patents/{pid}/collaborators")
async def collaborators(pid: str, body: IdsIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: patents.set_collaborators(ctx, pid, body.userIds))
    return await patent_out(request, pid)  # type: ignore[return-value]


@router.put("/patents/{pid}/notification-settings")
async def notification_settings(pid: str, body: list[dict[str, Any]], request: Request,
                                auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: patents.save_notify(ctx, pid, body))
    return await patent_out(request, pid)  # type: ignore[return-value]


@_act("cross-cycle")
async def cross_cycle(pid: str, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: patents.toggle_cross_cycle(ctx, pid))
    return await patent_out(request, pid)  # type: ignore[return-value]


@_act("transfer")
async def transfer(pid: str, body: TransferIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: patents.transfer(ctx, pid, body.to, body.keepAsCollaborator))
    return await patent_out(request, pid)  # type: ignore[return-value]


@router.post("/patents-transfer-batch")
async def transfer_batch(body: BatchTransferIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    async def go(ctx):  # type: ignore[no-untyped-def]
        for it in body.items:
            await patents.transfer(ctx, it["patentId"], it["toUserId"], body.keepAsCollaborator)
        return len(body.items)

    return {"transferred": await run(request, auth, go)}


@_act("team")
async def migrate(pid: str, body: TeamIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: patents.migrate_team(ctx, pid, body.teamId))
    return await patent_out(request, pid)  # type: ignore[return-value]


@router.delete("/patents/{pid}")
async def delete(pid: str, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, bool]:
    await run(request, auth, lambda ctx: patents.delete(ctx, pid))
    return {"ok": True}


# —— 审查 ——
@_act("reviewers")
async def invite(pid: str, body: InviteIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: reviews.invite(ctx, pid, body.userId))
    return await patent_out(request, pid)  # type: ignore[return-value]


@router.delete("/patents/{pid}/reviewers/{uid}")
async def withdraw(pid: str, uid: str, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: reviews.withdraw(ctx, pid, uid))
    return await patent_out(request, pid)  # type: ignore[return-value]


@_act("reviewers/me/decline")
async def decline(pid: str, body: DeclineIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: reviews.decline(ctx, pid, body.reason))
    return await patent_out(request, pid)  # type: ignore[return-value]


@_act("reviews")
async def submit_review(pid: str, body: ScoreIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: reviews.submit(ctx, pid, body.model_dump()))
    return await patent_out(request, pid)  # type: ignore[return-value]


@_act("reviews/rounds")
async def new_round(pid: str, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: reviews.start_new_round(ctx, pid))
    return await patent_out(request, pid)  # type: ignore[return-value]


__all__ = ["router", "STAGE_KEYS"]
