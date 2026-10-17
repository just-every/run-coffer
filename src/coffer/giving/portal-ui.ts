import { box, chip, e, field, hidden, money, page } from '../ui/common'

export interface PortalSubscription {
 id: string
 campaign_name: string
 amount_cents: number
 status: string
 cancel_at_period_end: number
}

export async function portalPage(title: string, body: string, status = 200) {
 const response = await page(title, body, undefined, status)
 response.headers.set('referrer-policy', 'strict-origin')
 const policy = response.headers.get('content-security-policy')
 if (policy) response.headers.set('content-security-policy', policy.replace("form-action 'self'", "form-action 'self' https://billing.stripe.com"))
 response.headers.set('x-robots-tag', 'noindex, nofollow')
 return response
}

export const requestPage = () => portalPage('Your monthly giving', box('Sign in by email',
 '<p>Use the email address you gave with your gift. Your private link expires in 30 minutes.</p>' +
 `<form method="post" action="/giving/portal/request">${field('Email address', 'email', 'email', '', 'required autocomplete="email" maxlength="254"')}<button>Email a sign-in link</button></form>`))

export const requestedPage = () => portalPage('Check your email', box('Your sign-in request',
 '<p>If this email address belongs to a donor account, you can receive a private sign-in link. Check your inbox and spam folder.</p><p><a href="/giving/portal">Back to sign in</a></p>'))

export const confirmationPage = (token: string) => portalPage('Open your giving account', box('Confirm sign in',
 '<p>Press Continue to use your private link. Your session lasts one hour.</p>' +
 `<form method="post" action="/giving/portal/confirm">${hidden('token', token)}<button>Continue</button></form>`))

export const invalidLinkPage = () => portalPage('This link is no longer available',
 box('Request another link', '<p>This sign-in link has expired or has already been used.</p><p><a href="/giving/portal">Email a new sign-in link</a></p>'), 400)

function subscriptionState(s: PortalSubscription) {
 if (s.status === 'canceled' || s.status === 'incomplete_expired') return chip('Cancelled')
 if (['past_due', 'unpaid', 'incomplete', 'paused'].includes(s.status)) return chip('Past due', 'warn')
 return chip('Active', 'ok')
}

export const cancellationPage = (s: PortalSubscription) => portalPage('Cancel monthly giving', box(s.campaign_name,
 `<p>${money(s.amount_cents)} per month</p><p>Your monthly gift will end at the end of the current billing period. This does not refund previous gifts.</p>` +
 `<form method="post" action="/giving/portal/cancel">${hidden('subscription', s.id)}${hidden('confirm', 'yes')}<button>Cancel at end of billing period</button></form><p><a href="/giving/portal">Keep my monthly gift</a></p>`))

export function subscriptionsPage(name: string, subscriptions: PortalSubscription[], cancelled = false) {
 const rows = subscriptions.map(s => {
  const ended = ['canceled', 'incomplete_expired'].includes(s.status)
  const actions = ended ? '' : `<form method="post" action="/giving/portal/card">${hidden('subscription', s.id)}<button>Update payment card</button></form>${s.cancel_at_period_end ? '' : `<p><a href="/giving/portal/cancel?subscription=${encodeURIComponent(s.id)}">Cancel monthly gift</a></p>`}`
  return box(s.campaign_name, `<p><strong>${money(s.amount_cents)} per month</strong> ${subscriptionState(s)}</p>${s.cancel_at_period_end && !ended ? '<p>Scheduled to end at the end of the current billing period.</p>' : ''}${actions}`)
 }).join('')
 return portalPage('Your monthly giving', `<p>Welcome, ${e(name)}.</p>${cancelled ? '<p class="notice" role="status">Your cancellation request was saved. The current status is shown below.</p>' : ''}${rows || box('Monthly gifts', '<p>You have no monthly gifts on this account.</p>')}<p>Payment card details are handled securely by Stripe.</p>`)
}
