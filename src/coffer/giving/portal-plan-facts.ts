import type { Row } from '../db'
import type { GivingEnv } from './stripe'

/** Keep the observed provider schedule beside its amount and status. A webhook
 * without readable schedule facts cannot erase an earlier verified observation. */
export async function observePortalPlan(env:GivingEnv,sub:Row){
 const items=sub.items?.data,price=items?.[0]?.price,recurring=price?.recurring
 if(!Array.isArray(items)||items.length!==1||!recurring)return
 if(!['day','week','month','year'].includes(recurring.interval)||!Number.isSafeInteger(recurring.interval_count)||recurring.interval_count<1)return
 await env.DB.prepare(`INSERT INTO cf_portal_subscription_settings(subscription_id,interval,interval_count,collection_paused,observed_at) VALUES(?,?,?,?,?)
  ON CONFLICT(subscription_id) DO UPDATE SET interval=excluded.interval,interval_count=excluded.interval_count,collection_paused=excluded.collection_paused,observed_at=excluded.observed_at`)
 .bind(sub.id,recurring.interval,recurring.interval_count,sub.pause_collection?1:0,new Date().toISOString()).run()
}
