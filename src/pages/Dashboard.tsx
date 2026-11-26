import { useMemo } from 'react'
import { useStore, computeKpi, computeStageTrend, monthRange, teamName } from '@/lib/store'
import { STAGES, stageIndex, stageLabel, type Patent } from '@/lib/types'
import { DueChip, SectionTitle, StagePill, StageTrendChart, VisibilityTag, STAGE_COLOR } from '@/components/pf'
import type { Page } from '@/components/AppShell'
import { AlertTriangle, ArrowRight, ClipboardCheck, Hourglass } from 'lucide-react'

const TODAY = new Date('2026-11-26')

function daysUntil(d?: string) {
  if (!d) return Infinity
  return Math.ceil((new Date(d).getTime() - TODAY.getTime()) / 86400000)
}

export default function Dashboard({ navigate }: { navigate: (p: Page) => void }) {
  const { me, persona, visiblePatents, kpiRules, patents, transitions, userById, cycles, config, activeCycle, stageOverdueDays, closingRisk, reviewExtension } = useStore()
  const visible = visiblePatents()
  const active = visible.filter((p) => !p.archived) // 归档专利退出流水线视图
  const cycle = activeCycle()

  // 逾期/收口/延期审批(纯派生;PL 只管本组)
  const pendingExts = active
    .filter((p) => me.role === 'gl' || p.teamId === me.teamId)
    .flatMap((p) => p.extensions.filter((e) => e.status === 'pending').map((e) => ({ p, e })))
  const overdueRows = active
    .map((p) => ({ p, days: stageOverdueDays(p) }))
    .filter((r) => r.days > 0)
    .sort((a, b) => b.days - a.days)
  const buckets = [
    overdueRows.filter((r) => r.days <= 7),
    overdueRows.filter((r) => r.days >= 8 && r.days <= 14),
    overdueRows.filter((r) => r.days >= 15),
  ]
  const riskRows = active.map((p) => ({ p, risk: closingRisk(p) })).filter((r) => r.risk)
  const doomed = riskRows.filter((r) => r.risk === 'doomed')
  const tightCount = riskRows.filter((r) => r.risk === 'tight').length
  const cycleDaysLeft = cycle
    ? Math.max(0, Math.floor((Date.parse(cycle.end) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000))
    : null
  const lastActivity = (pid: string) => {
    const ts = transitions.filter((t) => t.patentId === pid)
    return ts.length ? ts[ts.length - 1].at.slice(0, 10) : '—'
  }

  // 待我审查:我是 reviewer 且尚未提交
  const myReviews = useMemo(
    () =>
      patents.filter((p) =>
        p.stageData.patentability.reviewers.some((r) => r.userId === me.id && !r.score),
      ),
    [patents, me.id],
  )

  // 临期:可见专利里任一阶段 due ≤ 14 天或已逾期
  const upcoming = useMemo(() => {
    const list: { p: Patent; stage: string; date: string; days: number }[] = []
    for (const p of active) {
      for (const [k, d] of Object.entries(p.dueDates)) {
        const days = daysUntil(d)
        if (d && days <= 14 && stageIndex(k as never) >= stageIndex(p.stage)) {
          list.push({ p, stage: stageLabel(k as never), date: d, days })
        }
      }
    }
    return list.sort((a, b) => a.days - b.days)
  }, [active])

  const myPatents = active.filter((p) => p.ownerId === me.id || p.collaborators.includes(me.id))
  const stageCounts = STAGES.map((s) => ({
    ...s,
    count: active.filter((p) => p.stage === s.key).length,
  }))

  const myKpiRules = kpiRules.filter((r) => {
    if (!r.enabled) return false // 停用的规则不进仪表盘
    if (me.role === 'gl') return true
    if (r.scope.type === 'global') return true
    return r.scope.teamId === me.teamId
  })

  // GL/PL 统计视图:各阶段数量随时间的趋势
  // 范围:PL 看本组;GL 看全部可见(private 完全透明,不进入统计)
  const isManager = me.role === 'pl' || me.role === 'gl'
  const trend = useMemo(() => {
    if (!isManager) return null
    const scoped = me.role === 'gl' ? active : active.filter((p) => p.teamId === me.teamId)
    const earliest = scoped.reduce((a, p) => (p.createdAt < a ? p.createdAt : a), '2026-11-26')
    const months = monthRange(earliest.slice(0, 7), '2026-11')
    return {
      points: computeStageTrend(scoped, transitions, months),
      scopeLabel: me.role === 'gl' ? '全局(不含 private)' : teamName(me.teamId),
    }
  }, [isManager, me.role, me.teamId, active, transitions])

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* 欢迎行 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="ui-label text-teal-700">
            {new Date().toISOString().slice(0, 10)} · {persona.label}视角
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {me.name},今天有 {myReviews.length} 项审查、{upcoming.filter((u) => u.days <= 7).length} 个临近截止
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {me.role === 'gl' ? '你正在查看全部团队的公开与团队可见专利(private 仅发明人可见)。'
              : me.role === 'pl' ? `你正在查看「${teamName(me.teamId)}」及公开专利。`
              : persona.asReviewer ? '你可以查看全部公开专利,以及被邀请审查的专利。'
              : '你可以查看自己的专利、本组团队专利与全部公开专利。'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate({ name: 'patents' })}
          className="flex items-center gap-1.5 rounded-md bg-[#12141f] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          进入专利库
          <ArrowRight className="size-4" />
        </button>
      </div>

      {/* 阶段漏斗 */}
      <section>
        <SectionTitle en="PIPELINE" zh="阶段分布" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {stageCounts.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => navigate({ name: 'patents' })}
              className="rounded-lg border bg-card p-4 text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              <div className="font-mono-x text-[10px] tracking-widest" style={{ color: STAGE_COLOR[s.key] }}>
                {s.en}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono-x text-3xl font-bold" style={{ color: STAGE_COLOR[s.key] }}>
                  {s.count}
                </span>
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <div className="mt-2.5 h-1 rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${active.length ? (s.count / active.length) * 100 : 0}%`,
                    backgroundColor: STAGE_COLOR[s.key],
                  }}
                />
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* GL/PL:阶段数量趋势 */}
      {trend && (
        <section>
          <SectionTitle
            en="TREND"
            zh="阶段数量趋势"
            right={<span className="text-xs text-muted-foreground">统计范围:{trend.scopeLabel}</span>}
          />
          <div className="rounded-lg border bg-card p-5">
            <StageTrendChart points={trend.points} />
            <p className="mt-2 border-t pt-2.5 text-[11px] text-slate-400">
              由阶段流转记录回放生成:回退会真实反映在曲线上(如 11 月可专利性审查 +1 来自打回后的重新提交)。
            </p>
          </div>
        </section>
      )}

      {/* GL/PL:逾期与收口 */}
      {isManager && cycle && (
        <section>
          <SectionTitle
            en="OVERDUE"
            zh="逾期与收口"
            right={
              <span className="text-xs text-muted-foreground">
                {cycle.name} 收口 {cycle.end} · 剩 {cycleDaysLeft} 天
              </span>
            }
          />
          <div className="space-y-4 rounded-lg border bg-card p-5">
            {pendingExts.length > 0 && (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
                <div className="text-xs font-medium text-amber-700">延期审批待办({pendingExts.length})</div>
                {pendingExts.map(({ p, e }) => (
                  <div key={e.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => navigate({ name: 'patent', id: p.id })}
                    >
                      {p.title}
                    </button>
                    <span className="text-muted-foreground">
                      {stageLabel(e.stage)} {e.oldDue} → {e.newDue} · {userById(e.by).name} · {e.reason || '无说明'}
                    </span>
                    <button
                      type="button"
                      className="rounded border border-teal-600 px-2 py-0.5 text-teal-700 hover:bg-teal-50"
                      onClick={() => reviewExtension(p.id, e.id, true)}
                    >
                      批准
                    </button>
                    <button
                      type="button"
                      className="rounded border border-red-300 px-2 py-0.5 text-red-600 hover:bg-red-50"
                      onClick={() => reviewExtension(p.id, e.id, false)}
                    >
                      驳回
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              {(['1–7 天', '8–14 天', '15 天以上'] as const).map((label, i) => (
                <div key={label} className="rounded-md border p-3">
                  <div className={`font-mono-x text-xl font-bold ${i === 0 ? 'text-amber-600' : i === 1 ? 'text-orange-600' : 'text-red-600'}`}>
                    {buckets[i].length}
                  </div>
                  <div className="text-xs text-muted-foreground">逾期 {label}</div>
                </div>
              ))}
            </div>

            {overdueRows.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">专利</th>
                    <th className="pr-3 font-medium">阶段</th>
                    <th className="pr-3 font-medium">负责人</th>
                    <th className="pr-3 font-medium">逾期</th>
                    <th className="pr-3 font-medium">最后活动</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueRows.map(({ p, days }) => (
                    <tr
                      key={p.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-slate-50"
                      onClick={() => navigate({ name: 'patent', id: p.id })}
                    >
                      <td className="max-w-52 truncate py-1.5 pr-3 font-medium">{p.title}</td>
                      <td className="pr-3"><StagePill stage={p.stage} /></td>
                      <td className="pr-3 text-xs text-muted-foreground">{userById(p.ownerId).name}</td>
                      <td className="pr-3 font-medium text-red-600">{days} 天</td>
                      <td className="pr-3 text-xs text-muted-foreground">{lastActivity(p.id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-sm text-muted-foreground">当前没有逾期专利。</div>
            )}

            <div className="border-t pt-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                收口风险:从容 {riskRows.length - doomed.length - tightCount} · 紧张 {tightCount} · 注定逾期 {doomed.length}
              </div>
              {doomed.length > 0 && (
                <div className="space-y-1.5">
                  {doomed.map(({ p }) => (
                    <div
                      key={p.id}
                      className="flex flex-wrap items-center gap-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs"
                    >
                      <button
                        type="button"
                        className="font-medium hover:underline"
                        onClick={() => navigate({ name: 'patent', id: p.id })}
                      >
                        {p.title}
                      </button>
                      <span className="text-muted-foreground">
                        {stageLabel(p.stage)} · 剩余流程预算超过周期剩余天数
                      </span>
                      <span className="font-medium text-red-600">注定逾期</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* 待办 */}
        <section className="lg:col-span-3">
          <SectionTitle en="TODO" zh="待办事项" />
          <div className="divide-y rounded-lg border bg-card">
            {myReviews.map((p) => (
              <button
                key={`r-${p.id}`}
                type="button"
                onClick={() => navigate({ name: 'patent', id: p.id })}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
                  <ClipboardCheck className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    待你审查 · {userById(p.ownerId).name} 提交 · 三维度评分
                  </span>
                </span>
                <StagePill stage={p.stage} />
              </button>
            ))}
            {upcoming.slice(0, 5).map((u) => (
              <button
                key={`${u.p.id}-${u.stage}`}
                type="button"
                onClick={() => navigate({ name: 'patent', id: u.p.id })}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600"
              >
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${u.days < 0 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                  {u.days < 0 ? <AlertTriangle className="size-4" /> : <Hourglass className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{u.p.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{u.stage} 阶段</span>
                </span>
                <DueChip date={u.date} />
              </button>
            ))}
            {myReviews.length === 0 && upcoming.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                没有待办。该写的草案写完了吗?
              </div>
            )}
          </div>
        </section>

        {/* KPI 概览 */}
        <section className="lg:col-span-2">
          <SectionTitle
            en="KPI"
            zh="KPI 达成"
            right={
              <button type="button" onClick={() => navigate({ name: 'kpi' })} className="text-xs text-teal-700 hover:underline">
                管理规则 →
              </button>
            }
          />
          <div className="space-y-3">
            {myKpiRules.map((r) => {
              const report = computeKpi(r, patents, transitions, cycles, config)
              const rc = cycles.find((c) => c.id === r.cycleId)
              const pct = Math.round(report.overall * 100)
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => navigate({ name: 'kpi' })}
                  className="w-full rounded-lg border bg-card p-4 text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{r.name}</span>
                    <span className="font-mono-x text-lg font-bold text-teal-700">{pct}%</span>
                  </div>
                  <div className="mt-2.5 h-1.5 rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-teal-600 transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{r.scope.type === 'global' ? '全员' : teamName(r.scope.teamId!)}</span>
                    <span>·</span>
                    <span>{rc ? `${rc.name}${rc.status === 'closed' ? '(已收口冻结)' : ''}` : '未绑定周期'}</span>
                    <span>·</span>
                    <span>{r.targets.length} 个目标节点</span>
                    {r.scorerHook && (
                      <>
                        <span>·</span>
                        <span className="font-mono-x text-[10px] text-violet-700">自定义评分器</span>
                      </>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* 我的在研 */}
          <div className="mt-6">
            <SectionTitle en="MINE" zh="我的在研" />
            <div className="divide-y rounded-lg border bg-card">
              {myPatents.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                  {persona.asReviewer ? '当前身份暂无自己的专利' : '暂无'}
                </div>
              )}
              {myPatents.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate({ name: 'patent', id: p.id })}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{p.title}</span>
                  {stageOverdueDays(p) > 0 && (
                    <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                      逾期 {stageOverdueDays(p)} 天
                    </span>
                  )}
                  {closingRisk(p) === 'doomed' && (
                    <span className="shrink-0 rounded border border-red-300 px-1.5 py-0.5 text-[10px] text-red-600">收口告急</span>
                  )}
                  {closingRisk(p) === 'tight' && (
                    <span className="shrink-0 rounded border border-amber-300 px-1.5 py-0.5 text-[10px] text-amber-600">收口紧张</span>
                  )}
                  <VisibilityTag v={p.visibility} />
                  <StagePill stage={p.stage} />
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
