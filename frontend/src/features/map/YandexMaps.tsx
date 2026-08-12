import { useCallback, useEffect, useRef, useState } from 'react'
import { LocateFixed, Maximize2, Minimize2 } from 'lucide-react'
import type { FeatureCollection, Waypoint } from '../../types'
import { loadYandexMaps, safeHtml } from './mapProvider'

type AnyObject = Record<string, any>

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }

export function YandexTransitMap({ apiKey, posts = empty, corridors = empty, selectedId, onCorridorSelect, loading }: { apiKey: string; posts?: FeatureCollection; corridors?: FeatureCollection; selectedId?: string | null; onCorridorSelect?: (properties: Record<string, unknown> | null) => void; loading?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AnyObject | null>(null)
  const ymapsRef = useRef<AnyObject | null>(null)
  const corridorObjects = useRef<AnyObject | null>(null)
  const postObjects = useRef<AnyObject | null>(null)
  const [ready, setReady] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const fitUzbekistan = useCallback(() => mapRef.current?.setBounds([[36.6, 55.8], [45.7, 73.3]], { checkZoomRange: true, zoomMargin: 32 }), [])

  useEffect(() => {
    let live = true
    let observer: ResizeObserver | undefined
    void loadYandexMaps(apiKey).then((ymaps) => {
      if (!live || !containerRef.current) return
      ymapsRef.current = ymaps
      const map = new ymaps.Map(containerRef.current, { center: [41.2, 64.6], zoom: 5, controls: ['zoomControl'] }, { suppressMapOpenBlock: true })
      mapRef.current = map
      corridorObjects.current = new ymaps.GeoObjectCollection()
      postObjects.current = new ymaps.GeoObjectCollection()
      map.geoObjects.add(corridorObjects.current)
      map.geoObjects.add(postObjects.current)
      observer = new ResizeObserver(() => map.container.fitToViewport())
      observer.observe(containerRef.current)
      setReady(true)
    }).catch(() => setReady(false))
    return () => { live = false; observer?.disconnect(); mapRef.current?.destroy(); mapRef.current = null }
  }, [apiKey])

  useEffect(() => {
    const ymaps = ymapsRef.current
    const collection = corridorObjects.current
    if (!ready || !ymaps || !collection) return
    collection.removeAll()
    const bounds: number[][] = []
    for (const feature of corridors.features) {
      if (feature.geometry.type !== 'LineString') continue
      const properties = feature.properties || {}
      const coordinates = feature.geometry.coordinates.map(([lng, lat]) => [lat, lng])
      coordinates.forEach((point) => bounds.push(point))
      const selected = properties.id === selectedId
      const color = String(properties.color || '#22d3ee')
      const flow = Number(properties.declaration_count || 0)
      const width = flow >= 1000 ? 9 : flow >= 100 ? 7 : flow >= 10 ? 5 : 4
      const glow = new ymaps.Polyline(coordinates, {}, { strokeColor: color, strokeWidth: width + 9, strokeOpacity: .18 })
      const line = new ymaps.Polyline(coordinates, {}, { strokeColor: selected ? '#ffffff' : color, strokeWidth: selected ? width + 3 : width, strokeOpacity: 0.94 })
      line.events.add('click', () => onCorridorSelect?.(properties as Record<string, unknown>))
      glow.events.add('click', () => onCorridorSelect?.(properties as Record<string, unknown>))
      collection.add(glow); collection.add(line)
    }
    if (bounds.length) {
      const lats = bounds.map((p) => p[0]); const lngs = bounds.map((p) => p[1])
      mapRef.current?.setBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { checkZoomRange: true, zoomMargin: 70 })
    }
  }, [corridors, onCorridorSelect, ready, selectedId])

  useEffect(() => {
    const ymaps = ymapsRef.current
    const collection = postObjects.current
    if (!ready || !ymaps || !collection) return
    collection.removeAll()
    const clusterer = new ymaps.Clusterer({ preset: 'islands#darkBlueClusterIcons', groupByCoordinates: false })
    const placemarks: AnyObject[] = []
    for (const feature of posts.features) {
      if (feature.geometry.type !== 'Point') continue
      const [lng, lat] = feature.geometry.coordinates
      const p = feature.properties || {}
      const permissions = [p.allow_passenger_vehicles ? 'Yengil transport' : '', p.allow_cargo_vehicles ? 'Yuk transporti' : ''].filter(Boolean).join(' · ')
      const balloon = `<div class="map-popup"><small>${safeHtml(p.post_type)}</small><strong>${safeHtml(p.post_code)} · ${safeHtml(p.post_name)}</strong><span>Kirish: ${safeHtml(p.entry_count || 0)} · Chiqish: ${safeHtml(p.exit_count || 0)}</span>${p.post_type === 'CHBP' ? `<span>Ruxsat: ${safeHtml(permissions || 'Belgilanmagan')}</span>` : ''}<b>Jami oqim: ${safeHtml(p.total_flow || 0)}</b></div>`
      const preset = p.post_type === 'CHBP' ? 'islands#redCircleDotIcon' : p.post_type === 'PORT' ? 'islands#greenCircleDotIcon' : 'islands#blueCircleDotIcon'
      placemarks.push(new ymaps.Placemark([lat, lng], { balloonContent: balloon, hintContent: safeHtml(p.post_name) }, { preset }))
    }
    clusterer.add(placemarks); collection.add(clusterer)
  }, [posts, ready])

  useEffect(() => { if (ready) setTimeout(() => mapRef.current?.container.fitToViewport(), 0) }, [fullscreen, ready])
  return <div className={`transit-map ${fullscreen ? 'is-fullscreen' : ''}`}>
    <div ref={containerRef} className="map-canvas yandex-map" aria-label="Yandex xaritasidagi tranzit yo'laklari" />
    {loading && <div className="map-progress"><span /></div>}
    <div className="map-provider-badge">YANDEX MAPS</div>
    <div className="map-tools"><button onClick={fitUzbekistan} title="Barcha O'zbekiston"><LocateFixed size={18}/></button><button onClick={() => setFullscreen((v) => !v)} title="To'liq ekran">{fullscreen ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}</button></div>
    <div className="map-legend"><strong>OQIM ZICHLIGI</strong><span><i className="line low"/> Past</span><span><i className="line mid"/> O'rta</span><span><i className="line high"/> Yuqori</span></div>
  </div>
}

