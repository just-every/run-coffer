import { all, choice, commit, date, event, fail, guard, newId, sql, text, today, type Context, type Row } from './db'
import { amount } from './money'
import { settings } from './settings'

export async function restrictedFundCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command === 'fund.define') {
  const name = text(p.name, 'Fund name', 100), restriction = choice(p.restriction, ['unrestricted','purpose','time'] as const, 'Restriction')
  const detail = restriction === 'unrestricted' ? null : text(p.detail, 'Restriction details', 300)
  const releaseOn = restriction === 'time' ? date(p.releaseOn, 'Release on') : null
  await commit(c, [
   guard('NOT EXISTS(SELECT 1 FROM cf_funds WHERE name=?)', 'FUND_DEFINED', 'This fund already has a definition. Use a new fund for a different restriction.', name),
   guard('NOT EXISTS(SELECT 1 FROM cf_payout_postings p JOIN cf_payout_entries e ON e.payout_id=p.payout_id JOIN cf_payment_entries l ON l.id=e.entry_id WHERE l.fund=?) AND NOT EXISTS(SELECT 1 FROM cf_payout_postings p JOIN cf_payout_entries e ON e.payout_id=p.payout_id JOIN cf_payment_entries l ON l.id=e.entry_id JOIN cf_gift_allocations a ON a.gift_id=l.gift_id WHERE a.fund=?)', 'FUND_POSTED', 'This fund already has an accounting submission. Its restriction cannot change.', name, name),
   guard('NOT EXISTS(SELECT 1 FROM cf_batch_postings p JOIN cf_batch_entries e ON e.batch_id=p.batch_id JOIN cf_gifts g ON g.id=e.gift_id LEFT JOIN cf_gift_allocations a ON a.gift_id=g.id WHERE COALESCE(a.fund,g.fund)=?)','FUND_POSTED','This fund already has an accounting submission. Its restriction cannot change.',name),
   guard("NOT EXISTS(SELECT 1 FROM cf_qbo_postings q WHERE (q.kind='payout' AND q.source_id IN (SELECT x.payout_id FROM cf_payout_entries x JOIN cf_payment_entries p ON p.id=x.entry_id LEFT JOIN cf_gift_allocations a ON a.gift_id=p.gift_id WHERE COALESCE(a.fund,p.fund)=?)) OR (q.kind='batch' AND q.source_id IN (SELECT e.batch_id FROM cf_batch_entries e JOIN cf_gifts g ON g.id=e.gift_id LEFT JOIN cf_gift_allocations a ON a.gift_id=g.id WHERE COALESCE(a.fund,g.fund)=?)))",'FUND_POSTED','This fund already has an accounting submission. Its restriction cannot change.',name,name),
   sql('INSERT INTO cf_funds VALUES(?,?,?,?,?)', name, restriction, detail, releaseOn, c.now),
   event(c, 'fund.define', 'fund', name, null, { restriction, releaseOn }),
  ])
  return { name, restriction, detail, releaseOn }
 }
 if (command === 'fund.spend') {
  const fund = text(p.fund, 'Fund', 100), cents = amount(p, 'amount', 'Spend amount'), spentOn = date(p.spentOn, 'Spent on')
  const reference = text(p.reference, 'Accounting reference', 100), note = text(p.note, 'Spend description', 500), id = newId()
  if (spentOn > today((await settings(c)).timezone, new Date(c.now))) fail('INPUT', 'Record spending only after it happens.', 400)
  await commit(c, [
   guard("EXISTS(SELECT 1 FROM cf_funds WHERE name=? AND restriction<>'unrestricted')", 'RESTRICTED_FUND', 'Choose a defined restricted fund.', fund),
   guard('NOT EXISTS(SELECT 1 FROM cf_fund_spends WHERE fund=? AND reference=?)', 'SPEND_RECORDED', 'This accounting reference is already recorded for this fund.', fund, reference),
   guard('COALESCE((SELECT SUM(amount_cents) FROM cf_fund_ledger WHERE fund=? AND received_on<=?),0)-COALESCE((SELECT SUM(amount_cents) FROM cf_fund_spends WHERE fund=?),0)>=?', 'FUND_BALANCE', 'The spend exceeds the unspent gifts received by this date.', fund, spentOn, fund, cents),
   sql('INSERT INTO cf_fund_spends VALUES(?,?,?,?,?,?,?)', id, fund, spentOn, cents, reference, note, c.now),
   event(c, 'fund.spend', 'fundSpend', id, null, { fund, amountCents: cents, spentOn }),
  ])
  return { id, fund, amountCents: cents }
 }
 return undefined
}

export async function restrictionRecordSelection(c:Context,url:URL) {
 const through = url.searchParams.get('through') ? date(url.searchParams.get('through'), 'Through') : today((await settings(c)).timezone, new Date(c.now))
 const fund=url.searchParams.get('fund')||null
 return {through,fund,query:'SELECT * FROM cf_fund_ledger WHERE received_on<=? AND (? IS NULL OR fund=?)',params:[through,fund,fund]}
}

export async function restrictionReport(c: Context, url: URL) {
 const selection=await restrictionRecordSelection(c,url),{through,fund:chosenFund}=selection
 const funds = await all(c, `WITH names AS (SELECT name FROM cf_funds UNION SELECT DISTINCT fund FROM cf_fund_ledger)
 SELECT n.name AS fund,COALESCE(f.restriction,'unrestricted') AS restriction,f.detail,f.release_on,
 COALESCE((SELECT SUM(amount_cents) FROM (${selection.query}) l WHERE l.fund=n.name),0) AS given_cents,
 COALESCE((SELECT SUM(amount_cents) FROM cf_fund_spends s WHERE s.fund=n.name AND s.spent_on<=?),0) AS spent_cents
 FROM names n LEFT JOIN cf_funds f ON f.name=n.name WHERE (? IS NULL OR n.name=?) ORDER BY n.name`, ...selection.params, through,chosenFund,chosenFund)
 for (const fund of funds) {
  const expired = fund.restriction === 'time' && fund.release_on <= through
  fund.released_cents = fund.restriction === 'unrestricted' || expired ? fund.given_cents : fund.spent_cents
  fund.held_cents = fund.given_cents - fund.released_cents
 }
 return { through, funds, spends: await all(c, 'SELECT * FROM cf_fund_spends WHERE spent_on<=? AND (? IS NULL OR fund=?) ORDER BY spent_on DESC,created_at DESC,id', through,chosenFund,chosenFund) }
}

export function restrictionLabel(fund: Row) {
 if (!fund.restriction || fund.restriction === 'unrestricted') return 'Unrestricted'
 return `${fund.restriction === 'purpose' ? 'Purpose restricted' : 'Time restricted'}: ${fund.detail}${fund.release_on ? `; release ${fund.release_on}` : ''}`
}
