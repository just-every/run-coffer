import { all, type Context, type Row } from '../db'
import { assertReceiptMailAvailable } from '../receipt-mail'
import { settings } from '../settings'
import { area, box, chip, e, field, hidden, moment, money, select, shortDate, when } from '../ui/common'
import { AGENT } from './activity'
import { managedStewardshipMessage, stewardshipState, type StewardshipSource } from './stewardship'

const post = (command: string, contents: string, label: string, values: Row = {}) =>
 `<form method="post" action="/app/agent/stewardship/${e(command)}">${Object.entries(values).map(([key,value]) => hidden(key,value)).join('')}${contents}<button>${e(label)}</button></form>`
const titled = (value: unknown) => String(value ?? '').replace(/_/g, ' ').replace(/^./, ch => ch.toUpperCase())
/** "Gift · Oct 15, 2026 · $50.00 · Holiday Meals": how a reviewer reads one recorded source. */
function sourceLabel(source: StewardshipSource) {
 const f = source.facts
 if (source.kind === 'donor') return `Donor · ${f.name}`
 if (source.kind === 'organisation') return `Organization · ${f.organisation}`
 if (source.kind === 'gift') return `Gift · ${shortDate(f.received_on)} · ${money(f.current_amount_cents)} · ${f.original_fund}`
 if (source.kind === 'contribution') return `${titled(f.kind)} · ${shortDate(f.received_on)} · ${money(f.signed_amount_cents)} · ${f.fund}`
 if (source.kind === 'fund') return `Fund total · ${f.fund} · ${money(f.current_amount_cents)}`
 if (source.kind === 'conversation') return `${titled(f.kind)} · ${shortDate(f.occurred_on)}`
 if (source.kind === 'tribute') return `${f.kind === 'memory' ? 'In memory of' : 'In honor of'} ${f.honoree}`
 return titled(source.kind)
}
/** A gift's state now: refunds and corrections move its current amount below what was given. */
function giftState(f: Row) {
 if (f.current_amount_cents === f.original_amount_cents) return chip('Recorded', 'ok')
 if (f.current_amount_cents <= 0) return chip('Refunded', 'alarm')
 return chip('Partly refunded', 'warn')
}
/** The recorded facts behind a draft, drawn like the Gifts ledger: date, fund, amount and state. */
function sourceFacts(sources: StewardshipSource[], cited: Set<string>) {
 const of = (kind: string) => sources.filter(source => source.kind === kind)
 const mark = (source: StewardshipSource) => cited.has(source.id) ? '<small>Cited in the note</small>' : ''
 const row = (source: StewardshipSource, day: string, fund: string, amount: string, state: string) => `<tr><td class="cf-date">${e(shortDate(day))}</td><td class="cf-who-cell"><strong>${e(fund)}</strong>${mark(source)}</td><td class="cf-amount">${amount}</td><td class="cf-status">${state}</td></tr>`
 const gifts = of('gift').map(g => row(g, g.facts.received_on, g.facts.original_fund, `${e(money(g.facts.current_amount_cents))}${g.facts.current_amount_cents === g.facts.original_amount_cents ? '' : `<small>given ${e(money(g.facts.original_amount_cents))}</small>`}`, giftState(g.facts)))
 const adjustments = of('contribution').filter(l => l.facts.kind !== 'gift').map(l => row(l, l.facts.received_on, l.facts.fund, e(money(l.facts.signed_amount_cents)), chip(titled(l.facts.kind), 'warn')))
 const table = gifts.length + adjustments.length ? `<table class="cf-ledger-table cf-sources"><thead><tr><th>Date</th><th>Fund</th><th>Amount</th><th>State</th></tr></thead><tbody>${[...gifts, ...adjustments].join('')}</tbody></table>` : '<p class="muted">No gifts recorded.</p>'
 const funds = of('fund').map(f => `${e(f.facts.fund)} <b>${e(money(f.facts.current_amount_cents))}</b>`).join(' · ')
 const people = [...of('donor'), ...of('organisation')].map(source => e(sourceLabel(source))).join(' · ')
 const talks = of('conversation').map(i => `<li>${e(sourceLabel(i))}${i.facts.notes ? `: ${e(i.facts.notes)}` : ''}</li>`).join('')
 const tributes = of('tribute').map(t => `<li>${e(sourceLabel(t))}</li>`).join('')
 return `<p class="muted">${people}</p>${table}${funds ? `<p class="cf-fund-totals">Fund totals now: ${funds}</p>` : ''}${talks ? `<h4>Conversations</h4><ul class="list">${talks}</ul>` : ''}${tributes ? `<h4>Tributes</h4><ul class="list">${tributes}</ul>` : ''}`
}
const DRAFT_STATE: Record<string, [string, string]> = { draft: ['Waiting for review', 'warn'], sending: ['Sending', 'info'], submitted: ['Email submitted', 'info'], uncertain: ['Submission uncertain', 'warn'], rejected: ['Email rejected', 'alarm'], discarded: ['Discarded', ''] }

