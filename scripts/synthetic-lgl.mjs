#!/usr/bin/env node
// Writes a synthetic Little Green Light export in LGL's report column layout.
// Every name and address is invented; email addresses use example.org.
// usage: node scripts/synthetic-lgl.mjs <out-dir> [constituents=5000] [gifts=40000]
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function syntheticLgl(constituents = 5000, gifts = 40000) {
 let seed = 20261018
 const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
 const pick = list => list[Math.floor(random() * list.length)]
 const first = ['Ava', 'Ben', 'Cora', 'Dev', 'Elena', 'Femi', 'Grace', 'Hiro', 'Iris', 'Jon', 'Kofi', 'Lena', 'Mateo', 'Nia', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tara']
 const last = ['Adair', 'Brooks', 'Chen', 'Diaz', 'Evans', 'Fox', 'Garcia', 'Hale', 'Ito', 'Jones', 'Khan', 'Lopez', 'Mills', 'Nguyen', 'Okafor', 'Park', 'Reyes', 'Singh', 'Tran', 'Vance']
 const funds = ['General', 'Books', 'Tutoring', 'Capital'], campaigns = ['Spring appeal', 'Year-End', 'Gala', 'Read-a-thon'], methods = ['Check', 'Credit Card', 'Cash', 'ACH']
 const quote = value => /[",\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value)
 const csv = (header, rows) => [header, ...rows].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n'
 const people = Array.from({ length: constituents }, (_, i) => {
  const id = String(100001 + i), f = pick(first), l = pick(last)
  return [id, f, l, `${f}.${l}.${id}@example.org`.toLowerCase(), `555-01${String(i % 100).padStart(2, '0')}`, `${1 + i} ${pick(['Oak', 'Elm', 'Maple', 'Cedar'])} Street`, '', 'Springfield', 'IL', String(62701 + (i % 50)), 'US']
 })
 // Every tenth pair of neighbours are spouses: LGL keeps a couple as a Spouse relationship.
 const relationships = []
 for (let i = 0; i + 1 < constituents; i += 10) relationships.push([people[i][0], people[i + 1][0], 'Spouse'])
 const day = () => { const d = new Date(Date.UTC(2019, 0, 1) + Math.floor(random() * 6.75 * 365) * 86400000); return d.toISOString().slice(0, 10) }
 const rows = [], received = []
 const pledges = Math.floor(gifts / 100)
 for (let p = 0; p < pledges; p++) {
  const donor = people[Math.floor(random() * constituents)][0], fund = pick(funds), pledged = '2024-01-15'
  rows.push([`P${p + 1}`, donor, 'Pledge', pledged, '1200.00', fund, 'Capital campaign', '', 'Three-year pledge', '', '', ''])
  for (let k = 0; k < 2; k++) { const id = `PP${p + 1}-${k + 1}`; rows.push([id, donor, 'Gift', `202${4 + k}-02-01`, '400.00', fund, 'Capital campaign', pick(methods), 'Pledge payment', `P${p + 1}`, '400.00', '']); received.push(id) }
 }
 while (received.length < gifts) {
  const id = `G${received.length + 1}`, donor = people[Math.floor(random() * constituents)][0], amount = (5 + Math.floor(random() * 120) * 5).toFixed(2)
  rows.push([id, donor, 'Gift', day(), amount, pick(funds), pick(campaigns), pick(methods), '', '', amount, '']); received.push(id)
 }
 // Soft credits recognize a spouse for a gift without counting the money twice.
 const soft = Math.floor(gifts / 200), credited = new Set(), couples = new Map(relationships.flatMap(([a, b]) => [[a, b], [b, a]]))
 for (let s = 0; s < soft; s++) {
  const gift = rows.find((row, i) => i >= s * 150 && row[2] === 'Gift' && !row[9] && !credited.has(row[0]) && couples.has(row[1]))
  if (!gift) continue
  credited.add(gift[0]); const spouse = couples.get(gift[1])
  rows.push([`S${s + 1}`, spouse, 'Soft credit', gift[3], gift[4], gift[5], gift[6], '', '', '', '', gift[0]])
 }
 return {
  'constituents.csv': csv(['LGL Constituent ID', 'First Name', 'Last Name', 'Email Address', 'Phone Number', 'Address Line 1', 'Address Line 2', 'City', 'State', 'Postal Code', 'Country'], people),
  'gifts.csv': csv(['LGL Gift ID', 'LGL Constituent ID', 'Gift Type', 'Gift Date', 'Amount', 'Fund', 'Campaign', 'Payment Type', 'Gift Notes', 'LGL Parent Gift ID', 'Deductible Amount', 'Related Gift ID'], rows),
  'relationships.csv': csv(['LGL Constituent ID', 'Related Constituent ID', 'Relationship Type'], relationships),
 }
}

if (import.meta.url === `file://${process.argv[1]}`) {
 const [out, constituents = '5000', gifts = '40000'] = process.argv.slice(2)
 if (!out) { console.error('usage: node scripts/synthetic-lgl.mjs <out-dir> [constituents] [gifts]'); process.exit(2) }
 await mkdir(out, { recursive: true })
 for (const [name, text] of Object.entries(syntheticLgl(Number(constituents), Number(gifts)))) await writeFile(join(out, name), text)
 console.log(`wrote ${out}: ${constituents} constituents, ${gifts} received gifts`)
}
