import type { CSSProperties } from 'react'
import { org, stops } from '../data'
import { Painting } from '../parts'

/** The spine under the hero: the spring appeal's seven dates as a calendar, each stop a link to its step, over a
 * low strip of the town's rooftops. */
export function Appeal() {
  return <section id="appeal" className="appeal" aria-labelledby="appeal-title">
    <div className="site-wrap appeal-head">
      <p className="eyebrow"><span className="eyebrow-dot" aria-hidden="true" />The spring appeal</p>
      <h2 id="appeal-title">One appeal, <span className="tint">seven dates.</span></h2>
      <p className="appeal-sub">Follow {org.name}'s spring appeal through Coffer, from moving in to year-end receipts.</p>
    </div>
    <nav className="calendar" aria-label="The spring appeal, date by date">
      <ol>{stops.map((stop, i) => <li key={stop.href} className={stop.kind} style={{ '--i': i } as CSSProperties}>
        <a href={stop.href}>
          <span className="cal-dot" aria-hidden="true" />
          <span className="cal-date">{stop.date}</span>
          <span className="cal-what">{stop.what}</span>
          {stop.ticks ? <span className="cal-ticks"><span className="cal-pips" aria-hidden="true"><i /><i /><i /></span>{stop.ticks}</span> : null}
        </a>
      </li>)}</ol>
    </nav>
    <Painting className="rooftops" name="rooftops" widths={[768, 1152, 1536, 2304, 3072]} sizes="100vw" />
  </section>
}
