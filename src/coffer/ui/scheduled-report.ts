import { box, e, money, moment } from './common'
import type { Row } from '../db'

const label=(key:string)=>key.replace(/Cents$/, '').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ').replace(/^./,letter=>letter.toUpperCase())
function value(data:unknown,key=''):string {
 if(data===null||data===undefined)return '—'
 if(typeof data==='number')return /Cents$/.test(key)?money(data):e(String(data))
 if(typeof data==='boolean')return data?'Yes':'No'
 if(typeof data!=='object')return e(String(data))
 if(Array.isArray(data))return data.length?`<ol>${data.map(item=>`<li>${value(item)}</li>`).join('')}</ol>`:'None'
 const fields=Object.entries(data).filter(([name])=>!/href$/i.test(name))
 return `<dl >${fields.map(([name,item])=>`<dt><strong>${e(label(name))}</strong></dt><dd>${value(item,name)}</dd>`).join('')}</dl>`
}

export function scheduledReportDocument(report:Row,path:string) {
 return `<p>Generated ${e(moment(report.generatedAt,'UTC'))} UTC</p><p><a href="${e(path)}?download=1">Download report attachment</a></p>${box('Report contents',`<div class="report-document">${value(report.report)}</div>`)}`
}
