import assert from 'node:assert/strict'

// A documentation-shaped Cloudflare DNS JSON response at the network boundary.
export function webhookDnsQuestion(request){
 const url=new URL(request.url)
 if(url.hostname!=='cloudflare-dns.com')return null
 assert.equal(url.pathname,'/dns-query')
 assert.equal(request.method,'GET')
 assert.equal(request.headers.get('accept'),'application/dns-json')
 for(const header of ['coffer-signature','coffer-event-id','coffer-delivery-id','authorization','cookie'])assert.equal(request.headers.get(header),null,'DNS receives no signing or identity material')
 assert.deepEqual([...url.searchParams.keys()].sort(),['name','type'])
 assert.ok(['A','AAAA'].includes(url.searchParams.get('type')))
 return {name:url.searchParams.get('name'),type:url.searchParams.get('type')==='A'?1:28}
}
export const dnsRecord=(name,type,data)=>({name:name+'.',type,TTL:60,data})
export const dnsAnswer=(question,Answer,extra={})=>Response.json({Status:0,TC:false,RD:true,RA:true,AD:false,CD:false,Question:[{name:question.name+'.',type:question.type}],Answer,...extra},{headers:{'content-type':'application/dns-json'}})
export function publicWebhookDns(request){
 const q=webhookDnsQuestion(request)
 return q?dnsAnswer(q,[dnsRecord(q.name,q.type,q.type===1?'93.184.216.34':'2606:4700:4700::1111')]):null
}
