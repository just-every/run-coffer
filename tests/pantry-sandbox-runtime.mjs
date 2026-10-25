// Real Pantry process and native browser session. Credentials never leave memory.
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {chromium} from '@playwright/test'
import assert from 'node:assert/strict'
const execute=promisify(execFile)

async function stopOwnedTree(root){
 const {stdout}=await execute('ps',['-axo','pid=,ppid='])
 const rows=stdout.trim().split('\n').map(x=>x.trim().split(/\s+/).map(Number)),owned=new Set([root])
 for(let changed=true;changed;){changed=false;for(const [pid,parent] of rows)if(owned.has(parent)&&!owned.has(pid)){owned.add(pid);changed=true}}
 for(const pid of [...owned].reverse())try{process.kill(pid,'SIGTERM')}catch{}
}

export async function startPantry(checkout){
 // Invoke this journey under the repository's heavy-slot wrapper; keep real HOME.
 const env={...process.env};delete env.STRIPE_SECRET_KEY
 const child=spawn('rer',['dev'],{cwd:checkout,env,stdio:['ignore','pipe','pipe']})
 let output='',ready='',open='',ended=false,browser
 child.on('error',()=>{ended=true});child.on('exit',()=>{ended=true})
 const collect=chunk=>{
  output=(output+chunk.toString()).slice(-1_000_000)
  ready=/RER_READY\s+(https?:\/\/\S+)/.exec(output)?.[1]??ready
  open=/RER_OPEN\s+(https?:\/\/\S+)/.exec(output)?.[1]??open
 }
 child.stdout.on('data',collect);child.stderr.on('data',collect)
 const progress=setInterval(()=>console.log('Pantry startup in progress; private output retained in memory.'),30_000)
 try{
  const until=Date.now()+600_000
  while(!open&&Date.now()<until){assert.ok(!ended,`Pantry startup ended before readiness${output.includes('RER_')?' after runner progress':''}`);await new Promise(r=>setTimeout(r,500))}
  assert.ok(open&&ready,'Pantry startup exceeded ten minutes')
  clearInterval(progress)
  browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true})
  const page=await context.newPage(),origin=new URL(ready).origin
  await page.goto(open,{timeout:120_000});open='';output=''
  if(new URL(page.url()).pathname==='/setup'){
   await page.locator('input[name=confirm]').check()
   await page.getByRole('button',{name:'Finish setup',exact:true}).click()
   await page.waitForURL('**/app')
  }
  const api=async(path,body)=>{
   const response=await context.request.fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{origin},...(body===undefined?{}:{data:body})})
   assert.equal(response.status(),200,`Pantry HTTP request refused: ${path}`)
   return response.json()
  }
  return {page,context,origin,api,command:(op,body={})=>api('/api/pantry/command/'+op,body),async close(){await browser.close();await stopOwnedTree(child.pid)}}
 }catch(error){if(browser)await browser.close();if(child.pid)await stopOwnedTree(child.pid);throw error}
 finally{clearInterval(progress)}
}

export async function controlTooltips(page){
 for(const control of await page.locator('a,button').all()){
  if(!await control.isVisible())continue
  const info=await control.evaluate(el=>({text:el.innerText.trim(),tip:el.querySelector('[role="tooltip"]')?.textContent?.trim()}))
  if(info.text&&!info.tip)continue
  assert.ok(info.tip,'An icon-only control needs a tooltip')
  await control.focus()
  assert.equal(await control.locator('[role="tooltip"]').evaluate(el=>getComputedStyle(el).visibility),'visible')
  await control.hover();await page.waitForTimeout(350)
  assert.equal(await control.locator('[role="tooltip"]').evaluate(el=>getComputedStyle(el).visibility),'visible')
 }
}
