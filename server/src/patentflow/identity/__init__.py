"""SSO 解耦:IdentityProvider 接口。

本地账密也是一种登录方式;接入具体 SSO(OIDC / CAS / 企业微信)= 新增一个 Provider 实现并注册,
业务代码零改动。决策:SSO 相关设计(email 自动匹配范围、配置管理员能否自动绑定、纯 SSO 用户的本地密码)
暂时留空 —— 当前不注册任何外部 Provider,begin/callback 返回 501。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class AuthRedirect:
    url: str
    state: str


@dataclass
class ExternalIdentity:
    issuer: str
    subject: str
    email: str | None
    display_name: str | None
    raw_claims: dict[str, Any] = field(default_factory=dict)


class IdentityProvider(Protocol):
    name: str
    issuer: str

    async def begin_auth(self, redirect_uri: str) -> AuthRedirect: ...

    async def complete_auth(self, callback_params: dict[str, str]) -> ExternalIdentity: ...


PROVIDERS: dict[str, IdentityProvider] = {}


def register(p: IdentityProvider) -> None:
    PROVIDERS[p.issuer] = p
