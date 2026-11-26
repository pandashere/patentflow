"""部署层配置:patentflow.config.yaml(改动需重启)。

业务配置(审查门禁、阶段默认周期、逾期策略、KPI 等)存数据库,由 GL 在 UI 修改即时生效;
本文件里的 overdue/kpi 段只作为「首次建库时」的业务配置初值。
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class SsoProviderConf:
    name: str
    issuer: str
    enabled: bool = True
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class Settings:
    db_path: str = "./patentflow.db"
    admins: list[str] = field(default_factory=list)
    timezone: str = "Asia/Shanghai"
    local_auth_enabled: bool = True
    session_ttl_hours: int = 12
    reset_token_ttl_minutes: int = 30
    sso_providers: list[SsoProviderConf] = field(default_factory=list)
    webhook_url: str = ""
    webhook_secret: str = ""
    token_ttl_days_max: int = 365
    cors_origins: list[str] = field(default_factory=list)
    reminder_interval_seconds: int = 3600
    demo: bool = False  # 演示模式:允许种子数据、前端显示身份快速切换
    initial_business: dict[str, Any] = field(default_factory=dict)
    static_dir: str | None = None


_ENV = re.compile(r"\$\{([A-Z0-9_]+)\}")


def _expand(v: Any) -> Any:
    if isinstance(v, str):
        return _ENV.sub(lambda m: os.environ.get(m.group(1), ""), v)
    if isinstance(v, list):
        return [_expand(x) for x in v]
    if isinstance(v, dict):
        return {k: _expand(x) for k, x in v.items()}
    return v


def load_settings(path: str | os.PathLike[str] | None = None) -> Settings:
    path = path or os.environ.get("PATENTFLOW_CONFIG", "patentflow.config.yaml")
    raw: dict[str, Any] = {}
    if Path(path).exists():
        raw = _expand(yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {})
    db = (raw.get("database") or {}).get("url", "sqlite:///./patentflow.db")
    auth = raw.get("auth") or {}
    notify = raw.get("notify") or {}
    security = raw.get("security") or {}
    providers = [
        SsoProviderConf(
            name=p.get("name", p.get("issuer", "")),
            issuer=p["issuer"],
            enabled=bool(p.get("enabled", True)),
            extra={k: v for k, v in p.items() if k not in {"name", "issuer", "enabled"}},
        )
        for p in auth.get("sso_providers") or []
    ]
    return Settings(
        db_path=os.environ.get("PATENTFLOW_DB", db.removeprefix("sqlite:///")),
        admins=[a.strip().lower() for a in raw.get("admins") or []],
        timezone=raw.get("timezone", "Asia/Shanghai"),
        local_auth_enabled=bool(auth.get("local_enabled", True)),
        session_ttl_hours=int(auth.get("session_ttl_hours", 12)),
        reset_token_ttl_minutes=int(auth.get("reset_token_ttl_minutes", 30)),
        sso_providers=providers,
        webhook_url=notify.get("webhook_url", "") or "",
        webhook_secret=notify.get("webhook_secret", "") or "",
        token_ttl_days_max=int(security.get("token_ttl_days_max", 365)),
        cors_origins=list(security.get("cors_origins") or []),
        reminder_interval_seconds=int(notify.get("reminder_interval_seconds", 3600)),
        demo=bool(raw.get("demo", False)) or os.environ.get("PATENTFLOW_DEMO") == "1",
        initial_business={
            "overdue": raw.get("overdue") or {},
            "kpi": raw.get("kpi") or {},
            "notify": notify,
        },
        static_dir=raw.get("static_dir") or os.environ.get("PATENTFLOW_STATIC"),
    )
