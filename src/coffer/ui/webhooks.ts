import type { Context } from '../db'
import { webhookState, WEBHOOK_EVENTS } from '../webhooks'
import { box, e, empty, field, form, moment } from './common'

type WebhookState = Awaited<ReturnType<typeof webhookState>>
type Subscription = WebhookState['subscriptions'][number]
type Delivery = WebhookState['deliveries'][number]
type Attempt = WebhookState['attempts'][number]

const utc = (at: string) => `${e(moment(at, 'UTC'))} UTC`
const terminal = new Set(['delivered', 'exhausted', 'held'])
const labels: Record<string, string> = {
 pending: 'Queued', sending: 'Sending', failed: 'Failed', delivered: 'Delivered',
 exhausted: 'Retries exhausted', held: 'Held', uncertain: 'Delivery unconfirmed',
}

function subscriptionItem(subscription: Subscription) {
 return `<li id="webhook-endpoint-${e(subscription.id)}"><strong>${e(subscription.name)}</strong>
  <p class="muted">${subscription.enabled ? 'Active' : 'Paused'} · <code>${e(subscription.endpoint)}</code></p>
  <details><summary>Subscribed events (${subscription.events.length})</summary><ul class="list">${subscription.events.map(event => `<li><code>${e(event)}</code></li>`).join('')}</ul></details>
  ${subscription.enabled ? form('webhook.pause', '<p>Pausing stops future deliveries and automatic retries for this endpoint.</p>', 'Pause endpoint', { subscriptionId: subscription.id, version: subscription.version }, 'secondary') : ''}</li>`
}

function attemptHistory(attempts: Attempt[]) {
 if (!attempts.length) return '<p class="muted">No attempts yet.</p>'
 return `<details><summary>Attempt history (${attempts.length})</summary><ol class="steps">${attempts.map(attempt => `<li>${utc(attempt.attempted_at)}<br>${e(labels[attempt.status])}${attempt.http_status === null ? '' : ` · HTTP ${e(attempt.http_status)}`}</li>`).join('')}</ol></details>`
}

function deliveryItem(delivery: Delivery, subscription: Subscription | undefined, attempts: Attempt[]) {
 const active = !!subscription?.enabled
 const retry = !active ? 'Endpoint paused; retries stopped.' : ['pending', 'failed'].includes(delivery.status)
  ? `Next attempt: ${utc(delivery.next_at)}` : delivery.status === 'sending' ? 'Attempt in progress.' : 'No automatic retry scheduled.'
 const replay = active && terminal.has(delivery.status) ? `<details><summary>Replay this delivery</summary>${form('webhook.replay', '<label><input type="checkbox" name="reviewed" value="yes" required> I checked the receiver and approve another delivery. It may duplicate an earlier delivery; automatic retries may also produce duplicates.</label>', 'Queue replay', { deliveryId: delivery.id }, 'secondary')}</details>` : ''
 return `<tr id="webhook-delivery-${e(delivery.id)}"><td class="lead"><strong>${e(delivery.endpoint_name)}</strong><br><code>${e(delivery.event_type)}</code>
  <p class="muted">Delivery <code>${e(delivery.id)}</code></p>
  <details><summary>Event details</summary><p>Event <code>${e(delivery.event_id)}</code><br>Record <code>${e(delivery.subject_id)}</code><br>${utc(delivery.occurred_at)}</p></details>
  ${delivery.replay_of ? `<p>Replay of <code>${e(delivery.replay_of)}</code></p>` : ''}</td>
  <td data-label="Outcome"><strong>${e(labels[delivery.status])}</strong><p>${e(delivery.attempts)} attempts${delivery.last_status === null ? '' : ` · Last HTTP ${e(delivery.last_status)}`}</p><p>${retry}</p></td>
  <td data-label="Attempts">${attemptHistory(attempts)}</td><td data-label="Action">${replay}</td></tr>`
}

export async function webhookPage(c: Context) {
 const data = await webhookState(c)
 const subscriptions = new Map(data.subscriptions.map(subscription => [subscription.id, subscription]))
 const attempts = new Map<string, Attempt[]>()
 for (const attempt of data.attempts) {
  const history = attempts.get(attempt.delivery_id) ?? []
  history.push(attempt)
  attempts.set(attempt.delivery_id, history)
 }
 for (const history of attempts.values()) history.sort((a, b) => a.attempted_at.localeCompare(b.attempted_at))
 const create = form('webhook.subscribe', `
  ${field('Endpoint name', 'name', 'text', '', 'required maxlength="100" autocomplete="off"')}
  ${field('Endpoint URL', 'endpoint', 'url', '', 'required maxlength="2000" pattern="https://.*" placeholder="https://receiver.example.test/events" aria-describedby="webhook-endpoint-help"')}
  <p id="webhook-endpoint-help" class="muted">Use an HTTPS address that you control.</p>
  <fieldset><legend>Events to send</legend>${WEBHOOK_EVENTS.map(event => `<label><input type="checkbox" name="events" value="${e(event)}"> ${e(event)}</label>`).join('')}</fieldset>
  <label><input type="checkbox" name="reviewed" value="yes" required> I approve sending event types, record identifiers and timestamps to this endpoint, with ongoing automatic retries. No donor contact details or gift amounts are included. Deliveries may arrive more than once.</label>`, 'Connect endpoint')
 return `<p><a href="/app/settings">Back to Settings</a></p>
  ${box('Endpoints', data.subscriptions.length ? `<ul class="list">${data.subscriptions.map(subscriptionItem).join('')}</ul>` : empty('No endpoints connected yet. Connect your first endpoint below.'), 'webhook-endpoints')}
  ${box('Connect an endpoint', data.subscriptions.length ? `<details class="edit"><summary>Add an endpoint</summary>${create}</details>` : create, 'webhook-connect')}
  ${box('Delivery log', `<p>Receivers must deduplicate using the event ID. Automatic retries and manual replays can deliver the same event more than once.</p>${data.deliveries.length ? `<div class="scroll"><table class="stack"><thead><tr><th>Endpoint and event</th><th>Outcome and next attempt (UTC)</th><th>Attempt history</th><th>Action</th></tr></thead><tbody>${data.deliveries.map(delivery => deliveryItem(delivery, subscriptions.get(delivery.subscription_id), attempts.get(delivery.id) ?? [])).join('')}</tbody></table></div>` : empty('No deliveries yet. New matching events will appear here.')}`, 'webhook-deliveries')}`
}

export function webhookSecretPage(secret: string) {
 return box('Endpoint connected', `<p>Copy this signing secret into your receiver now. It will not be shown again. Keep it private and use it to verify incoming webhook signatures.</p>
  ${field('Signing secret', 'signingSecret', 'text', secret, 'readonly data-webhook-secret autocomplete="off" spellcheck="false"')}
  <p><a class="button" href="/app/webhooks">Back to webhooks</a></p>`, 'webhook-secret-result')
}
