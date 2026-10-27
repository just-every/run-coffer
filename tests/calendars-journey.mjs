import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {fixedNow} from './fixed-clock.mjs'

export async function calendarsJourney() {
 const googleCalls=[],key='synthetic-coffer-1001',clientId='synthetic-coffer-2',clientSecret='synthetic-coffer-1003'
 const eventType='https://api.calendly.com/event_types/synthetic-coffer-4',bookingUrl='https://calendly.com/riverbend/donor-visit'
 const calendarEvent={id:'synthetic-coffer-5',summary:'Library proposal conversation',status:'confirmed',start:{dateTime:'2026-10-20T16:00:00Z'},end:{dateTime:'2026-10-20T16:30:00Z'}}
 let rejected=false,allDay=false
 const outbound=async request=>{
  const url=new URL(request.url)
  googleCalls.push({method:request.method,url:url.href})
  if(url.hostname==='oauth2.googleapis.com') {
   const p=new URLSearchParams(await request.text())
   assert.equal(p.get('client_id'),clientId);assert.equal(p.get('client_secret'),clientSecret)
   if(rejected)return Response.json({error:'invalid_grant'},{status:400})
   if(p.get('grant_type')==='authorization_code'){
    assert.equal(p.get('code'),'synthetic-coffer-6');assert.ok(p.get('redirect_uri').endsWith('/app/calendar/google/callback'))
    return Response.json({access_token:'synthetic-coffer-7',refresh_token:'synthetic-coffer-8',token_type:'Bearer',scope:'https://www.googleapis.com/auth/calendar.events.readonly'})
   }
   assert.equal(p.get('grant_type'),'refresh_token');assert.equal(p.get('refresh_token'),'synthetic-coffer-8')
   return Response.json({access_token:'synthetic-coffer-7',token_type:'Bearer'})
  }
  assert.equal(url.hostname,'www.googleapis.com');assert.equal(request.method,'GET');assert.equal(request.headers.get('authorization'),'Bearer synthetic-coffer-7')
  if(url.pathname.endsWith('/events'))return Response.json({items:[calendarEvent],nextPageToken:'synthetic-coffer-9'})
  assert.equal(url.pathname,'/calendar/v3/calendars/primary/events/'+calendarEvent.id)
  return Response.json(allDay?{...calendarEvent,start:{date:'2026-10-20'},end:{date:'2026-10-21'}}:calendarEvent)
 }
 await run(async h=>{
  await reviewed(h)
  const d={...await donor(h,'Ada Mercer'),email:'ada.mercer@example.org'},other={...await donor(h,'Rosa Chen'),email:'rosa.chen@example.org'},member=await h.person('calendar-staff@example.test')
  const agent=await h.command('agent.create',{label:'Calendar refusal'}),asAgent={as:'',headers:{authorization:'Bearer '+agent.token},status:403}
  const configure={clientId,clientSecret,confirm:'yes'},book={bookingUrl,eventType,signingKey:key,confirm:'yes'}
  for(const [command,input] of [['calendar.configure',configure],['booking.configure',book],['calendar.start',{confirm:'yes'}],['booking.link',{donorId:d.id,confirm:'yes'}]])await h.command(command,input,{as:'',status:401})
  await h.command('calendar.configure',configure,{as:member.cookie,status:403});await h.command('booking.configure',book,{as:member.cookie,status:403})
  await h.command('calendar.start',{confirm:'yes'},asAgent);await h.get('/api/coffer/calendar',asAgent)
  await h.command('calendar.configure',{...configure,confirm:''},{status:400})
  await h.command('calendar.configure',configure)
  await h.command('calendar.start',{}, {status:400})
  const authorize=async(as=h.owner)=>{
   const started=await h.command('calendar.start',{confirm:'yes'},{as}),url=new URL(started.authorizeUrl)
   assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('scope'),'https://www.googleapis.com/auth/calendar.events.readonly');assert.equal(url.searchParams.get('access_type'),'offline')
   return '/app/calendar/google/callback?'+new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-coffer-6'})
  }
  const callback=await authorize(member.cookie)
  assert.equal((await h.request(callback)).status,409,'Another staff member cannot consume the OAuth state')
  assert.equal((await h.request(callback,{as:member.cookie})).status,303)
  assert.equal((await h.request(callback,{as:member.cookie})).status,409,'OAuth state is single use')
  assert.equal((await h.get('/api/coffer/calendar',{as:member.cookie})).connected,true)
  assert.equal((await h.get('/api/coffer/calendar')).connected,false,'Calendar credentials are personal')
  const listing=await h.get('/api/coffer/calendar/events',{as:member.cookie})
  assert.deepEqual(listing.events,[{id:calendarEvent.id,summary:'Library proposal conversation',startsAt:'2026-10-20T16:00:00.000Z',endsAt:'2026-10-20T16:30:00.000Z'}]);assert.equal(listing.nextPageToken,'synthetic-coffer-9')
  const log={donorId:d.id,eventId:calendarEvent.id,confirm:'yes'}
  await h.command('calendar.log',{...log,confirm:''},{as:member.cookie,status:400})
  allDay=true;await h.command('calendar.log',log,{as:member.cookie,status:409});allDay=false
  rejected=true;await h.command('calendar.log',log,{as:member.cookie,status:502});rejected=false
  assert.equal((await h.get('/api/coffer/meetings')).length,0,'Rejected and all-day calendar events create no meeting')
  const logged=await h.command('calendar.log',log,{as:member.cookie})
  assert.equal(logged.startsAt,'2026-10-20T16:00:00.000Z');assert.equal(logged.prepareAt,'2026-10-19T16:00:00.000Z')
  assert.equal((await h.command('calendar.log',log,{as:member.cookie})).id,logged.id)
  await h.command('calendar.log',{...log,donorId:other.id},{as:member.cookie,status:409})
  assert.deepEqual((await h.get('/api/coffer/donors/'+d.id)).timelineSources.filter(x=>x.kind==='meeting').map(x=>[x.id,x.title,x.day]),[[logged.id,'Google Calendar meeting','2026-10-20']])
  const interaction=await h.command('interaction.record',{donorId:d.id,kind:'meeting',occurredOn:'2026-10-17',who:'Morgan Lee',notes:'Ada reviewed the library proposal and asked for a Saturday visit.'},{as:member.cookie})
  assert.deepEqual((await h.get('/api/coffer/donors/'+d.id)).depth.interactions.map(x=>[x.id,x.kind,x.notes]),[[interaction.id,'meeting','Ada reviewed the library proposal and asked for a Saturday visit.']])
  await h.command('booking.configure',{...book,confirm:''},{status:400});await h.command('booking.configure',book)
  const createLink=()=>h.command('booking.link',{donorId:d.id,confirm:'yes'},{as:member.cookie})
  const link=await createLink(),tracking=new URL(link.url).searchParams.get('utm_content')
  assert.equal(new URL(link.url).origin,'https://calendly.com');assert.equal(new URL(link.url).pathname,'/riverbend/donor-visit');assert.ok(tracking.length>60);assert.ok(!link.url.includes(d.id)&&!link.url.includes(d.email))
  const message={event:'invitee.created',payload:{uri:'https://api.calendly.com/scheduled_events/synthetic-coffer-10/invitees/synthetic-coffer-11',event:'https://api.calendly.com/scheduled_events/synthetic-coffer-10',status:'active',email:d.email,tracking:{utm_content:tracking},scheduled_event:{uri:'https://api.calendly.com/scheduled_events/synthetic-coffer-10',event_type:eventType,status:'active',start_time:'2026-10-22T02:00:00Z',end_time:'2026-10-22T02:30:00Z'}}}
  const post=async(value=message,{status=200,signatureKey=key,stamp=Math.floor(Date.parse(fixedNow)/1000),raw=JSON.stringify(value),headers={}}={})=>h.api('/api/coffer/calendar/bookings',undefined,{as:'',method:'POST',raw,headers:{'Calendly-Webhook-Signature':`t=${stamp},v1=${createHmac('sha256',signatureKey).update(stamp+'.'+raw).digest('hex')}`,...headers},status})
  await post(message,{signatureKey:'synthetic-coffer-12',status:400});await post(message,{stamp:Math.floor(Date.parse(fixedNow)/1000)-181,status:400})
  await post({...message,payload:{...message.payload,email:other.email}},{status:409})
  await post({...message,payload:{...message.payload,scheduled_event:{...message.payload.scheduled_event,event_type:'https://api.calendly.com/event_types/synthetic-coffer-13'}}},{status:409})
  await post({...message,payload:{...message.payload,tracking:{utm_content:'synthetic-coffer-14'}}},{status:409})
  await post({...message,payload:{...message.payload,status:'canceled'}},{status:409})
  await post({...message,event:'invitee.canceled'})
  assert.equal((await h.get('/api/coffer/meetings')).length,1,'Unsafe and non-created events add no meeting')
  const received=await post()
  assert.equal(received.duplicate,false)
  assert.equal((await post()).duplicate,true)
  const meetings=await h.get('/api/coffer/meetings'),booked=meetings.find(m=>m.id===received.meetingId)
  assert.deepEqual(meetings.map(m=>m.id).sort(),[logged.id,received.meetingId].sort())
  assert.deepEqual([booked.donor_id,booked.starts_at,booked.prepare_at,booked.source],[d.id,'2026-10-22T02:00:00.000Z','2026-10-21T02:00:00.000Z','calendly'])
  const tasks=(await h.get('/api/coffer/tasks')).tasks
  assert.deepEqual(tasks.map(t=>[t.id,t.donor_id,t.owner_id,t.due_on,t.task_kind,t.is_ask]),[[received.taskId,d.id,member.id,'2026-10-20','follow_up',0]],'Preparation task uses the organization day 24 hours before the meeting, even across a UTC date')
  const timeline=(await h.get('/api/coffer/donors/'+d.id)).timelineSources
  assert.deepEqual(timeline.filter(t=>t.kind==='meeting').map(t=>t.id).sort(),[logged.id,received.meetingId].sort());assert.ok(timeline.some(t=>t.kind==='task'&&t.id===received.taskId))
  const file=await h.api('/api/coffer/donors/'+d.id+'/data-request',{requestedOn:'2026-10-17',method:'email'})
  assert.equal(file.records.donor_meetings.length,2);assert.ok(!file.records.meeting_links)
  assert.doesNotMatch(JSON.stringify(file),new RegExp(tracking+'|'+key+'|'+clientSecret))
  const backup=await archive(h)
  assert.doesNotMatch(JSON.stringify(backup),new RegExp(tracking+'|'+key+'|'+clientSecret+'|synthetic-coffer-8'))
  await run(async fresh=>{
   await restore(fresh,backup)
   assert.deepEqual((await fresh.get('/api/coffer/meetings')).map(m=>m.id).sort(),[logged.id,received.meetingId].sort())
   assert.equal((await fresh.get('/api/coffer/calendar')).connected,false);assert.equal((await fresh.get('/api/coffer/calendar')).booking.configured,false)
   assert.deepEqual((await fresh.get('/api/coffer/tasks')).tasks.map(t=>t.id),[received.taskId])
  },{entry:'tests/fixed-clock-worker.ts'})
  if(process.env.COFFER_CALENDARS_BROWSER){const {calendarsBrowser}=await import('./calendars-browser.mjs');await calendarsBrowser(h,{directory:process.env.COFFER_CALENDARS_BROWSER,donorId:d.id,configure,book,calendarEvent,member})}
  const source=(await h.get('/api/coffer/donors/'+d.id)).donor,target=(await h.get('/api/coffer/donors/'+other.id)).donor
  const merge=await h.command('donor.merge',{sourceDonorId:d.id,donorId:other.id,sourceVersion:source.version,version:target.version,reason:'duplicate_record'})
  assert.equal((await h.get('/api/coffer/meetings')).find(m=>m.id===received.meetingId).donor_id,other.id)
  await post(message,{status:401})
  await h.command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'})
  assert.equal((await h.get('/api/coffer/meetings')).find(m=>m.id===received.meetingId).donor_id,d.id)
  await post(message,{status:401})
  const revoked=await createLink();await h.command('booking.revoke',{donorId:d.id,id:revoked.id},{as:member.cookie})
  await post({...message,payload:{...message.payload,tracking:{utm_content:new URL(revoked.url).searchParams.get('utm_content')}}},{status:401})
  await h.command('calendar.disconnect',{}, {as:member.cookie})
  assert.equal((await h.get('/api/coffer/calendar',{as:member.cookie})).connected,false)
  await h.get('/api/coffer/calendar/events',{as:member.cookie,status:409})
  await h.command('donor.erase',{donorId:d.id,confirm:'ERASE'})
  assert.equal((await h.get('/api/coffer/meetings')).length,0)
  assert.equal((await h.get('/api/coffer/tasks')).tasks.length,0)
  await post(message,{status:409})
  assert.ok(googleCalls.some(call=>call.url.includes('/token'))&&googleCalls.some(call=>call.url.includes('/events')))
 },{entry:'tests/fixed-clock-worker.ts',outbound})
}
