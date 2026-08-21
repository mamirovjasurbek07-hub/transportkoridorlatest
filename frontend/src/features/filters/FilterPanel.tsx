import { CalendarDays, Filter, RotateCcw } from 'lucide-react'
import type { Corridor, Country, CustomsPost, Filters } from '../../types'
import CountryCombobox from '../../CountryCombobox'

interface Props {
  value: Filters
  draft: Filters
  setDraft: (value: Filters) => void
  apply: () => void
  clear: () => void
  countries: Country[]
  posts: CustomsPost[]
  corridors: Corridor[]
}

const REPORT_PERIODS = [
  { year: '2026', label: '2026 yil', detail: 'Yanvar — iyul', date_from: '2026-01-01', date_to: '2026-07-31' },
  { year: '2025', label: '2025 yil', detail: 'To‘liq yil', date_from: '2025-01-01', date_to: '2025-12-31' },
  { year: '2024', label: '2024 yil', detail: 'To‘liq yil', date_from: '2024-01-01', date_to: '2024-12-31' },
] as const

export default function FilterPanel({ value, draft, setDraft, apply, clear, countries, posts, corridors }: Props) {
  const update = (key: keyof Filters, next: string) => setDraft({ ...draft, [key]: next })
  const originCodes = new Set(corridors.map((corridor) => corridor.origin_country_code).filter(Boolean))
  const matchingOriginCorridors = corridors.filter((corridor) => draft.origin && corridor.origin_country_code === draft.origin)
  const destinationCodes = new Set(matchingOriginCorridors.map((corridor) => corridor.destination_country_code).filter(Boolean))
  const groupCorridors = matchingOriginCorridors.filter((corridor) => !draft.destination || corridor.destination_country_code === draft.destination)
  const changeOrigin = (origin: string) => {
    const matches = corridors.filter((corridor) => corridor.origin_country_code === origin)
    const matchingDestinations = [...new Set(matches.map((corridor) => corridor.destination_country_code).filter((code): code is string => Boolean(code)))]
    const destination = draft.destination && matchingDestinations.includes(draft.destination) ? draft.destination : matchingDestinations.length === 1 ? matchingDestinations[0] : ''
    setDraft({ ...draft, origin, destination, corridor: '' })
  }
  const changeDestination = (destination: string) => setDraft({ ...draft, destination, corridor: '' })
  const selectedPeriod = REPORT_PERIODS.find((period) => period.date_from === draft.date_from && period.date_to === draft.date_to)
  const changePeriod = (year: string) => {
    const period = REPORT_PERIODS.find((item) => item.year === year)
    if (period) setDraft({ ...draft, date_from: period.date_from, date_to: period.date_to })
  }
  return (
    <section className="filter-panel panel" aria-label="Tranzit ma'lumotlarini filtrlash">
      <div className="panel-heading"><div><span className="icon-box"><Filter size={18} /></span><div><h2>Ma'lumotlarni filtrlash</h2><p>Yo'nalish va davrni tanlang</p></div></div><span className="filter-status">{JSON.stringify(value) === JSON.stringify(draft) ? 'Faol' : 'O‘zgartirilgan'}</span></div>
      <div className="filter-grid">
        <label><span>Tashuv boshlangan davlat</span><CountryCombobox value={draft.origin} onChange={changeOrigin} countries={countries.filter((country) => originCodes.has(country.alpha2))} emptyLabel="Barcha yo'nalishlar"/></label>
        <label><span>Tashuv tugallangan davlat</span><CountryCombobox value={draft.destination} onChange={changeDestination} countries={countries.filter((country) => destinationCodes.has(country.alpha2))} emptyLabel={draft.origin ? "Barcha mos davlatlar" : "Avval boshlanish davlatini tanlang"} disabled={!draft.origin}/><small className="route-group-hint">{draft.origin ? `${destinationCodes.size} ta mos tugash davlati · ${groupCorridors.length} ta corridor` : "Ro‘yxat bazadagi mavjud yo‘nalishlardan avtomatik tuziladi"}</small></label>
        <label><span>Hisobot yili</span><div className="input-wrap"><CalendarDays size={16} /><select value={selectedPeriod?.year || ''} onChange={(event) => changePeriod(event.target.value)}>{!selectedPeriod && <option value="">Maxsus davr</option>}{REPORT_PERIODS.map((period) => <option key={period.year} value={period.year}>{period.label}</option>)}</select></div><small className="route-group-hint">Rasmiy avtomobil postlari hisoboti</small></label>
        <label><span>Ma’lumot davri</span><div className="input-wrap report-period-display"><CalendarDays size={16} /><strong>{selectedPeriod ? selectedPeriod.detail : `${draft.date_from} — ${draft.date_to}`}</strong></div><small className="route-group-hint">{draft.date_from} — {draft.date_to}</small></label>
        <details className="advanced-filters"><summary>Qo'shimcha filtrlar</summary><div className="advanced-grid">
          <label><span>Kirish posti</span><select value={draft.entry} onChange={(e) => update('entry', e.target.value)}><option value="">Barchasi</option>{posts.map((p) => <option key={p.id} value={p.post_code}>{p.post_code} · {p.post_name}</option>)}</select></label>
          <label><span>Chiqish posti</span><select value={draft.exit} onChange={(e) => update('exit', e.target.value)}><option value="">Barchasi</option>{posts.map((p) => <option key={p.id} value={p.post_code}>{p.post_code} · {p.post_name}</option>)}</select></label>
        </div></details>
      </div>
      <div className="filter-actions"><button className="btn ghost" onClick={clear}><RotateCcw size={16} /> Tozalash</button><button className="btn primary" onClick={apply}>Qo'llash <span>→</span></button></div>
    </section>
  )
}
