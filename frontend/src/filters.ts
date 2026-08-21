import type { Filters } from './types'

export function filtersToSearch(filters: Filters): string {
  return new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString()
}

export function initialDateRange(_now = new Date()): Pick<Filters, 'date_from' | 'date_to'> {
  return { date_from: '2026-01-01', date_to: '2026-07-31' }
}
