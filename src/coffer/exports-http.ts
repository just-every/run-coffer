import { fail, type Context } from './db'
import { exportCsv, exportSnapshot, exportType } from './exports'

const headers = {'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin'}
export async function exportsResponse(request: Request, c: Context): Promise<Response | null> {
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/coffer\/exports\/([a-z]+)\.csv$/)
 if(!match && url.pathname!=='/api/coffer/exports/preview')return null
 if(request.method!=='GET')fail('method_not_allowed','Use GET to review or download a list export.',405)
 const type=exportType(match?.[1]??url.searchParams.get('type')??'constituents')
 if(!match)return Response.json((await exportSnapshot(c,type,url)).metadata,{headers})
 const {body,metadata}=await exportCsv(c,type,url)
 const source=metadata.listId?`saved-${encodeURIComponent(metadata.listId)}`:metadata.source
 const date=metadata.asOf.replace(/[:.]/g,'-')
 return new Response(body,{headers:{...headers,'content-type':'text/csv; charset=utf-8',
  'content-disposition':`attachment; filename="coffer-${type}-${source}-lifetime-${date}.csv"`,
  'x-coffer-row-count':String(metadata.rowCount),'x-coffer-as-of':metadata.asOf,
  'x-coffer-withheld':metadata.withheld.statement}})
}
