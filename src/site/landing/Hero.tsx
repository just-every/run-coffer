import { Actions } from '../shell/Actions'
import { HeroCards } from './HeroCards'
import { Painting } from './parts'

/** The riverside town lighting up as gifts arrive: the promise and the actions on the left, tonight's gifts on the right. */
export function Hero() {
  return <section className="hero" aria-labelledby="hero-title">
    <Painting className="hero-art" name="hero" widths={[768, 1152, 1536]} sizes="100vw" eager phone={{ name: 'hero-phone', widths: [640, 1024], media: '(max-width: 760px)' }} />
    <div className="site-wrap hero-grid">
      <div className="hero-copy">
        <h1 id="hero-title">Every gift, <span className="tint">thanked.</span></h1>
        <p className="hero-sub">Coffer takes donations, keeps every donor's story, sends the receipts and thank-yous, and shows who needs a call.</p>
        <p className="hero-alt">100% free, open source alternative to <br /><strong>Bloomerang</strong>, <strong>Little Green Light</strong> and <strong>Neon CRM</strong></p>
        <Actions className="hero-actions" />
      </div>
      <HeroCards />
    </div>
  </section>
}
