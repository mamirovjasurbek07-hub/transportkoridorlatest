import { ArrowDownRight, ArrowUpRight, ChevronRight, Clock3, MapPinned, Route, ScanLine, TriangleAlert, Waypoints, X } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AnalyticsData, Corridor, FeatureCollection } from '../../types'


export function KpiGrid({ data }: { data?: AnalyticsData }) {
  const k = data?.kpis
  const items = [
    { label: 'Jami deklaratsiyalar', value: k?.total_declarations.toLocaleString('uz-UZ') ?? '—', icon: ScanLine, note: `${Math.abs(k?.change_percent || 0)}%`, positive: (k?.change_percent || 0) >= 0 },
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
      <section className="chart-block"><div className="section-title"><span>KUNLIK DINAMIKA</span><b>{data?.kpis.total_declarations.toLocaleString('uz-UZ') || 0}</b></div><div className="trend-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data?.trend || []}><defs><linearGradient id="trend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity={0.5}/><stop offset="100%" stopColor="#22d3ee" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="date" hide/><YAxis hide/><Tooltip contentStyle={{ background: '#0d1d2e', border: '1px solid #24405a', borderRadius: 10 }} labelStyle={{ color: '#8ca6bd' }}/><Area type="monotone" dataKey="count" stroke="#22d3ee" strokeWidth={2} fill="url(#trend)"/></AreaChart></ResponsiveContainer></div></section>
      <section><div className="section-title"><span>TOP YO'NALISHLAR</span><small>DEKLARATSIYA</small></div><div className="ranking-list">{data?.top_pairs.map((row, i) => <div key={`${row.origin}-${row.destination}-${row.entry}-${row.exit}`}><b>{String(i + 1).padStart(2, '0')}</b><span><strong>{row.origin} → {row.destination} · {row.entry} → {row.exit}</strong><i><em style={{ width: `${(row.count / (data.top_pairs[0]?.count || 1)) * 100}%` }} /></i></span><strong>{row.count}</strong></div>)}</div></section>
      <section><div className="section-title"><span>DAVLATLAR ULUSHI</span><small>%</small></div><div className="country-share">{data?.country_share.slice(0, 5).map((row) => <div key={row.country}><span>{row.country}</span><i><em style={{ width: `${row.share}%` }}/></i><b>{row.share}%</b></div>)}</div></section>
      {!!data?.unavailable_routes.length && <div className="route-warning"><TriangleAlert/><span><strong>{data.unavailable_routes.length} ta route chizilmadi</strong><small>Admin tekshiruvi talab qilinadi</small></span></div>}
    </aside>
  )
}


export function CorridorPicker({ corridors, topPairs, available, mode, selectedCode, selectedId, showPosts, showTop5, showCorridor, select }: { corridors?: FeatureCollection; topPairs: AnalyticsData['top_pairs']; available: Corridor[]; mode: 'posts' | 'top5' | 'single'; selectedCode: string; selectedId?: string; showPosts: () => void; showTop5: () => void; showCorridor: (code: string) => void; select: (corridor: Record<string, unknown>) => void }) {
  const features = corridors?.features || []
  return <section className="corridor-picker" aria-label="Ko'rsatilayotgan yo'laklarni tanlash"><div className="corridor-picker-title"><span><Route size={18}/><strong>Xaritada nimani ko‘rsatamiz?</strong><small>{mode === 'posts' ? 'Hozir faqat bojxona postlari ko‘rsatilmoqda' : mode === 'top5' ? 'Tashuv hajmi bo‘yicha eng katta 5 ta post yo‘nalishi' : 'Faqat tanlangan corridor ko‘rsatilmoqda'}</small></span><em>{features.length ? `${features.length} ta yo‘lak` : 'Corridor yashirilgan'}</em></div><div className="map-view-controls"><button className={mode === 'posts' ? 'active' : ''} onClick={showPosts}>Faqat postlar</button><button className={mode === 'top5' ? 'active' : ''} onClick={showTop5}>Top-5 yo‘lak</button><select value={mode === 'single' ? selectedCode : ''} onChange={(event) => event.target.value && showCorridor(event.target.value)}><option value="">Bitta corridorni tanlang…</option>{available.map((corridor) => <option key={corridor.id} value={corridor.code}>{corridor.origin_country_code} → {corridor.destination_country_code} · {corridor.entry_post_code} → {corridor.exit_post_code} · {corridor.name}</option>)}</select></div>{mode === 'top5' && topPairs.length > 0 && <div className="corridor-picker-list top-five">{topPairs.map((pair, index) => { const feature = features.find((item) => item.properties.entry_post_code === pair.entry && item.properties.exit_post_code === pair.exit && item.properties.origin_country_code === pair.origin && item.properties.destination_country_code === pair.destination); const p = feature?.properties; const active = p ? String(p.id) === selectedId : false; return <button key={`${pair.origin}-${pair.destination}-${pair.entry}-${pair.exit}`} disabled={!p} className={active ? 'active' : ''} style={{ borderLeftColor: String(p?.color || '#536978') }} onClick={() => p && select(p)}><b>{index + 1}</b><span><strong>{String(p?.entry_post_name || pair.entry)} → {String(p?.exit_post_name || pair.exit)}</strong><small>{pair.origin} → {pair.destination} · {p ? 'xaritada mavjud' : 'yo‘l geometriyasi tekshirilmoqda'}</small></span><em>{pair.count.toLocaleString('uz-UZ')}</em></button> })}</div>}</section>
}


export function CorridorDrawer({ corridor, close }: { corridor: Record<string, unknown> | null; close: () => void }) {
  if (!corridor) return null
  const permission = (prefix: 'entry' | 'exit') => [corridor[`${prefix}_allow_passenger`] ? 'yengil' : '', corridor[`${prefix}_allow_cargo`] ? 'yuk' : ''].filter(Boolean).join(' + ') || 'ruxsat belgilanmagan'
  return <div className="corridor-drawer" role="dialog" aria-label="Korridor tafsilotlari" style={{ borderTopColor: String(corridor.color || '#22d3ee') }}><button className="drawer-close" onClick={close}><X /></button><p className="eyebrow">TANLANGAN KORRIDOR · {String(corridor.origin_country_code)} → {String(corridor.destination_country_code)}</p><h2>{String(corridor.name || '')}</h2><span className="route-code">{String(corridor.code || '')}</span><div className="drawer-route"><MapPinned/><span><small>KIRISH · {String(corridor.entry_post_code)}</small><strong>{String(corridor.entry_post_name || corridor.entry_post_code)}</strong><small>Ruxsat: {permission('entry')}</small></span><i/><span><small>CHIQISH · {String(corridor.exit_post_code)}</small><strong>{String(corridor.exit_post_name || corridor.exit_post_code)}</strong><small>Ruxsat: {permission('exit')}</small></span><Route/></div><div className="drawer-metrics"><div><strong>{Number(corridor.declaration_count || 0).toLocaleString('uz-UZ')}</strong><span>Deklaratsiya</span></div><div><strong>{String(corridor.percentage_share || 0)}%</strong><span>Oqim ulushi</span></div><div><strong>{String(corridor.distance_km || '—')} km</strong><span>Masofa</span></div><div><strong>{Math.round(Number(corridor.avg_transit_minutes || 0) / 60)} soat</strong><span><Clock3 size={14}/>O'rtacha tranzit</span></div><div><strong>{Math.round(Number(corridor.min_transit_minutes || 0) / 60)} soat</strong><span>Eng tez</span></div><div><strong>{Math.round(Number(corridor.max_transit_minutes || 0) / 60)} soat</strong><span>Eng uzoq</span></div></div></div>
}
