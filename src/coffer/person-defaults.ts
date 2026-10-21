import { all, choice, commit, event, fail, guard, integer, one, sha256, sql, type Context, type Row } from './db'
import { personNames } from './person-names'

const query = `SELECT id,version,name,prefix,first_name,middle_name,last_name,suffix,nickname,informal_salutation,formal_salutation,envelope_name FROM cf_donors WHERE constituent_kind='person' AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=cf_donors.id) ORDER BY id`
export async function withNameDefaults(c:{db:D1Database}, d:Row):Promise<Row> {
 return {...d,name_defaults:(await one(c,'SELECT name_defaults FROM cf_settings WHERE id=1'))!.name_defaults}
}
export async function personDefaultsCommand(c:Context, command:string, p:Row):Promise<Row|undefined> {
 if(!['person.defaultsPreview','person.defaults'].includes(command))return undefined
 const formats={informal:choice(p.informal,['nickname-first','nickname-only','first','full'] as const,'informal name format'),formal:choice(p.formal,['prefix-last','first-last','full'] as const,'formal name format'),envelope:choice(p.envelope,['initial','full','no-prefix'] as const,'envelope name format')}
 const s=(await one(c,'SELECT version,name_defaults FROM cf_settings WHERE id=1'))!,clock=(await one(c,'SELECT revision FROM cf_person_name_clock WHERE id=1'))!,rows=await all(c,query)
 if((await one(c,'SELECT revision FROM cf_person_name_clock WHERE id=1'))!.revision!==clock.revision)fail('VERSION','Names changed while previewing. Preview again.')
 const nameDefaults=JSON.stringify(formats),changed=rows.filter(d=>JSON.stringify(personNames({...d,name_defaults:s.name_defaults}))!==JSON.stringify(personNames({...d,name_defaults:nameDefaults}))).length
 const fingerprint=await sha256(JSON.stringify([s.version,clock.revision,formats]))
 if(command==='person.defaultsPreview')return {version:s.version,changed,fingerprint,...formats}
 const version=integer(Number(p.version),'Version',1)
 if(p.fingerprint!==fingerprint||version!==s.version)fail('VERSION','Names or settings changed. Preview the count again.')
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)','VERSION','Settings changed. Preview again.',version),
 guard('EXISTS(SELECT 1 FROM cf_person_name_clock WHERE id=1 AND revision=?)','VERSION','Names changed. Preview again.',clock.revision),
 sql('UPDATE cf_settings SET name_defaults=?,version=version+1 WHERE id=1',nameDefaults),event(c,command,'settings','1',null,{changed})])
 return {version:version+1,changed}
}
