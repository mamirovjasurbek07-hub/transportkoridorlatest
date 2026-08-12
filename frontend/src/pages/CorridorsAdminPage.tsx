import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, Eye, Flag, Map, MapPin, MousePointer2, Pencil, Plus, RefreshCw, Route, RotateCw, Trash2, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import Toast, { ToastState } from '../Toast'
import RouteBuilderMap from '../features/map/RouteBuilderMap'
import AdminLayout from '../AdminLayout'
import type { Corridor, Country, CustomsPost, Waypoint } from '../types'

type MarkMode = 'ORIGIN_GATEWAY' | 'VIA' | 'DESTINATION_GATEWAY'
interface FormState { code: string; name: string; origin_country_code: string; destination_country_code: string; entry_post_code: string; exit_post_code: string; status: string; color: string; routing_profile: 'driving' | 'truck'; priority: number; is_active: boolean; waypoints: Waypoint[] }
interface PreviewResult { status: string; geometry?: GeoJSON.LineString; distance_meters?: number; duration_seconds?: number; provider: string; cached: boolean; message?: string }
interface RebuildResult { requested: number; processed: number; updated: string[]; failed: Array<{ id: string; code: string; message: string }>; provider: string }

const blank = (): FormState => ({ code: '', name: '', origin_country_code: '', destination_country_code: '', entry_post_code: '', exit_post_code: '', status: 'DRAFT', color: '#22d3ee', routing_profile: 'driving', priority: 100, is_active: true, waypoints: [] })
const waypointOrder: Record<Waypoint['waypoint_type'], number> = { ORIGIN_GATEWAY: 0, ENTRY_POST: 1, VIA: 2, EXIT_POST: 3, DESTINATION_GATEWAY: 4 }
const normalize = (points: Waypoint[]) => [...points].sort((a, b) => waypointOrder[a.waypoint_type] - waypointOrder[b.waypoint_type] || a.sequence_no - b.sequence_no).map((point, sequence_no) => ({ ...point, sequence_no }))

