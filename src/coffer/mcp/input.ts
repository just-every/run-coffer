import type { Row } from '../db'

const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
export const string = (description: string, maxLength: number, minLength = 1) => ({ type: 'string', description, minLength, maxLength })
export const identifier = (description: string) => string(description, 100)
export const schema = (properties: Row, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

/** Validate exactly the JSON Schema keywords used by the fixed tool catalog. */
export function validInput(value: unknown, s: Row): boolean {
 if (s.type === 'object') return object(value) && (s.required ?? []).every((key: string) => Object.hasOwn(value, key)) && Object.entries(value).every(([key, item]) => Object.hasOwn(s.properties, key) && validInput(item, s.properties[key]))
 if (s.type === 'string') return typeof value === 'string' && (s.minLength === undefined || [...value].length >= s.minLength) && (s.maxLength === undefined || [...value].length <= s.maxLength) && (!s.pattern || new RegExp(s.pattern).test(value)) && (!s.enum || s.enum.includes(value))
 if (s.type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value) && value >= s.minimum && value <= s.maximum
 if (s.type === 'array') return Array.isArray(value) && value.length >= s.minItems && value.length <= s.maxItems && (!s.uniqueItems || new Set(value).size === value.length) && value.every(item => validInput(item, s.items))
 return false
}
