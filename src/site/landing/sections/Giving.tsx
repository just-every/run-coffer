import { maria, org, tom } from '../data'
import { Feature, Icon, Initials } from '../parts'

/** Online giving: the spring appeal's donation form, monthly and $50 chosen, and the donor portal's note beside it. */
export function Giving() {
  return <Feature id="giving" eyebrow="Online giving" lead="Give in" tint="a minute." label={`The spring appeal's donation form for ${org}: $50 chosen, made monthly, paid by card; ${maria.short} updated her card in the donor portal.`}
    art={<div className="give-wrap">
      <div className="card give">
        <p className="give-title">Spring appeal · {org}</p>
        <div className="give-amounts"><span>$25</span><span className="on">$50</span><span>$100</span><span>$250</span></div>
        <p className="give-monthly"><span className="toggle"><span /></span>Make it monthly</p>
        <div className="give-methods"><span className="on"><span className="card-glyph" />Card</span><span><Icon name="bank" />Bank (ACH)</span><span><Icon name="wallet" />Apple Pay</span></div>
        <p className="give-go">Give $50 monthly</p>
      </div>
      <p className="card give-portal"><span className="portal-face"><Icon name="person" /></span>Donor portal · Card updated by {maria.short}</p>
    </div>}>
    Donation forms and campaign pages with monthly giving, card, bank and Apple Pay checkout, and a portal where donors update their own card.
  </Feature>
}

/** Donors: the Okafor household, its lifetime giving and the last four gifts with a match, a tribute and a soft credit. */
export function Donors() {
  const lines = [
    ['Feb 12, 2025', '$500', 'Spring appeal', ''],
    ['Dec 2, 2024', '$1,000', 'Employer match', 'Lockheed Martin'],
    ['Jun 18, 2024', '$250', 'In memory of Grace Okafor', ''],
    ['Apr 9, 2024', '', 'Soft credit to Ada', 'Gala table $2,400'],
  ]
  return <Feature id="donors" flip eyebrow="Donors" lead="Every donor's" tint="whole story." label={`The Okafor household in ${tom.place}: $6,850 given since Mar 4, 2016, with a spring gift, an employer match, a tribute gift and a soft credit.`}
    art={<div className="card household">
      <div className="hh-head"><Initials tone="violet">TO</Initials><div><p className="hh-name">Okafor household</p><p className="hh-sub">Tom &amp; Ada Okafor · {tom.place}</p></div></div>
      <div className="hh-stats"><p><span>Lifetime</span><strong>$6,850</strong></p><p><span>First gift</span><strong>Mar 4, 2016</strong></p></div>
      <ul className="hh-lines">{lines.map(([day, amount, what, more]) => <li key={day}><span className="day">{day}</span><span className="dot">·</span>{amount ? <><strong>{amount}</strong><span className="dot">·</span></> : null}<span>{what}{more ? <><span className="dot">·</span>{more}</> : null}</span></li>)}</ul>
    </div>}>
    Households, relationships, every gift and every conversation in one place, with soft credits, tributes and employer matches.
  </Feature>
}
