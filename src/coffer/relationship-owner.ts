import { one } from './db'

/** Shared relationship routing: portfolio, active opportunity owner, then owner. */
export const routingOwnerSql = (donor: string) => `SELECT id,email,display_name,role FROM (
 SELECT o.id,o.email,o.display_name,o.role,0 AS priority FROM cf_portfolio_members m JOIN cf_portfolios p ON p.id=m.portfolio_id
 JOIN oa_operators o ON o.id=p.manager_id WHERE m.donor_id=${donor} AND o.status='active' AND o.role IN ('owner','admin','member')
 UNION ALL SELECT o.id,o.email,o.display_name,o.role,1 AS priority FROM oa_operators o
 WHERE o.status='active' AND o.role IN ('owner','admin','member') AND o.id=(
  SELECT p.owner_id FROM cf_prospects p JOIN oa_operators staff ON staff.id=p.owner_id
  WHERE p.donor_id=${donor} AND staff.status='active' AND staff.role IN ('owner','admin','member') ORDER BY p.updated_at DESC,p.id DESC LIMIT 1)
 UNION ALL SELECT id,email,display_name,role,2 AS priority FROM oa_operators WHERE status='active' AND role='owner')
 ORDER BY priority,id LIMIT 1`
export const routingOwner = (db: D1Database, donorId: string) => one({ db }, routingOwnerSql('?'), donorId, donorId)