export default function CorridorsAdminPage() {
  const [params] = useSearchParams()
  const client = useQueryClient()
  const [open, setOpen] = useState(params.get('new') === '1')
  const [editing, setEditing] = useState<Corridor | null>(null)
  const [form, setForm] = useState<FormState>(blank)
  const [markMode, setMarkMode] = useState<MarkMode>('VIA')
  const [preview, setPreview] = useState<GeoJSON.LineString | undefined>()
  const [previewMeta, setPreviewMeta] = useState<PreviewResult | null>(null)
  const [rebuildProgress, setRebuildProgress] = useState<{ done: number; total: number } | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const corridors = useQuery({ queryKey: ['admin-corridors'], queryFn: () => api<{ items: Corridor[]; total: number }>('/corridors?active_only=false') })
  const posts = useQuery({ queryKey: ['corridor-posts'], queryFn: () => api<{ items: CustomsPost[] }>('/posts?page_size=500') })
  const countries = useQuery({ queryKey: ['countries'], queryFn: () => api<Country[]>('/countries') })
  const borderPosts = useMemo(() => (posts.data?.items || []).filter((post) => post.post_type === 'CHBP' && post.latitude != null && post.longitude != null), [posts.data])
  const requiredTypes: Waypoint['waypoint_type'][] = ['ORIGIN_GATEWAY', 'ENTRY_POST', 'EXIT_POST', 'DESTINATION_GATEWAY']
  const requiredReady = Boolean(form.code.trim() && form.name.trim() && form.origin_country_code && form.destination_country_code && form.entry_post_code && form.exit_post_code && requiredTypes.every((type) => form.waypoints.some((point) => point.waypoint_type === type)))

  const previewRoute = useMutation<PreviewResult, ApiError, boolean>({
    mutationFn: (force) => api<PreviewResult>('/corridors/preview', { method: 'POST', body: JSON.stringify({ waypoints: form.waypoints, force, routing_profile: form.routing_profile }) }),
    onSuccess: (result) => {
      if (result.status === 'available' && result.geometry) {
        setPreview(result.geometry); setPreviewMeta(result)
        setToast({ type: 'success', message: `${result.provider.toUpperCase()} avtomobil yo'li yaratdi${result.cached ? ' (cache)' : ''}` })
      } else setToast({ type: 'error', message: result.message || "Avtomobil yo'li topilmadi" })
    },
    onError: (error) => setToast({ type: 'error', message: error.message }),
  })
  const save = useMutation({
    mutationFn: () => editing
      ? api(`/corridors/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ name: form.name, origin_country_code: form.origin_country_code, destination_country_code: form.destination_country_code, entry_post_code: form.entry_post_code, exit_post_code: form.exit_post_code, status: form.status, color: form.color, routing_profile: form.routing_profile, priority: form.priority, is_active: form.is_active, waypoints: form.waypoints, rebuild_route: true }) })
      : api('/corridors', { method: 'POST', body: JSON.stringify({ ...form, build_route: true }) }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['admin-corridors'] }); close(); setToast({ type: 'success', message: "Corridor va uning barcha nuqtalari bazaga saqlandi" }) },
    onError: (error) => setToast({ type: 'error', message: error instanceof ApiError ? error.message : 'Saqlashda xato' }),
  })
  const remove = useMutation({ mutationFn: (id: string) => api(`/corridors/${id}`, { method: 'DELETE' }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['admin-corridors'] }); setToast({ type: 'success', message: 'Corridor nofaol qilindi' }) } })
  const rebuildAll = useMutation({
    mutationFn: async () => {
      const ids = (corridors.data?.items || []).filter((corridor) => corridor.is_active).map((corridor) => corridor.id)
      let updated = 0; const failed: RebuildResult['failed'] = []
      setRebuildProgress({ done: 0, total: ids.length })
      for (let index = 0; index < ids.length; index += 5) {
        const batch = ids.slice(index, index + 5)
        const result = await api<RebuildResult>('/corridors/rebuild-road-geometries', { method: 'POST', body: JSON.stringify({ corridor_ids: batch, routing_profile: 'driving' }) })
        updated += result.updated.length; failed.push(...result.failed); setRebuildProgress({ done: Math.min(index + batch.length, ids.length), total: ids.length })
      }
      return { updated, failed, total: ids.length }
    },
    onSuccess: (result) => { void client.invalidateQueries({ queryKey: ['admin-corridors'] }); setRebuildProgress(null); setToast({ type: result.failed.length ? 'error' : 'success', message: `${result.updated}/${result.total} ta corridor avtomobil yo'li bo'yicha yangilandi${result.failed.length ? `; ${result.failed.length} ta tekshiruvda` : ''}` }) },
    onError: (error) => { setRebuildProgress(null); setToast({ type: 'error', message: error instanceof ApiError ? error.message : 'Corridorlarni yangilashda xato' }) },
  })

  const clearPreview = () => { setPreview(undefined); setPreviewMeta(null) }
  const close = () => { setOpen(false); setEditing(null); setForm(blank()); setMarkMode('VIA'); clearPreview() }
  const openNew = () => { setEditing(null); setForm(blank()); setMarkMode('VIA'); clearPreview(); setOpen(true) }
  const startEdit = (corridor: Corridor) => {
    setEditing(corridor)
    setForm({ code: corridor.code, name: corridor.name, origin_country_code: corridor.origin_country_code || '', destination_country_code: corridor.destination_country_code || '', entry_post_code: corridor.entry_post_code, exit_post_code: corridor.exit_post_code, status: corridor.status, color: corridor.color || '#22d3ee', routing_profile: corridor.routing_profile || 'driving', priority: corridor.priority, is_active: corridor.is_active, waypoints: corridor.waypoints })
    setPreview(corridor.geometry); setPreviewMeta(corridor.geometry ? { status: 'available', geometry: corridor.geometry, distance_meters: corridor.distance_meters, duration_seconds: corridor.duration_seconds, provider: corridor.routing_provider || 'router', cached: true } : null); setOpen(true)
  }
  const selectCountry = (kind: 'origin' | 'destination', code: string) => {
    const country = countries.data?.find((item) => item.alpha2 === code)
    const waypointType: Waypoint['waypoint_type'] = kind === 'origin' ? 'ORIGIN_GATEWAY' : 'DESTINATION_GATEWAY'
    const without = form.waypoints.filter((point) => point.waypoint_type !== waypointType)
    const next = country?.latitude != null && country.longitude != null ? normalize([...without, { sequence_no: 0, waypoint_type: waypointType, latitude: country.latitude, longitude: country.longitude, label: `${country.name} — yuk ${kind === 'origin' ? 'boshlanish' : 'tugash'} nuqtasi` }]) : normalize(without)
    setForm({ ...form, [`${kind}_country_code`]: code, waypoints: next }); clearPreview()
  }
  const selectPost = (kind: 'entry' | 'exit', code: string) => {
    const post = borderPosts.find((item) => item.post_code === code)
    if (post?.latitude == null || post.longitude == null) return
    const waypointType: Waypoint['waypoint_type'] = kind === 'entry' ? 'ENTRY_POST' : 'EXIT_POST'
    const next = normalize([...form.waypoints.filter((point) => point.waypoint_type !== waypointType), { sequence_no: 0, waypoint_type: waypointType, latitude: post.latitude, longitude: post.longitude, post_code: code, label: post.post_name }])
    setForm({ ...form, [`${kind}_post_code`]: code, waypoints: next }); clearPreview()
  }
  const addMapPoint = (latitude: number, longitude: number) => {
    const label = markMode === 'VIA' ? "Yo'lda belgilangan oraliq nuqta" : markMode === 'ORIGIN_GATEWAY' ? 'Yuk boshlanish nuqtasi' : 'Yuk tugash nuqtasi'
    const base = markMode === 'VIA' ? form.waypoints : form.waypoints.filter((point) => point.waypoint_type !== markMode)
    setForm({ ...form, waypoints: normalize([...base, { sequence_no: base.length, waypoint_type: markMode, latitude, longitude, label }]) }); clearPreview()
  }
  const move = (index: number, latitude: number, longitude: number) => { setForm({ ...form, waypoints: form.waypoints.map((point, current) => current === index ? { ...point, latitude, longitude } : point) }); clearPreview() }
  const removePoint = (index: number) => { setForm({ ...form, waypoints: normalize(form.waypoints.filter((_, current) => current !== index)) }); clearPreview() }
  const shiftVia = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= form.waypoints.length || form.waypoints[index].waypoint_type !== 'VIA' || form.waypoints[target].waypoint_type !== 'VIA') return
    const next = [...form.waypoints]; [next[index], next[target]] = [next[target], next[index]]; setForm({ ...form, waypoints: next.map((point, sequence_no) => ({ ...point, sequence_no })) }); clearPreview()
  }

  const actions = <><button className="btn ghost" disabled={rebuildAll.isPending || !corridors.data?.items.length} onClick={() => rebuildAll.mutate()}><RefreshCw className={rebuildAll.isPending ? 'spin' : ''}/> {rebuildProgress ? `${rebuildProgress.done}/${rebuildProgress.total}` : "Barcha yo'llarni yangilash"}</button><button className="btn primary" onClick={openNew}><Plus/> Yangi corridor</button></>
  return <AdminLayout title="Transport corridorlari" subtitle={`${corridors.data?.total ?? 0} ta corridor · Yandex/OSRM avtomobil yo'li geometriyasi`} actions={actions}>
    <div className="corridor-cards">{corridors.data?.items.map((corridor) => <article className="corridor-admin-card" key={corridor.id}><div className="corridor-color" style={{ background: corridor.color || '#22d3ee' }}/><div className="corridor-card-main"><div><span className={`status ${corridor.route_needs_review ? 'review' : 'active'}`}><i/>{corridor.route_needs_review ? 'Tekshiruv kerak' : corridor.status}</span><code>{corridor.code}</code></div><h3>{corridor.name}</h3><p>{corridor.origin_country_code} · {corridor.entry_post_code} <span>→</span> {corridor.exit_post_code} · {corridor.destination_country_code}</p></div><div className="corridor-card-metrics"><span><small>MASOFA</small><strong>{corridor.distance_meters ? `${Math.round(corridor.distance_meters / 1000)} km` : '—'}</strong></span><span><small>ROUTER</small><strong>{(corridor.routing_provider || '—').toUpperCase()}</strong></span><span><small>NUQTA</small><strong>{corridor.waypoints.length}</strong></span></div><div className="row-actions"><button onClick={() => startEdit(corridor)} title="Tahrirlash"><Pencil/></button><button onClick={() => confirm('Corridor nofaol qilinsinmi?') && remove.mutate(corridor.id)}><Trash2/></button></div></article>)}</div>
    {!corridors.isLoading && !corridors.data?.items.length && <div className="empty-state panel"><Route/><strong>Corridor mavjud emas</strong><span>Birinchi avtomobil yo'li corridorini yarating.</span></div>}
    {open && <div className="modal-backdrop"><div className="admin-modal route-modal"><div className="modal-header"><div><p className="eyebrow">CORRIDOR KONSTRUKTORI</p><h2>{editing ? editing.name : "Yangi transport corridori"}</h2></div><button onClick={close}><X/></button></div><div className="route-editor"><div className="route-form">
      <div className="corridor-steps"><span className={form.origin_country_code && form.destination_country_code ? 'done' : 'active'}><b>1</b> Davlatlar</span><span className={form.entry_post_code && form.exit_post_code ? 'done' : ''}><b>2</b> Postlar</span><span className={requiredTypes.every((type) => form.waypoints.some((point) => point.waypoint_type === type)) ? 'done' : ''}><b>3</b> Nuqtalar</span><span className={preview ? 'done' : ''}><b>4</b> Yo'l</span></div>
      <div className="form-grid"><label><span>Corridor kodi *</span><input disabled={!!editing} required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}/></label><label><span>Transport profili</span><select value={form.routing_profile} onChange={(event) => { setForm({ ...form, routing_profile: event.target.value as FormState['routing_profile'] }); clearPreview() }}><option value="driving">Avtomobil</option><option value="truck">Yuk avtomobili (Yandex)</option></select></label><label className="full"><span>Nomi *</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label><label><span>Yo'lak rangi</span><input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })}/></label><label><span>Ustuvorlik</span><input type="number" min={1} max={9999} value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })}/></label><label><span>Yuk boshlanadigan davlat *</span><select value={form.origin_country_code} onChange={(event) => selectCountry('origin', event.target.value)}><option value="">Tanlang</option>{countries.data?.map((country) => <option key={country.alpha2} value={country.alpha2}>{country.flag} {country.name}</option>)}</select></label><label><span>Yuk tugaydigan davlat *</span><select value={form.destination_country_code} onChange={(event) => selectCountry('destination', event.target.value)}><option value="">Tanlang</option>{countries.data?.map((country) => <option key={country.alpha2} value={country.alpha2}>{country.flag} {country.name}</option>)}</select></label><label><span>Kirish posti *</span><select value={form.entry_post_code} onChange={(event) => selectPost('entry', event.target.value)}><option value="">Tanlang</option>{borderPosts.map((post) => <option key={post.id} value={post.post_code}>{post.post_code} · {post.post_name}</option>)}</select></label><label><span>Chiqish posti *</span><select value={form.exit_post_code} onChange={(event) => selectPost('exit', event.target.value)}><option value="">Tanlang</option>{borderPosts.map((post) => <option key={post.id} value={post.post_code}>{post.post_code} · {post.post_name}</option>)}</select></label></div>
      <div className="waypoint-header"><span><strong>Xaritada nuqta belgilash</strong><small>Rejimni tanlang, so'ng xaritada kerakli joyni bosing</small></span><b>{form.waypoints.length}</b></div>
      <div className="mark-mode"><button className={markMode === 'ORIGIN_GATEWAY' ? 'active' : ''} onClick={() => setMarkMode('ORIGIN_GATEWAY')}><Flag/> Boshlanish</button><button className={markMode === 'VIA' ? 'active' : ''} onClick={() => setMarkMode('VIA')}><MousePointer2/> Oraliq nuqta</button><button className={markMode === 'DESTINATION_GATEWAY' ? 'active' : ''} onClick={() => setMarkMode('DESTINATION_GATEWAY')}><MapPin/> Tugash</button></div>
      <div className="waypoint-list">{form.waypoints.map((waypoint, index) => { const via = waypoint.waypoint_type === 'VIA'; return <div key={`${waypoint.waypoint_type}-${index}`}><b>{index + 1}</b><span><strong>{waypoint.label || waypoint.waypoint_type}</strong><small>{waypoint.latitude.toFixed(5)}, {waypoint.longitude.toFixed(5)}</small></span><em>{waypoint.waypoint_type}</em><button disabled={!via || form.waypoints[index - 1]?.waypoint_type !== 'VIA'} onClick={() => shiftVia(index, -1)}><ChevronUp/></button><button disabled={!via || form.waypoints[index + 1]?.waypoint_type !== 'VIA'} onClick={() => shiftVia(index, 1)}><ChevronDown/></button>{waypoint.waypoint_type !== 'ENTRY_POST' && waypoint.waypoint_type !== 'EXIT_POST' ? <button onClick={() => removePoint(index)}><X/></button> : <i/>}</div> })}</div>
      <div className="route-actions"><button className="btn ghost" disabled={!requiredReady || previewRoute.isPending} onClick={() => previewRoute.mutate(false)}><Eye/> {previewRoute.isPending ? 'Yo‘l qurilmoqda…' : "Avtomobil yo'lini ko'rish"}</button><button className="btn ghost" disabled={!requiredReady || previewRoute.isPending} onClick={() => previewRoute.mutate(true)}><RotateCw/> Qayta hisoblash</button><button className="btn primary" disabled={!preview || save.isPending} onClick={() => save.mutate()}><Check/> Bazaga saqlash</button></div>
    </div><div className="route-map-side"><RouteBuilderMap waypoints={form.waypoints} geometry={preview} onAdd={addMapPoint} onMove={move}/><div className="map-mark-hint"><MousePointer2/> <span><strong>{markMode === 'VIA' ? "Oraliq nuqta" : markMode === 'ORIGIN_GATEWAY' ? 'Boshlanish nuqtasi' : 'Tugash nuqtasi'} rejimi</strong><small>Xaritani bosing; markerlarni sudrab aniqlashtirish mumkin</small></span></div>{previewMeta && <div className="route-preview-meta"><span><Map/> <strong>{Math.round((previewMeta.distance_meters || 0) / 1000)} km</strong></span><span><Route/> <strong>{Math.round((previewMeta.duration_seconds || 0) / 3600)} soat</strong></span><small>{previewMeta.provider.toUpperCase()}</small></div>}</div></div></div></div>}
    <Toast toast={toast} onClose={() => setToast(null)}/>
  </AdminLayout>
}
