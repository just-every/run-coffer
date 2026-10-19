import { tom } from '../data'
import { Check, Chip, Drawing, Icon, Initials, Painting, Spark, StepCopy } from '../parts'

const OVERNIGHT = [['61 gifts reconciled with Stripe'], ['3 failed monthly gifts', '2 recovered, 1 update link sent'], ['4 receipts were unsent', 'sent 6:10 AM'], ['Retention rescored for 1,132 donors']]

/** Apr 2, making calls: what the development agent did overnight, the Okafor household's story newest first, and the
 * day's call list with Tom on top. A lit cottage window looks on from behind the household. */
export function Calls() {
  return <section id="calls" className="story calls" aria-labelledby="calls-title">
    <div className="site-wrap story-row">
      <StepCopy id="calls" when="Apr 2 · Make calls" lead="Your morning," tint={<>already <br className="wide-only" />sorted.</>} h={80.5} wl={486}>
        Overnight, Coffer's development agent reconciles gifts, rescues failed monthly gifts, sends missed receipts and ranks who needs a call.
      </StepCopy>
      <Drawing className="calls-art" label={`Overnight on Apr 2: 61 gifts reconciled with Stripe; 3 failed monthly gifts, 2 recovered and 1 update link sent; 4 unsent receipts sent at 6:10 AM; retention rescored for 1,132 donors. The Okafor household, Tom and Ada in ${tom.place}: $4,350 lifetime since April 2017; Mar 10 Alma Wu gave $100 in memory of Grace Okafor; Jan 14 Ana R. called and they asked about the cold-storage room; Feb 12, 2025 $500 to the Winter appeal; Dec 2023 a $1,000 DAF grant, soft credit. Today's call list for Ana R., 3 calls: ${tom.name}, lapsed ${tom.lapsed} at $500 a year, last gift ${tom.lastGift}, suggest renewing at $500; Harbor Family Fund, $50,000 proposal follow-up due Apr 6; Ruth Chen, a welcome call after her first $250 gift. Apr 3: Ana called Tom and he renewed at $500.`}>
        <Painting className="cottage-window" name="cottage-window" widths={[257, 514]} sizes="257px" />
        <div className="card overnight">
          <p className="overnight-head"><Spark /><span>Overnight<span className="dot">·</span>Apr 2</span></p>
          <ul>{OVERNIGHT.map(([lead, rest]) => <li key={lead}><Check /><span>{lead}{rest ? <><span className="dot">·</span>{rest}</> : null}</span></li>)}</ul>
        </div>
        <div className="card household">
          <div className="hh-head"><Initials tone="violet">TO</Initials><div><p className="hh-name">Okafor household</p><p className="hh-sub">Tom &amp; Ada Okafor<span className="dot">·</span>{tom.place}</p></div></div>
          <p className="hh-stats"><span>Lifetime<b>$4,350</b></span><span>First gift<b>Apr 2017</b></span></p>
          <ol className="hh-story">
            <li className="violet"><span>Mar 10<span className="dot">·</span>Alma Wu gave $100 in memory of Grace Okafor <span className="tag violet">Tribute</span></span></li>
            <li className="call"><Chip icon="phone" tone="amber" /><span>Jan 14<span className="dot">·</span>Call by Ana R.<span className="dot">·</span>asked about the <span className="nowrap">cold-storage room</span></span></li>
            <li className="green"><span>Feb 12, 2025<span className="dot">·</span>$500<span className="hh-what">Winter appeal</span></span></li>
            <li className="grey"><span>Dec 2023<span className="dot">·</span>$1,000 DAF grant <span className="tag grey">Soft credit</span></span></li>
          </ol>
        </div>
        <div className="card call-list">
          <p className="cl-head"><b>Call list<span className="dot">·</span>today</b><span>3 calls<span className="dot">·</span>Ana R.</span></p>
          <div className="cl-tom">
            <div className="cl-row"><Chip icon="phone" tone="amber" fill /><Initials tone="violet">TO</Initials><div><p className="cl-name">{tom.name}</p><p className="cl-sub">Lapsed {tom.lapsed}<span className="dot">·</span>$500 a year</p></div><Icon name="chevron" className="cl-chevron" /></div>
            <ul className="cl-notes"><li>Last gift {tom.lastGift}</li><li>Asked about the cold-storage room in January</li><li>Suggest: renew at $500</li></ul>
            <p className="cl-actions"><span className="btn-solid">Log call</span><span className="btn-line">See history</span></p>
          </div>
          <div className="cl-row cl-other"><Initials tone="violet">HF</Initials><div><p className="cl-name">Harbor Family Fund</p><p className="cl-sub">$50,000 proposal<span className="dot">·</span>follow-up due Apr 6</p></div><span className="tag violet">Major gift</span></div>
          <div className="cl-row cl-other"><Initials tone="green">RC</Initials><div><p className="cl-name">Ruth Chen</p><p className="cl-sub">First gift $250<span className="dot">·</span>welcome call</p></div><span className="tag green">New donor</span></div>
          <p className="cl-foot"><Check /><span>Apr 3<span className="dot">·</span>Ana called Tom<span className="dot">·</span>renewed $500</span></p>
        </div>
      </Drawing>
    </div>
  </section>
}
