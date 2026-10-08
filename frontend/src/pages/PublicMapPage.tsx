import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Bookmark, Download, Layers3, LogIn, MapPinned, Radio, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError, API_BASE } from '../api'
import FilterPanel from '../features/filters/FilterPanel'
import { CorridorDrawer, CorridorPicker, KpiGrid, PostRankingPanel, type RankingPostType, StatsPanel } from '../features/analytics/AnalyticsPanels'
import TransitMap from '../features/map/TransitMap'
import type { AnalyticsData, Corridor, Country, CustomsPost, FeatureCollection, Filters } from '../types'
import { initialDateRange } from '../filters'

const EMPTY_FEATURE_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] }

function defaultFilters(params: URLSearchParams): Filters {
  const reportPeriod = initialDateRange()
  return { date_from: params.get('date_from') || reportPeriod.date_from, date_to: params.get('date_to') || reportPeriod.date_to, origin: params.get('origin') || '', destination: params.get('destination') || '', entry: params.get('entry') || '', exit: params.get('exit') || '', corridor: params.get('corridor') || '' }
}

function VisibilityMenu({ label, icon, items, selected, onChange }: { label: string; icon: ReactNode; items: Array<{ id: string; label: string; detail?: string }>; selected: string[]; onChange: (ids: string[]) => void }) {
  const selectedSet = new Set(selected)
  const toggle = (id: string) => onChange(selectedSet.has(id) ? selected.filter((item) => item !== id) : [...selected, id])
  return <details className="visibility-menu"><summary className="btn ghost compact">{icon}<span>{label}</span><b>{selected.length}</b></summary><div className="visibility-popover"><div className="visibility-actions"><strong>{label} ko‘rinishi</strong><button onClick={() => onChange(items.map((item) => item.id))}>Barchasi</button><button onClick={() => onChange([])}>Hech biri</button></div><div className="visibility-list">{items.map((item) => <label key={item.id}><input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => toggle(item.id)}/><span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span></label>)}</div>{!items.length && <p>Tanlash uchun ma’lumot yo‘q.</p>}</div></details>
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
  const [selectedCorridorIds, setSelectedCorridorIds] = useState<string[]>([])
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([])
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
  const query = useQuery({ queryKey: ['analytics', filters, mapMode, selectedCorridorIds], queryFn: ({ signal }) => { const search = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)); search.set('map_mode', selectedCorridorIds.length ? 'all' : 'posts'); if (selectedCorridorIds.length) search.set('corridor_ids', selectedCorridorIds.join(',')); return api<AnalyticsData>(`/analytics?${search}`, {}, signal) }, staleTime: 30_000, refetchOnWindowFocus: false })
  const failedQuery = [query, catalog].find((item) => item.isError)
  const pageError = failedQuery?.error
  const databaseUnavailable = pageError instanceof ApiError && pageError.code === 'DATABASE_UNAVAILABLE'
  const databaseStatus = query.data?.meta.database_status || 'connected'
  const databaseDegraded = databaseStatus !== 'connected'
  const systemState = pageError || databaseDegraded ? 'Baza vaqtincha uzilgan' : query.isFetching ? 'Yangilanmoqda' : 'Tizim faol'
  const errorMessage = databaseDegraded
    ? databaseStatus === 'stale-cache' ? "Ma'lumotlar bazasi vaqtincha mavjud emas. Oxirgi saqlangan ma'lumotlar ko'rsatilmoqda." : "Ma'lumotlar bazasi vaqtincha mavjud emas. Supabase loyihasi va DATABASE_URL tekshirilishi kerak."
    : databaseUnavailable
    ? "Ma'lumotlar bazasi vaqtincha mavjud emas. Administrator DATABASE_URL va Supabase loyiha holatini tekshirishi kerak."
    : pageError instanceof ApiError ? pageError.message : "Ma'lumotlarni yuklab bo'lmadi. Backend manzili va tarmoqni tekshiring."
  const refreshAll = () => { void Promise.all([catalog.refetch(), query.refetch()]) }
  const visiblePosts = useMemo(() => {
    const collection = query.data?.posts
    if (!collection || !selectedPostIds.length) return EMPTY_FEATURE_COLLECTION
    const selectedSet = new Set(selectedPostIds)
    return { ...collection, features: collection.features.filter((feature) => selectedSet.has(String(feature.properties.id || '')) && (rankingPostType === 'ALL' || feature.properties.post_type === rankingPostType)) }
  }, [query.data?.posts, rankingPostType, selectedPostIds])
  const visibleCorridors = useMemo(() => {
    const collection = query.data?.corridors
    if (!collection || !selectedCorridorIds.length) return EMPTY_FEATURE_COLLECTION
    const selectedSet = new Set(selectedCorridorIds)
    return { ...collection, features: collection.features.filter((feature) => selectedSet.has(String(feature.properties.id || ''))) }
  }, [query.data?.corridors, selectedCorridorIds])
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
  useEffect(() => {
    if (!filters.corridor || selectedCorridorIds.length || !catalog.data) return
    const match = catalog.data.corridors.find((item) => item.code === filters.corridor)
    if (match) setSelectedCorridorIds([match.id])
  }, [catalog.data, filters.corridor, selectedCorridorIds.length])
  const idsForGroup = (origin: string, destination: string) => (catalog.data?.corridors || []).filter((item) => (!origin || item.origin_country_code === origin) && (!destination || item.destination_country_code === destination)).map((item) => item.id)
  const apply = () => { setSelected(null); const mode = draft.corridor ? 'single' : draft.origin ? 'group' : 'posts'; setMapMode(mode); if (draft.corridor) { const item = catalog.data?.corridors.find((corridor) => corridor.code === draft.corridor); setSelectedCorridorIds(item ? [item.id] : []) } else if (draft.origin) setSelectedCorridorIds(idsForGroup(draft.origin, draft.destination)); setFilters(draft); setParams(Object.fromEntries(Object.entries(draft).filter(([, v]) => v))) }
  const clear = () => { const next = defaultFilters(new URLSearchParams()); setSelected(null); setSelectedCorridorIds([]); setSelectedPostIds([]); setMapMode('posts'); setDraft(next); setFilters(next); setParams({}) }
  const changeMapMode = (mode: 'posts' | 'top5') => { const next = { ...filters, corridor: '' }; setSelected(null); setMapMode(mode); if (mode === 'posts') setSelectedCorridorIds([]); else { const keys = new Set((query.data?.top_pairs || []).slice(0, 5).map((item) => `${item.origin}|${item.destination}|${item.entry}|${item.exit}`)); setSelectedCorridorIds((catalog.data?.corridors || []).filter((item) => keys.has(`${item.origin_country_code}|${item.destination_country_code}|${item.entry_post_code}|${item.exit_post_code}`)).map((item) => item.id)) } setFilters(next); setDraft({ ...draft, corridor: '' }); setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value))) }
  const showGroup = () => { if (!filters.origin) return; const next = { ...filters, corridor: '' }; setSelected(null); setSelectedCorridorIds(idsForGroup(filters.origin, filters.destination)); setMapMode('group'); setFilters(next); setDraft({ ...draft, corridor: '' }); setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value))) }
  const showCorridor = (code: string) => { const next = { ...filters, corridor: code }; const item = catalog.data?.corridors.find((corridor) => corridor.code === code); setSelected(null); setSelectedCorridorIds(item ? [item.id] : []); setMapMode('single'); setFilters(next); setDraft({ ...draft, corridor: code }); setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value))) }
  const changeVisibleCorridors = (ids: string[]) => { const next = { ...filters, corridor: '' }; setSelected(null); setSelectedCorridorIds(ids); setMapMode(ids.length ? 'group' : 'posts'); setFilters(next); setDraft({ ...draft, corridor: '' }); setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value))) }
  const savePreset = () => { const name = window.prompt('Filter nomi'); if (!name?.trim()) return; const next = [...presets.filter((item) => item.name !== name.trim()), { name: name.trim(), filters }]; setPresets(next); localStorage.setItem('transit-filter-presets', JSON.stringify(next)) }
  const applyPreset = (item: { filters: Filters }) => { setDraft(item.filters); setFilters(item.filters); setMapMode(item.filters.corridor ? 'single' : item.filters.origin ? 'group' : 'posts'); if (item.filters.corridor) { const corridor = catalog.data?.corridors.find((value) => value.code === item.filters.corridor); setSelectedCorridorIds(corridor ? [corridor.id] : []) } else if (item.filters.origin) setSelectedCorridorIds(idsForGroup(item.filters.origin, item.filters.destination)); setParams(Object.fromEntries(Object.entries(item.filters).filter(([, value]) => value))) }
  return (
    <div className="public-page">
      <header className="public-header"><div className="public-brand"><span className="brand-mark"><ShieldCheck /></span><div><strong>Tranzit transport yo'laklari</strong><small>O'ZBEKISTON RESPUBLIKASI · GEOANALITIK TIZIM</small></div></div><div className="header-meta"><span className={pageError || databaseDegraded ? 'system-state error' : 'system-state'}><Radio size={14}/><i/> {systemState}</span><div><small>OXIRGI YANGILANISH</small><strong>{query.data ? format(new Date(query.data.meta.refreshed_at), 'dd.MM.yyyy · HH:mm') : '—'}</strong></div><button className="icon-button" onClick={refreshAll} title="Yangilash"><RefreshCw size={18}/></button><Link className="admin-login-link" to="/admin"><LogIn size={18}/> Admin</Link></div></header>
      <main className="public-content">
        <section className="public-quick-tools"><div className="public-search"><Search/><input placeholder="Post yoki korridorni qidiring" value={globalSearch} onChange={(e) => setGlobalSearch(e.target.value)}/>{globalResults.data && globalSearch && <div className="public-search-results">{globalResults.data.corridors.map((item) => <button key={item.id} onClick={() => { showCorridor(item.code); setGlobalSearch('') }}><strong>{item.code}</strong> {item.name}</button>)}{globalResults.data.posts.map((item) => <button key={item.id} onClick={() => { if (item.latitude != null && item.longitude != null) setFocusPost({ latitude: item.latitude, longitude: item.longitude }); setSelectedPostIds((current) => current.includes(item.id) ? current : [...current, item.id]); setMapMode('posts'); setGlobalSearch('') }}><strong>{item.code}</strong> {item.name}</button>)}</div>}</div><VisibilityMenu label="Yo‘laklar" icon={<Layers3/>} items={(corridors.data?.items || []).map((item) => ({ id: item.id, label: item.name, detail: `${item.origin_country_code || '—'} → ${item.destination_country_code || '—'} · ${item.code}` }))} selected={selectedCorridorIds} onChange={changeVisibleCorridors}/><VisibilityMenu label="Postlar" icon={<MapPinned/>} items={(posts.data?.items || []).filter((item) => item.latitude != null && item.longitude != null).map((item) => ({ id: item.id, label: item.post_name, detail: `${item.post_code} · ${item.post_type}` }))} selected={selectedPostIds} onChange={setSelectedPostIds}/><button className="btn ghost compact" onClick={savePreset}><Bookmark/> Filterni saqlash</button>{presets.length > 0 && <select defaultValue="" onChange={(e) => { const item = presets.find((preset) => preset.name === e.target.value); if (item) applyPreset(item) }}><option value="">Saqlangan filterlar</option>{presets.map((item) => <option key={item.name}>{item.name}</option>)}</select>}</section>
        <FilterPanel value={filters} draft={draft} setDraft={setDraft} apply={apply} clear={clear} countries={countries.data || []} posts={posts.data?.items || []} corridors={corridors.data?.items || []}/>
        <KpiGrid data={query.data}/>
        <section className="map-section"><div className="map-section-title"><div><p className="eyebrow">TRANZIT OQIMLARI XARITASI</p><h2>Tanlangan avtomobil va dengiz yo‘llari</h2></div><a className="btn ghost compact" href={`${API_BASE}/analytics/export.csv?date_from=${filters.date_from}&date_to=${filters.date_to}`}><Download size={15}/> CSV</a></div><CorridorPicker corridors={visibleCorridors} topPairs={query.data?.top_pairs || []} available={corridors.data?.items || []} mode={mapMode} origin={filters.origin} destination={filters.destination} selectedCode={filters.corridor} selectedId={String(selected?.id || '')} showPosts={() => changeMapMode('posts')} showTop5={() => changeMapMode('top5')} showGroup={showGroup} showCorridor={showCorridor} select={selectCorridor}/>{mapMode === 'posts' && <PostRankingPanel posts={visiblePosts} selectedType={rankingPostType} onTypeChange={setRankingPostType}/>}<div className="map-layout"><TransitMap posts={visiblePosts} corridors={visibleCorridors} loading={query.isFetching} selectedId={String(selected?.id || '')} onCorridorSelect={selectCorridor} focusPost={focusPost}/><StatsPanel data={query.data} collapsed={statsCollapsed} toggle={() => setStatsCollapsed((v) => !v)}/></div>{(pageError || databaseDegraded) && <div className="inline-error">{errorMessage}</div>}{!query.isLoading && selectedCorridorIds.length > 0 && !visibleCorridors?.features.length && <div className="no-data">Tanlangan yo‘laklarda tayyor geometriya yo‘q. Admin panelda route holatini tekshiring.</div>}</section>
      </main>
      <CorridorDrawer corridor={selected} close={() => setSelected(null)}/>
      <footer className="public-footer"><span>© {new Date().getFullYear()} Tranzit geoanalitika</span><span>Xarita: Yandex Maps · chegara: geoBoundaries/OpenStreetMap · fallback: OpenStreetMap</span></footer>
    </div>
  )
}
