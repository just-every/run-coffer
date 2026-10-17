import { maria, springAppeal, tom } from './data'
import { Chip, Initials, Tick } from './parts'

/** Tonight at the food bank, as five cards: the appeal's progress, a monthly gift, a rescued card, a receipt and a call to make. */
export function HeroCards() {
  return <div className="hero-cards" role="img" aria-label={`Spring appeal ${springAppeal.raised} of ${springAppeal.goal}; ${maria.short}'s ${maria.monthly} monthly gift is active; a failed card was retried; a receipt for a $250.00 gift was sent; call ${tom.name}, lapsed ${tom.lapsed}.`}>
    <div aria-hidden="true">
      <div className="hc hc-appeal">
        <p className="hc-row"><strong>Spring appeal</strong><span><b>{springAppeal.raised}</b> of {springAppeal.goal}</span></p>
        <div className="meter"><span style={{ width: `${springAppeal.percent}%` }} /></div>
        <p className="hc-people"><span className="faces"><Initials tone="violet">AR</Initials><Initials tone="amber">JK</Initials><Initials tone="green">LP</Initials><Initials tone="coral">SM</Initials><span className="more">+308</span></span>{springAppeal.gifts} gifts · {springAppeal.recurring} recurring donors</p>
      </div>
      <div className="hc hc-small hc-monthly">
        <Chip icon="gift" tone="green" solid />
        <div><p className="hc-title">Monthly · {maria.monthly}<span className="pill green">Active</span></p><p className="hc-line">{maria.short}</p><p className="hc-soft">{maria.place} · since {maria.since}</p></div>
      </div>
      <div className="hc hc-small hc-failed">
        <Chip icon="card" tone="coral" solid />
        <div><p className="hc-title">Failed card</p><p className="hc-line">Retried successfully <Tick /></p><p className="hc-soft">James T.<br />Seattle, WA · $50 monthly</p></div>
      </div>
      <div className="hc hc-small hc-receipt">
        <Chip icon="doc" tone="violet" />
        <div><p className="hc-title">Receipt sent <Tick /></p><p className="hc-line">Gift $250.00</p><p className="hc-soft">No goods or services provided</p></div>
      </div>
      <div className="hc hc-small hc-call">
        <Chip icon="phone" tone="amber" solid />
        <div><p className="hc-title">Call {tom.name}</p><p className="hc-line">Lapsed {tom.lapsed}</p><p className="hc-soft">Last gift {tom.lastGift}<br />{tom.place} · {tom.usual}</p></div>
      </div>
    </div>
  </div>
}
