import { requireRole } from './auth'
import { all, commit, event, fail, guard, id, integer, one, optional, sql, type Context, type Row } from './db'

export type TaskTeamPerson = {
 id: string
 name: string
 role: 'owner' | 'admin' | 'member'
 manager_id: string | null
 weekly_call_capacity: number
 version: number
}

export async function taskTeam(c: Context): Promise<{ people: TaskTeamPerson[] }> {
 requireRole(c.actor, ['owner', 'admin'], 'manage team managers')
 const people = await all<TaskTeamPerson>(c, `SELECT o.id,o.display_name AS name,o.role,t.manager_id,COALESCE(t.weekly_call_capacity,10) AS weekly_call_capacity,COALESCE(t.version,0) AS version
  FROM oa_operators o LEFT JOIN cf_task_team t ON t.operator_id=o.id
  WHERE o.status='active' AND o.role IN ('owner','admin','member') ORDER BY lower(o.display_name),o.id`)
 return { people }
}

export async function taskTeamCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command !== 'task.teamSave') return
 requireRole(c.actor, ['owner', 'admin'], 'manage team managers')
 const operatorId = id(p.operatorId, 'Team member')
 const managerId = optional(p.managerId, 'Manager', 100)
 const version = integer(typeof p.version === 'string' && p.version.trim() ? Number(p.version) : p.version, 'Team version', 0)
 const capacity = p.weeklyCallCapacity === undefined
  ? (await one<{ weekly_call_capacity: number }>(c, 'SELECT weekly_call_capacity FROM cf_task_team WHERE operator_id=?', operatorId))?.weekly_call_capacity ?? 10
  : integer(typeof p.weeklyCallCapacity === 'string' && p.weeklyCallCapacity.trim() ? Number(p.weeklyCallCapacity) : p.weeklyCallCapacity, 'Weekly call capacity', 0, 1000)
 if (operatorId === managerId) fail('INPUT', 'A person cannot be their own manager.', 400)
 await commit(c, [
  guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))",
   'TEAM_CHANGED', 'Choose a current team member.', operatorId),
  guard('COALESCE((SELECT version FROM cf_task_team WHERE operator_id=?),0)=?',
   'VERSION', 'These team settings changed. Refresh before recording another change.', operatorId, version),
  ...(managerId ? [
   guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))",
    'MANAGER_CHANGED', 'Choose a current team member as manager.', managerId),
   guard(`NOT EXISTS(WITH RECURSIVE managers(operator_id) AS (
    SELECT ? UNION SELECT t.manager_id FROM cf_task_team t JOIN managers m ON t.operator_id=m.operator_id
    WHERE t.manager_id IS NOT NULL
   ) SELECT 1 FROM managers WHERE operator_id=?)`,
    'TEAM_CYCLE', 'Choose a manager who does not report to this person.', managerId, operatorId),
  ] : []),
  sql(`INSERT INTO cf_task_team(operator_id,manager_id,weekly_call_capacity,version,updated_at) VALUES(?,?,?,?,?)
   ON CONFLICT(operator_id) DO UPDATE SET manager_id=excluded.manager_id,weekly_call_capacity=excluded.weekly_call_capacity,version=excluded.version,updated_at=excluded.updated_at`,
   operatorId, managerId, capacity, version + 1, c.now),
  event(c, command, 'task_team', operatorId, null, { managerId, weeklyCallCapacity: capacity, version: version + 1 }),
 ])
 return { operatorId, managerId, weeklyCallCapacity: capacity, version: version + 1 }
}
