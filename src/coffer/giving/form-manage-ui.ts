import { givingFormResponsesPanel } from './form-responses'
import { requireRole } from '../auth'
import { all, fail, one, type Context, type Row } from '../db'
import { area, box, e, field, hidden, select } from '../ui/common'
import { getGivingForm } from './form-configuration'

export async function givingFormsSettings(c: Context) {
 requireRole(c.actor, ['owner', 'admin'], 'configure giving forms')
 const campaigns = await all(c, 'SELECT id,name,active FROM cf_campaigns ORDER BY name')
 return box('Donation forms', campaigns.length ? `<ul class="list">${campaigns.map(row => `<li><a href="/app/settings/giving-forms/${encodeURIComponent(row.id)}">${e(row.name)}</a>${row.active ? '' : ' · Draft'}</li>`).join('')}</ul>` : '<p>Publish a campaign in Giving, then configure its donation form here.</p>')
}

export async function givingFormSettings(c: Context, id: string, saved = false) {
 requireRole(c.actor, ['owner', 'admin'], 'configure giving forms')
 const campaign = await one(c, 'SELECT * FROM cf_campaigns WHERE id=?', id)
 if (!campaign) fail('NOT_FOUND', 'Choose a campaign.', 404)
 const config = await getGivingForm(c, campaign)
 const fields = await all(c, "SELECT * FROM cf_custom_fields WHERE kind IN ('constituent','gift') ORDER BY label")
 const image = await one(c, "SELECT description FROM cf_campaign_media WHERE campaign_id=? AND kind='image'", id)
 const question = (f: Row) => {
  const q = config.questions.find((value: Row) => value.key === f.key)
  return `<fieldset><legend>${e(f.label)} · ${e(f.kind)}</legend><label><input type="checkbox" name="question.${e(f.key)}" value="yes"${q ? ' checked' : ''}> Publish this question on the giving form</label>${field('Question for ' + f.label, 'label.' + f.key, 'text', q?.label ?? f.label, 'maxlength="200"')}<label><input type="checkbox" name="required.${e(f.key)}" value="yes"${q?.required ? ' checked' : ''}> Require an answer</label></fieldset>`
 }
 const embed = `<script src="${c.env!.AUTH_ORIGIN}/give/${campaign.slug}/embed.js" async></script>`
 return `<p><a href="/app/settings/giving-forms">Donation forms</a> · <a href="/give/${e(campaign.slug)}">Open hosted form</a></p>${box(campaign.name + ' donation form', `<form method="post" action="/app/settings/giving-forms/${encodeURIComponent(id)}" data-giving-form-settings>${hidden('version', config.version)}<p role="status" aria-live="polite" data-form-status>${saved ? 'Saved' : ''}</p>${field('Form heading', 'headline', 'text', config.headline, 'required maxlength="120"')}${area('Form copy', 'body', config.body, 'required maxlength="2000" aria-label="Form copy"')}${select('Form logo', 'logoUrl', [['', 'No logo'], ...(image ? [['/give/' + campaign.slug + '/media/image', 'Use the campaign image as the logo'] as [string, string]] : [])], config.logoUrl ?? '', 'aria-label="Form logo"')}${image ? '' : '<p>Add a public campaign image when publishing the campaign to use it as the form logo.</p>'}<div class="fields">${field('Button color', 'primaryColor', 'text', config.primaryColor)}${field('Page background', 'backgroundColor', 'text', config.backgroundColor)}${field('Page text', 'textColor', 'text', config.textColor)}</div>${field('Suggested amounts (USD, comma separated)', 'suggestedAmounts', 'text', config.suggestedAmountsCents.map((n: number) => (n / 100).toFixed(2)).join(', '), 'required')}${area('Designations (one fund per line)', 'designations', config.designations.join('\n'), 'required rows="3" aria-label="Designations (one fund per line)"')}<label><input type="checkbox" name="employerEnabled" value="yes"${config.employerEnabled ? ' checked' : ''}> Ask for an employer</label><label><input type="checkbox" name="commentEnabled" value="yes"${config.commentEnabled ? ' checked' : ''}> Allow a comment</label><details><summary>Custom questions</summary><p>Only selected question labels and choices become public. Answers stay private in Coffer. Existing constituent values are preserved; each submitted answer remains with its gift.</p>${fields.map(question).join('') || '<p>Define constituent or gift fields in Settings first.</p>'}</details><noscript><button>Save donation form</button></noscript></form>`)}${box('Embed on your website', `<p>Add this script in an HTML block on Pane, WordPress, Squarespace or another website. Your campaign’s current form appears there.</p><label>Embed script<textarea aria-label="Embed script" readonly rows="3">${e(embed)}</textarea></label>`)}${await givingFormResponsesPanel(c,id)}<script src="/giving/form-settings.js" defer></script>`
}

export function givingFormSettingsInput(values: URLSearchParams): Row {
 const data: Row = Object.fromEntries(values)
 return {...data, employerEnabled: data.employerEnabled === 'yes', commentEnabled: data.commentEnabled === 'yes',
  suggestedAmounts: String(data.suggestedAmounts ?? '').split(',').map(v => v.trim()).filter(Boolean),
  designations: String(data.designations ?? '').split(/\r?\n/).map(v => v.trim()).filter(Boolean),
  questions: [...values.keys()].filter(k => k.startsWith('question.')).map(k => ({key: k.slice(9), label: data['label.' + k.slice(9)], required: data['required.' + k.slice(9)] === 'yes'}))}
}
