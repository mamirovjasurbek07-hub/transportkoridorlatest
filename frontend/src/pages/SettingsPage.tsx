import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, KeyRound, RefreshCw, Route, Save, Server, ShieldCheck } from 'lucide-react'
import { api, ApiError } from '../api'
import Toast, { ToastState } from '../Toast'
import AdminLayout from '../AdminLayout'

export default function SettingsPage() {
  const client = useQueryClient()
  const [toast, setToast] = useState<ToastState | null>(null)
  const [router, setRouter] = useState('osrm')
  const [animationLimit, setAnimationLimit] = useState(100)
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Array<{ key: string; value: any }>>('/settings') })
  const mapConfig = useQuery({ queryKey: ['map-config'], queryFn: () => api<any>('/map/config') })
  useEffect(() => {
    const ui = settings.data?.find((item) => item.key === 'ui')?.value
    if (ui) { setRouter(ui.routing_provider || 'osrm'); setAnimationLimit(Number(ui.animation_corridor_limit || 100)) }
  }, [settings.data])
  const save = useMutation({ mutationFn: () => api('/settings/ui', { method: 'PUT', body: JSON.stringify({ routing_provider: router, animation_corridor_limit: animationLimit }) }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['settings'] }); void client.invalidateQueries({ queryKey: ['map-config'] }); setToast({ type: 'success', message: 'Sozlamalar saqlandi va tizimga qo‘llandi' }) }, onError: (error) => setToast({ type: 'error', message: error instanceof ApiError ? error.message : 'Xato' }) })
  const reset = useMutation({ mutationFn: () => api<{ count: number }>('/declarations/mock/reset', { method: 'POST' }), onSuccess: (data) => { void client.invalidateQueries(); setToast({ type: 'success', message: `${data.count} ta demo deklaratsiya yaratildi` }) }, onError: (error) => setToast({ type: 'error', message: error instanceof ApiError ? error.message : 'Xato' }) })
  return <AdminLayout title="Tizim sozlamalari" subtitle="Routing, vizual limit va xavfsizlik holati">
    <div className="settings-grid">
      <section className="panel settings-card"><div className="settings-title"><span><Route/></span><div><h2>Routing xizmati</h2><p>Faqat backend qo‘llaydigan providerlar</p></div></div><label><span>Faol provider</span><select value={router} onChange={(e) => setRouter(e.target.value)}><option value="osrm">OSRM · driving</option>{mapConfig.data?.yandex_router_available && <option value="yandex">Yandex Router · driving/truck</option>}</select></label><label><span>Animatsiya limiti</span><input type="number" min={20} max={250} value={animationLimit} onChange={(e) => setAnimationLimit(Number(e.target.value))}/><small>Xarita ushbu limitdan keyin animatsiyani soddalashtiradi.</small></label><button className="btn primary" onClick={() => save.mutate()}><Save/> Saqlash</button></section>
      <section className="panel settings-card"><div className="settings-title"><span><Database/></span><div><h2>Demo ma'lumot</h2><p>Production startup’da avtomatik yaratilmaydi</p></div></div><p className="settings-copy">Bu amal faqat qo‘lda bosilganda MOCK deklaratsiyalarni qayta yaratadi.</p><button className="btn danger" disabled={reset.isPending} onClick={() => confirm('Demo deklaratsiyalar qayta yaratilsinmi?') && reset.mutate()}><RefreshCw/> {reset.isPending ? 'Yangilanmoqda…' : 'Demo ma’lumotni yaratish'}</button></section>
      <section className="panel settings-card"><div className="settings-title"><span><ShieldCheck/></span><div><h2>Xavfsizlik</h2><p>Production nazorat ro'yxati</p></div></div><ul className="security-list"><li><KeyRound/><span><strong>HttpOnly sessiya</strong><small>Token frontend storage'ga yozilmaydi</small></span><b>Faol</b></li><li><ShieldCheck/><span><strong>CSRF va TOTP</strong><small>O‘zgartiruvchi so‘rov va 2FA</small></span><b>Faol</b></li><li><Server/><span><strong>CORS allowlist</strong><small>Faqat ruxsat etilgan domenlar</small></span><b>ENV</b></li></ul></section>
    </div><Toast toast={toast} onClose={() => setToast(null)}/>
  </AdminLayout>
}
