import { SiteHeader } from '../shell/SiteHeader'
import { Hero } from './Hero'
import { DevelopmentAgent, MoveIn } from './sections/Agent'
import { Closing } from './sections/Closing'
import { Details } from './sections/Details'
import { Donors, Giving } from './sections/Giving'
import { Interlude } from './sections/Interlude'
import { Ownership } from './sections/Ownership'
import { Payments, Receipts } from './sections/Payments'
import { Appeals, MajorGifts } from './sections/Stewardship'
import '../styles/site.css'
import '../styles/landing.css'
import '../styles/cards.css'

/**
 * run-coffer.com's homepage, built from the design desk's approved page (16 Oct 2026) in its order:
 * hero; online giving and donors; payments and receipts; the interlude; appeals and major gifts;
 * the development agent and moving in; ownership; the quiet details; the closing with the footer.
 * Painted art appears only in the hero, the interlude and the closing; every other drawing is HTML and CSS.
 */
export function Landing() {
  return <>
    <SiteHeader overArt />
    <main id="main">
      <Hero />
      <div className="pair"><Giving /><Donors /></div>
      <div className="pair"><Payments /><Receipts /></div>
      <Interlude />
      <div className="pair"><Appeals /><MajorGifts /></div>
      <div className="pair"><DevelopmentAgent /><MoveIn /></div>
      <Ownership />
      <Details />
      <Closing />
    </main>
  </>
}
