import { requireRole } from '../auth'
import { all, commit, event, fail, guard, one, sha256, sql, text, type Context, type Row } from '../db'

/** Publication reviews the exact saved draft, including fee cover, appeals and
 * media. A native session is required at the transport; public keys never gain
 * this operation by holding the full local record scope. */
export async function campaignPublication(c:{db:D1Database},id:string){
 const campaign=await one(c,'SELECT * FROM cf_campaigns WHERE id=?',id)
 if(!campaign)fail('NOT_FOUND','That campaign does not exist.',404)
 const [appeals,media]=await Promise.all([
  all(c,'SELECT * FROM cf_campaign_appeals WHERE campaign_id=? ORDER BY appeal',id),
  all(c,'SELECT * FROM cf_campaign_media WHERE campaign_id=? ORDER BY kind',id),
 ])
 return {campaign,appeals,media,version:await sha256(JSON.stringify({campaign,appeals,media}))}
}
export async function publishCampaign(c:Context,id:string,input:Row){
 requireRole(c.actor,['owner','admin'],'publish campaigns')
 if(c.actor.apiKey)fail('SESSION_REQUIRED','Review campaign publication in your native session.',403)
 if(input.reviewed!=='yes'&&input.reviewed!==true)fail('REVIEW_REQUIRED','Review this saved campaign before publishing.',400)
 const state=await campaignPublication(c,id)
 if(state.campaign.active)fail('CAMPAIGN_PUBLISHED','This campaign is already published.',409)
 if(text(input.version,'Campaign version',64)!==state.version)fail('CAMPAIGN_CHANGED','The campaign changed. Review the current draft before publishing.',409)
 const current=(table:string,row:Row)=>guard(`EXISTS(SELECT 1 FROM ${table} WHERE ${Object.keys(row).map(key=>key+' IS ?').join(' AND ')})`,'CAMPAIGN_CHANGED','The campaign changed. Review the current draft before publishing.',...Object.values(row))
 await commit(c,[current('cf_campaigns',state.campaign),
  guard('(SELECT COUNT(*) FROM cf_campaign_appeals WHERE campaign_id=?)=? AND (SELECT COUNT(*) FROM cf_campaign_media WHERE campaign_id=?)=?','CAMPAIGN_CHANGED','The campaign changed. Review the current draft before publishing.',id,state.appeals.length,id,state.media.length),
  ...state.appeals.map(row=>current('cf_campaign_appeals',row)),...state.media.map(row=>current('cf_campaign_media',row)),
  sql('UPDATE cf_campaigns SET active=1 WHERE id=? AND active=0',id),event(c,'campaign.publish','campaign',id,null,{reviewed:true,version:state.version})])
 return {id}
}
