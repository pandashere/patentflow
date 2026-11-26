import { useState } from 'react'
import { cn } from '@/lib/utils'
import { computeKpi, teamName, useStore } from '@/lib/store'
import { TEAMS } from '@/lib/data'
import { STAGES, stageLabel, type KpiRule, type StageKey } from '@/lib/types'
import { SectionTitle, StagePill } from '@/components/pf'
import { Check, Code2, Pause, Pencil, Play, Plus, X } from 'lucide-react'

export default function Kpi() {
  const { me, kpiRules, patents, transitions, saveKpiRule, toggleKpiRule, userById } = useStore()
  const canManage = me.role === 'gl' || me.role === 'pl'
  const [editing, setEditing] = useState<KpiRule | null>(null)
  const [openReport, setOpenReport] = useState<string | null>(null)

  const myRules = kpiRules.filter((r) => {
    if (me.role === 'gl') return true
    if (r.scope.type === 'global') return true
    return r.scope.teamId === me.teamId
  })

  return (
    <div className="mx-auto max-w-5xl">
      <SectionTitle
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
                  windowStart: '2026-07-01',
                  targets: [{ stage: 'patentability', deadline: '2026-12-31' }],
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

      <div className="space-y-4">
        {myRules.map((r) => {
          const report = computeKpi(r, patents, transitions)
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
                    <span>基准:自 {r.windowStart} 起在册专利</span>
                    <span>
                      目标:{r.targets.map((t) => `${stageLabel(t.stage)} @ ${t.deadline}`).join(' + ')}
                    </span>
                    {r.updatedAt && <span>更新于 {r.updatedAt}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn('font-mono-x text-2xl font-bold', r.enabled ? 'text-teal-700' : 'text-slate-400')}>{pct}%</div>
                  <div className="text-[10px] text-muted-foreground">平均达成率</div>
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
                    默认评分器:得分 = 已达成目标数 / 目标总数(「到达过」即算,不受后续回退影响)。
                    配置 scorerHook 后由你的回调计算单项与整体得分 —— 对应后端 KPI 引擎的 compute_item / compute_kpi 两个回调点。
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
              <label className="ui-label text-slate-500">基准起始日</label>
              <input
                type="date"
                value={form.windowStart}
                onChange={(e) => setForm({ ...form, windowStart: e.target.value })}
                className="mt-1.5 w-full rounded-md border px-2.5 py-2 text-sm outline-none focus:border-teal-600"
              />
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
          </div>

          <div>
            <label className="ui-label text-slate-500">自定义评分回调(可选)</label>
            <input
              value={form.scorerHook ?? ''}
              onChange={(e) => setForm({ ...form, scorerHook: e.target.value || null })}
              placeholder="如:custom_scorer.py:weighted_score(留空 = 默认按比例给分)"
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
            disabled={!form.name.trim()}
            onClick={() => onSave(form)}
            className={cn('rounded-md bg-[#12141f] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40')}
          >
            保存规则
          </button>
        </div>
      </div>
    </div>
  )
}
