import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Car, Check, Clipboard, MapPin, Pencil, Plus, Search, Trash2, Truck, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import LocationPicker from '../features/map/LocationPicker'
import AdminLayout from '../AdminLayout'
import CountryCombobox from '../CountryCombobox'
import type { Country, CustomsPost } from '../types'
import Toast, { ToastState } from '../Toast'

type PostForm = Omit<CustomsPost, 'id'>
type PostSaveResult = CustomsPost & { corridors_rebuilt?: number; corridors_review?: number }
const emptyForm: PostForm = { post_code: '', post_name: '', post_type: 'CHBP', post_category: 'UNASSIGNED', region: '', neighbor_country_code: 'KZ', latitude: undefined, longitude: undefined, location_verified: false, allow_passenger_vehicles: true, allow_cargo_vehicles: true, is_active: true }
const POST_CATEGORIES: Array<{ value: PostForm['post_category']; label: string }> = [
  { value: 'UNASSIGNED', label: 'Toifa belgilanmagan' },
  { value: 'EXTRA', label: 'Toifadan tashqari' },
  { value: 'FIRST', label: 'Birinchi toifa' },
  { value: 'SECOND', label: 'Ikkinchi toifa' },
]
function parseCoordinatePair(value: string): { latitude: number; longitude: number } | null {
  const parts = value.trim().replace(';', ',').split(/\s*,\s*|\s+/).filter(Boolean)
  if (parts.length !== 2) return null
  const latitude = Number(parts[0]); const longitude = Number(parts[1])
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

export default function PostsAdminPage() {
  const [params] = useSearchParams()
  const client = useQueryClient()
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [editing, setEditing] = useState<CustomsPost | null>(null)
  const [form, setForm] = useState<PostForm>(emptyForm)
  const [coordinateText, setCoordinateText] = useState('')
  const [open, setOpen] = useState(params.get('new') === '1')
  const [toast, setToast] = useState<ToastState | null>(null)
  const query = useQuery({ queryKey: ['admin-posts', search, type], queryFn: () => { const q = new URLSearchParams({ active_only: 'false', page_size: '500' }); if (search) q.set('search', search); if (type) q.set('post_type', type); return api<{ items: CustomsPost[]; total: number }>(`/posts?${q}`) } })
  const countries = useQuery({ queryKey: ['countries'], queryFn: () => api<Country[]>('/countries') })
  const save = useMutation({ mutationFn: () => editing ? api<PostSaveResult>(`/posts/${editing.id}`, { method: 'PATCH', body: JSON.stringify(form) }) : api<PostSaveResult>('/posts', { method: 'POST', body: JSON.stringify(form) }), onSuccess: (result) => { void client.invalidateQueries({ queryKey: ['admin-posts'] }); void client.invalidateQueries({ queryKey: ['posts-public'] }); void client.invalidateQueries({ queryKey: ['analytics'] }); void client.invalidateQueries({ queryKey: ['corridors-public'] }); setOpen(false); setEditing(null); setForm(emptyForm); setCoordinateText(''); const routeNote = result.corridors_rebuilt || result.corridors_review ? ` · ${result.corridors_rebuilt || 0} yo'lak yangilandi${result.corridors_review ? `, ${result.corridors_review} ta review` : ''}` : ''; setToast({ type: 'success', message: `Post muvaffaqiyatli saqlandi${routeNote}` }) }, onError: (e) => setToast({ type: 'error', message: e instanceof ApiError ? e.message : 'Saqlashda xato' }) })
  const remove = useMutation({ mutationFn: (id: string) => api(`/posts/${id}`, { method: 'DELETE' }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['admin-posts'] }); setToast({ type: 'success', message: 'Post nofaol qilindi' }) } })
  useEffect(() => { if (!open) setEditing(null) }, [open])
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])
  const startEdit = (post: CustomsPost) => { setEditing(post); setForm({ ...post }); setCoordinateText(post.latitude != null && post.longitude != null ? `${post.latitude}, ${post.longitude}` : ''); setOpen(true) }
  const updateCoordinateText = (value: string) => { setCoordinateText(value); if (!value.trim()) { setForm((current) => ({ ...current, latitude: undefined, longitude: undefined })); return }; const coordinates = parseCoordinatePair(value); if (coordinates) setForm((current) => ({ ...current, ...coordinates })) }
  const updateCoordinates = (latitude: number, longitude: number) => { setCoordinateText(`${latitude}, ${longitude}`); setForm((current) => ({ ...current, latitude, longitude })) }
  const coordinateValid = !coordinateText.trim() || Boolean(parseCoordinatePair(coordinateText))
  return <AdminLayout title="Bojxona postlari" subtitle={`${query.data?.total ?? 0} ta post · kodlar string sifatida saqlanadi`} actions={<button className="btn primary" onClick={() => { setForm(emptyForm); setCoordinateText(''); setOpen(true) }}><Plus size={17}/> Yangi post</button>}>
    <section className="panel table-panel"><div className="table-toolbar"><div className="input-wrap search-input"><Search/><input placeholder="Kod yoki nom bo'yicha qidirish" value={search} onChange={(e) => setSearch(e.target.value)}/></div><select value={type} onChange={(e) => setType(e.target.value)}><option value="">Barcha turlar</option>{['CHBP','TIF','AERO','RW','PORT'].map((v) => <option key={v}>{v}</option>)}</select></div><div className="responsive-table"><table><thead><tr><th>Post kodi</th><th>Post nomi</th><th>Turi</th><th>Toifasi</th><th>Davlat</th><th>Transport ruxsati</th><th>Koordinata</th><th>Holati</th><th/></tr></thead><tbody>{query.data?.items.map((post) => <tr key={post.id}><td><button className="copy-code" onClick={() => { void navigator.clipboard.writeText(post.post_code); setToast({ type: 'success', message: 'Post kodi nusxalandi' }) }}><code>{post.post_code}</code><Clipboard/></button></td><td><strong>{post.post_name}</strong></td><td><span className={`type-badge ${post.post_type.toLowerCase()}`}>{post.post_type}</span></td><td>{POST_CATEGORIES.find((item) => item.value === post.post_category)?.label || 'Belgilanmagan'}</td><td>{post.neighbor_country_code || '—'}</td><td>{post.post_type === 'CHBP' ? <span className="vehicle-badges">{post.allow_passenger_vehicles && <i title="Yengil avtotransport"><Car/></i>}{post.allow_cargo_vehicles && <i title="Yukli avtotransport"><Truck/></i>}</span> : <span className="muted">—</span>}</td><td>{post.latitude != null ? <span className="location-ok"><MapPin/> {post.latitude.toFixed(4)}, {post.longitude?.toFixed(4)}</span> : <span className="muted">Belgilanmagan</span>}</td><td>{post.is_active ? <span className="status active"><i/>Faol</span> : <span className="status"><i/>Nofaol</span>}</td><td><div className="row-actions"><button onClick={() => startEdit(post)} title="Tahrirlash"><Pencil/></button><button onClick={() => confirm('Post nofaol qilinsinmi?') && remove.mutate(post.id)} title="Nofaol qilish"><Trash2/></button></div></td></tr>)}</tbody></table>{!query.isLoading && !query.data?.items.length && <div className="empty-state"><Search/><strong>Post topilmadi</strong><span>Qidiruv yoki filtrni o'zgartiring.</span></div>}</div></section>
    {open && <div className="modal-backdrop"><div className="admin-modal large post-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">{editing ? 'POSTNI TAHRIRLASH' : 'YANGI POST'}</p><h2>{editing?.post_name || "Bojxona postini qo'shish"}</h2></div><button onClick={() => setOpen(false)}><X/></button></div><div className="post-editor"><form onSubmit={(e) => { e.preventDefault(); save.mutate() }}><div className="form-grid"><label><span>Post kodi *</span><input required minLength={3} maxLength={10} disabled={!!editing} value={form.post_code} onChange={(e) => setForm({...form, post_code: e.target.value})}/><small>Masalan: 00101. Yetakchi nol saqlanadi.</small></label><label><span>Post turi *</span><select value={form.post_type} onChange={(e) => setForm({...form, post_type: e.target.value as PostForm['post_type']})}>{['CHBP','TIF','AERO','RW','PORT'].map((v) => <option key={v}>{v}</option>)}</select></label><label><span>PQ-122 bo‘yicha toifa *</span><select value={form.post_category} onChange={(e) => setForm({...form, post_category: e.target.value as PostForm['post_category']})}>{POST_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><small>2025-yil 25-martdagi PQ-122, 5-ilova</small></label><label><span>Hudud</span><input value={form.region || ''} onChange={(e) => setForm({...form, region: e.target.value})}/></label><label className="full"><span>Post nomi *</span><input required value={form.post_name} onChange={(e) => setForm({...form, post_name: e.target.value})}/></label><label><span>Chegaradosh davlat {form.post_type === 'CHBP' && '*'}</span><CountryCombobox countries={(countries.data || []).filter((country) => ['KZ','KG','TJ','TM','AF'].includes(country.alpha2))} value={form.neighbor_country_code || ''} onChange={(code) => setForm({...form, neighbor_country_code: code})} emptyLabel="Tanlanmagan"/></label><label className="full coordinate-pair-field"><span>Koordinata — latitude, longitude</span><input className={coordinateValid ? '' : 'invalid'} inputMode="decimal" placeholder="41.310617600000036, 69.21984867557755" value={coordinateText} onChange={(event) => updateCoordinateText(event.target.value)}/><small>{coordinateValid ? 'Ikki koordinatani vergul bilan kiriting — xarita avtomatik aniqlaydi.' : 'Format noto‘g‘ri. Masalan: 41.310617600000036, 69.21984867557755'}</small></label></div>{form.post_type === 'CHBP' && <fieldset className="vehicle-permissions"><legend>Postdan harakatlanishga ruxsat *</legend><label><input type="checkbox" checked={form.allow_passenger_vehicles} onChange={(e) => setForm({...form, allow_passenger_vehicles: e.target.checked})}/><Car/><span><strong>Yengil avtotransport</strong><small>Yengil avtomobil va mikroavtobuslar</small></span></label><label><input type="checkbox" checked={form.allow_cargo_vehicles} onChange={(e) => setForm({...form, allow_cargo_vehicles: e.target.checked})}/><Truck/><span><strong>Yukli avtotransport</strong><small>Yuk avtomobili va avtopoyezdlar</small></span></label>{!form.allow_passenger_vehicles && !form.allow_cargo_vehicles && <small className="permission-error">Kamida bittasini tanlang.</small>}</fieldset>}<label className="checkbox"><input type="checkbox" checked={form.location_verified} onChange={(e) => setForm({...form, location_verified: e.target.checked})}/><span><strong>Tasdiqlangan lokatsiya</strong><small>Koordinata tekshirilgan bo'lsa belgilang</small></span></label><div className="modal-actions"><button type="button" className="btn ghost" onClick={() => setOpen(false)}>Bekor qilish</button><button className="btn primary" disabled={!coordinateValid || save.isPending || (form.post_type === 'CHBP' && !form.allow_passenger_vehicles && !form.allow_cargo_vehicles)}><Check/> {save.isPending ? 'Yo‘laklar yangilanmoqda…' : 'Saqlash'}</button></div></form><div className="map-editor-side"><div><strong>Xarita yoki koordinata orqali belgilang</strong><small>Xaritani bosing, markerni suring yoki chap tomonda koordinatani bitta qatorda kiriting</small></div><LocationPicker latitude={form.latitude} longitude={form.longitude} onChange={updateCoordinates}/></div></div></div></div>}
    <Toast toast={toast} onClose={() => setToast(null)}/>
  </AdminLayout>
}
