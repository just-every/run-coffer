import { requireRole } from './auth'
import { all, commit, event, fail, guard, integer, one, optional, sql, text, type Context, type Row } from './db'

export async function tagCatalog(c:Context){
 requireRole(c.actor,['owner','admin'],'read tag definitions')
 const [categories,tags]=await Promise.all([all(c,'SELECT * FROM cf_tag_categories ORDER BY name'),all(c,'SELECT * FROM cf_tag_definitions ORDER BY name')])
 return {categories,tags}
}
export async function tagCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(command!=='tag.category'&&command!=='tag.define')return
 requireRole(c.actor,['owner','admin'],'define tags and categories')
 const name=text(p.name,command==='tag.category'?'Category':'Tag',100),table=command==='tag.category'?'cf_tag_categories':'cf_tag_definitions',existing=await one(c,`SELECT * FROM ${table} WHERE name=?`,name),version=existing?integer(Number(p.version),'Version',1):0
 const category=command==='tag.define'?optional(p.category,'Category',100):null
 if(category&&!await one(c,'SELECT 1 FROM cf_tag_categories WHERE name=?',category))fail('INPUT','Choose a defined category.',400)
 await commit(c,[...(existing?[guard(`EXISTS(SELECT 1 FROM ${table} WHERE name=? AND version=?)`,'VERSION','This definition changed.',name,version),sql(`UPDATE ${table} SET version=version+1${command==='tag.define'?',category=?':''} WHERE name=?`,...(command==='tag.define'?[category,name]:[name]))]:[command==='tag.define'?sql('INSERT INTO cf_tag_definitions(name,category) VALUES(?,?)',name,category):sql('INSERT INTO cf_tag_categories(name) VALUES(?)',name)]),event(c,command,'tag_definition',name,null,{category,version:version+1})])
 return {name,version:version+1}
}
