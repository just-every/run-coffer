for (const form of document.querySelectorAll('form[data-task-setting]')) {
 const button=form.querySelector('button'),status=document.createElement('p')
 status.setAttribute('role','status');form.append(status);button.remove()
 form.addEventListener('change',async()=>{
  if(form.dataset.saving)return
  const values=Object.fromEntries(new FormData(form)),command=values.command;delete values.command
  const controls=[...form.querySelectorAll('select,input:not([type=hidden])')]
  form.dataset.saving='1';status.textContent='Saving…';for(const control of controls)control.disabled=true
  try {
   const response=await fetch('/api/coffer/commands',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,input:values})})
   const result=await response.json()
   if(!response.ok)throw Error(result.message||'Could not save this change.')
   form.elements.version.value=String(result.version);status.textContent='Saved'
  }catch(error){status.textContent=error.message+' Your selection is kept.'}
  finally{delete form.dataset.saving;for(const control of controls)control.disabled=false}
 })
}
