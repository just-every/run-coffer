import { SOFT_ACK_METHODS } from '../soft-credit-ack'
import { field, select } from './common'

/** The same gift-level filters are shared by live lists and ledger reports. */
export function acknowledgmentFilterFields(input: URL | Record<string, unknown>): string {
 const values=input instanceof URL?Object.fromEntries(input.searchParams):input
 return `${select('Acknowledgment status','ackStatus',[['','All acknowledgment statuses'],'not acknowledged','acknowledged','do not acknowledge'],String(values.ackStatus??''),'aria-label="Acknowledgment status"')}${field('Thank-you from','ackFrom','date',values.ackFrom)}${field('Thank-you through','ackThrough','date',values.ackThrough)}${select('Thank-you method','ackMethod',[['','All thank-you methods'],...SOFT_ACK_METHODS],String(values.ackMethod??''),'aria-label="Thank-you method"')}${field('Linked acknowledgment record','ackLink','text',values.ackLink,'maxlength="200"')}${field('Gift over (USD)','giftOver','text',values.giftOver,'inputmode="decimal" pattern="[0-9]+([.][0-9]{1,2})?"')}`
}
