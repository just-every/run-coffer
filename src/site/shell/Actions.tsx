import { links } from './links'

export const Arrow = () => <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 11h14.5M12.5 5.5 18 11l-5.5 5.5" /></svg>

/** Run Coffer (the violet pill), then the demo and the docs as outlined pills: under it in the hero, beside it at the close. */
export function Actions({ demo = true, className = '' }: { demo?: boolean; className?: string }) {
  return <div className={`site-actions ${className}`.trim()}>
    <a className="site-pill" href={links.run}>Run Coffer<Arrow /></a>
    <div className="site-ghosts">
      {demo && <a className="site-ghost" href={links.demo}>Try the demo</a>}
      <a className="site-ghost" href={links.docs}>Read the docs</a>
    </div>
  </div>
}
