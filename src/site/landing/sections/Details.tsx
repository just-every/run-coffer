import { Icon, type Tone } from '../parts'

const DETAILS: [string, Tone, string, string][] = [
  ['people', 'violet', 'Soft credits', 'Credit the spouse, the board member or the employer.'],
  ['heart', 'green', 'Tribute gifts', 'In honor or in memory, with a note to the family.'],
  ['gift', 'coral', 'Matching gifts', 'Track each employer match until it arrives.'],
  ['calendar', 'amber', 'Pledges', 'Schedules, reminders and balances kept current.'],
  ['shield', 'violet', 'Consent', 'Email and mail preferences honored everywhere.'],
  ['doc', 'green', 'Gift ledger', 'Every change recorded; no gift is silently edited.'],
]

/** The quiet details: six small things a fundraising team notices, as six white cards. */
export function Details() {
  return <section className="details" aria-labelledby="details-title">
    <div className="site-wrap">
      <p className="eyebrow">Also included</p>
      <h2 id="details-title">The quiet <span className="tint">details.</span></h2>
      <ul className="details-grid">{DETAILS.map(([icon, tone, title, body]) => <li key={title} className="card detail"><span className={`chip-icon big ${tone}`}><Icon name={icon} /></span><h3>{title}</h3><p>{body}</p></li>)}</ul>
    </div>
  </section>
}
