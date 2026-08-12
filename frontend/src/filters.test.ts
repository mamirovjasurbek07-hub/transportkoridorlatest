import { describe, expect, it } from 'vitest'
import { filtersToSearch, initialDateRange } from './filters'

describe('filter helpers', () => {
  it('defaults to first of January through local today', () => {
    expect(initialDateRange(new Date(2026, 7, 11))).toEqual({ date_from: '2026-01-01', date_to: '2026-08-11' })
  })

  it('keeps only active URL filters', () => {
    const query = filtersToSearch({ date_from: '2026-01-01', date_to: '2026-08-11', origin: 'CN', destination: '', entry: '', exit: '', corridor: '' })
    expect(query).toContain('origin=CN')
    expect(query).not.toContain('destination')
  })
})
