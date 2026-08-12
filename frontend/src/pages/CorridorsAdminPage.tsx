import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, Eye, Flag, Map as MapIcon, MapPin, MousePointer2, Pencil, Plus, RefreshCw, Route, RotateCw, Trash2, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import Toast, { ToastState } from '../Toast'
import RouteBuilderMap from '../features/map/RouteBuilderMap'
import AdminLayout from '../AdminLayout'
import CountryCombobox from '../CountryCombobox'
import type { Corridor, Country, CustomsPost, Waypoint } from '../types'

type MarkMode = Waypoint['waypoint_type']
interface FormState { code: string; name: string; origin_country_code: string; destination_country_code: string; entry_post_code: string; exit_post_code: string; status: string; color: string; routing_profile: 'driving' | 'truck'; priority: number; is_active: boolean; waypoints: Waypoint[] }
interface PreviewResult { status: string; geometry?: GeoJSON.LineString; distance_meters?: number; duration_seconds?: number; provider: string; cached: boolean; message?: string }
interface RebuildResult { requested: number; processed: number; updated: string[]; failed: Array<{ id: string; code: string; message: string }>; provider: string }

const blank = (): FormState => ({ code: '', name: '', origin_country_code: '', destination_country_code: '', entry_post_code: '', exit_post_code: '', status: 'DRAFT', color: '#22d3ee', routing_profile: 'driving', priority: 100, is_active: true, waypoints: [] })
const markLabels: Record<MarkMode, string> = { ORIGIN_GATEWAY: 'Boshlanish', ENTRY_POST: 'Kirish posti', VIA: 'Oraliq / TIF', EXIT_POST: 'Chiqish posti', DESTINATION_GATEWAY: 'Tugash' }
const resequence = (points: Waypoint[]) => points.map((point, sequence_no) => ({ ...point, sequence_no }))
function upsertRole(points: Waypoint[], point: Waypoint): Waypoint[] {
  const next = points.filter((item) => item.waypoint_type !== point.waypoint_type)
  if (point.waypoint_type === 'ORIGIN_GATEWAY') return resequence([point, ...next])
  if (point.waypoint_type === 'DESTINATION_GATEWAY') return resequence([...next, point])
  if (point.waypoint_type === 'ENTRY_POST') {
    const index = next[0]?.waypoint_type === 'ORIGIN_GATEWAY' ? 1 : 0
    next.splice(index, 0, point); return resequence(next)
  }
  if (point.waypoint_type === 'EXIT_POST') {
    const destinationIndex = next.findIndex((item) => item.waypoint_type === 'DESTINATION_GATEWAY')
    next.splice(destinationIndex < 0 ? next.length : destinationIndex, 0, point); return resequence(next)
  }
  return resequence([...next, point])
}

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
  const locatedPosts = useMemo(() => (posts.data?.items || []).filter((post) => post.latitude != null && post.longitude != null && post.is_active), [posts.data])
  const borderPosts = useMemo(() => locatedPosts.filter((post) => post.post_type === 'CHBP'), [locatedPosts])
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
    const postByCode = new Map(locatedPosts.map((post) => [post.post_code, post]))
    const snapped = corridor.waypoints.map((waypoint) => { const post = waypoint.post_code ? postByCode.get(waypoint.post_code) : undefined; return post?.latitude != null && post.longitude != null ? { ...waypoint, latitude: post.latitude, longitude: post.longitude, label: `${post.post_name} · ${post.post_type}` } : waypoint })
    setForm({ code: corridor.code, name: corridor.name, origin_country_code: corridor.origin_country_code || '', destination_country_code: corridor.destination_country_code || '', entry_post_code: corridor.entry_post_code, exit_post_code: corridor.exit_post_code, status: corridor.status, color: corridor.color || '#22d3ee', routing_profile: corridor.routing_profile || 'driving', priority: corridor.priority, is_active: corridor.is_active, waypoints: resequence(snapped) })
    setPreview(corridor.geometry); setPreviewMeta(corridor.geometry ? { status: 'available', geometry: corridor.geometry, distance_meters: corridor.distance_meters, duration_seconds: corridor.duration_seconds, provider: corridor.routing_provider || 'router', cached: true } : null); setOpen(true)
  }
  const selectCountry = (kind: 'origin' | 'destination', code: string) => {
    const country = countries.data?.find((item) => item.alpha2 === code)
    const waypointType: Waypoint['waypoint_type'] = kind === 'origin' ? 'ORIGIN_GATEWAY' : 'DESTINATION_GATEWAY'
    const without = resequence(form.waypoints.filter((point) => point.waypoint_type !== waypointType))
    const next = country?.latitude != null && country.longitude != null ? upsertRole(without, { sequence_no: 0, waypoint_type: waypointType, latitude: country.latitude, longitude: country.longitude, label: `${country.name} — yuk ${kind === 'origin' ? 'boshlanish' : 'tugash'} nuqtasi` }) : without
    setForm({ ...form, [`${kind}_country_code`]: code, waypoints: next }); clearPreview()
  }
  const selectPost = (kind: 'entry' | 'exit', code: string) => {
    const post = borderPosts.find((item) => item.post_code === code)
    if (post?.latitude == null || post.longitude == null) return
    const waypointType: Waypoint['waypoint_type'] = kind === 'entry' ? 'ENTRY_POST' : 'EXIT_POST'
    const next = upsertRole(form.waypoints, { sequence_no: 0, waypoint_type: waypointType, latitude: post.latitude, longitude: post.longitude, post_code: code, label: post.post_name })
    setForm({ ...form, [`${kind}_post_code`]: code, waypoints: next }); clearPreview()
  }
  const addMapPoint = (latitude: number, longitude: number) => {
    if (form.waypoints.length >= 50) { setToast({ type: 'error', message: "Bitta corridorda ko'pi bilan 50 ta nuqta bo'lishi mumkin" }); return }
    if (markMode === 'ENTRY_POST' || markMode === 'EXIT_POST') { setToast({ type: 'error', message: "Kirish yoki chiqish uchun xaritadagi CHBP post markerini bosing" }); return }
    const label = markMode === 'VIA' ? "Yo'lda belgilangan oraliq nuqta" : markMode === 'ORIGIN_GATEWAY' ? 'Yuk boshlanish nuqtasi' : 'Yuk tugash nuqtasi'
    const point: Waypoint = { sequence_no: 0, waypoint_type: markMode, latitude, longitude, label }
    if (markMode === 'VIA') {
      const next = [...form.waypoints]; const exitIndex = next.findIndex((item) => item.waypoint_type === 'EXIT_POST' || item.waypoint_type === 'DESTINATION_GATEWAY'); next.splice(exitIndex < 0 ? next.length : exitIndex, 0, point)
      setForm({ ...form, waypoints: resequence(next) })
    } else setForm({ ...form, waypoints: upsertRole(form.waypoints, point) })
    clearPreview()
  }
  const selectMapPost = (post: CustomsPost) => {
    if (markMode === 'VIA' && form.waypoints.length >= 50) { setToast({ type: 'error', message: "Bitta corridorda ko'pi bilan 50 ta nuqta bo'lishi mumkin" }); return }
    if (post.latitude == null || post.longitude == null) return
    if ((markMode === 'ENTRY_POST' || markMode === 'EXIT_POST') && post.post_type !== 'CHBP') { setToast({ type: 'error', message: 'Kirish/chiqish roli uchun CHBP chegara postini tanlang. TIF posti oraliq, boshlanish yoki tugash bo‘lishi mumkin.' }); return }
    const point: Waypoint = { sequence_no: 0, waypoint_type: markMode, latitude: post.latitude, longitude: post.longitude, post_code: post.post_code, label: `${post.post_name} · ${post.post_type}` }
    let next: Waypoint[]
    if (markMode === 'VIA') { next = [...form.waypoints]; const exitIndex = next.findIndex((item) => item.waypoint_type === 'EXIT_POST' || item.waypoint_type === 'DESTINATION_GATEWAY'); next.splice(exitIndex < 0 ? next.length : exitIndex, 0, point); next = resequence(next) } else next = upsertRole(form.waypoints, point)
    setForm({ ...form, waypoints: next, ...(markMode === 'ENTRY_POST' ? { entry_post_code: post.post_code } : {}), ...(markMode === 'EXIT_POST' ? { exit_post_code: post.post_code } : {}) }); clearPreview()
    setToast({ type: 'success', message: `${post.post_code} · ${post.post_name} — ${markMode} sifatida tanlandi` })
  }
  const move = (index: number, latitude: number, longitude: number) => { setForm({ ...form, waypoints: form.waypoints.map((point, current) => current === index ? { ...point, latitude, longitude } : point) }); clearPreview() }
  const removePoint = (index: number) => { const removed = form.waypoints[index]; setForm({ ...form, waypoints: resequence(form.waypoints.filter((_, current) => current !== index)), ...(removed.waypoint_type === 'ENTRY_POST' ? { entry_post_code: '' } : {}), ...(removed.waypoint_type === 'EXIT_POST' ? { exit_post_code: '' } : {}) }); clearPreview() }
  const insertAfter = (index: number) => {
    if (form.waypoints.length >= 50) { setToast({ type: 'error', message: "Bitta corridorda ko'pi bilan 50 ta nuqta bo'lishi mumkin" }); return }
    const current = form.waypoints[index]; const following = form.waypoints[index + 1]
    if (!current || !following || current.waypoint_type === 'DESTINATION_GATEWAY') return
    const point: Waypoint = { sequence_no: index + 1, waypoint_type: 'VIA', latitude: (current.latitude + following.latitude) / 2, longitude: (current.longitude + following.longitude) / 2, label: `${index + 1}-nuqtadan keyingi yangi oraliq nuqta` }
    const next = [...form.waypoints]; next.splice(index + 1, 0, point); setForm({ ...form, waypoints: resequence(next) }); setMarkMode('VIA'); clearPreview()
  }
  const shiftPoint = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= form.waypoints.length || form.waypoints[index].waypoint_type === 'ORIGIN_GATEWAY' || form.waypoints[index].waypoint_type === 'DESTINATION_GATEWAY' || form.waypoints[target].waypoint_type === 'ORIGIN_GATEWAY' || form.waypoints[target].waypoint_type === 'DESTINATION_GATEWAY') return
    const next = [...form.waypoints]; [next[index], next[target]] = [next[target], next[index]]; setForm({ ...form, waypoints: next.map((point, sequence_no) => ({ ...point, sequence_no })) }); clearPreview()
  }

  const actions = <><button className="btn ghost" disabled={rebuildAll.isPending || !corridors.data?.items.length} onClick={() => rebuildAll.mutate()}><RefreshCw className={rebuildAll.isPending ? 'spin' : ''}/> {rebuildProgress ? `${rebuildProgress.done}/${rebuildProgress.total}` : "Barcha yo'llarni yangilash"}</button><button className="btn primary" onClick={openNew}><Plus/> Yangi corridor</button></>
  return <AdminLayout title="Transport corridorlari" subtitle={`${corridors.data?.total ?? 0} ta corridor · Yandex/OSRM avtomobil yo'li geometriyasi`} actions={actions}>
    <div className="corridor-cards">{corridors.data?.items.map((corridor) => <article className="corridor-admin-card" key={corridor.id}><div className="corridor-color" style={{ background: corridor.color || '#22d3ee' }}/><div className="corridor-card-main"><div><span className={`status ${corridor.route_needs_review ? 'review' : 'active'}`}><i/>{corridor.route_needs_review ? 'Tekshiruv kerak' : corridor.status}</span><code>{corridor.code}</code></div><h3>{corridor.name}</h3><p>{corridor.origin_country_code} · {corridor.entry_post_code} <span>→</span> {corridor.exit_post_code} · {corridor.destination_country_code}</p></div><div className="corridor-card-metrics"><span><small>MASOFA</small><strong>{corridor.distance_meters ? `${Math.round(corridor.distance_meters / 1000)} km` : '—'}</strong></span><span><small>ROUTER</small><strong>{(corridor.routing_provider || '—').toUpperCase()}</strong></span><span><small>NUQTA</small><strong>{corridor.waypoints.length}</strong></span></div><div className="row-actions"><button onClick={() => startEdit(corridor)} title="Tahrirlash"><Pencil/></button><button onClick={() => confirm('Corridor nofaol qilinsinmi?') && remove.mutate(corridor.id)}><Trash2/></button></div></article>)}</div>
    {!corridors.isLoading && !corridors.data?.items.length && <div className="empty-state panel"><Route/><strong>Corridor mavjud emas</strong><span>Birinchi avtomobil yo'li corridorini yarating.</span></div>}
    {open && <div className="modal-backdrop"><div className="admin-modal route-modal"><div className="modal-header"><div><p className="eyebrow">CORRIDOR KONSTRUKTORI</p><h2>{editing ? editing.name : "Yangi transport corridori"}</h2></div><button onClick={close}><X/></button></div><div className="route-editor"><div className="route-form">
      <div className="corridor-steps"><span className={form.origin_country_code && form.destination_country_code ? 'done' : 'active'}><b>1</b> Davlatlar</span><span className={form.entry_post_code && form.exit_post_code ? 'done' : ''}><b>2</b> Postlar</span><span className={requiredTypes.every((type) => form.waypoints.some((point) => point.waypoint_type === type)) ? 'done' : ''}><b>3</b> Nuqtalar</span><span className={preview ? 'done' : ''}><b>4</b> Yo'l</span></div>
      <div className="form-grid"><label><span>Corridor kodi *</span><input disabled={!!editing} required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}/></label><label><span>Transport profili</span><select value={form.routing_profile} onChange={(event) => { setForm({ ...form, routing_profile: event.target.value as FormState['routing_profile'] }); clearPreview() }}><option value="driving">Avtomobil yo‘li</option><option value="truck">Yuk avtomobili yo‘li</option></select></label><label className="full"><span>Nomi *</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label><label><span>Yo'lak rangi</span><input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })}/></label><label><span>Ustuvorlik</span><input type="number" min={1} max={9999} value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })}/></label><label><span>Yuk boshlanadigan davlat *</span><CountryCombobox countries={countries.data || []} value={form.origin_country_code} onChange={(code) => selectCountry('origin', code)} emptyLabel="Boshlanish davlatini tanlang"/></label><label><span>Yuk tugaydigan davlat *</span><CountryCombobox countries={countries.data || []} value={form.destination_country_code} onChange={(code) => selectCountry('destination', code)} emptyLabel="Tugash davlatini tanlang"/></label><label><span>Kirish posti *</span><select value={form.entry_post_code} onChange={(event) => selectPost('entry', event.target.value)}><option value="">Tanlang yoki xaritadagi postni bosing</option>{borderPosts.map((post) => <option key={post.id} value={post.post_code}>{post.post_code} · {post.post_name}</option>)}</select></label><label><span>Chiqish posti *</span><select value={form.exit_post_code} onChange={(event) => selectPost('exit', event.target.value)}><option value="">Tanlang yoki xaritadagi postni bosing</option>{borderPosts.map((post) => <option key={post.id} value={post.post_code}>{post.post_code} · {post.post_name}</option>)}</select></label></div>
      <div className="waypoint-header"><span><strong>Xaritada nuqta belgilash</strong><small>Rejimni tanlang, so'ng xaritada kerakli joyni bosing</small></span><b>{form.waypoints.length}</b></div>
      <div className="mark-mode">{(['ORIGIN_GATEWAY','ENTRY_POST','VIA','EXIT_POST','DESTINATION_GATEWAY'] as MarkMode[]).map((mode) => <button key={mode} className={markMode === mode ? 'active' : ''} onClick={() => setMarkMode(mode)}>{mode === 'ORIGIN_GATEWAY' ? <Flag/> : mode === 'DESTINATION_GATEWAY' ? <MapPin/> : <MousePointer2/>}{markLabels[mode]}</button>)}</div>
      <div className="post-map-help"><MapPin/><span><strong>Xaritadagi post markerini bosing</strong><small>CHBP — kirish/chiqish; TIF va boshqa postlar — boshlanish, oraliq yoki tugash bo‘lishi mumkin.</small></span></div>
      <div className="waypoint-list">{form.waypoints.map((waypoint, index) => { const movable = waypoint.waypoint_type !== 'ORIGIN_GATEWAY' && waypoint.waypoint_type !== 'DESTINATION_GATEWAY'; return <div key={`${waypoint.waypoint_type}-${index}`}><b>{index + 1}</b><span><strong>{waypoint.label || waypoint.waypoint_type}</strong><small>{waypoint.post_code ? `POST ${waypoint.post_code} · ` : ''}{waypoint.latitude.toFixed(5)}, {waypoint.longitude.toFixed(5)}</small></span><em>{waypoint.waypoint_type}</em><button title="Yuqoriga" disabled={!movable || index < 1 || form.waypoints[index - 1]?.waypoint_type === 'ORIGIN_GATEWAY'} onClick={() => shiftPoint(index, -1)}><ChevronUp/></button><button title="Pastga" disabled={!movable || index >= form.waypoints.length - 1 || form.waypoints[index + 1]?.waypoint_type === 'DESTINATION_GATEWAY'} onClick={() => shiftPoint(index, 1)}><ChevronDown/></button><button title="Shu nuqtadan keyin yangi nuqta" disabled={index >= form.waypoints.length - 1} onClick={() => insertAfter(index)}><Plus/></button><button title="Nuqtani olib tashlash" onClick={() => removePoint(index)}><X/></button></div> })}</div>
      <div className="route-actions"><button className="btn ghost" disabled={!requiredReady || previewRoute.isPending} onClick={() => previewRoute.mutate(false)}><Eye/> {previewRoute.isPending ? 'Yo‘l qurilmoqda…' : "Avtomobil yo'lini ko'rish"}</button><button className="btn ghost" disabled={!requiredReady || previewRoute.isPending} onClick={() => previewRoute.mutate(true)}><RotateCw/> Qayta hisoblash</button><button className="btn primary" disabled={!preview || save.isPending} onClick={() => save.mutate()}><Check/> Bazaga saqlash</button></div>
    </div><div className="route-map-side"><RouteBuilderMap posts={locatedPosts} waypoints={form.waypoints} geometry={preview} onAdd={addMapPoint} onMove={move} onPostSelect={selectMapPost}/><div className="map-mark-hint"><MousePointer2/> <span><strong>{markLabels[markMode]} rejimi</strong><small>Post markerini yoki xaritani bosing. Postga bog‘langan nuqta post koordinatasidan siljimaydi; oddiy nuqtalarni sudrash mumkin.</small></span></div>{previewMeta && <div className="route-preview-meta"><span><MapIcon/> <strong>{Math.round((previewMeta.distance_meters || 0) / 1000)} km</strong></span><span><Route/> <strong>{Math.round((previewMeta.duration_seconds || 0) / 3600)} soat</strong></span><small>{previewMeta.provider.toUpperCase()}</small></div>}</div></div></div></div>}
    <Toast toast={toast} onClose={() => setToast(null)}/>
  </AdminLayout>
}
