import { ArrowDownRight, ArrowUpRight, ChevronRight, Clock3, MapPinned, Route, ScanLine, TriangleAlert, Trophy, Waypoints, X } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AnalyticsData, Corridor, FeatureCollection } from '../../types'

export type RankingPostType = 'ALL' | 'CHBP' | 'AERO' | 'TIF' | 'RW' | 'PORT'

const POST_TYPE_LABELS: Record<RankingPostType, string> = {
  ALL: 'Barcha post turlari', CHBP: 'Avtomobil chegara postlari', AERO: 'Aeroport postlari', TIF: 'TIF postlari', RW: 'Temir yo‘l postlari', PORT: 'Daryo portlari',
}

function formatNumber(value: number): string {
  return Math.round(Number(value || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export function PostRankingPanel({ posts, selectedType, onTypeChange }: { posts?: FeatureCollection; selectedType: RankingPostType; onTypeChange: (value: RankingPostType) => void }) {
  const features = (posts?.features || []).filter((feature) => selectedType === 'ALL' || feature.properties.post_type === selectedType)
  const ranking = [...features].sort((a, b) => Number(a.properties.ranking_position || 999) - Number(b.properties.ranking_position || 999)).slice(0, 5)
  return <section className="post-ranking-panel"><div className="post-ranking-heading"><span><Trophy/><strong>Postlar reytingi</strong><small>Post turi va toifasi bo‘yicha 100 ballik tizim</small></span><select value={selectedType} onChange={(event) => onTypeChange(event.target.value as RankingPostType)}>{(Object.keys(POST_TYPE_LABELS) as RankingPostType[]).map((value) => <option value={value} key={value}>{POST_TYPE_LABELS[value]}</option>)}</select></div><div className="post-ranking-list">{ranking.map((feature, index) => { const p = feature.properties; const score = Math.round(Number(p.ranking_score || 0)); return <div key={String(p.id)}><b>{index + 1}</b><span><strong>{String(p.post_code)} · {String(p.post_name)}</strong><small>{String(p.post_type)} · tur bo‘yicha #{String(p.ranking_position || index + 1)}</small></span><em><strong>{score}</strong><small>/100 ball</small></em></div> })}{!ranking.length && <span className="muted">Tanlangan tur bo‘yicha ma’lumot yo‘q.</span>}</div></section>
}


export function KpiGrid({ data }: { data?: AnalyticsData }) {
  const k = data?.kpis
  const items = [
    { label: 'Jami deklaratsiyalar', value: k ? formatNumber(k.total_declarations) : '—', icon: ScanLine, note: `${Math.abs(k?.change_percent || 0)}%`, positive: (k?.change_percent || 0) >= 0 },
    { label: 'Faol korridorlar', value: k?.active_corridors ?? '—', icon: Route, note: 'tasdiqlangan route' },
    { label: 'Kirish postlari', value: k?.entry_posts ?? '—', icon: MapPinned, note: 'oqim mavjud' },
    { label: 'Chiqish postlari', value: k?.exit_posts ?? '—', icon: Waypoints, note: 'oqim mavjud' },
    { label: "O'rtacha tranzit", value: k ? `${Math.round(k.avg_transit_minutes / 60)} soat` : '—', icon: Clock3, note: 'entry → exit' },
  ]
  return <div className="kpi-grid">{items.map(({ label, value, icon: Icon, note, positive }, index) => <article className={`kpi-card ${index === 0 ? 'featured' : ''}`} key={label}><div className="kpi-icon"><Icon /></div><div><p>{label}</p><strong>{value}</strong><small>{index === 0 && (positive ? <ArrowUpRight /> : <ArrowDownRight />)} {note}</small></div></article>)}</div>
}


export function StatsPanel({ data, collapsed, toggle }: { data?: AnalyticsData; collapsed: boolean; toggle: () => void }) {
  if (collapsed) return <button className="stats-expand" onClick={toggle} aria-label="Statistika panelini ochish"><ChevronRight /></button>
  return (
    <aside className="stats-panel panel">
      <div className="panel-heading"><div><div><h2>Oqim statistikasi</h2><p>Tanlangan davr bo'yicha</p></div></div><button className="icon-button" onClick={toggle} aria-label="Panelni yopish">×</button></div>
      <section className="chart-block"><div className="section-title"><span>KUNLIK DINAMIKA</span><b>{formatNumber(data?.kpis.total_declarations || 0)}</b></div><div className="trend-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data?.trend || []}><defs><linearGradient id="trend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity={0.5}/><stop offset="100%" stopColor="#22d3ee" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="date" hide/><YAxis hide/><Tooltip contentStyle={{ background: '#0d1d2e', border: '1px solid #24405a', borderRadius: 10 }} labelStyle={{ color: '#8ca6bd' }}/><Area type="monotone" dataKey="count" stroke="#22d3ee" strokeWidth={2} fill="url(#trend)"/></AreaChart></ResponsiveContainer></div></section>
      <section><div className="section-title"><span>TOP YO'NALISHLAR</span><small>DEKLARATSIYA</small></div><div className="ranking-list">{data?.top_pairs.map((row, i) => <div key={`${row.origin}-${row.destination}-${row.entry}-${row.exit}`}><b>{String(i + 1).padStart(2, '0')}</b><span><strong>{row.origin} → {row.destination} · {row.entry} → {row.exit}</strong><i><em style={{ width: `${(row.count / (data.top_pairs[0]?.count || 1)) * 100}%` }} /></i></span><strong>{formatNumber(row.count)}</strong></div>)}</div></section>
      <section><div className="section-title"><span>DAVLATLAR ULUSHI</span><small>%</small></div><div className="country-share">{data?.country_share.slice(0, 5).map((row) => <div key={row.country}><span>{row.country}</span><i><em style={{ width: `${row.share}%` }}/></i><b>{row.share}%</b></div>)}</div></section>
      {!!data?.unavailable_routes.length && <div className="route-warning"><TriangleAlert/><span><strong>{data.unavailable_routes.length} ta route chizilmadi</strong><small>Admin tekshiruvi talab qilinadi</small></span></div>}
    </aside>
  )
}


export function CorridorPicker({ corridors, topPairs, available, mode, origin, destination, selectedCode, selectedId, showPosts, showTop5, showGroup, showCorridor, select }: { corridors?: FeatureCollection; topPairs: AnalyticsData['top_pairs']; available: Corridor[]; mode: 'posts' | 'top5' | 'group' | 'single'; origin: string; destination: string; selectedCode: string; selectedId?: string; showPosts: () => void; showTop5: () => void; showGroup: () => void; showCorridor: (code: string) => void; select: (corridor: Record<string, unknown>) => void }) {
  const features = corridors?.features || []
  const groupCorridors = available.filter((corridor) => (!origin || corridor.origin_country_code === origin) && (!destination || corridor.destination_country_code === destination))
  const groups = Object.entries(groupCorridors.reduce<Record<string, Corridor[]>>((result, corridor) => { const key = `${corridor.origin_country_code || '—'} → ${corridor.destination_country_code || '—'}`; (result[key] ||= []).push(corridor); return result }, {}))
  const description = mode === 'posts' ? 'Hozir faqat bojxona postlari ko‘rsatilmoqda' : mode === 'top5' ? 'Tashuv hajmi bo‘yicha eng katta 5 ta post yo‘nalishi' : mode === 'single' ? 'Guruh ichidan bitta corridor ajratib ko‘rsatilmoqda' : `${groups.length} ta yo‘nalish guruhi · ${groupCorridors.length} ta corridor`
  return <section className="corridor-picker" aria-label="Ko'rsatilayotgan yo'laklarni tanlash"><div className="corridor-picker-title"><span><Route size={18}/><strong>Xaritada nimani ko‘rsatamiz?</strong><small>{description}</small></span><em>{features.length ? `${features.length} ta yo‘lak` : 'Corridor yashirilgan'}</em></div><div className="map-view-controls"><button className={mode === 'posts' ? 'active' : ''} onClick={showPosts}>Faqat postlar</button><button className={mode === 'top5' ? 'active' : ''} onClick={showTop5}>Top-5 yo‘lak</button><button disabled={!origin} className={mode === 'group' || mode === 'single' ? 'active' : ''} onClick={showGroup}>{origin ? `${origin} → ${destination || 'barcha mos davlatlar'} guruhi` : 'Davlatlarni yuqoridan tanlang'}</button></div>{mode === 'top5' && topPairs.length > 0 && <div className="corridor-picker-list top-five">{topPairs.map((pair, index) => { const feature = features.find((item) => item.properties.entry_post_code === pair.entry && item.properties.exit_post_code === pair.exit && item.properties.origin_country_code === pair.origin && item.properties.destination_country_code === pair.destination); const p = feature?.properties; const active = p ? String(p.id) === selectedId : false; return <button key={`${pair.origin}-${pair.destination}-${pair.entry}-${pair.exit}`} disabled={!p} className={active ? 'active' : ''} style={{ borderLeftColor: String(p?.color || '#536978') }} onClick={() => p && select(p)}><b>{index + 1}</b><span><strong>{String(p?.entry_post_name || pair.entry)} → {String(p?.exit_post_name || pair.exit)}</strong><small>{pair.origin} → {pair.destination} · {p ? 'xaritada mavjud' : 'yo‘l geometriyasi tekshirilmoqda'}</small></span><em>{formatNumber(pair.count)}</em></button> })}</div>}{(mode === 'group' || mode === 'single') && groups.length > 0 && <div className="route-groups">{groups.map(([label, items]) => <div className="route-group" key={label}><div><strong>{label}</strong><span>{items.length} ta corridor</span></div><div>{items.map((corridor) => { const feature = features.find((item) => item.properties.code === corridor.code); return <button key={corridor.id} disabled={!feature} className={selectedCode === corridor.code ? 'active' : ''} onClick={() => feature && showCorridor(corridor.code)}><i style={{ background: corridor.color || '#22d3ee' }}/><span><strong>{corridor.name}</strong><small>{corridor.entry_post_code} → {corridor.exit_post_code}</small></span><em>{feature ? 'Ko‘rish' : 'Route kutilmoqda'}</em></button> })}</div></div>)}</div>}</section>
}


export function CorridorDrawer({ corridor, close }: { corridor: Record<string, unknown> | null; close: () => void }) {
  if (!corridor) return null
  const permission = (prefix: 'entry' | 'exit') => [corridor[`${prefix}_allow_passenger`] ? 'yengil' : '', corridor[`${prefix}_allow_cargo`] ? 'yuk' : ''].filter(Boolean).join(' + ') || 'ruxsat belgilanmagan'
  return <div className="corridor-drawer" role="dialog" aria-label="Korridor tafsilotlari" style={{ borderTopColor: String(corridor.color || '#22d3ee') }}><button className="drawer-close" onClick={close}><X /></button><p className="eyebrow">TANLANGAN KORRIDOR · {String(corridor.origin_country_code)} → {String(corridor.destination_country_code)}</p><h2>{String(corridor.name || '')}</h2><span className="route-code">{String(corridor.code || '')}</span><div className="drawer-route"><MapPinned/><span><small>KIRISH · {String(corridor.entry_post_code)}</small><strong>{String(corridor.entry_post_name || corridor.entry_post_code)}</strong><small>Ruxsat: {permission('entry')}</small></span><i/><span><small>CHIQISH · {String(corridor.exit_post_code)}</small><strong>{String(corridor.exit_post_name || corridor.exit_post_code)}</strong><small>Ruxsat: {permission('exit')}</small></span><Route/></div><div className="drawer-metrics"><div><strong>{formatNumber(Number(corridor.declaration_count || 0))}</strong><span>Deklaratsiya</span></div><div><strong>{String(corridor.percentage_share || 0)}%</strong><span>Oqim ulushi</span></div><div><strong>{String(corridor.distance_km || '—')} km</strong><span>Masofa</span></div><div><strong>{Math.round(Number(corridor.avg_transit_minutes || 0) / 60)} soat</strong><span><Clock3 size={14}/>O'rtacha tranzit</span></div><div><strong>{Math.round(Number(corridor.min_transit_minutes || 0) / 60)} soat</strong><span>Eng tez</span></div><div><strong>{Math.round(Number(corridor.max_transit_minutes || 0) / 60)} soat</strong><span>Eng uzoq</span></div></div></div>
}
