import { Feature, Icon, Initials, type Tone } from '../parts'

/** Appeals and stewardship: the new-donor welcome journey, two steps sent, a call assigned, a visit scheduled. */
export function Appeals() {
  const steps: [string, string, string, Tone, string, string][] = [
    ['mail', 'Day 0', 'Thank-you email', 'green', 'Sent', 'green'],
    ['doc', 'Day 3', 'Where your gift went', 'violet', 'Sent', 'green'],
    ['phone', 'Day 30', 'Call from a board member', 'amber', 'Task · Ana R.', 'amber'],
    ['calendar', 'Day 90', 'Invite to a site visit', 'violet', 'Scheduled Jul 9', 'violet'],
  ]
  return <Feature id="appeals" eyebrow="Appeals & stewardship" lead="Thank-yous that" tint="actually send." label="The new donor welcome journey: day 0 thank-you email and day 3 update sent, a day 30 board call assigned to Ana R., a day 90 site visit scheduled for Jul 9; sent through Mailchimp, 2 unsubscribes honored, 1 reply sent to Ana."
    art={<div className="card journey">
      <p className="card-title">New donor welcome</p>
      <ol className="journey-steps">{steps.map(([icon, day, what, tone, state, stateTone]) => <li key={day}><span className={`journey-dot ${tone}`}><Icon name={icon} /></span><span className="journey-what"><b>{day}</b><span className="dot">·</span>{what}</span><span className={`pill ${stateTone}`}>{state}</span></li>)}</ol>
      <p className="journey-foot">via Mailchimp<span className="dot">·</span>2 unsubscribes honored<span className="dot">·</span>1 reply sent to Ana</p>
    </div>}>
    Appeals and welcome journeys go out through Mango or Mailchimp. Unsubscribes are honored everywhere, and replies land with the right person.
  </Feature>
}

/** Major gifts: three prospects in the FY2026 pipeline with their stage, ask, next step and engagement score. */
export function MajorGifts() {
  const rows: [string, Tone, string, string, string, string, string, Tone][] = [
    ['LP', 'green', 'Linda Park', 'Cultivate', '$25,000', 'Lunch May 6', '82', 'green'],
    ['HF', 'violet', 'Harbor Family Fund', 'Ask', '$50,000', 'Proposal sent Apr 9', '91', 'violet'],
    ['SR', 'amber', 'Dr. Sam Reyes', 'Steward', '$10,000', '', '74', 'amber'],
  ]
  const stage: Record<string, string> = { Cultivate: 'green', Ask: 'coral', Steward: 'violet' }
  return <Feature id="major-gifts" flip eyebrow="Major gifts" lead="Know where" tint="every ask stands." label="Major gifts FY2026: Linda Park in cultivation for $25,000 with lunch May 6, score 82; Harbor Family Fund asked for $50,000 with the proposal sent Apr 9, score 91; Dr. Sam Reyes in stewardship after $10,000 received, score 74."
    art={<div className="card pipeline">
      <p className="card-title">Major gifts · FY2026</p>
      <p className="pipe-stages">Identify<span className="dot">·</span>Cultivate<span className="dot">·</span>Ask<span className="dot">·</span>Steward</p>
      <ul className="pipe-rows">{rows.map(([ini, tone, name, st, ask, next, score, scoreTone]) => <li key={name}><Initials tone={tone}>{ini}</Initials><span className="pipe-name">{name}</span><span className={`pill ${stage[st]}`}>{st}</span><span className="pipe-ask"><strong>{ask}</strong>{next ? <small>{next}</small> : <> received</>}</span><span className={`pipe-score ${scoreTone}`}>{score}</span></li>)}</ul>
    </div>}>
    A major-gift pipeline with next steps, owners and engagement scores, so no big conversation goes quiet.
  </Feature>
}