export async function setupPage(c: Context): Promise<string> {
 const { setup } = await stewardshipState(c)
 if (setup.managed) return `<p role="status">${e(managedStewardshipMessage)}</p>`
 return `<p><a href="/app/agent">Agent desk</a> · <a href="/app/agent/stewardship">Stewardship drafts</a></p>
 ${box('Your AI provider', `<p>Coffer uses your organization’s own <strong>Anthropic API key</strong> and Claude Haiku 4.5 to draft thank-you and impact notes. Your Anthropic account pays for the requests; a Claude chat subscription does not cover this API.</p>
 <ol><li>Open <a href="https://platform.claude.com/" target="_blank" rel="noopener noreferrer">Claude Console</a>, create an account or sign in, and add API billing.</li>
 <li>Create a key under API keys. Use a dedicated key for this Coffer installation and set a spending limit in your Anthropic account.</li>
 <li>Paste the key below. If it can access multiple workspaces, copy your workspace ID from <a href="https://platform.claude.com/settings/workspaces" target="_blank" rel="noopener noreferrer">Settings → Workspaces</a> and paste that too. A key scoped to one workspace can leave the workspace ID blank. Save, then test the connection. No terminal or deployment change is needed.</li></ol>
 <p><strong>Price:</strong> Haiku 4.5 costs US$1 per million input tokens and US$5 per million output tokens at the published standard API rate. For example, 10,000 input and 2,000 output tokens across drafting and factual review cost about US$0.02. Drafting makes one paid request. Saving a reviewed note makes another factual-check request. Usage varies with your donor’s records. <a href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noopener noreferrer">Current Anthropic pricing</a>.</p>
 <p><strong>Privacy:</strong> Drafting sends the selected donor’s name, organization name, up to 20 gifts with fund names and notes and their associated refund and correction history, current contribution totals by fund, up to 10 recorded conversations and their next steps, and tribute names to Anthropic. Email addresses and postal addresses are excluded. The connection test sends no donor data. Anthropic normally deletes API inputs and outputs within 30 days, with policy, legal and agreed exceptions. Review <a href="https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data" target="_blank" rel="noopener noreferrer">Anthropic’s retention policy</a> before using private donor records.</p>
 <p>The key is encrypted in this installation using its session secret. Coffer never displays it again. Removing it stops future AI calls; you can also revoke it in Claude Console. Removing a key does not recall data already sent to Anthropic.</p>`)}
 ${box('Connection', `${setup.configured ? `<p role="status">${chip('Key saved','ok')} ${setup.testedAt ? 'Connection tested ' + e(when(setup.testedAt, (await settings(c)).timezone)) : 'Not tested yet'}</p>` : '<p role="status">No AI key is saved. Deterministic jobs work without AI; stewardship drafting needs an AI key.</p>'}
 ${post('setup', field(setup.configured ? 'Replace Anthropic API key (leave blank to keep saved key)' : 'Anthropic API key','key','password','', `${setup.configured ? '' : 'required '}autocomplete="new-password" spellcheck="false" maxlength="1000"`) + field('Workspace ID (optional for a workspace-scoped key)','workspaceId','text',setup.workspaceId ?? '','autocomplete="off" spellcheck="false" maxlength="100" pattern="wrkspc_[A-Za-z0-9_-]+"') + '<p>The workspace ID is not secret. You can change it without entering your saved key again. Clear it only when using a key scoped to one workspace. <a href="https://platform.claude.com/docs/en/manage-claude/authentication" target="_blank" rel="noopener noreferrer">Anthropic workspace guidance</a>.</p>', setup.configured ? 'Save connection' : 'Save key', {version:setup.version})}
 ${setup.configured ? post('test','<p>This checks the saved key with a small paid request and no donor records.</p>','Test connection') + post('setup','<p>Remove the stored key from this installation.</p>','Remove key',{version:setup.version,remove:'yes'}) : ''}`)}`
}

