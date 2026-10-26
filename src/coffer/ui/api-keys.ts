import type { Context } from '../db'
import { keyState } from '../api/keys'
import { box, e, empty, field, form, select } from './common'

export async function apiKeysPage(c: Context) {
 const {keys}=await keyState(c)
 const create=form('apiKey.create',field('Key label','label','text','','required maxlength="100" autocomplete="off"')+
  select('Permissions','scope',[['read-only','Read only'],['gift-entry','Gift entry'],['full','Full native records']],'read-only','aria-label="Permissions"')+
  field('Expiry date (UTC, optional)','expiresOn','date','','')+
  '<details><summary>Scope and expiry policy</summary><p>Read only can read native records. Gift entry can read constituents, gifts, pledges, funds and campaigns and record gifts for existing donors. Full adds the documented native record changes. Keys cannot approve endpoints, send messages, administer credentials, erase donors or change payment plans. Gift entry holds when published gift rules require effects beyond this scope.</p><p>Keys expire after 30 days by default, at most 90 days. They stop immediately when revoked or when their creating owner or admin changes role or account state. Keep the key in your own secret store.</p></details>','Create API key')
 return `<p><a href="/app/settings">Back to Settings</a></p><p><a href="/api/coffer/v1/openapi.json">OpenAPI document</a></p>
 ${box('Public API keys',keys.length?`<ul class="list">${keys.map(key=>`<li id="api-key-${e(key.id)}"><strong>${e(key.label)}</strong><p>${e(key.scope)} · ${key.usable?'Active':'Unavailable'} · Expires ${e(new Date(key.expires_at).toISOString().slice(0,10))} UTC</p>${!key.revoked_at?form('apiKey.revoke','','Revoke key',{id:key.id},'secondary'):''}</li>`).join('')}</ul>`:empty('No public API keys yet.'),'api-keys')}
 ${box('Create an API key',keys.length?`<details><summary>Add an API key</summary>${create}</details>`:create,'api-key-create')}`
}

export function apiKeySecretPage(token:string) {
 return box('API key created',`<p>Copy this key now. It is shown once. Send it in the Authorization header using the Bearer scheme.</p>${field('API key','apiKey','text',token,'readonly data-api-key-secret autocomplete="off" spellcheck="false"')}<p><a class="button" href="/app/api-keys">Back to API keys</a></p>`,'api-key-result')
}
