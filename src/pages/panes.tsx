import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { useStore, weightedScore } from '@/lib/store'
import type {
  DoiData, DraftData, MarkdownStageData, Patent, ReviewScore, ReviewerAssignment, StageKey,
} from '@/lib/types'
import { DueChip, ScoreBars, ToneTag } from '@/components/pf'
import { CheckCircle2, Eye, PencilLine, RefreshCw, Send, UserPlus, XCircle } from 'lucide-react'

interface PaneProps {
  patent: Patent
  editable: boolean
}

function SaveBar({
  editable, onSave, disabled,
}: {
  editable: boolean
  onSave: (note: string) => void
  disabled?: boolean
}) {
  const [note, setNote] = useState('')
  if (!editable) return null
  return (
    <div className="mt-4 flex items-center gap-2 border-t pt-4">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="变更说明(写入版本历史,如:补充背景数据)"
        className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-[13px] outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => { onSave(note || '更新内容'); setNote('') }}
        className="shrink-0 rounded-md bg-[#12141f] px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
      >
        保存新版本
      </button>
    </div>
  )
}

const fieldCls =
  'mt-1.5 w-full rounded-md border bg-white px-3 py-2.5 text-sm leading-relaxed outline-none transition-shadow focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-50 disabled:text-slate-500'

