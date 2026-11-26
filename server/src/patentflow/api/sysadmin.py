"""系统管理员(兜底账号)后台 API —— /api/sysadmin/*

- 账号来自配置文件 `sysadmin.username / password(或 password_hash)`,不是业务用户
- 独立会话 Cookie(pf_admin,仅作用于 /api/sysadmin),与业务会话互不相通
- 只做账号救援:重置密码、恢复账号、强制下线、调整角色团队(例如指定 GL)、新建账号/团队;
  不能访问任何专利数据
- 所有操作写 admin_audit 审计日志
"""
from __future__ import annotations

import asyncio
import hmac
import secrets
import string
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from ..config import Settings, sysadmin_enabled
from ..db import Database, dumps
from ..deps import get_db, get_settings, link_base
from ..domain.constants import ROLES
from ..domain.accounts import invalidate_links
from ..domain.ctx import write_ctx
from ..domain.members import clear_stale_leadership
from ..domain.errors import DomainError, bad_request, conflict, not_found
from ..domain.notifications import notify
from ..domain.repo import load_user, load_users
from ..security import hash_password, new_id, sha256, verify_password
from ..timeutil import now, now_dt

router = APIRouter(prefix="/sysadmin", tags=["sysadmin"])
COOKIE = "pf_admin"
SESSION_HOURS = 2


class LoginIn(BaseModel):
    username: str
    password: str


class ResetIn(BaseModel):
    mode: Literal["temp", "link"] = "temp"


class PatchIn(BaseModel):
    role: Literal["user", "pl", "gl"] | None = None
    teamId: str | None = None


class UserIn(BaseModel):
    name: str = Field(min_length=1)
    email: str
    title: str = ""
    teamId: str
    role: Literal["user", "pl", "gl"] = "user"


class TeamIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)


def _fmt(dt) -> str:  # type: ignore[no-untyped-def]
    return dt.strftime("%Y-%m-%d %H:%M")


def _check_password(settings: Settings, pw: str) -> bool:
    if settings.sysadmin_password_hash:
        return verify_password(pw, settings.sysadmin_password_hash)
    return hmac.compare_digest(pw.encode(), settings.sysadmin_password.encode())


async def current_admin(request: Request, db: Database = Depends(get_db),
                        settings: Settings = Depends(get_settings)) -> str:
    if not sysadmin_enabled(settings):
        raise DomainError(403, "sysadmin_disabled", "未在配置文件中启用系统管理员")
    sid = request.cookies.get(COOKIE)
    row = await db.one("SELECT username FROM admin_sessions WHERE id = ? AND expires_at > ?",
                       (sha256(sid or ""), now())) if sid else None
    if not row or row["username"] != settings.sysadmin_username:
        raise DomainError(401, "unauthenticated", "请先以系统管理员身份登录")
    return row["username"]


async def audit(conn, request: Request, admin: str, action: str, target: str = "", detail: Any = "") -> None:  # type: ignore[no-untyped-def]
    await conn.execute(
        "INSERT INTO admin_audit(id, at, admin, action, target, detail, ip) VALUES(?,?,?,?,?,?,?)",
        (new_id("au"), now(), admin, action, target, detail if isinstance(detail, str) else dumps(detail),
         request.client.host if request.client else ""),
    )


def _temp_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(12))


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, db: Database = Depends(get_db),
                settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    if not sysadmin_enabled(settings):
        raise DomainError(403, "sysadmin_disabled", "未在配置文件中启用系统管理员")
    ok = hmac.compare_digest(body.username.encode(), settings.sysadmin_username.encode()) and _check_password(
        settings, body.password)
    if not ok:
        await asyncio.sleep(0.5)  # 减缓暴力尝试
        async with db.tx() as conn:
            await audit(conn, request, body.username[:40], "login_failed")
        raise DomainError(401, "login_failed", "用户名或密码错误")
    sid = secrets.token_urlsafe(32)
    async with db.tx() as conn:
        await conn.execute("INSERT INTO admin_sessions VALUES(?,?,?,?)",
                           (sha256(sid), settings.sysadmin_username, now(),
                            _fmt(now_dt() + timedelta(hours=SESSION_HOURS))))
        await audit(conn, request, settings.sysadmin_username, "login")
    response.set_cookie(COOKIE, sid, httponly=True, samesite="strict", max_age=SESSION_HOURS * 3600,
                        path="/api/sysadmin")
    return {"username": settings.sysadmin_username}


@router.post("/logout")
async def logout(request: Request, response: Response, db: Database = Depends(get_db)) -> dict[str, bool]:
    sid = request.cookies.get(COOKIE)
    if sid:
        async with db.tx() as conn:
            await conn.execute("DELETE FROM admin_sessions WHERE id = ?", (sha256(sid),))
    response.delete_cookie(COOKIE, path="/api/sysadmin")
    return {"ok": True}


