import { requireRole } from './auth'
import { all, choice, commit, date, event, fail, guard, id, longText, newId, one, optional, sql, text, today, type Context, type Row, type Stmt } from './db'
import { settings } from './settings'

export const RELATIONSHIP_TYPES = ['spouse', 'employer', 'board_member', 'foundation_officer', 'introduced_by'] as const
export type RelationshipType = typeof RELATIONSHIP_TYPES[number]
export const INTERACTION_TYPES = ['call', 'meeting', 'email'] as const
export type InteractionType = typeof INTERACTION_TYPES[number]
/** Labels describe the OTHER donor, relative to the record being viewed. */
export const RELATIONSHIP_LABELS: Record<RelationshipType, { outgoing: string; incoming: string; sentence: string }> = {
 spouse: { outgoing: 'Spouse', incoming: 'Spouse', sentence: 'is spouse of' },
 employer: { outgoing: 'Employer', incoming: 'Employee', sentence: 'is employed by' },
 board_member: { outgoing: 'Board organization', incoming: 'Board member', sentence: 'is a board member of' },
 foundation_officer: { outgoing: 'Foundation', incoming: 'Foundation officer', sentence: 'is a foundation officer of' },
 introduced_by: { outgoing: 'Introduced by', incoming: 'Introduced', sentence: 'was introduced by' },
}

export type DonorRelationship = {
 id: string; donor_id: string; related_donor_id: string; type: RelationshipType
 created_at: string; created_by: string; other_donor_id: string; other_name: string
 direction: 'outgoing' | 'incoming'; label: string
}
export type DonorInteraction = {
 id: string; donor_id: string; kind: InteractionType; occurred_on: string; who: string
 notes: string; next_step: string | null; recorded_at: string; recorded_by: string
}
export type DonorDepth = { relationships: DonorRelationship[]; interactions: DonorInteraction[] }

const liveDonor = (donorId: string) => guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL)', 'NOT_FOUND', 'That donor no longer exists.', donorId)

export async function donorDepthCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['relationship.create', 'relationship.remove', 'interaction.record'].includes(command)) return undefined
 requireRole(c.actor, ['owner', 'admin', 'member'], `run ${command}`)
 const donorId = id(p.donorId, 'Donor')
 if (command === 'relationship.create') {
  const relatedId = id(p.relatedDonorId, 'Related donor'), type = choice(p.type, RELATIONSHIP_TYPES, 'relationship')
  if (donorId === relatedId) fail('INPUT', 'Choose a different donor for the relationship.', 400)
  const [from, to] = type === 'spouse' && donorId > relatedId ? [relatedId, donorId] : [donorId, relatedId], relationshipId = newId()
  await commit(c, [liveDonor(donorId), liveDonor(relatedId),
   guard('NOT EXISTS(SELECT 1 FROM cf_relationships WHERE donor_id=? AND related_donor_id=? AND type=?)', 'DUPLICATE_RELATIONSHIP', 'This relationship is already recorded.', from, to, type),
   sql('INSERT INTO cf_relationships(id,donor_id,related_donor_id,type,created_at,created_by) VALUES(?,?,?,?,?,?)', relationshipId, from, to, type, c.now, c.actor.name),
   ...[donorId, relatedId].map(d => event(c, command, 'relationship', relationshipId, d, { type, donorId: from, relatedDonorId: to }))])
  return { id: relationshipId, donorId, relatedDonorId: relatedId, type }
 }
 if (command === 'relationship.remove') {
  const relationshipId = id(p.relationshipId, 'Relationship')
  const relation = await one<{ donor_id: string; related_donor_id: string; type: RelationshipType }>(c,
   'SELECT donor_id,related_donor_id,type FROM cf_relationships WHERE id=? AND (donor_id=? OR related_donor_id=?)', relationshipId, donorId, donorId)
  if (!relation) fail('NOT_FOUND', 'That relationship no longer exists on this donor.', 404)
  const otherId = relation.donor_id === donorId ? relation.related_donor_id : relation.donor_id
  await commit(c, [liveDonor(donorId), liveDonor(otherId),
   guard('EXISTS(SELECT 1 FROM cf_relationships WHERE id=? AND donor_id=? AND related_donor_id=? AND type=?)', 'CONCURRENT_CHANGE', 'That relationship changed. Refresh before removing it.', relationshipId, relation.donor_id, relation.related_donor_id, relation.type),
   sql('DELETE FROM cf_relationships WHERE id=?', relationshipId),
   ...[donorId, otherId].map(d => event(c, command, 'relationship', relationshipId, d, { type: relation.type }))])
  return { removed: relationshipId, donorId }
 }
 const interactionId = newId(), kind = choice(p.kind, INTERACTION_TYPES, 'conversation type'), occurred = date(p.occurredOn, 'Conversation date')
 const who = text(p.who, 'Who took part', 500), notes = longText(p.notes, 'Conversation notes'), nextStep = optional(p.nextStep, 'Next step', 2000)
 if (occurred > today((await settings(c)).timezone)) fail('INPUT', 'A conversation cannot be recorded in the future.', 400)
 await commit(c, [liveDonor(donorId),
  sql('INSERT INTO cf_interactions(id,donor_id,kind,occurred_on,who,notes,next_step,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?,?,?)', interactionId, donorId, kind, occurred, who, notes, nextStep, c.now, c.actor.name),
  event(c, command, 'interaction', interactionId, donorId, { kind, occurredOn: occurred })])
 return { id: interactionId, donorId, kind, occurredOn: occurred }
}

