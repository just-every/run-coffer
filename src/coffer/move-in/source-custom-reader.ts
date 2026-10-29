import { fail } from '../db'
import { readBloomerangCustom, type SourceDefinition } from './source-definitions'
import { readLglCustom } from './lgl-definitions'
import { readNxtCustom } from './nxt-definitions'
import { readNeonCustom } from './neon-definitions'
import type { SourceRecord } from './custom-review-types'
export type SourceCredentials={apiKey:string;subscriptionKey?:string;organizationId?:string;idType?:'system'|'lookup'}

/** All network doors share private, ephemeral credentials and explicit source identity. */
export async function readSourceCustom(source:string,input:SourceCredentials,records:SourceRecord[]):Promise<SourceDefinition[]>{
 try{
  if(source==='bloomerang')return await readBloomerangCustom(input.apiKey,records)
  if(source==='lgl')return await readLglCustom(input.apiKey,records.filter(r=>r.kind==='constituent'||r.kind==='gift'))
  if(source==='neon')return await readNeonCustom(input.organizationId??'',input.apiKey,records.filter(r=>r.sourceObject!=='note'))
  if(source==='re-nxt')return await readNxtCustom(input.apiKey,input.subscriptionKey??'',records.filter(r=>r.sourceObject!=='note').map(r=>({...r,sourceObject:r.sourceObject==='action'?'action':undefined,idType:r.kind==='interaction'||r.sourceObject==='action'?'system':input.idType})))
  return fail('CUSTOM_SOURCE','This source has no documented custom definition reader.',400)
 }catch(error){
  if(error instanceof Error&&/^(Bloomerang|Little Green Light|Raiser's Edge NXT|Neon CRM): /.test(error.message))fail('CUSTOM_SOURCE_READ',error.message,502)
  throw error
 }
}
