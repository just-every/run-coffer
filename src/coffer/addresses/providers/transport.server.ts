import type { PostalAddress, ProviderErrorReason, ProviderFetch } from './types'

export function object(value: unknown): Record<string, unknown> | undefined {
 return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function text(value: unknown): string {
 return typeof value === 'string' ? value.trim() : ''
}

export function isUnitedStates(country: string): boolean {
 return ['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(country.trim().toUpperCase())
}

export function completeAddress(address: PostalAddress): boolean {
 return Boolean(address.street.trim() && (address.postalCode.trim() || (address.city.trim() && address.state.trim())))
}

/** Do not surface raw bodies, provider errors, keys, or donor data in diagnostics. */
export async function postJson(url: string, body: unknown, headers: Record<string, string>, fetcher?: ProviderFetch): Promise<{ value: unknown } | { error: ProviderErrorReason }> {
 let response: Response
 try {
  response = await (fetcher ?? fetch)(url, {
   method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
   body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(30_000),
  })
 } catch { return { error: 'network_error' } }
 if (response.status !== 200) return { error: 'http_error' }
 try { return { value: await response.json() } } catch { return { error: 'invalid_response' } }
}
