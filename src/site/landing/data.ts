// The sample organization every drawing on the homepage shows: Wrenfield Food Bank (a fictional name, checked
// unused) and its 2026 spring appeal, told as dated steps from moving in to year-end receipts. Records that
// appear in more than one section are defined once here so their figures agree everywhere; every weekday named
// is the real 2026 calendar's (Mar 10 a Tuesday, Mar 16 a Monday, Apr 2 a Thursday, Jan 8, 2027 a Friday).

export const org = { name: 'Wrenfield Food Bank', short: 'Wrenfield', street: '212 River Street', town: 'Wrenfield, OR', site: 'wrenfieldfoodbank.org' }

/** The hero's mid-appeal snapshot. */
export const springAppeal = { raised: '$48,210', goal: '$60,000', percent: 80.35, gifts: 312, recurring: 178 }

/** Maria Delgado gives $25 every month ($300, 180 meals, in 2025) and gives $100 more from the appeal email on Mar 10. */
export const maria = { short: 'Maria D.', name: 'Maria Delgado', monthly: '$25', place: 'Riverside, CA', since: 2022, card: '7310' }

/** Tom Okafor gave $500 a year until Feb 12, 2025 (Winter appeal): lapsed 14 months by Apr 2, 2026; Ana renews him on Apr 3. */
export const tom = { name: 'Tom Okafor', lapsed: '14 months', lastGift: 'Feb 12, 2025', place: 'Denver, CO', usual: '$500' }

/** The appeal's seven dates, each linking to its step on the page. */
export const stops = [
  { date: 'Feb 20', what: 'Move in', href: '#move-in', kind: 'start' },
  { date: 'Mar 3', what: 'Choose who', href: '#choose' },
  { date: 'Mar 10', what: 'Send and first night', href: '#send', kind: 'night', ticks: '7:00 Send · 7:01 Maria gives · 7:02 Thanked' },
  { date: 'Mar 16', what: 'Reconcile', href: '#reconcile' },
  { date: 'Apr 2', what: 'Make calls', href: '#calls' },
  { date: 'Apr 30', what: 'Board report', href: '#report' },
  { date: 'Jan 8', what: 'Year-end', href: '#year-end' },
]

/** The Mar 16 (Monday) Stripe payout: 142 gifts less fees, $20 short of expected until the refund is found. */
export const payout = {
  date: 'Mar 16', gifts: 142, gross: '$9,214.00', fees: '−$281.60', expected: '$8,932.40', refund: '−$20.00', net: '$8,912.40',
  funds: [{ name: 'General', amount: '$5,412.40', tone: 'violet' }, { name: 'Youth Fund', amount: '$2,500.00', tone: 'green' }, { name: 'Building', amount: '$1,000.00', tone: 'amber' }],
} as const