export function YandexRouteBuilderMap({ apiKey, waypoints, geometry, onAdd, onMove }: { apiKey: string; waypoints: Waypoint[]; geometry?: GeoJSON.LineString; onAdd: (lat: number, lng: number) => void; onMove: (index: number, lat: number, lng: number) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AnyObject | null>(null)
  const ymapsRef = useRef<AnyObject | null>(null)
  const objectsRef = useRef<AnyObject | null>(null)
  const onAddRef = useRef(onAdd); const onMoveRef = useRef(onMove)
  onAddRef.current = onAdd; onMoveRef.current = onMove
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true; let observer: ResizeObserver | undefined
    void loadYandexMaps(apiKey).then((ymaps) => {
      if (!live || !container.current) return
      ymapsRef.current = ymaps
      const map = new ymaps.Map(container.current, { center: [41.2, 64.6], zoom: 5, controls: ['zoomControl'] }, { suppressMapOpenBlock: true })
      mapRef.current = map; objectsRef.current = new ymaps.GeoObjectCollection(); map.geoObjects.add(objectsRef.current)
      map.events.add('click', (event: AnyObject) => { if (event.get('target') !== map) return; const [lat, lng] = event.get('coords'); onAddRef.current(lat, lng) })
      observer = new ResizeObserver(() => map.container.fitToViewport()); observer.observe(container.current); setReady(true)
    })
    return () => { live = false; observer?.disconnect(); mapRef.current?.destroy(); mapRef.current = null }
  }, [apiKey])
  useEffect(() => {
    const ymaps = ymapsRef.current; const objects = objectsRef.current
    if (!ready || !ymaps || !objects) return
    objects.removeAll()
    if (geometry) objects.add(new ymaps.Polyline(geometry.coordinates.map(([lng, lat]) => [lat, lng]), {}, { strokeColor: '#67e8f9', strokeWidth: 5, strokeOpacity: .96 }))
    waypoints.forEach((point, index) => {
      const fixed = point.waypoint_type === 'ENTRY_POST' || point.waypoint_type === 'EXIT_POST'
      const preset = fixed ? 'islands#redCircleIcon' : point.waypoint_type.includes('GATEWAY') ? 'islands#darkBlueCircleIcon' : 'islands#blueCircleIcon'
      const marker = new ymaps.Placemark([point.latitude, point.longitude], { iconContent: String(index + 1), hintContent: point.label || point.waypoint_type }, { preset, draggable: !fixed })
      marker.events.add('dragend', () => { const [lat, lng] = marker.geometry.getCoordinates(); onMoveRef.current(index, lat, lng) }); objects.add(marker)
    })
    const points = geometry?.coordinates.map(([lng, lat]) => [lat, lng]) || waypoints.map((w) => [w.latitude, w.longitude])
    if (points.length > 1) { const lats = points.map((p) => p[0]); const lngs = points.map((p) => p[1]); mapRef.current?.setBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { checkZoomRange: true, zoomMargin: 55 }) }
  }, [geometry, ready, waypoints])
  return <div ref={container} className="route-builder-map yandex-map" aria-label="Yandex xaritasida corridor nuqtalarini tahrirlash" />
}

