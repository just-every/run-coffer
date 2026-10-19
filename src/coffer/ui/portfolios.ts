import { all, type Context, type Row } from '../db'
import { portfolioReport } from '../portfolios'
import { box, chip, e, empty, field, form, longDay, money, select } from './common'

const staffOptions = (staff: Row[]): [string,string][] => staff.map(o => [o.id,o.display_name])
function portfolioFields(staff: Row[], p: Row = {}) {
 return `${field('Portfolio name','name','text',p.name ?? '', 'required maxlength="200"')}
 <div class="fields">${select('Relationship manager','managerId', [['','Choose a team member'],...staffOptions(staff)],p.manager_id ?? '', 'required')}
 ${field('Flag untouched after (days)','untouchedDays','number',p.untouched_days ?? 90,'required min="1" max="3650"')}</div>`
}

export async function portfoliosPage(c: Context, url: URL) {
 const [report,staff,donors] = await Promise.all([
  portfolioReport(c,url),
  all(c,"SELECT id,display_name FROM oa_operators WHERE status='active' AND role IN ('owner','admin','member') ORDER BY lower(display_name),id"),
  all(c,`SELECT d.id,d.name,m.portfolio_id FROM cf_donors d LEFT JOIN cf_portfolio_members m ON m.donor_id=d.id
   WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges x WHERE x.donor_id=d.id) ORDER BY lower(d.name),d.id`),
 ])
 const portfolios = await all(c,`SELECT p.* FROM cf_portfolios p JOIN oa_operators o ON o.id=p.manager_id
  WHERE o.status='active' AND o.role IN ('owner','admin','member') ORDER BY lower(p.name),p.id`)
 const portfolioOptions: [string,string][] = portfolios.map(p=>[p.id,p.name])
 const selected = url.searchParams.get('managerId') ?? ''
 const filters = `<form method="get" action="/app/portfolios"><div class="fields">${field('From date','from','date',report.from,'required')}${field('Through date','through','date',report.through,`required max="${e(report.asOf)}"`)}${select('Report manager','managerId',[['','All managers'],...staffOptions(staff)],selected)}</div><button>Read portfolio report</button></form>`
 const managers = report.managers.length ? `<ul class="list">${report.managers.map(m=>`<li><strong>${e(m.name)}</strong><p>${m.size} prospects · ${m.moves} moves · ${e(money(m.pipelineCents))} current pipeline · ${e(money(m.raisedCents))} raised · ${m.untouched} untouched</p></li>`).join('')}</ul>` : empty('No portfolios yet. Create one below, then assign prospects.')
 const groups = report.portfolios.map(p=>box(p.name,`
  <p>Relationship manager: <strong>${e(p.manager_name)}</strong> ${p.manager_status !== 'active' ? chip('Reassign manager','warn') : ''} · flag after ${p.untouched_days} days</p>
  <p>${p.size} prospects · ${p.moves} moves · ${e(money(p.pipelineCents))} current pipeline · ${e(money(p.raisedCents))} raised</p>
  ${p.unattributedContacts ? `<p class="notice">${p.unattributedContacts} older contacts have no recorded staff ID and are excluded from manager moves.</p>` : ''}
  ${p.rows.length ? `<ul class="list">${p.rows.map(r=>`<li><a href="/app/donors/${e(r.donor_id)}"><strong>${e(r.name)}</strong></a> ${r.untouched ? chip('Untouched','warn') : chip('In touch','ok')}
   <p>${r.moves} manager moves · ${e(money(r.pipeline_cents))} current asks · ${e(money(r.raised_cents))} raised<br>
   ${r.last_contact_on ? `Last meaningful contact ${e(longDay(r.last_contact_on))}` : `No meaningful contact; assigned ${e(longDay(r.assigned_on))}`} · ${r.days_without_contact} days</p>
   <details><summary>Change portfolio</summary>${form('portfolio.assign',select('Move to portfolio','portfolioId',portfolioOptions,r.portfolio_id,'required'),'Assign portfolio',{donorId:r.donor_id,previousPortfolioId:r.portfolio_id})}</details></li>`).join('')}</ul>` : empty('No prospects in this portfolio.')}
  <details><summary>Edit portfolio</summary>${form('portfolio.save',portfolioFields(staff,p),'Save portfolio',{portfolioId:p.id,version:p.version})}</details>`)).join('')
 const unassigned = donors.filter(d=>!d.portfolio_id)
 return `<p><a href="/app/pipeline">Back to the major-gift pipeline</a></p>
 ${box('Moves and dollars by relationship manager',`${filters}${managers}<details><summary>How this report counts</summary>
 <p>The date bounds include both days in ${e(report.timezone)}. Portfolios and managers are the current assignments. Raised is signed ledger contributions dated in the period, including refunds and reversals; soft credits and asks are separate. Current pipeline sums the opportunity asks for each assigned donor, regardless of opportunity owner.</p>
 <p>A move is a recorded call, meeting or email by the relationship manager. A completed call task counts only when connected; unanswered calls, voicemail and wrong numbers do not count. Untouched means at least the portfolio’s chosen days since any staff member’s last meaningful contact through the end date, or since assignment if there is no contact. The first opportunity creates a named portfolio for its owner if the donor is not assigned yet; changing an opportunity owner does not move the donor’s portfolio.</p></details>`)}
 ${groups}<div class="grid"><div>${box('Create a portfolio',form('portfolio.save',portfolioFields(staff),'Create portfolio'))}</div>
 <div>${box('Assign another prospect', unassigned.length && portfolioOptions.length ? form('portfolio.assign',`${select('Unassigned donor','donorId',[['','Choose a donor'],...unassigned.map(d=>[d.id,d.name] as [string,string])],'','required')}${select('Portfolio','portfolioId',portfolioOptions,'','required')}`,'Assign prospect') : empty(unassigned.length ? 'Create a portfolio with an active manager first.' : 'Every donor already has a portfolio.'))}</div></div>`
}
