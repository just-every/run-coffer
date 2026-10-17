import { Check, Painting } from '../parts'

/** The one painted band between the stories: a thank-you card on the windowsill, tonight's thank-yous sent. */
export function Interlude() {
  return <section className="interlude" aria-label="Thank-yous sent to 48 donors tonight">
    <p className="interlude-badge"><Check />Thank-yous sent · 48 donors tonight</p>
    <Painting className="interlude-art" name="interlude" widths={[768, 1152, 1536]} sizes="100vw" phone={{ name: 'interlude-phone', widths: [640, 875], media: '(max-width: 760px)' }} />
  </section>
}
