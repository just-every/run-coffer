import type { PostalAddress, ProviderFetch, SmartyRequest, SmartyResult } from './types'
import { completeAddress, isUnitedStates, object, postJson, text } from './transport.server'

// Server handler imports only. Credentials travel in Basic auth, never in a URL.
// https://www.smarty.com/docs/account/authentication
// https://www.smarty.com/docs/apis/us-street-api/reference
export async function verifySmartyAddress(input: SmartyRequest, fetcher?: ProviderFetch): Promise<SmartyResult> {
 const result = (status: SmartyResult['status'], reason: SmartyResult['reason'], providerCodes: string[] = []): SmartyResult => ({ status, reason, providerCodes })
 if (!isUnitedStates(input.address.country)) return result('unverified', 'unsupported_country')
 if (!completeAddress(input.address)) return result('unverified', 'incomplete_address')
 if (!input.authId?.trim() || !input.authToken?.trim()) return result('error', 'not_configured')
 let authorization: string
 try { authorization = `Basic ${btoa(`${input.authId.trim()}:${input.authToken.trim()}`)}` } catch { return result('error', 'invalid_request') }
 const id = input.identity?.id || 'address'
 const response = await postJson('https://us-street.api.smarty.com/street-address', [{
  input_id: id, street: input.address.street, street2: input.address.street2 ?? '',
  city: input.address.city, state: input.address.state, zipcode: input.address.postalCode,
  match: 'strict', candidates: 10,
 }], { Authorization: authorization }, fetcher)
 if ('error' in response) return result('error', response.error)
 if (!Array.isArray(response.value)) return result('error', 'invalid_response')
 if (!response.value.length) return result('unverified', 'no_match')
 const candidates = response.value.map(object)
 if (candidates.some(candidate => !candidate || candidate.input_id !== id || candidate.input_index !== 0)) return result('error', 'invalid_response')
 if (candidates.length !== 1) return result('unverified', 'ambiguous_match')
 const candidate = candidates[0]!, analysis = object(candidate.analysis), components = object(candidate.components)
 if (!analysis || !components) return result('error', 'invalid_response')
 const dpv = text(analysis.dpv_match_code), vacant = text(analysis.dpv_vacant), noStat = text(analysis.dpv_no_stat)
 const footnotes = text(analysis.dpv_footnotes)
 if (!['', 'Y', 'N', 'S', 'D'].includes(dpv) || !['', 'Y', 'N'].includes(vacant) || !['', 'Y', 'N'].includes(noStat) || !/^(?:[A-Z0-9]{2}){0,20}$/.test(footnotes)) return result('error', 'invalid_response')
 const notes = footnotes.match(/[A-Z0-9]{2}/g) ?? []
 const codes = [dpv && `DPV:${dpv}`, vacant && `VACANT:${vacant}`, noStat && `NO_STAT:${noStat}`, ...notes.map(code => `DPV_NOTE:${code}`)].filter(Boolean)
 if (vacant === 'Y') return result('undeliverable', 'vacant', codes)
 if (noStat === 'Y') return result('undeliverable', 'no_stat', codes)
 if (notes.includes('R7')) return result('undeliverable', 'phantom_route', codes)
 if (dpv !== 'Y' || vacant !== 'N' || noStat !== 'N') return result('unverified', 'incomplete_confirmation', codes)
 const address: PostalAddress = {
  street: text(candidate.delivery_line_1), street2: text(candidate.delivery_line_2),
  city: text(components.city_name), state: text(components.state_abbreviation),
  postalCode: text(components.zipcode), country: 'US',
 }
 const plus4 = text(components.plus4_code)
 if (plus4 && !/^\d{4}$/.test(plus4)) return result('error', 'invalid_response')
 if (!address.street || !address.city || !/^[A-Z]{2}$/.test(address.state) || !/^\d{5}$/.test(address.postalCode)) return result('error', 'invalid_response')
 if (plus4) address.postalCode += `-${plus4}`
 return { ...result('verified', 'confirmed', codes), address }
}
