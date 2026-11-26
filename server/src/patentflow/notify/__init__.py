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


class WebhookNotifier(LoggingNotifier):
    def __init__(self, url: str, secret: str = "", retries: int = 3) -> None:
        super().__init__()
        self.url, self.secret, self.retries = url, secret, retries

    def _post(self, body: bytes) -> None:
        headers = {"Content-Type": "application/json"}
        if self.secret:
            sig = hmac.new(self.secret.encode(), body, hashlib.sha256).hexdigest()
            headers["X-PatentFlow-Signature"] = f"sha256={sig}"
        req = urllib.request.Request(self.url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 内网固定 URL
            resp.read()

    async def send(self, event: dict[str, Any]) -> None:
        await super().send(event)
        body = json.dumps(event, ensure_ascii=False).encode()
        # 后台投递,不阻塞业务请求
        asyncio.get_running_loop().create_task(self._deliver(body))

    async def _deliver(self, body: bytes) -> None:
        for attempt in range(self.retries):
            try:
                await asyncio.to_thread(self._post, body)
                return
            except Exception as e:  # noqa: BLE001
                log.warning("webhook 投递失败(第 %d 次):%s", attempt + 1, e)
                await asyncio.sleep(2**attempt)
        log.error("webhook 投递最终失败,事件已丢弃:%s", body[:200])
