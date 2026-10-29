import { fail } from '../db'
import { day } from './source-rows'

/** The reviewer supplies the annual interpretation; raw provider dates are
 * compared exactly and retained, never parsed into a guessed calendar rule. */
export function neonContactDates(address:Record<string,any>,mapping:Record<string,any>|undefined) {
 if(!address.startDate&&!address.endDate&&!mapping)return null
 if(!mapping||Object.keys(mapping).some(k=>!['sourceStart','sourceEnd','from','through'].includes(k))||
  ['sourceStart','sourceEnd','from','through'].some(k=>typeof mapping[k]!=='string'||!mapping[k]||mapping[k].length>100)||
  mapping.sourceStart!==address.startDate||mapping.sourceEnd!==address.endDate||
  !/^\d{2}-\d{2}$/.test(mapping.from)||!/^\d{2}-\d{2}$/.test(mapping.through)||!day('2000-'+mapping.from)||!day('2000-'+mapping.through))
  fail('NEON_CONTACT_DATES','Review the exact source address dates and explicitly map them to annual MM-DD bounds. Missing or changed source evidence cannot become a seasonal rule.',400)
 return {from:mapping.from,through:mapping.through,evidence:`Reviewed annual mapping from source dates ${mapping.sourceStart} through ${mapping.sourceEnd}; source type ${String(address.type?.name??'unknown')}.`}
}
