import type { Row } from '../db'
import { IN_KIND_FIELDS, TEMPLATE_KINDS, TEMPLATE_LABELS, YEAR_END_FIELDS, type TemplateKind } from '../letter-templates'
import { LETTER } from '../settings'
import { area, box, e, field, form, money, select } from './common'

const fields = (list: string[]) => list.map(f => `{{${f}}}`).join(', ')

/** Which reviewed wording a letter used, as recorded when it was prepared. */
export const templateLabel = (l: Row) => l.template_kind ? `${TEMPLATE_LABELS[l.template_kind as TemplateKind | 'default'] ?? l.template_kind} template v${l.template_version}` : ''

function templateForm(t: Row | null, campaigns: Row[]) {
 const kind = t ? `<p><strong>${e(TEMPLATE_LABELS[t.kind as TemplateKind])}</strong>${t.campaign_name ? ` · ${e(t.campaign_name)}` : ''}</p>`
  : `${select('Template kind', 'kind', TEMPLATE_KINDS.map(k => [k, TEMPLATE_LABELS[k]] as [string, string]))}${campaigns.length ? select('Form or campaign (form or campaign templates only)', 'campaignId', [['', 'Not a form or campaign template'], ...campaigns.map(c => [c.id, c.name] as [string, string])]) : ''}`
 const min = !t || t.kind === 'major_gift' ? field('Major gift minimum (USD; major gift templates only)', 'minAmount', 'text', t?.min_cents ? (t.min_cents / 100).toFixed(2) : '', 'inputmode="decimal"') : ''
 return form('letterTemplate.save', `<div class="fields">${kind}${field('Template name', 'name', 'text', t?.name ?? '', 'required maxlength="100"')}${min}${field('Subject', 'subject', 'text', t?.subject ?? '', 'required maxlength="200"')}</div>${area('Letter', 'body', t?.body ?? '', 'required rows="10"')}`,
  t ? 'Save template' : 'Add template', t ? { templateId: t.id, version: t.version } : {})
}

export function letterTemplatesBox(templates: Row[], campaigns: Row[]) {
 const list = templates.map(t => `<li><details><summary><strong>${e(t.name)}</strong> · ${e(TEMPLATE_LABELS[t.kind as TemplateKind])}${t.campaign_name ? ` · ${e(t.campaign_name)}` : ''}${t.min_cents ? ` · ${money(t.min_cents)} or more` : ''} · version ${t.version}</summary>${templateForm(t, campaigns)}${form('letterTemplate.retire', '', 'Retire template', { templateId: t.id, version: t.version })}</details></li>`).join('')
 return box('Thank-you templates', `<p class="muted">A gift letter uses the first template that applies: its form or campaign, a tribute gift, a major gift at or above the minimum, the donor’s first unreversed gift, then the first installment of a recurring plan. Otherwise it uses the letter above. Each letter records the template and version it used.</p>
 <p class="muted">Gift templates use ${fields(LETTER)} and must include the donor’s name, amount, gift date, goods-or-services statement, organization and EIN. In-kind templates use ${fields(IN_KIND_FIELDS)} and never a value. Year-end templates use ${fields(YEAR_END_FIELDS)} and must include the year, gift list, totals, donor’s name, goods-or-services statement, organization and EIN. Name parts and salutations are optional.</p>
 ${list ? `<ul class="list">${list}</ul>` : '<p>No thank-you templates yet.</p>'}<details><summary>Add a template</summary>${templateForm(null, campaigns)}</details>`, 'thank-you-templates')
}
