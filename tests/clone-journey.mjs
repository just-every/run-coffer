import {execFileSync,spawn} from 'node:child_process'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
import {browserJourney} from './browser-journey.mjs'
// Nightly: a fresh clone of this checkout, started with the README's `rer dev`,
// then the whole first-week journey in Chromium.
const require=createRequire(import.meta.url),launcher=require.resolve('@runeditrun/rer/internal/global/rer.mjs'),directory=await mkdtemp(join(tmpdir(),'coffer-clone-')),checkout=join(directory,'app')
const invoke=args=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[launcher,...args],{env:{...process.env,RER_BROWSER:'none'},stdio:['ignore','ignore','ignore']});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Fresh-clone command failed (exit ${code}); private launcher log withheld.`)))})
try {
 execFileSync('git',['clone','--quiet','--no-local',resolve('.'),checkout],{stdio:'pipe'})
 await invoke(['dev','--cwd',checkout,'--detach'])
 const open=await readFile(join(checkout,'.rer/local/open-url'),'utf8')
 await browserJourney(open.trim(),{directory:process.env.COFFER_SCREENSHOTS??'.cache/clone-browser',fixtures:join(checkout,'tests/fixtures/stripe')})
}finally{await invoke(['dev','--cwd',checkout,'--stop']).catch(()=>{});await rm(directory,{recursive:true,force:true})}
