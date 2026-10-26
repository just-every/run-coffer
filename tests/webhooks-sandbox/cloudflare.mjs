import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {build} from 'esbuild'

export const accountId='b20c0ca9cab0c2b70e13d7cf724b89bd'
export const privateEndpoint='https://127.0.0.1.sslip.io/'
export const freshSecret=()=>randomBytes(32).toString('hex')
export async function sandboxResources(token) {
 assert.ok(token,'Inject CLOUDFLARE_RER_STAGE_TOKEN')
 if(process.env.CLOUDFLARE_ACCOUNT_ID) assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID,accountId,'Only the RunEditRun account is allowed')
 const owned=[],prefix='coffer-api002-proof-'+randomBytes(8).toString('hex')
 const api=async(path,{method='GET',body,form,missing=false,timeout=30000}={})=>{
  const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+accountId+path,{method,signal:AbortSignal.timeout(timeout),headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(form?{body:form}:body?{body:JSON.stringify(body)}:{})})
  if(missing&&response.status===404) return null
  let data;try{data=await response.json()}catch{throw Error('Cloudflare returned non-JSON HTTP '+response.status)}
  if(!response.ok||data.success===false)throw Error('Cloudflare '+method+' refused HTTP '+response.status+' codes '+(data.errors??[]).map(e=>Number(e.code)||0).join(','))
  return data.result
 }
 const query=async(id,sql,params=[],timeout=30000)=>{
  assert.ok(owned.some(r=>r.kind==='d1'&&r.id===id),'Query only this run’s database')
  const rows=await api('/d1/database/'+id+'/query',{method:'POST',body:{sql,params},timeout})
  assert.ok(rows.every(r=>r.success!==false),'D1 query failed')
  return rows
 }
 const database=async(suffix)=>{
  const result=await api('/d1/database',{method:'POST',body:{name:prefix+'-'+suffix}})
  assert.ok(result.uuid,'D1 create returned no ID')
  owned.push({kind:'d1',id:result.uuid,name:prefix+'-'+suffix})
  return result.uuid
 }
 const deploy=async(suffix,entry,db,vars)=>{
  const name=prefix+'-'+suffix
  assert.equal(await api('/workers/scripts/'+name+'/settings',{missing:true}),null,'Disposable Worker must not already exist')
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'))
  assert.ok(config.compatibility_flags.includes('global_fetch_strictly_public'),'Use the production public fetch boundary')
  const bundle=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['node:*','cloudflare:*'],logLevel:'silent'})
  const form=new FormData()
  form.set('metadata',JSON.stringify({main_module:'sandbox.mjs',compatibility_date:config.compatibility_date,compatibility_flags:config.compatibility_flags,bindings:[{type:'d1',name:'DB',id:db},...Object.entries(vars).map(([name,text])=>({type:['SANDBOX_SECRET','SESSION_SECRET','SETUP_TOKEN','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'].includes(name)?'secret_text':'plain_text',name,text}))]}))
  form.set('sandbox.mjs',new Blob([bundle.outputFiles[0].text],{type:'application/javascript+module'}),'sandbox.mjs')
  owned.push({kind:'worker',id:name,name})
  const result=await api('/workers/scripts/'+name,{method:'PUT',form})
  await api('/workers/scripts/'+name+'/subdomain',{method:'POST',body:{enabled:true,previews_enabled:false}})
  console.log(JSON.stringify({stage:'deployed',name,version:result.deployment_id??null,strictlyPublic:true}))
  return name
 }
 const migrate=async id=>{
  await query(id,'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)')
  const files=(await readdir('./migrations/core')).filter(f=>f.endsWith('.sql')).sort()
  for(const [index,file] of files.entries()){
   assert.match(file,/^[a-zA-Z0-9_.-]+$/)
   try{await query(id,(await readFile('./migrations/core/'+file,'utf8'))+"\n; INSERT INTO d1_migrations(name) VALUES('"+file+"');")}
   catch(error){throw Error('Native migration '+file+' failed: '+error.message)}
   if((index+1)%25===0)console.log(JSON.stringify({stage:'native-migrations',applied:index+1,total:files.length}))
  }
  return files.length
 }
 const cleanup=async()=>{
  const failures=[]
  for(const resource of [...owned].reverse()){
   try{
    await api(resource.kind==='worker'?'/workers/scripts/'+resource.id:'/d1/database/'+resource.id,{method:'DELETE',missing:true})
    console.log(JSON.stringify({stage:'deleted',kind:resource.kind,name:resource.name}))
   }catch{failures.push(resource.name)}
  }
  if(failures.length)throw Error('Cleanup failed for disposable resources: '+failures.join(', '))
 }
 const {subdomain}=await api('/workers/subdomain')
 assert.match(subdomain,/^[a-z0-9-]+$/)
 return {prefix,api,query,database,deploy,migrate,cleanup,origin:suffix=>'https://'+prefix+'-'+suffix+'.'+subdomain+'.workers.dev'}
}
