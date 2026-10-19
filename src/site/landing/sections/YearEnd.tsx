import { links } from '../../shell/links'
import { maria, org } from '../data'
import { Check, Drawing, Icon, StepCopy } from '../parts'

/** Jan 8, year-end: one statement per donor for the year's gifts, emailed or printed, bounces moved to the print
 * batch; then what Coffer leaves to other tools (CONTRACT.md, Honest boundaries). */
export function YearEnd() {
  return <section id="year-end" className="story year-end" aria-labelledby="year-end-title">
    <div className="site-wrap story-row">
      <StepCopy id="year-end" when="Jan 8 · Year-end" lead="Year-end receipts," tint="done by lunch." h={86.8} wl={684}>
        Each donor gets one statement of the year's gifts, by email or on paper.
      </StepCopy>
      <Drawing className="year-art" label={`${org.name}'s 2026 year-end giving statement for ${maria.name}: 13 gifts, $400.00, being 12 monthly gifts of $300.00 and the spring appeal gift of $100.00; no goods or services were provided in exchange for these gifts. 1,486 statements emailed, 1,452 delivered, 34 bounced; a print batch of 136 letters, 102 by mail and 34 bounced.`}>
        <div className="statement-stack">
          <span className="sheet back-2" /><span className="sheet back-1" />
          <div className="sheet statement">
            <p className="st-org">{org.name}<span className="dot">·</span>2026</p>
            <p className="st-title">Year-end giving statement</p>
            <ul className="st-lines"><li>{maria.name}<span className="dot">·</span>13 gifts<span className="dot">·</span>$400.00</li><li>12 monthly gifts<span className="dot">·</span>$300.00</li><li>Spring appeal<span className="dot">·</span>$100.00</li></ul>
            <p className="st-irs">No goods or services were provided in exchange for these gifts.</p>
          </div>
        </div>
        <div className="card delivery">
          <p className="dl-row"><b>1,486 emailed</b><Check /></p>
          <p className="dl-row"><b>1,452 delivered</b><Check /></p>
          <p className="dl-bounced"><b>34 bounced</b></p>
          <p className="dl-print"><Check /><span><b>Print batch<span className="dot">·</span>136 letters</b> (102 by mail, 34 bounced)</span></p>
        </div>
      </Drawing>
    </div>
    <div className="site-wrap">
      <aside className="limits" aria-label="What Coffer doesn't do">
        <span className="limits-mark"><Icon name="moon" /></span>
        <p><b>What Coffer doesn't do.</b> No auction bidding, volunteer shift scheduling, wealth screening or receipts <span className="nowrap">outside the US.</span></p>
        <a href={links.docs}>Read the docs<span aria-hidden="true">{' '}→</span></a>
      </aside>
    </div>
  </section>
}
