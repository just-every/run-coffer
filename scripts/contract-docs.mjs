import {readFileSync,writeFileSync} from 'node:fs'
import {parseContract} from '../src/base/seed-contract.mjs'

// Maintain this seed's existing legacy views without a contract-format migration.
const [mode,...ids]=process.argv.slice(2)
if(!['write','check'].includes(mode)||!ids.length)throw Error('Usage: contract-docs.mjs write|check CLAUSE...')
const original=readFileSync('CONTRACT.md','utf8'),rows=original.split('\n').filter(line=>/^\| `[^`]+` \|/.test(line)).map(line=>line.split('|').map(cell=>cell.trim()))
const statusRows=rows.filter(r=>['published','target','push-further'].includes(r[3])&&['done','partial','missing'].includes(r[4]))
const counts=(group)=>[...['done','partial','missing'].map(status=>group.filter(row=>row[4]===status).length),group.length]
const summary=[['Published',statusRows.filter(r=>r[3]==='published')],['Target and push further',statusRows.filter(r=>r[3]!=='published')],['All',statusRows]].map(([label,group])=>`| ${label} | ${counts(group).join(' | ')} |`).join('\n')
const replaceSummary=text=>text.replace(/^\| Published \|[^\n]*\n\| Target and push further \|[^\n]*\n\| All \|[^\n]*/m,summary)
let contract=replaceSummary(original)
// Claim status summaries derive from the same touched Status rows.
for(const id of ids){
 const source=statusRows.find(row=>row[1]==='`'+id+'`')
 if(source)contract=contract.replace(new RegExp('(`'+id+'`) (done|partial|missing)(?= · | [|])','g'),(_,clause)=>clause+' '+source[4])
}
const parsed=parseContract(contract),lines=contract.split('\n')
let acceptance=replaceSummary(readFileSync('ACCEPTANCE.md','utf8'))
acceptance=acceptance.replace(/^Judged from[^\n]*/m,contract.split('\n').find(line=>line.startsWith('Judged from')))
for(const id of ids){
 const clause=parsed.clauses.find(c=>c.id===id)
 if(!clause)throw Error('Unknown clause '+id)
 const row=lines[clause.row-1].split('|').map(cell=>cell.trim()),evidence=row[5],point=clause.text.split('*Acceptance:*')[1]?.trim()
 if(!point)throw Error('Clause has no acceptance '+id)
 const requirement=clause.text.split('*Acceptance:*')[0].trim()
 const pattern=new RegExp('^([0-9]+\\. )\\*\\*`'+id+'`[^\\n]*','m')
 if(!pattern.test(acceptance))throw Error('Acceptance view has no clause '+id)
 acceptance=acceptance.replace(pattern,(_,number)=>`${number}**\`${id}\` ${clause.title}** (${clause.status}). ${point} Requirement: ${requirement}${evidence?' Evidence: '+evidence+'.':''}${clause.gap?' Remaining: '+clause.gap:''}`)
}
// Homepage claim text is owner-owned. Neither target is referenced by a current
// claim, so its generated legacy view has no dependency that changes this round.
const claims=readFileSync('docs/CLAIMS.md','utf8')
for(const id of ids)if(claims.includes('`'+id+'`'))throw Error('A changed homepage claim needs its mapped source generator: '+id)
for(const [path,expected]of [['CONTRACT.md',contract],['ACCEPTANCE.md',acceptance],['docs/CLAIMS.md',claims]]){
 if(mode==='write'){if(readFileSync(path,'utf8')!==expected)writeFileSync(path,expected)}
 else if(readFileSync(path,'utf8')!==expected)throw Error('Stale generated contract view: '+path)
}
console.log('Contract views '+mode+' passed for '+ids.join(', '))
