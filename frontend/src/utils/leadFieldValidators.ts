// Keep in sync with backend/src/utils/leadFieldValidators.ts

// Loose check: digits plus common separators, optional leading "+", optional extension (x123 / ext. 123).
// TODO: replace with a dedicated library (e.g. libphonenumber-js) for real per-country validation.
const PHONE_REGEX = /^\+?[\d\s\-().]+(?:\s*(?:x|ext\.?)\s*\d+)?$/i

export const isValidPhoneNumber = (value: string): boolean => {
  if (!PHONE_REGEX.test(value)) return false
  const mainPart = value.split(/x|ext/i)[0]
  const digits = mainPart.replace(/\D/g, '').length
  return digits >= 7 && digits <= 15
}

const LINKEDIN_PATH_PREFIXES = ['/in/', '/pub/', '/company/', '/school/']

/**
 * Accepts linkedin.com profile/company URLs (with or without protocol/www, incl. country subdomains
 * like uk.linkedin.com) and lnkd.in short links. Returns a normalized https URL, or null if invalid.
 */
export const normalizeLinkedInUrl = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  const path = url.pathname

  if (host === 'lnkd.in') {
    return path.length > 1 ? `https://lnkd.in${path}` : null
  }

  const isLinkedInHost = host === 'linkedin.com' || host.endsWith('.linkedin.com')
  if (!isLinkedInHost) return null

  const prefix = LINKEDIN_PATH_PREFIXES.find((p) => path.toLowerCase().startsWith(p))
  if (!prefix || path.length <= prefix.length) return null

  return `https://${host}${path}`
}

export const isValidLinkedInUrl = (value: string): boolean => normalizeLinkedInUrl(value) !== null

/** Whole number >= 0. Accepts numbers or numeric strings. Returns null if invalid/empty. */
export const parseYearsInRole = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const str = String(value).trim()
  if (!/^\d+$/.test(str)) return null
  const num = Number(str)
  return num <= 100 ? num : null
}
