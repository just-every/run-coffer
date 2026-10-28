import { runAutomaticReceipts } from '../automatic-receipts'
import type { GivingEnv } from './stripe'

/** Payment return and signed webhook share the same durable, once-only claim. */
export const sendOnlineReceipt = (env: GivingEnv, giftId: string) => runAutomaticReceipts(env,new Date(),[giftId])
