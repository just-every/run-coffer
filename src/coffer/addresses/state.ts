import { all, one, sha256, sql, type Context, type Row, type Stmt } from '../db'
import type { PostalAddress, SmartyResult } from './providers/types'

export const postalAddress=(d:Row):PostalAddress=>({street:d.address_line1??'',street2:d.address_line2??'',city:d.city??'',state:d.region??'',postalCode:d.postal_code??'',country:d.country??'United States'})
export const addressFingerprint=(d:Row)=>sha256(JSON.stringify([d.name,d.constituent_kind??'person',postalAddress(d)]))
export async function addressProcessing(c:{db:D1Database}) {
 return await one(c,'SELECT * FROM cf_address_processing WHERE id=1')??{id:1,version:0,enabled:0,paf_reference:null}
}
export function checkStatement(donorId:string,fingerprint:string,result:SmartyResult,at:string,source='smarty',moveMonth:string|null=null):Stmt {
 return sql(`INSERT INTO cf_address_checks(donor_id,version,fingerprint,status,reason,codes,checked_at,source,move_effective_month) VALUES(?,1,?,?,?,?,?,?,?)
 ON CONFLICT(donor_id) DO UPDATE SET version=version+1,fingerprint=excluded.fingerprint,status=excluded.status,reason=excluded.reason,codes=excluded.codes,checked_at=excluded.checked_at,source=excluded.source,move_effective_month=excluded.move_effective_month`,donorId,fingerprint,result.status,result.reason,JSON.stringify(result.providerCodes),at,source,moveMonth)
}
export async function addressState(c:Context,donorId?:string) {
 const connection=await addressProcessing(c)
 const runs=await all(c,'SELECT id,state,total,processed,created_at,completed_at,reason FROM cf_ncoa_runs ORDER BY created_at DESC LIMIT 20')
 if(!donorId)return {connection,runs}
 const [donor,check,history]=await Promise.all([
 one(c,'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=cf_donors.id)',donorId),
 one(c,'SELECT * FROM cf_address_checks WHERE donor_id=?',donorId),
 all(c,'SELECT * FROM cf_donor_address_history WHERE donor_id=? ORDER BY until_on DESC,id DESC',donorId),
 ])
 return {connection:{enabled:connection.enabled},runs:[],check:donor&&check&&check.fingerprint===await addressFingerprint(donor)?check:null,history}
}
