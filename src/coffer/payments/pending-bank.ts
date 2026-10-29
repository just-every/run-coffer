import { fail, one } from '../db'
import { stripe, type GivingEnv } from '../giving/stripe'
import { settings } from '../settings'
import { cents, day } from './stripe-data'

/** Retain only processor identity, fund, money, day and status, never bank data. */
export async function observeBankPayment(env: GivingEnv, id: string) {
 const p=await stripe(env,'/payment_intents/'+encodeURIComponent(id))
 if(await one({db:env.DB},'SELECT intent_id FROM cf_bank_checkouts WHERE payment_intent_id=?',id))return
 if(!p.payment_method_types?.includes('us_bank_account'))return
 if(p.currency!=='usd'||p.id!==id||cents(p.amount)<=0)fail('invalid_payment','Invalid USD bank payment.',409)
 if(!['processing','succeeded','canceled','requires_payment_method'].includes(p.status))return
 const fund=String(p.metadata?.fund??'Unrestricted').trim().slice(0,100)||'Unrestricted'
 await env.DB.prepare(`INSERT INTO cf_pending_bank_payments(id,fund,amount_cents,received_on,status) VALUES(?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET status=excluded.status,fund=excluded.fund,amount_cents=excluded.amount_cents,received_on=excluded.received_on`)
  .bind(id,fund,p.amount,day(p.created,(await settings({db:env.DB})).timezone),p.status).run()
}
