import { textGivingSettings } from './connections-ui'
import type { Context } from '../db'
import { box, chip, e, guide } from '../ui/common'
import { managed, stripe, type GivingEnv } from './stripe'

/** Every Stripe event Coffer acts on: online giving, monthly plans, payments and payouts. */
export const WEBHOOK_EVENTS: [string, string[]][] = [
 ['Checkout', ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed']],
 ['Invoices (monthly gifts)', ['invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.updated']],
 ['Subscriptions (monthly gifts)', ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']],
 ['Charges and refunds', ['charge.succeeded', 'charge.updated', 'charge.refunded', 'charge.failed', 'refund.created', 'refund.updated', 'refund.failed', 'payment_intent.payment_failed']],
 ['Disputes', ['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated']],
 ['Payouts', ['payout.created', 'payout.updated', 'payout.paid', 'payout.failed', 'payout.canceled', 'payout.reconciliation_completed']],
]
const allEvents = WEBHOOK_EVENTS.flatMap(([, events]) => events)
const keyMode = (key?: string) => !key?.trim() ? null : /^(sk|rk)_live_/.test(key.trim()) ? 'live' : /^(sk|rk)_test_/.test(key.trim()) ? 'test' : 'unknown'

/** A workers.dev address names its Worker; a custom domain does not, so the page says which name to use. */
function hosted(origin: string) {
 const host = new URL(origin).hostname, worker = host.endsWith('.workers.dev') ? host.split('.')[0] : ''
 const environment = worker.startsWith('coffer-') ? worker.slice('coffer-'.length) : ''
 return environment ? { worker, environment, known: true } : { worker: 'coffer-YOUR-ENVIRONMENT', environment: 'YOUR-ENVIRONMENT', known: false }
}

const commands = (lines: string[]) => `<pre><code>${lines.map(e).join('\n')}</code></pre>`

function saveKeys(env: GivingEnv, names: string[]) {
 const local = env.AUTH_LOCAL === 'true'
 if (local) return `<p>Coffer on this computer reads its private settings file, <code>.dev.vars</code>, in the Coffer folder: <code>run-coffer</code> if you started with <code>rer dev just-every/run-coffer</code>, otherwise the folder you cloned. In a terminal in that folder, run these lines. Each <code>read</code> waits for you to paste a value and press Enter; nothing shows while you paste, and the value never goes into your command history.</p>
 ${commands(['rer dev --stop', ...names.flatMap(name => [`read -rs ${name}`, `(umask 077; grep -v '^${name}=' .dev.vars > .dev.vars.new; echo "${name}=$${name}" >> .dev.vars.new; mv .dev.vars.new .dev.vars)`]), 'rer dev'])}
 <p>The last line starts Coffer again with the new settings. Come back to this page: the status above changes to connected.</p>`
 const target = hosted(env.AUTH_ORIGIN)
 return `<p>Your hosted Coffer keeps these as secrets of its Cloudflare Worker, <strong>${e(target.worker)}</strong>. In a terminal in the Coffer folder you deployed from, with the same Cloudflare settings you used for <code>rer deploy</code>, run these lines. Each <code>read</code> waits for you to paste a value and press Enter; nothing shows while you paste, and the value never goes into your command history.</p>
 ${commands([...names.map(name => `read -rs ${name} && export ${name}`), `rer deploy --environment ${target.environment} --set-secret ${names.join(',')}`])}
 ${target.known ? '' : `<p class="muted">Replace <code>YOUR-ENVIRONMENT</code> with the name you passed to <code>rer deploy --environment</code>. Without one it is <code>production</code>.</p>`}
 <p><code>rer deploy --set-secret</code> changes only these secrets, in one new version of the Worker, and waits until it is live. No rebuild and no data change. Reload this page afterwards.</p>`
}

export async function givingSetupPage(c: Context, check?: Record<string, any>) {
 const env = c.env as GivingEnv, owner = c.actor.role === 'owner' || c.actor.role === 'admin'
 const intro = `<p>Stripe is the payment company that takes card, Link and Apple Pay gifts on your campaign pages and runs monthly gifts. Donors pay on Stripe’s own secure page, so card numbers never reach Coffer. Stripe sends each gift to your bank account, and Coffer records it on the donor’s record, matches it to the campaign and reconciles your payouts. Stripe charges its own processing fees; Coffer adds none.</p>`
 if (managed(env)) return intro + box('Not available yet on RER Managed', '<p>Stripe is not available yet on RER Managed. Your campaign pages stay visible; donors cannot check out until it is. A self-hosted Coffer connects Stripe today.</p>')
 const mode = keyMode(env.STRIPE_SECRET_KEY), webhook = Boolean(env.STRIPE_WEBHOOK_SECRET?.trim()), local = env.AUTH_LOCAL === 'true'
 const endpoint = `${env.AUTH_ORIGIN}/api/coffer/giving/webhook`
 const status = box('Connection', `<ul class="list"><li>Secret key ${mode === 'live' ? chip('Live mode', 'ok') : mode === 'test' ? chip('Test mode', 'info') : mode ? chip('Saved, not a Stripe secret key', 'warn') : chip('Not connected', 'warn')}</li><li>Webhook signing secret ${webhook ? chip('Saved', 'ok') : chip(local ? 'Optional on this computer' : 'Not saved', local ? '' : 'warn')}</li></ul>
 ${mode && owner ? `<form method="post" action="/app/giving/setup/check"><p>Ask Stripe whether this key works and whether your webhook is set up.</p><button class="secondary">Check with Stripe</button></form>` : ''}${check ? checkResult(check, endpoint, mode === 'live', local) : ''}`)
 const keys = box('1. Get your Stripe keys', `<ol class="steps"><li>Sign in at <a href="https://dashboard.stripe.com">dashboard.stripe.com</a>, or create a free account there for your organization.</li>
 <li>Start in test mode: turn on <strong>Test mode</strong> (or open your <strong>sandbox</strong>) at the top of the Stripe Dashboard. Test payments use card number <code>4242 4242 4242 4242</code> and move no money.</li>
 <li>Open <strong>Developers → API keys</strong>. Under <strong>Standard keys</strong>, choose <strong>Reveal</strong> next to <strong>Secret key</strong> and copy it. A test key starts <code>sk_test_</code>.</li>
 <li>When you are ready for real gifts, finish Stripe’s account activation, turn test mode off and copy the live secret key, which starts <code>sk_live_</code>. Save it the same way (step 3) in place of the test key.</li></ol>
 <p class="muted">The secret key lets Coffer create checkout pages and read your payments. Keep it private: never email it or paste it into a document.</p>`)
 const hooks = box('2. Tell Stripe where to send payment updates', `<p>Stripe confirms each payment, monthly renewal, failed card, refund and payout by sending a message (a webhook) to Coffer.</p>${local ? `<p><strong>On this computer this step is optional.</strong> Stripe cannot reach a computer at home, and the thank-you page already records each one-time and first monthly gift. To also see renewals and refunds while testing, install the <a href="https://docs.stripe.com/stripe-cli">Stripe CLI</a>, run <code>stripe listen --forward-to ${e(endpoint)}</code>, and save the <code>whsec_</code> secret it prints as <code>STRIPE_WEBHOOK_SECRET</code> in step 3. Skip the Dashboard steps below on this computer: they are for your hosted Coffer, whose address Stripe can reach.</p>` : ''}
 <ol class="steps"${local ? ' hidden' : ''}><li>In the Stripe Dashboard (same mode as your key), open <strong>Developers → Webhooks</strong> and choose <strong>Add endpoint</strong> (or <strong>Add destination</strong>, then <strong>Webhook endpoint</strong>).</li>
 <li>Endpoint URL: <code>${e(endpoint)}</code></li><li>Events from <strong>your account</strong>. Select these ${allEvents.length} events (search each name):<ul class="list">${WEBHOOK_EVENTS.map(([group, events]) => `<li><strong>${e(group)}</strong><br>${events.map(name => `<code>${e(name)}</code>`).join(', ')}</li>`).join('')}</ul></li>
 <li>Leave the API version at Stripe’s default and save. Coffer reads each payment’s current state from Stripe itself, so the version of the message does not matter.</li>
 <li>Open the new endpoint, choose <strong>Reveal</strong> under <strong>Signing secret</strong> and copy it. It starts <code>whsec_</code>. Coffer refuses messages that are not signed with it.</li></ol>`)
 const save = box('3. Save the keys in Coffer', owner ? saveKeys(env, local ? ['STRIPE_SECRET_KEY'] : ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) + (local ? `<p class="muted">To save a webhook secret from the Stripe CLI too, run the same lines with <code>STRIPE_WEBHOOK_SECRET</code> in place of <code>STRIPE_SECRET_KEY</code>.</p>` : '') : '<p>An owner or admin saves the keys.</p>')
 const after = box('4. Take a test gift', `<ol class="steps"><li><a href="/app/giving">Publish a campaign</a> and open its page.</li><li>Give $25 with card <code>4242 4242 4242 4242</code>, any future date and any three-digit code.</li><li>The gift appears on the donor’s record and in the campaign total. ${local ? '' : 'Webhook messages also show under the endpoint in Stripe.'}</li></ol><p>Switching to live mode later: repeat steps 1–3 with live keys and a live-mode webhook.</p><p><a href="${guide('online-giving')}">Online giving guide</a> · <a href="${guide('payments')}">Payouts and accounting guide</a></p>`)
 return `${intro}<div class="grid wide"><div>${keys}${hooks}${save}</div><div>${status}${after}</div></div>` + await textGivingSettings(c)
}

function checkResult(check: Record<string, any>, endpoint: string, live: boolean, local: boolean) {
 if (check.error) return `<p class="alert" role="alert">${e(check.error)}</p>`
 const a = check.account, found = check.endpoint, missing: string[] = found ? (found.enabled_events.includes('*') ? [] : allEvents.filter(name => !found.enabled_events.includes(name))) : allEvents
 return `<div class="notice" role="status"><p><strong>Stripe accepted the key.</strong> Account ${e(a.settings?.dashboard?.display_name || a.business_profile?.name || a.id)} · ${e(String(a.country ?? ''))} · default currency ${e(String(a.default_currency ?? '').toUpperCase())}${live && a.charges_enabled === false ? ' · live card payments are not activated yet: finish activation in Stripe' : ''}.</p>
 ${String(a.default_currency ?? 'usd').toLowerCase() !== 'usd' ? '<p>Coffer charges donors in US dollars. Stripe converts them to your account’s currency when it pays out.</p>' : ''}
 <p>${found ? `Webhook for <code>${e(endpoint)}</code>: ${found.status === 'enabled' ? chip('Enabled', 'ok') : chip(found.status, 'warn')} ${missing.length ? `${missing.length} events still to add: ${missing.map(name => `<code>${e(name)}</code>`).join(', ')}` : 'all events selected.'}` : local ? 'No webhook is needed on this computer: the thank-you page records each gift. Use the Stripe CLI line in step 2 only to test renewals and refunds.' : `No webhook in this Stripe mode sends to <code>${e(endpoint)}</code> yet. Follow step 2.`}</p></div>`
}

/** Read-only: the account and this installation's webhook endpoint, never the key itself. */
export async function checkStripe(c: Context) {
 const env = c.env as GivingEnv
 try {
  const account = await stripe(env, '/account')
  const endpoints = await stripe<{ data: any[] }>(env, '/webhook_endpoints?limit=100')
  return { account, endpoint: endpoints.data.find(item => item.url === `${env.AUTH_ORIGIN}/api/coffer/giving/webhook`) ?? null }
 } catch (error: any) {
  return { error: error?.status === 503 ? error.message : 'Stripe did not accept this key. Copy the secret key again from Developers → API keys and save it (step 3).' }
 }
}
