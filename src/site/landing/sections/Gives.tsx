import { maria, org } from '../data'
import { Check, Chrome, Drawing, Icon, StepCopy } from '../parts'

/** Mar 10, 7:01 PM: Maria opens the campaign page from the email and gives $100 by card; her donor portal beside it. */
export function Gives() {
  return <section id="gives" className="story gives flip" aria-labelledby="gives-title">
    <div className="site-wrap story-row">
      <StepCopy id="gives" when="Mar 10, 7:01 PM · Maria gives" lead="Her gift," tint="from the email." h={82} wl={534}>
        The button opens your campaign page. Card, bank or Apple Pay through your own Stripe account, once or monthly.
      </StepCopy>
      <Drawing className="gives-art" label={`The ${org.short} spring appeal page at ${org.site}/give/spring: $350 of $60,000 from 4 donors; $100 chosen, once, by card; Give $100. ${maria.short}'s donor portal: monthly $25, receipts, update card.`}>
        <div className="card browser">
          <Chrome url={`${org.site}/give/spring`} />
          <div className="give">
            <p className="give-title">{org.short} spring appeal</p>
            <p className="give-story">Fill the new cold-storage room</p>
            <p className="give-meter"><span /></p>
            <p className="give-raised"><b>$350</b> of $60,000<span className="dot">·</span>4 donors</p>
            <p className="give-amounts"><span>$25</span><span>$50</span><span className="on">$100</span><span>$250</span></p>
            <p className="give-monthly"><span className="toggle"><span /></span>Make it monthly</p>
            <p className="give-methods"><span className="on">Card</span><span>Bank (ACH)</span><span>Apple Pay</span></p>
            <p className="give-go">Give $100</p>
          </div>
        </div>
        <div className="card portal">
          <span className="portal-face">MD</span>
          <div><p className="portal-title">Donor portal<span className="dot">·</span>{maria.short}</p><p className="portal-links">Monthly {maria.monthly}<span className="dot">·</span>Receipts<span className="dot">·</span>Update card</p></div>
        </div>
      </Drawing>
    </div>
  </section>
}

/** Mar 10, 7:02 PM: the thank-you email with the tax receipt in it, delivered and opened. */
export function ThankYou() {
  return <section id="thanks" className="story thanks" aria-labelledby="thanks-title">
    <div className="site-wrap story-row">
      <StepCopy id="thanks" when="Mar 10, 7:02 PM · The thank-you" lead="Thanked by name," tint="in a minute." h={77.7} wl={609}>
        The thank-you carries the tax receipt with the IRS wording, and a link to manage her monthly gift.
      </StepCopy>
      <Drawing className="thanks-art" label={`Thank-you email from ${org.name}: "Thank you, Maria. Your $100 tonight, on top of your $25 each month, keeps the cold-storage room full." Receipt for a $100.00 gift on Mar 10, card ending ${maria.card}: no goods or services were provided in exchange for this gift. Manage your monthly gift. Delivered 7:02 PM, opened 7:40 PM.`}>
        <div className="card thank">
          <p className="mail-from">From {org.name}</p>
          <p className="thank-title">Thank you, Maria</p>
          <p className="thank-text">Your $100 tonight, on top of your $25 each month, keeps the cold-storage room full.</p>
          <div className="receipt">
            <span className="receipt-mark"><Icon name="doc" /></span>
            <div>
              <p className="receipt-line"><b>Receipt<span className="dot">·</span>Gift $100.00</b><span className="dot">·</span>Mar 10<span className="dot">·</span>Card ending {maria.card}</p>
              <p className="receipt-irs">No goods or services were provided in exchange for this gift.</p>
              <p className="receipt-link">Manage your monthly gift →</p>
            </div>
          </div>
        </div>
        <p className="card delivered"><Check /><span>Delivered 7:02 PM<span className="dot">·</span>Opened 7:40 PM</span></p>
      </Drawing>
    </div>
  </section>
}
