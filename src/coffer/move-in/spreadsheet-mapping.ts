import { columnFields } from './source-columns'
import type { ParsedImport, ParsedWithdrawal, SpreadsheetMapping } from './types'
import type { SourceRow } from './source-rows'

export const spreadsheetFields = () => [...new Set(columnFields('spreadsheet').values())].sort()

/** Review names are labels, never identity. Only explicit record IDs join donors. */
export function reviewedSpreadsheet(value:unknown,out:ParsedImport):SpreadsheetMapping|undefined {
 const m=value as SpreadsheetMapping
 const error=(message:string)=>out.diagnostics.push({severity:'error',code:'SPREADSHEET_MAPPING',message})
 if(!m||typeof m!=='object'||!Array.isArray(m.columns)||!m.columns.length||m.columns.length>300||typeof m.name!=='string'||!m.name.trim()||m.name.length>100||!['gift','donor','note'].includes(m.recordType)) {error('Name the mapping, choose its record kind and map the spreadsheet columns.');return}
 const fields=new Set(spreadsheetFields()),seen=new Set<string>(),targets=new Set<string>()
 for(const c of m.columns) {
  if(!c||typeof c.column!=='string'||!c.column||typeof c.field!=='string'||!fields.has(c.field)||c.sheet!==undefined&&typeof c.sheet!=='string'){error('Choose a supported target for each mapped column.');continue}
  const key=JSON.stringify([c.sheet??'',c.column]),target=JSON.stringify([c.sheet??'',c.field])
  if(seen.has(key)||targets.has(target))error('Map each column and each target field once per worksheet.')
  seen.add(key);targets.add(target)
 }
 for(const [kind,values] of Object.entries(m.translations??{})) {
  if(!['fund','method'].includes(kind)||!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length>200){error('Supply fund and payment-method translations as source values and target values.');continue}
  for(const [from,to] of Object.entries(values))if(!from.trim()||typeof to!=='string'||!to.trim()||to.length>200)error('Each translation needs a source value and a nonempty target value.')
 }
 if(m.donorMatches!==undefined) {
  if(!m.donorMatches||typeof m.donorMatches!=='object'||Array.isArray(m.donorMatches)||Object.keys(m.donorMatches).length>100000)error('Choose existing donors explicitly by source constituent ID.')
  else for(const [key,match] of Object.entries(m.donorMatches))if(!key||!match||typeof match.id!=='string'||!match.id||!Number.isSafeInteger(match.version)||match.version<1)error('Each donor match needs a current donor ID and version.')
 }
 return out.diagnostics.some(d=>d.code==='SPREADSHEET_MAPPING')?undefined:m
}

/** A missing preference remains unknown; imports cannot manufacture permission. */
export function spreadsheetPreferences(r:SourceRow,out:ParsedImport) {
 const donorExternalId=r.peek('donorId')
 for(const channel of ['email','mail','sms','phone'] as const) {
  const field=channel+'Preference'
  if(!r.has(field))continue
  const raw=r.get(field).toLowerCase(),status=['yes','true','granted','opted in'].includes(raw)?'granted':['no','false','withdrawn','opted out'].includes(raw)?'withdrawn':['','unknown','not recorded'].includes(raw)?'unknown':null
  if(!status){r.error('CHANNEL_PREFERENCE','Choose yes, no or unknown for the source channel preference.',field);continue}
  const sourceOn=r.peek('preferenceDate')?r.date('preferenceDate'):''
  const row:ParsedWithdrawal={location:r.location,externalId:`preference:${channel}:${donorExternalId}`,donorExternalId,channel,sourceOn,codes:[raw||'unknown'],status}
  const prior=(out.channelWithdrawals??=[]).find(p=>p.donorExternalId===donorExternalId&&p.channel===channel)
  if(prior&&prior.externalId!==row.externalId){if(status!=='withdrawn')r.error('CHANNEL_PREFERENCE','A source withdrawal conflicts with this channel preference.',field);continue}
  if(prior&&(prior.status!==status||prior.sourceOn!==sourceOn))r.error('CHANNEL_PREFERENCE','Source rows disagree on a constituent’s channel preference.',field)
  else if(!prior)out.channelWithdrawals.push(row)
 }
}

export function translationLines(value:string) {
 const entries=value.split(/\r?\n/).filter(v=>v.trim()).map(line=>{const at=line.indexOf('=');if(at<1||!line.slice(at+1).trim())throw Error('Write each translation as source = target.');return [line.slice(0,at).trim(),line.slice(at+1).trim()]})
 if(new Set(entries.map(e=>e[0])).size!==entries.length)throw Error('Translate each source value once.')
 return Object.fromEntries(entries)
}
