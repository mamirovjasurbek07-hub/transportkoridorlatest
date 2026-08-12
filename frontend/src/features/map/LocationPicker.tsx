import { useEffect, useRef } from 'react'
import maplibregl, { Map, Marker } from 'maplibre-gl'
import { getMapStyle } from './mapStyle'

export default function LocationPicker({ latitude, longitude, onChange }: { latitude?: number; longitude?: number; onChange: (lat: number, lng: number) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    if (!container.current || mapRef.current) return
    const map = new maplibregl.Map({ container: container.current, style: getMapStyle(), center: longitude != null && latitude != null ? [longitude, latitude] : [64.6, 41.2], zoom: longitude != null ? 9 : 5 })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    const setMarker = (lng: number, lat: number) => {
      if (!markerRef.current) {
        markerRef.current = new maplibregl.Marker({ color: '#fb4058', draggable: true }).setLngLat([lng, lat]).addTo(map)
        markerRef.current.on('dragend', () => { const point = markerRef.current!.getLngLat(); onChangeRef.current(point.lat, point.lng) })
      } else markerRef.current.setLngLat([lng, lat])
    }
    map.on('click', (event) => { setMarker(event.lngLat.lng, event.lngLat.lat); onChangeRef.current(event.lngLat.lat, event.lngLat.lng) })
    const resize = new ResizeObserver(() => map.resize()); resize.observe(container.current)
    return () => { resize.disconnect(); markerRef.current?.remove(); map.remove(); mapRef.current = null }
  }, [])
  useEffect(() => {
    const map = mapRef.current
    if (!map || latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ color: '#fb4058', draggable: true }).setLngLat([longitude, latitude]).addTo(map)
      markerRef.current.on('dragend', () => { const point = markerRef.current!.getLngLat(); onChangeRef.current(point.lat, point.lng) })
    } else markerRef.current.setLngLat([longitude, latitude])
    map.easeTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 10), duration: 500 })
  }, [latitude, longitude])
  return <div className="location-picker" ref={container} aria-label="Post lokatsiyasini xaritadan tanlash" />
}