/** Who wrote a draft, labelled the same way on the card, this page and Agent activity.
 * Live drafting always runs for a signed-in owner or admin and asks Claude; only the
 * development agent itself (the demo's saved note) writes from records without AI. */
const author = (draft: Row) => draft.created_by === AGENT.id ? `Written by the ${AGENT.name.toLowerCase()} from recorded gifts, without AI` : `Drafted with AI for ${draft.drafted_by ?? 'a manager'}`

type Desk = { timeZone: string; aiReady: boolean; sendingOff: string }
function draftCard(draft: Row, versions: Row[], desk: Desk) {
 const sources = JSON.parse(draft.sources) as StewardshipSource[], citations = JSON.parse(draft.citations) as {sourceId:string;quote:string}[]
 const cited = new Set(citations.map(citation => citation.sourceId))
 const values = { id:draft.id,version:draft.version }
 const editable = draft.status === 'draft', [stateLabel, tone] = DRAFT_STATE[draft.status] ?? [draft.status, '']
 const blocked = desk.aiReady ? desk.sendingOff : `${desk.sendingOff ? desk.sendingOff.replace(/\.$/, ', and ') : ''}${desk.sendingOff ? 's' : 'S'}aving a reviewed note needs an AI key for its factual check.`
 const saveForm = `<form method="post" action="/app/agent/stewardship/save">${Object.entries(values).map(([key,value]) => hidden(key,value)).join('')}${field('Subject','subject','text',draft.subject,'required maxlength="200"')}${area('Body','body',draft.body,'required rows="16" maxlength="8000"')}<p>Check every fact against the sources alongside this note. Saving confirms your review of this exact version and checks the text against the recorded facts. Edits that add unsupported claims are refused.</p>${blocked ? `<p class="notice cf-send-off" role="status">${e(blocked)}${desk.aiReady ? '' : ' <a href="/app/agent/setup">Set up your AI provider</a>.'}</p>` : ''}<button${desk.aiReady ? '' : ' disabled'}>Save reviewed note</button></form>`
 return box(`${draft.donor_name} · ${draft.kind === 'impact' ? 'Impact note' : 'Thank-you note'}`,
  `<p>${chip(stateLabel, tone)} · Version ${e(draft.version)} · ${e(author(draft))} · ${e(moment(draft.created_at, desk.timeZone))}</p>
  <p><a href="/app/donors/${encodeURIComponent(draft.donor_id)}">Open donor record</a></p>
  <div class="grid"><section><h3>Review the note</h3>
  ${editable ? saveForm : `<h4>${e(draft.subject)}</h4><div class="stewardship-text">${e(draft.body)}</div>`}
  ${editable ? `<h3>Send the saved note</h3><p>Recipient: <strong>${e(draft.current_email || 'No current email address')}</strong>. Coffer checks current email consent when you send. This is a stewardship email, not a tax receipt.</p>
   ${draft.reviewed_version === draft.version ? post('send','<p>This sends the exact saved note above. Save any further edits before sending.</p><label><input type="checkbox" name="confirm" value="SEND" required> I have reviewed this saved note and recipient. Send this email now.</label>','Send reviewed email',values) : '<p>Review and save this version to enable sending.</p>'}
   <p>Email cannot be recalled after submission. A provider timeout is marked uncertain and is never retried automatically.</p>${post('discard','','Discard draft',values)}` : draft.status === 'discarded' ? post('restore','<p>Restore this draft for review. Restoration is refused if its source records changed.</p>','Restore draft',values)
   : `<p>${draft.status === 'submitted' ? 'The provider accepted this email. Delivery has not been confirmed.' : draft.status === 'rejected' ? 'The provider rejected this email. No automatic resend will occur.' : 'Submission may have reached the provider. Check the provider’s email logs before taking further action; Coffer will not resend it.'}</p>${draft.message_id ? `<p>Provider message ID: <code>${e(draft.message_id)}</code></p>` : ''}`}
  ${versions.length > 1 ? `<details><summary>Previous saved versions</summary>${versions.filter(v=>v.version!==draft.version).map(v=>`<h4>Version ${e(v.version)} · ${e(when(v.edited_at, desk.timeZone))}</h4><p>${e(v.subject)}</p><div class="stewardship-text">${e(v.body)}</div>`).join('')}</details>` : ''}</section>
  <aside><h3>Sources for this draft</h3><p>These are the recorded facts the note was written from. Current amounts and fund totals include refunds, reversals and corrections. A change to these records blocks editing and sending; draft again after a change.</p>
  <h4>Cited in the note</h4><ul class="list">${citations.map(citation => { const source = sources.find(s => s.id === citation.sourceId); return `<li>${e(source ? sourceLabel(source) : 'A source no longer in this draft')}</li>` }).join('')}</ul>
  <details class="cf-source-facts"><summary>Recorded source facts (${sources.length})</summary>${sourceFacts(sources, cited)}</details></aside></div>`, 'draft-' + draft.id)
}

