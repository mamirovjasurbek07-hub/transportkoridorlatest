import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Bookmark, Download, LogIn, Radio, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError, API_BASE } from '../api'
import FilterPanel from '../features/filters/FilterPanel'
import { CorridorDrawer, CorridorPicker, KpiGrid, PostRankingPanel, type RankingPostType, StatsPanel } from '../features/analytics/AnalyticsPanels'
import TransitMap from '../features/map/TransitMap'
import type { AnalyticsData, Corridor, Country, CustomsPost, Filters } from '../types'
import { initialDateRange } from '../filters'

function defaultFilters(params: URLSearchParams): Filters {
  const reportPeriod = initialDateRange()
  return { date_from: params.get('date_from') || reportPeriod.date_from, date_to: params.get('date_to') || reportPeriod.date_to, origin: params.get('origin') || '', destination: params.get('destination') || '', entry: params.get('entry') || '', exit: params.get('exit') || '', corridor: params.get('corridor') || '' }
}

export default function PublicMapPage() {
  const [params, setParams] = useSearchParams()
  const initial = useMemo(() => defaultFilters(params), [])
  const [filters, setFilters] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const [statsCollapsed, setStatsCollapsed] = useState(false)
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const [mapMode, setMapMode] = useState<'posts' | 'top5' | 'group' | 'single'>(initial.corridor ? 'single' : initial.origin ? 'group' : 'posts')
  const [rankingPostType, setRankingPostType] = useState<RankingPostType>('ALL')
  const [globalSearch, setGlobalSearch] = useState('')
  const deferredSearch = useDeferredValue(globalSearch)
  const [focusPost, setFocusPost] = useState<{ latitude: number; longitude: number } | null>(null)
  const [presets, setPresets] = useState<Array<{ name: string; filters: Filters }>>(() => { try { return JSON.parse(localStorage.getItem('transit-filter-presets') || '[]') } catch { return [] } })
  const explicitPeriod = useRef(params.has('date_from') || params.has('date_to'))
  const periodApplied = useRef(false)
  const reportPeriod = useQuery({ queryKey: ['report-period'], queryFn: () => api<{ date_from?: string; date_to?: string }>('/meta/report-period'), staleTime: 5 * 60_000 })
  const globalResults = useQuery({ queryKey: ['global-search', deferredSearch], queryFn: () => api<{ posts: Array<{ id: string; code: string; name: string; latitude?: number; longitude?: number }>; corridors: Array<{ id: string; code: string; name: string }> }>(`/search?q=${encodeURIComponent(deferredSearch)}`), enabled: deferredSearch.trim().length >= 2, staleTime: 60_000 })
  const catalog = useQuery({ queryKey: ['public-catalog'], queryFn: () => api<{ countries: Country[]; posts: CustomsPost[]; corridors: Corridor[] }>('/public/catalog'), staleTime: 5 * 60_000 })
  const countries = { ...catalog, data: catalog.data?.countries }
  const posts = { ...catalog, data: catalog.data ? { items: catalog.data.posts } : undefined }
  const corridors = { ...catalog, data: catalog.data ? { items: catalog.data.corridors } : undefined }
  const query = useQuery({ queryKey: ['analytics', filters, mapMode], queryFn: ({ signal }) => { const search = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)); search.set('map_mode', mapMode === 'top5' ? 'top5' : mapMode === 'posts' ? 'posts' : 'all'); return api<AnalyticsData>(`/analytics?${search}`, {}, signal) }, staleTime: 30_000, refetchOnWindowFocus: false })
  const failedQuery = [query, catalog].find((item) => item.isError)
  const pageError = failedQuery?.error
  const databaseUnavailable = pageError instanceof ApiError && pageError.code === 'DATABASE_UNAVAILABLE'
  const systemState = pageError ? 'Tizimda uzilish' : query.isFetching ? 'Yangilanmoqda' : 'Tizim faol'
  const errorMessage = databaseUnavailable
    ? "Ma'lumotlar bazasi vaqtincha mavjud emas. Administrator DATABASE_URL va Supabase loyiha holatini tekshirishi kerak."
    : pageError instanceof ApiError ? pageError.message : "Ma'lumotlarni yuklab bo'lmadi. Backend manzili va tarmoqni tekshiring."
  const refreshAll = () => { void Promise.all([catalog.refetch(), query.refetch()]) }
  const visiblePosts = useMemo(() => {
    const collection = query.data?.posts
    if (!collection || rankingPostType === 'ALL') return collection
    return { ...collection, features: collection.features.filter((feature) => feature.properties.post_type === rankingPostType) }
  }, [query.data?.posts, rankingPostType])
  const selectCorridor = useCallback((value: Record<string, unknown> | null) => setSelected(value), [])
  useEffect(() => {
    if (periodApplied.current || explicitPeriod.current || !reportPeriod.data?.date_to) return
    periodApplied.current = true
    const dateTo = reportPeriod.data.date_to
    const yearStart = `${dateTo.slice(0, 4)}-01-01`
    const dateFrom = reportPeriod.data.date_from && reportPeriod.data.date_from > yearStart ? reportPeriod.data.date_from : yearStart
    const next = { ...filters, date_from: dateFrom, date_to: dateTo }
    setFilters(next); setDraft(next)
  }, [filters, reportPeriod.data])
  useEffect(() => {
    if (mapMode !== 'single') return
    const properties = query.data?.corridors.features[0]?.properties
    if (properties) setSelected(properties)
  }, [mapMode, query.data?.corridors])
  const apply = () => { setSelected(null); setMapMode(draft.corridor ? 'single' : draft.origin ? 'group' : 'posts'); setFilters(draft); setParams(Object.fromEntries(Object.entries(draft).filter(([, v]) => v))) }
  const clear = () => { const next = defaultFilters(new URLSearchParams()); setSelected(null); setMapMode('posts'); setDraft(next); setFilters(next); setParams({}) }
  const changeMapMode = (mode: 'posts' | 'top5') => { const next = { ...filters, corridor: '' }; setSelected(null); setMapMode(mode); setFilters(next); setDraft({ ...draft, corridor: '' }); setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value))) }
  const showGroup = () => { if (!filters.origin) return; const next = { ...filters, corridor: '' }; setSelected(null); setMapMode('group'); setFilters(next); setDraft({ ...draft, corridor: '' }); setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value))) }
  const showCorridor = (code: string) => { const next = { ...filters, corridor: code }; setSelected(null); setMapMode('single'); setFilters(next); setDraft({ ...draft, corridor: code }); setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value))) }
  const savePreset = () => { const name = window.prompt('Filter nomi'); if (!name?.trim()) return; const next = [...presets.filter((item) => item.name !== name.trim()), { name: name.trim(), filters }]; setPresets(next); localStorage.setItem('transit-filter-presets', JSON.stringify(next)) }
  const applyPreset = (item: { filters: Filters }) => { setDraft(item.filters); setFilters(item.filters); setMapMode(item.filters.corridor ? 'single' : item.filters.origin ? 'group' : 'posts'); setParams(Object.fromEntries(Object.entries(item.filters).filter(([, value]) => value))) }
  return (
    <div className="public-page">
      <header className="public-header"><div className="public-brand"><span className="brand-mark"><ShieldCheck /></span><div><strong>Tranzit transport yo'laklari</strong><small>O'ZBEKISTON RESPUBLIKASI · GEOANALITIK TIZIM</small></div></div><div className="header-meta"><span className={pageError ? 'system-state error' : 'system-state'}><Radio size={14}/><i/> {systemState}</span><div><small>OXIRGI YANGILANISH</small><strong>{query.data ? format(new Date(query.data.meta.refreshed_at), 'dd.MM.yyyy · HH:mm') : '—'}</strong></div><button className="icon-button" onClick={refreshAll} title="Yangilash"><RefreshCw size={18}/></button><Link className="admin-login-link" to="/admin"><LogIn size={18}/> Admin</Link></div></header>
      <main className="public-content">
        <section className="public-quick-tools"><div className="public-search"><Search/><input placeholder="Post yoki korridorni qidiring" value={globalSearch} onChange={(e) => setGlobalSearch(e.target.value)}/>{globalResults.data && globalSearch && <div className="public-search-results">{globalResults.data.corridors.map((item) => <button key={item.id} onClick={() => { showCorridor(item.code); setGlobalSearch('') }}><strong>{item.code}</strong> {item.name}</button>)}{globalResults.data.posts.map((item) => <button key={item.id} onClick={() => { if (item.latitude != null && item.longitude != null) setFocusPost({ latitude: item.latitude, longitude: item.longitude }); setMapMode('posts'); setGlobalSearch('') }}><strong>{item.code}</strong> {item.name}</button>)}</div>}</div><button className="btn ghost compact" onClick={savePreset}><Bookmark/> Filterni saqlash</button>{presets.length > 0 && <select defaultValue="" onChange={(e) => { const item = presets.find((preset) => preset.name === e.target.value); if (item) applyPreset(item) }}><option value="">Saqlangan filterlar</option>{presets.map((item) => <option key={item.name}>{item.name}</option>)}</select>}</section>
        <FilterPanel value={filters} draft={draft} setDraft={setDraft} apply={apply} clear={clear} countries={countries.data || []} posts={posts.data?.items || []} corridors={corridors.data?.items || []}/>
        <KpiGrid data={query.data}/>
        <section className="map-section"><div className="map-section-title"><div><p className="eyebrow">TRANZIT OQIMLARI XARITASI</p><h2>Yo'nalishlar real avtomobil yo'llari bo'ylab</h2></div><a className="btn ghost compact" href={`${API_BASE}/analytics/export.csv?date_from=${filters.date_from}&date_to=${filters.date_to}`}><Download size={15}/> CSV</a></div><CorridorPicker corridors={query.data?.corridors} topPairs={query.data?.top_pairs || []} available={corridors.data?.items || []} mode={mapMode} origin={filters.origin} destination={filters.destination} selectedCode={filters.corridor} selectedId={String(selected?.id || '')} showPosts={() => changeMapMode('posts')} showTop5={() => changeMapMode('top5')} showGroup={showGroup} showCorridor={showCorridor} select={selectCorridor}/>{mapMode === 'posts' && <PostRankingPanel posts={query.data?.posts} selectedType={rankingPostType} onTypeChange={setRankingPostType}/>}<div className="map-layout"><TransitMap posts={visiblePosts} corridors={query.data?.corridors} loading={query.isFetching} selectedId={String(selected?.id || '')} onCorridorSelect={selectCorridor} focusPost={focusPost}/><StatsPanel data={query.data} collapsed={statsCollapsed} toggle={() => setStatsCollapsed((v) => !v)}/></div>{pageError && <div className="inline-error">{errorMessage}</div>}{mapMode !== 'posts' && !query.isLoading && !query.data?.corridors.features.length && <div className="no-data">Tanlangan guruhda hali tasdiqlangan avtomobil yo‘li yo‘q. Admin panelda route holatini tekshiring.</div>}</section>
      </main>
      <CorridorDrawer corridor={selected} close={() => setSelected(null)}/>
      <footer className="public-footer"><span>© {new Date().getFullYear()} Tranzit geoanalitika</span><span>Xarita: Yandex Maps · chegara: geoBoundaries/OpenStreetMap · fallback: OpenStreetMap</span></footer>
    </div>
  )
}
