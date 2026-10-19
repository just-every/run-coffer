// The pieces every section is made of. Text in the drawings is real text; the
// drawings are HTML and CSS (styles/cards.css and styles/sections/), never screenshots.
import type { CSSProperties, ReactNode } from 'react'

/** One dated step of the appeal: the eyebrow (its date), a two-line heading (white, then the violet tint) and a short
 * paragraph. `--h` is the heading's size at 1440 and `--wl` its widest line's width there, so it shrinks to its column. */
export function StepCopy({ id, when, lead, tint, children, h, wl }: { id: string; when: string; lead: ReactNode; tint: ReactNode; children: ReactNode; h: number; wl: number }) {
  return <div className="step-copy">
    <p className="eyebrow"><span className="eyebrow-dot" aria-hidden="true" />{when}</p>
    <h2 id={`${id}-title`} style={{ '--h': h, '--wl': wl } as CSSProperties}><span className="lead">{lead}</span> <span className="tint">{tint}</span></h2>
    <p className="step-body">{children}</p>
  </div>
}

/** A drawing of the product: real text a screen reader skips, described once by `label`. */
export function Drawing({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  return <div className={`drawing ${className}`} role="img" aria-label={label}><div aria-hidden="true" className="drawing-inner">{children}</div></div>
}

/** A painted plate: AVIF, then WebP, at the sizes public/site holds; `phone` swaps in a tighter crop on narrow screens. */
export function Painting({ name, widths, sizes, alt = '', className, phone, eager = false }: { name: string; widths: number[]; sizes: string; alt?: string; className?: string; phone?: { name: string; widths: number[]; media: string }; eager?: boolean }) {
  const set = (n: string, ws: number[], ext: string) => ws.map(w => `/site/${n}-${w}.${ext} ${w}w`).join(', ')
  const largest = Math.max(...widths)
  return <picture className={className}>
    {phone && <source media={phone.media} type="image/avif" srcSet={set(phone.name, phone.widths, 'avif')} sizes="100vw" />}
    {phone && <source media={phone.media} type="image/webp" srcSet={set(phone.name, phone.widths, 'webp')} sizes="100vw" />}
    <source type="image/avif" srcSet={set(name, widths, 'avif')} sizes={sizes} />
    <img src={`/site/${name}-${largest}.webp`} srcSet={set(name, widths, 'webp')} sizes={sizes} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : undefined} />
  </picture>
}

export type Tone = 'green' | 'violet' | 'coral' | 'amber' | 'grey'

const PATHS: Record<string, ReactNode> = {
  gift: <><rect x="3.5" y="8" width="17" height="4.5" rx="1" /><path d="M5 12.5V20h14v-7.5M12 8v12M12 8c-1.6-3.6-6-4.2-6-1.6C6 8 9.5 8 12 8Zm0 0c1.6-3.6 6-4.2 6-1.6C18 8 14.5 8 12 8Z" /></>,
  card: <><rect x="3" y="5.5" width="18" height="13" rx="2.2" /><path d="M3 10h18M6.5 14.5h4" /></>,
  doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M9.5 12h5M9.5 15.5h5" /></>,
  sheet: <><path d="M6.5 3h7.5l4 4v14h-11.5z" /><path d="M14 3v4h4M9.5 11h6M9.5 14h6M9.5 17h6M12.5 11v6" /></>,
  phone: <><path d="M8.6 3.8 6.3 4.5c-1.2.4-2 1.6-1.8 2.9.9 6.2 5.9 11.2 12.1 12.1 1.3.2 2.5-.6 2.9-1.8l.7-2.3-4.2-2.1-1.9 1.9a10.6 10.6 0 0 1-4.6-4.6l1.9-1.9Z" /></>,
  people: <><circle cx="8.5" cy="9" r="3.2" /><circle cx="16.5" cy="7.5" r="2.6" /><path d="M2.8 19.5c.6-3.2 2.9-5 5.7-5s5.1 1.8 5.7 5M14.6 13c2.9-.6 5.8.8 6.6 4.3" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4.5 7 7.5 6 7.5-6" /></>,
  star: <><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z" /></>,
  ban: <><circle cx="12" cy="12" r="8" /><path d="m6.4 6.4 11.2 11.2" /></>,
  alert: <><path d="M12 7.5v5.5M12 16.5h.01" /></>,
  moon: <><path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1Z" /></>,
  chevron: <><path d="m6.5 14.5 5.5-5.5 5.5 5.5" /></>,
}
export const Icon = ({ name, className = '' }: { name: keyof typeof PATHS | string; className?: string }) => <svg className={`icon ${className}`.trim()} viewBox="0 0 24 24">{PATHS[name]}</svg>

/** A round chip holding a line icon: tinted (`fill` false) or a solid colour with a white icon. */
export const Chip = ({ icon, tone, solid = false, fill = false }: { icon: string; tone: Tone; solid?: boolean; fill?: boolean }) => <span className={`chip-icon ${tone}${solid ? ' solid' : ''}${fill ? ' fill' : ''}`}><Icon name={icon} /></span>

export const Check = ({ className = 'check' }: { className?: string }) => <svg className={className} viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" /><path d="m7.2 12.4 3.2 3.2 6.4-6.8" /></svg>
export const Tick = () => <svg className="tick" viewBox="0 0 16 16"><path d="m3 8.5 3.2 3.2L13 4.8" /></svg>

/** A donor as initials in a tinted circle: no photos of people. */
export const Initials = ({ children, tone }: { children: string; tone: Tone }) => <span className={`initials ${tone}`}>{children}</span>

/** The development agent's spark. */
export const Spark = () => <svg className="spark" viewBox="0 0 32 32"><path d="M13 3.5c.9 5.6 3.4 8.1 9 9-5.6.9-8.1 3.4-9 9-.9-5.6-3.4-8.1-9-9 5.6-.9 8.1-3.4 9-9Z" /><path d="M24.5 17.5c.5 3 1.8 4.3 4.8 4.8-3 .5-4.3 1.8-4.8 4.8-.5-3-1.8-4.3-4.8-4.8 3-.5 4.3-1.8 4.8-4.8Z" /></svg>

/** Window chrome: the three dots, and an address when it is a browser. */
export const Chrome = ({ url }: { url?: string }) => <p className="chrome"><span /><span /><span />{url ? <span className="chrome-url">{url}</span> : null}</p>