// —— 阶段 1:草案(background / class / idea) ——
export function DraftPane({ patent, editable }: PaneProps) {
  const { saveStageData, config } = useStore()
  const d = patent.stageData.draft
  const [form, setForm] = useState<DraftData>({ ...d })

  return (
    <div>
      <div className="space-y-4">
        <div>
          <label className="ui-label text-slate-500" htmlFor="f-bg">背景</label>
          <textarea
            id="f-bg" rows={4} disabled={!editable}
            value={form.background}
            onChange={(e) => setForm({ ...form, background: e.target.value })}
            className={fieldCls}
            placeholder="现有技术的问题、场景与痛点……"
          />
        </div>
        <div>
          <label className="ui-label text-slate-500" htmlFor="f-cls">分类(自由文本,带词表联想)</label>
          <input
            id="f-cls" disabled={!editable}
            value={form.classification}
            onChange={(e) => setForm({ ...form, classification: e.target.value })}
            className={fieldCls}
            placeholder="技术领域关键词 / IPC 分类号,自由填写"
            list="class-suggestions"
          />
          {/* GL 在租户管理维护的建议词表;仅联想,不限制输入 */}
          <datalist id="class-suggestions">
            {config.classSuggestions.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div>
          <label className="ui-label text-slate-500" htmlFor="f-idea">核心构思</label>
          <textarea
            id="f-idea" rows={4} disabled={!editable}
            value={form.idea}
            onChange={(e) => setForm({ ...form, idea: e.target.value })}
            className={fieldCls}
            placeholder="本方案的核心创新点……"
          />
        </div>
      </div>
      <SaveBar editable={editable} onSave={(note) => saveStageData(patent.id, 'draft', form, note)} />
    </div>
  )
}

// —— 阶段 2:可专利性审查(三维度 + reviewer 门禁 + 审查轮次) ——
export function PatentabilityPane({ patent, editable }: PaneProps) {
  const {
    me, config, activeUsers, userById, inviteReviewer, withdrawReviewer, declineReview, startNewRound,
    submitReview, saveStageData, reviewPassCount, reviewRejected, isReviewerOf, canOperatePatent,
  } = useStore()
  const d = patent.stageData.patentability
  const dimLabels = config.reviewDims.map((x) => x.label)
  const dimKeys = config.reviewDims.map((x) => x.key)
  const [summary, setSummary] = useState(d.summary)
  const [inviteId, setInviteId] = useState('')
  const [self, setSelf] = useState(d.selfAssessment)
  const [showPast, setShowPast] = useState(false)

  const inStage = patent.stage === 'patentability' && !patent.archived
  const myAssignment = d.reviewers.find((r) => r.userId === me.id)
  const [editingReview, setEditingReview] = useState(false)
  // 提交后、本轮结束前可修改意见
  const showForm = inStage && !!myAssignment && !myAssignment.declined && (!myAssignment.score || editingReview)
  const passCount = reviewPassCount(patent)
  const rejected = reviewRejected(patent)
  const gateOpen = !rejected && passCount >= config.reviewPassCount
  const pending = d.reviewers.filter((r) => !r.score && !r.declined)
  const active = d.reviewers.filter((r) => !r.declined)
  const isOwnerSide = canOperatePatent(patent)

  const [score, setScore] = useState<ReviewScore>(
    myAssignment?.score ?? { difficulty: 3, nonObviousness: 3, novelty: 3, comment: '', verdict: 'pass' },
  )
  const [blockMsg, setBlockMsg] = useState('')
  const [declining, setDeclining] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  // 决策:不设回避规则,仅排除负责人本人与已停用成员
  const candidates = activeUsers.filter(
    (u) => u.id !== patent.ownerId && !d.reviewers.some((r) => r.userId === u.id),
  )

  // 门禁提示:告诉用户下一步做什么
  const need = Math.max(0, config.reviewPassCount - passCount)
  const gateText = gateOpen
    ? '已满足门禁条件,可推进至专利实施。'
    : rejected
      ? '本轮有 reviewer 打回。请根据意见修改草案/摘要,然后发起新一轮审查(名单自动继承,分数清零)。'
      : need > active.length - passCount
        ? `还需 ${need} 人通过,但待审 reviewer 不足 —— 请再邀请 ${need - (active.length - passCount)} 人。`
        : `还需 ${need} 人通过。待审:${pending.map((r) => userById(r.userId).name).join('、') || '无'}。`

  return (
    <div className="space-y-6">
      {/* 审查摘要 + 自评 */}
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className="ui-label text-slate-500" htmlFor="f-sum">审查摘要</label>
          <textarea
            id="f-sum" rows={5} disabled={!editable}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className={fieldCls}
            placeholder="创新点提炼、初步检索结论……"
          />
          {editable && (
            <button
              type="button"
              onClick={() => saveStageData(patent.id, 'patentability', { ...d, summary, selfAssessment: self }, '更新审查摘要/自评')}
              className="mt-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              保存摘要与自评
            </button>
          )}
        </div>
        <div className="rounded-lg border bg-slate-50/60 p-4">
          <div className="ui-label text-slate-500">发明人自评</div>
          <div className="mt-3 space-y-2.5">
            {editable ? (
              dimKeys.map((k, i) => (
                <label key={k} className="block">
                  <span className="flex justify-between text-xs text-slate-600">
                    <span>{dimLabels[i]}</span>
                    <span className="font-mono-x font-bold">{self[k]}</span>
                  </span>
                  <input
                    type="range" min={1} max={5} step={1} value={self[k]}
                    onChange={(e) => setSelf({ ...self, [k]: Number(e.target.value) })}
                    className="mt-0.5 w-full accent-teal-700"
                  />
                </label>
              ))
            ) : (
              <>
                <ScoreBars values={dimKeys.map((k) => self[k])} labels={dimLabels} color="#64748b" />
                <p className="text-xs leading-relaxed text-slate-600">{self.comment || '未填写自评意见'}</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 门禁状态 */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3',
          gateOpen ? 'border-teal-200 bg-teal-50' : rejected ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50',
        )}
      >
        {gateOpen
          ? <CheckCircle2 className="size-5 shrink-0 text-teal-700" />
          : <XCircle className={cn('size-5 shrink-0', rejected ? 'text-red-600' : 'text-amber-600')} />}
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">
            第 {d.round} 轮审查 · {passCount} / {config.reviewPassCount} 通过{rejected && ' · 有打回'}
          </div>
          <div className="mt-0.5 text-[13px] text-slate-600">{gateText}</div>
        </div>
        {inStage && isOwnerSide && rejected && (
          <button
            type="button"
            onClick={() => startNewRound(patent.id)}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-[#12141f] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            <RefreshCw className="size-3.5" />
            发起第 {d.round + 1} 轮审查
          </button>
        )}
      </div>

      {/* reviewer 列表 */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">受邀审查人</span>
          {editable && inStage && (
            <div className="flex items-center gap-2">
              <select
                value={inviteId}
                onChange={(e) => setInviteId(e.target.value)}
                className="rounded-md border bg-white px-2.5 py-1.5 text-xs outline-none focus:border-teal-600"
                aria-label="选择要邀请的 reviewer"
              >
                <option value="">选择成员…</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} · {u.title}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={!inviteId}
                onClick={() => { inviteReviewer(patent.id, inviteId); setInviteId('') }}
                className="flex items-center gap-1 rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              >
                <UserPlus className="size-3.5" />
                邀请
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          {d.reviewers.length === 0 && (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              尚未邀请 reviewer。门禁需要 {config.reviewPassCount} 人通过,邀请后对方将收到通知。
            </div>
          )}
          {d.reviewers.map((r) => (
            <ReviewerCard
              key={r.userId}
              r={r}
              dimKeys={dimKeys}
              dimLabels={dimLabels}
              onWithdraw={editable && inStage && !r.score && !r.declined ? () => withdrawReviewer(patent.id, r.userId) : undefined}
            />
          ))}
        </div>

        {d.pastRounds.length > 0 && (
          <div className="mt-3">
            <button type="button" onClick={() => setShowPast((v) => !v)} className="text-xs text-teal-700 hover:underline">
              {showPast ? '收起' : '查看'}历史轮次({d.pastRounds.length})
            </button>
            {showPast && (
              <div className="mt-2 space-y-3 border-l-2 border-slate-200 pl-4">
                {d.pastRounds.slice().reverse().map((pr) => (
                  <div key={pr.round}>
                    <div className="mb-1.5 flex items-center gap-2 text-xs">
                      <span className="font-semibold">第 {pr.round} 轮</span>
                      <ToneTag tone={pr.outcome === 'rejected' ? 'danger' : pr.outcome === 'passed' ? 'ok' : 'neutral'}>
                        {pr.outcome === 'rejected' ? '打回' : pr.outcome === 'passed' ? '通过' : '已被新一轮取代'}
                      </ToneTag>
                      <span className="font-mono-x text-[10px] text-slate-400">结束于 {pr.closedAt}</span>
                    </div>
                    <div className="space-y-2 opacity-80">
                      {pr.reviewers.map((r) => (
                        <ReviewerCard key={r.userId} r={r} dimKeys={dimKeys} dimLabels={dimLabels} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* reviewer 打分表单:被邀请、未拒绝,且(未提交 或 正在修改) */}
      {showForm && (
        <div className="rounded-lg border-2 border-teal-600/60 bg-teal-50/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-teal-800">
              {myAssignment?.score ? '修改你的审查意见' : '请完成三维度审查'}
            </div>
            {myAssignment?.dueDate && !myAssignment.score && (
              <span className="flex items-center gap-1.5 text-xs text-slate-500">审查截止 <DueChip date={myAssignment.dueDate} /></span>
            )}
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            {dimKeys.map((k, i) => (
              <label key={k} className="block rounded-md border bg-white p-3">
                <span className="flex justify-between text-xs font-medium">
                  <span>{dimLabels[i]}</span>
                  <span className="font-mono-x text-sm font-bold text-teal-700">{score[k]}</span>
                </span>
                <input
                  type="range" min={1} max={5} step={1} value={score[k]}
                  onChange={(e) => setScore({ ...score, [k]: Number(e.target.value) })}
                  className="mt-2 w-full accent-teal-700"
                />
              </label>
            ))}
          </div>
          <textarea
            rows={3}
            value={score.comment}
            onChange={(e) => setScore({ ...score, comment: e.target.value })}
            placeholder="审查意见(打回时必填,发明人将据此修改)"
            className={cn(fieldCls, 'mt-3')}
          />
          <div className="mt-2 text-xs text-slate-500">
            当前加权均分:<span className="font-mono-x font-bold text-teal-700">{weightedScore(score, config).toFixed(1)}</span>
            <span className="text-slate-400">(门禁下限 {config.reviewMinWeighted},低于下限不能判「通过」)</span>
          </div>
          {blockMsg && <p className="mt-2 text-xs font-medium text-red-600">{blockMsg}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                const r = await submitReview(patent.id, { ...score, verdict: 'pass' })
                if (r === 'error') return
                if (r === 'below-min') setBlockMsg(`加权均分低于下限 ${config.reviewMinWeighted},不能判「通过」—— 请提高评分或改判打回`)
                else { setBlockMsg(''); setEditingReview(false) }
              }}
              className="flex items-center gap-1.5 rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              <Send className="size-4" />
              提交 · 通过
            </button>
            <button
              type="button"
              onClick={() => {
                if (!score.comment.trim()) { setBlockMsg('打回时请填写审查意见'); return }
                submitReview(patent.id, { ...score, verdict: 'reject' }).then((r) => { if (r === 'ok') { setBlockMsg(''); setEditingReview(false) } })
              }}
              className="flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <XCircle className="size-4" />
              提交 · 打回
            </button>
            {myAssignment?.score ? (
              <button type="button" onClick={() => setEditingReview(false)} className="ml-auto text-xs text-slate-500 hover:underline">
                取消修改
              </button>
            ) : (
              <button type="button" onClick={() => setDeclining((v) => !v)} className="ml-auto text-xs text-slate-500 hover:underline">
                无法审查?拒绝邀请
              </button>
            )}
          </div>
          {declining && (
            <div className="mt-3 flex gap-2">
              <input
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="拒绝原因(必填,如:领域不匹配 / 时间冲突)"
                className="min-w-0 flex-1 rounded-md border bg-white px-3 py-1.5 text-xs outline-none focus:border-teal-600"
              />
              <button
                type="button"
                disabled={!declineReason.trim()}
                onClick={() => declineReview(patent.id, declineReason.trim())}
                className="rounded-md border border-slate-400 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
              >
                确认拒绝
              </button>
            </div>
          )}
        </div>
      )}
      {!showForm && isReviewerOf(patent) && myAssignment?.score && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          你已提交本轮审查意见({myAssignment.score.verdict === 'pass' ? '通过' : '打回'})。
          {inStage && (
            <button type="button" onClick={() => { setScore(myAssignment.score!); setEditingReview(true) }} className="text-teal-700 hover:underline">
              修改意见
            </button>
          )}
        </p>
      )}
      {myAssignment?.declined && (
        <p className="text-xs text-muted-foreground">你已拒绝本轮审查邀请:{myAssignment.declined.reason}</p>
      )}
    </div>
  )
}

function ReviewerCard({
  r, dimKeys, dimLabels, onWithdraw,
}: {
  r: ReviewerAssignment
  dimKeys: ('difficulty' | 'nonObviousness' | 'novelty')[]
  dimLabels: string[]
  onWithdraw?: () => void
}) {
  const { userById, config } = useStore()
  const u = userById(r.userId)
  const ws = r.score ? weightedScore(r.score, config) : 0
  return (
    <div className={cn('flex gap-4 rounded-lg border bg-card p-4', r.declined && 'bg-slate-50')}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#12141f] text-xs font-bold text-teal-400">
        {u.name.slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{u.name}</span>
          <span className="text-xs text-muted-foreground">{u.title}</span>
          {r.declined ? (
            <ToneTag tone="neutral">已拒绝</ToneTag>
          ) : r.score ? (
            <>
              <ToneTag tone={r.score.verdict === 'pass' ? 'ok' : 'danger'}>{r.score.verdict === 'pass' ? '通过' : '打回'}</ToneTag>
              <ToneTag tone={ws >= config.reviewMinWeighted ? 'neutral' : 'danger'} title={`加权均分(门禁下限 ${config.reviewMinWeighted})`}>
                <span className="font-mono-x">加权 {ws.toFixed(1)}</span>
              </ToneTag>
            </>
          ) : (
            <ToneTag tone="neutral">待审查</ToneTag>
          )}
          <span className="ml-auto flex items-center gap-2">
            {!r.score && !r.declined && r.dueDate && <DueChip date={r.dueDate} />}
            {r.score?.submittedAt && <span className="font-mono-x text-[10px] text-slate-400">{r.score.submittedAt}</span>}
            {onWithdraw && (
              <button type="button" onClick={onWithdraw} className="text-[11px] text-slate-500 hover:text-red-600 hover:underline">
                撤销邀请
              </button>
            )}
          </span>
        </div>
        {r.declined && <p className="mt-1.5 text-xs text-slate-500">拒绝原因:{r.declined.reason}</p>}
        {r.score && (
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
            <ScoreBars
              compact
              values={dimKeys.map((k) => r.score![k])}
              labels={dimLabels}
              color={r.score.verdict === 'pass' ? '#0d9488' : '#dc2626'}
            />
            <p className="flex-1 text-[13px] leading-relaxed text-slate-600">{r.score.comment}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// —— 阶段 3/4:Markdown 自由格式(实施 / 检索) ——
export function MarkdownPane({ patent, editable, stage }: PaneProps & { stage: 'implementation' | 'search' }) {
  const { saveStageData } = useStore()
  const [md, setMd] = useState(patent.stageData[stage].markdown)
  const [preview, setPreview] = useState(!editable || !!patent.stageData[stage].markdown)

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex rounded-md border bg-card p-0.5">
          <button
            type="button"
            onClick={() => setPreview(false)}
            disabled={!editable}
            className={cn(
              'flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] transition-colors disabled:opacity-40 focus-visible:outline-none',
              !preview ? 'bg-[#12141f] font-medium text-white' : 'text-slate-600',
            )}
          >
            <PencilLine className="size-3.5" />
            编辑
          </button>
          <button
            type="button"
            onClick={() => setPreview(true)}
            className={cn(
              'flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-none',
              preview ? 'bg-[#12141f] font-medium text-white' : 'text-slate-600',
            )}
          >
            <Eye className="size-3.5" />
            预览
          </button>
        </div>
        <span className="text-xs text-muted-foreground">
          {stage === 'implementation' ? '实施阶段暂不结构化,直接解析 Markdown' : '检索报告为自由格式 Markdown'}
        </span>
      </div>

      {preview ? (
        <div className="md-preview min-h-40 rounded-lg border bg-card p-5">
          {md ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown> : (
            <p className="text-sm text-muted-foreground">暂无内容。</p>
          )}
        </div>
      ) : (
        <textarea
          rows={14}
          value={md}
          onChange={(e) => setMd(e.target.value)}
          className={cn(fieldCls, 'font-mono-x text-[13px] leading-relaxed')}
          placeholder={'## 标题\n\n支持 Markdown:列表、表格、代码块、引用……'}
        />
      )}

      <SaveBar editable={editable} onSave={(note) => {
        saveStageData(patent.id, stage, { markdown: md } satisfies MarkdownStageData, note)
        setPreview(true)
      }} />
    </div>
  )
}

// —— 阶段 5:DOI 撰写 ——
export function DoiPane({ patent, editable }: PaneProps) {
  const { saveStageData } = useStore()
  const [form, setForm] = useState<DoiData>({ ...patent.stageData.doi })

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="ui-label text-slate-500">论文标题</label>
          <input
            disabled={!editable} value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className={fieldCls}
          />
        </div>
        <div>
          <label className="ui-label text-slate-500">作者</label>
          <input
            disabled={!editable} value={form.authors}
            onChange={(e) => setForm({ ...form, authors: e.target.value })}
            className={fieldCls}
          />
        </div>
        <div>
          <label className="ui-label text-slate-500">目标期刊 / 会议</label>
          <input
            disabled={!editable} value={form.venue}
            onChange={(e) => setForm({ ...form, venue: e.target.value })}
            className={fieldCls}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="ui-label text-slate-500">摘要草稿</label>
          <textarea
            rows={5} disabled={!editable} value={form.abstractDraft}
            onChange={(e) => setForm({ ...form, abstractDraft: e.target.value })}
            className={fieldCls}
          />
        </div>
      </div>
      <SaveBar editable={editable} onSave={(note) => saveStageData(patent.id, 'doi', form, note)} />
    </div>
  )
}

export type { StageKey }
