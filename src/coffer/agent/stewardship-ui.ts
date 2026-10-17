import { all, type Context, type Row } from '../db'
import { area, box, chip, e, field, hidden, select, when } from '../ui/common'
import { managedStewardshipMessage, stewardshipState, type StewardshipSource } from './stewardship'

const post = (command: string, contents: string, label: string, values: Row = {}) =>
 `<form method="post" action="/app/agent/stewardship/${e(command)}">${Object.entries(values).map(([key,value]) => hidden(key,value)).join('')}${contents}<button>${e(label)}</button></form>`
const sourceList = (sources: StewardshipSource[]) => `<dl class="stewardship-sources">${sources.map(source => `<dt><code>${e(source.id)}</code> · ${e(source.kind)}</dt><dd>${Object.entries(source.facts).filter(([key]) => !['id','version'].includes(key)).map(([key,value]) => `<p><strong>${e(key.replace(/_/g,' '))}:</strong> ${e(value ?? 'Not recorded')}</p>`).join('')}</dd>`).join('')}</dl>`

export async function setupPage(c: Context): Promise<string> {
 const { setup } = await stewardshipState(c)
 if (setup.managed) return `<p role="status">${e(managedStewardshipMessage)}</p>`
 return `<p><a href="/app/agent">Agent desk</a> · <a href="/app/agent/stewardship">Stewardship drafts</a></p>
 ${box('Your AI provider', `<p>Coffer uses your organisation’s own <strong>Anthropic API key</strong> and Claude Haiku 4.5 to draft thank-you and impact notes. Your Anthropic account pays for the requests; a Claude chat subscription does not cover this API.</p>
 <ol><li>Open <a href="https://platform.claude.com/" target="_blank" rel="noopener noreferrer">Claude Console</a>, create an account or sign in, and add API billing.</li>
 <li>Create a key under API keys. Use a dedicated key for this Coffer installation and set a spending limit in your Anthropic account.</li>
 <li>Paste the key below. If it can access multiple workspaces, copy your workspace ID from <a href="https://platform.claude.com/settings/workspaces" target="_blank" rel="noopener noreferrer">Settings → Workspaces</a> and paste that too. A key scoped to one workspace can leave the workspace ID blank. Save, then test the connection. No terminal or deployment change is needed.</li></ol>
 <p><strong>Price:</strong> Haiku 4.5 costs US$1 per million input tokens and US$5 per million output tokens at the published standard API rate. For example, 10,000 input and 2,000 output tokens across drafting and factual review cost about US$0.02. Drafting makes one paid request. Saving a reviewed note makes another factual-check request. Usage varies with your donor’s records. <a href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noopener noreferrer">Current Anthropic pricing</a>.</p>
 <p><strong>Privacy:</strong> Drafting sends the selected donor’s name, organisation name, up to 20 gifts with fund names and notes and their associated refund and correction history, current contribution totals by fund, up to 10 recorded conversations and their next steps, and tribute names to Anthropic. Email addresses and postal addresses are excluded. The connection test sends no donor data. Anthropic normally deletes API inputs and outputs within 30 days, with policy, legal and agreed exceptions. Review <a href="https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data" target="_blank" rel="noopener noreferrer">Anthropic’s retention policy</a> before using private donor records.</p>
 <p>The key is encrypted in this installation using its session secret. Coffer never displays it again. Removing it stops future AI calls; you can also revoke it in Claude Console. Removing a key does not recall data already sent to Anthropic.</p>`)}
 ${box('Connection', `${setup.configured ? `<p role="status">${chip('Key saved','ok')} ${setup.testedAt ? 'Connection tested ' + e(when(setup.testedAt)) : 'Not tested yet'}</p>` : '<p role="status">No AI key is saved. Deterministic jobs work without AI; stewardship drafting needs an AI key.</p>'}
 ${post('setup', field(setup.configured ? 'Replace Anthropic API key (leave blank to keep saved key)' : 'Anthropic API key','key','password','', `${setup.configured ? '' : 'required '}autocomplete="new-password" spellcheck="false" maxlength="1000"`) + field('Workspace ID (optional for a workspace-scoped key)','workspaceId','text',setup.workspaceId ?? '','autocomplete="off" spellcheck="false" maxlength="100" pattern="wrkspc_[A-Za-z0-9_-]+"') + '<p>The workspace ID is not secret. You can change it without entering your saved key again. Clear it only when using a key scoped to one workspace. <a href="https://platform.claude.com/docs/en/manage-claude/authentication" target="_blank" rel="noopener noreferrer">Anthropic workspace guidance</a>.</p>', setup.configured ? 'Save connection' : 'Save key', {version:setup.version})}
 ${setup.configured ? post('test','<p>This checks the saved key with a small paid request and no donor records.</p>','Test connection') + post('setup','<p>Remove the stored key from this installation.</p>','Remove key',{version:setup.version,remove:'yes'}) : ''}`)}`
}

