import { requireRole } from '../auth'
import { all, type Context, type Row } from '../db'

export const sourceMembershipStates=['within-dates','ends-today','no-end-recorded','not-started','ended'] as const
export const sourceMembershipLabels:Record<string,string>={'within-dates':'Within source dates','ends-today':'Ends today','no-end-recorded':'End not recorded','not-started':'Not started','ended':'Ended'}

/** Source dates support staff review; they confer no paid term or billing grant. */
export async function sourceMembershipHistory(c:Context,day:string){
 requireRole(c.actor,['owner','admin'],'review imported membership history')
 const history=await all(c,"SELECT h.*,d.name AS donor_name FROM cf_crm_source_history h JOIN cf_donors d ON d.id=h.donor_id WHERE h.kind='membership' AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) ORDER BY lower(h.label),lower(d.name),h.occurred_on,h.id")
 const rows=history.map(h=>{
  const p=JSON.parse(h.payload),end=p.expiresOn??null
  const state=h.occurred_on>day?'not-started':end===day?'ends-today':end&&end<day?'ended':end?'within-dates':'no-end-recorded'
  return {id:h.id,donorId:h.donor_id,donorName:h.donor_name,source:h.source,sourceId:h.source_id,level:h.label,startsOn:h.occurred_on,endsOn:end,sourceStatus:p.status,notes:p.notes,state,importedAt:h.imported_at,importedBy:h.imported_by}
 })
 const groups=new Map<string,Map<string,Row>>()
 for(const row of rows){
  const people=groups.get(row.level)??new Map<string,Row>(),prior=people.get(row.donorId)
  if(!prior||sourceMembershipStates.findIndex(s=>s===row.state)<sourceMembershipStates.findIndex(s=>s===prior.state))people.set(row.donorId,row)
  groups.set(row.level,people)
 }
 const counts=[...groups].map(([level,people])=>({level,people:people.size,states:Object.fromEntries(sourceMembershipStates.map(state=>[state,[...people.values()].filter(p=>p.state===state).length]))}))
 return {rows,counts}
}
