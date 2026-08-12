import type { Filters } from './types'

export function filtersToSearch(filters: Filters): string {
  return new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString()
}

export function initialDateRange(now = new Date()): Pick<Filters, 'date_from' | 'date_to'> {
  const localDate = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return { date_from: `${now.getFullYear()}-01-01`, date_to: localDate(now) }
}
