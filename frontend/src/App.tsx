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

function Protected({ children }: { children: React.ReactNode }) {
  const { user, checked, check } = useAuth()
  const location = useLocation()
  useEffect(() => { if (!checked) void check() }, [check, checked])
  if (!checked) return <div className="screen-loader"><LoaderCircle className="spin" /> Sessiya tekshirilmoqda</div>
  return user ? children : <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
}

export default function App() {
  return (
    <Suspense fallback={<div className="screen-loader"><LoaderCircle className="spin" /> Tizim yuklanmoqda</div>}>
      <Routes>
        <Route path="/" element={<PublicMapPage />} />
        <Route path="/admin/login" element={<LoginPage />} />
        <Route path="/admin" element={<Protected><AdminDashboardPage /></Protected>} />
        <Route path="/admin/posts" element={<Protected><PostsAdminPage /></Protected>} />
        <Route path="/admin/corridors" element={<Protected><CorridorsAdminPage /></Protected>} />
        <Route path="/admin/settings" element={<Protected><SettingsPage /></Protected>} />
        <Route path="/admin/audit" element={<Protected><AuditPage /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
