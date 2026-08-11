import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Download, LogIn, Radio, RefreshCw, ShieldCheck } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, API_BASE } from '../api'
import FilterPanel from '../features/filters/FilterPanel'
import { CorridorDrawer, KpiGrid, StatsPanel } from '../features/analytics/AnalyticsPanels'
import TransitMap from '../features/map/TransitMap'
import type { AnalyticsData, Corridor, Country, CustomsPost, Filters } from '../types'

function defaultFilters(params: URLSearchParams): Filters {
  const today = format(new Date(), 'yyyy-MM-dd')
  const january = `${new Date().getFullYear()}-01-01`
  return { date_from: params.get('date_from') || january, date_to: params.get('date_to') || today, origin: params.get('origin') || '', destination: params.get('destination') || '', entry: params.get('entry') || '', exit: params.get('exit') || '', corridor: params.get('corridor') || '' }
}

export default function PublicMapPage() {
  const [params, setParams] = useSearchParams()
  const initial = useMemo(() => defaultFilters(params), [])
  const [filters, setFilters] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const [statsCollapsed, setStatsCollapsed] = useState(false)
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const countries = useQuery({ queryKey: ['countries'], queryFn: () => api<Country[]>('/countries') })
  const posts = useQuery({ queryKey: ['posts-public'], queryFn: () => api<{ items: CustomsPost[] }>('/posts?page_size=500') })
  const corridors = useQuery({ queryKey: ['corridors-public'], queryFn: () => api<{ items: Corridor[] }>('/corridors') })
  const query = useQuery({ queryKey: ['analytics', filters], queryFn: ({ signal }) => { const search = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)); return api<AnalyticsData>(`/analytics?${search}`, {}, signal) } })
  const selectCorridor = useCallback((value: Record<string, unknown> | null) => setSelected(value), [])
  const apply = () => { setFilters(draft); setParams(Object.fromEntries(Object.entries(draft).filter(([, v]) => v))) }
  const clear = () => { const next = defaultFilters(new URLSearchParams()); setDraft(next); setFilters(next); setParams({}) }
  return (
    <div className="public-page">
      <header className="public-header"><div className="public-brand"><span className="brand-mark"><ShieldCheck /></span><div><strong>Tranzit transport yo'laklari</strong><small>O'ZBEKISTON RESPUBLIKASI · GEOANALITIK TIZIM</small></div></div><div className="header-meta"><span><Radio size={14}/><i/> Tizim faol</span><div><small>OXIRGI YANGILANISH</small><strong>{query.data ? format(new Date(query.data.meta.refreshed_at), 'dd.MM.yyyy · HH:mm') : '—'}</strong></div><button className="icon-button" onClick={() => query.refetch()} title="Yangilash"><RefreshCw size={18}/></button><Link className="admin-login-link" to="/admin/login"><LogIn size={18}/> Admin</Link></div></header>
      <main className="public-content">
        <FilterPanel value={filters} draft={draft} setDraft={setDraft} apply={apply} clear={clear} countries={countries.data || []} posts={posts.data?.items || []} corridors={corridors.data?.items || []}/>
        <KpiGrid data={query.data}/>
        <section className="map-section"><div className="map-section-title"><div><p className="eyebrow">TRANZIT OQIMLARI XARITASI</p><h2>Yo'nalishlar real avtomobil yo'llari bo'ylab</h2></div><a className="btn ghost compact" href={`${API_BASE}/analytics/export.csv?date_from=${filters.date_from}&date_to=${filters.date_to}`}><Download size={15}/> CSV</a></div><div className="map-layout"><TransitMap posts={query.data?.posts} corridors={query.data?.corridors} loading={query.isFetching} selectedId={String(selected?.id || '')} onCorridorSelect={selectCorridor}/><StatsPanel data={query.data} collapsed={statsCollapsed} toggle={() => setStatsCollapsed((v) => !v)}/></div>{query.isError && <div className="inline-error">Ma'lumotlarni yuklab bo'lmadi. Backend manzili va tarmoqni tekshiring.</div>}{!query.isLoading && !query.data?.corridors.features.length && <div className="no-data">Tanlangan filtrlar bo'yicha xaritada ko'rsatiladigan tasdiqlangan route yo'q.</div>}</section>
      </main>
      <CorridorDrawer corridor={selected} close={() => setSelected(null)}/>
      <footer className="public-footer"><span>© {new Date().getFullYear()} Tranzit geoanalitika</span><span>Map data © OpenStreetMap contributors</span></footer>
    </div>
  )
}
