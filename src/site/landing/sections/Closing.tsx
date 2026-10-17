import { Actions } from '../../shell/Actions'
import { SiteFooter } from '../../shell/SiteFooter'
import { Painting } from '../parts'

/** The closing promise over the food bank at dusk, the spring appeal's board out front, and the footer. */
export function Closing() {
  return <section className="closing" aria-labelledby="closing-title">
    <div className="site-wrap closing-copy">
      <h2 id="closing-title">Every donor, <span className="tint">remembered.</span></h2>
      <p className="closing-sub">Open source donor management for every nonprofit.</p>
      <Actions demo={false} className="closing-actions" />
      <p className="closing-small">Free and open source, MIT licensed.</p>
    </div>
    <Painting className="closing-art" name="closing" widths={[768, 1152, 1536]} sizes="100vw" phone={{ name: 'closing-phone', widths: [640, 821], media: '(max-width: 760px)' }} />
    <SiteFooter />
  </section>
}
