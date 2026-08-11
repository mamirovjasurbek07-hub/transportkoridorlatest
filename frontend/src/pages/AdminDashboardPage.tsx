import { useQuery } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import { Activity, AlertTriangle, Database, MapPinCheck, MapPinOff, MapPinned, Plus, RefreshCw, Route, Waypoints } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import AdminLayout from '../AdminLayout'

interface Dashboard { total_posts: number; located_posts: number; unlocated_posts: number; active_corridors: number; review_corridors: number; declarations: number }
type Metric = [string, number | undefined, ComponentType, string]

export default function AdminDashboardPage() {
  const query = useQuery({ queryKey: ['admin-dashboard'], queryFn: () => api<Dashboard>('/settings/dashboard') })
  const data = query.data
  const warning = sessionStorage.getItem('password-warning')
  return <AdminLayout title="Boshqaruv paneli" subtitle="Tizim holati va tezkor amallar" actions={<button className="btn ghost compact" onClick={() => query.refetch()}><RefreshCw size={16}/> Yangilash</button>}>
    {warning && <div className="admin-warning"><AlertTriangle/><span><strong>Standart parol ishlatilmoqda</strong><small>Production ishga tushgach parolni albatta almashtiring.</small></span><button onClick={() => {sessionStorage.removeItem('password-warning'); location.reload()}}>Tushunarli</button></div>}
    <div className="admin-kpis">
      {([['Jami postlar', data?.total_posts, MapPinned, 'blue'], ['Lokatsiyasi belgilangan', data?.located_posts, MapPinCheck, 'green'], ['Lokatsiyasiz postlar', data?.unlocated_posts, MapPinOff, 'amber'], ['Faol korridorlar', data?.active_corridors, Route, 'cyan'], ['Route review', data?.review_corridors, AlertTriangle, 'red'], ['Mock deklaratsiyalar', data?.declarations, Database, 'violet']] as Metric[]).map(([label, value, Icon, color]) => <article key={label} className={`admin-kpi ${color}`}><span><Icon/></span><div><p>{label}</p><strong>{value ?? '—'}</strong></div></article>)}
    </div>
    <div className="dashboard-grid"><section className="panel quick-actions"><div className="panel-heading"><div><Activity/><div><h2>Tezkor amallar</h2><p>Eng ko'p ishlatiladigan boshqaruvlar</p></div></div></div><div className="quick-grid"><Link to="/admin/posts?new=1"><span><Plus/></span><strong>Yangi post</strong><small>Kod va lokatsiya kiriting</small></Link><Link to="/admin/corridors?new=1"><span><Waypoints/></span><strong>Yangi korridor</strong><small>Waypoint va route yarating</small></Link><Link to="/admin/corridors"><span><Route/></span><strong>Route tekshiruvi</strong><small>Review holatlarini ko'ring</small></Link><Link to="/admin/audit"><span><Activity/></span><strong>Audit jurnali</strong><small>Admin harakatlari</small></Link></div></section><section className="panel system-status"><div className="panel-heading"><div><Database/><div><h2>Tizim holati</h2><p>Asosiy xizmatlar</p></div></div></div>{['Backend API', 'PostgreSQL / PostGIS', 'Mock analytics', 'Cookie himoyasi'].map((item) => <div className="status-row" key={item}><span><i/>{item}</span><b>Faol</b></div>)}</section></div>
  </AdminLayout>
}
