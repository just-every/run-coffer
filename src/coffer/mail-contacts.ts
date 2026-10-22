import { contactSelection } from './contact-points'
import { all, today, type Context, type Row } from './db'
import { settings } from './settings'
/** Batch selection avoids a request per constituent. Chosen types never fall
 * back during delivery. Passes may check the ordinary address of other genuine
 * constituents to meet the licensee's real-list minimum. */
export async function mailContactRows(c:Pick<Context,'db'>&{now?:string},rows:Row[],options:{addressType?:string;emailType?:string;pass?:boolean}={}):Promise<Row[]>{
 const s=await settings(c),day=today(s.timezone,new Date(c.now??new Date().toISOString())),points=await all(c,'SELECT * FROM cf_contact_points WHERE active=1 AND donor_id IN(SELECT value FROM json_each(?))',JSON.stringify(rows.map(r=>r.id)))
 const byDonor=new Map<string,Row[]>()
 for(const point of points){const own=byDonor.get(point.donor_id)??[];own.push(point);byDonor.set(point.donor_id,own)}
 return rows.map(d=>{const own=byDonor.get(d.id)??[],selected=contactSelection(d,own,day,options);return options.pass&&!selected.address_line1?contactSelection(d,own,day):selected})
}
