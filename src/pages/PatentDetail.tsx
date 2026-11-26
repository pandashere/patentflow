import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'
import { USERS, userById, teamById } from '@/lib/data'
import {
  NOTIFY_EVENT_LABEL, STAGES, stageIndex, stageLabel,
  type NotifyEvent, type StageKey, type StageNotifyConfig,
} from '@/lib/types'
import {
  DueChip, RollbackHint, StageStepper, VisibilityTag,
} from '@/components/pf'
import { DoiPane, DraftPane, MarkdownPane, PatentabilityPane } from './panes'
import type { Page } from '@/components/AppShell'
import {
  ArrowLeft, ArrowRight, Bell, GitCommitVertical, History, RotateCcw, X,
} from 'lucide-react'

const ALL_EVENTS: NotifyEvent[] = ['review', 'due', 'transition']

export default function PatentDetail({ id, navigate }: { id: string; navigate: (p: Page) => void }) {
  const store = useStore()
  const { patents, versions, transitions, canEditPatent, isReviewerOf, config } = store
  const patent = patents.find((p) => p.id === id)

  const [viewStage, setViewStage] = useState<StageKey | null>(null)
  const [action, setAction] = useState<{ kind: 'advance' } | { kind: 'rollback'; to: StageKey } | null>(null)
  const [reason, setReason] = useState('')
  const [notifyOpen, setNotifyOpen] = useState(false)

  const myVersions = useMemo(
    () => versions.filter((v) => v.patentId === id).slice().reverse(),
    [versions, id],
  )
  const myTransitions = useMemo(
    () => transitions.filter((t) => t.patentId === id).slice().reverse(),
    [transitions, id],
  )

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

  const editable = canEditPatent(patent)
  const curIdx = stageIndex(patent.stage)
  const shownStage = viewStage ?? patent.stage
  const shownIdx = stageIndex(shownStage)
  const isReviewer = isReviewerOf(patent)
  // 可编辑范围:当前阶段及之前的阶段(reviewer 对审查阶段有独立打分表单)
  const paneEditable = editable && shownIdx <= curIdx

  const gateBlocked =
    patent.stage === 'patentability' && !store.reviewGateOpen(patent)

  return (
    <div className="mx-auto max-w-6xl">
      {/* 头部 */}
      <button
        type="button"
        onClick={() => navigate({ name: 'patents' })}
        className="mb-3 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        返回专利库
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono-x text-xs text-slate-500">
            <span>{patent.code}</span>
            <span>·</span>
            <span>创建于 {patent.createdAt}</span>
            <VisibilityTag v={patent.visibility} />
          </div>
          <h1 className="mt-1.5 text-xl font-bold tracking-tight">{patent.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <span>发明人 {userById(patent.ownerId).name}</span>
            <span>·</span>
            <span>{teamById(patent.teamId).name}</span>
            <span>·</span>
            <span>当前阶段截止</span>
            <DueChip date={patent.dueDates[patent.stage]} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setNotifyOpen(true)}
            className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-[13px] font-medium transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            <Bell className="size-3.5" />
            通知设置
          </button>
          {editable && curIdx > 0 && (
            <button
              type="button"
              onClick={() => { setAction({ kind: 'rollback', to: STAGES[curIdx - 1].key }); setReason('') }}
              className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-2 text-[13px] font-medium text-amber-700 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              <RotateCcw className="size-3.5" />
              回退到{STAGES[curIdx - 1].label}
            </button>
          )}
          {editable && curIdx < STAGES.length - 1 && (
            <button
              type="button"
              disabled={gateBlocked}
              title={gateBlocked ? `审查门禁未满足:需 ${config.reviewPassCount} 名 reviewer 通过` : undefined}
              onClick={() => { setAction({ kind: 'advance' }); setReason('') }}
              className="flex items-center gap-1.5 rounded-md bg-[#12141f] px-3.5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              推进至{STAGES[curIdx + 1].label}
              <ArrowRight className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 步进器 */}
      <div className="mt-6 rounded-lg border bg-card px-5 py-4">
        <StageStepper patent={patent} onSelect={setViewStage} />
      </div>

      {/* 主体:阶段页 + 右侧时间线 */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between border-b pb-3">
            <div>
              <span className="ui-label text-teal-700">{STAGES[shownIdx].en}</span>
              <h2 className="mt-0.5 font-bold">{STAGES[shownIdx].label}</h2>
            </div>
            {shownIdx > curIdx ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">尚未到达 · 只读预览</span>
            ) : shownIdx < curIdx ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">已完成阶段</span>
            ) : isReviewer && !editable ? (
              <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-medium text-teal-800">你是本阶段 reviewer</span>
            ) : (
              <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-medium text-teal-800">进行中</span>
            )}
          </div>

          {shownStage === 'draft' && <DraftPane patent={patent} editable={paneEditable} />}
          {shownStage === 'patentability' && <PatentabilityPane patent={patent} editable={paneEditable} />}
          {shownStage === 'implementation' && <MarkdownPane patent={patent} editable={paneEditable} stage="implementation" />}
          {shownStage === 'search' && <MarkdownPane patent={patent} editable={paneEditable} stage="search" />}
          {shownStage === 'doi' && <DoiPane patent={patent} editable={paneEditable} />}
        </div>

        {/* 右栏:版本历史 + 流转记录 */}
        <div className="space-y-5">
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center gap-1.5">
              <History className="size-4 text-slate-400" />
              <span className="ui-label text-slate-500">版本历史</span>
            </div>
            <div className="space-y-0">
              {myVersions.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">暂无版本记录</p>
              )}
              {myVersions.map((v, i) => (
                <div key={`${v.stage}-${v.version}-${v.at}`} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < myVersions.length - 1 && <div className="absolute left-[5px] top-4 h-full w-px bg-slate-200" />}
                  <div className="mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-teal-600 bg-white" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono-x text-[11px] font-bold text-teal-700">
                        v{v.version}
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] text-slate-600">
                        {stageLabel(v.stage)}
                      </span>
                      <span className="ml-auto font-mono-x text-[10px] text-slate-400">{v.at}</span>
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-slate-600">{v.note}</p>
                    <p className="text-[11px] text-slate-400">{userById(v.authorId).name}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t pt-2.5 text-[11px] leading-snug text-slate-400">
              每次保存生成只增不改的版本快照;恢复旧版本 = 以旧内容生成新版本,历史永不丢失。
            </p>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center gap-1.5">
              <GitCommitVertical className="size-4 text-slate-400" />
              <span className="ui-label text-slate-500">阶段流转</span>
            </div>
            <div className="space-y-0">
              {myTransitions.map((t, i) => (
                <div key={t.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < myTransitions.length - 1 && <div className="absolute left-[5px] top-4 h-full w-px bg-slate-200" />}
                  <div
                    className={cn(
                      'mt-1.5 size-[11px] shrink-0 rounded-full border-2 bg-white',
                      t.kind === 'advance' && 'border-teal-600',
                      t.kind === 'rollback' && 'border-amber-500',
                      t.kind === 'reject' && 'border-red-500',
                    )}
                  />
                  <div className="min-w-0">
                    <div className="text-xs">
                      <span className="font-medium">
                        {t.from ? stageLabel(t.from) : '创建'} → {stageLabel(t.to)}
                      </span>
                      <span className="float-right font-mono-x text-[10px] text-slate-400">{t.at.slice(5)}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{t.reason}</p>
                    <p className="text-[11px] text-slate-400">操作人 {userById(t.operatorId).name}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 推进/回退原因对话框 */}
      {action && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setAction(null)}>
          <div
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold">
                {action.kind === 'advance' ? `推进至「${STAGES[curIdx + 1]?.label}」` : `回退至「${stageLabel(action.to)}」`}
              </h3>
              <button type="button" onClick={() => setAction(null)} className="rounded p-1 hover:bg-slate-100" aria-label="关闭">
                <X className="size-4" />
              </button>
            </div>
            {action.kind === 'rollback' && (
              <div className="mt-3"><RollbackHint /></div>
            )}
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={action.kind === 'rollback' ? '回退原因(必填,将写入流转记录)' : '推进说明(必填)'}
              className="mt-3 w-full rounded-md border px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAction(null)} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">
                取消
              </button>
              <button
                type="button"
                disabled={!reason.trim()}
                onClick={() => {
                  if (action.kind === 'advance') store.advance(patent.id, reason)
                  else store.rollback(patent.id, action.to, reason)
                  setAction(null)
                  setViewStage(null)
                }}
                className={cn(
                  'rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-40',
                  action.kind === 'advance' ? 'bg-[#12141f] hover:opacity-90' : 'bg-amber-600 hover:opacity-90',
                )}
              >
                确认{action.kind === 'advance' ? '推进' : '回退'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 通知设置 */}
      {notifyOpen && <NotifyDialog patentId={patent.id} onClose={() => setNotifyOpen(false)} />}
    </div>
  )
}

// —— 每阶段通知人配置 ——
function NotifyDialog({ patentId, onClose }: { patentId: string; onClose: () => void }) {
  const { patents, saveNotifyConfig } = useStore()
  const patent = patents.find((p) => p.id === patentId)!

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

  const update = (stage: StageKey, patch: Partial<StageNotifyConfig>) =>
    setCfgs((cs) => cs.map((c) => (c.stage === stage ? { ...c, ...patch } : c)))

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
                {USERS.map((u) => (
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

        <div className="mt-5 flex justify-end gap-2 border-t pt-4">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">
            取消
          </button>
          <button
            type="button"
            onClick={() => { saveNotifyConfig(patentId, cfgs); onClose() }}
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
