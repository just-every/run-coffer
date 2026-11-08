import { DatabaseSync } from 'node:sqlite'
import { readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = resolve(process.argv[2])
const { nativeMigrationPreflight, migrationInventory, platformMigrationDeclaration } = await import(pathToFileURL(join(root, 'node_modules/@runeditrun/rer/cli/portability-migrations.mjs')))
const directory = join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
const names = (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.sqlite$/.test(name))
if (names.length !== 1) throw Error('Expected one local installation database')
const sqlite = new DatabaseSync(join(directory, names[0]), { readOnly: true })
const db = { prepare(query) {
 const statement = sqlite.prepare(query)
 const bound = (...params) => ({ all: async () => ({ results: statement.all(...params) }) })
 return { ...bound(), bind: bound }
} }
try {
 const inventory = await migrationInventory(root, 'DB', platformMigrationDeclaration())
 const result = await nativeMigrationPreflight({ root, db })
 if (result.nativeApply) throw Error('Installation has unapplied migrations')
 console.log(JSON.stringify({ check: 'nativeMigrationPreflight', ...result, migrationCount: inventory.length, newMigration: inventory.find(row => row.name.includes('mcp_request_capacity'))?.name, exit: 0 }))
} finally { sqlite.close() }
