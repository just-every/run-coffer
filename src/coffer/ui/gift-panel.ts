// The Gifts screen's right-hand donor panel: who they are, their recent gifts or
// card retries, the development agent's place, and contact and consent.
import type { Row, Context } from '../db'
import { donorPanelData } from '../gift-list'
import { STATUS, chip, e, money, shortDate } from './common'
import { icon, type IconName } from './icons'

type Step = { at: string; tone: 'ok' | 'alarm' | 'warn' | 'doc'; glyph: IconName; title: string; detail: string }
const RETRY: Record<string, [Step['tone'], IconName, string]> = {
 'recovery.waiting': ['alarm', 'alert', 'Card declined'], 'recovery.recovered': ['ok', 'check', 'Retry cleared'], 'recovery.lapsed': ['warn', 'alert', 'Monthly gift lapsed'],
 'recovery.card_link_sent': ['doc', 'mail', 'Card-update email sent'], 'recovery.card_link_failed': ['warn', 'mail', 'Card-update email not delivered'], 'recovery.card_link_skipped': ['warn', 'mail', 'No card-update email: no donor account'],
}
const consent = (value: string | undefined) => value === 'granted' ? chip('Yes', 'ok') : value === 'withdrawn' ? chip('Withdrawn', 'alarm') : chip('Not asked')

export async function donorPanel(c: Context, donorId: string, timezone: string) {
 const p = await donorPanelData(c, donorId), d = p.donor
 if (!d) return ''
 const stamp = (at: string) => at.length > 10 ? `${shortDate(new Date(at).toLocaleDateString('en-CA', { timeZone: timezone }))} · ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(at))}` : shortDate(at)
 const first = d.name.split(/\s+/)[0], href = `/app/donors/${encodeURIComponent(d.id)}`
 const since = p.totals.first_gift?.slice(0, 4), years = since ? Number(new Date(c.now).getUTCFullYear()) - Number(since) : 0

 const steps: Step[] = p.retries.length
  ? p.retries.filter((r: Row) => RETRY[r.kind]).map((r: Row) => { const [tone, glyph, title] = RETRY[r.kind]; return { at: r.at, tone, glyph, title, detail: r.kind === 'recovery.recovered' ? `${money(p.recovery!.amount_cents)} monthly gift processed` : r.summary } })
  : p.recent.flatMap((g: Row) => [
   { at: g.created_at, tone: 'ok', glyph: 'check', title: 'Gift recorded', detail: `${money(g.amount_cents)} to ${g.fund}` } as Step,
   ...(g.ack_status ? [{ at: g.ack_at, tone: 'doc', glyph: 'file', title: `Letter: ${STATUS[g.ack_status]?.[0] ?? g.ack_status}`, detail: `Acknowledges the ${money(g.amount_cents)} gift` } as Step] : []),
  ])
 const timeline = steps.sort((a, b) => a.at.localeCompare(b.at)).slice(-3)
 const activity = `<section class="cf-card cf-activity"><h3>Recent activity</h3>${timeline.length ? `<ol class="cf-steps">${timeline.map(s => `<li class="${s.tone}"><span class="cf-step-icon">${icon(s.glyph)}</span><div><p class="cf-when">${e(stamp(s.at))}</p><p class="cf-step-title">${e(s.title)}</p><p>${e(s.detail)}</p></div></li>`).join('')}</ol>` : '<p class="muted">No gifts recorded yet.</p>'}</section>`

 const r = p.recovery
 const draftButton = p.aiReady
  ? `<form method="post" action="/app/agent/stewardship/draft">${['donorId', 'kind'].map((k, i) => `<input type="hidden" name="${k}" value="${e(i ? 'thank_you' : d.id)}">`).join('')}<button>Draft a thank-you</button></form>`
  : '<a class="button" href="/app/agent/setup">Set up AI drafting</a>'
 const agent = !p.agent ? '' : `<section class="cf-agent" aria-label="Development agent"><h3>${icon('spark')}Development agent</h3>${p.draft
  ? `<p>I drafted a ${p.draft.kind === 'impact' ? 'impact note' : 'thank-you note'} for ${e(first)}: “${e(p.draft.subject)}”. It waits for a person to review and send.</p><div class="cf-agent-actions"><a class="button" href="/app/agent/stewardship?donorId=${encodeURIComponent(d.id)}#draft-${e(p.draft.id)}">Review and send</a><a class="button secondary" href="/app/agent/stewardship?donorId=${encodeURIComponent(d.id)}#draft-${e(p.draft.id)}">Edit</a></div>`
  : `<p>${r?.state === 'recovered' ? `${e(first)}’s monthly card was declined ${e(shortDate(r.created_at))} and Stripe’s retry cleared ${e(shortDate(r.last_checked_at))}. ` : ''}I can draft a thank-you from ${e(first)}’s gifts, funds and conversations for you to review.</p><div class="cf-agent-actions">${draftButton}</div>`}</section>`

 const mail = [d.address_line1, d.address_line2, [[d.city, d.region].filter(Boolean).join(', '), d.postal_code].filter(Boolean).join(' ')].filter(Boolean)
 const details = `<section class="cf-card cf-contact"><h3>Donor details <a href="${href}" aria-label="Edit ${e(d.name)}’s details">${icon('edit')}</a></h3><dl>
  <dt>Email</dt><dd>${d.email ? e(d.email) : '<span class="muted">None</span>'}</dd><dd class="cf-consent">${consent(p.consent.email)}</dd>
  <dt>Mail</dt><dd>${mail.length ? mail.map(e).join('<br>') : '<span class="muted">None</span>'}</dd><dd class="cf-consent">${consent(p.consent.mail)}</dd>
  ${d.phone ? `<dt>Phone</dt><dd class="cf-wide">${e(d.phone)}</dd>` : ''}${d.household ? `<dt>Household</dt><dd class="cf-wide">${e(d.household)} (${p.members})</dd>` : ''}</dl></section>`

 const initials = d.name.split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
 return `<aside class="cf-donor" id="donor" aria-label="Selected donor"><section class="cf-card cf-identity-card"><div class="cf-identity"><span class="cf-initials" aria-hidden="true">${e(initials)}</span><div><h2><a href="${href}">${e(d.name)}</a></h2><p>${e([d.city, d.region].filter(Boolean).join(', '))}</p></div></div>
  <div class="cf-donor-stats"><p><strong>${p.totals.gifts}</strong><span>${p.totals.gifts === 1 ? 'gift' : 'gifts'}${since ? ` since ${since}` : ''}</span></p><p><strong>${money(p.totals.lifetime_cents)}</strong><span>lifetime giving</span></p><p><strong>${years < 1 ? 'New' : `${years} ${years === 1 ? 'year' : 'years'}`}</strong><span>${years < 1 ? 'donor this year' : 'as a donor'}</span></p></div>
  <nav class="cf-panel-tabs" aria-label="${e(d.name)}"><a aria-current="page" href="#donor">Overview</a><a href="${href}">Gifts</a><a href="${href}#timeline">Timeline</a><a href="${href}#consent">Consent</a></nav></section>${activity}${agent}${details}</aside>`
}
