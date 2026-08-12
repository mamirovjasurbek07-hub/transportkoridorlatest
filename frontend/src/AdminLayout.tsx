import { Activity, Database, FileClock, LogOut, MapPinned, Settings, Shield, Waypoints } from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from './auth'

const links = [
  { to: '/admin', label: 'Boshqaruv paneli', icon: Activity, end: true },
  { to: '/admin/posts', label: 'Bojxona postlari', icon: MapPinned },
  { to: '/admin/corridors', label: 'Korridorlar', icon: Waypoints },
  { to: '/admin/audit', label: 'Audit jurnali', icon: FileClock },
  { to: '/admin/settings', label: 'Sozlamalar', icon: Settings },
]

export default function AdminLayout({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span className="brand-mark"><Shield /></span><span>TRANZIT<small>GEOANALITIKA</small></span></div>
        <nav>{links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end}><Icon size={19} />{label}</NavLink>)}</nav>
        <div className="sidebar-system"><Database size={16} /><span>Ma'lumotlar tizimi<small>PostGIS · faol</small></span></div>
        <button className="sidebar-user" onClick={async () => { await logout(); navigate('/admin/login') }}>
          <span><strong>{user?.email}</strong><small>{user?.role}</small></span><LogOut size={18} />
        </button>
      </aside>
      <main className="admin-main">
        <header className="admin-header"><div><p className="eyebrow">MA'MURIY BOSHQARUV</p><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="header-actions">{actions}</div></header>
        <div className="admin-content">{children}</div>
      </main>
    </div>
  )
}
