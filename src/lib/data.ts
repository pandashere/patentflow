import type {
  KpiRule, Notification, Patent, SystemConfig, Team, User,
} from './types'

// —— 租户:三个团队 ——
export const TEAMS: Team[] = [
  { id: 't1', name: '平台技术组', plId: 'u-linzf' },
  { id: 't2', name: '算法研究组', plId: 'u-hejing' },
  { id: 't3', name: '硬件系统组', plId: 'u-zhaolei' },
]

export const USERS: User[] = [
  { id: 'u-chenxi', name: '陈曦', role: 'user', teamId: 't1', email: 'chenxi@corp.local', title: '高级工程师', ssoBound: true, ssoIssuer: 'corp-oidc' },
  { id: 'u-linzf', name: '林致远', role: 'pl', teamId: 't1', email: 'linzy@corp.local', title: '平台技术组 PL', ssoBound: true, ssoIssuer: 'corp-oidc' },
  { id: 'u-guyq', name: '顾云旗', role: 'gl', teamId: 't1', email: 'guyq@corp.local', title: '研发部 GL', ssoBound: false },
  { id: 'u-suman', name: '苏漫', role: 'user', teamId: 't2', email: 'suman@corp.local', title: '算法专家 · 常任 Reviewer', ssoBound: true, ssoIssuer: 'corp-oidc' },
  { id: 'u-hejing', name: '何静', role: 'pl', teamId: 't2', email: 'hejing@corp.local', title: '算法研究组 PL', ssoBound: true, ssoIssuer: 'corp-oidc' },
  { id: 'u-zhaolei', name: '赵磊', role: 'pl', teamId: 't3', email: 'zhaolei@corp.local', title: '硬件系统组 PL', ssoBound: false },
  { id: 'u-wangfang', name: '王舫', role: 'user', teamId: 't1', email: 'wangfang@corp.local', title: '工程师', ssoBound: true, ssoIssuer: 'corp-oidc' },
  { id: 'u-qinyue', name: '秦悦', role: 'user', teamId: 't2', email: 'qinyue@corp.local', title: '研究员', ssoBound: true, ssoIssuer: 'ldap' },
  { id: 'u-duanmu', name: '端木睿', role: 'user', teamId: 't3', email: 'duanmu@corp.local', title: '硬件工程师', ssoBound: false },
  { id: 'u-shaoqi', name: '邵琪', role: 'user', teamId: 't2', email: 'shaoqi@corp.local', title: '研究员', ssoBound: true, ssoIssuer: 'corp-oidc' },
]

export const userById = (id: string) => USERS.find((u) => u.id === id)!
export const teamById = (id: string) => TEAMS.find((t) => t.id === id)!

export const CONFIG: SystemConfig = {
  reviewPassCount: 2,
  webhookUrl: 'https://im-bot.corp.local/hook/patentflow',
  ssoProviders: [
    { name: '企业统一认证 (OIDC)', issuer: 'corp-oidc', enabled: true },
    { name: 'LDAP 域账号', issuer: 'ldap', enabled: true },
    { name: '本地账密', issuer: 'local', enabled: true },
  ],
}

const emptyScore = { difficulty: 0, nonObviousness: 0, novelty: 0, comment: '', verdict: 'pending' as const }

