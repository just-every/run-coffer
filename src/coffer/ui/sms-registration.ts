import type { Context } from '../db'
import { smsRegistrationState } from '../sms-registration'
import { box, chip, e, field, form } from './common'

export async function smsRegistrationPanel(c: Context): Promise<string> {
 if (!['owner','admin'].includes(c.actor.role)) return ''
 const state = await smsRegistrationState(c)
 const status = state.approved ? 'Twilio registration verified' : 'Texts blocked until registration is verified'
 return box('SMS sender registration', `<p>${chip(status, state.approved ? 'ok' : 'warn')}</p>
  <p>Connect Twilio in Text-to-give settings, then enter the Messaging Service and A2P campaign from your Twilio account. Coffer checks the campaign status and confirms that your exact sender belongs to that service. A signed number-registration event must also confirm that the individual number is registered. Approval comes from Twilio. Thank-you, pledge reminder and appeal texts require a verified registration.</p>
  <p>Number registration: ${e(state.number_status??'unknown')}. Configure the Twilio Event Streams webhook at <code>${e(c.env?.AUTH_ORIGIN??'')}/api/coffer/sms/registration/events</code> for all number registration and deregistration events. Enter the exact event campaign SID from Twilio to bind its number events to this reviewed campaign. After a successful number event, refresh here before sending.</p>
  ${state.checked_at ? `<p>Campaign: ${e(state.campaign_status)}. Sender: ${e(state.sender)} ${state.sender_registered ? 'belongs to the service' : 'is not in the service'}. Last checked: ${e(state.checked_at)}.</p>` : '<p>No registration has been checked.</p>'}
  <p>Complete brand and campaign registration in <a href="https://console.twilio.com/" rel="noreferrer">Twilio Console</a>. Refresh here after approval or a sender change. Coffer checks Twilio again before sending; unavailable verification blocks sending.</p>` +
  form('sms.registration.refresh',
   field('Messaging Service SID', 'messagingServiceSid', 'text', state.messaging_service_sid ?? '', 'required autocomplete="off"') +
   field('A2P campaign SID (QE)', 'campaignSid', 'text', state.campaign_sid ?? '', 'required autocomplete="off"') +
   field('Number event campaign SID (CM)', 'numberCampaignSid', 'text', state.number_campaign_sid ?? '', 'required autocomplete="off"'),
   'Check registration with Twilio', { version: state.version }), 'sms-registration')
}
