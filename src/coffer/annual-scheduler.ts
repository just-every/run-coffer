import { runtimeBindings, type Bindings } from '../auth.server'
import { CofferError, commit, event, one, sql, today } from './db'
import { automationContext, claimAutomation } from './automation-grants'
import { settings } from './settings'
import { prepareStatements } from './year-end'

/** January prepares the prior calendar year once, with ordinary human approval.
 * Holds are visible in the audit and checked at most once per local day. No mail
 * or approval is performed by this scheduler. Concurrent ticks share the same
 * transactional year claim as the frozen statement batch. */
export async function prepareJanuaryStatements(original: Bindings, at: Date) {
 const env=runtimeBindings(original)
 const c=await automationContext(env,'statements',at.toISOString())
 if(!c)return {prepared:false,reason:'grant stopped'}
 // Household statements require the complete annual ledger. A narrowed grant
 // cannot authorize a partial household statement or an incomplete year claim.
 if(c.automation.donor_ids!==null)return {prepared:false,reason:'complete ledger grant required'}
 const day=today((await settings(c)).timezone,at),year=Number(day.slice(0,4))-1
 if(day.slice(5,7)!=='01')return {prepared:false,reason:'outside January'}
 const existing=await one(c,'SELECT batch_id FROM cf_annual_preparations WHERE year=?',year)
 if(existing)return {prepared:false,year,batchId:existing.batch_id,reason:'already prepared'}
 const held=await one(c,'SELECT reason FROM cf_annual_holds WHERE year=? AND checked_on=?',year,day)
 if(held)return {prepared:false,year,reason:held.reason}
 try {
  await claimAutomation(c,'statement.prepare')
  const batch=await prepareStatements(c,{year},{scheduled:true})
  return {prepared:true,year,batchId:batch.id,letters:batch.letters,excluded:batch.excluded}
 } catch(error) {
  if(!(error instanceof CofferError))throw error
  if(error.code==='ANNUAL_PREPARED')return {prepared:false,year,reason:'already prepared'}
  await commit(c,[sql('INSERT INTO cf_annual_holds(year,checked_on,reason) VALUES(?,?,?) ON CONFLICT(year) DO UPDATE SET checked_on=excluded.checked_on,reason=excluded.reason',year,day,error.code),event(c,'ack.annualHeld','annual_statement',String(year),null,{year,reason:error.code,...(error.details?{holds:error.details}:{})})])
  return {prepared:false,year,reason:error.code}
 }
}
