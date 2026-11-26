// 引用数据注册表:团队与配置文件管理员由后端 /api/bootstrap 下发后填充。
// (演示数据已迁到后端 server/src/patentflow/seed_data.json,通过 `patentflow seed` 导入)
import type { Team } from './types'

export const TEAMS: Team[] = []
export const CONFIG_ADMIN_EMAILS: string[] = []

export function setReferenceData(teams: Team[], admins: string[]) {
  TEAMS.splice(0, TEAMS.length, ...teams)
  CONFIG_ADMIN_EMAILS.splice(0, CONFIG_ADMIN_EMAILS.length, ...admins.map((a) => a.toLowerCase()))
}

export const isConfigAdmin = (email: string) => CONFIG_ADMIN_EMAILS.includes(email.toLowerCase())
export const teamById = (id: string): Team => TEAMS.find((t) => t.id === id) ?? { id, name: id, plId: '' }
