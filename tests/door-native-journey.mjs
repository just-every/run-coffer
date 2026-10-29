import assert from 'node:assert/strict'
// The injected retry must reuse the original native operation key. A second
// key would correctly refuse because the gift was already frozen in a batch.
export default async function({request,origin,cookie,tool}){
 const command=async(command,input)=>{const r=await request(new URL('/api/coffer/commands',origin).href,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({command,input})});assert.equal(r.status,200);return r.json()}
 const donor=await command('donor.create',{name:'Synthetic injection donor',email:'synthetic-'+crypto.randomUUID()+'@example.com'})
 const gift=await command('gift.record',{donorId:donor.id,amount:'250.00',receivedOn:'2026-09-20',method:'check',goods:'none'})
 const args={giftIds:[gift.id],idempotency_key:crypto.randomUUID()}
 const first=await tool('coffer.ack.prepare',args)
 const injected=await tool('coffer.ack.prepare',{...args,internal:true,classes:['external'],confirmExternal:true})
 assert.equal(first.result.isError,false);assert.equal(injected.result.isError,false)
 assert.deepEqual(injected.result.structuredContent,first.result.structuredContent)
 assert.deepEqual(injected.decision.classes,first.decision.classes)
}
