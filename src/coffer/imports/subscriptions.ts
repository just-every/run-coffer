import { canonicalJson, sha256, type D1Database, type SourceRecord, type TargetEffect } from '../../modules/import-kit/src/d1/index.ts'
import { namespace } from './context.ts'
import type { SnapshotObject } from './types.ts'

const campaignKey = sha256(canonicalJson([namespace, 'imported-monthly-campaign']))
export const importedCampaignId = `stripe-${campaignKey.slice(0, 32)}`
export const importedCampaignSlug = `imported-stripe-monthly-${campaignKey.slice(0, 12)}`
export type SubscriptionIndex = {
  subscriptions: Set<string>
  campaign: { id: string; slug: string } | null
  campaignSlugTaken: boolean
}
type SkippedSubscription = { kind: 'subscription'; sourceId: string; reason: string }

/** Existing Stripe IDs are never reassigned or overwritten by move-in. */
export async function subscriptionIndex(db: D1Database): Promise<SubscriptionIndex> {
  const [subscriptions, campaigns] = await Promise.all([
    db.prepare('SELECT id FROM cf_subscriptions').all<{ id: string }>(),
    db.prepare('SELECT id,slug FROM cf_campaigns WHERE id=? OR slug=?').bind(importedCampaignId, importedCampaignSlug).all<{ id: string; slug: string }>(),
  ])
  return {
    subscriptions: new Set(subscriptions.results.map(row => row.id)),
    campaign: campaigns.results.find(row => row.id === importedCampaignId) ?? null,
    campaignSlugTaken: campaigns.results.some(row => row.slug === importedCampaignSlug && row.id !== importedCampaignId),
  }
}

const object = (value: unknown): SnapshotObject => value && typeof value === 'object' && !Array.isArray(value) ? value as SnapshotObject : {}
const stripeId = (value: unknown) => typeof value === 'string' ? value : typeof object(value).id === 'string' ? object(value).id as string : ''
const present = (value: unknown) => value !== undefined && value !== null
const nonempty = (value: unknown) => present(value) && (!Array.isArray(value) || value.length > 0)
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 946684800 && value <= 4102444800

/** Preserve the Stripe original; project only amounts this monthly ledger can represent exactly. */
export function planSubscriptions(records: SourceRecord[], donorFor: Map<string, string>, native: SubscriptionIndex): {
  effects: Map<string, TargetEffect[]>; skipped: SkippedSubscription[]
} {
  const effects = new Map<string, TargetEffect[]>(), skipped: SkippedSubscription[] = []
  let campaignReady = !!native.campaign
  for (const record of records.filter(row => row.kind === 'subscription')) {
    const sub = object(record.payload), items = object(sub.items), data = items.data
    const item = object(Array.isArray(data) && data.length === 1 ? data[0] : null)
    const price = object(item.price), recurring = object(price.recurring)
    const customer = stripeId(sub.customer), donor = donorFor.get(customer)
    const quantity = item.quantity, unit = price.unit_amount
    const cents = typeof quantity === 'number' && typeof unit === 'number' ? quantity * unit : NaN
    const reason = native.subscriptions.has(record.sourceId) ? 'Already in Coffer; the existing monthly plan is unchanged.'
      : !/^sub_[A-Za-z0-9]{1,100}$/.test(record.sourceId) || sub.id !== record.sourceId ? 'Missing a valid Stripe subscription ID.'
      : sub.status !== 'active' ? 'Not an active subscription.'
      : present(sub.schedule) ? 'Uses a Stripe subscription schedule; import monthly plans without schedules.'
      : present(sub.pending_update) || present(sub.pause_collection) || present(sub.billing_thresholds) ? 'Has pending changes, paused collection or billing thresholds.'
      : !Array.isArray(data) || data.length !== 1 || items.has_more === true ? 'Needs one complete fixed-price subscription item.'
      : sub.currency !== 'usd' || price.currency !== 'usd' ? 'Not in US dollars.'
      : price.type !== 'recurring' || recurring.interval !== 'month' || recurring.interval_count !== 1 ? 'Not a monthly recurring price.'
      : price.billing_scheme !== 'per_unit' || recurring.usage_type !== 'licensed' || present(price.transform_quantity) || present(item.billing_thresholds) ? 'Uses metered, tiered or transformed pricing rather than a fixed monthly price.'
      : typeof unit !== 'number' || !Number.isSafeInteger(unit) || unit <= 0 || typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(cents) || cents <= 0 ? 'Missing a positive fixed amount in whole US cents and a whole-number quantity.'
      : nonempty(sub.discount) || nonempty(sub.discounts) || nonempty(item.discounts) || nonempty(sub.default_tax_rates) || nonempty(item.tax_rates) || object(sub.automatic_tax).enabled === true || present(sub.shipping_cost) ? 'Includes discounts, tax or shipping that this fixed monthly amount cannot represent.'
      : typeof sub.cancel_at_period_end !== 'boolean' ? 'Missing Stripe cancellation state.'
      : !timestamp(sub.created) ? 'Missing a valid Stripe creation timestamp.'
      : !/^cus_[A-Za-z0-9]{1,100}$/.test(customer) || !donor ? 'No matching donor. Include its Stripe customer in this review.'
      : !campaignReady && native.campaignSlugTaken ? 'The imported monthly campaign address is already in use.' : ''
    if (reason) { skipped.push({ kind: 'subscription', sourceId: record.sourceId, reason }); continue }
    // Stripe has no subscription updated timestamp. Its real creation time is
    // the stable imported baseline; later native/portal changes replace it.
    const createdAt = new Date((sub.created as number) * 1000).toISOString()
    const planned: TargetEffect[] = []
    if (!campaignReady) {
      planned.push({ targetKind: 'campaign', targetId: importedCampaignId, value: {
        id: importedCampaignId, slug: importedCampaignSlug, name: 'Imported Stripe monthly gifts',
        description: 'Monthly giving plans imported from the connected Stripe account.',
        fund: 'Unrestricted', goalCents: null, active: 0, createdAt,
      } })
      campaignReady = true
    }
    planned.push({ targetKind: 'subscription', targetId: record.sourceId, value: {
      id: record.sourceId, donorId: donor!, campaignId: importedCampaignId, customerId: customer,
      amountCents: cents, status: sub.status!, cancelAtPeriodEnd: Number(sub.cancel_at_period_end),
      failedAttempts: 0, recovered: 0, nextAttemptAt: null, updatedAt: createdAt,
    } })
    effects.set(`subscription:${record.sourceId}`, planned)
  }
  return { effects, skipped }
}
