import { links } from './links'

/** One line: the lockup, then Docs, Source and the licence. */
export function SiteFooter() {
  return <footer className="site-footer">
    <div className="site-wrap"><div>
      <a className="site-brand" href={links.home}><img src="/brand/mark.svg" alt="" width="28" height="28" /><span>Coffer</span></a>
      <nav aria-label="Footer"><a href={links.docs}>Docs</a><a href={links.source}>Source</a><a href={links.licence}>MIT licensed</a></nav>
    </div></div>
  </footer>
}
