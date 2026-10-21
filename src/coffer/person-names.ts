import type { Row } from './db'

/** A person's three names: an override typed on the record wins, otherwise each follows the name parts.
 * Informal is the nickname, else the first name; formal is the prefix and last name, else the first and last name;
 * envelope is the prefix, first name, middle initial, last name and suffix. A record with no parts uses its display name. */
export function personNames(d: Row) {
 const initial = d.middle_name ? `${String(d.middle_name).trim()[0]?.toUpperCase()}.` : null
 const envelope = d.first_name || d.last_name ? [d.prefix, d.first_name, initial, d.last_name, d.suffix].filter(Boolean).join(' ') : d.name
 const formal = d.last_name && (d.prefix || d.first_name) ? `${d.prefix || d.first_name} ${d.last_name}` : d.name
 return { informal: d.informal_salutation || d.nickname || d.first_name || d.name, formal: d.formal_salutation || formal, envelope: d.envelope_name || envelope }
}
/** The source's value is kept as an override only where it differs from what the name parts compute. */
export function importedOverrides(parts: Row, source: { informal?: string; formal?: string; envelope?: string }) {
 const computed = personNames(parts)
 const keep = (value: string | undefined, own: string) => value && value !== own ? value : null
 return { informal_salutation: keep(source.informal, computed.informal), formal_salutation: keep(source.formal, computed.formal), envelope_name: keep(source.envelope, computed.envelope) }
}
