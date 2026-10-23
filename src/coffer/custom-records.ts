import { one, type Row } from './db'

const tables:Record<string,[string,string]>={constituent:['cf_donors','id'],gift:['cf_contribution_ledger','id'],pledge:['cf_pledges','id'],opportunity:['cf_prospects','id'],interaction:['cf_interactions','id'],note:['cf_donor_notes','id']}
/** Only known record stores can receive a typed value; callers fence the owner. */
export async function customRecord(c:{db:D1Database},kind:string,recordId:string):Promise<Row|null>{
 const spec=tables[kind];if(!spec)return null
 if(kind==='constituent')return one(c,'SELECT id AS donor_id FROM cf_donors WHERE id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=cf_donors.id)',recordId)
 return one(c,`SELECT r.donor_id FROM ${spec[0]} r JOIN cf_donors d ON d.id=r.donor_id WHERE r.${spec[1]}=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`,recordId)
}
