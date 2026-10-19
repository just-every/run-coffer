import { requireRole } from './auth'
import { all, choice, commit, event, fail, guard, integer, one, sql, text, type Context, type Row } from './db'

export type OpportunityStage = { id: string; label: string; outcome: 'open' | 'won' | 'lost' }
export async function opportunityStages(c: Pick<Context, 'db'>): Promise<{ version: number; stages: OpportunityStage[] }> {
 const row = await one(c, 'SELECT opportunity_stages,opportunity_stages_version FROM cf_settings WHERE id=1')
 if (!row) fail('STORAGE', 'Coffer migrations have not been applied.', 503)
 return { version: row.opportunity_stages_version, stages: JSON.parse(row.opportunity_stages) }
}

export async function saveOpportunityStages(c: Context, p: Row) {
 requireRole(c.actor, ['owner', 'admin'], 'configure opportunity stages')
 const version = integer(Number(p.version), 'Pipeline settings version', 1)
 let input: unknown = p.stages
 if (input === undefined && typeof p.stageDefinitions === 'string') input = p.stageDefinitions.split(/\r?\n/).filter((line: string) => line.trim()).map((line: string) => {
  const parts = line.split('|').map(value => value.trim())
  if (parts.length !== 3) fail('INPUT', 'Enter each stage as stable code | label | open, won or lost.', 400)
  return { id: parts[0], label: parts[1], outcome: parts[2] }
 })
 if (!Array.isArray(input) || input.length < 3 || input.length > 20) fail('INPUT', 'Configure 3–20 pipeline stages.', 400)
 const stages = input.map((row): OpportunityStage => {
  const id = text(row?.id, 'Stage code', 60), label = text(row?.label, 'Stage label', 80)
  if (!/^[a-z][a-z0-9_]*$/.test(id)) fail('INPUT', 'Stage codes use lowercase letters, numbers and underscores, beginning with a letter.', 400)
  return { id, label, outcome: choice(row?.outcome, ['open', 'won', 'lost'] as const, 'stage outcome') }
 })
 if (new Set(stages.map(s => s.id)).size !== stages.length || new Set(stages.map(s => s.label.toLowerCase())).size !== stages.length) fail('INPUT', 'Each stage needs a distinct code and label.', 400)
 for (const outcome of ['open', 'won', 'lost']) if (!stages.some(s => s.outcome === outcome)) fail('INPUT', 'Include an open stage, a won stage and a lost stage.', 400)
 const current = await opportunityStages(c)
 const used = await all(c, 'SELECT DISTINCT stage FROM cf_prospects')
 for (const row of used) {
  const before = current.stages.find(s => s.id === row.stage), after = stages.find(s => s.id === row.stage)
  if (!after || before?.outcome !== after.outcome) fail('STAGE_IN_USE', 'Keep each stage in use and its open, won or lost outcome. Move its opportunities before removing it.')
 }
 const encoded = JSON.stringify(stages)
 await commit(c, [
  guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND opportunity_stages_version=?)', 'VERSION', 'Pipeline settings changed. Refresh before saving.', version),
  guard(`NOT EXISTS(SELECT 1 FROM cf_prospects p WHERE NOT EXISTS(SELECT 1 FROM json_each(?) s WHERE json_extract(s.value,'$.id')=p.stage AND json_extract(s.value,'$.outcome')=(SELECT json_extract(old.value,'$.outcome') FROM cf_settings cfg,json_each(cfg.opportunity_stages) old WHERE cfg.id=1 AND json_extract(old.value,'$.id')=p.stage)))`, 'STAGE_IN_USE', 'A stage in use changed. Refresh before saving.', encoded),
  sql('UPDATE cf_settings SET opportunity_stages=?,opportunity_stages_version=opportunity_stages_version+1 WHERE id=1', encoded),
  event(c, 'prospect.stages', 'settings', '1', null, { version: version + 1, stageIds: stages.map(s => s.id) }),
 ])
 return { version: version + 1, stages }
}
