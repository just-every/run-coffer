/** Verify before parsing or applying effects. The receiver must atomically store
 * the returned event ID with its business effect in its own durable database. */
export async function verifyWebhook(secret, signature, body, now = Date.now()) {
 const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(signature ?? '')
 if (!match || !Number.isSafeInteger(Number(match[1])) || Math.abs(now / 1000 - Number(match[1])) > 300) throw Error('Invalid or stale webhook signature')
 const bytes = value => new TextEncoder().encode(value)
 const key = await crypto.subtle.importKey('raw', bytes(secret), {name:'HMAC',hash:'SHA-256'}, false, ['verify'])
 const digest = Uint8Array.from(match[2].match(/../g), value => parseInt(value,16))
 if (!await crypto.subtle.verify('HMAC',key,digest,bytes(match[1]+'.'+body))) throw Error('Invalid webhook signature')
 const event = JSON.parse(body)
 if (!event || typeof event.id!=='string' || !event.id || typeof event.type!=='string' || typeof event.occurredAt!=='string' || typeof event.data?.id!=='string') throw Error('Invalid webhook event')
 return event
}
