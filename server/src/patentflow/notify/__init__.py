"""通知回调:Notifier 接口 + Logging / Webhook 实现。

事件 JSON:{event, text, patentId, recipients:[{id,name,email}], at, security?}
Webhook:POST JSON,`X-PatentFlow-Signature: sha256=<HMAC(secret, body)>`,失败指数退避重试 3 次。
具体投递渠道(邮件 / IM)由 webhook 接收方适配,本服务只负责回调。
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any, Protocol

log = logging.getLogger("patentflow.notify")


class Notifier(Protocol):
    async def send(self, event: dict[str, Any]) -> None: ...


class LoggingNotifier:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []  # 便于测试/演示查看

    async def send(self, event: dict[str, Any]) -> None:
        self.sent.append(event)
        log.info("notify %s -> %s: %s", event.get("event"),
                 [r.get("email") for r in event.get("recipients", [])], event.get("text"))


def _post(url: str, secret: str, body: bytes, timeout: float) -> int:
    headers = {"Content-Type": "application/json", "User-Agent": "PatentFlow-Webhook/1"}
    if secret:
        sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        headers["X-PatentFlow-Signature"] = f"sha256={sig}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 内网回调地址由 GL 配置
        resp.read(2048)
        return resp.status


async def probe(url: str, secret: str, event: dict[str, Any], timeout: float = 5.0) -> dict[str, Any]:
    """同步探测一次回调(不重试),返回 {ok, status, latencyMs, error} 供界面展示。"""
    if not url.startswith(("http://", "https://")):
        return {"ok": False, "status": None, "latencyMs": 0, "error": "地址需以 http:// 或 https:// 开头"}
    body = json.dumps({**event, "test": True}, ensure_ascii=False).encode()
    t0 = time.monotonic()
    try:
        status = await asyncio.to_thread(_post, url, secret, body, timeout)
        return {"ok": 200 <= status < 300, "status": status, "latencyMs": round((time.monotonic() - t0) * 1000),
                "error": None}
    except urllib.error.HTTPError as e:
        return {"ok": False, "status": e.code, "latencyMs": round((time.monotonic() - t0) * 1000),
                "error": f"对方返回 HTTP {e.code}"}
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", e)
        msg = "连接超时" if "timed out" in str(reason) else f"无法连接:{reason}"
        return {"ok": False, "status": None, "latencyMs": round((time.monotonic() - t0) * 1000), "error": msg}
    except TimeoutError:
        return {"ok": False, "status": None, "latencyMs": round(timeout * 1000), "error": "连接超时"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "status": None, "latencyMs": 0, "error": str(e)}


class WebhookNotifier(LoggingNotifier):
    """回调地址可在运行时更新(GL 在界面修改后即时生效)。地址为空时只记日志。"""

    def __init__(self, url: str = "", secret: str = "", retries: int = 3) -> None:
        super().__init__()
        self.url, self.secret, self.retries = url, secret, retries
        # 账号安全事件(含一次性重置 / 激活链接)只投递到部署配置的回调,
        # 不随 GL 在界面修改的地址变化,避免业务管理员改地址截获他人凭据
        self.security_url = url

    async def send(self, event: dict[str, Any]) -> None:
        await super().send(event)
        url = self.security_url if event.get("security") else self.url
        if not url:
            return
        body = json.dumps(event, ensure_ascii=False).encode()
        # 后台投递,不阻塞业务请求
        asyncio.get_running_loop().create_task(self._deliver(url, body))

    async def _deliver(self, url: str, body: bytes) -> None:
        for attempt in range(self.retries):
            try:
                await asyncio.to_thread(_post, url, self.secret, body, 10)
                return
            except Exception as e:  # noqa: BLE001
                log.warning("webhook 投递失败(第 %d 次):%s", attempt + 1, e)
                await asyncio.sleep(2**attempt)
        log.error("webhook 投递最终失败,事件已丢弃:%s", body[:200])
