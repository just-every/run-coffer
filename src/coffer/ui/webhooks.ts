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

const networkLabels: Record<string,string> = {
 dns_nonpublic: 'DNS preflight refused a nonpublic address. No target request was sent.',
 dns_alias_unsafe: 'DNS preflight refused an unsafe or inconsistent alias chain. No target request was sent.',
 dns_incomplete: 'DNS preflight could not establish complete public address resolution. No target request was sent.',
 dns_malformed: 'DNS preflight received an invalid resolution response. No target request was sent.',
 dns_unavailable: 'DNS preflight was unavailable. No target request was sent.',
}
const networkOutcome = (code: string | null) => code ? `<p>${e(networkLabels[code] ?? 'DNS preflight refused this attempt. No target request was sent.')}</p>` : ''

function subscriptionItem(subscription: Subscription) {
 const values={subscriptionId:subscription.id,version:subscription.version}
 const approval=(label:string)=>`<label><input type="checkbox" name="reviewed" value="yes" required> ${label}</label>`
 const manage=!subscription.key_available ? form('webhook.recover',`<p>This installation cannot open the old signing key. Recovery creates a fresh key and pauses this endpoint. The old key cannot be recovered. Install the fresh key at the receiver, then approve resuming future events. Held history requires reviewed replay.</p>${approval('I approve replacing unreadable key material with a fresh key and pausing this endpoint.')}`,'Approve fresh key',values,'secondary') : `
  ${!subscription.enabled?form('webhook.resume',`<p>Resume future matching events with current approval. Held deliveries stay held until reviewed replay.</p>${approval('I installed the current signing key and approve future deliveries and retries.')}`,'Resume endpoint',values,'secondary'):''}
  ${subscription.previous_key?form('webhook.retireOverlap',`<p>Previous-key signing ends ${utc(subscription.overlap_until)}. Already submitted requests may still arrive.</p>${approval('I approve retiring the previous signing key now.')}`,'Retire previous key',values,'secondary'):''}
  ${form('webhook.rotate',`<p>Keep this endpoint and its history. Copy the new signing key once. An overlap signs each request with both keys for the chosen period. Retire an active overlap before rotating again.</p>${field('Overlap minutes','overlapMinutes','number',0,'required min="0" max="1440" step="1"')}${approval('I approve a fresh signing key and the selected overlap period.')}`,'Rotate signing key',values,'secondary')}`
 return `<li id="webhook-endpoint-${e(subscription.id)}"><strong>${e(subscription.name)}</strong>
  <p class="muted">${!subscription.key_available?'Signing key unavailable':!subscription.enabled ? 'Paused' : subscription.approved ? 'Active' : 'Approval changed — pause and approve resuming'} · <code>${e(subscription.endpoint)}</code></p>
  <details><summary>Subscribed events (${subscription.events.length})</summary><ul class="list">${subscription.events.map(event => `<li><code>${e(event)}</code></li>`).join('')}</ul></details>
  ${subscription.enabled ? form('webhook.pause', '<p>Pausing stops future deliveries and automatic retries for this endpoint.</p>', 'Pause endpoint', values, 'secondary') : ''}
  <details><summary>Manage signing keys</summary><p>Signing key generation ${e(subscription.key_generation)}.</p>${manage}</details></li>`
}

function attemptHistory(attempts: Attempt[]) {
 if (!attempts.length) return '<p class="muted">No attempts yet.</p>'
 return `<details><summary>Attempt history (${attempts.length})</summary><ol class="steps">${attempts.map(attempt => `<li>${utc(attempt.attempted_at)}<br>${e(labels[attempt.status])}${networkOutcome(attempt.failure_code)}${attempt.http_status === null ? '' : ` · HTTP ${e(attempt.http_status)}`}</li>`).join('')}</ol></details>`
}

