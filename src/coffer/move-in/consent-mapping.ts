import { normalizeLabel } from './source-columns'
import type { SourceRow } from './source-rows'
import type { ConsentChannel, ParsedConsent, ParsedImport } from './types'

const granted = new Set(['yes','true','1','granted','optedin','subscribed','consented'])
const withdrawn = new Set(['no','false','0','withdrawn','optedout','unsubscribed','declined'])
const unknown = new Set(['','unknown','notasked','notspecified','unrecorded'])

/** An absent prohibition never supplies affirmative permission. Empty exported
 * preference cells are retained as unknown, with no invented source date. */
export function sourceConsents(r:SourceRow,out:ParsedImport) {
 const commonDate=r.get('consentDate')?r.date('consentDate'):''
 for(const channel of ['email','mail','sms','phone'] as ConsentChannel[]) {
  const field=channel+'Consent',optOut=channel+'OptOut',dateField=channel+'ConsentDate'
  const raw=r.get(field),key=normalizeLabel(raw),flag=r.get(optOut),flagKey=normalizeLabel(flag)
  let status:ParsedConsent['status']='unknown'
  if(granted.has(key))status='granted'
  else if(withdrawn.has(key))status='withdrawn'
  else if(!unknown.has(key))r.error('CONSENT_STATUS',`Unknown ${channel} preference “${raw}”. Export yes, no or unknown; it cannot be guessed.`,field)
  if(r.has(optOut)) {
   if(granted.has(flagKey))status='withdrawn'
   else if(!withdrawn.has(flagKey)&&!unknown.has(flagKey))r.error('CONSENT_STATUS',`Unknown ${channel} opt-out “${flag}”. Export yes, no or unknown.`,optOut)
  }
  const sourceOn=r.get(dateField)?r.date(dateField):commonDate
  const row:ParsedConsent={location:r.location,externalId:`consent:${channel}:${r.peek('donorId')}`,donorExternalId:r.peek('donorId'),channel,status,sourceOn,evidence:[r.has(field)?`${field}: ${raw||'unknown'}`:'',r.has(optOut)?`${optOut}: ${flag||'unknown'}`:''].filter(Boolean).join('; ')||'No source preference recorded'}
  out.consents??=[]
  const previous=out.consents.find(c=>c.externalId===row.externalId)
  if(previous&&(previous.status!==row.status||previous.sourceOn!==row.sourceOn))r.error('CONSENT_CONFLICT',`Constituent ${row.donorExternalId} has conflicting ${channel} preferences. Export one authoritative answer.`,field)
  else if(!previous)out.consents.push(row)
 }
}
