import { requireRole } from '../auth'
import { commit, event, fail, guard, integer, sql, today, type Context, type Row } from '../db'
import { letterRecipient } from '../organizations'
import { publishedTemplateFields } from '../letter-templates'
import { checkTemplate, longDate, settings } from '../settings'
import { recipientMergeFields, templateTokens, fieldPattern } from '../template-fields'
import { requireConnection, type Connection } from './connection'
import { area, box, e, form, select } from '../ui/common'
export type ProfileField={field:string;fallback?:string}
export async function profileRecipient(c:Pick<Context,'db'>&{now?:string},donor:Row,options:{emailType?:string}={}):Promise<Row>{const recipient=await letterRecipient(c,donor,options),s=await settings(c);return {...recipient,profile_fields:{...recipientMergeFields(recipient),donor_name:recipient.letter_salutation??recipient.name,date:longDate(today(s.timezone,new Date(c.now??new Date().toISOString()))),organization:s.organisation,ein:s.ein}}}
/** Default off; only audited, owner-selected scalar values cross this boundary. */
export function selectedProfileFields(conn:Connection,donor:Row):Record<string,string>{
 const values=donor.profile_fields??recipientMergeFields(donor),fields:Record<string,string>={},missing:string[]=[]
 for(const item of conn.mergeSelection??[]){const value=String(values[item.field]??'');if(value.trim())fields[item.field]=value;else if(item.fallback)fields[item.field]=item.fallback;else missing.push(item.field)}
 if(missing.length)fail('MERGE_FIELDS_EMPTY','Selected provider fields are empty: '+missing.join(', ')+'. Fill them or save neutral literal defaults. No profile values were submitted.',409,{fields:missing})
 return fields
}
export async function profileFieldCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(command!=='marketing.fields')return
 requireRole(c.actor,['owner','admin'],'choose fields shared with email marketing')
 if(p.confirm!=='yes')fail('CONSENT','Confirm sharing the selected fields with this provider for consenting donors.',400)
 const conn=await requireConnection(c),version=integer(Number(p.version),'Field selection version',1),allowed=(await publishedTemplateFields(c)).settings.fields,source=String(p.fields??'')
 if(source.length>12000)fail('INPUT','Choose at most 50 fields.',400)
 const lines=source.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(lines.length>50)fail('INPUT','Choose at most 50 fields.',400)
 const fields:ProfileField[]=lines.map(line=>{checkTemplate(line,'Provider field',allowed,[]);const tokens=templateTokens(line);if(tokens.length!==1||line.replace(fieldPattern(),'').trim())fail('TEMPLATE','Use one {{field}} or {{field|literal default}} per line.',400);return tokens[0]})
 if(new Set(fields.map(f=>f.field)).size!==fields.length)fail('TEMPLATE','Choose each field only once.',400)
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_email_connection WHERE id=1 AND merge_version=? AND provider=?)','VERSION','The connection or selection changed. Open it again.',version,conn.provider),sql('UPDATE cf_email_connection SET merge_selection=?,merge_version=merge_version+1 WHERE id=1',JSON.stringify(fields)),event(c,command,'settings','email-fields',null,{provider:conn.provider,fields:fields.map(f=>f.field),explicitConsent:true,version:version+1})]);return {version:version+1,fields:fields.map(f=>f.field)}
}
export async function profileFieldsPanel(c:Context,conn:Connection,draft?:string){
 const fields=(await publishedTemplateFields(c)).settings.fields,selected=draft??(conn.mergeSelection??[]).map(f=>'{{'+f.field+(f.fallback?'|'+f.fallback:'')+'}}').join('\n')
 return box('Fields shared with email marketing',`<p>Existing name fields remain. Extra fields start off. Select only data you intend to share with ${e(conn.provider==='mango'?'Mango':'Mailchimp')} for donors with email permission. Gift or interaction fields without a specific profile context need a neutral literal default; Coffer never guesses a record. Missing values refuse the transfer. Provider limits are never bypassed or silently truncated.</p>${form('marketing.fields',area('Selected fields — one {{field}} or {{field|default}} per line','fields',selected,'rows="6" maxlength="12000"')+select('Merge field','fieldKey',fields)+'<button name="insertField" value="yes" formnovalidate>Insert merge field</button><label><input type="checkbox" name="confirm" value="yes" required> Share these selected fields with this provider for consenting donors.</label><p class="muted">Saving sends no profile or email. Mailchimp updates fields during existing preference checks. Mango carries them only during an already authorized list handoff; this selection creates no list or subscription. Clearing stops reading fresh values; earlier values remain at the provider. A different provider or audience clears this selection. <a href="/api/coffer/template-fields">Published field list</a></p>','Save shared fields',{version:conn.mergeVersion??1})}`,'provider-merge-fields')
}
