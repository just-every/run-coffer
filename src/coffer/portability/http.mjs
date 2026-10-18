import { createPortability, MAX_LINE_BYTES, PortabilityError } from '@runeditrun/rer/modules/portability';
import { boundedJson } from '@runeditrun/rer/modules/portability/http';
import { insist } from '@runeditrun/rer/modules/portability/storage';
import { wireDatabase } from '@runeditrun/rer/internal/modules/d1-transport/index.mjs';
import { reasonFor } from './reasons.mjs';
import { initializeUploads, receivePart, drainUploads, importStatus, cleanUploads } from './uploads.mjs';
const services=new WeakMap();
const uploadSchemas=new WeakMap();
async function hostedService(db,policy,buckets) {
  if(buckets)return createPortability({db,buckets,policy});
  let policies=services.get(db);if(!policies){policies=new WeakMap();services.set(db,policies);}
  let pending=policies.get(policy);
  if(!pending){pending=createPortability({db,policy});policies.set(policy,pending);pending.catch(()=>policies.delete(policy));}
  return pending;
}
async function uploadSchema(db) {
  let pending=uploadSchemas.get(db);
  if(!pending){pending=initializeUploads(db);uploadSchemas.set(db,pending);pending.catch(()=>uploadSchemas.delete(db));}
  return pending;
}
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});

/** Keep the pinned archive verifier and atomic importer; own hosted transport. */
export async function createPortabilityHandler({db,buckets,policy,appOrigin,basePath='/api/portability',authorize,maxBodyBytes=MAX_LINE_BYTES}) {
  insist(typeof authorize==='function' && new URL(appOrigin).origin===appOrigin,'invalid_handler_configuration');
  insist(/^\/[A-Za-z0-9/_-]+$/.test(basePath) && !basePath.endsWith('/') && Number.isSafeInteger(maxBodyBytes) && maxBodyBytes>0,'invalid_handler_configuration');
  const rawDb=db,service=await hostedService(db,policy,buckets);
  db=wireDatabase(db);
  return async request=>{
    const url=new URL(request.url);
    if(url.pathname!==basePath && !url.pathname.startsWith(basePath+'/'))return null;
    const route=url.pathname.slice(basePath.length+1).split('/'),[collection,id,action,index]=route;
    try {
      const actor=await authorize(request,{operation:collection==='exports'?'export':collection==='imports'?'import':'unknown',jobId:id??null});
      insist(typeof actor==='string' && actor.length>0,'unauthorized',401);
      if(!['GET','HEAD'].includes(request.method))insist(request.headers.get('origin')===appOrigin,'origin_refused',403);
      if(id)insist(await service.actor(id)===actor,'job_not_found',404);
      insist(['exports','imports'].includes(collection) && route.length<=4,'route_not_found',404);
      if(collection==='imports')await uploadSchema(rawDb);
      const api=service[collection];
      if(request.method==='POST' && !id) {
        const body=await boundedJson(request,maxBodyBytes);
        if(collection==='imports'){insist(body.confirmed===true,'confirmation_required');return json({id:await api.create(body.manifest,actor)},201);}
        return json({id:await api.create(actor)},201);
      }
      if(request.method==='GET' && id && !action)return json(collection==='imports'?await importStatus(db,service,id):await api.status(id));
      if(request.method==='POST' && id && action==='abort' && !index) {
        const result=await api.abort(id);if(collection==='imports')await cleanUploads(db,id);return json(result);
      }
      if(collection==='exports' && request.method==='POST' && id && action==='advance' && !index)return json(await api.advance(id,await boundedJson(request,maxBodyBytes)));
      if(collection==='exports' && request.method==='GET' && id && action==='download' && !index)return new Response(await api.download(id),{headers:{'content-type':'application/x-ndjson','cache-control':'no-store'}});
      if(collection==='imports' && request.method==='PUT' && id && action==='parts' && /^(0|[1-9]\d*)$/.test(index??'')) {
        return json(await receivePart(db,service,id,Number(index),await boundedJson(request,maxBodyBytes),policy.partBytes));
      }
      if(collection==='imports' && request.method==='POST' && id && action==='finalize' && !index) {
        const options=await boundedJson(request,maxBodyBytes);
        await drainUploads(db,service,id);
        const result=await api.finalize(id,options);
        // A repeat finalize sees complete and can finish interrupted cleanup.
        await cleanUploads(db,id,{copies:true});return json(result);
      }
      throw new PortabilityError('route_not_found',404);
    }catch(error) {
      const status=Number.isInteger(error?.status) && error.status>=400 && error.status<=599?error.status:500;
      const reason=error instanceof PortabilityError?error.code:'operation_failed';
      if(status>=500)console.error('portability request failed',reason,status);
      return json({error:reason,message:reasonFor(reason)},status);
    }
  };
}
