import type { Filters } from './types'

export function filtersToSearch(filters: Filters): string {
  return new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString()
}

export function initialDateRange(now = new Date()): Pick<Filters, 'date_from' | 'date_to'> {
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  return { date_from: `${now.getFullYear()}-01-01`, date_to: localDate }
}
