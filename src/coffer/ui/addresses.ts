import { requireRole } from '../auth'
import type { Context, Row } from '../db'
import { settings } from '../settings'
import { addressState } from '../addresses/state'
import { box, chip, e, empty, field, form, longDay, moment, select } from './common'

const reasons: Record<string, string> = {
 confirmed: 'The postal address was confirmed.',
 unsupported_country: 'Verification is available for US postal addresses only.',
 incomplete_address: 'Complete the street, city, state and ZIP code before verifying.',
 no_match: 'The provider could not confirm a deliverable match.',
 ambiguous_match: 'Several addresses matched. Review the address with the donor.',
 incomplete_confirmation: 'The provider did not confirm delivery to this address.',
 vacant: 'The address is reported vacant. Confirm it with the donor before mailing.',
 no_stat: 'The address is not currently receiving normal postal delivery.',
 phantom_route: 'The postal route could not be confirmed for delivery.',
 not_configured: 'The address provider connection needs attention from an administrator.',
 invalid_request: 'The provider could not process this address. Review its details.',
 network_error: 'The provider could not be reached. Verification was not confirmed.',
 http_error: 'The provider refused or could not complete this request.',
 invalid_response: 'The provider returned a result that could not be confirmed.',
 provider_error: 'The provider could not complete verification.',
 paf_required: 'The licensed account needs a current signed Processing Acknowledgement Form.',
 list_too_small: 'At least 100 genuine unique names and addresses are required.',
 move_confirmed: 'The provider confirmed a move.',
 standardized: 'The provider standardized the address.',
 no_move_match: 'No matching move was reported.',
 not_deliverable: 'The provider reported the address as undeliverable.',
 foreign_move: 'An international move needs staff review.',
 incomplete_move: 'The reported move does not provide a complete address.',
 address_unconfirmed: 'The address needs staff review before mailing.',
}

const sources: Record<string, string> = {
 smarty: 'Smarty address verification', ncoa: 'National Change of Address pass',
 staff: 'Staff address change', merge: 'Donor merge', import: 'Imported address', system: 'Recorded address update',
}
const sourceLabel = (source: unknown) => sources[String(source)] ?? 'Earlier recorded address change'

function checkSummary(check: Row | null, timezone: string): string {
 if (!check) return `<p>${chip('Unverified or changed', 'warn')} No verification is recorded for the current name and address. Verify it before preparing postal mail.</p>`
 const labels: Record<string, [string, string]> = {
  verified: ['Address verified', 'ok'], unverified: ['Address not verified', 'warn'],
  undeliverable: ['Undeliverable address', 'alarm'], error: ['Verification could not complete', 'warn'],
 }
 const [label, tone] = labels[check.status] ?? ['Address needs review', 'warn']
 return `<p>${chip(label, tone)}</p><p>${e(reasons[check.reason] ?? 'Review the address before preparing postal mail.')}</p>
  <p>${e(sourceLabel(check.source))}${check.checked_at ? ` · Checked ${e(moment(check.checked_at, timezone))}` : ''}.</p>
  ${check.move_effective_month ? `<p>Provider-reported move month: ${e(check.move_effective_month)}. No exact move day was supplied.</p>` : ''}`
}

function previousAddress(row: Row): string {
 const lines = [row.address_line1, row.address_line2,
  [row.city, row.region, row.postal_code].filter(Boolean).join(', '), row.country].filter(Boolean)
 return lines.length ? lines.map(e).join('<br>') : 'No earlier postal address recorded'
}

