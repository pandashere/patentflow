# PATENTFLOW · 专利状态跟踪系统

轻量级内网专利状态跟踪系统 —— 五阶段流水线(草案 → 可专利性审查 → 专利实施 → 专利检索 → DOI 撰写),同行审查门禁、阶段级版本控制、可配置 KPI,为几十人研发团队设计。

特性一览:私有/团队/公开三级可见性(私有对 GL/PL 完全透明且锁定草案阶段)· reviewer 邀请制审查门禁(人数、加权下限、维度权重均可由 GL 配置)· 阶段默认周期自动排期 · 阶段数据只增不改的版本快照 · 专利归档(完成/放弃,只读可恢复)· 共同发明人与专利转交(单件 / 批量 / 离职交接)· 审查轮次 · GL/PL 阶段趋势折线统计 · 个人中心(API Token 自助、通知偏好、新建默认值)· 成员管理与数据导出(JSON/CSV)· SSO / 通知回调 / KPI 自由计分钩子均按接口预留。

本仓库当前包含:

- **`src/`** — 高保真可交互 UI Demo(React + TypeScript + Vite + Tailwind,纯前端 mock 数据,支持四身份视角切换:普通用户 / PL / GL / Reviewer)
- **`docs/01-用户需求.md`** — 原始需求
- **`docs/02-设计方案与答疑.md`** — 架构设计讨论稿(含 SSO 解耦、通知三级配置、KPI 引擎、API 概览)与 17 条需求答疑决策

## 运行 Demo

```bash
npm install
npm run dev        # 开发预览
npm run build      # 产物在 dist/
```

## 后端(规划)

FastAPI + aiosqlite(WAL + 乐观锁),单进程内网部署;SSO 走 `IdentityProvider` 接口、通知走 `Notifier` 回调接口,详见 `docs/02`。
