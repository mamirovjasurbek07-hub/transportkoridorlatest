import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileClock, Search } from 'lucide-react'
import { api } from '../api'
import AdminLayout from '../AdminLayout'

interface AuditItem { id: string; action: string; entity_type: string; entity_id?: string; ip_address?: string; created_at: string; before?: unknown; after?: unknown }

export default function AuditPage() {
  const [search, setSearch] = useState('')
  const query = useQuery({ queryKey: ['audit'], queryFn: () => api<{ items: AuditItem[]; total: number }>('/audit?page_size=200') })
  const rows = query.data?.items.filter((r) => `${r.action} ${r.entity_type} ${r.entity_id}`.toLowerCase().includes(search.toLowerCase())) || []
  return <AdminLayout title="Audit jurnali" subtitle={`${query.data?.total ?? 0} ta qayd · admin harakatlari o'zgarmas tarixda`}><section className="panel table-panel"><div className="table-toolbar"><div className="input-wrap search-input"><Search/><input placeholder="Harakat yoki obyektni qidiring" value={search} onChange={(e) => setSearch(e.target.value)}/></div></div><div className="responsive-table"><table><thead><tr><th>Sana va vaqt</th><th>Harakat</th><th>Obyekt</th><th>ID</th><th>IP manzil</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString('uz-UZ')}</td><td><span className="audit-action">{row.action}</span></td><td>{row.entity_type}</td><td><code>{row.entity_id || '—'}</code></td><td>{row.ip_address || '—'}</td></tr>)}</tbody></table>{!rows.length && <div className="empty-state"><FileClock/><strong>Audit qaydi topilmadi</strong></div>}</div></section></AdminLayout>
}
