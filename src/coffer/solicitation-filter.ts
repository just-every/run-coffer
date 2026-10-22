import { choice } from './db'
export const SOLICITATION_FILTERS=[['','All solicitation choices'],['any','Any active restriction'],['none','No active restriction'],['stop','Do not solicit'],['channels','Channel restrictions'],['limit','Ask limits']] as [string,string][]
export const solicitationFilter=(value:unknown)=>choice(value||'',SOLICITATION_FILTERS.map(([v])=>v),'solicitation filter')
/** Effective restrictions include merged originals; start/end days are inclusive. */
export function solicitationFilterSql(donor:string,value:string,day:string){
 const active=`SELECT 1 FROM cf_solicitation sr WHERE (sr.donor_id=${donor} OR EXISTS(SELECT 1 FROM cf_donor_merges sm WHERE sm.donor_id=sr.donor_id AND sm.into_id=${donor})) AND sr.type<>'none' AND sr.starts_on<=${day} AND (sr.ends_on IS NULL OR sr.ends_on>=${day})`
 return `(COALESCE(${value},'')='' OR CASE WHEN ${value}='none' THEN NOT EXISTS(${active}) ELSE EXISTS(${active} AND (${value}='any' OR sr.type=${value})) END)`
}
