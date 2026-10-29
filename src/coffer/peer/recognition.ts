import { commit, event, guard, integer, sql, type Row } from '../db'
import type { PeerContext } from './service'
import { intentRecognition } from '../recognition'

/** Verified supporters record only their own explicit public recognition choices. */
export async function savePeerRecognition(c: PeerContext, donorId: string, p: Row) {
 const recognition = intentRecognition(p), version = integer(Number(p.version), 'Recognition version')
 const permission = p.honorRollOptIn === 'yes' ? 1 : 0
 await commit(c, [
  guard('COALESCE((SELECT version FROM cf_donor_recognition WHERE donor_id=?),0)=?', 'VERSION', 'Your recognition choices changed. Reload before saving.', donorId, version),
  sql(`INSERT INTO cf_donor_recognition(donor_id,anonymous,recognition_name,honor_roll_opt_in,version) VALUES(?,?,?,?,1)
   ON CONFLICT(donor_id) DO UPDATE SET anonymous=excluded.anonymous,recognition_name=excluded.recognition_name,honor_roll_opt_in=excluded.honor_roll_opt_in,version=cf_donor_recognition.version+1`, donorId, recognition.anonymous, recognition.recognitionName, permission),
  ...(!permission || recognition.anonymous ? [
   sql('UPDATE cf_peer_pages SET published=0,version=version+1 WHERE donor_id=? AND published=1', donorId),
   sql('UPDATE cf_peer_teams SET published=0,version=version+1 WHERE donor_id=? AND published=1', donorId),
  ] : []),
  event(c, 'peer.recognition', 'donor', donorId, donorId, {version: version + 1, anonymous: recognition.anonymous, honorRollOptIn: permission}),
 ])
 return {version: version + 1}
}
