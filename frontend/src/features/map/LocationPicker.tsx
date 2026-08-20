import { useEffect, useRef } from 'react'
import maplibregl, { Map, Marker } from 'maplibre-gl'
import { getMapStyle } from './mapStyle'
import { useMapProvider } from './mapProvider'
import { YandexLocationPicker } from './YandexMaps'

type Props = { latitude?: number; longitude?: number; onChange: (lat: number, lng: number) => void }

function MapLibreLocationPicker({ latitude, longitude, onChange }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const onChangeRef = useRef(onChange)
  const internalChangeRef = useRef(false)
  onChangeRef.current = onChange
  useEffect(() => {
    if (!container.current || mapRef.current) return
    const map = new maplibregl.Map({ container: container.current, style: getMapStyle(), center: longitude != null && latitude != null ? [longitude, latitude] : [64.6, 41.2], zoom: longitude != null ? 9 : 5 })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    const setMarker = (lng: number, lat: number) => {
      if (!markerRef.current) {
        markerRef.current = new maplibregl.Marker({ color: '#fb4058', draggable: true }).setLngLat([lng, lat]).addTo(map)
        markerRef.current.on('dragend', () => { const point = markerRef.current!.getLngLat(); internalChangeRef.current = true; onChangeRef.current(point.lat, point.lng) })
      } else markerRef.current.setLngLat([lng, lat])
    }
    map.on('click', (event) => { setMarker(event.lngLat.lng, event.lngLat.lat); internalChangeRef.current = true; onChangeRef.current(event.lngLat.lat, event.lngLat.lng) })
    let timer = 0; let width = Math.round(container.current.getBoundingClientRect().width); let height = Math.round(container.current.getBoundingClientRect().height)
    const resize = new ResizeObserver(([entry]) => { const nextWidth = Math.round(entry.contentRect.width); const nextHeight = Math.round(entry.contentRect.height); if (Math.abs(nextWidth - width) < 3 && Math.abs(nextHeight - height) < 3) return; width = nextWidth; height = nextHeight; window.clearTimeout(timer); timer = window.setTimeout(() => map.resize(), 140) }); resize.observe(container.current)
    return () => { resize.disconnect(); window.clearTimeout(timer); markerRef.current?.remove(); map.remove(); mapRef.current = null }
  }, [])
  useEffect(() => {
    const map = mapRef.current
    if (!map || latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ color: '#fb4058', draggable: true }).setLngLat([longitude, latitude]).addTo(map)
      markerRef.current.on('dragend', () => { const point = markerRef.current!.getLngLat(); internalChangeRef.current = true; onChangeRef.current(point.lat, point.lng) })
    } else markerRef.current.setLngLat([longitude, latitude])
    if (internalChangeRef.current) internalChangeRef.current = false
    else map.jumpTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 10) })
  }, [latitude, longitude])
  return <div className="location-picker" ref={container} aria-label="Post lokatsiyasini xaritadan tanlash" />
}

export default function LocationPicker(props: Props) {
  const config = useMapProvider()
  if (config?.provider === 'yandex' && config.yandex_maps_api_key) return <YandexLocationPicker apiKey={config.yandex_maps_api_key} {...props}/>
  return <MapLibreLocationPicker {...props}/>
}
