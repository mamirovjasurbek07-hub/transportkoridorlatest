import { CalendarDays, Filter, RotateCcw, Search } from 'lucide-react'
import type { Corridor, Country, CustomsPost, Filters } from '../../types'

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
  const destinationCodes = new Set(corridors.filter((corridor) => !draft.origin || corridor.origin_country_code === draft.origin).map((corridor) => corridor.destination_country_code).filter(Boolean))
  const visibleCorridors = corridors.filter((corridor) => (!draft.origin || corridor.origin_country_code === draft.origin) && (!draft.destination || corridor.destination_country_code === draft.destination))
  const changeOrigin = (origin: string) => {
    const matchingDestinations = new Set(corridors.filter((corridor) => !origin || corridor.origin_country_code === origin).map((corridor) => corridor.destination_country_code))
    setDraft({ ...draft, origin, destination: draft.destination && !matchingDestinations.has(draft.destination) ? '' : draft.destination, corridor: '' })
  }
  const changeDestination = (destination: string) => setDraft({ ...draft, destination, corridor: '' })
  return (
    <section className="filter-panel panel" aria-label="Tranzit ma'lumotlarini filtrlash">
      <div className="panel-heading"><div><span className="icon-box"><Filter size={18} /></span><div><h2>Ma'lumotlarni filtrlash</h2><p>Yo'nalish va davrni tanlang</p></div></div><span className="filter-status">{JSON.stringify(value) === JSON.stringify(draft) ? 'Faol' : 'O‘zgartirilgan'}</span></div>
      <div className="filter-grid">
        <label><span>Tashuv boshlangan davlat</span><div className="input-wrap"><Search size={16} /><select value={draft.origin} onChange={(e) => changeOrigin(e.target.value)}><option value="">Barcha yo'nalishlar</option>{countries.map((c) => <option key={`${c.numeric}-${c.alpha2}`} value={c.alpha2} disabled={!originCodes.has(c.alpha2)}>{c.flag} {c.name} · {c.alpha3}{!originCodes.has(c.alpha2) ? " · yo'lak sozlanmagan" : ''}</option>)}</select></div></label>
        <label><span>Tashuv tugallangan davlat</span><div className="input-wrap"><Search size={16} /><select value={draft.destination} onChange={(e) => changeDestination(e.target.value)}><option value="">Barcha mos davlatlar</option>{countries.map((c) => <option key={`${c.numeric}-${c.alpha2}`} value={c.alpha2} disabled={!destinationCodes.has(c.alpha2)}>{c.flag} {c.name} · {c.alpha3}{!destinationCodes.has(c.alpha2) ? " · bu yo'nalishda yo'lak yo'q" : ''}</option>)}</select></div></label>
        <label><span>Boshlanish sanasi</span><div className="input-wrap"><CalendarDays size={16} /><input type="date" value={draft.date_from} max={draft.date_to} onChange={(e) => update('date_from', e.target.value)} /></div></label>
        <label><span>Tugash sanasi</span><div className="input-wrap"><CalendarDays size={16} /><input type="date" value={draft.date_to} min={draft.date_from} max={new Date().toISOString().slice(0, 10)} onChange={(e) => update('date_to', e.target.value)} /></div></label>
        <details className="advanced-filters"><summary>Qo'shimcha filtrlar</summary><div className="advanced-grid">
          <label><span>Kirish posti</span><select value={draft.entry} onChange={(e) => update('entry', e.target.value)}><option value="">Barchasi</option>{posts.map((p) => <option key={p.id} value={p.post_code}>{p.post_code} · {p.post_name}</option>)}</select></label>
          <label><span>Chiqish posti</span><select value={draft.exit} onChange={(e) => update('exit', e.target.value)}><option value="">Barchasi</option>{posts.map((p) => <option key={p.id} value={p.post_code}>{p.post_code} · {p.post_name}</option>)}</select></label>
          <label><span>Korridor</span><select value={draft.corridor} onChange={(e) => update('corridor', e.target.value)}><option value="">Barchasi</option>{visibleCorridors.map((c) => <option key={c.id} value={c.code}>{c.name}</option>)}</select></label>
        </div></details>
      </div>
      <div className="filter-actions"><button className="btn ghost" onClick={clear}><RotateCcw size={16} /> Tozalash</button><button className="btn primary" onClick={apply}>Qo'llash <span>→</span></button></div>
    </section>
  )
}
