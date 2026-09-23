import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileClock, Search } from 'lucide-react'
import { api } from '../api'
import AdminLayout from '../AdminLayout'

interface AuditItem { id: string; action: string; entity_type: string; entity_id?: string; ip_address?: string; user_agent?: string; created_at: string; before?: unknown; after?: unknown }

const actionLabels: Record<string, string> = {
  PUBLIC_VISIT: 'Saytga tashrif',
  ADMIN_PAGE_VISIT: 'Admin sahifasiga tashrif',
  ADMIN_ACCESS_DENIED: 'Admin kirishi rad etildi',
  ADMIN_SESSION_USED: 'Admin sessiyasi ochildi',
  LOGIN_FAILED: 'Login muvaffaqiyatsiz',
  LOGIN_SUCCESS: 'Admin kirdi',
  LOGIN: 'Admin kirdi',
  LOGOUT: 'Admin chiqdi',
}

export default function AuditPage() {
  const [search, setSearch] = useState('')
  const query = useQuery({ queryKey: ['audit'], queryFn: () => api<{ items: AuditItem[]; total: number }>('/audit?page_size=200') })
  const rows = query.data?.items.filter((r) => `${r.action} ${actionLabels[r.action] || ''} ${r.entity_type} ${r.entity_id} ${r.ip_address} ${r.user_agent}`.toLowerCase().includes(search.toLowerCase())) || []
  return <AdminLayout title="Audit jurnali" subtitle={`${query.data?.total ?? 0} ta qayd · tashriflar, loginlar va admin harakatlari`}><section className="panel table-panel"><div className="table-toolbar"><div className="input-wrap search-input"><Search/><input placeholder="Harakat, email, IP yoki brauzerni qidiring" value={search} onChange={(e) => setSearch(e.target.value)}/></div></div><div className="responsive-table"><table><thead><tr><th>Sana va vaqt</th><th>Harakat</th><th>Obyekt / sahifa / foydalanuvchi</th><th>IP manzil</th><th>Brauzer</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString('uz-UZ')}</td><td><span className="audit-action">{actionLabels[row.action] || row.action}</span></td><td><small>{row.entity_type}</small><br/><code>{row.entity_id || '—'}</code></td><td>{row.ip_address || '—'}</td><td title={row.user_agent || ''}>{row.user_agent || '—'}</td></tr>)}</tbody></table>{!rows.length && <div className="empty-state"><FileClock/><strong>Audit qaydi topilmadi</strong></div>}</div></section></AdminLayout>
}
