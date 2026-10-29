import { sql, type Stmt } from '../db'

/** Identity changes invalidate public permission; retained attribution stays put. */
export function peerMergeStatements(source: string, target: string): Stmt[] {
 return ['cf_peer_teams', 'cf_peer_pages'].flatMap(table => [
  sql(`UPDATE ${table} SET published=0,version=version+1 WHERE donor_id IN (?,?)`, source, target),
  sql(`UPDATE ${table} SET donor_id=? WHERE donor_id=?`, target, source),
 ])
}
export function peerUnmergeStatements(source: string, target: string): Stmt[] {
 return ['cf_peer_teams', 'cf_peer_pages'].map(table =>
  sql(`UPDATE ${table} SET published=0,version=version+1 WHERE donor_id IN (?,?)`, source, target))
}
export function peerErasureStatements(donorId: string, placeholderId: string): Stmt[] {
 return ['cf_peer_teams', 'cf_peer_pages'].map(table =>
  sql(`UPDATE ${table} SET title='[erased]',published=0,version=version+1,donor_id=? WHERE donor_id=?`, placeholderId, donorId))
}
