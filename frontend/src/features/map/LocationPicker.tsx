import { useEffect, useRef } from 'react'
import maplibregl, { Map, Marker } from 'maplibre-gl'
import { getMapStyle } from './mapStyle'

export default function LocationPicker({ latitude, longitude, onChange }: { latitude?: number; longitude?: number; onChange: (lat: number, lng: number) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const markerRef = useRef<Marker | null>(null)
  useEffect(() => {
    if (!container.current || mapRef.current) return
    const map = new maplibregl.Map({ container: container.current, style: getMapStyle(), center: longitude != null && latitude != null ? [longitude, latitude] : [64.6, 41.2], zoom: longitude != null ? 9 : 5 })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    const setMarker = (lng: number, lat: number) => {
      if (!markerRef.current) {
        markerRef.current = new maplibregl.Marker({ color: '#fb4058', draggable: true }).setLngLat([lng, lat]).addTo(map)
        markerRef.current.on('dragend', () => { const point = markerRef.current!.getLngLat(); onChange(point.lat, point.lng) })
      } else markerRef.current.setLngLat([lng, lat])
    }
    if (longitude != null && latitude != null) setMarker(longitude, latitude)
    map.on('click', (event) => { setMarker(event.lngLat.lng, event.lngLat.lat); onChange(event.lngLat.lat, event.lngLat.lng) })
    const resize = new ResizeObserver(() => map.resize()); resize.observe(container.current)
    return () => { resize.disconnect(); markerRef.current?.remove(); map.remove(); mapRef.current = null }
  }, [])
  return <div className="location-picker" ref={container} aria-label="Post lokatsiyasini xaritadan tanlash" />
}

