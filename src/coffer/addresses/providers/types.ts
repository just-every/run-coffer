export interface PostalAddress {
 street: string
 street2?: string
 city: string
 state: string
 postalCode: string
 country: string
}

export interface AddressIdentity {
 id: string
 name: string
 kind: 'person' | 'organization'
}

/** Injectable only at the public HTTP edge; production uses the runtime fetch. */
export type ProviderFetch = (input: string, init: RequestInit) => Promise<Response>

export type ProviderErrorReason = 'not_configured' | 'invalid_request' | 'network_error' | 'http_error' | 'invalid_response' | 'provider_error'

export interface SmartyRequest {
 address: PostalAddress
 identity?: AddressIdentity
 authId: string
 authToken: string
}

export type SmartyResult = {
 status: 'verified' | 'unverified' | 'undeliverable' | 'error'
 /** Only a verified response supplies a replacement address. */
 address?: PostalAddress
 reason: ProviderErrorReason | 'unsupported_country' | 'incomplete_address' | 'no_match' | 'ambiguous_match' | 'incomplete_confirmation' | 'vacant' | 'no_stat' | 'phantom_route' | 'confirmed'
 providerCodes: string[]
}

export interface SmartMoverRecord {
 identity: AddressIdentity
 address: PostalAddress
}

export interface SmartMoverRequest {
 records: SmartMoverRecord[]
 customerId: string
 /** Stable across every batch in the same mailing list processing pass. */
 jobId: string
 /** Unique per batch; reuse only when retransmitting the identical batch. */
 executionId: string
 transmissionReference: string
 /** Owner-confirmed, current signed PAF; never inferred from a present key. */
 pafConfirmed: boolean
 /** Required only for a broker's individual list owner. */
 pafId?: string
 /** Number of unique names and addresses in the entire genuine list, not padding. */
 listSize: number
}

export interface SmartMoverAddressResult {
 id: string
 status: 'moved' | 'standardized' | 'unchanged' | 'undeliverable' | 'needs_review'
 /** Only a confirmed move or standardization supplies a replacement address. */
 address?: PostalAddress
 /** YYYY-MM, preserving the provider's month precision. */
 moveEffectiveMonth?: string
 reason: 'move_confirmed' | 'standardized' | 'no_move_match' | 'not_deliverable' | 'foreign_move' | 'incomplete_move' | 'address_unconfirmed'
 providerCodes: string[]
}

export type SmartMoverResult =
 | { status: 'completed'; results: SmartMoverAddressResult[] }
 | { status: 'error'; reason: ProviderErrorReason | 'paf_required' | 'list_too_small'; results: [] }
