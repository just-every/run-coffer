import { org } from '../data'
import { Check, Chip, Drawing, Icon, StepCopy } from '../parts'

const ROWS: [string, string][] = [['Constituents', '4,812'], ['Households', '1,207'], ['Gifts', '38,406 · $3,912,550.00'], ['Pledges', '214'], ['Duplicates merged', '63']]
// The one start line every Run Edit Run page shows, and the alternative for people who already have Node.
const START = 'curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-coffer'
const ALTERNATIVE = 'npx -y @runeditrun/rer dev just-every/run-coffer'
const exportFile = `${org.short.toLowerCase()}-export.zip`

/** A command that wraps only between words, keeping the installer's `install.sh | sh` together. */
function words(line: string) {
  return line.split(/(\S*install\.sh \| sh|\S+)/).map((part, index) => {
    const pipe = /^(.*\/)(install\.sh \| sh)$/.exec(part)
    if (pipe) return <span key={index}><span className="nowrap">{pipe[1]}</span><wbr /><span className="nowrap">{pipe[2]}</span></span>
    return part.trim() ? <span key={index} className="nowrap">{part}</span> : part
  })
}

/** Feb 20, moving in: a Little Green Light export checked row by row, two gifts with no fund fixed, totals matched
 * to the cent; and the one line that installs rer and starts Coffer, with the npx alternative. */
export function MoveIn() {
  return <section id="move-in" className="story move-in" aria-labelledby="move-in-title">
    <div className="site-wrap story-row">
      <StepCopy id="move-in" when="Feb 20 · Move in" lead="Your history" tint="comes with you." h={68.5} wl={486}>
        Import from Little Green Light, Bloomerang or Raiser's Edge NXT. Coffer checks the totals before you switch.
      </StepCopy>
      <Drawing className="import-art" label={`Import from Little Green Light, ${exportFile}: 4,812 constituents, 1,207 households, 38,406 gifts totalling $3,912,550.00, 214 pledges, 63 duplicates merged; 2 gifts had no fund and were assigned to General; gift totals match to the cent.`}>
        <div className="card import">
          <div className="import-head"><Chip icon="sheet" tone="green" /><div><p className="import-title">Import from Little Green Light</p><p className="import-file">{exportFile}</p></div></div>
          <ul className="import-rows">{ROWS.map(([what, count]) => <li key={what}><Check /><span>{what}</span><b>{count}</b></li>)}</ul>
          <div className="import-fix">
            <p className="import-flag"><span className="flag-mark"><Icon name="alert" /></span>2 gifts had no fund</p>
            <p className="import-fixed"><Check /><span>Assigned to General<span className="dot">·</span>fixed</span></p>
            <p className="import-ok"><Check />Gift totals match to the cent</p>
          </div>
        </div>
      </Drawing>
      <figure className="terminal" aria-label={`Install and start Coffer with one line: ${START}. Already have Node 22 or later? ${ALTERNATIVE} does the same.`}>
        <p className="terminal-bar" aria-hidden="true"><span /><span /><span /></p>
        <pre><code>
          <span className="terminal-line"><span className="prompt" aria-hidden="true">$ </span>{words(START)}{'\n'}</span>
          <span className="terminal-line terminal-comment"><span className="prompt" aria-hidden="true"># </span>{words(`Already have Node 22 or later? ${ALTERNATIVE}`)}{'\n'}</span>
        </code></pre>
      </figure>
    </div>
  </section>
}
