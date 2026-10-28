import { fail, type Row } from '../db'
import type { Connection } from './connection'
import { mangoContact, suppressMango, listInMango, restricted as mangoRestricted, subscribed as mangoSubscribed } from './mango'
import { mailchimpContact, suppressMailchimp, captureMailchimpConsent, createMailchimpCampaign, composeMailchimpCampaign, mailchimpResults } from './mailchimp'
import { constantContactContact } from './constant-contact-api'
import { suppressConstantContact, syncConstantContactProfile } from './constant-contact-profile'
import { createConstantContactCampaign, composeConstantContactCampaign, constantContactResults } from './constant-contact-campaign'

export { providerTitle } from './connection'
export const providerContact = (conn: Connection, address: string) => conn.provider === 'mango' ? mangoContact(conn, address) : conn.provider==='constant-contact'?constantContactContact(conn,address):mailchimpContact(conn, address)
export const suppressProvider = (conn: Connection, address: string, key: string) => conn.provider === 'mango' ? suppressMango(conn, address, key) : conn.provider==='constant-contact'?suppressConstantContact(conn,address):suppressMailchimp(conn, address)
export const restricted = (contact: Row) => mangoRestricted(contact)
export const subscribed = (contact: Row | null) => mangoSubscribed(contact)
/** Mango subscribes with Coffer's evidence when the donor joins a Coffer list; Mailchimp asks the donor to confirm. */
export async function captureProviderConsent(conn: Connection, donor: Row, organisation: string) {
 return conn.provider === 'mailchimp' ? captureMailchimpConsent(conn, donor, organisation) : conn.provider==='constant-contact'?syncConstantContactProfile(conn,donor):listInMango(conn, donor, organisation, 'Coffer donors')
}
export { listInMango, createMailchimpCampaign, composeMailchimpCampaign }
export const createProviderCampaign=(conn:Connection,row:Row,saveList?:(listId:string)=>Promise<void>)=>conn.provider==='constant-contact'?createConstantContactCampaign(conn,row,saveList):createMailchimpCampaign(conn,row)
export const composeProviderCampaign=(conn:Connection,row:Row,draft:Row,beforeSend?:()=>Promise<void>)=>conn.provider==='constant-contact'?composeConstantContactCampaign(conn,row,draft,beforeSend):composeMailchimpCampaign(conn,row,draft,beforeSend)
export async function providerResults(conn: Connection, row: Row) {
 if (row.provider !== conn.provider) fail('PROVIDER_CHANGED', 'Reconnect the provider that received this campaign to refresh its results.', 409)
 return conn.provider==='constant-contact'?constantContactResults(conn,row):mailchimpResults(conn, row)
}
