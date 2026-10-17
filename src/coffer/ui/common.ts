import { fontHead } from '../../base/font-head'
import { themeFrame } from '../../base/theme-frame'
import branding from '../../branding.json'
import { usd } from '../money'
import { longDate } from '../settings'

export const e = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export const money = usd
export const when = (day: string | null | undefined) => day ? longDate(day.slice(0, 10)) : ''
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
export const details = (facts: Record<string, unknown>) => `<details class="facts"><summary>Details</summary><dl>${Object.entries(facts).map(([k, v]) => `<dt>${e(k)}</dt><dd><code>${e(typeof v === 'string' ? v : JSON.stringify(v))}</code></dd>`).join('')}</dl></details>`
/** Guides live on the run site, which every installation can link. */
export const guide = (slug: string) => `https://run-coffer.com/docs/${slug}`
export const empty = (text: string) => `<p class="empty">${e(text)}</p>`
export const STATUS: Record<string, [string, string]> = {
 delivered: ['Delivered', 'ok'], submitted: ['Email submitted', 'info'], print: ['Print batch', 'warn'], printed: ['Printed', 'ok'], bounced: ['Bounced · print instead', 'alarm'], complained: ['Complaint · print instead', 'alarm'], rejected: ['Email rejected · print instead', 'warn'], sending: ['Sending', 'info'], uncertain: ['Submission uncertain', 'warn'],
 prepared: ['Waiting for approval', 'warn'], approved: ['Approved · export next', 'info'], exported: ['Exported · record sending', 'info'], sent: ['Sent', 'ok'], discarded: ['Discarded', ''],
}
export const status = (s: string) => chip(STATUS[s]?.[0] ?? s, STATUS[s]?.[1] ?? '')

const NAV: [string, string][] = [['/app', 'Today'], ['/app/donors', 'Donors'], ['/app/letters', 'Letters'], ['/app/appeals', 'Appeals'], ['/app/giving', 'Giving'], ['/app/payouts', 'Payouts'], ['/app/calls', 'Calls'], ['/app/lapses', 'Lapses'], ['/app/pipeline', 'Pipeline'], ['/app/retention', 'Retention'], ['/app/agent', 'Agent'], ['/app/more', 'More']]
export async function page(title: string, body: string, actor?: { name: string; role: string }, statusCode = 200, path = '') {
 const frame = await themeFrame({ href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor })
 const current = NAV.filter(([href]) => path === href || (href !== '/app' && path.startsWith(href))).at(-1)?.[0]
 const nav = actor ? `<nav aria-label="Main">${NAV.map(([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>` : ''
 return new Response(`<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} · ${e(branding.name)}</title>${fontHead}${frame.head}<link rel="stylesheet" href="/coffer.css"></head><body><main class="coffer">${frame.brand}<header><div><p class="eyebrow">Donor records and gift receipts</p><h1>${e(title)}</h1></div>${actor ? `<p class="who">${e(actor.name)} · ${e(actor.role)}</p>` : ''}</header>${nav}${body}</main></body></html>`,
  { status: statusCode, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'strict-origin', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; ${frame.policy}` } })
}