export function YandexLocationPicker({ apiKey, latitude, longitude, onChange }: { apiKey: string; latitude?: number; longitude?: number; onChange: (lat: number, lng: number) => void }) {
  const container = useRef<HTMLDivElement>(null); const mapRef = useRef<AnyObject | null>(null); const markerRef = useRef<AnyObject | null>(null); const ymapsRef = useRef<AnyObject | null>(null); const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    let live = true; let observer: ResizeObserver | undefined
    void loadYandexMaps(apiKey).then((ymaps) => {
      if (!live || !container.current) return
      ymapsRef.current = ymaps
      const hasPoint = latitude != null && longitude != null
      const map = new ymaps.Map(container.current, { center: hasPoint ? [latitude, longitude] : [41.2, 64.6], zoom: hasPoint ? 9 : 5, controls: ['zoomControl'] }, { suppressMapOpenBlock: true })
      mapRef.current = map
      const setMarker = (lat: number, lng: number) => {
        if (!markerRef.current) { markerRef.current = new ymaps.Placemark([lat, lng], {}, { preset: 'islands#redCircleDotIcon', draggable: true }); markerRef.current.events.add('dragend', () => { const [nextLat, nextLng] = markerRef.current.geometry.getCoordinates(); onChangeRef.current(nextLat, nextLng) }); map.geoObjects.add(markerRef.current) } else markerRef.current.geometry.setCoordinates([lat, lng])
      }
      if (hasPoint) setMarker(latitude!, longitude!)
      map.events.add('click', (event: AnyObject) => { if (event.get('target') !== map) return; const [lat, lng] = event.get('coords'); setMarker(lat, lng); onChangeRef.current(lat, lng) })
      observer = new ResizeObserver(() => map.container.fitToViewport()); observer.observe(container.current)
    })
    return () => { live = false; observer?.disconnect(); mapRef.current?.destroy(); mapRef.current = null }
  }, [apiKey])
  useEffect(() => {
    const map = mapRef.current; const ymaps = ymapsRef.current
    if (!map || !ymaps || latitude == null || longitude == null) return
    if (!markerRef.current) {
      markerRef.current = new ymaps.Placemark([latitude, longitude], {}, { preset: 'islands#redCircleDotIcon', draggable: true })
      markerRef.current.events.add('dragend', () => { const [nextLat, nextLng] = markerRef.current.geometry.getCoordinates(); onChangeRef.current(nextLat, nextLng) })
      map.geoObjects.add(markerRef.current)
    } else markerRef.current.geometry.setCoordinates([latitude, longitude])
    map.setCenter([latitude, longitude], Math.max(map.getZoom(), 10), { duration: 500 })
  }, [latitude, longitude])
  return <div className="location-picker yandex-map" ref={container} aria-label="Yandex xaritasidan post lokatsiyasini tanlash" />
}
