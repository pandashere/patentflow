"""认证:本地账密登录 / 登出 / 忘记密码 / 重置 / 修改密码;SSO 入口(当前未接入,返回 501)。"""
from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from ..config import Settings
from ..db import Database
from ..deps import SESSION_COOKIE, Auth, current_auth, get_db, get_settings
from ..domain.ctx import write_ctx
from ..domain.errors import DomainError
from ..domain.notifications import notify
from ..domain.repo import load_user
from ..identity import PROVIDERS
from ..security import hash_password, sha256, verify_password
from ..timeutil import now, now_dt

router = APIRouter(tags=["auth"])

LOGIN_FAILED = "账号或密码错误"  # 不区分「账号不存在」与「密码错误」,防枚举
FORGOT_MSG = "如果该邮箱对应的账号存在,重置链接已经通过通知渠道发出,30 分钟内有效。"


class LoginIn(BaseModel):
    email: str
    password: str


class ForgotIn(BaseModel):
    email: str


class ResetIn(BaseModel):
    token: str
    password: str = Field(min_length=8)


class ChangePwdIn(BaseModel):
    old: str = ""
    new: str = Field(min_length=8)


def _fmt(dt) -> str:  # type: ignore[no-untyped-def]
    return dt.strftime("%Y-%m-%d %H:%M")


