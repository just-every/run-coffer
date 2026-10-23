import { fontHead } from '../../base/font-head'
import { themeFrame } from '../../base/theme-frame'
import branding from '../../branding.json'
import { usd } from '../money'
import { longDate } from '../settings'
import { icon, sprite, type IconName } from './icons'

export const e = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export const money = usd
/** "October 17, 2026": a calendar day (a gift's received date, a due date) as recorded. */
export const longDay = (day: string | null | undefined) => day ? longDate(day.slice(0, 10)) : ''
/** "October 17, 2026": a recorded moment on the organization's calendar, or a calendar day as recorded. */
export const when = (at: string | null | undefined, timeZone: string) => at ? longDate(at.length <= 10 ? at : orgDay(at, timeZone)) : ''
/** The organization's calendar day ("2026-10-17") of a recorded moment. */
const orgDay = (at: string, timeZone: string) => new Date(at).toLocaleDateString('en-CA', { timeZone })
/** "Oct 16, 2026": the dense tables' date. */
export const shortDate = (day: string | null | undefined) => day ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.slice(0, 10)}T00:00:00Z`)) : ''
/** "Oct 15, 2026 · 8:04 AM" in the organization's time zone: every recorded moment on screen. */
export const moment = (at: string | null | undefined, timeZone: string) => {
 if (!at) return ''
 if (at.length <= 10) return shortDate(at)
 return `${shortDate(orgDay(at, timeZone))} · ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(at))}`
}
/** "Check · 4471", "Card", "Bank transfer": how a gift was paid, as every ledger shows it. */
export const paidBy = (g: Record<string, any>) => `${g.method.charAt(0).toUpperCase()}${g.method.slice(1)}${g.method === 'check' && g.reference ? ` · ${g.reference}` : ''}`
export const hidden = (name: string, value: unknown) => `<input type="hidden" name="${e(name)}" value="${e(value)}">`
export const field = (label: string, name: string, type = 'text', value: unknown = '', extra = '') =>
 `<label>${e(label)}<input name="${e(name)}" type="${type}" value="${e(value)}" ${extra}></label>`
export const area = (label: string, name: string, value: unknown = '', extra = '') => `<label>${e(label)}<textarea name="${e(name)}" ${extra}>${e(value)}</textarea></label>`
export const select = (label: string, name: string, options: readonly (string | [string, string])[], value = '', extra = '') =>
 `<label>${e(label)}<select name="${e(name)}" ${extra}>${options.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${e(v)}"${v === value ? ' selected' : ''}>${e(t)}</option>` }).join('')}</select></label>`
export const form = (command: string, content: string, button: string, values: Record<string, unknown> = {}, cls = '') =>
 `<form method="post" action="/app/actions"${cls ? ` class="${cls}"` : ''}>${hidden('command', command)}${Object.entries(values).map(([k, v]) => hidden(k, v)).join('')}${content}<button>${e(button)}</button></form>`
export const box = (title: string, content: string, id = '') => `<section class="card"${id ? ` id="${e(id)}"` : ''}><h2>${e(title)}</h2>${content}</section>`
export const chip = (value: unknown, tone = '') => `<span class="chip${tone ? ` ${tone}` : ''}">${e(value)}</span>`
/** A recorded fact as a person reads it: "amountCents" 25000 → "Amount" $250.00, "receivedOn" → "October 15, 2026",
 * a moment → "Oct 16, 2026 · 12:04 PM UTC"; identifiers and hashes stay as code. */
function fact(key: string, value: unknown): [string, string] {
 const label = (/^[a-z]+[A-Z]/.test(key) ? key.replace(/Cents$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() : key).replace(/^./, c => c.toUpperCase())
 if (/Cents$/.test(key) && typeof value === 'number') return [label, e(money(value))]
 if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return [label, e(longDay(value))]
 if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) return [label, `${e(moment(value, 'UTC'))} UTC`]
 if (Array.isArray(value)) return [label, value.length ? `<ul class="list">${value.map(v => `<li>${v && typeof v === 'object' ? fact('', v)[1] : e(v)}</li>`).join('')}</ul>` : '<span class="muted">None</span>']
 if (value && typeof value === 'object') return [label, `<dl>${Object.entries(value).map(([k, v]) => { const [l, shown] = fact(k, v); return `<dt>${e(l)}</dt><dd>${shown}</dd>` }).join('')}</dl>`]
 return [label, `<code>${e(typeof value === 'string' ? value : JSON.stringify(value))}</code>`]
}
export const details = (facts: Record<string, unknown>) => `<details class="facts"><summary>Details</summary><dl>${Object.entries(facts).map(([k, v]) => { const [label, shown] = fact(k, v); return `<dt>${e(label)}</dt><dd>${shown}</dd>` }).join('')}</dl></details>`
/** Guides live on the run site, which every installation can link. */
export const guide = (slug: string) => `https://run-coffer.com/docs/${slug}`
export const empty = (text: string) => `<p class="empty">${e(text)}</p>`
export const STATUS: Record<string, [string, string]> = {
 delivered: ['Delivered', 'ok'], submitted: ['Email submitted', 'info'], print: ['Print batch', 'warn'], printed: ['Printed', 'ok'], bounced: ['Bounced · print instead', 'alarm'], complained: ['Complaint · print instead', 'alarm'], rejected: ['Email rejected · print instead', 'warn'], sending: ['Sending', 'info'], uncertain: ['Submission uncertain', 'warn'],
 prepared: ['Waiting for approval', 'warn'], approved: ['Approved · export next', 'info'], exported: ['Exported · record sending', 'info'], sent: ['Sent', 'ok'], discarded: ['Discarded', ''],
}
export const status = (s: string) => chip(STATUS[s]?.[0] ?? s, STATUS[s]?.[1] ?? '')

const NAV: [string, string, IconName][] = [['/app', 'Today', 'home'], ['/app/donors', 'Donors', 'people'], ['/app/gifts', 'Gifts', 'gift'], ['/app/letters', 'Letters', 'mail'], ['/app/appeals', 'Appeals', 'send'], ['/app/giving', 'Giving', 'megaphone'], ['/app/payouts', 'Payouts', 'book'], ['/app/calls', 'Calls', 'phone'], ['/app/lapses', 'Lapses', 'clock'], ['/app/pipeline', 'Pipeline', 'chart'], ['/app/retention', 'Retention', 'trend'], ['/app/agent', 'Agent', 'spark'], ['/app/more', 'More', 'gear']]
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
const brand = `<a class="cf-brand" href="/app"><img src="/brand/mark.svg" alt="" width="40" height="40"><span>${e(branding.name)}</span></a>`
/** The working shell from the owner-picked app look: an indigo rail with the purse
 * mark and a thin strip of lit windows, a top bar with search, the organization and
 * Record gift, then the page on the cool-white work surface. Signed-out pages
 * (donor checkout, errors) get the mark and one centred card. */
function shell(title: string, body: string, actor: { name: string; role: string; org?: string } | undefined, path: string, hideTitle: boolean) {
 const heading = `<h1 class="cf-title${hideTitle ? ' sr' : ''}">${e(title)}</h1>`
 if (!actor) return `<main class="coffer cf-solo" id="main">${brand}${heading}${body}</main>`
 const current = NAV.filter(([href]) => path === href || (href !== '/app' && path.startsWith(href))).at(-1)?.[0]
 const nav = NAV.map(([href, label, glyph]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`).join('')
 const top = `<header class="cf-top"><form class="cf-find" role="search" method="get" action="/app/donors"><label class="sr" for="cf-find">Find a donor</label>${icon('search')}<input id="cf-find" name="q" type="search" placeholder="Name, email or household"></form>${actor.org ? `<span class="cf-org">${e(actor.org)}</span>` : ''}<a class="cf-tasks" href="/app/calls">Today’s tasks</a><a class="cf-record" href="/app/donors?record=1">Record gift</a><span class="cf-who"><span class="cf-avatar" aria-hidden="true">${e(initials(actor.name))}</span><span class="cf-who-name">${e(actor.name)}<small>${e(actor.role)}</small></span></span></header>`
 return `<a class="cf-skip" href="#main">Skip to content</a>${sprite}<div class="cf-shell"><aside class="cf-rail">${brand}<input type="checkbox" id="cf-menu" class="cf-menu-toggle"><label for="cf-menu" class="cf-menu-button">${icon('menu')}<span>Menu</span></label><nav aria-label="Main">${nav}</nav><div class="cf-windows" aria-hidden="true"></div></aside><div class="cf-work">${top}<main class="coffer" id="main">${heading}${body}</main></div></div>`
}
export async function page(title: string, body: string, actor?: { name: string; role: string; org?: string }, statusCode = 200, path = '', options: { hideTitle?: boolean } = {}) {
 const frame = await themeFrame({ href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor })
 return new Response(`<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} · ${e(branding.name)}</title>${fontHead}${frame.head}<link rel="stylesheet" href="/coffer.css"></head><body class="cf-app${actor ? '' : ' cf-public'}">${shell(title, body, actor, path, !!options.hideTitle)}</body></html>`,
  { status: statusCode, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'strict-origin', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; ${frame.policy}` } })
}
