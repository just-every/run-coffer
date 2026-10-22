import { all, fail, one, guard, type Context } from './db'
import { exportSelection } from './exports-selection'
export async function listMembers(c:Context,listId:string) {
 const selected=await exportSelection(c,new URL('https://coffer.invalid/?list=saved:'+encodeURIComponent(listId)))
 if(!await c.db.prepare('SELECT id FROM cf_saved_lists WHERE id=?').bind(listId).first())fail('NOT_FOUND','Choose a saved list.',404)
 const rows=await all(c,`WITH ${selected.ctes} SELECT id FROM members ORDER BY id`,...selected.params)
 if(!(await one(c,`SELECT ${selected.scoreCurrentSql} AS current`))?.current)fail('LIST_CHANGED','Giving or engagement facts changed. Refresh this list.',409)
 return {ids:rows.map(r=>String(r.id)),selection:selected,guards:[guard(selected.scoreCurrentSql,'LIST_CHANGED','Giving or engagement facts changed. Prepare again.')]}
}
