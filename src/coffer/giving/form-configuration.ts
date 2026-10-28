import { requireRole } from '../auth'
import { all, commit, event, fail, guard, integer, object, one, optional, sql, text, type Context, type Row } from '../db'
import { amount } from '../money'

export type GivingQuestion = { key: string; label: string; required: boolean; kind: 'constituent' | 'gift'; type: string; entry: string; choices: string[]; version: number }
export type GivingForm = {
 campaignId: string; version: number; logoUrl: string | null; primaryColor: string; backgroundColor: string; textColor: string
 headline: string; body: string; suggestedAmountsCents: number[]; designations: string[]
 employerEnabled: boolean; commentEnabled: boolean; questions: GivingQuestion[]
}
type Database = { db: D1Database }
const bool = (v: unknown, label: string) => {
 if (typeof v !== 'boolean') fail('INPUT', label + ' must be true or false.', 400)
 return v
}
function color(v: unknown, label: string): string {
 if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) fail('INPUT', label + ' must be a six-digit hex color.', 400)
 return v.toLowerCase()
}
function luminance(hex: string) {
 const [r,g,b] = [1,3,5].map(i => { const c = parseInt(hex.slice(i,i+2),16)/255; return c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4 })
 return .2126*r+.7152*g+.0722*b
}
export function contrast(a: string, b: string): number {
 const x = luminance(a), y = luminance(b)
 return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)
}
export async function givingFormFields(c: Database): Promise<Row[]> {
 return all(c, "SELECT * FROM cf_custom_fields WHERE kind IN ('constituent','gift') ORDER BY label,key")
}
async function questions(c: Database, input: unknown): Promise<GivingQuestion[]> {
 if (!Array.isArray(input) || input.length > 20) fail('INPUT', 'Choose up to 20 custom questions.', 400)
 const defined = new Map((await givingFormFields(c)).map(f => [f.key,f]))
 const result = input.map(raw => {
  const q = object(raw,'Question'), key = text(q.key,'Custom field',80), field = defined.get(key)
  if (Object.keys(q).some(k => !['key','label','required'].includes(k))) fail('INPUT','A question accepts key, label and required.',400)
  if (!field) fail('INPUT','Questions must map to defined constituent or gift fields.',400)
  return {key,label:text(q.label,'Question label',100),required:bool(q.required,'Required answer'),kind:field.kind,type:field.type,entry:field.entry,choices:JSON.parse(field.choices),version:field.version} as GivingQuestion
 })
 if (new Set(result.map(q=>q.key)).size !== result.length) fail('INPUT','Choose each custom field once.',400)
 return result
}
export async function getGivingForm(c: Database, campaign: Row): Promise<GivingForm> {
 const saved = await one(c,'SELECT version,configuration FROM cf_giving_forms WHERE campaign_id=?',campaign.id)
 const defaults: GivingForm = {campaignId:campaign.id,version:0,logoUrl:null,primaryColor:'#245842',backgroundColor:'#ffffff',textColor:'#172c24',headline:campaign.name,body:campaign.description,suggestedAmountsCents:[2500,5000,10000,25000],designations:[campaign.fund],employerEnabled:false,commentEnabled:false,questions:[]}
 if (!saved) return defaults
 const config = JSON.parse(saved.configuration)
 return {...defaults,...config,version:saved.version,questions:await questions(c,config.questions)}
}
export async function saveGivingForm(c: Context, campaignId: string, raw: Row) {
 requireRole(c.actor,['owner','admin'],'configure giving forms')
 const p = object(raw), campaign = await one(c,'SELECT * FROM cf_campaigns WHERE id=?',campaignId)
 if (!campaign) fail('NOT_FOUND','Choose an existing campaign.',404)
 const version = integer(Number(p.version),'Form version',0)
 const primaryColor = color(p.primaryColor,'Primary color'), backgroundColor = color(p.backgroundColor,'Background color'), textColor = color(p.textColor,'Text color')
 if (contrast(primaryColor,'#ffffff') < 4.5 || contrast(textColor,backgroundColor) < 4.5 || contrast(primaryColor,backgroundColor) < 4.5) fail('INPUT','Choose colors with at least 4.5:1 contrast for white button text, body text and links.',400)
 const logoUrl = optional(p.logoUrl,'Logo URL',200)
 if (logoUrl && logoUrl !== `/give/${campaign.slug}/media/image`) fail('INPUT','Use this campaign’s uploaded image as the logo.',400)
 if (!Array.isArray(p.designations) || !p.designations.length || p.designations.length > 50) fail('INPUT','Choose 1–50 fund designations.',400)
 const designations: string[] = p.designations.map((v: unknown)=>text(v,'Designation',100))
 if (new Set(designations).size !== designations.length || !designations.includes(campaign.fund)) fail('INPUT','Include the campaign fund once, with distinct designations.',400)
 let suggestedAmountsCents: number[]
 if (p.suggestedAmountsCents !== undefined) {
  if (!Array.isArray(p.suggestedAmountsCents)) fail('INPUT','Provide suggested amounts as a list.',400)
  suggestedAmountsCents = p.suggestedAmountsCents.map((v: unknown)=>integer(v,'Suggested amount in cents',100,10000000))
 } else {
  if (!Array.isArray(p.suggestedAmounts)) fail('INPUT','Provide suggested dollar amounts as a list.',400)
  suggestedAmountsCents = p.suggestedAmounts.map((v: unknown)=>integer(amount({amount:v},'amount','Suggested amount'),'Suggested amount in cents',100,10000000))
 }
 if (!suggestedAmountsCents.length || suggestedAmountsCents.length > 8 || new Set(suggestedAmountsCents).size !== suggestedAmountsCents.length) fail('INPUT','Provide 1–8 distinct suggested amounts.',400)
 const mapped = await questions(c,p.questions)
 const config = {logoUrl,primaryColor,backgroundColor,textColor,headline:text(p.headline,'Form headline',160),body:optional(p.body,'Form copy',2000)??'',suggestedAmountsCents,designations,employerEnabled:bool(p.employerEnabled,'Employer field'),commentEnabled:bool(p.commentEnabled,'Comment field'),questions:mapped.map(({key,label,required})=>({key,label,required}))}
 await commit(c,[
  guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND fund=? AND slug=?)','CAMPAIGN_CHANGED','This campaign changed. Reload its form.',campaignId,campaign.fund,campaign.slug),
  guard('COALESCE((SELECT version FROM cf_giving_forms WHERE campaign_id=?),0)=?','VERSION','This giving form changed. Reload before saving.',campaignId,version),
  ...(logoUrl?[guard("EXISTS(SELECT 1 FROM cf_campaign_media WHERE campaign_id=? AND kind='image')",'LOGO','Upload the campaign image before choosing it as the logo.',campaignId)]:[]),
  ...designations.filter(f=>f!==campaign.fund).map(f=>guard('EXISTS(SELECT 1 FROM cf_funds WHERE name=?)','FUND','Choose defined fund designations.',f)),
  ...mapped.map(q=>guard('EXISTS(SELECT 1 FROM cf_custom_fields WHERE key=? AND version=?)','VERSION','A mapped field changed. Reload the form.',q.key,q.version)),
  sql('INSERT INTO cf_giving_forms(campaign_id,version,configuration,updated_at) VALUES(?,?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET version=excluded.version,configuration=excluded.configuration,updated_at=excluded.updated_at',campaignId,version+1,JSON.stringify(config),c.now),
  event(c,'giving.form.save','campaign',campaignId,null,{version:version+1,questionKeys:mapped.map(q=>q.key)}),
 ])
 return getGivingForm(c,campaign)
}
