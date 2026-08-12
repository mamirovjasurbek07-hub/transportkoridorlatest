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
  return (
    <section className="filter-panel panel" aria-label="Tranzit ma'lumotlarini filtrlash">
      <div className="panel-heading"><div><span className="icon-box"><Filter size={18} /></span><div><h2>Ma'lumotlarni filtrlash</h2><p>Yo'nalish va davrni tanlang</p></div></div><span className="filter-status">{JSON.stringify(value) === JSON.stringify(draft) ? 'Faol' : 'O‘zgartirilgan'}</span></div>
      <div className="filter-grid">
        <label><span>Tashuv boshlangan davlat</span><CountryCombobox value={draft.origin} onChange={changeOrigin} countries={countries.filter((country) => originCodes.has(country.alpha2))} emptyLabel="Barcha yo'nalishlar"/></label>
        <label><span>Tashuv tugallangan davlat</span><CountryCombobox value={draft.destination} onChange={changeDestination} countries={countries.filter((country) => destinationCodes.has(country.alpha2))} emptyLabel={draft.origin ? "Barcha mos davlatlar" : "Avval boshlanish davlatini tanlang"} disabled={!draft.origin}/><small className="route-group-hint">{draft.origin ? `${destinationCodes.size} ta mos tugash davlati · ${groupCorridors.length} ta corridor` : "Ro‘yxat bazadagi mavjud yo‘nalishlardan avtomatik tuziladi"}</small></label>
        <label><span>Boshlanish sanasi</span><div className="input-wrap"><CalendarDays size={16} /><input type="date" value={draft.date_from} max={draft.date_to} onChange={(e) => update('date_from', e.target.value)} /></div></label>
        <label><span>Tugash sanasi</span><div className="input-wrap"><CalendarDays size={16} /><input type="date" value={draft.date_to} min={draft.date_from} max={new Date().toISOString().slice(0, 10)} onChange={(e) => update('date_to', e.target.value)} /></div></label>
        <details className="advanced-filters"><summary>Qo'shimcha filtrlar</summary><div className="advanced-grid">
          <label><span>Kirish posti</span><select value={draft.entry} onChange={(e) => update('entry', e.target.value)}><option value="">Barchasi</option>{posts.map((p) => <option key={p.id} value={p.post_code}>{p.post_code} · {p.post_name}</option>)}</select></label>
          <label><span>Chiqish posti</span><select value={draft.exit} onChange={(e) => update('exit', e.target.value)}><option value="">Barchasi</option>{posts.map((p) => <option key={p.id} value={p.post_code}>{p.post_code} · {p.post_name}</option>)}</select></label>
        </div></details>
      </div>
      <div className="filter-actions"><button className="btn ghost" onClick={clear}><RotateCcw size={16} /> Tozalash</button><button className="btn primary" onClick={apply}>Qo'llash <span>→</span></button></div>
    </section>
  )
}
