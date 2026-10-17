// The pieces every section is made of. Text in the drawings is real text; the
// drawings are HTML and CSS (styles/cards.css), never screenshots.
import type { ReactNode } from 'react'

/** One idea per section: eyebrow, a two-line heading (white, then the violet tint) and a short paragraph beside
 * its drawing; `flip` puts the drawing first. */
export function Feature({ id, eyebrow, lead, tint, children, art, flip = false, label, className = '' }: { id: string; eyebrow: string; lead: ReactNode; tint: ReactNode; children: ReactNode; art: ReactNode; flip?: boolean; label: string; className?: string }) {
  return <section id={id} className={`feature${flip ? ' flip' : ''} ${className}`.trim()} aria-labelledby={`${id}-title`}>
    <div className="site-wrap feature-row">
      <div className="feature-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={`${id}-title`}><span className="lead">{lead}</span> <span className="tint">{tint}</span></h2>
        <p className="feature-body">{children}</p>
      </div>
      <div className="feature-art" role="img" aria-label={label}><div aria-hidden="true" className="feature-drawing">{art}</div></div>
    </div>
  </section>
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

export type Tone = 'green' | 'violet' | 'coral' | 'amber'

const PATHS: Record<string, ReactNode> = {
  gift: <><rect x="3.5" y="8" width="17" height="4.5" rx="1" /><path d="M5 12.5V20h14v-7.5M12 8v12M12 8c-1.6-3.6-6-4.2-6-1.6C6 8 9.5 8 12 8Zm0 0c1.6-3.6 6-4.2 6-1.6C18 8 14.5 8 12 8Z" /></>,
  card: <><rect x="3" y="5.5" width="18" height="13" rx="2.2" /><path d="M3 10h18M6.5 14.5h4" /></>,
  doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M9.5 12h5M9.5 15.5h5" /></>,
  phone: <><path d="M8.6 3.8 6.3 4.5c-1.2.4-2 1.6-1.8 2.9.9 6.2 5.9 11.2 12.1 12.1 1.3.2 2.5-.6 2.9-1.8l.7-2.3-4.2-2.1-1.9 1.9a10.6 10.6 0 0 1-4.6-4.6l1.9-1.9Z" /></>,
  person: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c.8-3.6 3.8-5.7 7.5-5.7s6.7 2.1 7.5 5.7" /></>,
  people: <><circle cx="8.5" cy="9" r="3.2" /><circle cx="16.5" cy="7.5" r="2.6" /><path d="M2.8 19.5c.6-3.2 2.9-5 5.7-5s5.1 1.8 5.7 5M14.6 13c2.9-.6 5.8.8 6.6 4.3" /></>,
  bank: <><path d="M3.5 9 12 4.2 20.5 9zM5 20.5h14M6.8 11.2v7M10.3 11.2v7M13.7 11.2v7M17.2 11.2v7" /></>,
  wallet: <><path d="M4 7.5h14.5a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5.5A1.5 1.5 0 0 1 4 18.5Z" /><path d="M4 7.5 15.5 4v3.5M16 13.8h1.5" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4.5 7 7.5 6 7.5-6" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2.2" /><path d="M4 9.5h16M8.5 3v4M15.5 3v4M8.5 13.5h.01M12 13.5h.01M15.5 13.5h.01" /></>,
  heart: <><path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z" /></>,
  shield: <><path d="M12 3.5 5 6v5.5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6Z" /></>,
  laptop: <><rect x="5" y="5" width="14" height="10" rx="1.5" /><path d="M2.5 18.5h19" /></>,
  database: <><ellipse cx="12" cy="6" rx="7" ry="2.8" /><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" /></>,
  export: <><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" /><path d="M5 12v7.5h14V12" /></>,
  alert: <><path d="M12 7.5v5.5M12 16.5h.01" /></>,
}
export const Icon = ({ name, className = '' }: { name: keyof typeof PATHS | string; className?: string }) => <svg className={`icon ${className}`.trim()} viewBox="0 0 24 24">{PATHS[name]}</svg>

/** A tinted round chip holding a line icon, as the desk draws them on every card. */
export const Chip = ({ icon, tone, solid = false }: { icon: string; tone: Tone; solid?: boolean }) => <span className={`chip-icon ${tone}${solid ? ' solid' : ''}`}><Icon name={icon} /></span>

export const Check = ({ className = 'check' }: { className?: string }) => <svg className={className} viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" /><path d="m7.2 12.4 3.2 3.2 6.4-6.8" /></svg>
export const Tick = () => <svg className="tick" viewBox="0 0 16 16"><path d="m3 8.5 3.2 3.2L13 4.8" /></svg>

/** A donor as initials in a tinted circle: no photos of people. */
export const Initials = ({ children, tone }: { children: string; tone: Tone }) => <span className={`initials ${tone}`}>{children}</span>

/** The development agent's spark. */
export const Spark = () => <svg className="spark" viewBox="0 0 32 32"><path d="M13 3.5c.9 5.6 3.4 8.1 9 9-5.6.9-8.1 3.4-9 9-.9-5.6-3.4-8.1-9-9 5.6-.9 8.1-3.4 9-9Z" /><path d="M24.5 17.5c.5 3 1.8 4.3 4.8 4.8-3 .5-4.3 1.8-4.8 4.8-.5-3-1.8-4.3-4.8-4.8 3-.5 4.3-1.8 4.8-4.8Z" /></svg>
