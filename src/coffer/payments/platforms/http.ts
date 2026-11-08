import { all, fail, id, type Context } from '../../db'
import { page } from '../../ui/common'
import { csvInput, parseBenevity } from './benevity'
import { approvePlatformBatch, platformBatch, platformBatches, previewPlatform } from './service'
import { batchPage, mappingPage, provenancePage, uploadPage } from './ui'

export async function platformResponse(request:Request,c:Context,input:()=>Promise<any>,suffix:string,api:boolean){
 if(!suffix.startsWith('/platforms/benevity'))return null
 const sub=suffix.slice('/platforms/benevity'.length),root='/app/payouts/platforms/benevity'
 const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'no-store'}})
 const redirect=(to:string)=>new Response(null,{status:303,headers:{location:to,'cache-control':'no-store'}})
 if(sub===''&&['GET','HEAD'].includes(request.method)){
  const view=await platformBatches(c);return api?json(view):page('Benevity disbursements',uploadPage(view),c.actor,200,'/app/payouts')
 }
 if(['/columns','/values','/preview'].includes(sub)&&request.method==='POST'){
  const data=await input()
  if(data.file instanceof File&&data.file.size){
   if(data.file.size>150000||!data.file.name.toLowerCase().endsWith('.csv'))fail('CSV','Choose a UTF-8 CSV no larger than 150 KB.',400)
   data.csv=await data.file.text()
  }
  if(typeof data.controls==='string'){try{data.controls=JSON.parse(data.controls)}catch{fail('MAPPING','The source controls could not be read.',400)}}
  if(!api&&sub==='/preview'){
   for(const kind of ['fund','campaign']){
    const values:Record<string,string>={}
    for(let i=0;data[kind+'Source_'+i]!==undefined;i++)values[String(data[kind+'Source_'+i])]=String(data[kind+'Target_'+i]??'')
    data[kind+'Map']=values
   }
  }
  if(sub==='/values'){const parsed=await parseBenevity(data);return api?json(parsed):page('Map source provenance',provenancePage(parsed,await all(c,'SELECT name FROM cf_funds ORDER BY name'),await all(c,'SELECT id,name,fund FROM cf_campaigns ORDER BY name')),c.actor,200,'/app/payouts')}
  if(sub==='/columns'){const source=csvInput(data);return api?json(source):page('Map Benevity columns',mappingPage(source),c.actor,200,'/app/payouts')}
  const view=await previewPlatform(c,data);return api?json(view):redirect(root+'/'+view.id)
 }
 const match=sub.match(/^\/([^/]+)(?:\/(approve))?$/)
 if(match){
  const batchId=id(decodeURIComponent(match[1]),'Disbursement review'),action=match[2]
  if(action&&request.method==='POST'){const view=await approvePlatformBatch(c,batchId,await input());return api?json(view):redirect(root+'/'+view.id)}
  if(!action&&['GET','HEAD'].includes(request.method)){const view=await platformBatch(c,batchId);return api?json(view):page('Benevity disbursement',batchPage(view),c.actor,200,'/app/payouts')}
 }
 fail('method_not_allowed','Use the disbursement review controls.',405)
}
