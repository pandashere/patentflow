// 引用数据注册表:团队由后端 /api/bootstrap 下发后填充。
// (演示数据已迁到后端 server/src/patentflow/seed_data.json,通过 `patentflow seed` 导入)
import type { Team } from './types'

export const TEAMS: Team[] = []

export function setReferenceData(teams: Team[]) {
  TEAMS.splice(0, TEAMS.length, ...teams)
}

export const teamById = (id: string): Team => TEAMS.find((t) => t.id === id) ?? { id, name: id, plId: '' }
