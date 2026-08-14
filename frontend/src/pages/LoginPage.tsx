import { useEffect, useState } from 'react'
import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { ApiError } from '../api'

export default function LoginPage() {
  const { user, login, loading, checked, check } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => { if (!checked) void check() }, [check, checked])
  if (!checked) return <div className="screen-loader"><LoaderCircle className="spin"/> Sessiya tekshirilmoqda</div>
  if (user) return <Navigate to="/admin" replace />
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    try {
      const result = await login(email, password)
      if (result.password_change_recommended) sessionStorage.setItem('password-warning', '1')
      navigate((location.state as { from?: string })?.from || '/admin', { replace: true })
    } catch (err) { setError(err instanceof ApiError ? err.message : "Login amalga oshmadi") }
  }
  return (
    <main className="login-page"><section className="login-visual"><div className="globe-rings"><span/><span/><span/><i/></div><div className="login-brand"><span className="brand-mark"><ShieldCheck /></span><p>O'ZBEKISTON RESPUBLIKASI</p><h1>Tranzit oqimlarini<br/><em>aniq boshqaring.</em></h1><span>Real yo'l geometriyasi, xavfsiz ma'muriy nazorat va yagona geoanalitik maydon.</span></div></section><section className="login-form-side"><form className="login-card" onSubmit={submit}><p className="eyebrow">XAVFSIZ KIRISH</p><h2>Ma'muriy boshqaruv</h2><p>Tizim sozlamalari va transport yo'laklarini boshqarish uchun kiring.</p><label><span>Email manzil</span><div className="input-wrap"><Mail size={18}/><input type="email" autoComplete="username" required placeholder="admin@example.uz" value={email} onChange={(e) => setEmail(e.target.value)}/></div></label><label><span>Parol</span><div className="input-wrap"><LockKeyhole size={18}/><input type={visible ? 'text' : 'password'} autoComplete="current-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}/><button type="button" onClick={() => setVisible((v) => !v)} aria-label="Parolni ko'rsatish">{visible ? <EyeOff/> : <Eye/>}</button></div></label>{error && <div className="form-error">{error}</div>}<button className="btn primary login-submit" disabled={loading}>{loading ? "Tekshirilmoqda…" : "Tizimga kirish"}<span>→</span></button><small className="security-note"><LockKeyhole/> Sessiya HttpOnly cookie orqali himoyalangan</small></form><a href="/" className="back-public">← Ommaviy xaritaga qaytish</a></section></main>
  )
}