function deliveryItem(delivery: Delivery, subscription: Subscription | undefined, attempts: Attempt[], subscriptions: Subscription[]) {
 const active = !!subscription?.enabled && !!subscription?.approved && !!subscription?.key_available
 const retry = !active ? 'Endpoint paused; retries stopped.' : ['pending', 'failed'].includes(delivery.status)
  ? `Next attempt: ${utc(delivery.next_at)}` : delivery.status === 'sending' ? 'Attempt in progress.' : 'No automatic retry scheduled.'
 const replay = active && terminal.has(delivery.status) ? `<details><summary>Replay this delivery</summary>${form('webhook.replay', '<label><input type="checkbox" name="reviewed" value="yes" required> I checked the receiver and approve another delivery. It may duplicate an earlier delivery; automatic retries may also produce duplicates.</label>', 'Queue replay', { deliveryId: delivery.id }, 'secondary')}</details>` : ''
 const targets=subscriptions.filter(s=>s.id!==delivery.subscription_id&&s.enabled&&s.approved&&s.key_available&&s.events.includes(delivery.event_type))
 const migrate=terminal.has(delivery.status)&&targets.length?`<details><summary>Replay to replacement</summary>${targets.map(target=>form('webhook.migrateReplay',`<p><strong>${e(target.name)}</strong><br><code>${e(target.endpoint)}</code></p><p>The original history stays here. The same event ID goes to this endpoint; this may duplicate an earlier effect.</p><label><input type="checkbox" name="reviewed" value="yes" required> I reviewed this replacement receiver and approve disclosing the event there, including possible duplicate effects.</label>`,'Queue replacement replay',{deliveryId:delivery.id,subscriptionId:target.id,version:target.version},'secondary')).join('')}</details>`:''
 return `<tr id="webhook-delivery-${e(delivery.id)}"><td class="lead"><strong>${e(delivery.endpoint_name)}</strong><br><code>${e(delivery.event_type)}</code>
  <p class="muted">Delivery <code>${e(delivery.id)}</code></p>
  <details><summary>Event details</summary><p>Event <code>${e(delivery.event_id)}</code><br>Record <code>${e(delivery.subject_id)}</code><br>${utc(delivery.occurred_at)}</p></details>
  ${delivery.replay_of ? `<p>Replay of <code>${e(delivery.replay_of)}</code></p>` : ''}</td>
  <td data-label="Outcome"><strong>${e(labels[delivery.status])}</strong>${networkOutcome(delivery.last_failure_code)}<p>${e(delivery.attempts)} attempts${delivery.last_status === null ? '' : ` · Last HTTP ${e(delivery.last_status)}`}</p><p>${retry}</p></td>
  <td data-label="Attempts">${attemptHistory(attempts)}</td><td data-label="Action">${replay}${migrate}</td></tr>`
}

export async function webhookPage(c: Context, before?: string | null) {
 const data = await webhookState(c,before)
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
  ${box('Delivery log', `<details><summary>Delivery and retention policy</summary><p>History stays in this installation until the associated donor is erased. Archives exclude webhook keys, approvals and history. Manage signing keys on each endpoint for rotation, bounded overlap or fresh-key recovery. Recovery cannot disclose an old key after the installation session secret changes. Reviewed replacement replay retains original history and event identity.</p></details><p>DNS preflight checks both address families before submission. It does not pin the connection address or establish live public-network enforcement.</p><p>Receivers must verify the signature timestamp is within five minutes of their current clock and deduplicate using the event ID. Automatic retries and manual replays can deliver the same event more than once.</p>${data.deliveries.length ? `<div class="scroll"><table class="stack"><thead><tr><th>Endpoint and event</th><th>Outcome and next attempt (UTC)</th><th>Attempt history</th><th>Action</th></tr></thead><tbody>${data.deliveries.map(delivery => deliveryItem(delivery, subscriptions.get(delivery.subscription_id), attempts.get(delivery.id) ?? [],data.subscriptions)).join('')}</tbody></table></div>` : empty('No deliveries yet. New matching events will appear here.')}`, 'webhook-deliveries')}<nav aria-label="Delivery history">${before?'<a href="/app/webhooks">Newest deliveries</a> ':''}${data.nextCursor?`<a href="/app/webhooks?before=${encodeURIComponent(data.nextCursor)}">Older deliveries</a>`:''}</nav>`
}

export function webhookSecretPage(secret: string) {
 return box('Signing key ready', `<p>Copy this signing secret into your receiver now. It will not be shown again. Keep it private and use it to verify incoming webhook signatures. Fresh-key recovery leaves the endpoint paused until you approve resuming it.</p>
  ${field('Signing secret', 'signingSecret', 'text', secret, 'readonly data-webhook-secret autocomplete="off" spellcheck="false"')}
  <p><a class="button" href="/app/webhooks">Back to webhooks</a></p>`, 'webhook-secret-result')
}
