import { redactionStatements } from '@runeditrun/rer/modules/portability/journal'
import type { D1Database, D1Sql } from '../../modules/import-kit/src/d1/index.ts'
import { reject } from './types.ts'

/** Adapt Base portability's prepared statements into Kit's SQL descriptors.
 * All reads and state initialization still execute on the real database;
 * only the returned, unexecuted mutation statements are described for Kit. */
export async function portabilityCheckpoint(db: D1Database): Promise<D1Sql[]> {
  const descriptors = new WeakMap<object, D1Sql>()
  function statement(sql: string, params: any[] = []): object {
    const native = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql)
    const wrapped = new Proxy(native, {
      get(target, key) {
        if (key === 'bind') return (...values: any[]) => statement(sql, values)
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    descriptors.set(wrapped, { sql, params })
    return wrapped
  }
  const capture = new Proxy(db, {
    get(target, key) {
      if (key === 'prepare') return statement
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const prepared = await redactionStatements(capture)
  return prepared.map(value => {
    const result = descriptors.get(value)
    if (!result) reject('IMPORT_ERASURE_FENCE', 'Portability returned an unrecognized redaction statement.')
    return result
  })
}
