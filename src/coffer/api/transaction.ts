import { commit, event, fail, guard, one, sha256, sql, text, type Context, type Row, type TransactionPlan } from '../db'
import { apiAuditPath } from './custody'

export const RATE_LIMIT=120
/** Uses one guarded batch so distributed and concurrent Worker requests share a limit. */
export async function rateLimit(c:Context,principal:string){
 const minute=Math.floor(Date.now()/60000)
 await commit(c,[sql(`INSERT INTO cf_api_rate_windows VALUES(?,?,1) ON CONFLICT(principal) DO UPDATE SET
 attempts=CASE WHEN minute=excluded.minute THEN attempts+1 ELSE 1 END,minute=excluded.minute`,principal,minute)])
 const window=await one(c,'SELECT attempts FROM cf_api_rate_windows WHERE principal=?',principal)
 if(Number(window?.attempts)>RATE_LIMIT)fail('RATE_LIMITED','The public API allows 120 requests per minute. Try again after the current minute.',429)
}

const canonical=(v:any):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v)
type Receipt={request_hash:string;result_id:string}

/** Domain statements and the identifier-only receipt publish together. A lost
 * response or concurrent duplicate never leaves an unreceipted domain write. */
export async function idempotentWrite(c:Context,request:Request,principal:string,input:Row,prepare:(staged:Context)=>Promise<string>){
 const key=text(request.headers.get('idempotency-key'),'Idempotency-Key',200)
 if(!/^[\x21-\x7e]+$/.test(key))fail('INPUT','Idempotency-Key must contain visible ASCII characters.',400)
 const keyHash=await sha256(key),requestHash=await sha256(request.method+'\n'+new URL(request.url).pathname+'\n'+canonical(input))
 const read=()=>one<Receipt>(c,'SELECT request_hash,result_id FROM cf_api_idempotency WHERE principal=? AND key_hash=?',principal,keyHash)
 const replay=(receipt:Receipt)=>{
  if(receipt.request_hash!==requestHash)fail('IDEMPOTENCY_CONFLICT','This Idempotency-Key was used for a different request.',409)
  return {id:receipt.result_id}
 }
 const saved=await read()
 if(saved){await commit(c,[event(c,'api.replay','route',apiAuditPath(new URL(request.url)),null,{},'cf_access_events')]);return {result:replay(saved),replayed:true}}
 const transactionPlan:TransactionPlan={statements:[],commits:0}
 const resultId=await prepare({...c,transactionPlan})
 if(!resultId||!transactionPlan.statements.length||transactionPlan.commits>1)fail('ATOMIC_WRITE_REQUIRED','This operation cannot be published as one local transaction.',409)
 try{
  await commit(c,[guard('NOT EXISTS(SELECT 1 FROM cf_api_idempotency WHERE principal=? AND key_hash=?)','IDEMPOTENCY_RACE','Another request is publishing this operation.',principal,keyHash),...transactionPlan.statements,
   event(c,'api.write','route',apiAuditPath(new URL(request.url)),null,{},'cf_access_events'),
   sql('INSERT INTO cf_api_idempotency VALUES(?,?,?,?,?)',principal,keyHash,requestHash,resultId,c.now)])
 }catch(error){const concurrent=await read();if(concurrent)return {result:replay(concurrent),replayed:true};throw error}
 return {result:{id:resultId},replayed:false}
}
