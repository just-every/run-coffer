// Synchronize status metadata while preserving the existing narrative views.
import {readFile,writeFile} from 'node:fs/promises'
import {parseContract} from '../node_modules/@runeditrun/rer/foundation/runtime/seed-contract.mjs'

const [mode,...touched]=process.argv.slice(2)
if(!['write','check'].includes(mode))throw Error('Use write or check followed by the touched clause IDs.')
const source=await readFile('CONTRACT.md','utf8')
const rows=[...source.matchAll(/^\| `([^`]+)` \| ([^|]+) \| (published|target|push-further) \| (done|partial|missing) \|/gm)].map(m=>({id:m[1],kind:m[3],status:m[4]}))
if(!rows.length)throw Error('No Status rows found')
for(const id of touched)if(!rows.some(row=>row.id===id))throw Error('Unknown touched clause '+id)
function summaries(text){
 return text.replace(/^\| (Published|Target and push further|All) \| \d+ \| \d+ \| \d+ \| \d+ \|$/gm,(_,label)=>{
  const selected=rows.filter(row=>label==='All'||(label==='Published'?row.kind==='published':row.kind!=='published'))
  return '| '+label+' | '+['done','partial','missing'].map(state=>selected.filter(row=>row.status===state).length).join(' | ')+' | '+selected.length+' |'
 })
}
const contract=summaries(source)
parseContract(contract)
const acceptance=await readFile('ACCEPTANCE.md','utf8'),claims=await readFile('docs/CLAIMS.md','utf8')
let generated=summaries(acceptance)
for(const row of rows){
 const id=row.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
 generated=generated.replace(new RegExp('(\\*\\*`'+id+'`[^\\n]*?\\*\\* \\()(?:done|partial|missing)(\\))','g'),'$1'+row.status+'$2')
 generated=generated.replace(new RegExp('(`'+id+'`, )(?:done|partial|missing)','g'),'$1'+row.status)
}
// Homepage claims have their own evidence and status vocabulary. Preserve them;
// clause status metadata is synchronized only where an explicit reference exists.
let generatedClaims=claims
for(const row of rows)generatedClaims=generatedClaims.replace(new RegExp('(`'+row.id+'` )(?:done|partial|missing)','g'),'$1'+row.status)
for(const [path,before,after] of [['CONTRACT.md',source,contract],['ACCEPTANCE.md',acceptance,generated],['docs/CLAIMS.md',claims,generatedClaims]]){
 if(before===after)continue
 if(mode==='check')throw Error(path+' has stale contract metadata; run write with the touched clause IDs.')
 await writeFile(path,after)
}
console.log('Contract metadata '+mode+' passed; '+rows.length+' Status rows retained.')
