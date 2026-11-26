import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useStore, today, daysBetween } from '@/lib/store'
import { TEAMS, teamById } from '@/lib/data'
import {
  NOTIFY_EVENT_LABEL, STAGES, VISIBILITY_LABEL, stageIndex, stageLabel,
  type NotifyEvent, type StageKey, type StageNotifyConfig, type StageVersion, type Visibility,
} from '@/lib/types'
import {
  ArchivedBadge, DueChip, RiskTag, RollbackHint, StageStepper, ToneTag, VisibilityTag,
} from '@/components/pf'
import { DoiPane, DraftPane, MarkdownPane, PatentabilityPane } from './panes'
import type { Page } from '@/components/AppShell'
import {
  AlertTriangle, Archive, ArchiveRestore, ArrowLeft, ArrowRight, ArrowRightLeft, Bell, Building2, CalendarClock,
  GitCommitVertical, History, MoreHorizontal, RotateCcw, Trash2, Users, X,
} from 'lucide-react'

const ALL_EVENTS: NotifyEvent[] = ['review', 'due', 'transition']
const VIS_RANK: Record<Visibility, number> = { private: 0, team: 1, public: 2 }

type Dialog =
  | { kind: 'advance' } | { kind: 'rollback'; to: StageKey } | { kind: 'archive' } | { kind: 'unarchive' }
  | { kind: 'visibility'; to: Visibility } | { kind: 'transfer' } | { kind: 'migrate' } | { kind: 'delete' }
  | { kind: 'extension' } | { kind: 'collab' } | { kind: 'notify' } | { kind: 'compare'; v: StageVersion }

