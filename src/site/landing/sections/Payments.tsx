import { maria, payout } from '../data'
import { Check, Feature, Icon } from '../parts'

/** Payments: one Stripe payout, its gifts, fees and refund, split by fund and matched to the bank deposit. */
export function Payments() {
  return <Feature id="payments" eyebrow="Payments" lead="Every dollar" tint="reconciled." label={`Stripe payout of ${payout.date}: ${payout.gifts} gifts ${payout.gross}, fees ${payout.fees}, one refund ${payout.refund}, net ${payout.net}, split General, Youth Fund and Building, matched to the QuickBooks deposit of ${payout.deposited}.`}
    art={<div className="card payout">
      <p className="payout-head"><strong>Stripe payout · {payout.date}</strong><b>{payout.net}</b></p>
      <dl className="payout-lines"><div><dt>{payout.gifts} gifts</dt><dd>{payout.gross}</dd></div><div><dt>Stripe fees</dt><dd>{payout.fees}</dd></div><div><dt>Refund · J. Patel</dt><dd>{payout.refund}</dd></div></dl>
      <div className="funds">{payout.funds.map(f => <p key={f.name} className={`fund ${f.tone}`}><span className="fund-letter">{f.letter}</span><span><small>{f.name}</small><strong>{f.amount}</strong></span></p>)}</div>
      <p className="payout-match"><Check />Matched to QuickBooks deposit · {payout.deposited}</p>
    </div>}>
    Gifts, fees, refunds and failed monthly payments sync from Stripe as they happen, and each payout matches its deposit in QuickBooks Online or Pantry, split by fund.
  </Feature>
}

/** Receipts: Maria's 2025 giving statement, emailed and opened, and a bounced email moved to the print batch. */
export function Receipts() {
  return <Feature id="receipts" flip eyebrow="Receipts" lead="Receipts go out" tint="on their own." label={`${maria.name}'s ${maria.statementYear} giving statement, ${maria.statementGifts} gifts ${maria.statementTotal}, emailed and opened Jan 8; a bounced email for R. Chen went to the print batch of 38 letters.`}
    art={<div className="receipt-wrap">
      <div className="card statement">
        <div className="st-head"><span className="st-doc"><Icon name="doc" /></span><div><p className="st-title">{maria.statementYear} giving statement</p><p className="st-sub">{maria.name} · {maria.statementGifts} gifts · {maria.statementTotal}</p></div></div>
        <p className="st-irs">No goods or services were provided in exchange for these gifts.</p>
        <p className="st-sent"><Check />Emailed Jan 8 · Opened Jan 8</p>
      </div>
      <p className="card bounce"><span className="bounce-mark"><Icon name="alert" /></span>Email bounced · R. Chen → added to print batch (38 letters)</p>
    </div>}>
    Thank-you letters and year-end tax receipts by email, or print-ready for mail, with the right IRS language and proof of delivery.
  </Feature>
}