/** Native manager page; credentials stay in private installation bindings. */
export async function addressesPage(c: Context): Promise<string> {
 requireRole(c.actor, ['owner', 'admin'], 'manage address processing')
 const [state, configuration] = await Promise.all([addressState(c), settings(c)])
 const connection = state.connection, enabled = Number(connection.enabled) === 1
 const editor = form('address.processing',
  select('Address processing', 'enabled', [['no', 'Disabled'], ['yes', 'Enabled']], enabled ? 'yes' : 'no') +
  field('PAF signer','pafSigner','text',connection.paf_signer??'','maxlength="200"')+
  field('PAF signing date','pafSignedOn','date',connection.paf_signed_on??'')+
  field('PAF licensee','pafLicensee','text',connection.paf_licensee??'','maxlength="200"')+
  field('Current signed PAF reference', 'pafReference', 'text', connection.paf_reference ?? '', 'maxlength="200"') +
  '<p>A Processing Acknowledgement Form (PAF) authorizes the licensed change-of-address provider to process this organization’s donor list. Keep the signed form current with your provider.</p>' +
  '<label><input type="checkbox" name="reviewed" value="yes"> I confirm this account has a current signed PAF and authorize address processing for the organization’s current donors when enabled.</label>',
  'Save address processing', { version: connection.version })
 const runs = state.runs.map((run:Row) => {
  const labels: Record<string, [string, string]> = {
   queued: ['Queued', 'info'], processing: ['Processing', 'info'], completed: ['Completed', 'ok'],
   failed: ['Could not complete', 'warn'], uncertain: ['Outcome uncertain', 'warn'], cancelled: ['Cancelled', ''],
  }
  const [label, tone] = labels[run.state] ?? ['Needs review', 'warn']
  return `<li><h3>Prepared ${e(moment(run.created_at, configuration.timezone))}</h3><p>${chip(label, tone)} · ${e(run.processed)} of ${e(run.total)} unique names and addresses processed. Address choice: ${e(run.address_type||'primary or active seasonal')}.</p>
   ${run.completed_at ? `<p>Finished ${e(moment(run.completed_at, configuration.timezone))}.</p>` : ''}
   ${run.reason ? `<p>${e(reasons[run.reason] ?? run.reason)}</p>` : ''}
   ${['failed', 'uncertain'].includes(run.state) ? '<p>This pass will not retry automatically. Review the provider’s job and the reason above before preparing another pass.</p>' : ''}</li>`
 }).join('')
 return box('Address processing', `<p>${chip(enabled ? 'Enabled' : 'Disabled', enabled ? 'ok' : '')}</p>
  <p>When enabled, Coffer standardizes US addresses as they are entered, checks addresses before postal mail and queues a National Change of Address (NCOA) pass before a postal appeal. Earlier addresses remain in the donor’s history.</p>
  <p>Connect Smarty and Melissa SmartMover privately on this installation before enabling processing. Provider credentials are never entered on this page.</p>${connection.renewalDueOn?`<p>${chip(connection.renewalDue?'PAF renewal due':'PAF renewal scheduled',connection.renewalDue?'warn':'')} · ${e(connection.renewalDueOn)} (12 months after signing). Recorded signer: ${e(connection.paf_signer)}; licensee: ${e(connection.paf_licensee)}. The licensee decides whether the PAF is accepted; a refusal disables processing without changing addresses.</p>`:''}${editor}`, 'address-processing') +
  box('Prepare an address pass', '<p>Melissa requires at least 100 genuine unique names and addresses. Coffer never pads a list or submits fabricated records. Only eligible active donors with complete US addresses enter the pass.</p><p>The minute scheduler processes one batch of up to 100 unique names and addresses at a time. Refresh this page to see progress. Failed or uncertain outcomes are never automatically retried.</p>' +
   (enabled ? form('address.queueNcoa',select('Address choice','addressType',[['','Primary or active seasonal'],['home','Home'],['work','Work'],['vacation','Vacation'],['seasonal','Active seasonal'],['other','Other']])+'<p>Where a chosen type is absent, the pass checks that constituent’s current mailing address. A mailing choosing a type still excludes people without it.</p>', 'Prepare address pass') : empty('Enable address processing with a current signed PAF before preparing a pass.'))) +
  box('Recent address passes', runs ? `<ul class="list">${runs}</ul>` : empty('No address passes have been prepared yet.'), 'address-passes')
}

/** The donor contact panel already displays the current postal address. */
export async function addressPanel(c: Context, donor: Row): Promise<string> {
 const [state, configuration] = await Promise.all([addressState(c, donor.id), settings(c)])
 const enabled = Number(state.connection.enabled) === 1
 const canVerify = ['owner', 'admin', 'member'].includes(c.actor.role)
 const history = (state.history ?? []).map((row:Row) => `<li><p>${previousAddress(row)}</p>
  <p>Used before ${e(longDay(row.until_on))} (that date is excluded). Source: ${e(sourceLabel(row.source))}.</p></li>`).join('')
 return box('Postal address verification', checkSummary(state.check ?? null, configuration.timezone) +
  (enabled && canVerify ? form('address.verify', '<p>Check the current postal address with Smarty. A confirmed standardized address replaces the current address and preserves the earlier one in history.</p>', 'Verify current address', { donorId: donor.id, version: donor.version, returnDonorId: donor.id }) :
   !enabled ? '<p>Address processing is disabled. An owner or administrator can enable it in address settings.</p>' : '') +
  '<details><summary>Earlier postal addresses</summary>' + (history ? `<ul class="list">${history}</ul>` : empty('No earlier postal addresses recorded.')) + '</details>', 'address-verification')
}