@router.post("/auth/login")
async def login(body: LoginIn, response: Response, db: Database = Depends(get_db),
                settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    if not settings.local_auth_enabled:
        raise DomainError(403, "local_disabled", "本地账密登录已关闭,请使用 SSO")
    row = await db.one("SELECT * FROM users WHERE email = ? AND deactivated_at IS NULL", (body.email.strip(),))
    if not row or not verify_password(body.password, row["password_hash"]):
        raise DomainError(401, "login_failed", LOGIN_FAILED)
    if row["pending_at"]:  # 密码正确才提示,避免泄露注册状态
        raise DomainError(403, "pending_approval", "账号正在等待审批(GL / 所选团队的 PL / 系统管理员),通过后即可登录")
    sid = secrets.token_urlsafe(32)
    async with db.tx() as conn:
        await conn.execute(
            "INSERT INTO sessions(id, user_id, epoch, created_at, expires_at) VALUES(?,?,?,?,?)",
            (sha256(sid), row["id"], row["session_epoch"], now(),
             _fmt(now_dt() + timedelta(hours=settings.session_ttl_hours))),
        )
    response.set_cookie(SESSION_COOKIE, sid, httponly=True, samesite="lax",
                        max_age=settings.session_ttl_hours * 3600, path="/")
    return {"user": await load_user(db.reader, row["id"])}  # type: ignore[arg-type]


@router.post("/auth/logout")
async def logout(request: Request, response: Response, db: Database = Depends(get_db)) -> dict[str, bool]:
    sid = request.cookies.get(SESSION_COOKIE)
    if sid:
        async with db.tx() as conn:
            await conn.execute("DELETE FROM sessions WHERE id = ?", (sha256(sid),))
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.post("/auth/password/forgot")
async def forgot(body: ForgotIn, request: Request, db: Database = Depends(get_db),
                 settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """无论账号是否存在都返回相同话术;重置链接经通知接口投递(安全事件强制送达)。"""
    row = await db.one("SELECT id FROM users WHERE email = ? AND deactivated_at IS NULL", (body.email.strip(),))
    out: dict[str, Any] = {"message": FORGOT_MSG}
    if row:
        token = secrets.token_urlsafe(24)
        link = f"{str(request.base_url).rstrip('/')}/reset?token={token}"
        user = await load_user(db.reader, row["id"])  # type: ignore[arg-type]
        async with write_ctx(db, user, settings, request.app.state.notifier) as ctx:  # type: ignore[arg-type]
            await ctx.conn.execute(
                "INSERT INTO password_resets(token_hash, user_id, created_at, expires_at) VALUES(?,?,?,?)",
                (sha256(token), row["id"], now(),
                 _fmt(now_dt() + timedelta(minutes=settings.reset_token_ttl_minutes))),
            )
            await notify(ctx, "transition", "你申请了重置密码,重置链接已发送到你的邮箱 / IM(30 分钟内有效)",
                         only=[row["id"]], security=True, include_actor=True,
                         external_text=f"PATENTFLOW 密码重置链接(30 分钟内有效):{link}")
        if settings.demo:
            out["demoLink"] = link  # 演示模式直接回显;生产由 webhook/邮件适配器投递
    return out


@router.post("/auth/password/reset")
async def reset(body: ResetIn, db: Database = Depends(get_db)) -> dict[str, bool]:
    row = await db.one("SELECT * FROM password_resets WHERE token_hash = ?", (sha256(body.token),))
    if not row or row["used"]:
        raise DomainError(400, "reset_invalid", "重置链接无效或已使用")
    if row["expires_at"] < now():
        raise DomainError(400, "reset_expired", "重置链接已过期,请重新申请")
    async with db.tx() as conn:
        await conn.execute("UPDATE password_resets SET used = 1 WHERE token_hash = ?", (row["token_hash"],))
        # 改密后所有旧会话失效
        await conn.execute(
            "UPDATE users SET password_hash = ?, session_epoch = session_epoch + 1 WHERE id = ?",
            (hash_password(body.password), row["user_id"]),
        )
    return {"ok": True}


@router.post("/me/password")
async def change_password(body: ChangePwdIn, request: Request, response: Response,
                          auth: Auth = Depends(current_auth), db: Database = Depends(get_db),
                          settings: Settings = Depends(get_settings)) -> dict[str, bool]:
    row = await db.one("SELECT password_hash, session_epoch FROM users WHERE id = ?", (auth.id,))
    assert row
    if row["password_hash"] and not verify_password(body.old, row["password_hash"]):
        raise DomainError(400, "wrong_password", "当前密码不正确")
    async with db.tx() as conn:
        await conn.execute(
            "UPDATE users SET password_hash = ?, session_epoch = session_epoch + 1 WHERE id = ?",
            (hash_password(body.new), auth.id),
        )
        # 当前会话续期到新 epoch,其余会话失效
        sid = request.cookies.get(SESSION_COOKIE)
        if sid:
            await conn.execute("UPDATE sessions SET epoch = ? WHERE id = ?", (row["session_epoch"] + 1, sha256(sid)))
    return {"ok": True}


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    email: str
    title: str = ""
    teamId: str
    password: str = Field(min_length=8)


async def _self_registration(db: Database) -> bool:
    from ..domain.sysconfig import get_system

    return bool((await get_system(db.reader))["members"].get("selfRegistration", True))  # type: ignore[arg-type]


@router.get("/auth/teams")
async def public_teams(db: Database = Depends(get_db)) -> list[dict[str, str]]:
    """注册时选择团队(仅在开放自助注册时可用)。"""
    if not await _self_registration(db):
        raise DomainError(403, "registration_closed", "自助注册已关闭")
    return [{"id": t["id"], "name": t["name"]} for t in await db.all("SELECT id, name FROM teams ORDER BY name")]


@router.post("/auth/register", status_code=201)
async def register(body: RegisterIn, request: Request, db: Database = Depends(get_db),
                   settings: Settings = Depends(get_settings)) -> dict[str, str]:
    from ..domain import members

    anon = {"id": "anonymous", "name": body.name, "role": "user", "teamId": ""}
    async with write_ctx(db, anon, settings, request.app.state.notifier) as ctx:
        await members.register(ctx, body.model_dump())
    return {"message": "注册申请已提交,等待 GL 或所选团队的 PL 审批;通过后会通知你,届时即可登录。"}


@router.get("/auth/providers")
async def providers(db: Database = Depends(get_db), settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return {
        "selfRegistration": await _self_registration(db),
        "local": settings.local_auth_enabled,
        "demo": settings.demo,
        "sso": [{"name": p.name, "issuer": p.issuer, "enabled": p.enabled, "connected": p.issuer in PROVIDERS}
                for p in settings.sso_providers],
    }


@router.get("/auth/sso/{issuer}/begin")
async def sso_begin(issuer: str) -> None:
    raise DomainError(501, "sso_not_connected", f"SSO 提供方 {issuer} 尚未接入(SSO 设计待定,见设计文档「待后续确认」)")


@router.get("/auth/sso/{issuer}/callback")
async def sso_callback(issuer: str) -> None:
    raise DomainError(501, "sso_not_connected", f"SSO 提供方 {issuer} 尚未接入")
