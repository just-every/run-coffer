import { one, type Context } from '../db'
import { personNames } from '../person-names'

/** Name calculation is shared with native records. The final record statement
 * refuses if a donor or the organization defaults changed after this read. */
export async function constituentReportNames(c:Context) {
 const source=(await one(c,`SELECT s.version,(SELECT revision FROM cf_score_clock WHERE id=1) AS revision,
  (SELECT json_group_array(json_object('id',d.id,'name',d.name,'prefix',d.prefix,'first_name',d.first_name,
   'middle_name',d.middle_name,'last_name',d.last_name,'suffix',d.suffix,'nickname',d.nickname,
   'informal_salutation',d.informal_salutation,'formal_salutation',d.formal_salutation,'envelope_name',d.envelope_name,
   'name_defaults',s.name_defaults)) FROM cf_donors d WHERE d.erased_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)) AS donors
  FROM cf_settings s WHERE s.id=1`))!
 const names=JSON.parse(source.donors).map((d:Record<string,unknown>)=>({id:d.id,...personNames(d)}))
 const columns={computed_informal_salutation:'informal',computed_formal_salutation:'formal',computed_envelope_name:'envelope'}
 return {
  guard:'(SELECT revision FROM cf_score_clock WHERE id=1)=? AND version=?',
  ctes:`builder_names AS MATERIALIZED (SELECT json_extract(value,'$.id') AS id,
   json_extract(value,'$.informal') AS informal,json_extract(value,'$.formal') AS formal,
   json_extract(value,'$.envelope') AS envelope FROM json_each(?)),`,
  params:[source.revision,source.version,JSON.stringify(names)],
  project:(query:string)=>Object.entries(columns).reduce((sql,[column,key])=>sql.replace(`NULL AS ${column}`,`(SELECT ${key} FROM builder_names WHERE id=d.id) AS ${column}`),query),
 }
}
