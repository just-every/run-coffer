import type { Row } from './db'

/** Shared frozen addressee and address, in mailing order for every format. */
export function postalLines(letter: Row): string[] {
 const address: Row = typeof letter.address === 'string' ? JSON.parse(letter.address || '{}') : letter.address ?? {}
 const locality = [address.city, address.region, address.postalCode].filter(Boolean).join(' ')
 return [letter.recipient_name, address.line1, address.line2, locality, address.country]
  .filter(Boolean).flatMap(value => String(value).replace(/\r\n?/g, '\n').split('\n'))
}

export type PrintFormat = 'letters' | 'labels' | 'envelopes'

export function download(bytes: Uint8Array, contentType: string, filename: string): Response {
 const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
 return new Response(bytes as BodyInit, { headers: {
  'content-type': contentType,
  'content-disposition': `attachment; filename="${safeName}"`,
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
 } })
}