@router.get("/me")
async def me(admin: str = Depends(current_admin)) -> dict[str, str]:
    return {"username": admin}


@router.get("/overview")
async def overview(admin: str = Depends(current_admin), db: Database = Depends(get_db)) -> dict[str, Any]:
    """账号视图:不含任何专利内容。"""
    users = await load_users(db.reader, include_pending=True)  # type: ignore[arg-type]
    pw = {r["id"]: bool(r["password_hash"]) for r in await db.all("SELECT id, password_hash FROM users")}
    tokens = {r["user_id"]: r["n"] for r in await db.all(
        "SELECT user_id, COUNT(*) n FROM api_tokens WHERE revoked = 0 GROUP BY user_id")}
    sessions = {r["user_id"]: r["n"] for r in await db.all(
        """SELECT s.user_id, COUNT(*) n FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.expires_at > ? AND s.epoch = u.session_epoch GROUP BY s.user_id""", (now(),))}
    teams = [{"id": t["id"], "name": t["name"], "plId": t["pl_id"]} for t in await db.all("SELECT * FROM teams ORDER BY id")]
    return {
        "users": [{**u, "hasPassword": pw.get(u["id"], False), "activeTokens": tokens.get(u["id"], 0),
                   "activeSessions": sessions.get(u["id"], 0)} for u in users],
        "teams": teams,
        "glCount": sum(1 for u in users if u["role"] == "gl" and not u.get("deactivated")),
    }


async def _user(db: Database, uid: str) -> dict[str, Any]:
    u = await load_user(db.reader, uid)  # type: ignore[arg-type]
    if not u:
        raise not_found("账号")
    return u


