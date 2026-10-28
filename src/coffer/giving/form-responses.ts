import { requireRole } from '../auth'
import { all, type Context, type Row } from '../db'
import { box, e, money } from '../ui/common'
import { customDisplay } from '../custom-fields'

export async function givingFormResponses(c: Context, campaignId: string): Promise<Row[]> {
 requireRole(c.actor, ['owner', 'admin'], 'read giving form answers')
 const rows = await all(c, `SELECT f.gift_id,f.form_version,f.snapshot,g.donor_id,d.name,g.amount_cents,g.fund,g.received_on
 FROM cf_giving_form_gifts f JOIN cf_gifts g ON g.id=f.gift_id JOIN cf_donors d ON d.id=g.donor_id
 JOIN cf_campaign_gifts cg ON cg.gift_id=g.id WHERE cg.campaign_id=? AND d.erased_at IS NULL
 ORDER BY g.created_at DESC,g.id LIMIT 50`, campaignId)
 return rows.map(({snapshot, ...r}) => {
  const data = JSON.parse(snapshot)
  return {...r, employer: data.employer, comment: data.comment, answers: data.answers.map((a: {key: string; value: string}) => {
   const q = data.form.questions.find((q: {key: string}) => q.key === a.key)
   return {key: a.key, label: q.label, kind: q.kind, value: JSON.parse(a.value), display: customDisplay(q, JSON.parse(a.value))}
  })}
 })
}

export async function givingFormResponsesPanel(c: Context, campaignId: string) {
 const rows = await givingFormResponses(c, campaignId)
 return box('Recent form responses', rows.length ? `<ul class="list">${rows.map(r => `<li><a href="/app/donors/${encodeURIComponent(r.donor_id)}">${e(r.name)}</a> · ${money(r.amount_cents)} · ${e(r.fund)}<p>Form version ${r.form_version} · ${e(r.received_on)}</p>${r.employer ? `<p>Employer: ${e(r.employer)}</p>` : ''}${r.comment ? `<p>Comment: ${e(r.comment)}</p>` : ''}${r.answers.map((a: {label: string; display: string}) => `<p>${e(a.label)}: ${e(a.display)}</p>`).join('')}</li>`).join('')}</ul>` : '<p>No paid form responses yet.</p>')
}
