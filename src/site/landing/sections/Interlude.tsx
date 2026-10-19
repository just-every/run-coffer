import { Painting } from '../parts'

/** The painted band between the first night's steps: the "Dear Maria," card on a lamplit windowsill. */
export function Interlude() {
  return <section className="interlude" aria-label="A thank-you card to Maria on a lamplit windowsill">
    <Painting className="interlude-art" name="interlude" widths={[768, 1152, 1536, 2304, 3072]} sizes="100vw" phone={{ name: 'interlude-phone', widths: [640, 875], media: '(max-width: 760px)' }} />
  </section>
}
