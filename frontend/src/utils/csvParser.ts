import Papa from 'papaparse'
import { isValidPhoneNumber, normalizeLinkedInUrl, parseYearsInRole } from './leadFieldValidators'

export interface CsvLead {
  firstName: string
  lastName: string
  email: string
  jobTitle?: string
  countryCode?: string
  companyName?: string
  yearsInRole?: number
  phoneNumber?: string
  linkedIn?: string
  isValid: boolean
  errors: string[]
  /** Non-blocking issues with optional fields; the invalid value is dropped and the row stays importable. */
  warnings: string[]
  rowIndex: number
}

export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export const parseCsv = (content: string): CsvLead[] => {
  if (!content?.trim()) {
    throw new Error('CSV content cannot be empty')
  }

  const parseResult = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transform: (value) => value.trim(),
    transformHeader: (header) => header.trim().toLowerCase(),
    quoteChar: '"',
  })

  if (parseResult.errors.length > 0) {
    const criticalErrors = parseResult.errors.filter(
      (error) => error.type === 'Delimiter' || error.type === 'Quotes' || error.type === 'FieldMismatch'
    )
    if (criticalErrors.length > 0) {
      throw new Error(`CSV parsing failed: ${criticalErrors[0].message}`)
    }
  }

  if (!parseResult.data || parseResult.data.length === 0) {
    throw new Error('CSV file appears to be empty or contains no valid data')
  }

  const data: CsvLead[] = []

  parseResult.data.forEach((row, index) => {
    if (Object.values(row).every((value) => !value)) return

    const lead: Partial<CsvLead> = { rowIndex: index + 2 }
    const errors: string[] = []
    const warnings: string[] = []

    Object.entries(row).forEach(([header, value]) => {
      const normalizedHeader = header.toLowerCase().replace(/[^a-z]/g, '')
      const trimmedValue = value?.trim() || ''

      switch (normalizedHeader) {
        case 'firstname':
          lead.firstName = trimmedValue
          break
        case 'lastname':
          lead.lastName = trimmedValue
          break
        case 'email':
          lead.email = trimmedValue
          break
        case 'jobtitle':
          lead.jobTitle = trimmedValue || undefined
          break
        case 'countrycode':
          lead.countryCode = trimmedValue || undefined
          break
        case 'companyname':
          lead.companyName = trimmedValue || undefined
          break
        case 'yearsinrole':
          if (trimmedValue) {
            const years = parseYearsInRole(trimmedValue)
            if (years === null)
              warnings.push(
                `Invalid years in role "${trimmedValue}" (must be a whole number 0–100), it will be imported empty`
              )
            else lead.yearsInRole = years
          }
          break
        case 'phonenumber':
          if (trimmedValue) {
            if (isValidPhoneNumber(trimmedValue)) lead.phoneNumber = trimmedValue
            else warnings.push(`Invalid phone number "${trimmedValue}", it will be imported empty`)
          }
          break
        case 'linkedin':
          if (trimmedValue) {
            const linkedIn = normalizeLinkedInUrl(trimmedValue)
            if (linkedIn) lead.linkedIn = linkedIn
            else warnings.push(`Invalid LinkedIn URL "${trimmedValue}", it will be imported empty`)
          }
          break
      }
    })

    if (!lead.firstName?.trim()) {
      errors.push('First name is required')
    }
    if (!lead.lastName?.trim()) {
      errors.push('Last name is required')
    }
    if (!lead.email?.trim()) {
      errors.push('Email is required')
    } else if (!isValidEmail(lead.email)) {
      errors.push('Invalid email format')
    }

    data.push({
      ...lead,
      firstName: lead.firstName || '',
      lastName: lead.lastName || '',
      email: lead.email || '',
      isValid: errors.length === 0,
      errors,
      warnings,
    } as CsvLead)
  })

  return data
}
