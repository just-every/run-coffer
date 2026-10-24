import type { Bindings } from '../auth.server'
// @ts-expect-error The shared JavaScript mail sender validates its own inputs.
import { createMailSender } from '../modules/mail/index.mjs'
import { sendSendGrid, SendGridSendError } from '../modules/mail/src/sendgrid-email/index.mjs'

export { SendGridSendError as DonorMailError }
type Message = Parameters<typeof sendSendGrid>[0]['message']

/** Validate the configured provider before claiming any donor submission. */
export function donorMailUnavailable(env?: Bindings): string | null {
 if (!env) return 'Configure a mail provider and sender address to send email.'
 if (env.AUTH_LOCAL === 'true' || env.RER_DEMO === '1' || env.MAIL_PROVIDER === 'development') return 'Email is suppressed in local and demo mode. No email is sent.'
 if (!['sendgrid', 'resend', 'cloudflare', 'rer'].includes(env.MAIL_PROVIDER ?? '') || !env.MAIL_FROM?.trim()) return 'Configure a mail provider and sender address to send email.'
 if (env.MAIL_PROVIDER === 'rer' && (env.COFFER_REPLY_ADDRESS?.trim() || env.COFFER_REPLY_DOMAIN?.trim())) return 'Managed mail cannot carry a custom reply address. Remove that setting before sending.'
 try { sender(env) } catch { return 'Complete this installation’s mail provider settings before sending email.' }
 return null
}

function sender(env: Bindings) {
 return createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY,
  ...(env.MAIL_PROVIDER === 'rer' ? { relayUrl: env.MAIL_RELAY_URL } : {}),
  ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) })
}

/** One attempt, with the durable attempt ID also binding a Managed relay message. */
export async function sendDonorMail(env: Bindings, message: Message): Promise<{ providerMessageId: string | null }> {
 if (env.MAIL_PROVIDER === 'sendgrid') return sendSendGrid({ apiKey: env.MAIL_API_KEY!, message })
 const { customArgs: _customArgs, ...content } = message
 let result
 try {
  result = await sender(env).send({ ...content, ...(env.MAIL_PROVIDER === 'rer' ? { messageKey: message.deliveryId } : {}) })
 } catch {
  throw new SendGridSendError('rejected', 'Mail configuration or message is unsupported. No email was submitted.')
 }
 if (result.status === 'accepted') return { providerMessageId: result.providerMessageId }
 throw new SendGridSendError(result.status === 'uncertain' ? 'ambiguous' : result.status, 'Mail submission was not confirmed.')
}
