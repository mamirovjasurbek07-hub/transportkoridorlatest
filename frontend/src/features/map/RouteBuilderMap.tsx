import { useEffect, useRef } from 'react'
import maplibregl, { GeoJSONSource, Map, Marker } from 'maplibre-gl'
import type { CustomsPost, Waypoint } from '../../types'
import { getMapStyle } from './mapStyle'
import { useMapProvider } from './mapProvider'
import { YandexRouteBuilderMap } from './YandexMaps'

type Props = { waypoints: Waypoint[]; geometry?: GeoJSON.LineString; posts?: CustomsPost[]; onAdd: (lat: number, lng: number) => void; onMove: (index: number, lat: number, lng: number) => void; onPostSelect?: (post: CustomsPost) => void }

function MapLibreRouteBuilderMap({ waypoints, geometry, posts = [], onAdd, onMove, onPostSelect }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const markers = useRef<Marker[]>([])
  const onAddRef = useRef(onAdd)
  const onMoveRef = useRef(onMove)
  const onPostSelectRef = useRef(onPostSelect)
  onAddRef.current = onAdd; onMoveRef.current = onMove
  onPostSelectRef.current = onPostSelect
  useEffect(() => {
    if (!container.current || mapRef.current) return
    const map = new maplibregl.Map({ container: container.current, style: getMapStyle(), center: [64.6, 41.2], zoom: 5 })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => { map.addSource('preview-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }); map.addLayer({ id: 'preview-glow', type: 'line', source: 'preview-route', paint: { 'line-color': '#22d3ee', 'line-width': 12, 'line-blur': 9, 'line-opacity': 0.35 } }); map.addLayer({ id: 'preview-core', type: 'line', source: 'preview-route', paint: { 'line-color': '#67e8f9', 'line-width': 4 } }) })
    map.on('click', (event) => onAddRef.current(event.lngLat.lat, event.lngLat.lng))
    const resize = new ResizeObserver(() => map.resize()); resize.observe(container.current)
    return () => { resize.disconnect(); markers.current.forEach((m) => m.remove()); map.remove(); mapRef.current = null }
  }, [])
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markers.current.forEach((m) => m.remove()); markers.current = []
    posts.filter((post) => post.latitude != null && post.longitude != null).forEach((post) => {
      const element = document.createElement('button'); element.type = 'button'; element.className = `post-map-marker ${post.post_type.toLowerCase()}`; element.title = `${post.post_code} · ${post.post_name}`
      element.addEventListener('click', (event) => { event.stopPropagation(); onPostSelectRef.current?.(post) })
      markers.current.push(new maplibregl.Marker({ element }).setLngLat([post.longitude!, post.latitude!]).addTo(map))
    })
    waypoints.forEach((point, index) => {
      const element = document.createElement('div'); element.className = `waypoint-marker ${point.waypoint_type.toLowerCase()}`; element.textContent = String(index + 1)
      const marker = new maplibregl.Marker({ element, draggable: !point.post_code }).setLngLat([point.longitude, point.latitude]).addTo(map)
      marker.on('dragend', () => { const p = marker.getLngLat(); onMoveRef.current(index, p.lat, p.lng) }); markers.current.push(marker)
    })
  }, [posts, waypoints])
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const update = () => (map.getSource('preview-route') as GeoJSONSource)?.setData(geometry ? { type: 'Feature', properties: {}, geometry } : { type: 'FeatureCollection', features: [] })
    if (map.isStyleLoaded()) update(); else map.once('load', update)
  }, [geometry])
  return <div ref={container} className="route-builder-map" aria-label="Korridor waypointlarini tahrirlash xaritasi" />
}

export default function RouteBuilderMap(props: Props) {
  const config = useMapProvider()
  if (config?.provider === 'yandex' && config.yandex_maps_api_key) return <YandexRouteBuilderMap apiKey={config.yandex_maps_api_key} {...props}/>
  return <MapLibreRouteBuilderMap {...props}/>
}
