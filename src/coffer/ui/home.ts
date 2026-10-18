import { manager } from '../auth'
import { one, today, type Context } from '../db'
import { dueGifts } from '../acknowledgements'
import { box, chip, e, longDay, money } from './common'

export async function home(c: Context) {
 const due = await dueGifts(c), s = due.settings, year = due.today.slice(0, 4)
 const [counts, waiting] = await Promise.all([
  one(c, `SELECT (SELECT count(*) FROM cf_donors WHERE erased_at IS NULL) AS donors,
   (SELECT COALESCE(SUM(amount_cents),0) FROM cf_contribution_ledger WHERE received_on>=?) AS year_cents,
   (SELECT count(*) FROM cf_gifts WHERE kind='gift' AND received_on>=?) AS year_gifts,
   (SELECT count(*) FROM cf_consents) AS consents,
   (SELECT count(*) FROM cf_ack_batches b WHERE b.status='sent' OR EXISTS(SELECT 1 FROM cf_acks a WHERE a.batch_id=b.id AND (a.submitted_at IS NOT NULL OR a.printed_at IS NOT NULL))) AS sent`, `${year}-01-01`, `${year}-01-01`),
  one(c, `SELECT (SELECT count(*) FROM cf_ack_batches WHERE status IN ('prepared','approved','exported')) AS letters,
   (SELECT count(*) FROM cf_appeals WHERE status IN ('prepared','approved','exported')) AS appeals`),
 ])
 const overdue = due.gifts.filter(g => g.overdue), unknown = due.gifts.filter(g => g.goods === 'unknown')
 const steps: [boolean, string, string][] = [
  [!!s.reviewed_at, 'Review your organization name and letter wording', '/app/settings'],
  [counts!.donors > 0, 'Move in a year of Stripe gifts, or add a donor', '/app/move-in'],
  [counts!.consents > 0, 'Record which donors agreed to hear from you', '/app/donors'],
  [counts!.sent > 0, 'Send your first acknowledgement letters', '/app/letters'],
 ]
 const checklist = steps.every(([done]) => done) ? '' : box('Getting started', `<ol class="steps">${steps.map(([done, label, href]) => `<li>${done ? chip('Done', 'ok') : chip('To do', 'warn')} <a href="${href}">${e(label)}</a></li>`).join('')}</ol>`)
 return `<p class="notice"><a href="/app/lapses">Who needs a call?</a> Review lapses and amounts at risk, then <a href="/app/calls">work your owned call list</a>.</p>${checklist}<div class="stats">
  <a class="stat" href="/app/letters"><strong>${due.gifts.length}</strong><span>gifts waiting for a letter</span></a>
  <a class="stat${overdue.length ? ' alarm' : ''}" href="/app/letters"><strong>${overdue.length}</strong><span>past the ${s.target_days}-day target</span></a>
  <a class="stat" href="/app/donors"><strong>${counts!.donors}</strong><span>donors</span></a>
  <div class="stat"><strong>${money(counts!.year_cents)}</strong><span>given in ${year} (${counts!.year_gifts} gifts)</span></div>
 </div>
 <div class="grid"><div>${box('Letters due', due.gifts.length ? `<p>Gifts of ${money(s.threshold_cents)} or more get a written acknowledgement within ${s.target_days} days.</p><ul class="list">${due.gifts.slice(0, 8).map(g => `<li><a href="/app/donors/${e(g.donor_id)}">${e(g.donor_name)}</a> · ${money(g.amount_cents)} on ${longDay(g.received_on)} ${g.overdue ? chip(`Overdue since ${longDay(g.due_on)}`, 'alarm') : chip(`Due ${longDay(g.due_on)}`)}${g.goods === 'unknown' ? ` ${chip('Needs goods/services answer', 'warn')}` : ''}</li>`).join('')}</ul>${due.gifts.length > 8 ? `<p><a href="/app/letters">All ${due.gifts.length} gifts waiting</a></p>` : ''}${unknown.length ? `<p class="muted">${unknown.length} imported gifts need a person to say whether goods or services were given before a letter can state it.</p>` : ''}` : `<p class="empty">No gifts are waiting for a letter.</p>`)}</div>
 <div>${box('Waiting on a person', `<ul class="list"><li><a href="/app/letters">${waiting!.letters} letter batches</a> are prepared, approved or exported and not yet recorded as sent.</li><li><a href="/app/appeals">${waiting!.appeals} appeals</a> are waiting for approval, export or sending.</li></ul>${manager(c.actor) ? '' : '<p class="muted">An owner or admin approves and exports.</p>'}`)}
 ${box('Today', `<p>${longDay(today(s.timezone))} · ${e(s.timezone)}</p>`)}</div></div>`
}
