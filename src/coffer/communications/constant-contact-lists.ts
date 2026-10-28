import { all, fail, type Context, type Row } from '../db'
import type { Connection } from './connection'
import { ccPart, ccRequest } from './constant-contact-api'

const clearList=async(c:Context,row:Row)=>{await c.db.prepare('UPDATE cf_communications SET provider_list_id=NULL,provider_list_delete_id=NULL WHERE id=? AND provider_list_id=?').bind(row.id,row.provider_list_id).run()}
async function confirmDeletion(c:Context,conn:Connection,row:Row,activityId:string){
 const activity=await ccRequest(conn,'/activities/'+ccPart(activityId))
 if(activity.activity_id!==activityId||activity.activity_errors?.length)fail('CONSTANT_CONTACT_RESPONSE','Constant Contact did not confirm temporary audience cleanup.',502)
 if(activity.state!=='completed')return
 if(!await ccRequest(conn,'/contact_lists/'+ccPart(row.provider_list_id),'GET',undefined,true))await clearList(c,row)
}

/** Keep the isolated audience until sending is DONE. List deletion itself is an
 * asynchronous provider activity; retain its receipt until removal is confirmed. */
export async function releaseConstantContactList(c:Context,conn:Connection,row:Row){
 if(!row.provider_list_id||!row.revision_id)return
 if(row.provider_list_delete_id)return confirmDeletion(c,conn,row,row.provider_list_delete_id)
 const activity=await ccRequest(conn,'/emails/activities/'+ccPart(row.revision_id))
 if(activity.campaign_id!==row.campaign_id)fail('CONSTANT_CONTACT_RESPONSE','Constant Contact returned a different campaign during audience cleanup.',502)
 if(activity.current_status!=='DONE')return
 const path='/contact_lists/'+ccPart(row.provider_list_id)
 const list=await ccRequest(conn,path,'GET',undefined,true)
 if(!list)return clearList(c,row)
 if(list.name!=='Coffer '+row.id)fail('CONSTANT_CONTACT_RESPONSE','The temporary audience no longer belongs to this message. It was not removed.',502)
 const receipt=await ccRequest(conn,path,'DELETE')
 ccPart(receipt.activity_id)
 await c.db.prepare('UPDATE cf_communications SET provider_list_delete_id=? WHERE id=? AND provider_list_id=?').bind(receipt.activity_id,row.id,row.provider_list_id).run()
 await confirmDeletion(c,conn,row,receipt.activity_id)
}

/** Reclaim completed audiences even when the next appeal precedes a refresh. */
export async function releaseCompletedConstantContactLists(c:Context,conn:Connection){
 const rows=await all(c,`SELECT * FROM cf_communications WHERE provider='constant-contact' AND provider_list_id IS NOT NULL AND revision_id IS NOT NULL ORDER BY COALESCE(checked_at,''),created_at,id LIMIT 8`)
 for(const row of rows)await releaseConstantContactList(c,conn,row)
}
