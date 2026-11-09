import type { Actor } from './auth'

/** Only native authentication may supply this row, joined through created_by.
 * The creator is provenance, never Business sponsorship or approval authority.
 * Persist the name on new records; historical rows keep their original snapshot.
 */
export function nativeKeyActor(key: { id: string; label: string; creator_id: string; creator_name: string }): Actor {
 return {
  id: key.id, name: `${key.label} for ${key.creator_name}`, role: 'agent',
  nativeKey: { id: key.id, label: key.label, creatorId: key.creator_id, creatorName: key.creator_name },
 }
}
