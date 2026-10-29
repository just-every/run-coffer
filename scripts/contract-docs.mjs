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
// Claim copy remains owner-owned. Only the reviewed backing and status of a
// touched mapping change; all other claim rows retain their approved source.
let claims=readFileSync('docs/CLAIMS.md','utf8')
const claimMappings={
 'GIVE-004':{
  24:['partly','Card and Link use Stripe Checkout on the installation’s own account, once or on a subscription; Apple Pay is offered on eligible devices. Ordinary one-time campaign forms now offer hosted ACH with instant verification requested, current-state settlement and return reconciliation. Live ACH qualification and broader bank, wallet and PayPal acceptance remain owed (`GIVE-004`, `tests/ach-checkout-journey.mjs`).'],
  31:['partly','The native bank checkout stays pending without a gift, receipt, recognition or raised total until independently verified success; a late insufficient-funds return appends a reversal and an owned non-ask task. A predicted clearing date and live settlement qualification remain unclaimed (`GIVE-004`, `tests/ach-checkout-journey.mjs`, `tests/ach-checkout-browser.mjs`).'],
 },
}
for(const id of ids)if(claims.includes('`'+id+'`')){
 const mapping=claimMappings[id]
 if(!mapping)throw Error('A changed homepage claim needs its mapped source generator: '+id)
 claims=claims.split('\n').map(line=>{
  const cells=line.split('|').map(cell=>cell.trim()),entry=mapping[Number(cells[1])]
  return entry?`| ${cells[1]} | ${cells[2]} | ${cells[3]} | ${entry[0]} | ${entry[1]} |`:line
 }).join('\n')
}
const claimRows=claims.split('\n').map(line=>line.split('|').map(cell=>cell.trim())).filter(cells=>/^\d+$/.test(cells[1]??''))
claims=claims.replace(/^\*\*Totals:[^\n]*/m,`**Totals: ${claimRows.length} claims · ${claimRows.filter(row=>row[4]==='in code').length} in code · ${claimRows.filter(row=>row[4]==='partly').length} partly · ${claimRows.filter(row=>row[4]==='contract, not yet in code').length} contract, not yet in code.**`)
for(const [path,expected]of [['CONTRACT.md',contract],['ACCEPTANCE.md',acceptance],['docs/CLAIMS.md',claims]]){
 if(mode==='write'){if(readFileSync(path,'utf8')!==expected)writeFileSync(path,expected)}
 else if(readFileSync(path,'utf8')!==expected)throw Error('Stale generated contract view: '+path)
}
console.log('Contract views '+mode+' passed for '+ids.join(', '))
