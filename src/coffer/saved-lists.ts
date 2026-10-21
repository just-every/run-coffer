import { requireRole } from './auth'
import { all, choice, commit, event, fail, guard, id, integer, newId, object, sql, text, type Context, type Row } from './db'
import { RELATIONSHIP_TYPES } from './donor-depth'

export type ListFilters = { q: string; relationship: string; relatedTo: string; volunteer: string }
/** Saved definitions use exactly the current search's supported fields. */
export function listFilters(input: unknown = {}): ListFilters {
 const p = object(input, 'List filters')
 if (Object.keys(p).some(k => !['q','relationship','relatedTo','volunteer'].includes(k))) fail('INPUT', 'Choose supported donor-search filters.', 400)
 const q = p.q == null || p.q === '' ? '' : text(p.q, 'Search', 100).toLowerCase().replace(/\s+/g, ' ')
 const relationship = choice(p.relationship || '', ['',...RELATIONSHIP_TYPES], 'relationship')
 const relatedTo = p.relatedTo ? id(p.relatedTo, 'Connected donor') : ''
 const volunteer = choice(p.volunteer || '', ['','all','never-given'], 'volunteer list')
 return { q, relationship, relatedTo, volunteer }
}

export async function savedLists(c: Context):Promise<Row[]> {
 requireRole(c.actor, ['owner','admin'], 'read saved export lists')
 return (await all(c, 'SELECT id,name,version,filters,created_at,updated_at FROM cf_saved_lists ORDER BY lower(name),id'))
  .map(r => ({...r,filters:JSON.parse(r.filters)}))
}

export async function savedListCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command !== 'list.save') return undefined
 requireRole(c.actor, ['owner','admin'], 'save donor lists')
 const listId = p.listId ? id(p.listId, 'List') : newId(), name = text(p.name, 'List name', 100)
 let input: unknown = p.filters
 if (typeof input === 'string') { try { input = JSON.parse(input) } catch { fail('INPUT', 'List filters must be a JSON object.', 400) } }
 const filters = listFilters(input ?? {q:p.q,relationship:p.relationship,relatedTo:p.relatedTo,volunteer:p.volunteer})
 const version = p.listId ? integer(Number(p.version), 'List version', 1) : 0
 await commit(c, [
  ...(p.listId ? [guard('EXISTS(SELECT 1 FROM cf_saved_lists WHERE id=? AND version=?)','VERSION','This list changed. Refresh before saving.',listId,version),
   sql('UPDATE cf_saved_lists SET name=?,filters=?,version=version+1,updated_at=?,updated_by=? WHERE id=?',name,JSON.stringify(filters),c.now,c.actor.id,listId)]
   : [sql('INSERT INTO cf_saved_lists(id,name,version,filters,created_at,created_by,updated_at,updated_by) VALUES(?,?,1,?,?,?,?,?)',listId,name,JSON.stringify(filters),c.now,c.actor.id,c.now,c.actor.id)]),
  event(c,command,'saved_list',listId,null,{version:version+1,filterFields:Object.entries(filters).filter(([,v])=>v!=='').map(([k])=>k)}),
 ])
 return {id:listId,name,version:version+1,filters}
}
