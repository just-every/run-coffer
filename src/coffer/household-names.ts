import { all, one, type Context, type Row } from './db'

export const NAME_FIELDS = {prefix:'prefix',firstName:'first_name',middleName:'middle_name',lastName:'last_name',suffix:'suffix',nickname:'nickname'} as const
export const HOUSEHOLD_TOKENS = ['full_names','formal_names','first_names','last_names'] as const
export async function householdDefaults(c: {db:D1Database}) {
 return (await one(c,'SELECT * FROM cf_household_defaults WHERE id=1'))!
}
export function computedHouseholdNames(members:Row[], headId:string|null, defaults:Row) {
 const living=members.filter(m=>m.constituent_status!=='deceased')
 const ordered=[...living].sort((a,b)=>Number(b.id===headId)-Number(a.id===headId)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))
 const full=(m:Row)=>[m.prefix,m.first_name,m.middle_name,m.last_name,m.suffix].filter(Boolean).join(' ')||m.name
 const join=(fn:(m:Row)=>string)=>ordered.map(fn).filter(Boolean).join(' and ')
 const values:Record<string,string>={full_names:join(full),formal_names:join(full),first_names:join(m=>m.nickname||m.first_name||m.name),last_names:join(m=>m.last_name||m.name)}
 const fill=(template:string)=>template.replace(/{{(\w+)}}/g,(_,key)=>values[key]??'')
 return {addressee:fill(defaults.addressee),formal:fill(defaults.formal),informal:fill(defaults.informal)}
}
export async function householdMembers(c: {db:D1Database}, householdId:string) {
 return all(c,`SELECT * FROM cf_donors d WHERE household_id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) ORDER BY created_at,id`,householdId)
}
