import { CONTRIBUTION_TEMPLATE_FIELDS, checkContributionTemplate, contributionReceiptKind, renderContributionReceipt, withContributionTypes } from './contribution-receipts'
import { NAME_MERGE_FIELDS } from './person-names'
import { CONTACT_MERGE_FIELDS } from './template-fields'
import { all, choice, commit, event, fail, guard, id, integer, longText, newId, one, sql, text, type Context, type Row, type Stmt } from './db'
import { amount } from './money'
import { checkTemplate, LETTER, LETTER_REQUIRED, renderLetter, type Settings } from './settings'

/** Gift-letter kinds in selection precedence: the first that applies wins. */
export const GIFT_TEMPLATE_KINDS = ['daf', 'qcd', 'campaign', 'tribute', 'major_gift', 'first_gift', 'recurring_start'] as const
export const TEMPLATE_KINDS = ['stock', ...GIFT_TEMPLATE_KINDS, 'in_kind', 'year_end'] as const
export type TemplateKind = typeof TEMPLATE_KINDS[number]
export const TEMPLATE_LABELS: Record<TemplateKind | 'default', string> = {
 stock: 'Publicly traded stock', daf: 'DAF sponsor grant', qcd: 'IRA distribution',
 campaign: 'Form or campaign', tribute: 'Tribute gift', major_gift: 'Major gift', first_gift: 'First gift', recurring_start: 'Recurring start',
 in_kind: 'In-kind gift', year_end: 'Year-end statement', default: 'Settings letter',
}
export const IN_KIND_FIELDS = [...NAME_MERGE_FIELDS, ...CONTACT_MERGE_FIELDS, 'date', 'donor_name', 'gift_date', 'description', 'quantity', 'goods_statement', 'organization', 'ein']
export const YEAR_END_FIELDS = [...NAME_MERGE_FIELDS, ...CONTACT_MERGE_FIELDS, 'date', 'donor_name', 'year', 'gift_list', 'total', 'goods_total', 'deductible_total', 'goods_statement', 'organization', 'ein']
const FIELDS: Record<'gift' | 'in_kind' | 'year_end', [string[], string[]]> = {
 gift: [LETTER, LETTER_REQUIRED],
 in_kind: [IN_KIND_FIELDS, ['donor_name', 'gift_date', 'description', 'goods_statement', 'organization', 'ein']],
 year_end: [YEAR_END_FIELDS, YEAR_END_FIELDS.filter(f => f !== 'date' && !NAME_MERGE_FIELDS.includes(f) && !CONTACT_MERGE_FIELDS.includes(f))],
}
export const templateFields = (kind: TemplateKind): [string[], string[]] => kind === 'stock' || kind === 'daf' || kind === 'qcd' ? CONTRIBUTION_TEMPLATE_FIELDS[kind] : FIELDS[kind === 'in_kind' || kind === 'year_end' ? kind : 'gift']
export const publishedTemplateFields = () => ({ syntax: '{{field}}', defaultSyntax: '{{field|literal default}}', templates: TEMPLATE_KINDS.map(kind => { const [fields, required] = templateFields(kind); return { kind, fields, required } }), settings: { fields: LETTER, required: LETTER_REQUIRED } })

export type TemplateUse = { template_kind: string; template_id: string | null; template_version: number }
/** No reviewed template applies: the settings letter (or built-in statement) at the settings version. */
export const settingsUse = (s: Settings): TemplateUse => ({ template_kind: 'default', template_id: null, template_version: s.version })
export const templateUse = (t: Row | null | undefined, s: Settings): TemplateUse => t ? { template_kind: t.kind, template_id: t.id, template_version: t.version } : settingsUse(s)

export const letterTemplates = (c: { db: D1Database }) => all(c, `SELECT t.*,cp.name AS campaign_name FROM cf_letter_templates t LEFT JOIN cf_campaigns cp ON cp.id=t.campaign_id
 WHERE t.active=1 ORDER BY CASE t.kind ${TEMPLATE_KINDS.map((k, i) => `WHEN '${k}' THEN ${i}`).join(' ')} END,cp.name,t.name`)
