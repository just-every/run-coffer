import type { Row } from '../db'
import type { ExportFile, SpreadsheetMapping, Table } from '../move-in/types'
import { spreadsheetFields } from '../move-in/spreadsheet-mapping'
import { columnFields, normalizeLabel } from '../move-in/source-columns'
import { valueText } from '../move-in/source-rows'
import { area, box, e, field, hidden, select } from './common'
import { customMapping } from './crm-move-in'

export function spreadsheetStart(saved:Row[]) {
 return `<p>Map a CSV or Excel file onto constituents, gifts or interactions. Keep stable source IDs so later files find the same records.</p>${box('Choose a spreadsheet',`<form method="post" action="/app/move-in/crm/spreadsheet/columns" enctype="multipart/form-data">${select('Saved column mapping','savedMapping',[['','Create a mapping'],...saved.map(s=>[s.id,s.mapping.name] as [string,string])])}<label>Spreadsheet files<input type="file" name="exports" accept=".csv,.xlsx" multiple required></label><button>Map columns</button></form>`)}<p><a href="/app/move-in/crm">All move-in sources</a></p>`
}

const codeLines=(rules:Row={})=>Object.entries(rules).map(([code,r])=>code+' = '+(r.type==='channels'?'no '+r.channels.join(' '):r.type==='limit'?'limit '+r.maxAsks:r.type)).join('\n')
const lines=(values:Record<string,string>={})=>Object.entries(values).map(([a,b])=>a+' = '+b).join('\n')
export function spreadsheetColumns(files:ExportFile[],tables:Table[],donors:Row[],saved:Row|undefined,definitions:Row[]) {
 const mapping:SpreadsheetMapping=saved?.mapping??{name:'',recordType:'gift',columns:[]},aliases=columnFields('spreadsheet'),fields=spreadsheetFields()
 const columns=[...new Map(tables.flatMap(t=>t.rows[0].map((v,i)=>({column:valueText(v),sheet:t.sheet,example:t.rows.slice(1,4).map(r=>valueText(r[i])).filter(Boolean).join(' · ')}))).map(v=>[JSON.stringify([v.sheet,v.column]),v])).values()]
 return `<p>Review each target and source value. Unmapped columns remain visible in the preview. Saved mappings keep columns, translations and custom definitions; donor matches are chosen anew.</p>${box('Map spreadsheet columns',`<form method="post" action="/app/move-in/crm/preview" enctype="multipart/form-data">${hidden('source','spreadsheet')}${hidden('spreadsheetFiles',JSON.stringify(files))}${field('Mapping name','mappingName','text',mapping.name,'required maxlength="100"')}${select('Default record kind','recordType',[['gift','Gifts'],['donor','Constituents'],['note','Interactions and notes']],mapping.recordType)}
 <p>A mapped Type column can distinguish gift, pledge, soft credit and constituent rows. Interaction rows need a note, date, stable interaction ID and kind (email, call or meeting).</p>
 <div class="scroll"><table class="stack"><thead><tr><th>Source column</th><th>Source values</th><th>Coffer field</th></tr></thead><tbody>${columns.map(c=>{const selected=mapping.columns.find(m=>m.column===c.column&&(!m.sheet||m.sheet===c.sheet))?.field??(saved?'':aliases.get(normalizeLabel(c.column))??'');return `<tr><td class="lead">${e(c.column)} · ${e(c.sheet)}${hidden('mapColumn',c.column)}${hidden('mapSheet',c.sheet)}</td><td data-label="Source values">${e(c.example)}</td><td data-label="Coffer field">${select('Target for '+c.column,'mapField',[['','Leave out'],...fields.map(f=>[f,f.replace(/([A-Z])/g,' $1').replace(/^./,s=>s.toUpperCase())] as [string,string])],selected)}</td></tr>`}).join('')}</tbody></table></div>
 ${area('Fund translations (source = target)','fundTranslations',lines(mapping.translations?.fund),'rows="3"')}${area('Payment method translations (source = target)','methodTranslations',lines(mapping.translations?.method),'rows="3"')}
 <details><summary>Match existing donors</summary><p>Choose a source constituent ID and its existing Coffer donor. A shared name or contact never joins people automatically. Native names, contacts, status and household stay as they are.</p>${Array.from({length:4},()=>`<fieldset><legend>Explicit donor match</legend>${field('Source constituent ID','matchSource','text')}${select('Existing Coffer donor','matchTarget',[['','Create or reuse the source identity'],...donors.map(d=>[JSON.stringify({id:d.id,version:d.version}),d.name+' · '+d.id] as [string,string])])}</fieldset>`).join('')}</details>
 ${customMapping('spreadsheet',{customDefinitions:definitions,customFields:saved?.customFields??[],sourceColumns:columns.map(c=>({...c,kind:mapping.recordType==='donor'?'constituent':mapping.recordType==='note'?'interaction':'gift'}))},true)}
 ${area('Communication code meanings (code = stop, ignore, no mail, no email, no phone, no sms, limit 1)','solicitCodes',codeLines(saved?.solicitCodes),'rows="3"')}<label><input type="checkbox" name="noGoodsOrServices" value="yes"> Gifts with no source goods answer had no goods or services.</label><button>Preview mapped spreadsheet</button></form>`)}<p><a href="/app/move-in/crm/spreadsheet">Choose another file</a></p>`
}
