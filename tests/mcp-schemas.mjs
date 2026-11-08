import assert from 'node:assert/strict'
import Ajv from 'ajv'

// Validate real transport results with an independent JSON Schema implementation.
// These are used inside the existing MCP and named-grant sanity journeys.
export function catalogSchemas(catalog) {
 const ajv = new Ajv({ strict: false, allErrors: true })
 const validators = new Map(catalog.map(tool => [tool.name, ajv.compile(tool.outputSchema)]))
 return (name, value) => {
  const validate = validators.get(name)
  assert.ok(validate, `The discovered catalog declares ${name}`)
  assert.equal(validate(value), true, `${name}: ${JSON.stringify(validate.errors)}`)
 }
}
