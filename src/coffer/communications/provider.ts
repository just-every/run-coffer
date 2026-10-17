import type { Bindings } from '../../auth.server'
import { fail, type Row } from '../db'
import { mangoRequest, mangoContact, suppressMango, createMangoCampaign, composeMangoCampaign, communicationsUnavailable as mangoUnavailable } from './mango'
import { mailchimpUnavailable, mailchimpContact, suppressMailchimp, captureMailchimpConsent, createMailchimpCampaign, composeMailchimpCampaign, mailchimpResults } from './mailchimp'
export function providerName(env?:Bindings):'mango'|'mailchimp'{
 const name=env?.COMMUNICATIONS_PROVIDER??'mango'
 if(name!=='mango'&&name!=='mailchimp')fail('PROVIDER','Choose Mango or Mailchimp as the email marketing provider.',400)
 return name
}
export const providerLabel=(env?:Bindings)=>providerName(env)==='mango'?'Mango':'Mailchimp'
export const communicationsUnavailable=(env?:Bindings)=>providerName(env)==='mango'?mangoUnavailable(env):mailchimpUnavailable(env)
export const providerContact=(env:Bindings|undefined,address:string)=>providerName(env)==='mango'?mangoContact(env,address):mailchimpContact(env,address)
export const suppressProvider=(env:Bindings|undefined,address:string)=>providerName(env)==='mango'?suppressMango(env,address):suppressMailchimp(env,address)
export async function captureProviderConsent(env:Bindings|undefined,donor:Row,organisation:string){
 if(providerName(env)==='mailchimp')return captureMailchimpConsent(env,donor,organisation)
 const result=await mangoRequest(env,'/api/contacts/consent','POST',{
  contact:{email:donor.email,displayName:donor.name},channel:'email',brandOrLegalSender:organisation,
  messageCategory:'newsletter',frequencyDisclosure:'Coffer appeals and welcome emails',destinationJurisdiction:'US',
  captureMethod:'Coffer consent record',captureSource:`coffer:${donor.id}:${donor.consent_id}`,consentText:donor.evidence,
  consentVersion:'coffer-email-v1',occurredAt:`${donor.captured_on}T00:00:00.000Z`,
 })
 return result.contact??null
}
export const createProviderCampaign=(env:Bindings|undefined,row:Row)=>providerName(env)==='mango'?createMangoCampaign(env,row):createMailchimpCampaign(env,row)
export const composeProviderCampaign=(env:Bindings|undefined,row:Row,draft:Row)=>providerName(env)==='mango'?composeMangoCampaign(env,row,draft):composeMailchimpCampaign(env,row,draft)
export async function providerResults(env:Bindings|undefined,row:Row){
 if(row.provider!==providerName(env))fail('PROVIDER_CHANGED','Reconnect the provider that received this campaign to refresh its results.',409)
 if(row.provider==='mailchimp')return mailchimpResults(env,row)
 const report=await mangoRequest(env,`/api/campaigns/${encodeURIComponent(row.campaign_id)}/recipients?revisionId=${encodeURIComponent(row.revision_id)}&limit=100`)
 if(!report.rows?.length){const detail=await mangoRequest(env,`/api/campaigns/${encodeURIComponent(row.campaign_id)}`);report.state=detail.campaign?.state??'unknown'}
 return report
}
export {restricted,subscribed} from './mango'
