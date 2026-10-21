import { sql } from './db'

/** Compose with the preference insert. Keeping this explicit lets archive
 * restore retain both histories exactly without firing another permission. */
export const smsConsentStatement=(donorId:string,evidence:string,at:string,inboundId:string|null=null)=>sql(`
 INSERT INTO cf_consents(donor_id,channel,status,method,evidence,captured_on,recorded_at,recorded_by)
 SELECT donor_id,'sms',status,source,evidence||' · Donor time zone: '||timezone,captured_on,recorded_at,recorded_by
 FROM cf_sms_preferences p WHERE p.donor_id=? AND p.id=(SELECT MAX(id) FROM cf_sms_preferences WHERE donor_id=p.donor_id)
 AND p.evidence=? AND p.recorded_at=? AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM cf_sms_inbound WHERE message_id=?))`,donorId,evidence,at,inboundId,inboundId)
