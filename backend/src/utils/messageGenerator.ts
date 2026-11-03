export interface Lead {
  firstName: string
  lastName?: string | null
  email?: string | null
  jobTitle?: string | null
  companyName?: string | null
  countryCode?: string | null
  yearsInRole?: number | null
  phoneNumber?: string | null
  linkedIn?: string | null
}

// Single source of truth for fields usable in message templates (served via GET /leads/template-fields).
export const TEMPLATE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'jobTitle',
  'companyName',
  'countryCode',
  'yearsInRole',
  'phoneNumber',
  'linkedIn',
] as const satisfies readonly (keyof Lead)[]

type TemplateField = (typeof TEMPLATE_FIELDS)[number]

const isTemplateField = (name: string): name is TemplateField =>
  (TEMPLATE_FIELDS as readonly string[]).includes(name)

export function generateMessageFromTemplate(template: string, lead: Lead): string {
  let message = template

  const templateVariables = template.match(/\{(\w+)\}/g) || []

  for (const variable of templateVariables) {
    const fieldName = variable.slice(1, -1)

    if (isTemplateField(fieldName)) {
      const fieldValue = lead[fieldName]

      if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
        throw new Error(`Missing required field: ${fieldName}`)
      }

      message = message.replace(new RegExp(`\\{${fieldName}\\}`, 'g'), String(fieldValue))
    } else {
      throw new Error(`Unknown field in template: ${fieldName}`)
    }
  }

  return message
}
