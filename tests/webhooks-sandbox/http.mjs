import assert from 'node:assert/strict'

export function publicClient(origin,control) {
 let cookie=''
 const request=(path,{method='GET',body,raw,anonymous=false,timeout=30000,headers={}}={})=>fetch(origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(timeout),headers:{origin,'content-type':'application/json',...(!anonymous&&cookie?{cookie}:{}),...headers},...(raw!==undefined?{body:raw}:body!==undefined?{body:JSON.stringify(body)}:{})})
 const expectStatus=async(response,status,path)=>{
  if(response.status!==status){
   let code='non-JSON';try{const value=await response.clone().json();if(typeof value.error==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(value.error))code=value.error}catch{}
   throw Error('Sandbox HTTP '+response.status+' expected '+status+' for '+path+' at '+new URL(response.url).hostname+' content type '+String(response.headers.get('content-type'))+' code '+code+' handler '+String(response.headers.get('x-coffer-sandbox-route'))+' ray '+String(response.headers.get('cf-ray'))+' cache '+String(response.headers.get('cf-cache-status')))
  }
 }
 const json=async(path,body,{status=200,...options}={})=>{
  const response=await request(path,{...(body===undefined?{}:{method:'POST',body}),...options})
  await expectStatus(response,status,path)
  if(status===204)return null
  try{return await response.json()}catch{throw Error('Sandbox expected JSON at '+path+' HTTP '+response.status+' content type '+String(response.headers.get('content-type')))}
 }
 const controlled=(path,body,options={})=>json('/_sandbox/'+path,body,{...options,headers:{authorization:'Bearer '+control}})
 return {origin,request,json,controlled,
  command:(command,input={},options={})=>json('/api/coffer/commands',{command,input},options),
  async bootstrap(token){
   const response=await request('/auth/bootstrap',{method:'POST',body:{token,displayName:'Coffer sandbox owner'},anonymous:true})
   await expectStatus(response,303,'/auth/bootstrap')
   cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
   assert.ok(cookie,'Native bootstrap issued a session')
   const setup=await request('/setup',{method:'POST',raw:'confirm=yes',headers:{'content-type':'application/x-www-form-urlencoded'}})
   await expectStatus(setup,303,'/setup')
   const session=await json('/auth/session')
   assert.equal(session.kind,'native');assert.equal(session.operator.role,'owner')
  },
  async ready(){
   const deadline=Date.now()+180000
   let status,stableSince=null,failures=0
   // Newly enabled public hostnames can return edge 404s before dispatch.
   // Establish sustained read-only readiness; provider mutations are never retried.
   do{
    try{
     const response=await request('/_sandbox/ready',{headers:{authorization:'Bearer '+control,'cache-control':'no-cache'}})
     status=response.status
     if(status===200&&(await response.json()).ready===true){
      stableSince??=Date.now()
      if(Date.now()-stableSince>=20000){console.log(JSON.stringify({stage:'public-host-ready',hostname:new URL(origin).hostname,edgeFailures:failures}));return}
     }else{stableSince=null;failures++}
    }catch{stableSince=null;failures++}
    await new Promise(resolve=>setTimeout(resolve,1500))
   }while(Date.now()<deadline)
   throw Error('Disposable Worker sustained readiness exceeded 180 seconds; final HTTP '+String(status))
  }
 }
}
