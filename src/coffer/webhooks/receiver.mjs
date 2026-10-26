/** Verify before parsing or applying effects. The receiver must atomically store
 * the returned event ID with its business effect in its own durable database. */
export async function verifyWebhook(secret, signature, body, now = Date.now()) {
 const match = /^t=(\d+)((?:,v1=[a-f0-9]{64}){1,2})$/.exec(signature ?? '')
 if (!match || !Number.isSafeInteger(Number(match[1])) || Math.abs(now / 1000 - Number(match[1])) > 300) throw Error('Invalid or stale webhook signature')
 const bytes = value => new TextEncoder().encode(value)
 const key = await crypto.subtle.importKey('raw', bytes(secret), {name:'HMAC',hash:'SHA-256'}, false, ['verify'])
 let valid=false
 for (const part of match[2].slice(1).split(',')) {
  const digest = Uint8Array.from(part.slice(3).match(/../g), value => parseInt(value,16))
  if (await crypto.subtle.verify('HMAC',key,digest,bytes(match[1]+'.'+body))) valid=true
 }
 if (!valid) throw Error('Invalid webhook signature')
 const event = JSON.parse(body)
 if (!event || typeof event.id!=='string' || !event.id || typeof event.type!=='string' || typeof event.occurredAt!=='string' || typeof event.data?.id!=='string') throw Error('Invalid webhook event')
 return event
}
