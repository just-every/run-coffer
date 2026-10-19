import { requireRole } from './auth'
import { all, choice, commit, date, event, fail, guard, id, integer, longText, newId, one, optional, sql, text, today, type Context, type Row } from './db'
import { amount } from './money'
import { schedule as pledgeSchedule } from './pledges'
import { settings } from './settings'

const staff = (c: Context) => requireRole(c.actor, ['owner', 'admin', 'member'], 'manage grant requests')
const live = (donorId: string) => guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`, 'DONOR_CHANGED', 'Choose a current funder record.', donorId)
const owner = (ownerId: string) => guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))", 'OWNER_CHANGED', 'Choose an active team member for reporting tasks.', ownerId)
const current = (grantId: string, version: number) => guard('EXISTS(SELECT 1 FROM cf_grants WHERE id=? AND version=?)', 'VERSION', 'This grant changed. Refresh before saving.', grantId, version)

export async function grantsState(c: Context, donorId?: string) {
 staff(c)
 const [grants, documents, tasks, installments, funds, owners, funders] = await Promise.all([
  all(c, `SELECT g.*,d.name AS funder_name,p.amount_cents AS awarded_cents,p.fund,p.due_by,f.restriction,f.detail AS restriction_detail,f.release_on
   FROM cf_grants g JOIN cf_donors d ON d.id=g.donor_id LEFT JOIN cf_pledges p ON p.id=g.pledge_id LEFT JOIN cf_funds f ON f.name=p.fund
   WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)
   AND (? IS NULL OR d.id=?) ORDER BY g.updated_at DESC,g.id`, donorId ?? null, donorId ?? null),
  all(c, 'SELECT id,grant_id,title,file_name,media_type,created_at FROM cf_grant_documents ORDER BY created_at,id'),
  all(c, 'SELECT t.*,o.display_name AS owner_name,o.status AS owner_status FROM cf_grant_tasks t LEFT JOIN oa_operators o ON o.id=t.owner_id ORDER BY t.due_on,t.id'),
  all(c, 'SELECT i.*,g.id AS grant_id FROM cf_pledge_balances i JOIN cf_grants g ON g.pledge_id=i.pledge_id ORDER BY i.position'),
  all(c, "SELECT * FROM cf_funds WHERE restriction<>'unrestricted' ORDER BY lower(name),name"),
  all(c, "SELECT id,display_name FROM oa_operators WHERE status='active' AND role IN ('owner','admin','member') ORDER BY lower(display_name),id"),
  all(c, 'SELECT d.id,d.name FROM cf_donors d WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) ORDER BY lower(d.name),d.id'),
 ])
 return { grants: grants.map(g => {
  const payments = installments.filter(i => i.grant_id === g.id)
  const paid = payments.reduce((sum, i) => sum + i.paid_cents, 0)
  return { ...g, documents: documents.filter(d => d.grant_id === g.id), tasks: tasks.filter(t => t.grant_id === g.id),
   installments: payments, paid_cents: paid, remaining_cents: g.awarded_cents === null ? null : g.awarded_cents - paid } as Row
 }), funds, owners, funders }
}

export async function grantCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['grant.save', 'grant.status', 'grant.attach', 'grant.award', 'grant.completeReport', 'grant.assignReport'].includes(command)) return undefined
 staff(c)
 const grantId = optional(p.grantId, 'Grant', 100) ?? newId()
 if (command === 'grant.save') {
  const donorId = id(p.donorId, 'Funder'), program = text(p.program, 'Grant program', 200), cents = amount(p, 'requestedAmount', 'Amount requested')
  const loi = date(p.loiDueOn, 'Letter of inquiry deadline'), proposal = date(p.proposalDueOn, 'Proposal deadline'), report = date(p.reportDueOn, 'Report deadline')
  if (proposal < loi || report < proposal) fail('INPUT', 'Proposal deadline must follow the inquiry deadline, and report deadline must follow the proposal deadline.', 400)
  const version = p.grantId ? integer(Number(p.version), 'Grant version', 1) : 0
  await commit(c, [live(donorId), ...(p.grantId ? [current(grantId, version), guard("EXISTS(SELECT 1 FROM cf_grants WHERE id=? AND donor_id=? AND status='draft')", 'GRANT_FROZEN', 'Only a draft request can be edited. Keep submitted and awarded facts as recorded.', grantId, donorId)] : []),
   sql(`INSERT INTO cf_grants(id,donor_id,program,requested_cents,loi_due_on,proposal_due_on,report_due_on,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET program=excluded.program,requested_cents=excluded.requested_cents,
    loi_due_on=excluded.loi_due_on,proposal_due_on=excluded.proposal_due_on,report_due_on=excluded.report_due_on,version=version+1,updated_at=excluded.updated_at`,
    grantId, donorId, program, cents, loi, proposal, report, c.now, c.now),
   event(c, command, 'grant', grantId, donorId, { requestedCents: cents }),
  ])
  return { id: grantId, version: version + 1 }
 }
 const grant = await one(c, 'SELECT * FROM cf_grants WHERE id=?', grantId)
 if (!grant) fail('NOT_FOUND', 'That grant request does not exist.', 404)
 const version = integer(Number(p.version), 'Grant version', 1), statements = [live(grant.donor_id), current(grantId, version)]
 const day = today((await settings(c)).timezone, new Date(c.now))
 if (command === 'grant.status') {
  const status = choice(p.status, ['loi_submitted', 'proposal_submitted', 'declined', 'withdrawn'] as const, 'recorded grant status')
  const on = date(p.recordedOn, 'Recorded activity date'), evidence = longText(p.evidence, 'Submission or decision evidence', 4000)
  if (on > day || (grant.status_on && on < grant.status_on)) fail('INPUT', 'Activity date must be on or after the previous recorded activity and no later than today.', 400)
  const from = status === 'loi_submitted' ? ['draft'] : status === 'proposal_submitted' ? ['loi_submitted'] : ['draft', 'loi_submitted', 'proposal_submitted']
  if (!from.includes(grant.status)) fail('GRANT_STATUS', 'That status does not follow this request’s recorded progress.')
  statements.push(sql(`UPDATE cf_grants SET status=?,status_on=?,status_evidence=?,loi_submitted_on=CASE WHEN ?='loi_submitted' THEN ? ELSE loi_submitted_on END,
   proposal_submitted_on=CASE WHEN ?='proposal_submitted' THEN ? ELSE proposal_submitted_on END,version=version+1,updated_at=? WHERE id=?`, status, on, evidence, status, on, status, on, c.now, grantId),
   event(c, command, 'grant', grantId, grant.donor_id, { status, recordedOn: on }))
 } else if (command === 'grant.attach') {
  const documentId = newId(), title = text(p.title, 'Document title', 200), fileName = text(p.fileName, 'File name', 150)
  const mediaType = choice(p.mediaType, ['application/pdf', 'text/plain'] as const, 'document type'), encoded = text(p.contentBase64, 'Document content', 350000)
  if (/[\r\n\\/]/.test(fileName)) fail('INPUT', 'Use a simple file name without directory separators.', 400)
  let bytes: string
  try { bytes = atob(encoded) } catch { fail('INPUT', 'The uploaded document is not valid base64.', 400) }
  if (!bytes.length || bytes.length > 256000) fail('INPUT', 'Upload a nonempty document up to 256,000 bytes.', 400)
  if (mediaType === 'application/pdf' && !bytes.startsWith('%PDF-')) fail('INPUT', 'That document does not have a PDF header.', 400)
  statements.push(sql('INSERT INTO cf_grant_documents VALUES(?,?,?,?,?,?,?,?)', documentId, grantId, title, fileName, mediaType, encoded, c.now, c.actor.id),
   sql('UPDATE cf_grants SET version=version+1,updated_at=? WHERE id=?', c.now, grantId),
   event(c, command, 'grantDocument', documentId, grant.donor_id, { grantId }))
  await commit(c, statements)
  return { id: grantId, documentId, version: version + 1 }
 } else if (command === 'grant.award') {
  if (grant.status !== 'proposal_submitted') fail('GRANT_STATUS', 'Record the proposal submission before recording its award.')
  const awardedOn = date(p.awardedOn, 'Awarded on'), fund = text(p.fund, 'Restricted fund', 100), cents = amount(p, 'awardAmount', 'Award amount')
  if (awardedOn > day || awardedOn < grant.status_on) fail('INPUT', 'Award date must be between the last recorded submission and today.', 400)
  const evidence = longText(p.evidence, 'Award evidence', 4000), ownerId = id(p.ownerId, 'Reporting task owner'), pledgeId = newId()
  const installments = pledgeSchedule(p, awardedOn)
  if (installments.reduce((sum, i) => sum + i.cents, 0) !== cents) fail('INPUT', 'Payment installments must add up to the award amount.', 400)
  const rawReports = p.reports ?? [{ title: 'Grant report', dueOn: grant.report_due_on }]
  if (!Array.isArray(rawReports) || !rawReports.length || rawReports.length > 30) fail('INPUT', 'Add 1–30 reporting deadlines.', 400)
  const reports = rawReports.map(r => ({ id: newId(), title: text(r?.title, 'Report title', 200), dueOn: date(r?.dueOn, 'Report due date') }))
  if (reports.some(r => r.dueOn < awardedOn) || !reports.some(r => r.dueOn === grant.report_due_on)) fail('INPUT', 'Reporting dates must be on or after the award, and include the request’s report deadline.', 400)
  if (new Set(reports.map(r => `${r.dueOn}:${r.title}`)).size !== reports.length) fail('INPUT', 'Each reporting deadline and title must be distinct.', 400)
  statements.push(owner(ownerId), guard("EXISTS(SELECT 1 FROM cf_funds WHERE name=? AND restriction IN ('purpose','time'))", 'RESTRICTED_FUND', 'Choose an existing restricted fund. An owner or administrator defines funds.', fund),
   guard("EXISTS(SELECT 1 FROM cf_grants WHERE id=? AND status='proposal_submitted' AND pledge_id IS NULL)", 'GRANT_AWARDED', 'This request already has an award or its status changed.', grantId),
   sql('INSERT INTO cf_pledges(id,donor_id,amount_cents,pledged_on,due_by,fund,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)', pledgeId, grant.donor_id, cents, awardedOn, installments.at(-1)!.dueOn, fund, c.now, c.actor.name),
   ...installments.map((i, index) => sql('INSERT INTO cf_pledge_installments(id,pledge_id,position,due_on,amount_cents,remind_on) VALUES(?,?,?,?,?,?)', i.id, pledgeId, index + 1, i.dueOn, i.cents, i.remindOn)),
   ...reports.map(r => sql('INSERT INTO cf_grant_tasks(id,grant_id,title,due_on,owner_id) VALUES(?,?,?,?,?)', r.id, grantId, r.title, r.dueOn, ownerId)),
   sql("UPDATE cf_grants SET status='awarded',status_on=?,status_evidence=?,awarded_on=?,award_evidence=?,pledge_id=?,version=version+1,updated_at=? WHERE id=?", awardedOn, evidence, awardedOn, evidence, pledgeId, c.now, grantId),
   event(c, command, 'grant', grantId, grant.donor_id, { pledgeId, amountCents: cents, fund, reports: reports.length }),
   event(c, 'pledge.create', 'pledge', pledgeId, grant.donor_id, { grantId, amountCents: cents, installments: installments.length }))
  await commit(c, statements)
  return { id: grantId, version: version + 1, pledgeId, installments, reports }
 } else {
  const taskId = id(p.taskId, 'Report task'), taskVersion = integer(Number(p.taskVersion), 'Report task version', 1)
  statements.push(guard("EXISTS(SELECT 1 FROM cf_grant_tasks WHERE id=? AND grant_id=? AND version=? AND status='open')", 'TASK_CHANGED', 'That report task changed or was completed. Refresh before saving.', taskId, grantId, taskVersion))
  if (command === 'grant.assignReport') {
   const ownerId = id(p.ownerId, 'Reporting task owner')
   statements.push(owner(ownerId), sql('UPDATE cf_grant_tasks SET owner_id=?,version=version+1 WHERE id=?', ownerId, taskId))
  } else {
   const completedOn = date(p.completedOn, 'Report completed on'), notes = longText(p.notes, 'Report completion evidence', 4000)
   if (completedOn > day || completedOn < grant.awarded_on) fail('INPUT', 'Report completion date must be between the award and today.', 400)
   statements.push(sql("UPDATE cf_grant_tasks SET status='done',version=version+1,completed_on=?,completed_by=?,notes=? WHERE id=?", completedOn, c.actor.id, notes, taskId))
  }
  statements.push(event(c, command, 'grantTask', taskId, grant.donor_id, { grantId }))
  await commit(c, statements)
  return { id: grantId, version, taskId, taskVersion: taskVersion + 1 }
 }
 await commit(c, statements)
 return { id: grantId, version: version + 1 }
}

export async function grantDownload(c: Context, documentId: string) {
 staff(c)
 const document = await one(c, `SELECT f.* FROM cf_grant_documents f JOIN cf_grants g ON g.id=f.grant_id JOIN cf_donors d ON d.id=g.donor_id
  WHERE f.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`, id(documentId, 'Grant document'))
 if (!document) fail('NOT_FOUND', 'That grant document is no longer available.', 404)
 return new Response(Uint8Array.from(atob(document.content_base64), ch => ch.charCodeAt(0)), { headers: {
  'content-type': document.media_type, 'content-disposition': `attachment; filename="${document.file_name.replace(/["\x00-\x1f\x7f-\uffff]/g, '_')}"`,
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
 } })
}
