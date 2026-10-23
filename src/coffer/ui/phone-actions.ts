import type { Context, Row } from '../db'
import { area, box, e, form } from './common'

/** A donor's common field actions open directly, without a disclosure or menu. */
export function phoneActions(c: Context, donor: Row, day: string, mode: string) {
 const base = `/app/donors/${encodeURIComponent(donor.id)}`
 const links = `<nav aria-label="Donor actions" class="actions phone-actions"><a href="${base}#giving-summary">Giving summary</a>${c.actor.role === 'agent' ? '' : `<a href="${base}?phone=call#phone-action">Log a call</a><a href="${base}?phone=meeting#phone-action">Log a meeting</a><a href="${base}?phone=gift#record">Record a gift</a>`}<a href="/app/calls">Today's tasks</a></nav>`
 if (c.actor.role === 'agent' || !['call', 'meeting'].includes(mode)) return links
 return links + box(mode === 'call' ? 'Log a call' : 'Log a meeting', form('interaction.record', area('Call or meeting notes', 'notes', '', 'required maxlength="8000"') + area('Next step', 'nextStep', '', 'maxlength="2000"'), `Save ${mode}`, { donorId: donor.id, kind: mode, occurredOn: day, who: c.actor.name, returnTo: 'donor' }) + `<p><a href="${e(base)}">Back to donor</a></p>`, 'phone-action')
}
