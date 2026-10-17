// The sample organization every drawing on the homepage shows: Riverbend Food Bank, mid-April 2026,
// its spring appeal open. Records that appear in more than one section are defined once here so
// their figures agree everywhere (BUILT.md lists each change from the desk's numbers).

export const org = 'Riverbend Food Bank'

export const springAppeal = { raised: '$48,210', goal: '$60,000', percent: 80.35, gifts: 312, recurring: 178 }

/** Maria Delgado gives $25 every month; the portal card and the 2025 statement are hers. */
export const maria = { short: 'Maria D.', name: 'Maria Delgado', monthly: '$25', place: 'Riverside, CA', since: 2022, statementYear: 2025, statementGifts: 12, statementTotal: '$300.00' }

/** Tom Okafor gave $500 every spring until Feb 12, 2025: lapsed 14 months by mid-April 2026. */
export const tom = { name: 'Tom Okafor', lapsed: '14 months', lastGift: 'Feb 12, 2025', place: 'Denver, CO', usual: '$500' }

/** The April 14 Stripe payout: 142 gifts less fees and one refund, split by fund. */
export const payout = {
  date: 'Apr 14', deposited: 'Apr 15', gifts: 142, gross: '$9,214.00', fees: '−$281.60', refund: '−$20.00', net: '$8,912.40',
  funds: [{ letter: 'G', name: 'General', amount: '$5,412.40', tone: 'green' }, { letter: 'Y', name: 'Youth Fund', amount: '$2,500.00', tone: 'violet' }, { letter: 'B', name: 'Building', amount: '$1,000.00', tone: 'coral' }],
} as const
