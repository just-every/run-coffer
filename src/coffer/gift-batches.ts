import { all, choice, commit, date, event, fail, guard, id, integer, newId, one, optional, sql, text, today, type Context, type Row } from './db'
import { amount } from './money'
import { prepareGiftRecord } from './gifts'
import { entryAttribution } from './attribution'
import { settings } from './settings'

export async function giftBatches(c: Context) {
 return all(c, `SELECT b.*,COALESCE(SUM(e.amount_cents),0) AS total_cents,COUNT(e.id) AS gift_count FROM cf_gift_batches b LEFT JOIN cf_batch_entries e ON e.batch_id=b.id GROUP BY b.id ORDER BY b.created_at DESC,b.id`)
}
export async function giftBatch(c: Context, batchId: string): Promise<Row & { entries: Row[]; total_cents: number; gift_count: number; depositId: string | null }> {
 const batch = await one(c, 'SELECT * FROM cf_gift_batches WHERE id=?', batchId)
 if (!batch) fail('NOT_FOUND', 'That gift batch does not exist.', 404)
 const entries = await all(c, 'SELECT e.*,d.name AS donor_name FROM cf_batch_entries e JOIN cf_donors d ON d.id=e.donor_id WHERE e.batch_id=? ORDER BY e.created_at,e.id', batchId)
 return { ...batch, entries, total_cents: entries.reduce((n, e) => n + e.amount_cents, 0), gift_count: entries.length, depositId: batch.status === 'closed' ? batch.id : null }
}
const open = (batchId: string, version: number) => guard("EXISTS(SELECT 1 FROM cf_gift_batches WHERE id=? AND version=? AND status='open')", 'BATCH_CHANGED', 'This batch changed or is closed. Refresh before saving.', batchId, version)
export async function giftBatchCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!command.startsWith('giftBatch.')) return undefined
 if (command === 'giftBatch.create') {
  const batchId = newId(), received = date(p.receivedOn, 'Received on'), fund = optional(p.fund, 'Fund', 100) ?? 'Unrestricted'
  if (received > today((await settings(c)).timezone, new Date(c.now))) fail('INPUT', 'A batch records money already received.', 400)
  const method = choice(p.method, ['check','cash'] as const, 'check or cash'), expected = amount(p, 'expected', 'Expected deposit total')
  const name = text(p.name, 'Batch name', 100), attribution = await entryAttribution(c, p, fund, false)
  await commit(c, [
   ...(attribution.campaignId ? [guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND fund=?)','CAMPAIGN_FUND','Choose a campaign for the batch fund.',attribution.campaignId,fund)] : []),
   sql('INSERT INTO cf_gift_batches(id,name,received_on,fund,campaign_id,appeal,method,expected_cents,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',batchId,name,received,fund,attribution.campaignId,attribution.appeal,method,expected,c.now,c.actor.name),
   event(c,command,'giftBatch',batchId,null,{expectedCents:expected})])
  return { id:batchId,version:1 }
 }
 const batchId = id(p.batchId,'Batch'), version = integer(p.version,'Version',1), batch = await giftBatch(c,batchId)
 if (command === 'giftBatch.add' || command === 'giftBatch.edit') {
  const entryId = command === 'giftBatch.edit' ? id(p.entryId,'Batch row') : newId(), donorId = id(p.donorId,'Donor')
  const reference = optional(p.reference,'Check number',100)
  if (batch.method === 'check' && !reference) fail('INPUT','Enter the check number.',400)
  const prior=command==='giftBatch.edit'?batch.entries.find(e=>e.id===entryId):null
  const reply=optional(p.responseCode??p.appeal,'Response code',200)??prior?.appeal??batch.appeal
  const write = await prepareGiftRecord(c, { ...p, method:batch.method, receivedOn:batch.received_on, fund:batch.fund, campaignId:batch.campaign_id, appeal:reply }, entryId)
  const g = choice(p.goods,['none','provided'] as const,'goods or services answer'), goodsCents = g === 'none' ? 0 : amount(p,'goodsValue','Goods value'), goodsDescription = g === 'none' ? null : text(p.goodsDescription,'Goods description',300)
  await commit(c,[open(batchId,version),
   guard('EXISTS(SELECT 1 FROM cf_donors d WHERE id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))','NOT_FOUND','Choose a current donor.',donorId),
   ...(command === 'giftBatch.add' ? [guard('(SELECT COUNT(*) FROM cf_batch_entries WHERE batch_id=?)<100','BATCH_FULL','Close this batch before starting another.',batchId),
    sql('INSERT INTO cf_batch_entries(id,batch_id,donor_id,amount_cents,reference,goods,goods_cents,goods_description,created_at,custom_fields,appeal) VALUES(?,?,?,?,?,?,?,?,?,?,?)',entryId,batchId,donorId,write.result.amountCents,reference,g,goodsCents,goodsDescription,c.now,JSON.stringify(p.customFields??{}),write.result.appeal)] : [
    guard('EXISTS(SELECT 1 FROM cf_batch_entries WHERE id=? AND batch_id=?)','NOT_FOUND','That row is not in this batch.',entryId,batchId),
    sql('UPDATE cf_batch_entries SET donor_id=?,amount_cents=?,reference=?,goods=?,goods_cents=?,goods_description=?,custom_fields=?,appeal=? WHERE id=?',donorId,write.result.amountCents,reference,g,goodsCents,goodsDescription,JSON.stringify(p.customFields??{}),write.result.appeal,entryId)]),
   sql('UPDATE cf_gift_batches SET version=version+1 WHERE id=?',batchId),event(c,command,'giftBatch',batchId,donorId,{entryId,amountCents:write.result.amountCents})])
  return { id:batchId,entryId,version:version+1 }
 }
 if (command === 'giftBatch.close') {
  if (!batch.entries.length || batch.total_cents !== batch.expected_cents) fail('UNBALANCED','The running total must equal the expected deposit total before closing.')
  const writes = await Promise.all(batch.entries.map((entry: Row) => prepareGiftRecord(c, { customFields:JSON.parse(entry.custom_fields),donorId:entry.donor_id, amountCents:entry.amount_cents, receivedOn:batch.received_on, method:batch.method, reference:entry.reference, fund:batch.fund, campaignId:batch.campaign_id, appeal:entry.appeal??batch.appeal, channel:'mail', goods:entry.goods, goodsValueCents:entry.goods_cents, goodsDescription:entry.goods_description }, entry.id)))
  await commit(c,[open(batchId,version),guard('(SELECT SUM(amount_cents) FROM cf_batch_entries WHERE batch_id=?)=(SELECT expected_cents FROM cf_gift_batches WHERE id=?)','UNBALANCED','The deposit no longer balances.',batchId,batchId),
   ...writes.flatMap(write=>write.statements),sql('UPDATE cf_batch_entries SET gift_id=id WHERE batch_id=?',batchId),
   sql("UPDATE cf_gift_batches SET status='closed',closed_at=?,closed_by=?,version=version+1 WHERE id=?",c.now,c.actor.name,batchId),
   event(c,command,'giftBatch',batchId,null,{giftCount:batch.entries.length,amountCents:batch.total_cents})])
  return { id:batchId,depositId:batchId,version:version+1,giftIds:batch.entries.map(e=>e.id) }
 }
 return undefined
}
