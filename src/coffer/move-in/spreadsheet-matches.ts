import { all, type Context } from '../db'
import type { ParseInput, ParsedImport } from './types'

/** Resolve only IDs explicitly selected in this review, never names or emails.
 * The plan checks their versions and current identity again before applying. */
export async function resolveSpreadsheetMatches(c:Context,input:ParseInput):Promise<ParseInput> {
 const entries=Object.entries(input.spreadsheet?.donorMatches??{})
 const ids=entries.flatMap(([,value])=>value&&typeof value.id==='string'?[value.id]:[])
 const donors=await all(c,'SELECT id,name FROM cf_donors WHERE id IN(SELECT value FROM json_each(?)) AND erased_at IS NULL',JSON.stringify(ids))
 return {...input,matchedDonors:Object.fromEntries(entries.flatMap(([externalId,value])=>{const d=donors.find(d=>d.id===value?.id);return d?[[externalId,{id:d.id,name:d.name}]]:[]}))}
}

/** A gifts-only or interactions-only file can reference an existing donor
 * without repeating that person's profile. The explicit match is the identity. */
export function includeMatchedDonors(input:ParseInput,out:ParsedImport) {
 for(const [externalId,match] of Object.entries(input.matchedDonors??{})) {
  if(out.donors.some(d=>d.externalId===externalId))continue
  const linked=[...out.gifts,...out.softCredits,...out.notes,...out.pledges].find(r=>r.donorExternalId===externalId)
  if(!linked)continue
  out.donors.push({location:linked.location,externalId,name:match.name,organization:false,firstName:'',lastName:'',email:'',phone:'',addressLine1:'',addressLine2:'',city:'',region:'',postalCode:'',country:'',householdKey:'',householdName:''})
 }
}