export const PATENTS: Patent[] = [
  {
    id: 'p1', code: 'PF-2026-011', title: '基于差分隐私的跨中心医疗影像分割方法',
    ownerId: 'u-chenxi', teamId: 't1', visibility: 'team', stage: 'patentability',
    archived: null,
    createdAt: '2026-09-14',
    dueDates: { draft: '2026-09-30', patentability: '2026-12-05', implementation: '2027-01-31' },
    stageData: {
      draft: {
        background: '多中心医疗影像联合建模受限于数据隐私法规,影像数据无法出院。现有联邦学习方案在 Non-IID 影像数据上分割精度下降明显(Dice 平均下降 8-12%),且缺乏形式化隐私保证。',
        classification: '医疗影像 / 联邦学习 / 差分隐私;G06T 7/00, G16H 30/40',
        idea: '在客户端本地引入自适应噪声调度的 DP-SGD 变体,按层敏感度分配隐私预算;服务端聚合前增加基于可信执行环境的安全对齐模块,缓解 Non-IID 下的梯度漂移。',
      },
      patentability: {
        summary: '核心创新点:层级隐私预算分配 + TEE 安全聚合对齐。初步检索未见完全重合方案。',
        selfAssessment: { ...emptyScore, difficulty: 4, nonObviousness: 4, novelty: 4, verdict: 'pass', comment: '自评:预算分配策略与现有均匀/等比分配有本质差异。', submittedAt: '2026-11-10' },
        reviewers: [
          { userId: 'u-suman', invitedBy: 'u-chenxi', invitedAt: '2026-11-08', score: { difficulty: 4, nonObviousness: 5, novelty: 4, verdict: 'pass', comment: '层级敏感度分配的思路新颖,建议补充与 PATE 方案的对比实验。', submittedAt: '2026-11-19' } },
          { userId: 'u-hejing', invitedBy: 'u-chenxi', invitedAt: '2026-11-08', score: null },
        ],
      },
      implementation: { markdown: '' },
      search: { markdown: '' },
      doi: { title: '', authors: '', venue: '', abstractDraft: '' },
    },
    notify: [],
  },
  {
    id: 'p2', code: 'PF-2026-009', title: '低功耗蓝牙 Mesh 网络的自适应中继选择方法',
    ownerId: 'u-chenxi', teamId: 't1', visibility: 'public', stage: 'implementation',
    archived: null,
    createdAt: '2026-08-02',
    dueDates: { implementation: '2026-12-10', search: '2027-02-28' },
    stageData: {
      draft: {
        background: '仓储场景 BLE Mesh 节点密集、货架遮挡多变,固定中继策略导致端到端时延抖动大、部分节点电池寿命不足 6 个月。',
        classification: '物联网 / BLE Mesh / 路由算法;H04W 40/02',
        idea: '基于链路质量与剩余电量的双因子中继打分,辅以滑动窗口预测拥塞,动态切换中继路径。',
      },
      patentability: {
        summary: '审查已通过(2/2 通过)。',
        selfAssessment: { ...emptyScore, difficulty: 3, nonObviousness: 3, novelty: 3, verdict: 'pass', submittedAt: '2026-09-01' },
        reviewers: [
          { userId: 'u-wangfang', invitedBy: 'u-chenxi', invitedAt: '2026-08-20', score: { difficulty: 3, nonObviousness: 4, novelty: 3, verdict: 'pass', comment: '双因子打分工程价值明确。', submittedAt: '2026-08-30' } },
          { userId: 'u-qinyue', invitedBy: 'u-chenxi', invitedAt: '2026-08-20', score: { difficulty: 3, nonObviousness: 3, novelty: 4, verdict: 'pass', comment: '建议权利要求覆盖预测窗口部分。', submittedAt: '2026-09-02' } },
        ],
      },
      implementation: {
        markdown: '## 实施方案\n\n### 系统组成\n- **节点固件**:在 nRF52840 上实现中继打分模块(约 2KB RAM 开销)\n- **打分因子**:RSSI 滑动均值 × 剩余电量归一化值\n- **切换策略**:打分差值 > 阈值且持续 3 个周期才切换,避免乒乓\n\n### 验证计划\n1. 实验室 20 节点网格环境基准测试\n2. 三号仓库实地部署 2 周,对比时延 P99 与电量衰减\n\n### 里程碑\n| 时间 | 事项 |\n|---|---|\n| 12 月上旬 | 固件联调完成 |\n| 12 月下旬 | 实地部署 |\n| 1 月中旬 | 数据回归与权利要求定稿 |',
      },
      search: { markdown: '' },
      doi: { title: '', authors: '', venue: '', abstractDraft: '' },
    },
    notify: [],
  },
  {
    id: 'p3', code: 'PF-2026-014', title: '面向边缘网关的容器化协议转换热更新机制',
    ownerId: 'u-chenxi', teamId: 't1', visibility: 'private', stage: 'draft',
    archived: null,
    createdAt: '2026-11-18',
    dueDates: { draft: '2026-12-20' },
    stageData: {
      draft: {
        background: '工厂边缘网关需要频繁更新 Modbus/OPC-UA 等协议转换逻辑,当前整包固件升级导致产线通信中断 2-5 分钟,不可接受。',
        classification: '边缘计算 / 容器 / 工业协议',
        idea: '初步想法:把每种协议转换器做成 WASM 插件,通过控制面下发 + 双缓冲热切换。需要进一步验证 WASM 在实时性上的损耗。',
      },
      patentability: { summary: '', selfAssessment: emptyScore, reviewers: [] },
      implementation: { markdown: '' },
      search: { markdown: '' },
      doi: { title: '', authors: '', venue: '', abstractDraft: '' },
    },
    notify: [],
  },
  {
    id: 'p4', code: 'PF-2026-007', title: '基于时序图神经网络的产线设备异常预警方法',
    ownerId: 'u-qinyue', teamId: 't2', visibility: 'team', stage: 'search',
    archived: null,
    createdAt: '2026-06-11',
    dueDates: { search: '2026-12-15', doi: '2027-03-01' },
    stageData: {
      draft: {
        background: 'SMT 产线设备故障平均每月造成 14 小时停机。现有阈值告警误报率高,无法捕捉多设备耦合的前兆模式。',
        classification: '工业互联网 / 图神经网络 / 时序预测',
        idea: '以设备拓扑为图结构、传感器时序为节点特征,训练时空图网络预测未来 4 小时异常概率。',
      },
      patentability: {
        summary: '审查已通过。',
        selfAssessment: { ...emptyScore, difficulty: 4, nonObviousness: 4, novelty: 4, verdict: 'pass', submittedAt: '2026-07-20' },
        reviewers: [
          { userId: 'u-suman', invitedBy: 'u-qinyue', invitedAt: '2026-07-15', score: { difficulty: 4, nonObviousness: 4, novelty: 4, verdict: 'pass', comment: '图构建方式是差异点。', submittedAt: '2026-07-25' } },
          { userId: 'u-linzf', invitedBy: 'u-qinyue', invitedAt: '2026-07-15', score: { difficulty: 4, nonObviousness: 3, novelty: 4, verdict: 'pass', comment: '通过,注意检索时覆盖工艺专利。', submittedAt: '2026-07-28' } },
        ],
      },
      implementation: { markdown: '## 实施摘要\n\n已完成三号楼产线 46 台设备的数据接入,图结构由 MES 系统工艺路线自动生成。' },
      search: {
        markdown: '## 检索报告(进行中)\n\n**检索库**:CNIPA、Derwent、IEEE Xplore\n\n**检索式**:(GNN OR "graph neural") AND (predictive maintenance OR 故障预警) AND 时序\n\n**初步结果**:命中 37 件,其中 3 件需要重点比对:\n- CN114xxxxxxA:用了图网络,但是静态图,无拓扑演化\n- US2024/0xxxxxx:面向电网,图构建基于电气连接,与我们基于工艺路线不同\n\n> 待办:补充 Derwent 手工代码段的检索',
      },
      doi: { title: '', authors: '', venue: '', abstractDraft: '' },
    },
    notify: [],
  },
  {
    id: 'p5', code: 'PF-2026-005', title: '多租户 SaaS 环境下的细粒度数据权限缓存方法',
    ownerId: 'u-wangfang', teamId: 't1', visibility: 'team', stage: 'doi',
    archived: null,
    createdAt: '2026-03-05',
    dueDates: { doi: '2026-12-31' },
    stageData: {
      draft: { background: '权限判断在高并发下成为瓶颈。', classification: 'SaaS / 权限 / 缓存', idea: '权限版本号 + 分层失效。' },
      patentability: {
        summary: '审查已通过。',
        selfAssessment: { ...emptyScore, difficulty: 3, nonObviousness: 4, novelty: 3, verdict: 'pass', submittedAt: '2026-04-01' },
        reviewers: [
          { userId: 'u-linzf', invitedBy: 'u-wangfang', invitedAt: '2026-03-28', score: { difficulty: 3, nonObviousness: 4, novelty: 3, verdict: 'pass', comment: '工程创新扎实。', submittedAt: '2026-04-05' } },
          { userId: 'u-suman', invitedBy: 'u-wangfang', invitedAt: '2026-03-28', score: { difficulty: 3, nonObviousness: 4, novelty: 4, verdict: 'pass', comment: '同意通过。', submittedAt: '2026-04-06' } },
        ],
      },
      implementation: { markdown: '已上线灰度两个季度,P99 权限判断延迟从 34ms 降至 3ms。' },
      search: { markdown: '## 检索结论\n\n检索完成,未发现破坏新颖性的对比文件。' },
      doi: {
        title: 'Fine-grained Permission Caching for Multi-tenant SaaS',
        authors: '王舫, 林致远, 陈曦',
        venue: 'IEEE Transactions on Services Computing',
        abstractDraft: 'This paper presents a versioned, layered invalidation scheme for permission caching in multi-tenant SaaS systems...',
      },
    },
    notify: [],
  },
  {
    id: 'p6', code: 'PF-2026-012', title: '用于 AGV 调度的动态死锁检测与解除方法',
    ownerId: 'u-duanmu', teamId: 't3', visibility: 'public', stage: 'patentability',
    archived: null,
    createdAt: '2026-10-09',
    dueDates: { patentability: '2026-11-30' },
    stageData: {
      draft: { background: '仓储 AGV 在窄通道会车时死锁频发。', classification: 'AGV / 调度 / 死锁检测', idea: '基于资源分配图的增量式环路检测。' },
      patentability: {
        summary: '待审查,已邀请 2 名 reviewer。',
        selfAssessment: { ...emptyScore, difficulty: 4, nonObviousness: 3, novelty: 3, verdict: 'pass', submittedAt: '2026-10-20' },
        reviewers: [
          { userId: 'u-suman', invitedBy: 'u-duanmu', invitedAt: '2026-11-12', score: null },
          { userId: 'u-zhaolei', invitedBy: 'u-duanmu', invitedAt: '2026-11-12', score: { difficulty: 3, nonObviousness: 4, novelty: 4, verdict: 'pass', comment: '复审:聚焦栅格拓扑先验后创新点成立,同意通过。', submittedAt: '2026-11-20' } },
        ],
      },
      implementation: { markdown: '' },
      search: { markdown: '' },
      doi: { title: '', authors: '', venue: '', abstractDraft: '' },
    },
    notify: [],
  },
  {
    id: 'p7', code: 'PF-2026-016', title: '基于语义切分的研发文档自动脱敏方法',
    ownerId: 'u-shaoqi', teamId: 't2', visibility: 'team', stage: 'draft',
    archived: null,
    createdAt: '2026-11-20',
    dueDates: { draft: '2026-12-28' },
    stageData: {
      draft: { background: '研发文档外发前人工脱敏效率低、遗漏率高。', classification: 'NLP / 数据安全', idea: '' },
      patentability: { summary: '', selfAssessment: emptyScore, reviewers: [] },
      implementation: { markdown: '' },
      search: { markdown: '' },
      doi: { title: '', authors: '', venue: '', abstractDraft: '' },
    },
    notify: [],
  },
  {
    id: 'p8', code: 'PF-2026-003', title: '高密度服务器机柜的相变材料均温结构',
    ownerId: 'u-duanmu', teamId: 't3', visibility: 'public', stage: 'doi',
    archived: null,
    createdAt: '2026-01-16',
    dueDates: { doi: '2026-12-08' },
    stageData: {
      draft: { background: '机柜局部热点导致降频。', classification: '散热 / 相变材料', idea: 'PCM 微胶囊填充的均温板。' },
      patentability: {
        summary: '审查已通过。',
        selfAssessment: { ...emptyScore, difficulty: 3, nonObviousness: 4, novelty: 4, verdict: 'pass', submittedAt: '2026-02-10' },
        reviewers: [
          { userId: 'u-zhaolei', invitedBy: 'u-duanmu', invitedAt: '2026-02-01', score: { difficulty: 3, nonObviousness: 4, novelty: 4, verdict: 'pass', comment: '结构类专利,附图要细。', submittedAt: '2026-02-12' } },
          { userId: 'u-hejing', invitedBy: 'u-duanmu', invitedAt: '2026-02-01', score: { difficulty: 3, nonObviousness: 4, novelty: 4, verdict: 'pass', comment: '通过。', submittedAt: '2026-02-13' } },
        ],
      },
      implementation: { markdown: '样机两轮迭代完成,热点温差从 11°C 降至 4°C。' },
      search: { markdown: '检索完成,无新颖性障碍。' },
      doi: { title: 'PCM-based Heat Spreading Structure for Dense Server Racks', authors: '端木睿, 赵磊', venue: 'Applied Thermal Engineering', abstractDraft: '' },
    },
    notify: [],
  },
  {
    id: 'p9', code: 'PF-2025-021', title: '基于二维码动态刷新的会议签到防代签方法',
    ownerId: 'u-wangfang', teamId: 't1', visibility: 'team', stage: 'search',
    archived: { kind: 'abandoned', at: '2026-05-20 16:10', by: 'u-wangfang', reason: '检索发现 CN113xxxxxxA 已覆盖核心方案,新颖性不成立,终止' },
    createdAt: '2025-12-08',
    dueDates: {},
    stageData: {
      draft: { background: '静态二维码签到可被拍照转发代签。', classification: '签到 / 动态码', idea: '倒计时动态刷新 + 地理位置校验。' },
      patentability: {
        summary: '审查已通过。',
        selfAssessment: { ...emptyScore, difficulty: 2, nonObviousness: 3, novelty: 3, verdict: 'pass', submittedAt: '2026-01-10' },
        reviewers: [
          { userId: 'u-linzf', invitedBy: 'u-wangfang', invitedAt: '2026-01-05', score: { difficulty: 2, nonObviousness: 3, novelty: 3, verdict: 'pass', comment: '方案完整,通过。', submittedAt: '2026-01-12' } },
          { userId: 'u-suman', invitedBy: 'u-wangfang', invitedAt: '2026-01-05', score: { difficulty: 2, nonObviousness: 3, novelty: 2, verdict: 'pass', comment: '通过,注意检索动态口令类在先技术。', submittedAt: '2026-01-13' } },
        ],
      },
      implementation: { markdown: '原型已完成,签到 App 内测中。' },
      search: { markdown: '## 检索发现\n\nCN113xxxxxxA(2021)公开了动态刷新二维码 + 地理位置双重校验的签到方案,权利要求 1 与本方案核心重叠。\n\n**结论**:新颖性不成立,建议放弃。' },
      doi: { title: '', authors: '', venue: '', abstractDraft: '' },
    },
    notify: [],
  },
]
// 版本历史(示例)
export const VERSIONS: import('./types').StageVersion[] = [
  { version: 1, patentId: 'p1', stage: 'draft', authorId: 'u-chenxi', at: '2026-09-14 10:24', note: '创建草案', snapshot: { background: '多中心影像建模受隐私限制……(初稿)', classification: '医疗影像', idea: '联邦学习 + 差分隐私(粗略想法)' } },
  { version: 2, patentId: 'p1', stage: 'draft', authorId: 'u-chenxi', at: '2026-09-21 16:02', note: '补充 TEE 聚合思路,细化分类号', snapshot: { background: '(同当前)多中心医疗影像联合建模受限于数据隐私法规……', classification: 'G06T 7/00, G16H 30/40', idea: 'DP-SGD + TEE 对齐(第二版)' } },
  { version: 3, patentId: 'p1', stage: 'draft', authorId: 'u-chenxi', at: '2026-09-28 09:41', note: '按 PL 意见补充现有方案对比数据', snapshot: { background: '现行版本(含 Dice 下降 8-12% 数据)', classification: 'G06T 7/00, G16H 30/40', idea: '层级隐私预算分配 + TEE 安全聚合对齐' } },
  { version: 1, patentId: 'p1', stage: 'patentability', authorId: 'u-chenxi', at: '2026-11-08 14:00', note: '提交自评,邀请苏漫、何静审查', snapshot: null },
  { version: 1, patentId: 'p6', stage: 'draft', authorId: 'u-duanmu', at: '2026-10-09 11:12', note: '创建草案', snapshot: null },
  { version: 2, patentId: 'p6', stage: 'draft', authorId: 'u-duanmu', at: '2026-11-12 09:10', note: '按打回意见重写创新点,聚焦仓储窄通道拓扑', snapshot: { background: '仓储 AGV 在窄通道会车时死锁频发……', classification: 'AGV / 调度 / 死锁检测', idea: '利用仓储地图的栅格拓扑先验做增量环路检测' } },
]

