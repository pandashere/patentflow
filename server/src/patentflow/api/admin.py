"""成员 / 团队 / 系统配置 / Token / 个人资料与偏好 / 通知 / 导出 / 前端 bootstrap。"""
from __future__ import annotations

import csv
import io
from datetime import date, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..config import Settings
from ..db import Database
from ..deps import Auth, current_auth, get_db, get_settings, require_gl
from ..domain import access, members
from ..domain.errors import DomainError, bad_request, forbidden, not_found
from ..domain.prefs import get_prefs, save_prefs
from ..domain.repo import load_patents, load_transitions, load_user, load_users, load_versions, public_patent
from ..domain.sysconfig import get_system, save_system, validate_system
from ..security import new_id, new_token, sha256
from ..timeutil import now, today
from ._util import run
from .planning import all_cycles, all_rules, reports_for, rule_visible

router = APIRouter(tags=["admin"])


class MemberIn(BaseModel):
    name: str
    email: str
    title: str = ""
    teamId: str
    role: Literal["user", "pl", "gl"] = "user"


class DeactivateIn(BaseModel):
    assignments: dict[str, str] = Field(default_factory=dict)  # patentId -> 接收人


class TokenIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    days: int = Field(ge=1)
    scope: Literal["read", "read-write"] = "read"


class ProfileIn(BaseModel):
    name: str | None = None
    email: str | None = None


def token_json(r: Any) -> dict[str, Any]:
    return {"id": r["id"], "userId": r["user_id"], "name": r["name"], "token": f"{r['prefix']}…",
            "createdAt": r["created_at"], "expiresAt": r["expires_at"], "revoked": bool(r["revoked"]),
            "scope": r["scope"]}


async def teams_json(db: Database) -> list[dict[str, Any]]:
    return [{"id": t["id"], "name": t["name"], "plId": t["pl_id"]} for t in await db.all("SELECT * FROM teams ORDER BY id")]


# —— 成员与团队 ——
@router.get("/users")
async def users(auth: Auth = Depends(current_auth), db: Database = Depends(get_db)) -> list[dict[str, Any]]:
    return await load_users(db.reader)  # type: ignore[arg-type]


@router.get("/teams")
async def teams(auth: Auth = Depends(current_auth), db: Database = Depends(get_db)) -> list[dict[str, Any]]:
    return await teams_json(db)


@router.post("/users", status_code=201)
async def add_user(body: MemberIn, request: Request, auth: Auth = Depends(current_auth),
                   db: Database = Depends(get_db)) -> dict[str, Any]:
    uid = await run(request, auth, lambda ctx: members.add_member(ctx, body.model_dump()))
    return await load_user(db.reader, uid)  # type: ignore[arg-type,return-value]


@router.patch("/users/{uid}")
async def update_user(uid: str, body: dict[str, Any], request: Request, auth: Auth = Depends(current_auth),
                      db: Database = Depends(get_db)) -> dict[str, Any]:
    await run(request, auth, lambda ctx: members.update_member(ctx, uid, body))
    return await load_user(db.reader, uid)  # type: ignore[arg-type,return-value]


@router.post("/users/{uid}/deactivate")
async def deactivate(uid: str, body: DeactivateIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, int]:
    return await run(request, auth, lambda ctx: members.deactivate(ctx, uid, body.assignments))


@router.post("/users/{uid}/reactivate")
async def reactivate(uid: str, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, bool]:
    await run(request, auth, lambda ctx: members.reactivate(ctx, uid))
    return {"ok": True}


