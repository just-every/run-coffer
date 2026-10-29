import { enteredAddress } from '../addresses/entry'
import { postalAddress } from '../addresses/state'
import { commit, guard, sql, today, type Context, type Stmt } from '../db'
import { settings } from '../settings'
import type { Plan } from './plan'

/** The new entry door inherits native verification. Source addresses stay in
 * history when the configured verifier normalizes them; errors save nothing. */
export async function spreadsheetAddresses(c:Context,plan:Plan):Promise<Stmt[]> {
 const writes:Stmt[]=[],day=today((await settings(c)).timezone,new Date(c.now))
 const donors=plan.effects.filter(e=>e.kind==='donor'&&e.owned)
 await commit(c,[])
 for(const effect of donors) {
  const original=effect.row,checked=await enteredAddress(c,original),normalized=checked.donor
  writes.push(...checked.statements)
  if(!checked.statements.length)writes.push(guard('NOT EXISTS(SELECT 1 FROM cf_address_processing WHERE enabled=1)','ADDRESS_CONNECTION_CHANGED','Address processing changed; preview and apply again.'))
  if(JSON.stringify(postalAddress(original))===JSON.stringify(postalAddress(normalized)))continue
  effect.row=normalized
  writes.push(sql('INSERT INTO cf_donor_address_history(donor_id,address_line1,address_line2,city,region,postal_code,country,until_on,source,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)',effect.nativeId,original.address_line1,original.address_line2,original.city,original.region,original.postal_code,original.country,day,'spreadsheet source before verification',c.now))
  for(const contact of plan.effects.filter(e=>e.kind==='contact'&&e.owned&&e.donorId===effect.nativeId&&e.row.kind==='address'&&e.row.is_primary===1))contact.row.value=JSON.stringify({line1:normalized.address_line1,line2:normalized.address_line2,city:normalized.city,region:normalized.region,postalCode:normalized.postal_code,country:normalized.country})
 }
 return writes
}
