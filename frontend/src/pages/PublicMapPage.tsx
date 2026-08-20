import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Download, LogIn, Radio, RefreshCw, ShieldCheck } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, API_BASE } from '../api'
import FilterPanel from '../features/filters/FilterPanel'
import { CorridorDrawer, CorridorPicker, KpiGrid, PostRankingPanel, type RankingPostType, StatsPanel } from '../features/analytics/AnalyticsPanels'
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
  const [mapMode, setMapMode] = useState<'posts' | 'top5' | 'group' | 'single'>(initial.corridor ? 'single' : initial.origin ? 'group' : 'posts')
  const [rankingPostType, setRankingPostType] = useState<RankingPostType>('ALL')
  const countries = useQuery({ queryKey: ['countries'], queryFn: () => api<Country[]>('/countries'), staleTime: 30 * 60_000 })
  const posts = useQuery({ queryKey: ['posts-public'], queryFn: () => api<{ items: CustomsPost[] }>('/posts?page_size=500'), staleTime: 60_000 })
  const corridors = useQuery({ queryKey: ['corridors-public'], queryFn: () => api<{ items: Corridor[] }>('/corridors?include_geometry=false'), staleTime: 60_000 })
  const query = useQuery({ queryKey: ['analytics', filters, mapMode], queryFn: ({ signal }) => { const search = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)); search.set('map_mode', mapMode === 'top5' ? 'top5' : mapMode === 'posts' ? 'posts' : 'all'); return api<AnalyticsData>(`/analytics?${search}`, {}, signal) }, staleTime: 30_000, refetchOnWindowFocus: false })
  const visiblePosts = useMemo(() => {
    const collection = query.data?.posts
    if (!collection || rankingPostType === 'ALL') return collection
    return { ...collection, features: collection.features.filter((feature) => feature.properties.post_type === rankingPostType) }
  }, [query.data?.posts, rankingPostType])
  const selectCorridor = useCallback((value: Record<string, unknown> | null) => setSelected(value), [])
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
  return (
    <div className="public-page">
      <header className="public-header"><div className="public-brand"><span className="brand-mark"><ShieldCheck /></span><div><strong>Tranzit transport yo'laklari</strong><small>O'ZBEKISTON RESPUBLIKASI · GEOANALITIK TIZIM</small></div></div><div className="header-meta"><span><Radio size={14}/><i/> Tizim faol</span><div><small>OXIRGI YANGILANISH</small><strong>{query.data ? format(new Date(query.data.meta.refreshed_at), 'dd.MM.yyyy · HH:mm') : '—'}</strong></div><button className="icon-button" onClick={() => query.refetch()} title="Yangilash"><RefreshCw size={18}/></button><Link className="admin-login-link" to="/admin"><LogIn size={18}/> Admin</Link></div></header>
      <main className="public-content">
        <FilterPanel value={filters} draft={draft} setDraft={setDraft} apply={apply} clear={clear} countries={countries.data || []} posts={posts.data?.items || []} corridors={corridors.data?.items || []}/>
        <KpiGrid data={query.data}/>
        <section className="map-section"><div className="map-section-title"><div><p className="eyebrow">TRANZIT OQIMLARI XARITASI</p><h2>Yo'nalishlar real avtomobil yo'llari bo'ylab</h2></div><a className="btn ghost compact" href={`${API_BASE}/analytics/export.csv?date_from=${filters.date_from}&date_to=${filters.date_to}`}><Download size={15}/> CSV</a></div><CorridorPicker corridors={query.data?.corridors} topPairs={query.data?.top_pairs || []} available={corridors.data?.items || []} mode={mapMode} origin={filters.origin} destination={filters.destination} selectedCode={filters.corridor} selectedId={String(selected?.id || '')} showPosts={() => changeMapMode('posts')} showTop5={() => changeMapMode('top5')} showGroup={showGroup} showCorridor={showCorridor} select={selectCorridor}/>{mapMode === 'posts' && <PostRankingPanel posts={query.data?.posts} selectedType={rankingPostType} onTypeChange={setRankingPostType}/>}<div className="map-layout"><TransitMap posts={visiblePosts} corridors={query.data?.corridors} loading={query.isFetching} selectedId={String(selected?.id || '')} onCorridorSelect={selectCorridor}/><StatsPanel data={query.data} collapsed={statsCollapsed} toggle={() => setStatsCollapsed((v) => !v)}/></div>{query.isError && <div className="inline-error">Ma'lumotlarni yuklab bo'lmadi. Backend manzili va tarmoqni tekshiring.</div>}{mapMode !== 'posts' && !query.isLoading && !query.data?.corridors.features.length && <div className="no-data">Tanlangan guruhda hali tasdiqlangan avtomobil yo‘li yo‘q. Admin panelda route holatini tekshiring.</div>}</section>
      </main>
      <CorridorDrawer corridor={selected} close={() => setSelected(null)}/>
      <footer className="public-footer"><span>© {new Date().getFullYear()} Tranzit geoanalitika</span><span>Xarita: Yandex Maps · chegara: geoBoundaries/OpenStreetMap · fallback: OpenStreetMap</span></footer>
    </div>
  )
}
