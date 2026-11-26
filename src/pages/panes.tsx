import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { useStore, weightedScore } from '@/lib/store'
import type {
  DoiData, DraftData, MarkdownStageData, Patent, ReviewScore, StageKey,
} from '@/lib/types'
import { RadarChart } from '@/components/pf'
import { CheckCircle2, Eye, PencilLine, Send, UserPlus, XCircle } from 'lucide-react'

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
          <label className="ui-label text-slate-500" htmlFor="f-bg">背景 · BACKGROUND</label>
          <textarea
            id="f-bg" rows={4} disabled={!editable}
            value={form.background}
            onChange={(e) => setForm({ ...form, background: e.target.value })}
            className={fieldCls}
            placeholder="现有技术的问题、场景与痛点……"
          />
        </div>
        <div>
          <label className="ui-label text-slate-500" htmlFor="f-cls">分类 · CLASS(自由文本,带词表联想)</label>
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
          <label className="ui-label text-slate-500" htmlFor="f-idea">核心构思 · IDEA</label>
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

// —— 阶段 2:可专利性审查(三维度 + reviewer 门禁) ——
export function PatentabilityPane({ patent, editable }: PaneProps) {
  const { me, config, users, userById, inviteReviewer, submitReview, saveStageData, reviewPassCount, isReviewerOf } = useStore()
  const d = patent.stageData.patentability
  const dimLabels = config.reviewDims.map((x) => x.label)
  const dimKeys = config.reviewDims.map((x) => x.key)
  const [summary, setSummary] = useState(d.summary)
  const [inviteId, setInviteId] = useState('')
  const [self, setSelf] = useState(d.selfAssessment)

  const myAssignment = d.reviewers.find((r) => r.userId === me.id)
  const iAmPendingReviewer = !!myAssignment && !myAssignment.score
  const passCount = reviewPassCount(patent)
  const gateOpen = passCount >= config.reviewPassCount

  // reviewer 打分表单
  const [score, setScore] = useState<ReviewScore>({
    difficulty: 3, nonObviousness: 3, novelty: 3, comment: '', verdict: 'pass',
  })
  const [blockMsg, setBlockMsg] = useState('')

  const candidates = users.filter(
    (u) => u.id !== patent.ownerId && !d.reviewers.some((r) => r.userId === u.id),
  )

  return (
    <div className="space-y-6">
      {/* 审查摘要 + 自评 */}
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className="ui-label text-slate-500" htmlFor="f-sum">审查摘要 · SUMMARY</label>
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
          <div className="ui-label text-slate-500">发明人自评 · SELF-ASSESSMENT</div>
          <div className="mt-1 flex items-center gap-3">
            <RadarChart values={[self.difficulty, self.nonObviousness, self.novelty]} size={150} color="#64748b" />
            <div className="flex-1 space-y-2">
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
                <p className="text-xs leading-relaxed text-slate-600">{self.comment || '未填写自评意见'}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 门禁状态 */}
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg border px-4 py-3',
          gateOpen ? 'border-teal-200 bg-teal-50' : 'border-amber-200 bg-amber-50',
        )}
      >
        {gateOpen
          ? <CheckCircle2 className="size-5 shrink-0 text-teal-700" />
          : <XCircle className="size-5 shrink-0 text-amber-600" />}
        <div className="text-sm">
          <span className="font-semibold">
            审查门禁:{passCount} / {config.reviewPassCount} 通过
          </span>
          <span className="ml-2 text-slate-600">
            {gateOpen
              ? '已满足门禁条件,可推进至实施阶段。'
              : `GL 设定:至少 ${config.reviewPassCount} 名 reviewer 通过,且「通过」的加权均分 ≥ ${config.reviewMinWeighted}。任一打回将自动退回草案。`}
          </span>
        </div>
      </div>

      {/* reviewer 列表 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="ui-label text-slate-500">REVIEWERS · 受邀审查人</span>
          {editable && (
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
                邀请(无需审批)
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          {d.reviewers.length === 0 && (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              尚未邀请 reviewer。邀请后对方将收到通知回调。
            </div>
          )}
          {d.reviewers.map((r) => {
            const u = userById(r.userId)
            return (
              <div key={r.userId} className="flex gap-4 rounded-lg border bg-card p-4">
                <div className="shrink-0">
                  <span className="flex size-9 items-center justify-center rounded-md bg-[#12141f] font-mono-x text-xs font-bold text-teal-400">
                    {u.name.slice(0, 1)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{u.name}</span>
                    <span className="text-xs text-muted-foreground">{u.title}</span>
                    {r.score ? (
                      <>
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          r.score.verdict === 'pass' ? 'bg-teal-100 text-teal-800' : 'bg-red-100 text-red-700',
                        )}>
                          {r.score.verdict === 'pass' ? '通过' : '打回'}
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 font-mono-x text-[11px]',
                            weightedScore(r.score, config) >= config.reviewMinWeighted
                              ? 'bg-slate-100 text-slate-600'
                              : 'bg-red-50 text-red-600',
                          )}
                          title={`加权均分(门禁下限 ${config.reviewMinWeighted})`}
                        >
                          加权 {weightedScore(r.score, config).toFixed(1)}
                        </span>
                      </>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">待审查</span>
                    )}
                    <span className="ml-auto font-mono-x text-[10px] text-slate-400">
                      {r.score?.submittedAt ?? `邀请于 ${r.invitedAt}`}
                    </span>
                  </div>
                  {r.score && (
                    <div className="mt-2.5 flex items-start gap-4">
                      <RadarChart
                        values={[r.score.difficulty, r.score.nonObviousness, r.score.novelty]}
                        size={118}
                        color={r.score.verdict === 'pass' ? '#0d9488' : '#dc2626'}
                      />
                      <p className="flex-1 text-[13px] leading-relaxed text-slate-600">{r.score.comment}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* reviewer 打分表单:仅当前用户是被邀请且未提交时可见 */}
      {iAmPendingReviewer && (
        <div className="rounded-lg border-2 border-teal-600/60 bg-teal-50/40 p-5">
          <div className="ui-label text-teal-700">YOUR REVIEW · 请完成三维度审查</div>
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
            placeholder="审查意见(打回时必填,将作为回退原因记录)"
            className={cn(fieldCls, 'mt-3')}
          />
          <div className="mt-2 text-xs text-slate-500">
            当前加权均分:<span className="font-mono-x font-bold text-teal-700">{weightedScore(score, config).toFixed(1)}</span>
            <span className="text-slate-400">(GL 门禁下限 {config.reviewMinWeighted},低于下限的「通过」将被拦截)</span>
          </div>
          {blockMsg && <p className="mt-2 text-xs font-medium text-red-600">{blockMsg}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                const r = submitReview(patent.id, { ...score, verdict: 'pass' })
                setBlockMsg(r === 'below-min'
                  ? `加权均分低于 GL 设定的下限 ${config.reviewMinWeighted},「通过」未生效 —— 请提高评分或改判打回`
                  : '')
              }}
              className="flex items-center gap-1.5 rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              <Send className="size-4" />
              提交 · 通过
            </button>
            <button
              type="button"
              onClick={() => score.comment.trim()
                ? submitReview(patent.id, { ...score, verdict: 'reject' })
                : alert('打回时请填写审查意见,将自动回退到草案阶段')}
              className="flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <XCircle className="size-4" />
              提交 · 打回
            </button>
          </div>
        </div>
      )}
      {!iAmPendingReviewer && isReviewerOf(patent) && myAssignment?.score && (
        <p className="text-xs text-muted-foreground">你已提交本专利的审查意见({myAssignment.score.verdict === 'pass' ? '通过' : '打回'})。</p>
      )}
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
          <label className="ui-label text-slate-500">论文标题 · TITLE</label>
          <input
            disabled={!editable} value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className={fieldCls}
          />
        </div>
        <div>
          <label className="ui-label text-slate-500">作者 · AUTHORS</label>
          <input
            disabled={!editable} value={form.authors}
            onChange={(e) => setForm({ ...form, authors: e.target.value })}
            className={fieldCls}
          />
        </div>
        <div>
          <label className="ui-label text-slate-500">目标期刊 / 会议 · VENUE</label>
          <input
            disabled={!editable} value={form.venue}
            onChange={(e) => setForm({ ...form, venue: e.target.value })}
            className={fieldCls}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="ui-label text-slate-500">摘要草稿 · ABSTRACT DRAFT</label>
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
