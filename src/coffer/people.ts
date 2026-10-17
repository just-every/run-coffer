import { operatorAuth, type Bindings } from '../auth.server'
import { AuthError } from '../modules/operator-auth/index.mjs'
import { manager } from './auth'
import { all, fail, type Context, type Row } from './db'

const REFUSALS: Record<string, string> = {
 invalid_email: 'Enter a complete email address.',
 invalid_input: 'Enter a complete email address.',
 invalid_role: 'Choose admin or member.',
 email_not_allowed: 'This installation only lets in email addresses on its allowed list.',
 invitation_conflict: 'That email already has an account or an invitation with another role. Change their access below instead.',
 rate_limited: 'Too many invitations in a short time. Wait a few minutes and try again.',
 mail_unavailable: 'The invitation email could not be sent. This installation needs a mail provider and sender address; see the hosting guide.',
 forbidden: 'Only the owner invites admins. Choose Member, or ask the owner.',
}

/** Base's own invitation: an emailed one-use sign-in link that admits the person with the chosen role. */
export async function invitePerson(request: Request, c: Context, env: Bindings, input: Record<string, unknown>) {
 if (!manager(c.actor)) fail('manager_required', 'Only the owner or an admin invites people.', 403)
 const email = String(input.email ?? '').trim(), role = String(input.role ?? '') as 'admin' | 'member'
 if (!['admin', 'member'].includes(role)) fail('INPUT', REFUSALS.invalid_role, 400)
 try {
  await operatorAuth(env).invite(request, { email, role, displayName: String(input.displayName ?? '').trim() || email.split('@')[0], returnTo: '/app' })
 } catch (error) {
  if (error instanceof AuthError) fail(error.code, REFUSALS[error.code] ?? 'The invitation could not be created.', error.status)
  throw error
 }
 return email.toLowerCase()
}

/** Everyone with access, and on this computer the sign-in-as links Base offers instead of mail. */
export async function people(request: Request, c: Context, env: Bindings): Promise<Row[]> {
 const rows = await all(c, "SELECT id,email,display_name,role,status FROM oa_operators WHERE status IN ('active','invited') ORDER BY created_at,id")
 const links = env.AUTH_LOCAL === 'true' ? await operatorAuth(env).oneClick?.people(request) ?? [] : []
 return rows.map(row => ({ ...row, signInUrl: links.find((link: Row) => link.email === row.email)?.href ?? null }))
}
