import { settings } from '../settings'
import { today } from '../db'
import { all, type Context, type Row } from '../db'
import { donorRecognition, report } from '../recognition'
import { box,e,field,form,longDay,money,empty } from './common'

const check=(name:string,label:string,value:unknown)=>`<label><input type="checkbox" name="${e(name)}" value="yes"${value?' checked':''}> ${e(label)}</label>`
export async function recognitionPanel(c:Context,donorId:string,gifts:Row[]){
 const current=await donorRecognition(c,donorId),preferences=await all(c,'SELECT r.* FROM cf_gift_recognition r JOIN cf_contribution_ledger g ON g.id=r.gift_id WHERE g.donor_id=?',donorId)
 const donor=form('recognition.donor',`${field('Honor-roll recognition name','recognitionName','text',current.recognition_name,'maxlength="200" placeholder="The Rivera Family"')}${check('anonymous','Keep this donor anonymous in all public recognition',current.anonymous)}${check('honorRollOptIn','Donor agreed to use this recognition name on honor rolls',current.honor_roll_opt_in)}<p class="muted">Anonymity overrides every gift’s recognition name. Blank or unapproved names appear as Anonymous. Staff and receipts retain the actual donor.</p>`,'Save donor recognition',{donorId,version:current.version})
 const giftForms=gifts.filter(g=>g.kind==='gift'||g.kind==='in_kind').map(g=>{
  const r=preferences.find(r=>r.gift_id===g.id)
  return `<details class="edit"><summary>${g.kind==='in_kind'?'Property: '+e(g.property_description):money(g.amount_cents)} · ${longDay(g.received_on)} · gift recognition</summary>${form('recognition.gift',`${check('anonymous','Keep this gift anonymous',r?.anonymous)}${field('Gift recognition name','recognitionName','text',r?.recognition_name,'maxlength="200"')}${r?.wall_opt_in?check('wallOptIn','Keep the donor’s checkout opt-in for the campaign wall',true):'<p class="muted">This gift is private on campaign walls. Only a donor’s explicit checkout choice can publish a gift.</p>'}`,'Save gift recognition',{donorId,giftId:g.id})}</details>`
 }).join('')
 return box('Recognition and anonymity',donor+giftForms,'recognition')
}

/** A small native report uses the existing report-card and table patterns. */
export async function honorRollPage(c:Context,url:URL){
 const configuration=await settings(c),year=Number(today(configuration.timezone,new Date(c.now)).slice(0,4)),selected=url.searchParams.has('from')&&url.searchParams.has('through')
 const from=url.searchParams.get('from')??`${year}-01-01`,through=url.searchParams.get('through')??`${year}-12-31`,levelUsd=url.searchParams.get('levelUsd')??'500',levelName=url.searchParams.get('levelName')??'Leadership'
 const filters=`<form method="get" action="/app/reports/honor-roll"><div class="fields">${field('Received from','from','date',from,'required')}${field('Received through','through','date',through,'required')}${field('Higher giving level (USD)','levelUsd','text',levelUsd,'required inputmode="decimal"')}${field('Higher level name','levelName','text',levelName,'required maxlength="100"')}</div><button>Show honor roll</button></form>`
 const help='<p>Positive remaining monetary gifts received in this inclusive period, after all recorded refunds. Soft credits and property values are excluded. Names need the donor’s recognition permission; anonymous gifts have separate rows. This is recognition, not a tax statement.</p>'
 if(!selected)return box('Honor roll',help+filters+empty('Choose a received-date period to prepare the honor roll.'))
 const prepared=honorRollUrl(url),value=await report(c,prepared),download='/app/reports/honor-roll.csv?'+prepared.searchParams.toString()
 const table=value.rows.length?`<div class="scroll"><table class="stack"><thead><tr><th>Recognition name</th><th>Giving level</th><th>Giving</th><th>Gifts</th></tr></thead><tbody>${value.rows.map(row=>`<tr><td class="lead">${e(row.name)}</td><td data-label="Giving level">${e(row.level)}</td><td data-label="Giving">${money(row.amountCents)}</td><td data-label="Gifts">${row.giftCount}</td></tr>`).join('')}</tbody></table></div>`:empty('No positive remaining gifts in this period.')
 return box('Honor roll',help+filters+`<p><strong>Total recognized: ${money(value.totalCents)}</strong> · <a href="${e(download)}">Download honor-roll CSV</a></p>`+table)
}
export function honorRollUrl(url:URL){
 const next=new URL(url)
 if(!next.searchParams.has('levels')){
  const raw=next.searchParams.get('levelUsd')??'500'
  // Native form amounts use the same exact-cent parser as gift entry.
  next.searchParams.set('levels',JSON.stringify([{name:'Supporter',minimumCents:0},{name:next.searchParams.get('levelName')??'Leadership',minimumCents:parseLevel(raw)}]))
 }
 return next
}
import { amount } from '../money'
function parseLevel(raw:string){return amount({amount:raw},'amount','Higher giving level')}
