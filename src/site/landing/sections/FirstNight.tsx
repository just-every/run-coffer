import { payout } from '../data'
import { Check, Drawing, Initials, StepCopy, type Tone } from '../parts'

type Status = { text: string; tone: Tone }
const GIFTS: { time: string; ini: string; tone: Tone; name: string; what: string; status: Status[]; failed?: boolean }[] = [
  { time: '7:01 PM', ini: 'MD', tone: 'green', name: 'Maria Delgado', what: '$100.00 · Card', status: [{ text: 'Thanked 7:02 PM', tone: 'green' }] },
  { time: '7:05 PM', ini: 'RC', tone: 'violet', name: 'Ruth Chen', what: '$250.00 · Apple Pay', status: [{ text: 'Receipt sent', tone: 'green' }] },
  { time: '7:14 PM', ini: 'LB', tone: 'coral', name: 'Lena Brooks', what: '$25.00 · Card', status: [{ text: 'Declined', tone: 'coral' }, { text: 'Retried 7:16 PM', tone: 'green' }], failed: true },
  { time: '7:21 PM', ini: 'SO', tone: 'amber', name: 'Sam Ortiz', what: '$500.00 · Bank (ACH)', status: [{ text: 'Pending · clears Mar 13', tone: 'amber' }] },
  { time: '7:33 PM', ini: 'AW', tone: 'violet', name: 'Alma Wu', what: '$100.00 · In memory of Grace Okafor', status: [{ text: 'Card to family queued', tone: 'violet' }] },
  { time: '7:48 PM', ini: 'NP', tone: 'amber', name: 'Nate Park', what: '$200.00 · Card', status: [{ text: 'Employer match requested', tone: 'amber' }] },
  { time: '8:10 PM', ini: 'HF', tone: 'green', name: 'Harbor Family Fund', what: '$5,000.00 · Check', status: [{ text: 'Logged by Ana R.', tone: 'green' }] },
]

/** Mar 10, the first night: the gifts as they land, a decline retried, an ACH gift pending, a tribute, a match and a check. */
export function FirstNight() {
  return <section id="first-night" className="story first-night" aria-labelledby="first-night-title">
    <div className="site-wrap story-row">
      <StepCopy id="first-night" when="Mar 10 · First night" lead="Forty-eight gifts" tint="by bedtime." h={86.7} wl={622}>
        Each gift lands on the donor's record, in the right fund, with its receipt.
      </StepCopy>
      <Drawing className="feed-art" label="Tonight's gifts, live: Maria Delgado $100.00 by card at 7:01 PM, thanked 7:02 PM; Ruth Chen $250.00 by Apple Pay, receipt sent; Lena Brooks $25.00 by card declined, retried 7:16 PM; Sam Ortiz $500.00 by bank (ACH), pending, clears Mar 13; Alma Wu $100.00 in memory of Grace Okafor, card to the family queued; Nate Park $200.00 by card, employer match requested; Harbor Family Fund $5,000.00 by check, logged by Ana R. Tonight: 48 gifts, $12,480.00.">
        <div className="card feed">
          <p className="feed-head"><span>Tonight's gifts</span><span className="live">live</span></p>
          <ul className="feed-rows">{GIFTS.map(g => <li key={g.ini} className={g.failed ? 'failed' : undefined}>
            <span className="feed-time">{g.time}</span>
            <Initials tone={g.tone}>{g.ini}</Initials>
            <div className="feed-body">
              <p className="feed-who"><b>{g.name}</b><span className="feed-at"><span className="dot">·</span>{g.time}</span><span className="feed-what">{g.what}</span></p>
              <p className="feed-status">{g.status.map((s, i) => <span key={s.text}>{i ? <span className="feed-arrow">→</span> : null}<span className={`tag ${s.tone}`}>{s.text}</span></span>)}</p>
            </div>
          </li>)}</ul>
          <p className="feed-foot">Tonight<span className="dot">·</span>48 gifts<span className="dot">·</span>$12,480.00</p>
        </div>
      </Drawing>
    </div>
  </section>
}

/** Mar 16, reconciling: the payout is $20.00 short of its gifts less fees until the refund is found and matched. */
export function Reconcile() {
  return <section id="reconcile" className="story reconcile flip" aria-labelledby="reconcile-title">
    <div className="site-wrap story-row">
      <StepCopy id="reconcile" when={`${payout.date} · Reconcile`} lead="Matched to the bank," tint="to the cent." h={66} wl={599}>
        Stripe payouts, fees and refunds sync on their own and match each QuickBooks Online deposit, fund by fund.
      </StepCopy>
      <Drawing className="payout-art" label={`Stripe payout of ${payout.date}, ${payout.net}: ${payout.gifts} gifts ${payout.gross} less Stripe fees ${payout.fees} is ${payout.expected} expected, but the deposit is ${payout.net}, off by $20.00. A ${payout.refund} refund to J. Patel was found at Stripe and matched to the QuickBooks deposit. General ${payout.funds[0].amount}, Youth Fund ${payout.funds[1].amount}, Building ${payout.funds[2].amount}.`}>
        <div className="card payout">
          <p className="payout-head"><span>Stripe payout<span className="dot">·</span>{payout.date}</span><b>{payout.net}</b></p>
          <dl className="payout-lines"><div><dt>{payout.gifts} gifts</dt><dd>{payout.gross}</dd></div><div><dt>Stripe fees</dt><dd>{payout.fees}</dd></div></dl>
          <p className="payout-gap"><span>Expected {payout.expected}</span><span className="dot">·</span><span>deposit {payout.net}</span><span className="dot">·</span><span>off by $20.00</span></p>
          <p className="payout-found"><Check /><span><span>Refund<span className="dot">·</span>J. Patel {payout.refund} found at Stripe</span><span className="dot">·</span><span>matched to QuickBooks deposit</span></span></p>
          <p className="payout-funds">{payout.funds.map(f => <span key={f.name} className={`fund ${f.tone}`}><span>{f.name}</span><b>{f.amount}</b></span>)}</p>
        </div>
      </Drawing>
    </div>
  </section>
}
