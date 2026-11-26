// PATENTFLOW 领域模型(与后端 REST API 的 JSON 结构一一对应)

export type Role = 'user' | 'pl' | 'gl'
export type StageKey = 'draft' | 'patentability' | 'implementation' | 'search' | 'doi'
export type Visibility = 'private' | 'team' | 'public'
export type ReviewVerdict = 'pass' | 'reject' | 'pending'

export interface User {
  id: string
  name: string
  role: Role
  teamId: string
  email: string
  title: string
  ssoBound: boolean
  ssoIssuer?: string
}

export interface Team {
  id: string
  name: string
  plId: string
}

export interface StageInfo {
  key: StageKey
  label: string
  en: string
}

export const STAGES: StageInfo[] = [
  { key: 'draft', label: '草案', en: 'DRAFT' },
  { key: 'patentability', label: '可专利性审查', en: 'PATENTABILITY' },
  { key: 'implementation', label: '专利实施', en: 'IMPLEMENTATION' },
  { key: 'search', label: '专利检索', en: 'SEARCH' },
  { key: 'doi', label: 'DOI 撰写', en: 'DOI' },
]

export const stageIndex = (k: StageKey) => STAGES.findIndex((s) => s.key === k)
export const stageLabel = (k: StageKey) => STAGES.find((s) => s.key === k)!.label

// —— 各阶段数据 ——
export interface DraftData {
  background: string
  classification: string
  idea: string
}

export interface ReviewScore {
  difficulty: number // 技术难度 1-5
  nonObviousness: number // 非显而易见性 1-5
  novelty: number // 创新性 1-5
  comment: string
  verdict: ReviewVerdict
  submittedAt?: string
}

export interface ReviewerAssignment {
  userId: string
  invitedBy: string
  invitedAt: string
  score: ReviewScore | null
}

export interface PatentabilityData {
  summary: string
  selfAssessment: ReviewScore // 发明人自评
  reviewers: ReviewerAssignment[]
}

export interface MarkdownStageData {
  markdown: string
}

export interface DoiData {
  title: string
  authors: string
  venue: string
  abstractDraft: string
}

export type StageDataMap = {
  draft: DraftData
  patentability: PatentabilityData
  implementation: MarkdownStageData
  search: MarkdownStageData
  doi: DoiData
}

// —— 版本控制 ——
export interface StageVersion {
  version: number
  patentId: string
  stage: StageKey
  note: string
  authorId: string
  at: string
  snapshot: unknown
}

export interface StageTransition {
  id: string
  patentId: string
  from: StageKey | null
  to: StageKey
  operatorId: string
  at: string
  reason: string
  kind: 'advance' | 'rollback' | 'reject'
}

// —— 通知配置 ——
export type NotifyEvent = 'review' | 'due' | 'transition'

export interface StageNotifyConfig {
  stage: StageKey
  userIds: string[]
  includePl: boolean
  includeOwner: boolean
  events: NotifyEvent[]
}

// —— 专利 ——
export interface Patent {
  id: string
  code: string
  title: string
  ownerId: string
  teamId: string
  visibility: Visibility
  stage: StageKey
  createdAt: string
  dueDates: Partial<Record<StageKey, string>>
  stageData: StageDataMap
  notify: StageNotifyConfig[]
}

// —— KPI ——
export interface KpiTarget {
  stage: StageKey
  deadline: string
}

export interface KpiRule {
  id: string
  name: string
  scope: { type: 'team' | 'global'; teamId?: string }
  windowStart: string
  targets: KpiTarget[]
  // 预留:自由计算回调(单项目/整体),默认按比例给分
  scorerHook: string | null
  createdBy: string
}

// —— 全局配置 ——
export interface SystemConfig {
  reviewPassCount: number // GL 配置:至少 n 名 reviewer 通过
  webhookUrl: string
  ssoProviders: { name: string; issuer: string; enabled: boolean }[]
}

export interface Notification {
  id: string
  event: NotifyEvent
  text: string
  at: string
  read: boolean
  patentId: string
}

export const NOTIFY_EVENT_LABEL: Record<NotifyEvent, string> = {
  review: '审查动态',
  due: '截止提醒',
  transition: '阶段流转',
}

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: '私有',
  team: '团队可见',
  public: '公开',
}

export const ROLE_LABEL: Record<Role | 'reviewer', string> = {
  user: '普通用户',
  pl: 'PL',
  gl: 'GL',
  reviewer: 'Reviewer',
}
