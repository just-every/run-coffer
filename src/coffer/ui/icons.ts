// Line icons for the rail, top bar and status chips (from the 12ui conversion
// of the owner-picked Gifts screen). One sprite per page; icon() references it.
const PATHS: Record<string, string> = {
 home: '<path d="M2 10 12 2l10 8M5 9v13h14V9M10 22v-7h4v7"/>',
 people: '<circle cx="10" cy="7" r="4"/><path d="M2 22v-3c0-7 16-7 16 0v3ZM17 3c5 1 5 7 1 8M20 15c2 1 3 3 3 6"/>',
 gift: '<path d="M3 10h18v12H3zM2 6h20v4H2zM12 6v16"/><path d="M12 6C4 8 4 0 8 2c3 0 4 4 4 4Zm0 0c8 2 8-6 4-4-3 0-4 4-4 4Z"/>',
 mail: '<path d="M2 5h20v14H2z"/><path d="m2 6 10 7 10-7"/>',
 send: '<path d="m2 10 20-8-8 20-4-8-8-4Zm8 4L22 2"/>',
 megaphone: '<path d="m3 8 17-6v20L3 16ZM3 8H1v8h2M7 18l2 5h4l-2-4M15 4v16"/>',
 book: '<path d="M12 4v18M2 3c4-1 7 0 10 2 3-2 6-3 10-2v18c-4-1-7-1-10 1-3-2-6-2-10-1Z"/>',
 phone: '<path d="M5 2h4l2 5-3 2c1 3 3 5 6 6l2-3 5 2v4c0 2-1 3-3 3C9 21 3 15 2 5c0-2 1-3 3-3Z"/>',
 clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 3"/>',
 chart: '<path d="M2 22h21M5 21V11m5 10V5m5 16V9m5 12V2"/>',
 trend: '<path d="M2 20h20M3 15l6-6 4 4 8-8M15 5h6v6"/>',
 spark: '<path d="m10 3 2 6 6 2-6 3-2 6-3-6-5-3 5-2Zm9-2 1 3 3 1-3 1-1 3-1-3-3-1 3-1"/>',
 gear: '<path d="m9 2 6 0 1 4 4-1 2 5-3 2 3 3-3 5-4-2-2 4-5-1v-4l-4 1-2-5 3-3-1-4 4-2Z"/><circle cx="12" cy="12" r="3"/>',
 search: '<circle cx="10" cy="10" r="8"/><path d="m16 16 6 6"/>',
 file: '<path d="M4 2h11l5 5v15H4ZM14 2v6h6M8 12h8m-8 4h8"/>',
 edit: '<path d="m4 16 12-12c3-3 7 1 4 4L8 20l-5 1ZM14 6l4 4"/>',
 check: '<path d="m5 12 5 5 9-10"/>',
 alert: '<path d="M12 6v7M12 17v.5"/>',
 refresh: '<path d="M21 8A9 9 0 0 0 5 5L2 8m0-6v6h6M3 16a9 9 0 0 0 16 3l3-3m0 6v-6h-6"/>',
 menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
 right: '<path d="m9 5 7 7-7 7"/>',
}
export type IconName = keyof typeof PATHS
export const sprite = `<svg class="cf-sprite" aria-hidden="true"><defs>${Object.entries(PATHS).map(([id, d]) => `<symbol id="i-${id}" viewBox="0 0 24 24">${d}</symbol>`).join('')}</defs></svg>`
export const icon = (name: IconName, cls = '') => `<svg class="cf-icon${cls ? ` ${cls}` : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`
