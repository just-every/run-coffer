import { manager } from '../auth'
import type { Context, Row } from '../db'
import { giftRulesState } from '../gift-rules'
import { box, chip, e, empty, field, form, money, select } from './common'

const labels: Record<string, string> = { amount_call: 'Gift amount → thank-you call', first_tag: 'First gift → tag', fund_notify: 'Fund gift → team notification' }
function editor(rule: Row | null, owners: Row[]) {
 return form('giftRule.save', `${field('Rule name', 'name', 'text', rule?.name ?? '', 'required maxlength="100"')}
  ${select('Action', 'kind', Object.entries(labels), rule?.kind ?? 'amount_call')}
  <div class="fields">${field('Minimum gift (call rule)', 'minimum', 'number', rule?.minimum_cents ? (rule.minimum_cents / 100).toFixed(2) : '1000.00', 'min="0.01" step="0.01"')}
  ${select('Call owner (executive director or chosen staff)', 'ownerId', owners.map(o => [o.id, o.name] as [string, string]), rule?.owner_id ?? '')}</div>
  ${field('Tag (first gift rule)', 'tag', 'text', rule?.tag ?? '', 'maxlength="80"')}
  <div class="fields">${field('Fund (notification rule)', 'fund', 'text', rule?.fund ?? '', 'maxlength="100"')}
  ${select('Team webhook (notification rule)', 'provider', [['slack', 'Slack incoming webhook']], rule?.provider ?? 'slack')}</div>`, 'Save unpublished rule', rule ? { ruleId: rule.id, version: rule.version } : {})
}

export async function giftRulesPage(c: Context) {
 const state = await giftRulesState(c), canManage = manager(c.actor)
 const rows = state.rules.map(rule => {
  const summary = rule.kind === 'amount_call' ? `${money(rule.minimum_cents)} or more creates a thank-you call for ${state.owners.find(o => o.id === rule.owner_id)?.name ?? 'unavailable staff'}, due within 48 hours of arrival.`
   : rule.kind === 'first_tag' ? `The donor’s first recorded gift adds “${rule.tag}”.` : `A gift to ${rule.fund} notifies the installation’s configured Slack channel through its incoming webhook.`
  return `<li><h3>${e(rule.name)}</h3><p>${chip(rule.published_at ? 'Published' : 'Unpublished', rule.published_at ? 'ok' : '')} · Version ${e(rule.version)}</p><p>${e(summary)}</p>
   ${canManage ? `<details class="edit"><summary>Edit rule</summary>${editor(rule, state.owners)}</details>${rule.published_at
    ? form('giftRule.pause', '', 'Pause rule', { ruleId: rule.id, version: rule.version })
    : form('giftRule.publish', '<label><input type="checkbox" name="reviewed" value="yes" required> I reviewed this action and authorize it for new gifts, including the team notification shown above when selected.</label>', 'Publish reviewed rule', { ruleId: rule.id, version: rule.version })}` : ''}</li>`
 }).join('')
 const firings = state.firings.map(f => `<li><strong>${e(state.rules.find(r => r.id === f.rule_id)?.name ?? 'Gift rule')}</strong> · ${e(labels[f.action])} · ${chip(f.status)}<p><a href="${f.property_gift?`/app/donors/${e(f.donor_id)}#in-kind-${e(f.gift_id)}`:`/app/gifts?gift=${e(f.gift_id)}`}">Open gift</a> · Rule version ${e(f.rule_version)}${f.due_at ? ` · Call deadline ${e(f.due_at)}` : ''}</p></li>`).join('')
 return `<p>Published rules act once when a new gift arrives. Historical imports never fire rules. A backdated gift or a reversal does not make a later contribution the first gift. Thank-you calls are recorded as non-asks. Saving an edit pauses the rule until it is reviewed and published again.</p>
  ${box('Gift rules', rows ? `<ul class="list">${rows}</ul>` : empty('No gift rules yet.'), 'gift-rules')}
  ${canManage ? box('Add a rule', `${editor(null, state.owners)}<p>Team notices contain the gift amount, fund and gift ID. Configure the Slack incoming webhook privately on this installation before publishing; Slack sends to the channel authorized when that webhook was installed.</p>`) : ''}
  ${box('Recent actions', `${firings ? `<ul class="list">${firings}</ul>` : empty('No rule actions yet.')}<p>Submitted means the team webhook accepted the notice. Uncertain means its result could not be confirmed; no automatic resend is attempted. An unavailable call owner is shown for staff follow-up.</p>`)}
  ${box('First-gift tags', state.tags.length ? `<ul class="list">${state.tags.map(t => `<li><a href="/app/donors/${e(t.donor_id)}">Open donor</a> · ${e(t.tag)}</li>`).join('')}</ul>` : empty('No tags added by gift rules yet.'))}`
}
