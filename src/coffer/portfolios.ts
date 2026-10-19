import { all, commit, date, daysBetween, event, fail, guard, id, integer, newId, optional, sql, text, today, type Context, type Row } from './db'
import { settings } from './settings'

const liveDonor = (donorId: string) => guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE id=? AND erased_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`, 'DONOR_CHANGED', 'Choose a current donor.', donorId)
const activeManager = (managerId: string) => guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))", 'OWNER_CHANGED', 'Choose an active staff relationship manager.', managerId)

export async function portfolioCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command === 'portfolio.save') {
  const existing = optional(p.portfolioId, 'Portfolio'), portfolioId = existing ?? newId()
  const version = existing ? integer(p.version, 'Portfolio version', 1) : 0
  const name = text(p.name, 'Portfolio name'), managerId = id(p.managerId, 'Relationship manager')
  const untouchedDays = integer(p.untouchedDays, 'Untouched after days', 1, 3650)
  await commit(c, [activeManager(managerId), ...(existing ? [
   guard('EXISTS(SELECT 1 FROM cf_portfolios WHERE id=? AND version=?)', 'VERSION', 'This portfolio changed. Refresh before saving.', portfolioId, version),
   sql('UPDATE cf_portfolios SET name=?,manager_id=?,untouched_days=?,version=version+1,updated_at=? WHERE id=?', name, managerId, untouchedDays, c.now, portfolioId),
  ] : [sql('INSERT INTO cf_portfolios VALUES(?,?,?,?,1,?,?)', portfolioId, name, managerId, untouchedDays, c.now, c.now)]),
  event(c, command, 'portfolio', portfolioId, null, { managerId, untouchedDays, version: version + 1 }),
  ])
  return { id: portfolioId, version: version + 1 }
 }
 if (command === 'portfolio.assign') {
  const donorId = id(p.donorId, 'Donor'), portfolioId = id(p.portfolioId, 'Portfolio')
  const previous = optional(p.previousPortfolioId, 'Previous portfolio')
  const day = today((await settings(c)).timezone, new Date(c.now))
  await commit(c, [liveDonor(donorId),
   guard(`EXISTS(SELECT 1 FROM cf_portfolios p JOIN oa_operators o ON o.id=p.manager_id WHERE p.id=? AND o.status='active' AND o.role IN ('owner','admin','member'))`, 'OWNER_CHANGED', 'Choose a portfolio with an active relationship manager.', portfolioId),
   guard("COALESCE((SELECT portfolio_id FROM cf_portfolio_members WHERE donor_id=?),'')=?", 'VERSION', 'This donor’s portfolio changed. Refresh before assigning.', donorId, previous ?? ''),
   sql(`INSERT INTO cf_portfolio_members VALUES(?,?,?) ON CONFLICT(donor_id) DO UPDATE SET portfolio_id=excluded.portfolio_id,assigned_on=CASE WHEN portfolio_id=excluded.portfolio_id THEN assigned_on ELSE excluded.assigned_on END`, donorId, portfolioId, day),
   event(c, command, 'portfolio', portfolioId, donorId, { previousPortfolioId: previous }),
  ])
  return { donorId, portfolioId }
 }
 return undefined
}

export async function portfolioReport(c: Context, url: URL) {
 const s = await settings(c), asOf = today(s.timezone, new Date(c.now))
 const from = date(url.searchParams.get('from') ?? asOf.slice(0, 4) + '-01-01', 'From date')
 const through = date(url.searchParams.get('through') ?? asOf, 'Through date')
 if (from > through || through > asOf) fail('INPUT', 'Choose an inclusive period ending on or before today.', 400)
 const selected = optional(url.searchParams.get('managerId'), 'Manager')
 const [portfolios, members] = await Promise.all([
  all(c, `SELECT p.*,COALESCE(o.display_name,'Reassignment needed') AS manager_name,o.status AS manager_status
   FROM cf_portfolios p LEFT JOIN oa_operators o ON o.id=p.manager_id WHERE (? IS NULL OR p.manager_id=?) ORDER BY lower(p.name),p.id`, selected, selected),
  all(c, `SELECT m.*,d.name,p.manager_id,p.untouched_days,
   (SELECT MAX(i.occurred_on) FROM cf_interactions i WHERE i.donor_id=d.id AND i.meaningful=1 AND i.occurred_on<=?) AS last_contact_on,
   (SELECT COUNT(*) FROM cf_interactions i WHERE i.donor_id=d.id AND i.meaningful=1 AND i.recorded_by_id=p.manager_id AND i.occurred_on>=? AND i.occurred_on<=?) AS moves,
   (SELECT COUNT(*) FROM cf_interactions i WHERE i.donor_id=d.id AND i.meaningful=1 AND i.recorded_by_id IS NULL AND i.occurred_on>=? AND i.occurred_on<=?) AS unattributed_contacts,
   (SELECT COALESCE(SUM(g.amount_cents),0) FROM cf_contribution_ledger g WHERE g.donor_id=d.id AND g.received_on>=? AND g.received_on<=?) AS raised_cents,
   (SELECT COALESCE(SUM(o.ask_amount_cents),0) FROM cf_prospects o WHERE o.donor_id=d.id AND o.closed_on IS NULL) AS pipeline_cents
   FROM cf_portfolio_members m JOIN cf_portfolios p ON p.id=m.portfolio_id JOIN cf_donors d ON d.id=m.donor_id
   WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges x WHERE x.donor_id=d.id)
   AND (? IS NULL OR p.manager_id=?) ORDER BY lower(d.name),d.id`, through, from, through, from, through, from, through, selected, selected),
 ])
 const rows: Row[] = members.map(m => {
  const basis = m.last_contact_on ?? m.assigned_on
  const days = Math.max(0, daysBetween(basis, through))
  return { ...m, days_without_contact: days, untouched: days >= m.untouched_days, contact_basis: m.last_contact_on ? 'last meaningful contact' : 'portfolio assignment' }
 })
 const total = (list: Row[]) => ({ size: list.length, moves: list.reduce((n, r) => n + r.moves, 0), pipelineCents: list.reduce((n, r) => n + r.pipeline_cents, 0), raisedCents: list.reduce((n, r) => n + r.raised_cents, 0), untouched: list.filter(r => r.untouched).length, unattributedContacts: list.reduce((n,r)=>n+r.unattributed_contacts,0) })
 const groups = portfolios.map((p): Row & { rows: Row[] } => ({ ...p, rows: rows.filter(r => r.portfolio_id === p.id), ...total(rows.filter(r => r.portfolio_id === p.id)) }))
 const managerIds = [...new Set(portfolios.map(p => p.manager_id))]
 return { from, through, asOf, timezone: s.timezone, portfolios: groups, managers: managerIds.map(managerId => ({ managerId, name: portfolios.find(p => p.manager_id === managerId)!.manager_name, ...total(rows.filter(r => r.manager_id === managerId)) })), ...total(rows) }
}
