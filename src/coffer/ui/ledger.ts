// The dense ledger card the Gifts screen draws (tabs or a title, the pager on the
// right, one-line rows on hairlines), shared by the other list screens so they
// carry the main screen's density. Rows use the Gifts ledger's cell classes, so
// at phone width they collapse to the same cards.
import { e } from './common'
import { icon } from './icons'

/** "13–24 of 87" with previous and next arrows; nothing when everything fits on one page. */
export function pager(total: number, page: number, size: number, href: (page: number) => string, always = false) {
 if (!total || (!always && total <= size)) return ''
 const first = page * size, last = Math.min(total, first + size)
 const arrow = (to: number, ok: boolean, label: string, cls = '') => ok ? `<a href="${e(href(to))}" aria-label="${label}">${icon('right', cls)}</a>` : `<span class="cf-off" aria-hidden="true">${icon('right', cls)}</span>`
 return `<p class="cf-pager"><span>${first + 1}–${last} of ${total}</span>${arrow(page - 1, page > 0, 'Previous page', 'cf-back')}${arrow(page + 1, last < total, 'Next page')}</p>`
}

export const pageParam = (url: URL) => Math.max(0, Math.floor(Number(url.searchParams.get('page') ?? 0)) || 0)

/** A titled ledger card: the heading and pager share the top line, then the table. */
export const ledgerCard = (title: string, table: string, head = '', foot = '') =>
 `<section class="cf-ledger cf-ledger-card" aria-label="${e(title)}"><h2 class="cf-ledger-title">${e(title)}</h2>${head}<div class="cf-ledger-body">${table}</div>${foot}</section>`
