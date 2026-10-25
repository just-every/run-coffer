import { fail, guard, one, type Context } from '../db'

export const savedCardConsent = (c: {db:D1Database}, donorId:string, customerId:string, methodId:string) =>
 one(c,'SELECT id,status,recorded_at FROM cf_saved_card_consents WHERE donor_id=? AND customer_id=? AND payment_method_id=? ORDER BY id DESC LIMIT 1',donorId,customerId,methodId)

export async function requireSavedCardConsent(c:Context,donorId:string,customerId:string,methodId:string){
 const consent=await savedCardConsent(c,donorId,customerId,methodId)
 if(consent?.status!=='granted')fail('SAVED_CARD_CONSENT_REQUIRED','The donor must personally grant permission for this saved card in their giving account before staff can start a plan.',409)
 return {
  id:consent.id,
  guard:guard("(SELECT id FROM cf_saved_card_consents WHERE donor_id=? AND customer_id=? AND payment_method_id=? ORDER BY id DESC LIMIT 1)=? AND EXISTS(SELECT 1 FROM cf_saved_card_consents WHERE id=? AND status='granted')",'SAVED_CARD_CONSENT_CHANGED','The donor’s saved card permission changed. Review the request before charging.',donorId,customerId,methodId,consent.id,consent.id),
 }
}
