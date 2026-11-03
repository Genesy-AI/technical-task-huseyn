// Keep in sync with backend/src/utils/leadFieldValidators.test.ts
import { describe, it, expect } from 'vitest'
import { isValidPhoneNumber, normalizeLinkedInUrl, parseYearsInRole } from './leadFieldValidators'

describe('isValidPhoneNumber', () => {
  it.each([
    '+1-280-754-0462x2154',
    '001-464-312-8555',
    '(760)551-9973x6454',
    '3467565048',
    '+44 20 7946 0958',
    '555-1234 ext. 12',
  ])('accepts %s', (value) => expect(isValidPhoneNumber(value)).toBe(true))

  it.each(['abc', '123', '+1-555-CALL-NOW', '12345678901234567', 'x1234'])('rejects %s', (value) =>
    expect(isValidPhoneNumber(value)).toBe(false)
  )
})

describe('normalizeLinkedInUrl', () => {
  it.each([
    ['https://www.linkedin.com/in/john-doe', 'https://www.linkedin.com/in/john-doe'],
    ['linkedin.com/in/john-doe/', 'https://linkedin.com/in/john-doe/'],
    ['http://uk.linkedin.com/pub/john-doe/1/2/3', 'https://uk.linkedin.com/pub/john-doe/1/2/3'],
    ['www.linkedin.com/company/acme', 'https://www.linkedin.com/company/acme'],
    ['https://lnkd.in/abc123', 'https://lnkd.in/abc123'],
    ['https://www.linkedin.com/in/john?trk=x', 'https://www.linkedin.com/in/john'],
  ])('normalizes %s', (input, expected) => expect(normalizeLinkedInUrl(input)).toBe(expected))

  it.each([
    '',
    'not a url',
    'https://example.com/in/john',
    'https://linkedin.com/',
    'https://linkedin.com/in/',
    'https://lnkd.in/',
    'https://fakelinkedin.com/in/john',
    'https://linkedin.com.evil.com/in/john',
  ])('rejects %s', (input) => expect(normalizeLinkedInUrl(input)).toBeNull())
})

describe('parseYearsInRole', () => {
  it.each([
    ['5', 5],
    [5, 5],
    ['0', 0],
    [' 10 ', 10],
  ])('parses %s', (input, expected) => expect(parseYearsInRole(input)).toBe(expected))

  it.each(['', null, undefined, '-1', '2.5', 'abc', '101'])('rejects %s', (input) =>
    expect(parseYearsInRole(input)).toBeNull()
  )
})