export default function PatentDetail({ id, navigate }: { id: string; navigate: (p: Page) => void }) {
  const store = useStore()
  const { patents, versions, transitions, canEditPatent, canOperatePatent, isReviewerOf, config, userById, me } = store
  const patent = patents.find((p) => p.id === id)

  const [viewStage, setViewStage] = useState<StageKey | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [archiveKind, setArchiveKind] = useState<'completed' | 'abandoned'>('completed')
  const [reason, setReason] = useState('')
  const [transferTo, setTransferTo] = useState('')
  const [keepCollab, setKeepCollab] = useState(true)
  const [migrateTo, setMigrateTo] = useState('')
  const [extDate, setExtDate] = useState('')
  const [extMsg, setExtMsg] = useState('')
  const [rollbackTo, setRollbackTo] = useState<StageKey>('draft')

  const shownStageForHistory = viewStage ?? patent?.stage
  const stageVersions = versions.filter((v) => v.patentId === id && v.stage === shownStageForHistory).slice().reverse()
  const myTransitions = transitions.filter((t) => t.patentId === id).slice().reverse()

  if (!patent) {
    return (
      <div className="mx-auto max-w-3xl py-20 text-center">
        <p className="text-lg font-semibold">该专利不存在,或不在你的可见范围内</p>
        <p className="mt-2 text-sm text-muted-foreground">私有专利仅发明人本人可见;reviewer 仅可见被邀请的专利。</p>
        <button type="button" onClick={() => navigate({ name: 'patents' })} className="mt-5 rounded-md border px-4 py-2 text-sm hover:bg-slate-50">
          返回专利库
        </button>
      </div>
    )
  }

  const editable = canEditPatent(patent) && !patent.archived
  const operable = canOperatePatent(patent) && !patent.archived
  const curIdx = stageIndex(patent.stage)
  const shownStage = viewStage ?? patent.stage
  const shownIdx = stageIndex(shownStage)
  const isReviewer = isReviewerOf(patent) && !patent.archived
  const paneEditable = editable && shownIdx <= curIdx
  const isManagerOfTeam = me.role === 'gl' || (me.role === 'pl' && me.teamId === patent.teamId)

  const leftDraft = store.hasLeftDraft(patent)
  const privateLocked = patent.stage === 'draft' && patent.visibility === 'private'
  const overdueDays = store.stageOverdueDays(patent)
  const cycle = store.cycleOfPatent(patent)
  const cycleDaysLeft = cycle && cycle.status === 'active' ? daysBetween(today(), cycle.end) : null
  const risk = store.closingRisk(patent)
  const overdueFrozen = config.overdue.freezeAdvanceOnOverdue && overdueDays > 0
  const reviewBlocked = patent.stage === 'patentability' && !store.reviewGateOpen(patent)
  const gateBlocked = reviewBlocked || privateLocked || overdueFrozen
  const gateHint = privateLocked
    ? '私有专利只能停留在草案阶段,请先将可见性调整为团队/公开'
    : overdueFrozen
      ? `当前阶段已逾期 ${overdueDays} 天,GL 已开启「逾期冻结推进」—— 请先申请延期`
      : reviewBlocked
        ? store.reviewRejected(patent)
          ? '本轮审查有打回,请修改后发起新一轮审查'
          : `审查门禁未满足:需 ${config.reviewPassCount} 名 reviewer 通过(加权均分 ≥ ${config.reviewMinWeighted})`
        : undefined

  const open = (d: Dialog) => { setDialog(d); setReason(''); setMenuOpen(false) }
  const close = () => setDialog(null)

  // 「更多」菜单:低频操作收纳,主操作只保留 推进 / 回退
  const menu: { label: string; icon: typeof Bell; onClick: () => void; danger?: boolean; show: boolean }[] = [
    { label: '通知设置', icon: Bell, onClick: () => open({ kind: 'notify' }), show: true },
    { label: '共同发明人', icon: Users, onClick: () => open({ kind: 'collab' }), show: operable },
    { label: '转交专利', icon: ArrowRightLeft, onClick: () => { setTransferTo(''); setKeepCollab(true); open({ kind: 'transfer' }) }, show: operable },
    { label: '申请延期', icon: CalendarClock, onClick: () => { setExtDate(''); setExtMsg(''); open({ kind: 'extension' }) }, show: operable && !!patent.dueDates[patent.stage] },
    {
      label: overdueDays > 0 ? `催办(已逾期 ${overdueDays} 天)` : '催办负责人', icon: Bell,
      onClick: () => { store.nudge(patent.id); setMenuOpen(false) },
      show: !patent.archived && isManagerOfTeam && patent.ownerId !== me.id,
    },
    { label: '迁移团队', icon: Building2, onClick: () => { setMigrateTo(''); open({ kind: 'migrate' }) }, show: operable && isManagerOfTeam },
    { label: patent.crossCycle ? '取消跨周期标记' : '标记为跨周期', icon: CalendarClock, onClick: () => { store.toggleCrossCycle(patent.id); setMenuOpen(false) }, show: operable && me.role === 'gl' },
    { label: '归档', icon: Archive, onClick: () => { setArchiveKind(curIdx >= stageIndex('doi') ? 'completed' : 'abandoned'); open({ kind: 'archive' }) }, show: operable },
    { label: '删除专利', icon: Trash2, onClick: () => open({ kind: 'delete' }), danger: true, show: !patent.archived && store.canDeletePatent(patent) },
  ]
  const visibleMenu = menu.filter((m) => m.show)

  return (
    <div className="mx-auto max-w-6xl">
      <button
        type="button"
        onClick={() => navigate({ name: 'patents' })}
        className="mb-3 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        返回专利库
      </button>

      {/* 头部 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-mono-x">{patent.code}</span>
            <span>·</span>
            <span>创建于 {patent.createdAt}</span>
            {operable ? (
              <select
                value={patent.visibility}
                onChange={(e) => {
                  const v = e.target.value as Visibility
                  // 放宽可见性 = 内容暴露给更多人,需要确认;收紧直接生效
                  if (VIS_RANK[v] > VIS_RANK[patent.visibility]) open({ kind: 'visibility', to: v })
                  else store.setVisibility(patent.id, v)
                }}
                className="cursor-pointer rounded border bg-white px-1.5 py-px text-[11px] text-slate-700 outline-none focus:border-teal-600"
                aria-label="修改可见性"
                title={leftDraft ? '已离开过草案,不能再设为私有' : undefined}
              >
                <option value="private" disabled={leftDraft}>私有{leftDraft ? '(已离开过草案)' : ''}</option>
                <option value="team">团队可见</option>
                <option value="public">公开</option>
              </select>
            ) : (
              <VisibilityTag v={patent.visibility} />
            )}
            {patent.archived && <ArchivedBadge kind={patent.archived.kind} />}
          </div>
          <h1 className="mt-1.5 text-xl font-bold tracking-tight">{patent.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-muted-foreground">
            <span>负责人 {userById(patent.ownerId).name}</span>
            {patent.collaborators.length > 0 && (
              <>
                <span className="text-slate-300">|</span>
                <span>共同发明人 {patent.collaborators.map((c) => userById(c).name).join('、')}</span>
              </>
            )}
            <span className="text-slate-300">|</span>
            <span>{teamById(patent.teamId).name}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">本阶段截止</span>
            <DueChip date={patent.dueDates[patent.stage]} />
            {cycle && (
              <ToneTag tone="neutral">
                {cycle.name}
                {cycleDaysLeft !== null && ` · 剩 ${Math.max(0, cycleDaysLeft)} 天`}
                {cycle.status === 'closed' && ' · 已收口'}
              </ToneTag>
            )}
            {patent.crossCycle && <ToneTag tone="info">跨周期项目</ToneTag>}
            <RiskTag risk={risk} />
          </div>
        </div>

        {/* 操作区:主操作 推进,次操作 回退,其余收进「更多」 */}
        <div className="flex shrink-0 items-center gap-2">
          {visibleMenu.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <MoreHorizontal className="size-4" />
                更多
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div role="menu" className="absolute right-0 z-50 mt-1.5 w-44 rounded-lg border bg-white py-1 shadow-lg">
                    {visibleMenu.map((m) => (
                      <button
                        key={m.label}
                        type="button"
                        role="menuitem"
                        onClick={m.onClick}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-slate-50',
                          m.danger ? 'text-red-600' : 'text-slate-700',
                        )}
                      >
                        <m.icon className="size-3.5" />
                        {m.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {patent.archived ? (
            canOperatePatent(patent) && (
              <button
                type="button"
                onClick={() => open({ kind: 'unarchive' })}
                className="flex items-center gap-1.5 rounded-md bg-teal-700 px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90"
              >
                <ArchiveRestore className="size-3.5" />
                恢复归档
              </button>
            )
          ) : (
            operable && (
              <>
                {curIdx > 0 && (
                  <button
                    type="button"
                    onClick={() => { setRollbackTo(STAGES[curIdx - 1].key); open({ kind: 'rollback', to: STAGES[curIdx - 1].key }) }}
                    className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                  >
                    <RotateCcw className="size-3.5" />
                    回退
                  </button>
                )}
                {curIdx < STAGES.length - 1 && (
                  <button
                    type="button"
                    disabled={gateBlocked}
                    title={gateHint}
                    onClick={() => open({ kind: 'advance' })}
                    className="flex items-center gap-1.5 rounded-md bg-[#12141f] px-3.5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                  >
                    推进至{STAGES[curIdx + 1].label}
                    <ArrowRight className="size-3.5" />
                  </button>
                )}
              </>
            )
          )}
        </div>
      </div>

      {/* 提示条 */}
      {gateHint && operable && !privateLocked && !(reviewBlocked && shownStage === 'patentability') && (
        <Banner tone="warn">{gateHint}</Banner>
      )}
      {privateLocked && editable && (
        <Banner tone="neutral">
          <span className="font-medium">私有锁定:</span>
          私有专利只能停留在草案阶段。要提交审查,请先把可见性调整为「团队可见」或「公开」(调整后不能再改回私有)。
        </Banner>
      )}
      {patent.needsRecheck.includes(patent.stage) && editable && (
        <Banner tone="warn">
          <span className="font-medium">需复核:</span>
          本阶段曾因回退被跳过,内容保留自上次。请检查后保存一次,提示即消除。
        </Banner>
      )}
      {patent.archived && (
        <div className={cn(
          'mt-4 rounded-lg border px-4 py-3',
          patent.archived.kind === 'completed' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-300 bg-slate-50',
        )}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Archive className="size-4" />
            {patent.archived.kind === 'completed' ? '已完成归档' : '已放弃归档'}
            <span className="ml-auto font-mono-x text-xs font-normal text-slate-400">
              {patent.archived.at} · {userById(patent.archived.by).name}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-slate-600">{patent.archived.reason}</p>
          <p className="mt-1 text-xs text-slate-400">归档后内容只读,退出流水线;可由负责人/PL/GL 恢复。</p>
        </div>
      )}

      {/* 步进器 */}
      <div className="mt-5 rounded-lg border bg-card px-4 py-4">
        <StageStepper patent={patent} onSelect={setViewStage} selected={shownStage} />
      </div>

      {/* 主体:阶段页 + 右侧时间线 */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between border-b pb-3">
            <h2 className="font-bold">{STAGES[shownIdx].label}</h2>
            {shownIdx > curIdx ? (
              <ToneTag tone="neutral">尚未到达 · 只读预览</ToneTag>
            ) : shownIdx < curIdx ? (
              <ToneTag tone="neutral">已完成阶段</ToneTag>
            ) : isReviewer && !editable ? (
              <ToneTag tone="ok">你是本阶段 reviewer</ToneTag>
            ) : (
              <ToneTag tone="ok">进行中</ToneTag>
            )}
          </div>

          {shownStage === 'draft' && <DraftPane key={`d-${patent.id}-${store.formEpoch}`} patent={patent} editable={paneEditable} />}
          {shownStage === 'patentability' && <PatentabilityPane key={`p-${patent.id}-${patent.stageData.patentability.round}-${store.formEpoch}`} patent={patent} editable={paneEditable} />}
          {shownStage === 'implementation' && <MarkdownPane key={`i-${patent.id}-${store.formEpoch}`} patent={patent} editable={paneEditable} stage="implementation" />}
          {shownStage === 'search' && <MarkdownPane key={`s-${patent.id}-${store.formEpoch}`} patent={patent} editable={paneEditable} stage="search" />}
          {shownStage === 'doi' && <DoiPane key={`o-${patent.id}-${store.formEpoch}`} patent={patent} editable={paneEditable} />}
        </div>

        {/* 右栏 */}
        <div className="space-y-5">
          <SideCard icon={History} title={`版本历史 · ${stageLabel(shownStage)}`}>
            {stageVersions.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">本阶段暂无版本记录</p>
            )}
            {stageVersions.map((v, i) => (
              <TimelineItem key={`${v.version}-${v.at}`} last={i === stageVersions.length - 1} dot="border-teal-600">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono-x text-[11px] font-bold text-teal-700">v{v.version}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{v.note}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                  <span>{userById(v.authorId).name}</span>
                  <span className="font-mono-x">{v.at}</span>
                  {v.snapshot != null && typeof v.snapshot === 'object' && i > 0 && (
                    <button type="button" onClick={() => open({ kind: 'compare', v })} className="ml-auto text-teal-700 hover:underline">
                      对比 / 恢复
                    </button>
                  )}
                </div>
              </TimelineItem>
            ))}
            <p className="mt-3 border-t pt-2.5 text-[11px] leading-snug text-slate-400">
              每次保存生成只增不改的版本;恢复旧版本 = 以旧内容生成新版本。
            </p>
          </SideCard>

          {patent.extensions.length > 0 && (
            <SideCard icon={CalendarClock} title="延期记录">
              <div className="space-y-3">
                {patent.extensions.slice().reverse().map((e) => {
                  // 与后端一致:本组 PL/GL 审批非私有专利;负责人本人为 PL/GL 时可自批(决策 35)
                  const canApprove = e.status === 'pending' && (
                    (isManagerOfTeam && patent.visibility !== 'private')
                    || (patent.ownerId === me.id && me.role !== 'user'))
                  return (
                    <div key={e.id} className="border-b pb-3 last:border-0 last:pb-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium">{stageLabel(e.stage)}</span>
                        <span className="font-mono-x text-[11px] text-slate-500">{e.oldDue} → {e.newDue}</span>
                        <span className="ml-auto">
                          <ToneTag tone={e.status === 'applied' ? 'ok' : e.status === 'pending' ? 'warn' : e.status === 'rejected' ? 'danger' : 'neutral'}>
                            {{ applied: '已生效', pending: '待审批', rejected: '已驳回', void: '已作废' }[e.status]}
                          </ToneTag>
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{e.reason}</p>
                      <p className="text-[11px] text-slate-400">
                        {userById(e.by).name} · {e.at}
                        {e.approvedBy && ` · 审批 ${userById(e.approvedBy).name}`}
                        {e.selfApproved && '(自批)'}
                        {e.status === 'void' && ' · 阶段已变化,自动作废'}
                      </p>
                      {canApprove && (
                        <div className="mt-1.5 flex gap-2">
                          <button type="button" onClick={() => store.reviewExtension(patent.id, e.id, true)} className="rounded border border-teal-600 px-2.5 py-0.5 text-[11px] font-medium text-teal-700 hover:bg-teal-50">
                            批准{patent.ownerId === me.id ? '(自批,将留痕)' : ''}
                          </button>
                          <button type="button" onClick={() => store.reviewExtension(patent.id, e.id, false)} className="rounded border border-red-300 px-2.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50">
                            驳回
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </SideCard>
          )}

          <SideCard icon={GitCommitVertical} title="流转记录">
            {myTransitions.map((t, i) => (
              <TimelineItem
                key={t.id}
                last={i === myTransitions.length - 1}
                dot={{
                  advance: 'border-teal-600', rollback: 'border-amber-500', reject: 'border-red-500',
                  archive: 'border-slate-400', unarchive: 'border-teal-600',
                }[t.kind]}
              >
                <div className="text-xs font-medium text-slate-700">
                  {t.kind === 'archive' ? '归档' : t.kind === 'unarchive' ? '恢复归档' : `${t.from ? stageLabel(t.from) : '创建'} → ${stageLabel(t.to)}`}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{t.reason}</p>
                <p className="mt-0.5 flex gap-2 text-[11px] text-slate-400">
                  <span>{userById(t.operatorId).name}</span>
                  <span className="font-mono-x">{t.at}</span>
                </p>
              </TimelineItem>
            ))}
          </SideCard>
        </div>
      </div>

      {/* —— 对话框 —— */}
      {dialog?.kind === 'advance' || dialog?.kind === 'rollback' || dialog?.kind === 'archive' || dialog?.kind === 'unarchive' ? (
        <Modal
          title={
            dialog.kind === 'advance' ? `推进至「${STAGES[curIdx + 1]?.label}」`
            : dialog.kind === 'rollback' ? '回退阶段'
            : dialog.kind === 'archive' ? '归档专利' : '恢复归档'
          }
          onClose={close}
          confirm={{
            label: { advance: '确认推进', rollback: '确认回退', archive: '确认归档', unarchive: '确认恢复' }[dialog.kind],
            disabled: !reason.trim(),
            tone: dialog.kind === 'rollback' ? 'warn' : 'dark',
            onClick: () => {
              if (dialog.kind === 'advance') store.advance(patent.id, reason)
              else if (dialog.kind === 'rollback') store.rollback(patent.id, rollbackTo, reason)
              else if (dialog.kind === 'archive') store.archive(patent.id, archiveKind, reason)
              else store.unarchive(patent.id, reason)
              close(); setViewStage(null)
            },
          }}
        >
          {dialog.kind === 'rollback' && (
            <div className="space-y-2">
              <label className="ui-label text-slate-500">回退到</label>
              <select
                value={rollbackTo}
                onChange={(e) => setRollbackTo(e.target.value as StageKey)}
                className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
              >
                {STAGES.slice(0, curIdx).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <RollbackHint />
              {stageIndex(rollbackTo) < curIdx - 1 && (
                <p className="text-xs text-amber-700">跨多级回退:被跳过阶段的内容会保留,再次到达时标记「需复核」,截止日按默认周期重算。</p>
              )}
            </div>
          )}
          {dialog.kind === 'archive' && (
            <div>
              <span className="ui-label text-slate-500">归档类型</span>
              <div className="mt-1.5 flex gap-2">
                {([
                  { k: 'completed', label: '完成归档', desc: '流程走完,成果沉淀' },
                  { k: 'abandoned', label: '放弃归档', desc: '终止推进(如新颖性不成立)' },
                ] as const).map((o) => (
                  <button
                    key={o.k}
                    type="button"
                    onClick={() => setArchiveKind(o.k)}
                    className={cn(
                      'flex-1 rounded-md border px-3 py-2.5 text-left transition-colors',
                      archiveKind === o.k ? 'border-[#12141f] bg-[#12141f] text-white' : 'text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    <span className="block text-[13px] font-medium">{o.label}</span>
                    <span className={cn('block text-[11px]', archiveKind === o.k ? 'text-slate-300' : 'text-slate-400')}>{o.desc}</span>
                  </button>
                ))}
              </div>
              {archiveKind === 'abandoned' && cycle && (
                <p className="mt-2 text-[11px] text-slate-500">
                  KPI 口径:放弃日早于周期结束前 {config.overdue.abandonExcludeDays} 天才退出分母;之后放弃的仍计入本周期分母。
                </p>
              )}
            </div>
          )}
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              dialog.kind === 'rollback' ? '回退原因(必填,将写入流转记录)'
              : dialog.kind === 'advance' ? '推进说明(必填)'
              : dialog.kind === 'archive' ? '归档原因(必填,如:检索发现新颖性障碍)'
              : '恢复原因(必填)'
            }
            className="mt-3 w-full rounded-md border px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
          />
        </Modal>
      ) : null}

      {dialog?.kind === 'visibility' && (
        <Modal
          title={`可见性调整为「${VISIBILITY_LABEL[dialog.to]}」`}
          onClose={close}
          confirm={{ label: '确认调整', tone: 'dark', onClick: () => { store.setVisibility(patent.id, dialog.to); close() } }}
        >
          <div className="flex gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              {dialog.to === 'team' ? '本组成员、本组 PL 与 GL 将能看到全部内容与历史版本。' : '全员都将能看到全部内容与历史版本(只读)。'}
              {patent.visibility === 'private' && (
                <div className="mt-1 font-medium">这是不可逆的:一旦离开私有并推进出草案,将不能再改回私有。</div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'transfer' && (
        <Modal
          title="转交专利"
          onClose={close}
          confirm={{ label: '确认转交', tone: 'dark', disabled: !transferTo, onClick: () => { store.transferOwnership(patent.id, transferTo, keepCollab); close() } }}
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            接收人成为负责人,获得推进/回退/归档等全部操作权。历史版本与流转记录中的署名不变;团队归属不变。
            {patent.visibility === 'private' && ' 私有专利转交后仍为私有,只有新负责人(及保留的你)可见。'}
          </p>
          <select
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            className="mt-3 w-full rounded-md border bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-600"
            aria-label="选择接收人"
          >
            <option value="">选择接收人…</option>
            <UserOptions excludeId={patent.ownerId} teamId={patent.teamId} />
          </select>
          <label className="mt-3 flex items-center gap-2 text-[13px] text-slate-600">
            <input type="checkbox" checked={keepCollab} onChange={(e) => setKeepCollab(e.target.checked)} className="accent-teal-700" />
            原负责人({userById(patent.ownerId).name})保留为共同发明人
          </label>
        </Modal>
      )}

      {dialog?.kind === 'migrate' && (
        <Modal
          title="迁移团队"
          onClose={close}
          confirm={{ label: '确认迁移', tone: 'dark', disabled: !migrateTo, onClick: () => { store.migrateTeam(patent.id, migrateTo); close() } }}
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            成员换组时专利默认留在原组。迁移后,团队可见范围与团队 KPI 均按新团队计算;已冻结的 KPI 快照不受影响。
          </p>
          <select
            value={migrateTo}
            onChange={(e) => setMigrateTo(e.target.value)}
            className="mt-3 w-full rounded-md border bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-600"
          >
            <option value="">选择目标团队…</option>
            {TEAMS.filter((t) => t.id !== patent.teamId && !t.archived).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Modal>
      )}

      {dialog?.kind === 'delete' && (
        <Modal
          title="删除专利"
          onClose={close}
          confirm={{
            label: '永久删除', tone: 'danger', disabled: reason !== patent.code,
            onClick: async () => { if (await store.deletePatent(patent.id)) navigate({ name: 'patents' }) },
          }}
        >
          <p className="text-[13px] text-slate-600">
            该专利从未离开草案、也未邀请过 reviewer,可以物理删除。删除后全部版本与记录不可恢复。
          </p>
          <label className="mt-3 block text-xs text-slate-500">输入编号 <span className="font-mono-x font-bold">{patent.code}</span> 以确认</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-md border px-3 py-2 font-mono-x text-sm outline-none focus:border-red-500"
          />
        </Modal>
      )}

      {dialog?.kind === 'extension' && (
        <Modal
          title={`申请延期 · ${stageLabel(patent.stage)}`}
          onClose={close}
          confirm={{
            label: '提交申请', tone: 'dark', disabled: !extDate || !reason.trim(),
            onClick: async () => {
              const r = await store.requestExtension(patent.id, extDate, reason.trim())
              if (r === 'applied' || r === 'pending') close()
              else setExtMsg(r.error)
            },
          }}
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            当前截止 {patent.dueDates[patent.stage]}。本阶段累计延期 ≤ {config.overdue.extensionApprovalThreshold} 天自动生效,超过需本组 PL 或 GL 批准。
            {cycle && !patent.crossCycle && ` 不可超出所属周期结束日(${cycle.end})。`}
          </p>
          <label className="mt-3 block ui-label text-slate-500">新截止日</label>
          <input
            type="date" value={extDate} min={patent.dueDates[patent.stage]}
            onChange={(e) => { setExtDate(e.target.value); setExtMsg('') }}
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
          <label className="mt-3 block ui-label text-slate-500">延期原因(必填)</label>
          <textarea
            rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="如:检索资源排期冲突,需顺延两周"
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
          {extMsg && <p className="mt-2 text-xs text-red-600">{extMsg}</p>}
        </Modal>
      )}

      {dialog?.kind === 'collab' && (
        <Modal title="共同发明人" onClose={close} confirm={{ label: '完成', tone: 'dark', onClick: close }}>
          <p className="text-xs leading-relaxed text-muted-foreground">
            共同发明人可查看并编辑各阶段内容(生成版本记录),但不能推进/回退/归档/变更可见性。
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[
              ...store.activeUsers.filter((u) => u.id !== patent.ownerId),
              // 已停用的原共同发明人仍显示,便于移除
              ...patent.collaborators.map((id) => userById(id)).filter((u) => u.deactivated),
            ].map((u) => {
              const on = patent.collaborators.includes(u.id)
              return (
                <ToggleTag
                  key={u.id}
                  on={on}
                  onClick={() => store.setCollaborators(patent.id, on ? patent.collaborators.filter((c) => c !== u.id) : [...patent.collaborators, u.id])}
                >
                  {u.name}{u.deactivated ? '(已停用)' : ''}
                </ToggleTag>
              )
            })}
          </div>
        </Modal>
      )}

      {dialog?.kind === 'compare' && (
        <CompareDialog
          v={dialog.v}
          current={patent.stageData[dialog.v.stage] as unknown as Record<string, unknown>}
          canRestore={paneEditable}
          onRestore={() => {
            store.saveStageData(patent.id, dialog.v.stage, dialog.v.snapshot, `恢复自 v${dialog.v.version}`)
            close()
          }}
          onClose={close}
        />
      )}

      {dialog?.kind === 'notify' && <NotifyDialog patentId={patent.id} onClose={close} />}
    </div>
  )
}

// —— 小组件 ——
function Banner({ tone, children }: { tone: 'warn' | 'neutral'; children: ReactNode }) {
  return (
    <div className={cn(
      'mt-4 flex items-start gap-2 rounded-lg border px-4 py-2.5 text-[13px]',
      tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-300 bg-slate-50 text-slate-600',
    )}>
      {tone === 'warn' && <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
      <div>{children}</div>
    </div>
  )
}

function SideCard({ icon: Icon, title, children }: { icon: typeof History; title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="size-4 text-slate-400" />
        {title}
      </div>
      {children}
    </div>
  )
}

function TimelineItem({ last, dot, children }: { last: boolean; dot: string; children: ReactNode }) {
  return (
    <div className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <div className="absolute left-[5px] top-4 h-full w-px bg-slate-200" />}
      <div className={cn('mt-1 size-[11px] shrink-0 rounded-full border-2 bg-white', dot)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function UserOptions({ excludeId, teamId }: { excludeId: string; teamId: string }) {
  const { activeUsers } = useStore()
  const same = activeUsers.filter((u) => u.id !== excludeId && u.teamId === teamId)
  const other = activeUsers.filter((u) => u.id !== excludeId && u.teamId !== teamId)
  return (
    <>
      <optgroup label="本组">
        {same.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.title}</option>)}
      </optgroup>
      <optgroup label="其他团队">
        {other.map((u) => <option key={u.id} value={u.id}>{u.name} · {teamById(u.teamId).name}</option>)}
      </optgroup>
    </>
  )
}

export function Modal({
  title, onClose, confirm, children, wide,
}: {
  title: string
  onClose: () => void
  confirm?: { label: string; onClick: () => void; disabled?: boolean; tone: 'dark' | 'warn' | 'danger' }
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 !mt-0 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className={cn('scrollbar-thin max-h-[85vh] w-full overflow-y-auto rounded-lg bg-white p-5 shadow-xl', wide ? 'max-w-2xl' : 'max-w-md')}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold">{title}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-slate-100" aria-label="关闭">
            <X className="size-4" />
          </button>
        </div>
        {children}
        {confirm && (
          <div className="mt-4 flex justify-end gap-2 border-t pt-3">
            <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">取消</button>
            <button
              type="button"
              disabled={confirm.disabled}
              onClick={confirm.onClick}
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40',
                confirm.tone === 'warn' ? 'bg-amber-600' : confirm.tone === 'danger' ? 'bg-red-600' : 'bg-[#12141f]',
              )}
            >
              {confirm.label}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// —— 版本对比:旧版本 vs 当前,逐字段 ——
function CompareDialog({
  v, current, canRestore, onRestore, onClose,
}: {
  v: StageVersion
  current: Record<string, unknown>
  canRestore: boolean
  onRestore: () => void
  onClose: () => void
}) {
  const old = v.snapshot as Record<string, unknown>
  const keys = [...new Set([...Object.keys(old), ...Object.keys(current)])].filter((k) => typeof (current[k] ?? old[k]) === 'string')
  return (
    <Modal
      title={`v${v.version} 与当前内容对比`}
      onClose={onClose}
      wide
      confirm={canRestore ? { label: `以 v${v.version} 内容生成新版本`, tone: 'dark', onClick: onRestore } : undefined}
    >
      <div className="space-y-3">
        {keys.map((k) => {
          const a = String(old[k] ?? '')
          const b = String(current[k] ?? '')
          return (
            <div key={k}>
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500">
                {k}
                {a === b ? <ToneTag tone="neutral">无变化</ToneTag> : <ToneTag tone="warn">有变化</ToneTag>}
              </div>
              {a !== b && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="whitespace-pre-wrap rounded-md border border-red-200 bg-red-50/60 p-2.5 text-xs leading-relaxed text-slate-700">{a || '(空)'}</div>
                  <div className="whitespace-pre-wrap rounded-md border border-teal-200 bg-teal-50/60 p-2.5 text-xs leading-relaxed text-slate-700">{b || '(空)'}</div>
                </div>
              )}
            </div>
          )
        })}
        <p className="text-[11px] text-slate-400">左:v{v.version}({v.at});右:当前。恢复不会删除任何版本。</p>
      </div>
    </Modal>
  )
}

// —— 每阶段通知人配置 ——
function NotifyDialog({ patentId, onClose }: { patentId: string; onClose: () => void }) {
  const { patents, saveNotifyConfig, users, previewNotify } = useStore()
  const patent = patents.find((p) => p.id === patentId)!
  const [pvEvent, setPvEvent] = useState<NotifyEvent>('transition')
  const [pv, setPv] = useState<Awaited<ReturnType<typeof previewNotify>>>(null)
  const [pvBusy, setPvBusy] = useState(false)

  const [cfgs, setCfgs] = useState<StageNotifyConfig[]>(() =>
    STAGES.map((s) => {
      const existing = patent.notify.find((n) => n.stage === s.key)
      return (
        existing ?? {
          stage: s.key,
          userIds: [],
          includePl: true,
          includeOwner: true,
          events: s.key === 'patentability' ? ['review', 'due', 'transition'] : ['due', 'transition'],
        }
      )
    }),
  )

  // 只有改动过(或原本就有覆盖)的阶段才保存为专利级覆盖;其余阶段继续沿用 GL 的全局默认收件人
  const [overridden, setOverridden] = useState<Set<StageKey>>(() => new Set(patent.notify.map((n) => n.stage)))
  const update = (stage: StageKey, patch: Partial<StageNotifyConfig>) => {
    setPv(null) // 配置变了,旧的预演结果作废
    setOverridden((s) => new Set(s).add(stage))
    setCfgs((cs) => cs.map((c) => (c.stage === stage ? { ...c, ...patch } : c)))
  }
  const resetStage = (stage: StageKey) => {
    setPv(null)
    setOverridden((s) => { const n = new Set(s); n.delete(stage); return n })
  }
  const effective = cfgs.filter((c) => overridden.has(c.stage))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="scrollbar-thin max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="ui-label text-teal-700">NOTIFY · CALLBACK</div>
            <h3 className="mt-0.5 font-bold">阶段通知人配置</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-slate-100" aria-label="关闭">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          通知通过预留的 Webhook 回调接口发出(审查动态 / 截止提醒 / 阶段流转)。此处只配置「发给谁、发什么事件」,投递通道由后端 Notifier 实现决定。
        </p>

        <div className="mt-4 space-y-4">
          {cfgs.map((c) => (
            <div key={c.stage} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{stageLabel(c.stage)}</span>
                {overridden.has(c.stage) ? (
                  <button type="button" onClick={() => resetStage(c.stage)} className="text-[11px] text-slate-400 hover:text-teal-700 hover:underline">
                    恢复全局默认
                  </button>
                ) : (
                  <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] text-slate-500">沿用全局默认 · 修改后生效</span>
                )}
                <div className="ml-auto flex gap-1.5">
                  {ALL_EVENTS.map((ev) => (
                    <button
                      key={ev}
                      type="button"
                      onClick={() =>
                        update(c.stage, {
                          events: c.events.includes(ev)
                            ? c.events.filter((e) => e !== ev)
                            : [...c.events, ev],
                        })
                      }
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
                        c.events.includes(ev)
                          ? 'border-teal-600 bg-teal-50 font-medium text-teal-800'
                          : 'text-slate-500 hover:bg-slate-50',
                      )}
                    >
                      {NOTIFY_EVENT_LABEL[ev]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <ToggleTag on={c.includeOwner} onClick={() => update(c.stage, { includeOwner: !c.includeOwner })}>
                  发明人本人
                </ToggleTag>
                <ToggleTag on={c.includePl} onClick={() => update(c.stage, { includePl: !c.includePl })}>
                  本组 PL
                </ToggleTag>
                <span className="mx-1 h-4 w-px bg-border" />
                {users.map((u) => (
                  <ToggleTag
                    key={u.id}
                    on={c.userIds.includes(u.id)}
                    onClick={() =>
                      update(c.stage, {
                        userIds: c.userIds.includes(u.id)
                          ? c.userIds.filter((x) => x !== u.id)
                          : [...c.userIds, u.id],
                      })
                    }
                  >
                    {u.name}
                  </ToggleTag>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 送达预演:按当前(未保存的)配置,看「当前阶段」某类事件会通知到谁,并测试回调 */}
        <div className="mt-5 rounded-lg border border-dashed bg-slate-50/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">送达预演</span>
            <span className="text-xs text-muted-foreground">当前阶段「{stageLabel(patent.stage)}」发生</span>
            <select
              value={pvEvent}
              onChange={(e) => { setPvEvent(e.target.value as NotifyEvent); setPv(null) }}
              className="rounded border bg-white px-1.5 py-1 text-xs outline-none focus:border-teal-600"
              aria-label="事件类型"
            >
              {ALL_EVENTS.map((ev) => <option key={ev} value={ev}>{NOTIFY_EVENT_LABEL[ev]}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">时</span>
            <button
              type="button" disabled={pvBusy}
              onClick={async () => { setPvBusy(true); setPv(await previewNotify(patentId, pvEvent, effective)); setPvBusy(false) }}
              className="ml-auto rounded-md border bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              {pvBusy ? '预演中…' : '预演送达并测试回调'}
            </button>
          </div>
          {pv && (
            <div className="mt-3 space-y-1.5 text-[13px]">
              {pv.recipients.length === 0 ? (
                <p className="text-amber-700">按当前配置,这类事件不会通知任何人。</p>
              ) : (
                pv.recipients.map((r) => (
                  <div key={r.id} className="flex items-center gap-2">
                    <span className={r.delivered ? 'text-teal-700' : 'text-slate-400'}>{r.delivered ? '✓' : '✗'}</span>
                    <span className={cn('font-medium', !r.delivered && 'text-slate-400 line-through')}>{r.name}</span>
                    {r.reason && <span className="text-xs text-slate-500">{r.reason}</span>}
                  </div>
                ))
              )}
              <div className="border-t pt-2 text-xs">
                {!pv.webhookConfigured ? (
                  <span className="text-slate-500">系统未配置外部回调:以上收件人只会在站内通知中心看到。</span>
                ) : pv.webhook?.ok ? (
                  <span className="text-teal-700">外部回调连通正常(HTTP {pv.webhook.status},{pv.webhook.latencyMs} ms)。</span>
                ) : (
                  <span className="text-red-600">外部回调失败:{pv.webhook?.error ?? '未知错误'},请联系 GL 检查回调地址。</span>
                )}
                <span className="ml-1 text-slate-400">预演不会真的发送通知;实际发生时不会通知操作者本人。</span>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t pt-4">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">
            取消
          </button>
          <button
            type="button"
            onClick={() => { saveNotifyConfig(patentId, effective); onClose() }}
            className="rounded-md bg-[#12141f] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  )
}

function ToggleTag({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
        on ? 'border-[#12141f] bg-[#12141f] text-white' : 'text-slate-500 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  )
}
