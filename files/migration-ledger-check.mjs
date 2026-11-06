import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
const root=process.cwd(),tool=path=>pathToFileURL(join(root,'node_modules/@runeditrun/rer',path)).href
const {migrationInventory}=await import(tool('cli/portability-migrations.mjs'))
const {matchMigrationLedger}=await import(tool('modules/portability/ledgers.mjs'))
const files=await migrationInventory(root,'DB',{}),directory=await mkdtemp(join(tmpdir(),'coffer-ledger-'))
try{
 const run=(...args)=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1',...args,'--local','--persist-to',directory,'--config','wrangler.jsonc'],{encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}})
 run('migrations','apply','foundation')
 const result=JSON.parse(run('execute','foundation','--command','SELECT name FROM d1_migrations ORDER BY id','--json'))
 const entries=result.flatMap(row=>row.results)
 assert.deepEqual(matchMigrationLedger(entries,files),files.map(file=>file.name))
 const parent=execFileSync('git',['ls-tree','-r','--name-only','origin/main','--','migrations/core'],{encoding:'utf8'}).trim().split('\n')
 for(const path of parent){const before=execFileSync('git',['show','origin/main:'+path]);assert.deepEqual(await readFile(path),before,'Published migration bytes retained: '+path)}
 const receipt={command:'node migration-ledger-check.mjs',exit:0,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:files.length,applied:entries.length,retainedParentFiles:parent.length,newMigration:files.find(row=>row.name==='0187_coffer_appeal_email_sources.sql'),inventorySha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')}
 await writeFile(new URL('migration-ledger.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n')
 console.log(JSON.stringify(receipt))
}finally{await rm(directory,{recursive:true,force:true})}
