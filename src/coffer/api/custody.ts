import { sql, type Stmt } from '../db'

/** Audit the operation, never the personal record identifier in its URL. */
export function apiAuditPath(url:URL|string):string{
 const path=typeof url==='string'?url:url.pathname
 if(!path.startsWith('/api/coffer/v1/'))return path
 const parts=path.split('/');if(parts.length>5)parts[5]=':id'
 return parts.join('/')
}

/** Compose before native erasure changes ownership or removes linked records. */
export function apiErasureStatements(donorId:string):Stmt[]{
 const tables=['cf_gifts','cf_pledges','cf_subscriptions','cf_interactions','cf_donor_notes','cf_call_tasks','cf_prospects']
 const related=tables.map(table=>`result_id IN (SELECT id FROM ${table} WHERE donor_id=?)`)
 return [sql(`DELETE FROM cf_api_idempotency WHERE result_id=? OR ${related.join(' OR ')}
  OR result_id IN (SELECT id FROM cf_soft_credits WHERE donor_id=? OR gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=?))`,...Array(tables.length+3).fill(donorId))]
}
