import { SiteHeader } from '../shell/SiteHeader'
import { Hero } from './Hero'
import { Appeal } from './sections/Appeal'
import { Choose, Send } from './sections/Audience'
import { BoardReport } from './sections/BoardReport'
import { Calls } from './sections/Calls'
import { Closing } from './sections/Closing'
import { FirstNight, Reconcile } from './sections/FirstNight'
import { Gives, ThankYou } from './sections/Gives'
import { Interlude } from './sections/Interlude'
import { MoveIn } from './sections/MoveIn'
import { YearEnd } from './sections/YearEnd'
import '../styles/site.css'
import '../styles/landing.css'
import '../styles/cards.css'
import '../styles/story.css'
import '../styles/sections/appeal.css'
import '../styles/sections/move-in.css'
import '../styles/sections/audience.css'
import '../styles/sections/gives.css'
import '../styles/sections/first-night.css'
import '../styles/sections/calls.css'
import '../styles/sections/report.css'
import '../styles/sections/year-end.css'

/**
 * run-coffer.com's homepage, built from the owner-approved page structure (page-s1, 17 Oct 2026): the hero, then one
 * spring appeal at Wrenfield Food Bank told as dated steps (move in, choose who, send, Maria gives, the thank-you,
 * the interlude, the first night, reconcile, make calls, the board report, year-end), then the closing and footer.
 * Painted art appears in the hero, the rooftop strip, the interlude, the report's van and the closing; every other
 * drawing is HTML and CSS.
 */
export function Landing() {
  return <>
    <SiteHeader overArt />
    <main id="main">
      <Hero />
      <Appeal />
      <MoveIn />
      <div className="chapter"><Choose /><Send /></div>
      <div className="chapter"><Gives /><ThankYou /></div>
      <Interlude />
      <div className="chapter"><FirstNight /><Reconcile /></div>
      <Calls />
      <BoardReport />
      <YearEnd />
      <Closing />
    </main>
  </>
}