export async function donorDepth(c: { db: D1Database }, donorId: string): Promise<DonorDepth> {
 const [relationships, interactions] = await Promise.all([
  all<Omit<DonorRelationship, 'label'>>(c, `SELECT r.*,other.id AS other_donor_id,other.name AS other_name,
    CASE WHEN r.donor_id=? THEN 'outgoing' ELSE 'incoming' END AS direction
   FROM cf_relationships r
   JOIN cf_donors current ON current.id=? AND current.erased_at IS NULL
   JOIN cf_donors other ON other.id=CASE WHEN r.donor_id=current.id THEN r.related_donor_id ELSE r.donor_id END AND other.erased_at IS NULL
   WHERE r.donor_id=current.id OR r.related_donor_id=current.id
   ORDER BY lower(other.name),r.type,r.id`, donorId, donorId),
  all<DonorInteraction>(c, `SELECT i.* FROM cf_interactions i JOIN cf_donors d ON d.id=i.donor_id AND d.erased_at IS NULL
   WHERE i.donor_id=? ORDER BY i.occurred_on DESC,i.recorded_at DESC,i.id DESC`, donorId),
 ])
 return { relationships: relationships.map(r => ({ ...r, label: RELATIONSHIP_LABELS[r.type][r.direction] })), interactions }
}

/** Append this bound predicate to listDonors' WHERE clause (donor alias d).
 * Either direction finds every donor with that connection. Outgoing/incoming
 * distinguish employees from employers etc.; spouse is symmetric throughout.
 */
export function relationshipPredicate(type?: RelationshipType, direction: 'either' | 'outgoing' | 'incoming' = 'either'): Stmt {
 if (type !== undefined) choice(type, RELATIONSHIP_TYPES, 'relationship')
 choice(direction, ['either', 'outgoing', 'incoming'] as const, 'relationship direction')
 const endpoint = direction === 'either' ? '(r.donor_id=d.id OR r.related_donor_id=d.id)' : `(r.${direction === 'outgoing' ? 'donor_id' : 'related_donor_id'}=d.id OR (r.type='spouse' AND (r.donor_id=d.id OR r.related_donor_id=d.id)))`
 return sql(`d.erased_at IS NULL AND EXISTS(SELECT 1 FROM cf_relationships r
  JOIN cf_donors a ON a.id=r.donor_id AND a.erased_at IS NULL
  JOIN cf_donors b ON b.id=r.related_donor_id AND b.erased_at IS NULL
  WHERE ${endpoint}${type ? ' AND r.type=?' : ''})`, ...(type ? [type] : []))
}

/** Add inside the caller's atomic, authorized merge BEFORE deleting source.
 * Preserve conversations, remove self-links and collapse duplicate edges.
 * Erasure needs no hook: the migration's trigger removes both kinds of data.
 */
export function donorDepthMergeStatements(sourceId: string, targetId: string): Stmt[] {
 if (sourceId === targetId) fail('INPUT', 'Choose two different donors to merge.', 400)
 const mapped = `WITH mapped AS (SELECT id,type,created_at,
  CASE WHEN donor_id=? THEN ? ELSE donor_id END AS a,
  CASE WHEN related_donor_id=? THEN ? ELSE related_donor_id END AS b FROM cf_relationships),
  projected AS (SELECT id,type,created_at,CASE WHEN type='spouse' THEN min(a,b) ELSE a END AS a,
  CASE WHEN type='spouse' THEN max(a,b) ELSE b END AS b FROM mapped)`
 const params = [sourceId, targetId, sourceId, targetId]
 return [liveDonor(sourceId), liveDonor(targetId),
  sql('DELETE FROM cf_relationships WHERE (donor_id=? AND related_donor_id=?) OR (donor_id=? AND related_donor_id=?)', sourceId, targetId, targetId, sourceId),
  sql(`${mapped}, ranked AS (SELECT id,row_number() OVER(PARTITION BY type,a,b ORDER BY created_at,id) AS n FROM projected)
   DELETE FROM cf_relationships WHERE id IN (SELECT id FROM ranked WHERE n>1)`, ...params),
  sql(`${mapped} UPDATE cf_relationships SET donor_id=(SELECT a FROM projected WHERE projected.id=cf_relationships.id),
   related_donor_id=(SELECT b FROM projected WHERE projected.id=cf_relationships.id) WHERE donor_id=? OR related_donor_id=?`, ...params, sourceId, sourceId),
  sql('UPDATE cf_interactions SET donor_id=? WHERE donor_id=?', targetId, sourceId),
 ]
}
