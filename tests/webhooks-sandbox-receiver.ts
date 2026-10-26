import { verifyWebhook } from '../src/coffer/webhooks/receiver.mjs'

interface Env { DB:D1Database; SANDBOX_SECRET:string; RESPONSE_MARKER:string }
export default {
 async fetch(request:Request,env:Env) {
  const path = new URL(request.url).pathname
  if (path.startsWith('/_sandbox/')) {
   if (request.headers.get('authorization')!=='Bearer '+env.SANDBOX_SECRET) return new Response(null,{status:404})
   if (path==='/_sandbox/ready') return Response.json({ready:true})
   if (path==='/_sandbox/key' && request.method==='POST') {
    const {secret}=await request.json() as {secret:string}
    if (!/^[a-f0-9]{64}$/.test(secret)) return new Response(null,{status:400})
    const row=await env.DB.prepare("INSERT OR IGNORE INTO receiver_config(id,secret) VALUES(1,?)").bind(secret).run()
    return row.meta.changes===1?new Response(null,{status:204}):Response.json({error:'KEY_ALREADY_SET'},{status:409})
   }
   if (path==='/_sandbox/state') {
    const [receipts,seen,business,hits]=await env.DB.batch([
     env.DB.prepare('SELECT * FROM receiver_receipts ORDER BY rowid'),
     env.DB.prepare('SELECT * FROM receiver_seen ORDER BY event_id'),
     env.DB.prepare('SELECT * FROM receiver_business'),
     env.DB.prepare('SELECT * FROM receiver_hits')
    ])
    return Response.json({receipts:receipts.results,seen:seen.results,business:business.results,hits:hits.results})
   }
   return new Response(null,{status:404})
  }
  if(path==='/redirect-target') {
   await env.DB.prepare("UPDATE receiver_hits SET hits=hits+1 WHERE name='target'").run()
   return new Response(env.RESPONSE_MARKER,{status:200})
  }
  if(path==='/redirect') {
   await env.DB.prepare("UPDATE receiver_hits SET hits=hits+1 WHERE name='redirect'").run()
   return new Response(env.RESPONSE_MARKER,{status:307,headers:{location:new URL('/redirect-target',request.url).href}})
  }
  if(path!=='/events'||request.method!=='POST') return new Response(null,{status:404})
  const config=await env.DB.prepare('SELECT secret FROM receiver_config WHERE id=1').first<{secret:string}>()
  if(!config) return new Response(null,{status:503})
  const body=await request.text(),signature=request.headers.get('coffer-signature')
  let event
  try { event=await verifyWebhook(config.secret,signature,body) } catch { return new Response(null,{status:401}) }
  if(request.headers.get('coffer-event-id')!==event.id) return new Response(null,{status:401})
  const delivery=request.headers.get('coffer-delivery-id')
  if(!delivery) return new Response(null,{status:400})
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))].map(v=>v.toString(16).padStart(2,'0')).join('')
  // D1 batch is atomic. The business effect and event ID commit together.
  // A retry, replay or concurrent duplicate cannot increment the count twice.
  const result=await env.DB.batch([
   env.DB.prepare("UPDATE receiver_business SET gifts=gifts+1 WHERE id=1 AND ?='gift.created' AND NOT EXISTS(SELECT 1 FROM receiver_seen WHERE event_id=?)").bind(event.type,event.id),
   env.DB.prepare('INSERT OR IGNORE INTO receiver_seen(event_id,event_type,subject_id) VALUES(?,?,?)').bind(event.id,event.type,event.data.id),
   env.DB.prepare('INSERT INTO receiver_receipts(id,event_id,delivery_id,body_sha256,signature_timestamp) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),event.id,delivery,digest,Number(/^t=(\d+)/.exec(signature!)![1])),
   env.DB.prepare('SELECT COUNT(*) AS count FROM receiver_receipts WHERE event_id=?').bind(event.id)
  ])
  // An ambiguous failure: the effect is durable before the sender sees 503.
  const first=Number((result[3].results[0] as {count:number}).count)===1
  return new Response(first&&event.type==='gift.created'?env.RESPONSE_MARKER:null,{status:first&&event.type==='gift.created'?503:204})
 }
}
