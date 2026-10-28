import type { Context } from './db'
import { restrictionRecordSelection } from './restricted-funds'
import { selectedReport } from './exports-report-records'

export async function restrictionExportSelection(c:Context,url:URL) {
 const s=await restrictionRecordSelection(c,url)
 return selectedReport(c,'restrictions','gifts',{
  ...s,parameters:{through:s.through,fund:s.fund},
  totals:`(SELECT json_object('givenCents',COALESCE(SUM(given),0),'spentCents',COALESCE(SUM(spent),0),
   'releasedCents',COALESCE(SUM(released),0),'heldCents',COALESCE(SUM(given-released),0)) FROM (
    SELECT given,spent,CASE WHEN restriction='unrestricted' OR (restriction='time' AND release_on<='${s.through}') THEN given ELSE spent END AS released FROM (
     SELECT r.fund,SUM(r.amount_cents) AS given,COALESCE(f.restriction,'unrestricted') AS restriction,f.release_on,
      COALESCE((SELECT SUM(amount_cents) FROM cf_fund_spends s WHERE s.fund=r.fund AND s.spent_on<='${s.through}'),0) AS spent
     FROM report_entries r LEFT JOIN cf_funds f ON f.name=r.fund GROUP BY r.fund)))`,
 })
}