export async function stewardshipPage(c: Context, url: URL): Promise<string> {
 const donorId = url.searchParams.get('donorId') || undefined, state = await stewardshipState(c,donorId)
 if (state.setup.managed) return `<p role="status">${e(managedStewardshipMessage)}</p>`
 const versions = await all(c, `SELECT v.* FROM cf_stewardship_versions v JOIN cf_stewardship_drafts d ON d.id=v.draft_id ${donorId ? 'WHERE d.donor_id=?' : ''} ORDER BY v.version DESC`, ...(donorId ? [donorId] : []))
 const desk: Desk = { timeZone: (await settings(c)).timezone, aiReady: state.setup.configured, sendingOff: sendingOff(c) }
 return `<p><a href="/app/agent">Agent desk</a> · <a href="/app/agent/setup">AI setup</a></p>
 <p>Draft a personal thank-you or impact note from a donor’s actual gifts, funds, conversations and tributes. Every note stays here for a person to review, edit and send.</p>
 ${!state.setup.configured ? box('Add an AI key','<p>Deterministic jobs work without AI. Drafting a new note with AI, and the factual check that runs when you save a reviewed note, need an AI key. <a href="/app/agent/setup">Set up your AI provider</a>.</p>') : box('Draft a note',post('draft',`${select('Donor','donorId',state.donors.map(d=>[d.id,d.name]),donorId,'required')}${select('Note type','kind',[['thank_you','Thank-you note'],['impact','Impact note']])}<p>Drafting shares the selected source facts with Anthropic. Saving your review checks the edited note against those records. No email is sent. Coffer does not infer measured impact from a fund name.</p>`,'Create draft'))}
 ${state.drafts.length ? state.drafts.map(draft=>draftCard(draft,versions.filter(v=>v.draft_id===draft.id),desk)).join('') : '<p>No stewardship drafts yet.</p>'}`
}

/** Why this installation cannot send a stewardship email, said beside the note before anyone tries. */
function sendingOff(c: Context) {
 if (c.env?.RER_DEMO === '1') return 'Sending is off in this demo.'
 try { assertReceiptMailAvailable(c.env!) } catch (error) { return `Sending is off here: ${(error as Error).message}` }
 return ''
}
