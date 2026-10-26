// Manually invoked live proof; deliberately absent from node:test and push Verify.
// COFFER_WEBHOOK_SANDBOX=1 node tests/webhooks-sandbox-journey.mjs
// Inject CLOUDFLARE_RER_STAGE_TOKEN privately, run with heavy-slot --remote never.
// Optional actual Stripe delivery: COFFER_WEBHOOK_STRIPE_SANDBOX=1 and a held STRIPE_SECRET_KEY.
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {sandboxResources,freshSecret,accountId} from './webhooks-sandbox/cloudflare.mjs'
import {publicClient} from './webhooks-sandbox/http.mjs'
import {proveDelivery} from './webhooks-sandbox/proof.mjs'
import {stripeSandbox} from './webhooks-sandbox/stripe.mjs'
import {proveStripeDelivery} from './webhooks-sandbox/stripe-proof.mjs'

const receiverSchema=`
 CREATE TABLE receiver_config(id INTEGER PRIMARY KEY CHECK(id=1),secret TEXT NOT NULL);
 CREATE TABLE receiver_business(id INTEGER PRIMARY KEY CHECK(id=1),gifts INTEGER NOT NULL);
 INSERT INTO receiver_business VALUES(1,0);
 CREATE TABLE receiver_seen(event_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,subject_id TEXT NOT NULL);
 CREATE TABLE receiver_receipts(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES receiver_seen(event_id),delivery_id TEXT NOT NULL,body_sha256 TEXT NOT NULL,signature_timestamp INTEGER NOT NULL);
 CREATE TABLE receiver_hits(name TEXT PRIMARY KEY,hits INTEGER NOT NULL);
 INSERT INTO receiver_hits VALUES('redirect',0),('target',0);
`

export async function webhooksSandboxJourney(){
 assert.equal(process.env.COFFER_WEBHOOK_SANDBOX,'1','Opt in with COFFER_WEBHOOK_SANDBOX=1')
 const includeStripe=process.env.COFFER_WEBHOOK_STRIPE_SANDBOX==='1'
 assert.ok([undefined,'0','1'].includes(process.env.COFFER_WEBHOOK_STRIPE_SANDBOX),'Stripe sandbox opt-in must be 0 or 1')
 const resources=await sandboxResources(process.env.CLOUDFLARE_RER_STAGE_TOKEN)
 const control=freshSecret(),setup=freshSecret(),session=freshSecret(),marker='synthetic-coffer-'+freshSecret()
 let failure,stripe,stripeProof
 try{
  console.log(JSON.stringify({stage:'sandbox-start',accountId,prefix:resources.prefix,stripeIncluded:includeStripe}))
  const appDb=await resources.database('app'),receiverDb=await resources.database('receiver')
  const migrationCount=await resources.migrate(appDb)
  await resources.query(receiverDb,receiverSchema)
  console.log(JSON.stringify({stage:'native-migrations-complete',migrationCount}))
  let stripeBindings={}
  if(includeStripe){
   stripe=await stripeSandbox(process.env.STRIPE_SECRET_KEY,resources.prefix)
   stripeBindings=await stripe.endpoint(resources.origin('app'))
  }
  await resources.deploy('receiver','tests/webhooks-sandbox-receiver.ts',receiverDb,{SANDBOX_SECRET:control,RESPONSE_MARKER:marker})
  await resources.deploy('app','tests/webhooks-sandbox-worker.ts',appDb,{SANDBOX_SECRET:control,AUTH_ORIGIN:resources.origin('app'),AUTH_LOCAL:'false',OWNER_EMAIL:'synthetic-coffer-2@example.test',SESSION_SECRET:session,SETUP_TOKEN:setup,MAIL_PROVIDER:'development',...stripeBindings})
  const app=publicClient(resources.origin('app'),control),receiver=publicClient(resources.origin('receiver'),control)
  await Promise.all([app.ready(),receiver.ready()])
  await app.bootstrap(setup)
  console.log(JSON.stringify({stage:'native-session-proven',origin:app.origin}))
  await proveDelivery({app,receiver,query:resources.query,db:appDb,marker,...(stripe?{afterDelivery:async({subscriptionId})=>{stripeProof=await proveStripeDelivery({stripe,app,receiver,query:resources.query,db:appDb,subscriptionId})}}:{})})
  console.log(JSON.stringify({stage:'sandbox-complete',provider:'Cloudflare',stripeIncluded:includeStripe,stripeProof:stripeProof??false}))
 }catch(error){failure=error}
 finally{
  if(stripe)try{await stripe.cleanup()}catch(error){failure=failure?new Error(failure.message+'; '+error.message):error}
  try{await resources.cleanup()}catch(error){failure=failure?new Error(failure.message+'; '+error.message):error}
 }
 if(failure)throw failure
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 webhooksSandboxJourney().catch(error=>{
  // Never print request objects, response bodies, assertion values or credentials.
  console.error('Webhook sandbox failed: '+String(error.message).replace(/https?:\/\/\S+/g,'[url]').replace(/[a-f0-9]{64}/g,'[redacted]').slice(0,1500))
  process.exitCode=1
 })
}
