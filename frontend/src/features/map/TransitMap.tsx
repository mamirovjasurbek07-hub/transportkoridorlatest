import { useCallback, useEffect, useRef, useState } from 'react'
import bbox from '@turf/bbox'
import maplibregl, { GeoJSONSource, Map, MapLayerMouseEvent, Popup } from 'maplibre-gl'
import { LocateFixed, Maximize2, Minimize2 } from 'lucide-react'
import type { FeatureCollection } from '../../types'
import { getMapStyle } from './mapStyle'

interface Props {
  posts?: FeatureCollection
  corridors?: FeatureCollection
  selectedId?: string | null
  onCorridorSelect?: (properties: Record<string, unknown> | null) => void
  loading?: boolean
}

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }

export default function TransitMap({ posts = empty, corridors = empty, selectedId, onCorridorSelect, loading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const popupRef = useRef<Popup | null>(null)
  const frameRef = useRef<number>(0)
  const [ready, setReady] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const fitUzbekistan = useCallback(() => mapRef.current?.fitBounds([[55.8, 36.6], [73.3, 45.7]], { padding: 32, duration: 700 }), [])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({ container: containerRef.current, style: getMapStyle(), center: [64.6, 41.2], zoom: 5.2, minZoom: 3, maxZoom: 15, attributionControl: false })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.on('load', () => {
      map.addSource('corridors', { type: 'geojson', data: empty })
      map.addLayer({ id: 'corridor-glow', type: 'line', source: 'corridors', paint: { 'line-color': ['coalesce', ['get', 'color'], '#22d3ee'], 'line-width': ['interpolate', ['linear'], ['get', 'declaration_count'], 1, 7, 100, 13, 1000, 25], 'line-offset': ['coalesce', ['get', 'display_offset'], 0], 'line-blur': 8, 'line-opacity': 0.46 } })
      map.addLayer({ id: 'corridor-core', type: 'line', source: 'corridors', paint: { 'line-color': ['coalesce', ['get', 'color'], '#22d3ee'], 'line-width': ['interpolate', ['linear'], ['get', 'declaration_count'], 1, 2.5, 100, 5, 1000, 12], 'line-offset': ['coalesce', ['get', 'display_offset'], 0], 'line-opacity': 1 } })
      map.addLayer({ id: 'corridor-flow', type: 'line', source: 'corridors', paint: { 'line-color': '#f5feff', 'line-width': ['interpolate', ['linear'], ['get', 'declaration_count'], 1, 1, 1000, 2.8], 'line-offset': ['coalesce', ['get', 'display_offset'], 0], 'line-opacity': 0.96, 'line-dasharray': [0.8, 2.3] } })
      map.addLayer({ id: 'selected-corridor', type: 'line', source: 'corridors', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-offset': ['coalesce', ['get', 'display_offset'], 0], 'line-opacity': 1 } })
      map.addSource('posts', { type: 'geojson', data: empty, cluster: true, clusterRadius: 48, clusterMaxZoom: 8 })
      map.addLayer({ id: 'post-clusters', type: 'circle', source: 'posts', filter: ['has', 'point_count'], paint: { 'circle-color': '#102f4f', 'circle-radius': ['step', ['get', 'point_count'], 16, 10, 21, 30, 27], 'circle-stroke-width': 2, 'circle-stroke-color': '#38bdf8' } })
      map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'posts', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 }, paint: { 'text-color': '#e8f7ff' } })
      map.addLayer({ id: 'post-points', type: 'circle', source: 'posts', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['match', ['get', 'post_type'], 'CHBP', '#fb4058', 'AERO', '#fbbf24', 'RW', '#a78bfa', 'PORT', '#34d399', '#38bdf8'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 8], 'circle-stroke-width': 2, 'circle-stroke-color': '#e8fdff' } })

      const corridorClick = (event: MapLayerMouseEvent) => onCorridorSelect?.((event.features?.[0]?.properties || null) as Record<string, unknown> | null)
      map.on('click', 'corridor-core', corridorClick)
      map.on('mouseenter', 'corridor-core', () => { map.getCanvas().style.cursor = 'pointer'; map.setPaintProperty('corridor-glow', 'line-opacity', 0.7) })
      map.on('mouseleave', 'corridor-core', () => { map.getCanvas().style.cursor = ''; map.setPaintProperty('corridor-glow', 'line-opacity', 0.46) })
      map.on('click', 'post-points', (event) => {
        const feature = event.features?.[0]
        if (!feature || feature.geometry.type !== 'Point') return
        const p = feature.properties || {}
        popupRef.current?.remove()
        const permissions = [p.allow_passenger_vehicles ? 'Yengil transport' : '', p.allow_cargo_vehicles ? 'Yuk transporti' : ''].filter(Boolean).join(' · ')
        popupRef.current = new maplibregl.Popup({ offset: 12, className: 'transit-popup' }).setLngLat(feature.geometry.coordinates as [number, number]).setHTML(`<div class="map-popup"><small>${p.post_type || ''}</small><strong>${p.post_code} · ${p.post_name}</strong><span>Kirish: ${p.entry_count || 0} · Chiqish: ${p.exit_count || 0}</span>${p.post_type === 'CHBP' ? `<span>Ruxsat: ${permissions || 'Belgilanmagan'}</span>` : ''}<b>Jami oqim: ${p.total_flow || 0}</b></div>`).addTo(map)
      })
      map.on('click', 'post-clusters', async (event) => {
        const feature = event.features?.[0]
        const clusterId = feature?.properties?.cluster_id
        if (feature?.geometry.type !== 'Point' || clusterId == null) return
        const zoom = await (map.getSource('posts') as GeoJSONSource).getClusterExpansionZoom(clusterId)
        map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom })
      })
      setReady(true)
    })
    const resize = new ResizeObserver(() => map.resize())
    resize.observe(containerRef.current)
    return () => { resize.disconnect(); cancelAnimationFrame(frameRef.current); popupRef.current?.remove(); map.remove(); mapRef.current = null }
  }, [onCorridorSelect])

  useEffect(() => { if (ready) (mapRef.current?.getSource('posts') as GeoJSONSource)?.setData(posts) }, [posts, ready])
  useEffect(() => {
    if (!ready) return
    ;(mapRef.current?.getSource('corridors') as GeoJSONSource)?.setData(corridors)
    if (corridors.features.length) {
      const bounds = bbox(corridors) as [number, number, number, number]
      mapRef.current?.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 70, duration: 600, maxZoom: 8 })
    }
  }, [corridors, ready])
  useEffect(() => { if (ready) mapRef.current?.setFilter('selected-corridor', ['==', ['get', 'id'], selectedId || '']) }, [selectedId, ready])
  useEffect(() => {
    if (!ready || window.matchMedia('(prefers-reduced-motion: reduce)').matches || corridors.features.length > 100) return
    let phase = 0
    const animate = () => {
      if (!document.hidden) { phase = (phase + 0.04) % 3.1; mapRef.current?.setPaintProperty('corridor-flow', 'line-dasharray', [0.7 + phase, 2.4, Math.max(0.1, 3.1 - phase), 0.1]) }
      frameRef.current = requestAnimationFrame(animate)
    }
    frameRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameRef.current)
  }, [ready, corridors.features.length])

  return (
    <div className={`transit-map ${fullscreen ? 'is-fullscreen' : ''}`}>
      <div ref={containerRef} className="map-canvas" aria-label="O'zbekiston tranzit yo'laklari xaritasi" />
      {loading && <div className="map-progress"><span /></div>}
      <div className="map-tools">
        <button onClick={fitUzbekistan} title="Barcha O'zbekiston"><LocateFixed size={18} /></button>
        <button onClick={() => setFullscreen((v) => !v)} title="To'liq ekran">{fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
      </div>
      <div className="map-legend"><strong>OQIM ZICHLIGI</strong><span><i className="line low" /> Past</span><span><i className="line mid" /> O'rta</span><span><i className="line high" /> Yuqori</span></div>
    </div>
  )
}