export const TRANSITIONS: import('./types').StageTransition[] = [
  { id: 'tr1', patentId: 'p1', from: null, to: 'draft', operatorId: 'u-chenxi', at: '2026-09-14 10:24', reason: '创建专利', kind: 'advance' },
  { id: 'tr2', patentId: 'p1', from: 'draft', to: 'patentability', operatorId: 'u-chenxi', at: '2026-11-08 14:00', reason: '草案内容完备,提交可专利性审查', kind: 'advance' },
  { id: 'tr5', patentId: 'p2', from: 'patentability', to: 'implementation', operatorId: 'u-chenxi', at: '2026-09-03 10:00', reason: '审查 2/2 通过,进入实施', kind: 'advance' },
  { id: 'tr6', patentId: 'p4', from: 'implementation', to: 'search', operatorId: 'u-qinyue', at: '2026-10-15 14:20', reason: '实施完成,转入检索', kind: 'advance' },
  { id: 'tr7', patentId: 'p5', from: 'search', to: 'doi', operatorId: 'u-wangfang', at: '2026-11-25 11:03', reason: '检索无新颖性障碍,进入 DOI 撰写', kind: 'advance' },
  { id: 'tr8', patentId: 'p8', from: 'search', to: 'doi', operatorId: 'u-duanmu', at: '2026-06-30 16:40', reason: '进入 DOI 撰写', kind: 'advance' },
  { id: 'tr3', patentId: 'p6', from: 'patentability', to: 'draft', operatorId: 'u-zhaolei', at: '2026-11-02 17:30', reason: '审查打回:创新点需聚焦仓储拓扑特殊性', kind: 'reject' },
  { id: 'tr4', patentId: 'p6', from: 'draft', to: 'patentability', operatorId: 'u-duanmu', at: '2026-11-12 09:15', reason: '修改后重新提交审查', kind: 'advance' },
]