@router.post("/users/{uid}/reset-password")
async def reset_password(uid: str, body: ResetIn, request: Request, admin: str = Depends(current_admin),
                         db: Database = Depends(get_db), settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """temp:生成一次性临时密码(只显示这一次,线下告知本人,登录后请自行修改);
    link:生成 30 分钟有效的重置链接,同时经通知接口投递给本人。两种方式都会使其现有会话失效。"""
    u = await _user(db, uid)
    out: dict[str, Any] = {}
    async with write_ctx(db, {"id": "sysadmin", "name": "系统管理员"}, settings, request.app.state.notifier) as ctx:
        if body.mode == "temp":
            pw = _temp_password()
            await invalidate_links(ctx.conn, uid)
            await ctx.conn.execute(
                "UPDATE users SET password_hash = ?, session_epoch = session_epoch + 1 WHERE id = ?",
                (hash_password(pw), uid))
            out["tempPassword"] = pw
        else:
            await invalidate_links(ctx.conn, uid)  # 只保留最新这一条链接
            token = secrets.token_urlsafe(24)
            link = f"{link_base(request)}/reset?token={token}"
            await ctx.conn.execute(
                "INSERT INTO password_resets(token_hash, user_id, created_at, expires_at) VALUES(?,?,?,?)",
                (sha256(token), uid, now(), _fmt(now_dt() + timedelta(minutes=settings.reset_token_ttl_minutes))))
            await ctx.conn.execute("UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?", (uid,))
            await notify(ctx, "transition", "系统管理员为你发起了密码重置,链接已发送到你的邮箱 / IM(30 分钟内有效)",
                         only=[uid], security=True, include_actor=True,
                         external_text=f"系统管理员为你发起了密码重置(30 分钟内有效):{link}")
            out["link"] = link
        await ctx.conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        await audit(ctx.conn, request, admin, f"reset_password:{body.mode}", u["email"])
    return out


@router.post("/users/{uid}/revoke-sessions")
async def revoke_sessions(uid: str, request: Request, revokeTokens: bool = False, admin: str = Depends(current_admin),
                          db: Database = Depends(get_db)) -> dict[str, bool]:
    """强制下线(账号疑似被盗用时):清空会话,可选吊销全部 API Token。"""
    u = await _user(db, uid)
    async with db.tx() as conn:
        await conn.execute("UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?", (uid,))
        await conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        if revokeTokens:
            await conn.execute("UPDATE api_tokens SET revoked = 1 WHERE user_id = ?", (uid,))
        await audit(conn, request, admin, "revoke_sessions" + (":tokens" if revokeTokens else ""), u["email"])
    return {"ok": True}


@router.post("/users/{uid}/reactivate")
async def reactivate(uid: str, request: Request, admin: str = Depends(current_admin),
                     db: Database = Depends(get_db)) -> dict[str, bool]:
    u = await _user(db, uid)
    if not u.get("deactivated"):
        raise conflict("该账号未停用")
    async with db.tx() as conn:
        await conn.execute("UPDATE users SET deactivated_at = NULL, deactivated_by = NULL WHERE id = ?", (uid,))
        await audit(conn, request, admin, "reactivate", u["email"])
    return {"ok": True}


@router.patch("/users/{uid}")
async def patch_user(uid: str, body: PatchIn, request: Request, admin: str = Depends(current_admin),
                     db: Database = Depends(get_db)) -> dict[str, Any]:
    """调整角色 / 团队 —— 典型场景:唯一的 GL 离职或被误降级后,重新指定 GL。"""
    u = await _user(db, uid)
    sets: dict[str, Any] = {}
    if body.role and body.role != u["role"]:
        sets["role"] = body.role
    if body.teamId and body.teamId != u["teamId"]:
        if not await db.one("SELECT 1 FROM teams WHERE id = ?", (body.teamId,)):
            raise bad_request("团队不存在")
        sets["team_id"] = body.teamId
    if sets:
        async with db.tx() as conn:
            cols = ", ".join(f"{k} = ?" for k in sets)
            epoch = ", session_epoch = session_epoch + 1" if "role" in sets else ""
            await conn.execute(f"UPDATE users SET {cols}{epoch} WHERE id = ?", (*sets.values(), uid))
            await clear_stale_leadership(conn, uid, sets.get("role"), sets.get("team_id"))
            await audit(conn, request, admin, "update_user", u["email"], sets)
    return await _user(db, uid)


@router.post("/users", status_code=201)
async def create_user(body: UserIn, request: Request, admin: str = Depends(current_admin),
                      db: Database = Depends(get_db)) -> dict[str, Any]:
    """新建账号(首次部署建首个 GL 等),返回一次性临时密码。"""
    email = body.email.strip().lower()
    if body.role not in ROLES or "@" not in email:
        raise bad_request("请填写有效邮箱与角色")
    if not await db.one("SELECT 1 FROM teams WHERE id = ?", (body.teamId,)):
        raise bad_request("团队不存在")
    if await db.one("SELECT 1 FROM users WHERE email = ?", (email,)):
        raise conflict("该邮箱已存在")
    uid, pw = new_id("u-"), _temp_password()
    async with db.tx() as conn:
        await conn.execute(
            "INSERT INTO users(id, name, email, title, role, team_id, password_hash, created_at) VALUES(?,?,?,?,?,?,?,?)",
            (uid, body.name.strip(), email, body.title, body.role, body.teamId, hash_password(pw), now()))
        await audit(conn, request, admin, "create_user", email, {"role": body.role, "teamId": body.teamId})
    return {"user": await _user(db, uid), "tempPassword": pw}


@router.post("/teams", status_code=201)
async def create_team(body: TeamIn, request: Request, admin: str = Depends(current_admin),
                      db: Database = Depends(get_db)) -> dict[str, Any]:
    tid = new_id("t-")
    async with db.tx() as conn:
        # PL 指派涉及调组与角色变更,统一由 GL 在业务后台「团队」中完成
        await conn.execute("INSERT INTO teams(id, name, pl_id) VALUES(?,?,NULL)", (tid, body.name.strip()))
        await audit(conn, request, admin, "create_team", body.name.strip())
    return {"id": tid, "name": body.name.strip(), "plId": None}


SYSADMIN_ACTOR = {"id": "sysadmin", "name": "系统管理员", "role": "gl", "teamId": ""}


class ApproveIn(BaseModel):
    teamId: str | None = None
    role: Literal["user", "pl", "gl"] | None = None
    reason: str = ""  # 拒绝时必填


@router.post("/registrations/{uid}/{action}")
async def decide_registration(uid: str, action: Literal["approve", "reject"], body: ApproveIn, request: Request,
                              admin: str = Depends(current_admin), db: Database = Depends(get_db),
                              settings: Settings = Depends(get_settings)) -> dict[str, bool]:
    from ..domain import members

    u = await _user(db, uid)
    async with write_ctx(db, SYSADMIN_ACTOR, settings, request.app.state.notifier) as ctx:
        if action == "approve":
            await members.approve(ctx, uid, body.teamId, body.role)
        else:
            await members.reject(ctx, uid, body.reason)
        await audit(ctx.conn, request, admin, f"registration_{action}", u["email"])
    return {"ok": True}


@router.get("/audit")
async def audit_log(admin: str = Depends(current_admin), db: Database = Depends(get_db)) -> list[dict[str, Any]]:
    rows = await db.all("SELECT * FROM admin_audit ORDER BY at DESC, rowid DESC LIMIT 200")
    return [dict(r) for r in rows]
