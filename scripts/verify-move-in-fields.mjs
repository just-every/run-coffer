import {spawn} from 'node:child_process'

// Each importer owns a separate installation. Await both complete public-door
// journeys so the existing shard deadline covers their longest path.
const results=await Promise.all(['^MOVE-005:','^MOVE-001:'].map(pattern=>new Promise(resolve=>{
 const args=['--test','--test-concurrency=1','--test-name-pattern='+pattern,'tests/move-in.test.mjs']
 console.log('> node '+args.join(' '))
 const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env})
 child.once('error',error=>{console.error(error);resolve(1)})
 child.once('exit',(code,signal)=>{if(signal)console.error('Importer journey stopped by '+signal);resolve(code??1)})
})))
process.exitCode=results.some(code=>code!==0)?1:0
