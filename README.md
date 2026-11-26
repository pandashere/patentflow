# PATENTFLOW · 专利状态跟踪系统

轻量级内网专利状态跟踪系统 —— 五阶段流水线(草案 → 可专利性审查 → 专利实施 → 专利检索 → DOI 撰写),同行审查门禁、阶段级版本控制、可配置 KPI,为几十人研发团队设计。

本仓库当前包含:

- **`src/`** — 高保真可交互 UI Demo(React + TypeScript + Vite + Tailwind,纯前端 mock 数据,支持四身份视角切换:普通用户 / PL / GL / Reviewer)
- **`docs/01-用户需求.md`** — 原始需求
- **`docs/02-设计方案与答疑.md`** — 架构设计讨论稿(含 SSO 解耦、通知回调、KPI 引擎、API 概览)与全部需求答疑决策

## 运行 Demo

```bash
npm install
npm run dev        # 开发预览
npm run build      # 产物在 dist/
```

## 后端(规划)

FastAPI + aiosqlite(WAL + 乐观锁),单进程内网部署;SSO 走 `IdentityProvider` 接口、通知走 `Notifier` 回调接口,详见 `docs/02`。