# —— 系统配置 ——
@router.get("/config")
async def get_config(auth: Auth = Depends(current_auth), db: Database = Depends(get_db),
                     settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    cfg = await get_system(db.reader)  # type: ignore[arg-type]
    cfg["ssoProviders"] = [{"name": p.name, "issuer": p.issuer, "enabled": p.enabled} for p in settings.sso_providers]
    return cfg


@router.put("/config")
async def put_config(body: dict[str, Any], request: Request, auth: Auth = Depends(require_gl)) -> dict[str, bool]:
    try:
        cfg = validate_system(body)
    except (ValueError, KeyError, TypeError) as e:
        raise bad_request(str(e)) from e

    async def go(ctx):  # type: ignore[no-untyped-def]
        await save_system(ctx.conn, cfg)

    await run(request, auth, go)
    return {"ok": True}


# —— API Token ——
@router.get("/tokens")
async def list_tokens(all: bool = False, auth: Auth = Depends(current_auth),
                      db: Database = Depends(get_db)) -> list[dict[str, Any]]:
    if all and auth.user["role"] == "gl":
        rows = await db.all("SELECT * FROM api_tokens ORDER BY created_at")
    else:
        rows = await db.all("SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at", (auth.id,))
    return [token_json(r) for r in rows]


@router.post("/tokens", status_code=201)
async def create_token(body: TokenIn, request: Request, auth: Auth = Depends(current_auth),
                       settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """明文只在创建时返回一次。"""
    if auth.via == "token":
        raise forbidden("请在网页登录后创建 Token(不允许用 Token 派生 Token)")
    if body.days > settings.token_ttl_days_max:
        raise bad_request(f"有效期最长 {settings.token_ttl_days_max} 天")
    tok = new_token("pfk")
    tid = new_id("tk")
    expires = (date.fromisoformat(today()) + timedelta(days=body.days)).isoformat()

    async def go(ctx):  # type: ignore[no-untyped-def]
        await ctx.conn.execute(
            "INSERT INTO api_tokens(id, user_id, name, token_hash, prefix, scope, created_at, expires_at) VALUES(?,?,?,?,?,?,?,?)",
            (tid, auth.id, body.name.strip(), sha256(tok), tok[:8], body.scope, now(), expires),
        )

    await run(request, auth, go)
    return {"id": tid, "token": tok, "expiresAt": expires, "scope": body.scope}


@router.delete("/tokens/{tid}")
async def revoke_token(tid: str, request: Request, auth: Auth = Depends(current_auth),
                       db: Database = Depends(get_db)) -> dict[str, bool]:
    row = await db.one("SELECT user_id FROM api_tokens WHERE id = ?", (tid,))
    if not row:
        raise not_found("Token")
    if row["user_id"] != auth.id and auth.user["role"] != "gl":
        raise forbidden()

    async def go(ctx):  # type: ignore[no-untyped-def]
        await ctx.conn.execute("UPDATE api_tokens SET revoked = 1 WHERE id = ?", (tid,))

    await run(request, auth, go)
    return {"ok": True}


# —— 个人 ——
@router.get("/me")
async def me(auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    return auth.user


@router.put("/me")
async def update_me(body: ProfileIn, request: Request, auth: Auth = Depends(current_auth),
                    db: Database = Depends(get_db), settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    async def go(ctx):  # type: ignore[no-untyped-def]
        if body.name is not None and body.name.strip():
            await ctx.conn.execute("UPDATE users SET name = ? WHERE id = ?", (body.name.strip(), auth.id))
        if body.email is not None and body.email.strip().lower() != auth.user["email"].lower():
            if auth.user["email"].lower() in settings.admins:
                raise forbidden("配置文件管理员的邮箱只能在配置文件中修改")
            async with ctx.conn.execute("SELECT 1 FROM users WHERE email = ? AND id != ?", (body.email.strip(), auth.id)) as c:
                if await c.fetchone():
                    raise DomainError(409, "conflict", "该邮箱已被占用")
            await ctx.conn.execute("UPDATE users SET email = ? WHERE id = ?", (body.email.strip().lower(), auth.id))

    await run(request, auth, go)
    return await load_user(db.reader, auth.id)  # type: ignore[arg-type,return-value]


@router.get("/me/prefs")
async def my_prefs(auth: Auth = Depends(current_auth), db: Database = Depends(get_db)) -> dict[str, Any]:
    return await get_prefs(db.reader, auth.id)  # type: ignore[arg-type]


@router.put("/me/prefs")
async def put_prefs(body: dict[str, Any], request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    async def go(ctx):  # type: ignore[no-untyped-def]
        try:
            return await save_prefs(ctx.conn, auth.id, body)
        except (ValueError, TypeError) as e:
            raise bad_request(str(e)) from e

    return await run(request, auth, go)


# —— 通知 ——
def notification_json(r: Any) -> dict[str, Any]:
    return {"id": r["id"], "event": r["event"], "text": r["text"], "at": r["at"], "read": bool(r["read"]),
            "patentId": r["patent_id"]}


@router.get("/notifications")
async def notifications(auth: Auth = Depends(current_auth), db: Database = Depends(get_db)) -> list[dict[str, Any]]:
    rows = await db.all("SELECT * FROM notifications WHERE user_id = ? ORDER BY at DESC, rowid DESC LIMIT 200", (auth.id,))
    return [notification_json(r) for r in rows]


@router.post("/notifications/read-all")
async def read_all(request: Request, auth: Auth = Depends(current_auth)) -> dict[str, bool]:
    async def go(ctx):  # type: ignore[no-untyped-def]
        await ctx.conn.execute("UPDATE notifications SET read = 1 WHERE user_id = ?", (auth.id,))

    await run(request, auth, go)
    return {"ok": True}


# —— 导出(GL;私有专利不进入导出)——
async def _exportable(db: Database) -> list[dict[str, Any]]:
    return [p for p in await load_patents(db.reader) if p["visibility"] != "private"]  # type: ignore[arg-type]


@router.get("/export.json")
async def export_json(auth: Auth = Depends(require_gl), db: Database = Depends(get_db)) -> dict[str, Any]:
    ps = await _exportable(db)
    ids = [p["id"] for p in ps]
    return {
        "exportedAt": now(), "exportedBy": auth.id, "config": await get_system(db.reader),  # type: ignore[arg-type]
        "users": await load_users(db.reader), "teams": await teams_json(db),  # type: ignore[arg-type]
        "patents": [public_patent(p) for p in ps],
        "transitions": await load_transitions(db.reader, ids),  # type: ignore[arg-type]
        "versions": await load_versions(db.reader, ids),  # type: ignore[arg-type]
        "kpiRules": await all_rules(db), "cycles": await all_cycles(db),
    }


@router.get("/export/patents.csv")
async def export_csv(auth: Auth = Depends(require_gl), db: Database = Depends(get_db)) -> Response:
    users = {u["id"]: u["name"] for u in await load_users(db.reader)}  # type: ignore[arg-type]
    team = {t["id"]: t["name"] for t in await teams_json(db)}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["编号", "标题", "负责人", "团队", "可见性", "阶段", "状态", "创建日", "当前截止"])
    for p in await _exportable(db):
        w.writerow([p["code"], p["title"], users.get(p["ownerId"], p["ownerId"]), team.get(p["teamId"], ""),
                    p["visibility"], p["stage"],
                    ("完成归档" if p["archived"]["kind"] == "completed" else "放弃归档") if p["archived"] else "在研",
                    p["createdAt"], p["dueDates"].get(p["stage"], "")])
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="patentflow-patents-{today()}.csv"'})


# —— 前端 bootstrap:一次取回当前用户可见的全部数据 ——
@router.get("/bootstrap")
async def bootstrap(auth: Auth = Depends(current_auth), db: Database = Depends(get_db),
                    settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    me_ = auth.user
    patents = [p for p in await load_patents(db.reader) if access.can_see(me_, p)]  # type: ignore[arg-type]
    ids = [p["id"] for p in patents]
    rules = [r for r in await all_rules(db) if rule_visible(me_, r)]
    token_rows = (await db.all("SELECT * FROM api_tokens ORDER BY created_at") if me_["role"] == "gl"
                  else await db.all("SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at", (auth.id,)))
    cfg = await get_config(auth, db, settings)
    return {
        "me": me_,
        "users": await load_users(db.reader),  # type: ignore[arg-type]
        "teams": await teams_json(db),
        "configAdmins": settings.admins,
        "config": cfg,
        "patents": [public_patent(p) for p in patents],
        "versions": await load_versions(db.reader, ids),  # type: ignore[arg-type]
        "transitions": await load_transitions(db.reader, ids),  # type: ignore[arg-type]
        "kpiRules": rules,
        "kpiReports": await reports_for(db, me_, rules),
        "cycles": await all_cycles(db),
        "notifications": await notifications(auth, db),
        "tokens": [token_json(r) for r in token_rows],
        "prefs": await get_prefs(db.reader, auth.id),  # type: ignore[arg-type]
        "demo": settings.demo,
        "today": today(),
    }