function draftCard(draft: Row, versions: Row[]) {
 const sources = JSON.parse(draft.sources) as StewardshipSource[], citations = JSON.parse(draft.citations) as {sourceId:string;quote:string}[]
 const values = { id:draft.id,version:draft.version }
 const editable = draft.status === 'draft'
 return box(`${draft.donor_name} · ${draft.kind === 'impact' ? 'Impact note' : 'Thank-you note'}`,
  `<p>${chip(draft.status)} · Version ${e(draft.version)} · Drafted by AI ${e(when(draft.created_at))}</p>
  <p><a href="/app/donors/${encodeURIComponent(draft.donor_id)}">Open donor record</a></p>
  <div class="grid"><section><h3>Review the note</h3>
  ${editable ? post('save', `${field('Subject','subject','text',draft.subject,'required maxlength="200"')}${area('Body','body',draft.body,'required rows="16" maxlength="8000"')}<p>Check every fact and the sources alongside this note. Saving confirms your review of this exact version and checks the text against the recorded facts. Edits that add unsupported claims are refused.</p>`, 'Save reviewed note',values) : `<h4>${e(draft.subject)}</h4><div class="stewardship-text">${e(draft.body)}</div>`}
  ${editable ? `<h3>Send the saved note</h3><p>Recipient: <strong>${e(draft.current_email || 'No current email address')}</strong>. Coffer checks current email consent when you send. This is a stewardship email, not a tax receipt.</p>
   ${draft.reviewed_version === draft.version ? post('send','<p>This sends the exact saved note above. Save any further edits before sending.</p><label><input type="checkbox" name="confirm" value="SEND" required> I have reviewed this saved note and recipient. Send this email now.</label>','Send reviewed email',values) : '<p>Review and save this version to enable sending.</p>'}
   <p>Email cannot be recalled after submission. A provider timeout is marked uncertain and is never retried automatically.</p>${post('discard','','Discard draft',values)}` : draft.status === 'discarded' ? post('restore','<p>Restore this draft for review. Restoration is refused if its source records changed.</p>','Restore draft',values)
   : `<p>${draft.status === 'submitted' ? 'The provider accepted this email. Delivery has not been confirmed.' : draft.status === 'rejected' ? 'The provider rejected this email. No automatic resend will occur.' : 'Submission may have reached the provider. Check the provider’s email logs before taking further action; Coffer will not resend it.'}</p>${draft.message_id ? `<p>Provider message ID: <code>${e(draft.message_id)}</code></p>` : ''}`}
  ${versions.length > 1 ? `<details><summary>Previous saved versions</summary>${versions.filter(v=>v.version!==draft.version).map(v=>`<h4>Version ${e(v.version)} · ${e(when(v.edited_at))}</h4><p>${e(v.subject)}</p><div class="stewardship-text">${e(v.body)}</div>`).join('')}</details>` : ''}</section>
  <aside><h3>Sources for this draft</h3><p>These are the recorded facts supplied to the AI. Historical gift amounts and funds are shown alongside signed refunds, reversals and corrections. Current amounts and fund totals include those adjustments. Source changes block editing and sending; create a fresh draft after a change. The factual check runs when you save your reviewed text. Sending stays locked until that check and your review pass.</p>
  <h4>Citations</h4><ul>${citations.map(citation=>`<li><code>${e(citation.sourceId)}</code></li>`).join('')}</ul>
  <details open><summary>Recorded source facts</summary>${sourceList(sources)}</details></aside></div>`, 'draft-' + draft.id)
}

export async function stewardshipPage(c: Context, url: URL): Promise<string> {
 const donorId = url.searchParams.get('donorId') || undefined, state = await stewardshipState(c,donorId)
 if (state.setup.managed) return `<p role="status">${e(managedStewardshipMessage)}</p>`
 const versions = await all(c, `SELECT v.* FROM cf_stewardship_versions v JOIN cf_stewardship_drafts d ON d.id=v.draft_id ${donorId ? 'WHERE d.donor_id=?' : ''} ORDER BY v.version DESC`, ...(donorId ? [donorId] : []))
 return `<p><a href="/app/agent">Agent desk</a> · <a href="/app/agent/setup">AI setup</a></p>
 <p>Draft a personal thank-you or impact note from a donor’s actual gifts, funds, conversations and tributes. Every note stays here for a person to review, edit and send.</p>
 ${!state.setup.configured ? box('Add an AI key','<p>Deterministic jobs work without AI. Stewardship drafting needs an AI key. <a href="/app/agent/setup">Set up your AI provider</a>.</p>') : box('Draft a note',post('draft',`${select('Donor','donorId',state.donors.map(d=>[d.id,d.name]),donorId,'required')}${select('Note type','kind',[['thank_you','Thank-you note'],['impact','Impact note']])}<p>Drafting shares the selected source facts with Anthropic. Saving your review checks the edited note against those records. No email is sent. Coffer does not infer measured impact from a fund name.</p>`,'Create draft'))}
 ${state.drafts.length ? state.drafts.map(draft=>draftCard(draft,versions.filter(v=>v.draft_id===draft.id))).join('') : '<p>No stewardship drafts yet.</p>'}`
}
