import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, TrendingUp } from 'lucide-react'
import AdminLayout from '../AdminLayout'
import { api } from '../api'

export default function InsightsPage() {
  const [periods, setPeriods] = useState({ a_from: '2025-01-01', a_to: '2025-12-31', b_from: '2026-01-01', b_to: '2026-07-31' })
  const [applied, setApplied] = useState(periods)
  const query = useQuery({ queryKey: ['compare', applied], queryFn: () => api<any>(`/analytics/compare?${new URLSearchParams(applied)}`) })
  const cards = [['A davri', query.data?.period_a?.kpis], ['B davri', query.data?.period_b?.kpis]] as const
  return <AdminLayout title="Davrlar taqqoslanishi" subtitle="Oyma-oy, yilma-yil va tanlangan ikki davr tahlili">
    <section className="panel compare-controls"><label><span>A boshlanish</span><input type="date" value={periods.a_from} onChange={(e) => setPeriods({ ...periods, a_from: e.target.value })}/></label><label><span>A tugash</span><input type="date" value={periods.a_to} onChange={(e) => setPeriods({ ...periods, a_to: e.target.value })}/></label><label><span>B boshlanish</span><input type="date" value={periods.b_from} onChange={(e) => setPeriods({ ...periods, b_from: e.target.value })}/></label><label><span>B tugash</span><input type="date" value={periods.b_to} onChange={(e) => setPeriods({ ...periods, b_to: e.target.value })}/></label><button className="btn primary" onClick={() => setApplied(periods)}><BarChart3/> Taqqoslash</button></section>
    <div className="compare-grid">{cards.map(([name, data]) => <section className="panel compare-card" key={name}><p className="eyebrow">{name}</p><strong>{Number(data?.total_declarations || 0).toLocaleString('uz-UZ')}</strong><span>Deklaratsiyalar</span><small>O'rtacha tranzit: {data?.avg_transit_minutes || 0} daqiqa · Faol koridor: {data?.active_corridors || 0}</small></section>)}<section className="panel compare-card accent"><TrendingUp/><strong>{query.data?.change_percent ?? 0}%</strong><span>B davrining A ga nisbatan o'zgarishi</span></section></div>
  </AdminLayout>
}
