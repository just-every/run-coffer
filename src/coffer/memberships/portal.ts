import { all } from '../db'
import { box, e, money } from '../ui/common'
import { portalContext, type PortalDonor } from '../giving/portal-identity'
import { portalPage } from '../giving/portal-ui'
import type { GivingEnv } from '../giving/stripe'
export async function portalMemberships(env:GivingEnv,donor:PortalDonor){
 const c=await portalContext(env,donor),rows=await all(c,`SELECT m.id,m.subscription_id,l.name,l.slug,l.active,q.price_cents,q.term_months,(SELECT MAX(p.expires_on) FROM cf_membership_payments p JOIN cf_gift_balances b ON b.id=p.gift_id WHERE p.membership_id=m.id AND b.net_cents>=q.price_cents) AS expires_on FROM cf_memberships m JOIN cf_membership_intents q ON q.intent_id=m.intent_id JOIN cf_membership_levels l ON l.id=q.level_id WHERE m.donor_id=? ORDER BY l.name,m.id`,donor.id)
 return portalPage('Your memberships',box('Earned membership terms',rows.length?`<ul class="list">${rows.map(m=>`<li><strong>${e(m.name)}</strong> · ${money(m.price_cents)} per ${m.term_months} months<br>${m.expires_on?'Paid through '+e(m.expires_on):'No qualifying paid term'}${!m.subscription_id&&m.active?`<p><a href="/giving/memberships/${e(m.slug)}?renew=${encodeURIComponent(m.id)}">Renew this membership once</a></p>`:''}</li>`).join('')}</ul>`:'<p>No paid memberships.</p>')+'<p><a href="/giving/portal">Giving account</a></p>')
}
