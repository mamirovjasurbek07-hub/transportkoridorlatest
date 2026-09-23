import { useDeferredValue, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileClock, Search } from 'lucide-react'
import { api, API_BASE } from '../api'
import AdminLayout from '../AdminLayout'

interface AuditItem { id: string; action: string; entity_type: string; entity_id?: string; ip_address?: string; user_agent?: string; created_at: string }
const actionLabels: Record<string, string> = { PUBLIC_VISIT: 'Saytga tashrif', ADMIN_PAGE_VISIT: 'Admin sahifasiga tashrif', ADMIN_ACCESS_DENIED: 'Admin kirishi rad etildi', LOGIN_FAILED: 'Login muvaffaqiyatsiz', LOGIN_SUCCESS: 'Admin kirdi', LOGOUT: 'Admin chiqdi', IMPORT: 'Ma’lumot importi', PASSWORD_CHANGED: 'Parol o‘zgardi', TOTP_ENABLED: '2FA yoqildi', TOTP_DISABLED: '2FA o‘chirildi' }

export default function AuditPage() {
  const [search, setSearch] = useState(''); const [action, setAction] = useState(''); const deferred = useDeferredValue(search)
  const params = new URLSearchParams({ page_size: '100' }); if (deferred.trim()) params.set('search', deferred.trim()); if (action) params.set('action', action)
  const query = useQuery({ queryKey: ['audit', deferred, action], queryFn: () => api<{ items: AuditItem[]; total: number }>(`/audit?${params}`) })
  const rows = query.data?.items || []
  return <AdminLayout title="Audit jurnali" subtitle={`${query.data?.total ?? 0} ta mos qayd · server-side qidiruv`} actions={<a className="btn ghost compact" href={`${API_BASE}/audit/export.csv?${params}`}><Download/> CSV</a>}>
    <section className="panel table-panel">
      <div className="table-toolbar"><div className="input-wrap search-input"><Search/><input placeholder="Harakat, email, IP yoki brauzerni qidiring" value={search} onChange={(e) => setSearch(e.target.value)}/></div><select value={action} onChange={(e) => setAction(e.target.value)}><option value="">Barcha harakatlar</option><option value="LOGIN_FAILED">Xato loginlar</option><option value="LOGIN_SUCCESS">Muvaffaqiyatli login</option><option value="PUBLIC_VISIT">Tashriflar</option><option value="IMPORT">Importlar</option></select></div>
      <div className="responsive-table"><table><thead><tr><th>Sana va vaqt</th><th>Harakat</th><th>Obyekt / foydalanuvchi</th><th>IP manzil</th><th>Brauzer</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString('uz-UZ')}</td><td><span className="audit-action">{actionLabels[row.action] || row.action}</span></td><td><small>{row.entity_type}</small><br/><code>{row.entity_id || '—'}</code></td><td>{row.ip_address || '—'}</td><td title={row.user_agent || ''}>{row.user_agent || '—'}</td></tr>)}</tbody></table>{!rows.length && <div className="empty-state"><FileClock/><strong>Audit qaydi topilmadi</strong></div>}</div>
    </section>
  </AdminLayout>
}
