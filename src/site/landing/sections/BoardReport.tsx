import { org } from '../data'
import { Check, Drawing, Painting, StepCopy } from '../parts'

// 575 renewed + 63 new + 22 won back + 41 monthly donors who gave extra = 701. Retention 575 of 846 = 68%; 271 didn't renew.
const FUNDS: [string, string][] = [['General', '$38,120.00'], ['Youth Fund', '$15,220.00'], ['Building', '$8,000.00']]

const Leaf = () => <svg className="leaf" viewBox="0 0 40 40" aria-hidden="true"><path d="M19 37C10 33 4 24 7 9c9 2 14 10 12 28Z" /><path d="M21 37c1-14 6-24 15-27 1 14-5 23-15 27Z" /></svg>

/** Apr 30, the board report: the appeal closed at 102% of goal, retention donor by donor, the funds matched to the
 * books, and the 271 who didn't renew sent to the fall call list. A painted van rides on the paper's corner. */
export function BoardReport() {
  return <section id="report" className="story report flip" aria-labelledby="report-title">
    <div className="site-wrap story-row">
      <StepCopy id="report" when="Apr 30 · Board report" lead="Know" tint="who stayed." h={95.6} wl={503}>
        Close the appeal knowing who gave again, donor by donor, matched to the books.
      </StepCopy>
      <Drawing className="report-art" label={`${org.name}'s spring appeal report to the board, closed Apr 30: raised $61,340 of a $60,000 goal, 102%. Retention 68%: 575 of last spring's 846 donors gave again, up from 64%. 701 donors: 575 renewed, 63 new, 22 won back, 41 monthly donors gave extra. By fund: General $38,120.00, Youth Fund $15,220.00, Building $8,000.00, total $61,340.00. Didn't renew, 271: Priya Lal, $100 last spring; Greg Moss, $250 last spring; and 269 more, added to the fall call list. Matches QuickBooks Online to the cent.`}>
        <Painting className="van" name="van" widths={[240, 480, 720]} sizes="(max-width: 760px) 150px, 214px" />
        <div className="paper report-paper">
          <div className="rp-letterhead"><Leaf /><p><b>{org.name}</b>{org.street}<span className="dot">·</span>{org.town}</p></div>
          <p className="rp-title"><span>Spring appeal</span><span className="dot">·</span><span>report to the board</span></p>
          <p className="rp-closed">Closed Apr 30</p>
          <p className="rp-raised"><b>Raised $61,340</b> of a $60,000 goal</p>
          <p className="rp-meter"><span /><small>102%</small></p>
          <p className="rp-line"><b>Retention 68%:</b> 575 of last spring's 846 donors gave again, up from 64%.</p>
          <p className="rp-line"><b>701 donors:</b> 575 renewed, 63 new, 22 won back, 41 monthly donors gave extra.</p>
          <div className="rp-cols">
            <table className="rp-funds">
              <caption>By fund</caption>
              <tbody>{FUNDS.map(([fund, amount]) => <tr key={fund}><th scope="row">{fund}</th><td>{amount}</td></tr>)}</tbody>
              <tfoot><tr><th scope="row">Total</th><td>$61,340.00</td></tr></tfoot>
            </table>
            <div className="rp-lapsed">
              <p className="rp-lapsed-head">Didn't renew<span className="dot">·</span>271</p>
              <ul><li>Priya Lal<span className="dot">·</span>$100 last spring</li><li>Greg Moss<span className="dot">·</span>$250 last spring</li><li className="more">+269 more</li></ul>
              <p className="tag amber">Added to the fall call list</p>
            </div>
          </div>
          <p className="rp-books"><Check />Matches QuickBooks Online to the cent</p>
        </div>
      </Drawing>
    </div>
  </section>
}
