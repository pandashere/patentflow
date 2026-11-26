import { useState } from 'react'
import { cn } from '@/lib/utils'
import { computeKpi, firstReach, teamName, today, useStore } from '@/lib/store'
import { TEAMS } from '@/lib/data'
import { STAGES, stageLabel, type KpiRule, type KpiScoring, type StageKey } from '@/lib/types'
import { SectionTitle, StagePill } from '@/components/pf'
import { Check, Code2, Pause, Pencil, Play, Plus, X } from 'lucide-react'

export default function Kpi() {
  const { me, kpiRules, patents, transitions, saveKpiRule, toggleKpiRule, userById, cycles, config, snapshots, activeCycle } = useStore()
  const canManage = me.role === 'gl' || me.role === 'pl'
  const [editing, setEditing] = useState<KpiRule | null>(null)
  const [openReport, setOpenReport] = useState<string | null>(null)
  const defaultCycleId = activeCycle()?.id ?? cycles[0]?.id ?? ''

  const myRules = kpiRules.filter((r) => {
    if (me.role === 'gl') return true
    if (r.scope.type === 'global') return true
    return r.scope.teamId === me.teamId
  })

  return (
    <div className="mx-auto max-w-6xl">
      <SectionTitle
        page
        en="KPI RULES"
        zh="KPI 管理"
        right={
          canManage && (
            <button
              type="button"
              onClick={() =>
                setEditing({
                  id: `k${Date.now()}`,
                  name: '',
                  scope: { type: me.role === 'gl' ? 'global' : 'team', teamId: me.role === 'pl' ? me.teamId : undefined },
                  cycleId: defaultCycleId,
                  targets: [{ stage: 'patentability', deadline: '2026-12-31' }],
                  scoring: { mode: 'ratio' },
                  scorerHook: null,
                  enabled: true,
                  updatedAt: '',
                  createdBy: me.id,
                })
              }
              className="flex items-center gap-1.5 rounded-md bg-[#12141f] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              <Plus className="size-4" />
              新建规则
            </button>
          )
        }
      />

      <MyContribution />

      <h2 className="mb-3 mt-8 text-base font-semibold tracking-tight">全部规则</h2>
      <div className="space-y-4">
        {myRules.map((r) => {
          const rc = cycles.find((c) => c.id === r.cycleId)
          const snap = snapshots.find((s) => s.ruleId === r.id)
          // 周期已收口:展示冻结快照,不再实时计算
          const report = rc?.status === 'closed' && snap
            ? { rule: r, items: snap.items, overall: snap.overall }
            : computeKpi(r, patents, transitions, cycles, config)
          const frozen = rc?.status === 'closed'
          const pct = Math.round(report.overall * 100)
          const open = openReport === r.id
          return (
            <div key={r.id} className={cn('rounded-lg border bg-card', !r.enabled && 'opacity-70')}>
              <div className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{r.name}</span>
                    {!r.enabled && (
                      <span className="rounded bg-slate-200 px-1.5 py-px text-[10px] font-medium text-slate-500">已停用</span>
                    )}
                    {r.scorerHook && (
                      <span className="flex items-center gap-1 rounded bg-violet-50 px-1.5 py-px font-mono-x text-[10px] text-violet-700">
                        <Code2 className="size-3" />
                        {r.scorerHook}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{r.scope.type === 'global' ? '范围:全员' : `范围:${teamName(r.scope.teamId!)}`}</span>
                    <span>
                      周期:{rc ? `${rc.name}(${rc.start} ~ ${rc.end})` : '未绑定'}
                      {frozen && <span className="ml-1 rounded bg-slate-200 px-1 py-px text-[10px] text-slate-500">已收口冻结</span>}
                    </span>
                    <span>
                      目标:{r.targets.map((t) => `${stageLabel(t.stage)} @ ${t.deadline}`).join(' + ')}
                    </span>
                    <span>计分:{scoringLabel(r.scoring)}</span>
                    {r.updatedAt && <span>更新于 {r.updatedAt}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn('font-mono-x text-2xl font-bold', r.enabled ? 'text-teal-700' : 'text-slate-400')}>{pct}%</div>
                  <div className="text-[10px] text-muted-foreground">
                    {r.scoring.mode === 'tiered' ? `达成 ${'fullyAchieved' in report ? report.fullyAchieved : report.items.filter((i) => i.score === 1).length} 件 · 档位得分` : '平均达成率'}
                  </div>
                </div>
                <div className="flex gap-2">
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleKpiRule(r.id)}
                        title={r.enabled ? '停用后不参与仪表盘统计,历史数据保留' : '重新启用'}
                        className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                      >
                        {r.enabled ? <Pause className="size-3" /> : <Play className="size-3" />}
                        {r.enabled ? '停用' : '启用'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing({ ...r })}
                        className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                      >
                        <Pencil className="size-3" />
                        编辑
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpenReport(open ? null : r.id)}
                    className="rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                  >
                    {open ? '收起明细' : '查看明细'}
                  </button>
                </div>
              </div>
              <div className="mx-5 h-1.5 rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-teal-600 transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>

              {open && (
                <div className="mt-4 border-t px-5 py-4">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2 pr-4 ui-label text-slate-500">专利</th>
                        <th className="py-2 pr-4 ui-label text-slate-500">负责人</th>
                        <th className="py-2 pr-4 ui-label text-slate-500">当前阶段</th>
                        {r.targets.map((t, i) => (
                          <th key={i} className="py-2 pr-4 ui-label text-slate-500">
                            {stageLabel(t.stage)}
                            <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">≤{t.deadline.slice(5)}</span>
                          </th>
                        ))}
                        <th className="py-2 ui-label text-slate-500">得分</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {report.items.map((it) => (
                        <tr key={it.patentId}>
                          <td className="max-w-0 truncate py-2.5 pr-4 font-medium">{it.title}</td>
                          <td className="py-2.5 pr-4 text-muted-foreground">{userById(it.ownerId).name}</td>
                          <td className="py-2.5 pr-4"><StagePill stage={it.currentStage} /></td>
                          {it.achievedTargets.map((a, i) => (
                            <td key={i} className="py-2.5 pr-4">
                              {a
                                ? <Check className="size-4 text-teal-600" />
                                : <X className="size-4 text-slate-300" />}
                            </td>
                          ))}
                          <td className="py-2.5 font-mono-x font-bold text-teal-700">
                            {Math.round(it.score * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-3 text-[11px] leading-snug text-slate-400">
                    {frozen
                      ? '该周期已收口,以上数字为收口时刻的冻结快照,不再随后续流转变化。'
                      : '事件口径:统计周期窗口内「到达过」目标阶段的流转事件,与专利创建时间无关;跨周期项目各记各的、无双计。'}
                    只认「首次推进到达」事件:回退、归档、恢复归档都不计;私有专利不进入统计。
                    计分方式:{scoringLabel(r.scoring)}。配置 scorerHook 后改由回调 compute_item / compute_kpi 计算。
                  </p>
                </div>
              )}
              <div className="h-4" />
            </div>
          )
        })}
      </div>

      {editing && (
        <KpiEditor
          rule={editing}
          isGl={me.role === 'gl'}
          onSave={(r) => { saveKpiRule(r); setEditing(null) }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function KpiEditor({
  rule, isGl, onSave, onClose,
}: {
  rule: KpiRule
  isGl: boolean
  onSave: (r: KpiRule) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<KpiRule>(rule)
  const { cycles } = useStore()
  const boundCycle = cycles.find((c) => c.id === form.cycleId)
  const deadlineOverflow = boundCycle ? form.targets.filter((t) => t.deadline > boundCycle.end) : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="ui-label text-teal-700">KPI RULE</div>
        <h3 className="mt-0.5 font-bold">{rule.name ? '编辑规则' : '新建规则'}</h3>

        <div className="mt-4 space-y-4">
          <div>
            <label className="ui-label text-slate-500">规则名称</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如:2026 H2 · 平台技术组推进"
              className="mt-1.5 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ui-label text-slate-500">考核范围</label>
              <select
                value={form.scope.type === 'global' ? 'global' : form.scope.teamId}
                disabled={!isGl}
                onChange={(e) =>
                  setForm({
                    ...form,
                    scope: e.target.value === 'global'
                      ? { type: 'global' }
                      : { type: 'team', teamId: e.target.value },
                  })
                }
                className="mt-1.5 w-full rounded-md border bg-white px-2.5 py-2 text-sm outline-none focus:border-teal-600 disabled:bg-slate-50"
              >
                {isGl && <option value="global">全员</option>}
                {TEAMS.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="ui-label text-slate-500">绑定专利周期</label>
              <select
                value={form.cycleId}
                onChange={(e) => setForm({ ...form, cycleId: e.target.value })}
                className="mt-1.5 w-full rounded-md border bg-white px-2.5 py-2 text-sm outline-none focus:border-teal-600"
              >
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}({c.start} ~ {c.end}){c.status === 'closed' ? '·已收口' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="ui-label text-slate-500">目标节点(阶段 × 截止日)</label>
              <button
                type="button"
                onClick={() => setForm({ ...form, targets: [...form.targets, { stage: 'draft', deadline: '2026-12-31' }] })}
                className="text-xs text-teal-700 hover:underline"
              >
                + 添加目标
              </button>
            </div>
            <div className="mt-1.5 space-y-2">
              {form.targets.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={t.stage}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        targets: form.targets.map((x, j) => (j === i ? { ...x, stage: e.target.value as StageKey } : x)),
                      })
                    }
                    className="flex-1 rounded-md border bg-white px-2.5 py-2 text-sm outline-none focus:border-teal-600"
                  >
                    {STAGES.map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                  <span className="text-xs text-slate-400">前到达</span>
                  <input
                    type="date"
                    value={t.deadline}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        targets: form.targets.map((x, j) => (j === i ? { ...x, deadline: e.target.value } : x)),
                      })
                    }
                    className="rounded-md border px-2.5 py-2 text-sm outline-none focus:border-teal-600"
                  />
                  <button
                    type="button"
                    disabled={form.targets.length <= 1}
                    onClick={() => setForm({ ...form, targets: form.targets.filter((_, j) => j !== i) })}
                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                    aria-label="删除目标"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {deadlineOverflow.length > 0 && boundCycle && (
              <p className="mt-1.5 text-[11px] text-red-600">
                {deadlineOverflow.length} 个目标的截止日晚于周期结束日({boundCycle.end}),保存时将按周期结束日截断。
              </p>
            )}
          </div>

          <ScoringEditor scoring={form.scoring} onChange={(scoring) => setForm({ ...form, scoring })} />

          <div>
            <label className="ui-label text-slate-500">自定义评分回调(可选)</label>
            <input
              value={form.scorerHook ?? ''}
              onChange={(e) => setForm({ ...form, scorerHook: e.target.value || null })}
              placeholder="如:custom_scorer.py:weighted_score(留空 = 使用上面的计分方式)"
              className="mt-1.5 w-full rounded-md border px-3 py-2 font-mono-x text-xs outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t pt-4">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">
            取消
          </button>
          <button
            type="button"
            disabled={!form.name.trim() || !form.cycleId}
            onClick={() =>
              onSave(
                boundCycle
                  ? { ...form, targets: form.targets.map((t) => ({ ...t, deadline: t.deadline > boundCycle.end ? boundCycle.end : t.deadline })) }
                  : form,
              )
            }
            className={cn('rounded-md bg-[#12141f] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40')}
          >
            保存规则
          </button>
        </div>
      </div>
    </div>
  )
}

function scoringLabel(sc: KpiScoring) {
  if (sc.mode === 'ratio') return '按比例(达成目标数 / 目标总数,取均值)'
  const tiers = [...sc.tiers].sort((a, b) => b.minCount - a.minCount)
  return `分段阈值(${tiers.map((t) => `≥${t.minCount} 件 → ${Math.round(t.score * 100)}%`).join(',')},否则 ${Math.round(sc.elseScore * 100)}%)`
}

function ScoringEditor({ scoring, onChange }: { scoring: KpiScoring; onChange: (s: KpiScoring) => void }) {
  const tiered = scoring.mode === 'tiered' ? scoring : null
  const numCls = 'w-16 rounded-md border px-2 py-1.5 text-center font-mono-x text-sm outline-none focus:border-teal-600'
  return (
    <div>
      <label className="ui-label text-slate-500">计分方式</label>
      <div className="mt-1.5 flex gap-2">
        {([
          ['ratio', '按比例', '每件专利按达成目标比例得分,取平均'],
          ['tiered', '分段阈值', '「全部目标达成」的件数落档,如 ≥8 件 100%'],
        ] as const).map(([m, label, desc]) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m === 'ratio' ? { mode: 'ratio' } : { mode: 'tiered', tiers: [{ minCount: 5, score: 1 }, { minCount: 3, score: 0.6 }], elseScore: 0 })}
            className={cn(
              'flex-1 rounded-md border px-3 py-2 text-left transition-colors',
              scoring.mode === m ? 'border-[#12141f] bg-[#12141f] text-white' : 'text-slate-600 hover:bg-slate-50',
            )}
          >
            <span className="block text-[13px] font-medium">{label}</span>
            <span className={cn('block text-[11px]', scoring.mode === m ? 'text-slate-300' : 'text-slate-400')}>{desc}</span>
          </button>
        ))}
      </div>
      {tiered && (
        <div className="mt-2.5 space-y-2 rounded-md border bg-slate-50/60 p-3 text-[13px]">
          {tiered.tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-slate-500">达成 ≥</span>
              <input
                type="number" min={0} value={t.minCount} className={numCls}
                onChange={(e) => onChange({ ...tiered, tiers: tiered.tiers.map((x, j) => (j === i ? { ...x, minCount: Math.max(0, Number(e.target.value)) } : x)) })}
              />
              <span className="text-slate-500">件,得分</span>
              <input
                type="number" min={0} max={100} value={Math.round(t.score * 100)} className={numCls}
                onChange={(e) => onChange({ ...tiered, tiers: tiered.tiers.map((x, j) => (j === i ? { ...x, score: Math.min(100, Math.max(0, Number(e.target.value))) / 100 } : x)) })}
              />
              <span className="text-slate-500">%</span>
              <button
                type="button"
                disabled={tiered.tiers.length <= 1}
                onClick={() => onChange({ ...tiered, tiers: tiered.tiers.filter((_, j) => j !== i) })}
                className="ml-auto rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                aria-label="删除档位"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 border-t pt-2">
            <span className="text-slate-500">否则得分</span>
            <input
              type="number" min={0} max={100} value={Math.round(tiered.elseScore * 100)} className={numCls}
              onChange={(e) => onChange({ ...tiered, elseScore: Math.min(100, Math.max(0, Number(e.target.value))) / 100 })}
            />
            <span className="text-slate-500">%</span>
            <button
              type="button"
              onClick={() => onChange({ ...tiered, tiers: [...tiered.tiers, { minCount: 1, score: 0.3 }] })}
              className="ml-auto text-xs text-teal-700 hover:underline"
            >
              + 添加档位
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// —— 我的贡献:我名下(负责人/共同发明人)哪些专利计入 KPI、每件还差哪个节点 ——
function MyContribution() {
  const { me, kpiRules, patents, transitions, cycles, config } = useStore()
  const rules = kpiRules.filter((r) => r.enabled && (r.scope.type === 'global' || r.scope.teamId === me.teamId))
  const rows = rules.flatMap((r) => {
    const report = computeKpi(r, patents, transitions, cycles, config)
    return report.items
      .filter((it) => it.ownerId === me.id || it.collaborators.includes(me.id))
      .map((it) => ({ r, it }))
  })

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">我的贡献</h2>
        <span className="text-xs text-muted-foreground">你作为负责人或共同发明人、计入 KPI 的专利</span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">当前没有计入 KPI 的专利。私有专利不进入统计,提交审查前请先改为团队可见。</p>
      ) : (
        <table className="mt-3 w-full table-fixed text-[13px]">
          <thead>
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="w-[30%] py-2 pr-4 font-medium">专利</th>
              <th className="w-[20%] py-2 pr-4 font-medium">规则</th>
              <th className="w-[14%] py-2 pr-4 font-medium">当前阶段</th>
              <th className="py-2 font-medium">进度 / 下一个节点</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ r, it }) => {
              const nextIdx = it.achievedTargets.findIndex((a) => !a)
              const next = nextIdx >= 0 ? r.targets[nextIdx] : null
              const cycle = cycles.find((c) => c.id === r.cycleId)
              const reachedAt = next && cycle ? firstReach(it.patentId, next.stage, transitions) : undefined
              return (
                <tr key={`${r.id}-${it.patentId}`}>
                  <td className="truncate py-2.5 pr-4 font-medium" title={it.title}>{it.title}</td>
                  <td className="truncate py-2.5 pr-4 text-xs text-muted-foreground" title={r.name}>{r.name}</td>
                  <td className="py-2.5 pr-4"><StagePill stage={it.currentStage} /></td>
                  <td className="py-2.5 text-xs">
                    <span className="mr-2 font-mono-x font-bold text-teal-700">
                      {it.achievedTargets.filter(Boolean).length}/{r.targets.length}
                    </span>
                    {next ? (
                      reachedAt && cycle && reachedAt < cycle.start
                        ? <span className="text-slate-500">「{stageLabel(next.stage)}」已在往期周期到达,本周期不重复计</span>
                        : reachedAt
                          ? <span className="text-slate-500">{reachedAt} 才到达「{stageLabel(next.stage)}」,晚于截止 {next.deadline}</span>
                          : next.deadline < today()
                            ? <span className="text-red-600">已过截止 {next.deadline},未到达「{stageLabel(next.stage)}」</span>
                            : <span className="text-amber-700">{next.deadline} 前推进到「{stageLabel(next.stage)}」</span>
                    ) : (
                      <span className="text-teal-700">全部达成</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
