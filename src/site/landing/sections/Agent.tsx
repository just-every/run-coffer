import { payout, tom } from '../data'
import { Check, Chip, Feature, Spark } from '../parts'

/** The development agent's morning: gifts reconciled, failed monthly gifts rescued, receipts sent, and one call to make. */
export function DevelopmentAgent() {
  return <Feature id="agent" eyebrow="The development agent" lead="Know who" tint="needs a call." label={`This morning: donor retention 61%, up 4; ${payout.gifts} gifts reconciled with Stripe; 3 monthly gifts failed, 2 recovered and 1 card expired with an update link sent; 4 unsent receipts sent; call ${tom.name}, lapsed ${tom.lapsed}, who gave ${tom.usual} every spring.`}
    art={<div className="card morning">
      <p className="morning-head"><span className="morning-title"><Spark />This morning</span><span className="retention">Donor retention <b>61%</b><em>↑ 4</em></span></p>
      <ul className="morning-rows">
        <li><Chip icon="gift" tone="green" /><p><b>{payout.gifts}</b> gifts reconciled with Stripe</p></li>
        <li><Chip icon="card" tone="coral" /><p><b>3</b> monthly gifts failed<span className="soft"> · 2 recovered, 1 card expired → update link sent</span></p></li>
        <li><Chip icon="doc" tone="amber" /><p><b>4</b> receipts were unsent<span className="soft"> · sent</span></p></li>
        <li><Chip icon="phone" tone="violet" /><div><p><b>Call {tom.name}</b><span className="soft"> · lapsed {tom.lapsed} · gave {tom.usual} every spring</span></p><p className="morning-actions"><span className="btn-solid">Add to my calls</span><span className="btn-line">See draft note</span></p></div></li>
      </ul>
    </div>}>
    Coffer's agent reconciles every gift, rescues failed monthly gifts, sends missing receipts, drafts stewardship from your own history and tracks retention donor by donor.
  </Feature>
}

/** Move in: a Little Green Light import checked to the cent, with the other two sources it reads. */
export function MoveIn() {
  const rows: [string, string][] = [['Constituents', '4,812'], ['Households', '1,207'], ['Gifts', '38,406 · $3,912,550.00'], ['Duplicates merged', '63']]
  return <Feature id="move-in" flip eyebrow="Move in" lead="Bring every gift" tint="with you." label="Import from Little Green Light: 4,812 constituents, 1,207 households, 38,406 gifts totalling $3,912,550.00, 63 duplicates merged; gift totals match to the cent. Bloomerang and Raiser's Edge NXT also listed."
    art={<div className="import-wrap">
      <div className="card import">
        <p className="card-title">Import from Little Green Light</p>
        <ul className="import-rows">{rows.map(([what, count]) => <li key={what}><Check /><b>{what}</b><span>{count}</span></li>)}</ul>
        <p className="import-ok"><Check />Gift totals match to the cent</p>
      </div>
      <p className="sources"><span>Bloomerang</span><span>Raiser's Edge NXT</span></p>
    </div>}>
    Move from Little Green Light, Bloomerang or Raiser's Edge NXT with every donor, household and gift, and check the totals before you switch.
  </Feature>
}
