import { compareDonors, likelyDuplicates } from '../duplicates'
import type { Context } from '../db'
import { manager } from '../auth'
import { box, e, empty, form, money } from './common'

export async function duplicatesPage(c: Context, url: URL) {
 const donorId = url.searchParams.get('donorId') ?? undefined
 const list = await likelyDuplicates(c,{donorId,page:Number(url.searchParams.get('page'))||0})
 const query = new URLSearchParams(url.searchParams)
 const paging = (page: number) => { const q=new URLSearchParams(query);q.set('page',String(page));return '/app/duplicates?'+e(q.toString()) }
 return `<p>Review likely matches before combining records. People in the same household stay separate. A merge preserves gift amounts and can be undone in the audit log while its records remain unchanged.</p>${donorId ? '<p><a href="/app/duplicates">All possible duplicates</a></p>' : ''}${box(`${list.count} possible duplicates`,list.pairs.length ? `<ul class="list">${list.pairs.map(p=>`<li><strong>${e(p.source.name)}</strong> and <strong>${e(p.target.name)}</strong><p>${p.reasons.map((r:{label:string})=>e(r.label)).join(' · ')}</p><p><a href="/app/duplicates/compare?source=${e(p.source.id)}&amp;target=${e(p.target.id)}">Compare records</a> · <a href="/app/donors/${e(p.source.id)}">First donor</a> · <a href="/app/donors/${e(p.target.id)}">Second donor</a></p></li>`).join('')}</ul><p class="paging">${list.page>0 ? `<a href="${paging(list.page-1)}">Previous</a>` : ''}${list.more ? `<a href="${paging(list.page+1)}">Next</a>` : ''}</p>` : empty('No possible duplicates found.'))}`
}

export async function comparePage(c: Context, url: URL) {
 const view = await compareDonors(c,url.searchParams.get('source')??'',url.searchParams.get('target')??'')
 const source=view.source,target=view.target
 const cells=view.fields.map(f=>`<fieldset><legend>${e(f.label)}</legend><div class="fields"><label><input type="radio" name="field:${e(f.key)}" value="target" checked> Keep ${e(f.targetLabel??f.target??'Empty')}</label><label><input type="radio" name="field:${e(f.key)}" value="source"> Use ${e(f.sourceLabel??f.source??'Empty')}</label></div></fieldset>`).join('')
 const summary=(kind:'source'|'target')=>{const h=view.history[kind]!;return `<p>${h.gifts} gifts · ${money(h.totalCents)} · ${h.pledges} pledges · ${h.consents} consent rows</p>`}
 return `<p><a href="/app/duplicates">Back to possible duplicates</a></p><div class="grid">${box('Surviving record',`<h3>${e(target.name)}</h3>${summary('target')}<p><a href="/app/donors/${e(target.id)}">Open full history</a></p>`)}${box('Record to combine',`<h3>${e(source.name)}</h3>${summary('source')}<p><a href="/app/donors/${e(source.id)}">Open full history</a> · <a href="/app/duplicates/compare?source=${e(target.id)}&amp;target=${e(source.id)}">Swap surviving record</a></p>`)}</div>${box('Choose the contact details to keep',manager(c.actor) ? form('donor.merge',`${cells}<p>Both histories, consent and provider links will belong to the surviving record. Financial amounts stay unchanged. Unsent frozen letters or appeals must be discarded first. Private donor links are revoked and pending welcome steps stop. Undo is available from the audit log until a related record changes.</p>`, 'Merge these records',{donorId:target.id,sourceDonorId:source.id,version:target.version,sourceVersion:source.version}) : `<p>An owner or admin can combine these records.</p>${cells}`)}`
}
