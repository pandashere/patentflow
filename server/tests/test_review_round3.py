"""Codex review 第 3 轮修复的回归测试。"""
from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from patentflow.notify import WebhookNotifier
from tests.helpers import H, db_exec, world
from tests.test_patents import mk


def _server():  # type: ignore[no-untyped-def]
    got: list = []

    class Hook(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            got.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *a):  # type: ignore[no-untyped-def]
            pass

    srv = HTTPServer(("127.0.0.1", 0), Hook)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_port}/", got


def test_security_events_only_go_to_deploy_webhook() -> None:
    deploy, deploy_url, deploy_got = _server()
    gl, gl_url, gl_got = _server()
    try:
        n = WebhookNotifier(deploy_url)
        n.url = gl_url  # GL 在界面改成了自己的地址

        async def go() -> None:
            await n.send({"event": "transition", "text": "重置链接 token=abc", "security": True})
            await n.send({"event": "due", "text": "普通提醒"})
            await asyncio.sleep(0.5)

        asyncio.run(go())
        assert [e["text"] for e in deploy_got] == ["重置链接 token=abc"]
        assert [e["text"] for e in gl_got] == ["普通提醒"]
    finally:
        deploy.shutdown()
        gl.shutdown()


def test_reset_link_uses_public_url(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.app.state.settings.public_url = "https://patentflow.corp.local"
    link = client.post("/api/auth/password/forgot", json={"email": "u1@corp.local"},
                       headers={"Host": "evil.example"}).json()["demoLink"]
    assert link.startswith("https://patentflow.corp.local/reset?token=")


def test_cross_team_offboarding_uses_patent_team_pl(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.put("/api/teams/t1/pl", json={"userId": "pl1"}, headers=H("gl"))
    client.put("/api/teams/t2/pl", json={"userId": "pl2"}, headers=H("gl"))
    priv = mk(client, "u1", vis="private")["id"]  # 属于 t1
    client.patch("/api/users/u1", json={"teamId": "t2"}, headers=H("gl"))
    client.post("/api/users/u1/deactivate", json={}, headers=H("gl"))
    assert client.get(f"/api/patents/{priv}", headers=H("pl1")).json()["ownerId"] == "pl1"


def test_disabled_rule_is_frozen_too(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    rid = client.post("/api/kpi/rules", json={"name": "R", "scope": {"type": "global"}, "cycleId": "c26",
                      "targets": [{"stage": "patentability", "deadline": "2026-12-31"}]}, headers=H("gl")).json()["id"]
    client.post(f"/api/kpi/rules/{rid}/toggle", headers=H("gl"))  # 停用
    client.post("/api/cycles/c26/close", headers=H("gl"))
    client.post(f"/api/kpi/rules/{rid}/toggle", headers=H("gl"))  # 再启用
    client.post(f"/api/patents/{pid}/advance", json={"reason": "go"}, headers=H("u1"))
    assert client.get(f"/api/kpi/rules/{rid}/report", headers=H("gl")).json()["overall"] == 0.0


def test_pending_account_cannot_receive_patent(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.post("/api/auth/register", json={"name": "新", "email": "n@corp.local", "teamId": "t1", "password": "newpass123"})
    uid = client.get("/api/registrations", headers=H("gl")).json()[0]["id"]
    pid = mk(client)["id"]
    assert client.post(f"/api/patents/{pid}/transfer", json={"to": uid}, headers=H("u1")).status_code == 400


def test_set_private_voids_pending_extension(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    client.post(f"/api/patents/{pid}/extensions", json={"newDue": "2026-12-30", "reason": "x"}, headers=H("u1"))
    p = client.patch(f"/api/patents/{pid}/visibility", json={"visibility": "private"}, headers=H("u1")).json()
    assert p["extensions"][-1]["status"] == "void"


def test_cross_team_pl_owner_can_self_approve(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client, "u1", vis="private")["id"]
    client.post(f"/api/patents/{pid}/transfer", json={"to": "pl2"}, headers=H("u1"))
    e = client.post(f"/api/patents/{pid}/extensions", json={"newDue": "2026-12-30", "reason": "x"}, headers=H("pl2")).json()
    eid = e["patent"]["extensions"][-1]["id"]
    assert client.post(f"/api/patents/{pid}/extensions/{eid}/approve", headers=H("pl2")).status_code == 200


def test_cancel_cross_cycle_clamps_due(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    client.post(f"/api/patents/{pid}/cross-cycle", headers=H("gl"))
    db_exec(client, "UPDATE patents SET due_dates='{\"draft\":\"2027-01-15\"}' WHERE id=?", (pid,))
    p = client.post(f"/api/patents/{pid}/cross-cycle", headers=H("gl")).json()
    assert p["dueDates"]["draft"] == "2026-12-31"
