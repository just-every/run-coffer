for(const form of document.querySelectorAll('[data-campaign-video]')){
 form.addEventListener('submit',async event=>{
  event.preventDefault()
  const status=form.querySelector('[data-video-status]'),button=form.querySelector('button'),input=form.querySelector('[name=video]'),file=input.files[0]
  if(!file)return
  if(file.type!=='video/mp4'||file.size<24||file.size>100*1024*1024){status.textContent='Choose an MP4 video up to 100 MiB.';return}
  if(!form.querySelector('[name=publicMedia]').checked){status.textContent='Confirm that this video and its metadata may be public.';return}
  button.disabled=true;status.textContent='Uploading video. Keep this page open.'
  try{
   const response=await fetch('/api/coffer/giving/campaigns/'+encodeURIComponent(form.querySelector('[name=campaignId]').value)+'/video',{
    method:'POST',headers:{'content-type':'video/mp4','x-coffer-public-media':'yes','x-coffer-video-description':encodeURIComponent(form.querySelector('[name=videoDescription]').value)},body:file,
   })
   const result=await response.json()
   if(!response.ok)throw Error(result.message||'The video upload was refused.')
   status.textContent='Video uploaded. '
   const link=document.createElement('a');link.href='/give/'+encodeURIComponent(result.slug);link.textContent='Open campaign page';status.append(link)
   input.value=''
  }catch(error){status.textContent=error instanceof Error?error.message:'The video upload could not be confirmed. Reload the campaign before trying again.'}
  finally{button.disabled=false}
 })
}
