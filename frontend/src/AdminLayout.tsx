import { Activity, BarChart3, Database, FileClock, LogOut, Map as MapIcon, MapPinned, Settings, Shield, UserCog, Waypoints, Workflow } from 'lucide-react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from './auth'

const links = [
  { to: '/admin', label: 'Boshqaruv paneli', icon: Activity, end: true, roles: ['ADMIN','EDITOR','VIEWER'] },
  { to: '/admin/posts', label: 'Bojxona postlari', icon: MapPinned, roles: ['ADMIN','EDITOR'] },
  { to: '/admin/corridors', label: 'Korridorlar', icon: Waypoints, roles: ['ADMIN','EDITOR'] },
  { to: '/admin/insights', label: 'Taqqoslash', icon: BarChart3, roles: ['ADMIN','EDITOR','VIEWER'] },
  { to: '/admin/operations', label: 'Operatsiyalar', icon: Workflow, roles: ['ADMIN','EDITOR'] },
  { to: '/admin/audit', label: 'Audit jurnali', icon: FileClock, roles: ['ADMIN'] },
  { to: '/admin/settings', label: 'Sozlamalar', icon: Settings, roles: ['ADMIN'] },
  { to: '/admin/account', label: 'Hisoblar', icon: UserCog, roles: ['ADMIN','EDITOR','VIEWER'] },
]

export default function AdminLayout({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span className="brand-mark"><Shield /></span><span>TRANZIT<small>GEOANALITIKA</small></span></div>
        <nav>{links.filter((item) => item.roles.includes(user?.role || '')).map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end}><Icon size={19} />{label}</NavLink>)}</nav>
        <div className="sidebar-system"><Database size={16} /><span>Ma'lumotlar tizimi<small>PostGIS · faol</small></span></div>
        <button className="sidebar-user" onClick={async () => { await logout(); navigate('/admin/login') }}>
          <span><strong>{user?.email}</strong><small>{user?.role}</small></span><LogOut size={18} />
        </button>
      </aside>
      <main className="admin-main">
        <header className="admin-header"><div><p className="eyebrow">MA'MURIY BOSHQARUV</p><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="header-actions"><Link className="btn ghost compact admin-public-return" to="/"><MapIcon size={16}/><span>Bosh sahifa</span></Link>{actions}</div></header>
        <div className="admin-content">{children}</div>
      </main>
    </div>
  )
}
