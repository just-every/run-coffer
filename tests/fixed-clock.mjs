export const fixedNow = '2026-10-18T02:00:00.000Z'

// Miniflare's Worker has its own global Date, separate from Node's test clock.
export function freezeClock() {
 const RealDate = Date, instant = RealDate.parse(fixedNow)
 globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [instant])) }
  static now() { return instant }
 }
}
