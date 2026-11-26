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
export interface ArchivedInfo {
  kind: 'completed' | 'abandoned' // 完成归档 / 放弃归档
  at: string
  by: string
  reason: string
}

// —— 专利周期(项目级时间窗口,GL 定义;一切自定周期都必须落在其中) ——
export interface Cycle {
  id: string
  name: string
  start: string // YYYY-MM-DD
  end: string
  status: 'active' | 'closed'
  closedAt?: string
}

// —— 延期申请(分级审批:≤阈值自动生效,>阈值需 PL/GL 批准) ——
export interface StageExtension {
  id: string
  stage: StageKey
  oldDue: string
  newDue: string
  reason: string
  by: string
  at: string
  status: 'applied' | 'pending' | 'rejected'
  approvedBy?: string
}

export interface Patent {
  id: string
  code: string
  title: string
  ownerId: string
  collaborators: string[] // 共同发明人:可编辑内容,但不能推进/回退/归档
  teamId: string
  visibility: Visibility
  stage: StageKey
  crossCycle: boolean // GL 标记:跨周期项目,豁免收口压力(KPI 事件默认照计)
  archived: ArchivedInfo | null
  createdAt: string
  dueDates: Partial<Record<StageKey, string>>
  extensions: StageExtension[]
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
  cycleId: string // 绑定专利周期:统计窗口 = 周期起止
  targets: KpiTarget[]
  // 预留:自由计算回调(单项目/整体),默认按比例给分
  scorerHook: string | null
  enabled: boolean // 停用的规则不参与仪表盘统计
  createdBy: string
  updatedAt: string
}

// —— 审查维度(GL 可配:显示名 + 权重) ——
export interface ReviewDim {
  key: 'difficulty' | 'nonObviousness' | 'novelty'
  label: string
  weight: number
}

// —— 全局配置 ——
export interface OverduePolicy {
  extensionApprovalThreshold: number // 延期天数 ≤ 该值自动生效,否则需 PL/GL 批准
  freezeAdvanceOnOverdue: boolean // 阶段逾期时是否冻结推进(默认否)
  autoNudge: 'off' | '3d' | '7d' // 自动催办节奏(demo 仅配置占位)
  includeCrossCycleInKpi: boolean // 跨周期标记专利是否计入 KPI
}

export interface SystemConfig {
  reviewPassCount: number // GL 配置:至少 n 名 reviewer 通过
  reviewMinWeighted: number // GL 配置:加权均分下限,低于该值的「通过」不计入门禁
  reviewDims: ReviewDim[]
  stageDefaults: Record<StageKey, number> // 各阶段默认周期(天),新建/推进时自动算出 due date
  classSuggestions: string[] // class 自由文本的建议词表(输入联想,不强制)
  numberPrefix: string // 专利编号前缀,如 PF
  webhookUrl: string
  ssoProviders: { name: string; issuer: string; enabled: boolean }[]
  // 通知默认接收人(事件 × 角色);专利级配置可覆盖
  notifyDefaults: Record<NotifyEvent, { owner: boolean; pl: boolean; gl: boolean }>
  overdue: OverduePolicy
}

// —— 个人 API Token ——
export interface ApiToken {
  id: string
  userId: string
  name: string
  token: string
  createdAt: string
  expiresAt: string
  revoked: boolean
}

// —— 个人偏好 ——
export interface UserPrefs {
  notifyEvents: Record<NotifyEvent, boolean> // 哪些事件进入我的通知流
  dueReminderDays: number[] // 截止提醒提前量(天),如 [3,1,0]
  quietHours: string // 免打扰时段,如 22:00-08:00
  defaultVisibility: Visibility // 新建专利默认可见性
  homePage: 'dashboard' | 'patents' // 默认着陆页
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
