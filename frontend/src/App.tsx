import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { useAuth } from './auth'

const PublicMapPage = lazy(() => import('./pages/PublicMapPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'))
const PostsAdminPage = lazy(() => import('./pages/PostsAdminPage'))
const CorridorsAdminPage = lazy(() => import('./pages/CorridorsAdminPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))
const OperationsPage = lazy(() => import('./pages/OperationsPage'))
const InsightsPage = lazy(() => import('./pages/InsightsPage'))
const AccountPage = lazy(() => import('./pages/AccountPage'))

function Protected({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user, checked, check } = useAuth()
  const location = useLocation()
  useEffect(() => { if (!checked) void check() }, [check, checked])
  if (!checked) return <div className="screen-loader"><LoaderCircle className="spin" /> Sessiya tekshirilmoqda</div>
  if (!user) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  return roles && !roles.includes(user.role) ? <Navigate to="/admin" replace /> : children
}

export default function App() {
  return (
    <Suspense fallback={<div className="screen-loader"><LoaderCircle className="spin" /> Tizim yuklanmoqda</div>}>
      <Routes>
        <Route path="/" element={<PublicMapPage />} />
        <Route path="/admin/login" element={<LoginPage />} />
        <Route path="/admin" element={<Protected><AdminDashboardPage /></Protected>} />
        <Route path="/admin/posts" element={<Protected roles={['ADMIN','EDITOR']}><PostsAdminPage /></Protected>} />
        <Route path="/admin/corridors" element={<Protected roles={['ADMIN','EDITOR']}><CorridorsAdminPage /></Protected>} />
        <Route path="/admin/settings" element={<Protected roles={['ADMIN']}><SettingsPage /></Protected>} />
        <Route path="/admin/audit" element={<Protected roles={['ADMIN']}><AuditPage /></Protected>} />
        <Route path="/admin/operations" element={<Protected roles={['ADMIN','EDITOR']}><OperationsPage /></Protected>} />
        <Route path="/admin/insights" element={<Protected><InsightsPage /></Protected>} />
        <Route path="/admin/account" element={<Protected><AccountPage /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