export const templateFor = (c: { db: D1Database }, kind: 'in_kind' | 'year_end' | 'stock') => one(c, 'SELECT * FROM cf_letter_templates WHERE active=1 AND kind=?', kind)

/** Every save or retirement raises one template's version, so the sum moves on any change. */
export async function templateRevision(c: { db: D1Database }): Promise<number> {
 return (await one(c, 'SELECT COALESCE(SUM(version),0) AS n FROM cf_letter_templates'))!.n
}
export const templatesUnchanged = (revision: number): Stmt =>
 guard('(SELECT COALESCE(SUM(version),0) FROM cf_letter_templates)=?', 'TEMPLATES_CHANGED', 'Thank-you templates changed while preparing. Prepare again.', revision)

/** Typed DAF/QCD wording takes precedence; other gifts use form or campaign, then tribute, major gift
 * (amount at or above the template's minimum), the donor's first unreversed gift, and the
 * first installment of a recurring plan. Gifts matching none use the settings letter. */
export async function giftTemplates(c: { db: D1Database }, gifts: Row[]): Promise<Map<string, Row>> {
 await withContributionTypes(c, gifts)
 const templates = (await all(c, `SELECT * FROM cf_letter_templates WHERE active=1 AND kind IN (${GIFT_TEMPLATE_KINDS.map(() => '?').join(',')})`, ...GIFT_TEMPLATE_KINDS))
 const chosen = new Map<string, Row>()
 if (!templates.length || !gifts.length) return chosen
 const earlier = (a: string) => `(${a}.received_on<g.received_on OR (${a}.received_on=g.received_on AND (${a}.created_at<g.created_at OR (${a}.created_at=g.created_at AND ${a}.id<g.id))))`
 const facts = await all(c, `SELECT g.id,g.amount_cents,
   COALESCE((SELECT campaign_id FROM cf_campaign_gifts WHERE gift_id=g.id),(SELECT form_id FROM cf_dashboard_gift_forms WHERE gift_id=g.id)) AS campaign_id,
   EXISTS(SELECT 1 FROM cf_gift_tributes t WHERE t.gift_id=g.id) AS tribute,
   NOT EXISTS(SELECT 1 FROM cf_gifts e WHERE e.donor_id=g.donor_id AND e.kind='gift' AND ${earlier('e')} AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=e.id)) AS first_gift,
   EXISTS(SELECT 1 FROM cf_subscription_gifts sg WHERE sg.gift_id=g.id AND NOT EXISTS(SELECT 1 FROM cf_subscription_gifts o JOIN cf_gifts e ON e.id=o.gift_id WHERE o.subscription_id=sg.subscription_id AND ${earlier('e')})) AS recurring_start
  FROM cf_gifts g WHERE g.id IN (SELECT value FROM json_each(?))`, JSON.stringify(gifts.map(g => g.id)))
 for (const f of facts) {
  const typed = contributionReceiptKind(gifts.find(g => g.id === f.id)!)
  if (typed) {
   const selected = templates.find(t => t.kind === typed)
   if (selected) chosen.set(f.id, selected)
   continue // Missing typed templates use typed built-in wording, never generic precedence.
  }
  const applies = (t: Row) => t.kind === 'campaign' ? t.campaign_id === f.campaign_id : t.kind === 'major_gift' ? f.amount_cents >= t.min_cents : !!f[t.kind]
  const match = GIFT_TEMPLATE_KINDS.map(kind => templates.find(t => t.kind === kind && applies(t))).find(Boolean)
  if (match) chosen.set(f.id, match)
 }
 return chosen
}

/** One gift letter with the template version it used. */
export function renderGiftLetter(s: Settings, gift: Row, recipient: Row, day: string, template: Row | undefined) {
 if (contributionReceiptKind(gift)) return renderContributionReceipt(s, gift, recipient, day, template)
 return { ...renderLetter(s, gift, recipient, day, template as { subject: string; body: string } | undefined), ...templateUse(template, s) }
}

