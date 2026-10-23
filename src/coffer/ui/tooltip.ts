const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))

/** Pure CSS: hover waits 300ms; keyboard focus reveals the same label immediately. */
export const tooltipLink = (href: string, accessibleLabel: string, label: string, glyph: string) =>
 `<a class="cf-tip" href="${escape(href)}" aria-label="${escape(accessibleLabel)}">${glyph}<span role="tooltip">${escape(label)}</span></a>`
