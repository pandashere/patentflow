"""密码与令牌:标准库 scrypt + 随机令牌;令牌只存 SHA-256 哈希。"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

_N, _R, _P = 2**14, 8, 1


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(pw: str, stored: str | None) -> bool:
    if not stored or not stored.startswith("scrypt$"):
        return False
    _, salt_b64, dk_b64 = stored.split("$")
    dk = hashlib.scrypt(pw.encode(), salt=base64.b64decode(salt_b64), n=_N, r=_R, p=_P, dklen=32)
    return hmac.compare_digest(dk, base64.b64decode(dk_b64))


def new_token(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(24)}"


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def new_id(prefix: str) -> str:
    return f"{prefix}{secrets.token_hex(6)}"
