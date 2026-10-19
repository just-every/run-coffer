import { maria, org } from '../data'
import { Chip, Chrome, Drawing, StepCopy, type Tone } from '../parts'

// The 1,132 asked: 744 + 102 + 178 + 96 + 12. Emails 744 + 178 = 922; letters 102 + 12 = 114; calls 96.
const SEGMENTS: { icon: string; tone: Tone; who: string; count: string; route: string; routeTone: Tone }[] = [
  { icon: 'mail', tone: 'green', who: 'Gave last spring · email', count: '744', route: 'Email', routeTone: 'violet' },
  { icon: 'doc', tone: 'violet', who: 'Gave last spring · paper only', count: '102', route: 'Letter', routeTone: 'violet' },
  { icon: 'people', tone: 'coral', who: 'Monthly donors', count: '178', route: 'Email · extra-gift ask', routeTone: 'green' },
  { icon: 'phone', tone: 'amber', who: 'Lapsed 12–24 months', count: '96', route: 'Call list', routeTone: 'amber' },
  { icon: 'star', tone: 'violet', who: 'Major-gift prospects', count: '12', route: 'Personal letter · Ana R.', routeTone: 'violet' },
  { icon: 'ban', tone: 'grey', who: 'Unsubscribed or no mail', count: '38', route: 'Excluded', routeTone: 'grey' },
]

/** Mar 3, choosing who to ask: the spring appeal's audience from giving history and consent, each segment routed. */
export function Choose() {
  return <section id="choose" className="story choose" aria-labelledby="choose-title">
    <div className="site-wrap story-row">
      <StepCopy id="choose" when="Mar 3 · Choose who to ask" lead="Ask each donor" tint="the right way." h={94.3} wl={628}>
        Coffer builds the audience from giving history and consent, then routes each donor to an email, a letter or a call.
      </StepCopy>
      <Drawing className="audience-art" label="Spring appeal audience, 1,132 donors and 38 excluded: 744 who gave last spring by email get an email; 102 paper-only donors get a letter; 178 monthly donors get an email with an extra-gift ask; 96 lapsed 12 to 24 months go to the call list; 12 major-gift prospects get a personal letter from Ana R.; 38 unsubscribed or no-mail donors are excluded.">
        <div className="card audience">
          <div className="aud-head"><p className="aud-title">Spring appeal<span className="dot">·</span>audience</p><p className="aud-total"><b>1,132 donors</b><span>38 excluded</span></p></div>
          <ul className="aud-rows">{SEGMENTS.map(s => <li key={s.who} className={s.tone === 'grey' ? 'off' : undefined}>
            <Chip icon={s.icon} tone={s.tone} fill={s.icon !== 'mail'} />
            <span className="aud-who">{s.who}<span className="dot">·</span><b>{s.count}</b></span>
            <span className={`tag ${s.routeTone}`}>{s.route}</span>
          </li>)}</ul>
        </div>
      </Drawing>
    </div>
  </section>
}

/** Mar 10, 7:00 PM, sending: Mrs. Hale's paper letter with its reply card, Maria's email, and the send totals. */
export function Send() {
  return <section id="send" className="story send flip" aria-labelledby="send-title">
    <div className="site-wrap story-row">
      <StepCopy id="send" when="Mar 10, 7:00 PM · Send it" lead="The letter" tint="goes out." h={93.2} wl={391}>
        Appeal emails through Mango or Mailchimp, and print-ready letters for everyone who prefers paper.
      </StepCopy>
      <Drawing className="send-art" label={`The appeal goes out on Mar 10 at 7:00 PM. A printed letter from ${org.name} to Mrs. Hale: "Your $50 last spring stocked 30 meals. This spring, help us fill the new cold-storage room," with a reply card for $50, $100 or $250. ${maria.name}'s email, "Maria, 180 meals last year," with a Give to the spring appeal button. 922 emails sent, 114 letters ready to print, 96 to call.`}>
        <div className="paper letter">
          <p className="letter-from"><b>{org.name}</b>{org.street}<span className="dot">·</span>{org.town}</p>
          <p className="letter-dear">Dear Mrs. Hale,</p>
          <p>Your $50 last spring stocked 30 meals.</p>
          <p>This spring, help us fill the new <span className="nowrap">cold-storage room.</span></p>
          <p className="letter-sign">With thanks, Ana R.</p>
          <div className="reply-card"><p>Yes, I'll give:</p><p className="reply-boxes"><span>$50</span><span>$100</span><span>$250</span></p></div>
        </div>
        <div className="card mail">
          <Chrome />
          <div className="mail-body">
            <p className="mail-from">From {org.name}</p>
            <p className="mail-subject">Maria, 180 meals last year</p>
            <p className="mail-text">Dear Maria, last year your gifts stocked 180 meals. This spring we're filling the new cold-storage room.</p>
            <p className="mail-button">Give to the spring appeal</p>
          </div>
        </div>
        <p className="card send-strip"><span><b>922</b> emails sent</span><span><b>114</b> letters ready to print</span><span><b>96</b> to call</span></p>
      </Drawing>
    </div>
  </section>
}
