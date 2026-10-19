import type { Context } from '../db'
import { researchState } from '../research'
import { settings } from '../settings'
import { box, chip, e, field, form, moment } from './common'

export async function researchPage(c: Context, donorId?: string, error = '') {
 const state = await researchState(c, donorId), timezone = (await settings(c)).timezone
 const connection = box('WealthEngine connection', `${state.connection
  ? `<p>${chip('Connected', 'ok')} WealthEngine · connected ${e(moment(state.connection.connectedAt, timezone))}</p>${form('research.disconnect', '', 'Disconnect WealthEngine', {}, 'secondary')}`
  : '<p>Connect a production WealthEngine API account to research selected donors.</p>'}
  <details><summary>${state.connection ? 'Replace API key' : 'Connect WealthEngine'}</summary>
  <ol class="steps"><li>Open your <a href="https://apidocs.wealthengine.com/documentation.html" target="_blank" rel="noopener noreferrer">WealthEngine developer account</a> and obtain a production API key with profile lookup access.</li><li>Paste the key below. Coffer checks it with WealthEngine and encrypts it in this installation. The key is never displayed again.</li></ol>
  ${form('research.connect', field('WealthEngine production API key', 'apiKey', 'password', '', 'required autocomplete="new-password" spellcheck="false" maxlength="1000"'), state.connection ? 'Replace WealthEngine key' : 'Connect WealthEngine', { provider: 'wealthengine' })}</details>`)
 const selected = state.donors.find(d => d.id === donorId)
 const screen = box('Screen selected donors', `<p>WealthEngine receives each selected donor’s name, United States mailing address and an opaque donor ID. Review names and addresses first: Coffer uses the first name word as the given name and the remaining words as the surname.</p>
  <p>Only the owner and admins can connect, screen and read results. Capacity estimates describe possible giving over five years; they are provider estimates for staff review.</p>
  ${state.connection ? form('research.screen', `<fieldset><legend>Choose up to 25 donors</legend>${state.donors.map(d => `<label><input type="checkbox" name="donorIds" value="${e(d.id)}"${d.id === donorId ? ' checked' : ''}> ${e(d.name)}</label>`).join('') || '<p>Add a donor before screening.</p>'}</fieldset>`, 'Screen selected donors', donorId ? { returnDonorId: donorId } : {}) : '<p>Connect WealthEngine above to screen donors.</p>'}`)
 const results = box(selected ? `Research for ${selected.name}` : 'Research results', state.results.length ? state.results.map(r => {
  const fact = (title: string, value: unknown) => `<dt>${e(title)}</dt><dd>${e(value ?? 'Not supplied by provider')}</dd>`
  return `<article><h3><a href="/app/donors/${e(r.donor_id)}">${e(r.donor_name)}</a></h3>
   <p>${chip(r.status === 'matched' ? 'Matched' : 'No match', r.status === 'matched' ? 'ok' : 'warn')} WealthEngine estimate · researched ${e(moment(r.researched_at, timezone))}</p>
   ${r.status === 'matched' ? `<dl>${fact('Wealth rating', r.wealth_rating)}${fact('Wealth score (0–100)', r.wealth_score)}${fact('Gift capacity over five years (USD)', r.capacity_range)}${fact('Capacity lower bound', r.capacity_low)}${fact('Capacity upper bound', r.capacity_high)}${fact('Propensity to give', r.propensity)}${fact('Provider propensity code', r.propensity_code)}${fact('Estimated annual donations (USD)', r.annual_donations)}${fact('WealthEngine profile ID', r.provider_profile_id)}</dl>` : '<p>WealthEngine found no matching profile for this donor.</p>'}
   </article>`
 }).join('') : '<p>No research results saved. Select donors above to begin.</p>')
 return `${error ? `<p class="alert" role="alert">${e(error)}</p>` : ''}<p><a href="${donorId ? `/app/donors/${e(donorId)}` : '/app/pipeline'}">${donorId ? 'Back to donor' : 'Back to pipeline'}</a>${donorId ? ' · <a href="/app/research">All research results</a>' : ''}</p><div class="grid wide"><div>${screen}${results}</div><div>${connection}</div></div>`
}
