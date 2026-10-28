import type { Row } from '../db'

export function givingEmbedScript(campaign: Row) {
 const path = '/give/' + campaign.slug + '?embed=1'
 const code = `(()=>{const script=document.currentScript;if(!script)return;const origin=new URL(script.src).origin;const frame=document.createElement('iframe');frame.src=origin+${JSON.stringify(path)};frame.title=${JSON.stringify(campaign.name + ' donation form')};frame.style.cssText='width:100%;min-height:900px;border:0;display:block';frame.setAttribute('allow','payment');frame.setAttribute('sandbox','allow-scripts allow-forms allow-same-origin allow-top-navigation-by-user-activation');script.after(frame);window.addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!==origin||event.data?.type!=='coffer-form-height')return;const height=event.data.height;if(Number.isFinite(height)&&height>0&&height<50000)frame.style.height=Math.ceil(height)+'px'})})();`
 return new Response(code, {headers: {'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'cross-origin'}})
}
