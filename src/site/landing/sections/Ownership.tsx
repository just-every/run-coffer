import { links } from '../../shell/links'
import { Icon } from '../parts'

const COMMANDS = ['git clone https://github.com/just-every/run-coffer.git coffer', 'cd coffer', 'rer install', 'rer setup', 'rer dev']

/** Ownership: run it on your own computer, keep the database, export any time; the terminal holds the five commands. */
export function Ownership() {
  return <section className="ownership" aria-labelledby="ownership-title">
    <div className="site-wrap own-row">
      <div className="own-copy">
        <p className="eyebrow violet">Ownership</p>
        <h2 id="ownership-title"><span className="lead">Yours,<br />start to</span> <span className="tint">finish.</span></h2>
        <p className="feature-body"><a href={links.run}>Run Coffer</a> on your own computer and keep every donor record. Export everything, any time.</p>
        <ul className="own-list">
          <li><Icon name="laptop" />Your own computer</li>
          <li><Icon name="database" />Your donors, your database</li>
          <li><Icon name="export" />Export any time</li>
        </ul>
      </div>
      <figure className="terminal" aria-label="Start Coffer from the source">
        <p className="terminal-bar" aria-hidden="true"><span /><span /><span /></p>
        <pre><code>{COMMANDS.map(line => <span key={line} className="terminal-line"><span className="prompt" aria-hidden="true">$ </span>{line}{'\n'}</span>)}</code></pre>
      </figure>
    </div>
  </section>
}
