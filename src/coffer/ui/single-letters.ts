import { all, type Context, type Row } from '../db'
import { letterTemplates } from '../letter-templates'
import { singleLetters } from '../single-letters'
import { box, e, field, form, money, select } from './common'

export async function singleLetterPanel(c:Context,donorId:string){
 if(!['owner','admin'].includes(c.actor.role))return ''
 const [templates,letters,gifts,properties]=await Promise.all([letterTemplates(c),singleLetters(c,donorId),
  all(c,"SELECT id,received_on,net_cents FROM cf_gift_balances WHERE donor_id=? AND kind='gift' AND net_cents>0 ORDER BY received_on DESC,id",donorId),
  all(c,'SELECT id,description FROM cf_in_kind_gifts WHERE donor_id=? ORDER BY received_on DESC,id',donorId)])
 const options:[string,string][]=[['','Settings letter'],...templates.map(t=>[t.id,t.name+' · '+t.kind] as [string,string])]
 const contexts:[string,string][]=[['','Choose gift or property'],...gifts.map(g=>[g.id,g.received_on+' · '+money(g.net_cents)] as [string,string]),...properties.map(g=>[g.id,'Property · '+g.description] as [string,string])]
 return `<details class="edit" id="single-letter"><summary>Produce one letter</summary><p>Choose any reviewed template and its gift, property or statement year. Review the frozen copy before printing; preparation does not send it.</p>${form('singleLetter.prepare',select('Letter template','templateId',options)+select('Gift or property','contextId',contexts)+field('Year for a year-end template','year','number',String(new Date(c.now).getUTCFullYear()-1),'min="1900" max="9999"'),'Prepare single letter',{donorId})}</details>${letters.length?`<ul class="list">${letters.map(l=>`<li><a href="/app/single-letters/${e(l.id)}">${e(l.subject||'Erased letter')}</a> · ${e(l.status)}</li>`).join('')}</ul>`:''}`
}
export function singleLetterPage(l:Row,organisation:string){
 const address=JSON.parse(l.address),postal=[address.line1,address.line2,[address.city,address.region,address.postalCode].filter(Boolean).join(' '),address.country].filter(Boolean).map(e).join('<br>')
 const base='/app/single-letters/'+encodeURIComponent(l.id),blanks:string[]=JSON.parse(l.merge_blanks)
 return `<p><a href="/app/donors/${e(l.donor_id)}">Back to constituent</a></p>${box('Reviewed letter copy',`<p>${e(organisation)} · ${e(l.status)}</p><p>${e(l.recipient_name)}</p><p>${postal}</p>${address.addressVerification!=='verified'?'<p class="notice">Unverified postal address · review the stored address before mailing.</p>':''}<h3>${e(l.subject)}</h3><div class="body">${e(l.body).replaceAll('\n','<br>')}</div><p>Template ${e(l.template_kind)} · version ${l.template_version}. Prepared ${e(l.prepared_at.replace('T',' ').slice(0,16))} UTC.</p>${blanks.length?`<p class="notice">Empty merge fields: ${blanks.map(e).join(', ')}. Prepare again after correcting values or defaults.</p>`:'<p>No empty merge fields.</p>'}${l.status==='prepared'?form('singleLetter.approve','<p>Approve the exact wording, addressee and address shown above.</p>','Approve this letter',{letterId:l.id,version:l.version,contentHash:l.content_hash}):`<p><a href="${base}/letters.pdf">Download letter PDF</a> · <a href="${base}/print">Print letter</a></p><p><a href="${base}/print?labels=1">Avery 5160 label</a> · <a href="${base}/print?envelopes=1">Print #10 envelope</a></p><p><a href="${base}/letters.pdf?labels=1">Download label PDF</a> · <a href="${base}/letters.pdf?envelopes=1">Download envelope PDF</a> · <a href="${base}/merge.zip">Word merge package</a></p><p>Approved copy. Printing or downloading does not claim delivery.</p>`}`)}`
}
