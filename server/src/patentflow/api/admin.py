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
from ..domain.prefs import get_prefs, in_quiet_hours, save_prefs
from ..notify import probe
from ..domain.repo import load_patents, load_transitions, load_user, load_users, load_versions, public_patent
from ..domain.sysconfig import get_system, save_system, validate_system
from ..security import new_id, new_token, sha256
from ..timeutil import now, today
from ..app import sync_webhook
from ._util import run
from .planning import all_cycles, all_rules, reports_for, rule_visible

router = APIRouter(tags=["admin"])


class MemberIn(BaseModel):
    name: str
    email: str
    title: str = ""
    teamId: str
    role: Literal["user", "pl", "gl"] = "user"


class ApproveIn(BaseModel):
    teamId: str | None = None
    role: Literal["user", "pl", "gl"] | None = None


class RejectIn(BaseModel):
    reason: str = ""


class TeamCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    plId: str | None = None
    demoteOld: bool = True


class TeamRenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class TeamPlIn(BaseModel):
    userId: str | None = None
    demoteOld: bool = True


class WebhookTestIn(BaseModel):
    url: str | None = None


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
    """GL 任意团队;本组 PL 向本组添加普通用户。返回激活链接(只返回这一次,同时已发给本人)。"""
    uid, link = await run(request, auth, lambda ctx: members.add_member(ctx, body.model_dump(), str(request.base_url)))
    return {"user": await load_user(db.reader, uid), "activationLink": link}  # type: ignore[arg-type]


# —— 自助注册审批 ——
async def pending_for(db: Database, me: dict[str, Any], cfg: dict[str, Any]) -> list[dict[str, Any]]:
    if me["role"] == "user" or (me["role"] == "pl" and not cfg["members"].get("plCanManage", True)):
        return []
    rows = await load_users(db.reader, include_pending=True)  # type: ignore[arg-type]
    return [u for u in rows if u.get("pending") and (me["role"] == "gl" or u["teamId"] == me["teamId"])]


@router.get("/registrations")
async def registrations(auth: Auth = Depends(current_auth), db: Database = Depends(get_db)) -> list[dict[str, Any]]:
    return await pending_for(db, auth.user, await get_system(db.reader))  # type: ignore[arg-type]


@router.post("/registrations/{uid}/approve")
async def approve_registration(uid: str, body: ApproveIn, request: Request,
                               auth: Auth = Depends(current_auth)) -> dict[str, bool]:
    await run(request, auth, lambda ctx: members.approve(ctx, uid, body.teamId, body.role))
    return {"ok": True}


@router.post("/registrations/{uid}/reject")
async def reject_registration(uid: str, body: RejectIn, request: Request,
                              auth: Auth = Depends(current_auth)) -> dict[str, bool]:
    await run(request, auth, lambda ctx: members.reject(ctx, uid, body.reason))
    return {"ok": True}


# —— 团队(GL)——
@router.post("/teams", status_code=201)
async def create_team(body: TeamCreateIn, request: Request, auth: Auth = Depends(current_auth),
                      db: Database = Depends(get_db)) -> dict[str, Any]:
    tid = await run(request, auth, lambda ctx: members.create_team(ctx, body.name, body.plId, body.demoteOld))
    return next(t for t in await teams_json(db) if t["id"] == tid)


@router.patch("/teams/{tid}")
async def rename_team(tid: str, body: TeamRenameIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, bool]:
    await run(request, auth, lambda ctx: members.rename_team(ctx, tid, body.name))
    return {"ok": True}


@router.delete("/teams/{tid}")
async def delete_team(tid: str, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, bool]:
    await run(request, auth, lambda ctx: members.delete_team(ctx, tid))
    return {"ok": True}


@router.put("/teams/{tid}/pl")
async def set_team_pl(tid: str, body: TeamPlIn, request: Request, auth: Auth = Depends(current_auth)) -> dict[str, Any]:
    return await run(request, auth, lambda ctx: members.set_team_pl(ctx, tid, body.userId, body.demoteOld))


# —— 回调连通性测试 ——
@router.post("/notify/test-webhook")
async def test_webhook(body: WebhookTestIn, request: Request, auth: Auth = Depends(require_gl),
                       db: Database = Depends(get_db), settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """GL 测试回调地址(可先测再保存):发送一条带签名的测试事件,返回状态码、耗时与失败原因。"""
    cfg = await get_system(db.reader)  # type: ignore[arg-type]
    url = (body.url if body.url is not None else cfg.get("webhookUrl") or settings.webhook_url).strip()
    if not url:
        raise bad_request("尚未填写回调地址")
    res = await probe(url, settings.webhook_secret, {
        "event": "test", "text": f"PATENTFLOW 回调连通性测试({auth.user['name']} 发起)", "at": now(),
        "recipients": [{"id": auth.id, "name": auth.user["name"], "email": auth.user["email"]}],
    })
    return {**res, "url": url, "signed": bool(settings.webhook_secret)}


@router.post("/me/notify-test")
async def notify_me(request: Request, auth: Auth = Depends(current_auth), db: Database = Depends(get_db),
                    settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """给自己发一条测试通知:站内信必达;若配置了回调,同步探测一次回调投递结果。"""
    text = "这是一条测试通知:如果你在通知中心看到它,说明站内通知正常"

    async def go(ctx):  # type: ignore[no-untyped-def]
        await ctx.conn.execute(
            "INSERT INTO notifications(id, user_id, event, text, at, read, patent_id) VALUES(?,?,?,?,?,0,'')",
            (new_id("n"), auth.id, "transition", text, now()))

    await run(request, auth, go)
    prefs = await get_prefs(db.reader, auth.id)  # type: ignore[arg-type]
    cfg = await get_system(db.reader)  # type: ignore[arg-type]
    url = cfg.get("webhookUrl") or settings.webhook_url
    webhook = None
    if url:
        webhook = await probe(url, settings.webhook_secret, {
            "event": "test", "text": text, "at": now(),
            "recipients": [{"id": auth.id, "name": auth.user["name"], "email": auth.user["email"]}],
        })
    return {"inApp": True, "webhookConfigured": bool(url), "webhook": webhook,
            "quietNow": in_quiet_hours(prefs["quietHours"], now()[11:16]), "quietHours": prefs["quietHours"],
            "mutedEvents": [k for k, v in prefs["notifyEvents"].items() if v is False]}


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
    await sync_webhook(request.app)  # 回调地址即时生效
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
    # 关联专利当前对我不可见(如已改回私有)的通知不再返回(决策 9)
    pids = {r["patent_id"] for r in rows if r["patent_id"]}
    visible = {p["id"] for p in await load_patents(db.reader, pids) if access.can_see(auth.user, p)}  # type: ignore[arg-type]
    return [notification_json(r) for r in rows if not r["patent_id"] or r["patent_id"] in visible]


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
        "pendingRegistrations": await pending_for(db, me_, cfg),
        "me": me_,
        "users": await load_users(db.reader),  # type: ignore[arg-type]
        "teams": await teams_json(db),
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
