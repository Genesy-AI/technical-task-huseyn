import { describe, expect, it } from 'vitest'
import { isValidCountryCode } from './countryCodes'

describe('isValidCountryCode', () => {
  it('accepts valid ISO alpha-2 codes, case-insensitive and trimmed', () => {
    expect(isValidCountryCode('US')).toBe(true)
    expect(isValidCountryCode('es')).toBe(true)
    expect(isValidCountryCode(' GB ')).toBe(true)
  })

  it('rejects invalid codes', () => {
    for (const code of ['XXX', 'XX', 'U', '', 'USA', 'EU', 12, null, undefined]) {
      expect(isValidCountryCode(code)).toBe(false)
    }
  })
})
