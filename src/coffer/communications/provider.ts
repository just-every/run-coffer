import { fail, type Row } from '../db'
import type { Connection } from './connection'
import { mangoContact, suppressMango, listInMango, restricted as mangoRestricted, subscribed as mangoSubscribed } from './mango'
import { mailchimpContact, suppressMailchimp, captureMailchimpConsent, createMailchimpCampaign, composeMailchimpCampaign, mailchimpResults } from './mailchimp'

export { providerTitle } from './connection'
export const providerContact = (conn: Connection, address: string) => conn.provider === 'mango' ? mangoContact(conn, address) : mailchimpContact(conn, address)
export const suppressProvider = (conn: Connection, address: string, key: string) => conn.provider === 'mango' ? suppressMango(conn, address, key) : suppressMailchimp(conn, address)
export const restricted = (contact: Row) => mangoRestricted(contact)
export const subscribed = (contact: Row | null) => mangoSubscribed(contact)
/** Mango subscribes with Coffer's evidence when the donor joins a Coffer list; Mailchimp asks the donor to confirm. */
export async function captureProviderConsent(conn: Connection, donor: Row, organisation: string) {
 return conn.provider === 'mailchimp' ? captureMailchimpConsent(conn, donor, organisation) : listInMango(conn, donor, organisation, 'Coffer donors')
}
export { listInMango, createMailchimpCampaign, composeMailchimpCampaign }
export async function providerResults(conn: Connection, row: Row) {
 if (row.provider !== conn.provider) fail('PROVIDER_CHANGED', 'Reconnect the provider that received this campaign to refresh its results.', 409)
 return mailchimpResults(conn, row)
}