export async function letterTemplateCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['letterTemplate.save', 'letterTemplate.retire'].includes(command)) return undefined
 const existing = p.templateId ? await one(c, 'SELECT * FROM cf_letter_templates WHERE id=?', id(p.templateId, 'Template')) : null
 if (p.templateId && !existing) fail('NOT_FOUND', 'That thank-you template does not exist.', 404)
 const version = existing ? integer(typeof p.version === 'string' ? Number(p.version) : p.version, 'Version', 1) : 0
 const current = existing && guard('EXISTS(SELECT 1 FROM cf_letter_templates WHERE id=? AND version=? AND active=1)', 'VERSION', 'This template changed. Refresh before saving.', existing.id, version)
 const history = (t: Row, active: number) => sql('INSERT INTO cf_letter_template_versions VALUES(?,?,?,?,?,?,?,?,?)', t.id, t.version, active, t.min_cents, t.name, t.subject, t.body, c.now, c.actor.name)
 if (command === 'letterTemplate.retire') {
  if (!existing) fail('INPUT', 'Choose a template to retire.', 400)
  await commit(c, [current!, sql('UPDATE cf_letter_templates SET active=0,version=version+1,reviewed_at=?,reviewed_by=? WHERE id=?', c.now, c.actor.name, existing.id),
   history({ ...existing, version: version + 1 }, 0), event(c, command, 'letterTemplate', existing.id, null, { kind: existing.kind, version: version + 1 })])
  return { id: existing.id, kind: existing.kind, version: version + 1, active: false }
 }
 const kind = choice(p.kind ?? existing?.kind, TEMPLATE_KINDS, 'Template kind')
 if (existing && existing.kind !== kind) fail('INPUT', 'A template keeps its kind. Retire it and add a new one instead.', 400)
 const campaignId = kind === 'campaign' ? id(p.campaignId ?? existing?.campaign_id, 'Form or campaign') : null
 if (campaignId && !await one(c, 'SELECT id FROM cf_campaigns WHERE id=?', campaignId)) fail('NOT_FOUND', 'That form or campaign does not exist.', 404)
 if (existing && campaignId !== existing.campaign_id) fail('INPUT', 'A template keeps its form or campaign. Retire it and add a new one instead.', 400)
 const t = {
  id: existing?.id ?? newId(), kind, campaign_id: campaignId, version: version + 1,
  min_cents: kind === 'major_gift' ? amount(p, 'minAmount', 'Major gift minimum') : null,
  name: text(p.name, 'Template name', 100), subject: text(p.subject, 'Subject', 200), body: longText(p.body, 'Letter', 8000),
 }
 const [allowed, required] = templateFields(kind)
 checkTemplate(t.subject, 'Template subject', allowed, [])
 checkTemplate(t.body, 'Template', allowed, required)
 checkContributionTemplate(kind, t.subject, t.body)
 await commit(c, [
  ...(existing ? [current!, sql('UPDATE cf_letter_templates SET min_cents=?,name=?,subject=?,body=?,version=?,reviewed_at=?,reviewed_by=? WHERE id=?', t.min_cents, t.name, t.subject, t.body, t.version, c.now, c.actor.name, t.id)]
   : [guard("NOT EXISTS(SELECT 1 FROM cf_letter_templates WHERE active=1 AND kind=? AND COALESCE(campaign_id,'')=COALESCE(?,''))", 'TEMPLATE_EXISTS', 'An active template of this kind already exists. Edit it, or retire it first.', kind, campaignId),
    sql('INSERT INTO cf_letter_templates(id,kind,campaign_id,min_cents,name,subject,body,version,active,reviewed_at,reviewed_by) VALUES(?,?,?,?,?,?,?,1,1,?,?)', t.id, kind, campaignId, t.min_cents, t.name, t.subject, t.body, c.now, c.actor.name)]),
  history(t, 1), event(c, command, 'letterTemplate', t.id, null, { kind, campaignId, version: t.version }),
 ])
 return { id: t.id, kind, campaignId, minCents: t.min_cents, version: t.version, active: true }
}
