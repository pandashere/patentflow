import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useStore, teamName } from '@/lib/store'
import { STAGES, type StageKey, type Visibility } from '@/lib/types'
import { DueChip, SectionTitle, StagePill, VisibilityTag, ArchivedBadge } from '@/components/pf'
import type { Page } from '@/components/AppShell'
import { Plus, Search } from 'lucide-react'

type Scope = 'mine' | 'team' | 'all' | 'archived'

export default function PatentList({ navigate, initialStage }: { navigate: (p: Page) => void; initialStage?: StageKey }) {
  const { me, visiblePatents, createPatent, userById, prefs } = useStore()
  const [scope, setScope] = useState<Scope>(initialStage ? 'all' : me.role === 'user' ? 'mine' : 'all')
  const [stage, setStage] = useState<StageKey | ''>(initialStage ?? '')
  const [vis, setVis] = useState<Visibility | ''>('')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newVis, setNewVis] = useState<Visibility>(prefs.defaultVisibility)

  const visible = visiblePatents()

  const list = useMemo(
    () =>
      visible.filter((p) => {
        if (scope === 'archived') {
          if (!p.archived) return false
        } else {
          if (p.archived) return false // 归档专利只在「已归档」页签出现
          if (scope === 'mine' && p.ownerId !== me.id && !p.collaborators.includes(me.id)) return false
          if (scope === 'team' && p.teamId !== me.teamId) return false
        }
        if (stage && p.stage !== stage) return false
        if (vis && p.visibility !== vis) return false
        if (q && !p.title.includes(q) && !p.code.includes(q)) return false
        return true
      }),
    [visible, scope, stage, vis, q, me.id, me.teamId],
  )

  const scopeTabs: { key: Scope; label: string }[] = [
    { key: 'mine', label: '我的' },
    { key: 'team', label: me.role === 'user' ? '本组' : '本组/团队' },
    { key: 'all', label: '全部可见' },
    { key: 'archived', label: '已归档' },
  ]

  return (
    <div className="mx-auto max-w-6xl">
      <SectionTitle
        page
        en="PATENTS"
        zh="专利库"
        right={
          <button
            type="button"
            onClick={() => { setCreating(true); setNewTitle(''); setNewVis(prefs.defaultVisibility) }}
            className="flex items-center gap-1.5 rounded-md bg-[#12141f] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            <Plus className="size-4" />
            新建专利草案
          </button>
        }
      />

      {/* 过滤器 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border bg-card p-0.5">
          {scopeTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setScope(t.key)}
              className={cn(
                'rounded px-3.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
                scope === t.key ? 'bg-[#12141f] font-medium text-white' : 'text-slate-600 hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <select
          value={stage}
          onChange={(e) => setStage(e.target.value as StageKey | '')}
          className="rounded-md border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-teal-600"
          aria-label="按阶段筛选"
        >
          <option value="">全部阶段</option>
          {STAGES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>

        <select
          value={vis}
          onChange={(e) => setVis(e.target.value as Visibility | '')}
          className="rounded-md border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-teal-600"
          aria-label="按可见性筛选"
        >
          <option value="">全部可见性</option>
          <option value="private">私有</option>
          <option value="team">团队可见</option>
          <option value="public">公开</option>
        </select>

        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题 / 编号"
            className="w-56 rounded-md border bg-card py-2 pl-8 pr-3 text-[13px] outline-none transition-shadow focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
          />
        </div>
      </div>

      {/* 列表 */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b bg-slate-50/70 text-left">
              <th className="w-28 px-4 py-2.5 ui-label text-slate-500">编号</th>
              <th className="px-4 py-2.5 ui-label text-slate-500">标题</th>
              <th className="w-20 px-4 py-2.5 ui-label text-slate-500">负责人</th>
              <th className="w-28 px-4 py-2.5 ui-label text-slate-500">团队</th>
              <th className="w-24 px-4 py-2.5 ui-label text-slate-500">可见性</th>
              <th className="w-32 px-4 py-2.5 ui-label text-slate-500">当前阶段</th>
              <th className="w-44 px-4 py-2.5 ui-label text-slate-500">当前截止</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.map((p) => (
              <tr
                key={p.id}
                onClick={() => navigate({ name: 'patent', id: p.id })}
                className="cursor-pointer transition-colors hover:bg-teal-50/40"
              >
                <td className="px-4 py-3 font-mono-x text-xs text-slate-500">{p.code}</td>
                <td className="truncate px-4 py-3 font-medium" title={p.title}>{p.title}</td>
                <td className="whitespace-nowrap px-4 py-3 text-[13px]">{userById(p.ownerId).name}</td>
                <td className="whitespace-nowrap px-4 py-3 text-[13px] text-muted-foreground">{teamName(p.teamId)}</td>
                <td className="px-4 py-3"><VisibilityTag v={p.visibility} /></td>
                <td className="px-4 py-3">
                  {p.archived ? <ArchivedBadge kind={p.archived.kind} /> : <StagePill stage={p.stage} />}
                </td>
                <td className="px-4 py-3"><DueChip date={p.dueDates[p.stage]} /></td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-14 text-center text-sm text-muted-foreground">
                  当前筛选与权限范围内没有专利。
                  {scope !== 'mine' && ' 注意:私有专利仅发明人本人可见。'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        共 {list.length} 条 · 数据范围已按「{scopeNote(me.role)}」权限过滤,私有专利对 GL 同样不可见
      </p>

      {/* 新建草案 */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setCreating(false)}>
          <div
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3 className="font-bold">新建专利草案</h3>
            <p className="mt-1 text-xs text-muted-foreground">创建后进入「草案」阶段。默认可见性可在个人中心修改。</p>
            <label className="mt-4 block">
              <span className="ui-label text-slate-500">标题</span>
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="一句话描述你的发明构思"
                className="mt-1.5 w-full rounded-md border px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
              />
            </label>
            <div className="mt-3">
              <span className="ui-label text-slate-500">可见性</span>
              <div className="mt-1.5 flex gap-2">
                {(['private', 'team', 'public'] as Visibility[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setNewVis(v)}
                    className={cn(
                      'flex-1 rounded-md border px-3 py-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
                      newVis === v ? 'border-[#12141f] bg-[#12141f] font-medium text-white' : 'text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {v === 'private' ? '私有' : v === 'team' ? '团队可见' : '公开'}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {newVis === 'private'
                  ? '私有:只有你自己可见,不进入任何统计;但只能停留在草案阶段,提交审查前需改为团队/公开,且之后不能再改回私有。'
                  : newVis === 'team'
                    ? '团队可见:本组成员、本组 PL 与 GL 可见。'
                    : '公开:全员只读可见。'}
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">
                取消
              </button>
              <button
                type="button"
                disabled={!newTitle.trim()}
                onClick={() => {
                  const id = createPatent(newTitle.trim(), newVis)
                  setCreating(false)
                  navigate({ name: 'patent', id })
                }}
                className="rounded-md bg-[#12141f] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function scopeNote(role: string) {
  if (role === 'gl') return 'GL · 全部团队'
  if (role === 'pl') return 'PL · 本组'
  return '个人'
}