// KPI 规则
export const KPI_RULES: KpiRule[] = [
  {
    id: 'k1', name: '2026 H2 · 平台技术组推进',
    scope: { type: 'team', teamId: 't1' }, windowStart: '2026-07-01',
    targets: [
      { stage: 'patentability', deadline: '2026-10-31' },
      { stage: 'implementation', deadline: '2026-12-31' },
    ],
    scorerHook: null, createdBy: 'u-linzf',
  },
  {
    id: 'k2', name: '2026 全年 · 全员 DOI 产出',
    scope: { type: 'global' }, windowStart: '2026-01-01',
    targets: [{ stage: 'doi', deadline: '2026-12-31' }],
    scorerHook: 'custom_scorer.py:weighted_score', createdBy: 'u-guyq',
  },
]

export const NOTIFICATIONS: Notification[] = [
  { id: 'n1', event: 'review', text: '苏漫 已提交对《基于差分隐私的跨中心医疗影像分割方法》的审查意见:通过', at: '2026-11-19 15:42', read: false, patentId: 'p1' },
  { id: 'n2', event: 'due', text: '《用于 AGV 调度的动态死锁检测与解除方法》可专利性审查阶段将于 4 天后到期', at: '2026-11-26 09:00', read: false, patentId: 'p6' },
  { id: 'n3', event: 'due', text: '《高密度服务器机柜的相变材料均温结构》DOI 撰写阶段将于 12 天后到期', at: '2026-11-26 09:00', read: true, patentId: 'p8' },
  { id: 'n4', event: 'transition', text: '《多租户 SaaS 环境下的细粒度数据权限缓存方法》已进入 DOI 撰写阶段', at: '2026-11-25 11:03', read: true, patentId: 'p5' },
]
