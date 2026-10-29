import { createAgentDoor, type Trust } from '../../modules/agent-door/index.ts'
import { createBusinessSettings } from '../../modules/business-settings/index.ts'
import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { people } from './people'
import { tools } from './tools'
import { keyScopes, localCredential } from './context'
export const capabilities=['tools','policy','pause','audit','idempotency'] as const
export function cofferDoor(original:Bindings){
 const env=runtimeBindings(original)
 const configured=[env.RER_OWNER_CLAIM_ISSUER,env.RER_OWNER_CLAIM_INSTALLATION_ID,env.RER_OWNER_CLAIM_PUBLIC_KEYS].some(Boolean)
 const trust:Trust|null=configured?{issuer:env.RER_OWNER_CLAIM_ISSUER??'',installationId:env.RER_OWNER_CLAIM_INSTALLATION_ID??'',appOrigin:env.AUTH_ORIGIN,publicKeys:JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS??'{}')}:null
 const door=createAgentDoor({seed:'coffer',name:'Coffer',specialist:'development',db:env.DB,origin:env.AUTH_ORIGIN,trust,people:people(env),capabilities,tools:tools(env),paths:['/api/coffer/mcp'],localCredentials:request=>localCredential(env,request),currentScopes:async principal=>principal.clientId?.startsWith('coffer-key:')?keyScopes(env,principal.clientId.slice(11)):[...principal.scopes],notTools:[{clauses:['MOVE-001'],reason:'import-door'},{clauses:['OWN-001'],reason:'installation'},{clauses:['COMM-002'],reason:'connector'},{clauses:['MOBILE-002'],reason:'device'}]})
 return {...door,async handle(request:Request){
  if(new URL(request.url).pathname==='/api/coffer/mcp'){
   const header=request.headers.get('authorization')
   if(!header)return Response.json({jsonrpc:'2.0',id:null,error:{code:-32001,message:'Use an agent credential'}},{status:request.headers.has('cookie')?403:401})
   if(/^Bearer [A-Za-z0-9_-]{43}$/.test(header)){try{if(!await localCredential(env,request))throw Error()}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32001,message:'Unauthorized'}},{status:401})}}
  }
  return door.handle(request)
 }}
}
export function cofferBusinessSettings(env:Bindings){
 return createBusinessSettings({db:env.DB,trust:env.RER_BUSINESS_TRUST,business:{settings:1,values:['display_name','owner_name','brand_color','logo','timezone'],team:{roles:{admin:'admin',member:'member'}}},team:operatorAuth(env).businessTeam})
}

/** Unrelated public routes (including health) need no auth/setup bindings. */
export async function cofferAgentResponse(request:Request,env:Bindings){
 const path=new URL(request.url).pathname
 if(!['/mcp','/api/coffer/mcp','/api/rer/agent-policy','/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp','/agents'].includes(path)&&!path.startsWith('/agents/'))return null
 return cofferDoor(env).handle(request)
}
export async function cofferBusinessResponse(request:Request,original:Bindings){
 if(!['/api/rer/business-settings','/rer-business-logo','/rer-business.css'].includes(new URL(request.url).pathname))return null
 return cofferBusinessSettings(runtimeBindings(original)).handle(request)
}
