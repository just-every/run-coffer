import type { Row } from './db'

/** A person's three names: an override typed on the record wins, otherwise each follows the name parts.
 * Informal is the nickname, else the first name; formal is the prefix and last name, else the first and last name;
 * envelope is the prefix, first name, middle initial, last name and suffix. A record with no parts uses its display name. */
export function personNames(d: Row) {
 const defaults = JSON.parse(d.name_defaults || '{}')
 const full = [d.prefix,d.first_name,d.middle_name,d.last_name,d.suffix].filter(Boolean).join(' ') || d.name
 const initial = d.middle_name ? `${String(d.middle_name).trim()[0]?.toUpperCase()}.` : null
 const envelope = d.first_name || d.last_name ? [d.prefix, d.first_name, initial, d.last_name, d.suffix].filter(Boolean).join(' ') : d.name
 const formal = d.last_name && (d.prefix || d.first_name) ? `${d.prefix || d.first_name} ${d.last_name}` : d.name
 const computedFormal = defaults.formal === 'full' ? full : defaults.formal === 'first-last' ? [d.first_name,d.last_name].filter(Boolean).join(' ') || d.name : formal
 const informal = defaults.informal === 'nickname-only' ? d.nickname || d.formal_salutation || computedFormal : defaults.informal === 'first' ? d.first_name || computedFormal : defaults.informal === 'full' ? full : d.nickname || d.first_name || d.name
 const computedEnvelope = defaults.envelope === 'full' ? full : defaults.envelope === 'no-prefix' ? [d.first_name,initial,d.last_name,d.suffix].filter(Boolean).join(' ') || d.name : envelope
 return { informal: d.informal_salutation || informal, formal: d.formal_salutation || computedFormal, envelope: d.envelope_name || computedEnvelope }
}
/** The source's value is kept as an override only where it differs from what the name parts compute. */
export function importedOverrides(parts: Row, source: { informal?: string; formal?: string; envelope?: string }) {
 const computed = personNames(parts)
 const keep = (value: string | undefined, own: string) => value && value !== own ? value : null
 return { informal_salutation: keep(source.informal, computed.informal), formal_salutation: keep(source.formal, computed.formal), envelope_name: keep(source.envelope, computed.envelope) }
}

/** Template fields use the recipient's frozen addressing, keeping credited donor name parts separate. */
export const NAME_MERGE_FIELDS = ['prefix', 'first_name', 'middle_name', 'last_name', 'suffix', 'nickname', 'informal_salutation', 'formal_salutation', 'envelope_name']
export function nameMergeFields(d: Row): Record<string, string> {
 const names = d.letter_names ?? personNames(d)
 const fallback=names.formal?.trim()||d.greeting||'Friend'
 return { ...Object.fromEntries(['prefix','first_name','middle_name','last_name','suffix','nickname'].map(key => [key, String(d[key]??'').trim()?d[key]:fallback])),
  informal_salutation: names.informal?.trim()||fallback, formal_salutation: fallback, envelope_name: (d.letter_name??names.envelope)?.trim()||fallback }
}

/** Internal contact marker stays out of provider fields; it carries existing erasure/export custody. */
export function frozenNameFields(d:Row) {
 const address=d.letter_address?JSON.parse(d.letter_address):null
 return JSON.stringify({...nameMergeFields(d),...(d.selected_email_contact_id?{_emailContact:d.selected_email_contact_id,_emailContactVersion:d.selected_email_contact_version??null}:{}),...(d.selected_address_contact_id?{_addressContact:d.selected_address_contact_id}:{}),...(address?.attentionDonorId?{_attention:address.attentionDonorId}:{})})
}
