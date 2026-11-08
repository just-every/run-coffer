import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const {collectMigrations}=await import(pathToFileURL(resolve('scripts/delivery/base/migrations.mjs')))
const rows=await collectMigrations(process.cwd(),[{binding:'DB',path:'migrations/core'}],[{kind:'d1',binding:'DB'}])
const main=execFileSync('git',['ls-tree','-r','--name-only','origin/main','--','migrations/core'],{encoding:'utf8'}).trim().split('\n').filter(p=>p.endsWith('.sql'))
for(const path of main){
 const saved=execFileSync('git',['show','origin/main:'+path])
 const current=rows.find(r=>r.name===path.split('/').at(-1))
 if(!current||current.sha256!==createHash('sha256').update(saved).digest('hex'))throw Error('Changed applied migration '+path)
}
console.log(JSON.stringify({status:'pass',unchangedMainMigrations:main.length,totalMigrations:rows.length,added:rows.filter(r=>!main.some(p=>p.endsWith('/'+r.name))).map(({name,sha256})=>({name,sha256}))},null,2))
