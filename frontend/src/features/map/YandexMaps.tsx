import { useCallback, useEffect, useRef, useState } from 'react'
import { LocateFixed, Maximize2, Minimize2 } from 'lucide-react'
import type { CustomsPost, FeatureCollection, Waypoint } from '../../types'
import { getUzbekistanBorder, loadYandexMaps, safeHtml } from './mapProvider'

type AnyObject = Record<string, any>

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }

function observeMapSize(container: HTMLElement, map: AnyObject, isAlive: () => boolean): () => void {
  let timer = 0
  let width = Math.round(container.getBoundingClientRect().width)
  let height = Math.round(container.getBoundingClientRect().height)
  const observer = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect
    if (!rect) return
    const nextWidth = Math.round(rect.width); const nextHeight = Math.round(rect.height)
    if (Math.abs(nextWidth - width) < 3 && Math.abs(nextHeight - height) < 3) return
    width = nextWidth; height = nextHeight
    window.clearTimeout(timer)
    timer = window.setTimeout(() => { if (isAlive()) map.container.fitToViewport() }, 140)
  })
  observer.observe(container)
  return () => { window.clearTimeout(timer); observer.disconnect() }
}

function numberText(value: unknown, digits = 0): string {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return '0'
  const fixed = digits > 0 ? number.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '') : Math.round(number).toString()
  const [whole, fraction] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return fraction ? `${grouped}.${fraction}` : grouped
}

function moneyText(value: unknown): string {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return '0 so‘m'
  if (amount >= 1_000_000_000_000) return `${numberText(amount / 1_000_000_000_000, 2)} trln so‘m`
  if (amount >= 1_000_000_000) return `${numberText(amount / 1_000_000_000, 1)} mlrd so‘m`
  if (amount >= 1_000_000) return `${numberText(amount / 1_000_000, 1)} mln so‘m`
  return `${numberText(amount)} so‘m`
}

function categoryText(value: unknown): string {
  const labels: Record<string, string> = { EXTRA: 'Toifadan tashqari', FIRST: 'Birinchi toifa', SECOND: 'Ikkinchi toifa', UNASSIGNED: 'Toifa belgilanmagan' }
  return labels[String(value)] || 'Toifa belgilanmagan'
}

export function postStatisticsHtml(p: Record<string, any>): string {
  const type = String(p.post_type || '')
  const accent = type === 'CHBP' ? '#ff4964' : type === 'AERO' ? '#f5b942' : type === 'TIF' ? '#a78bfa' : type === 'PORT' ? '#35d3a1' : '#36bff2'
  const rating = Math.max(0, Math.min(100, Math.round(Number(p.ranking_score || 0))))
  const card = (icon: string, label: string, value: string, tone = '') => `<article class="passport-stat ${tone}"><i>${safeHtml(icon)}</i><span><small>${safeHtml(label)}</small><strong>${safeHtml(value)}</strong></span></article>`
  const flowRow = (icon: string, label: string, entry: unknown, exit: unknown) => `<div class="passport-flow-row"><i>${safeHtml(icon)}</i><strong>${safeHtml(label)}</strong><b>${safeHtml(numberText(entry))}</b><b>${safeHtml(numberText(exit))}</b></div>`
  const commonCards = [
    card('⚖', 'Ma’muriy holatlar', numberText(p.administrative_offenses), 'warning'),
    card('§', 'Jinoiy ishlar', numberText(p.criminal_cases), 'danger'),
    card('◆', 'Giyohvandlik vositalari', `${numberText(p.narcotics_kg, 3)} kg`, 'violet'),
  ]
  let mainContent = ''
  if (type === 'TIF') {
    mainContent = `<section class="passport-stat-grid financial">${[
      card('₽', 'Undirilgan bojxona to‘lovlari', moneyText(p.customs_payments), 'money'),
      card('▤', 'Rasmiylashtirilgan holatlar', numberText(p.cases_count), 'primary'),
      card('+', 'Qo‘shimcha undirilgan', moneyText(p.additional_customs_payments), 'success'),
      ...commonCards,
    ].join('')}</section>`
  } else {
    const flowRows = type === 'AERO'
      ? [flowRow('●', 'Fuqarolar', p.citizens_entry, p.citizens_exit)]
      : type === 'RW'
        ? [
            flowRow('□', 'Bo‘sh vagonlar', p.empty_wagons_entry, p.empty_wagons_exit),
            flowRow('■', 'Yukli vagonlar', p.loaded_wagons_entry, p.loaded_wagons_exit),
            flowRow('●', 'Fuqarolar', p.citizens_entry, p.citizens_exit),
          ]
        : type === 'CHBP'
          ? [
              flowRow('▣', 'Jami avtotransport', p.vehicles_entry, p.vehicles_exit),
              flowRow('▰', 'Yuk avtotransport', p.cargo_vehicles_entry, p.cargo_vehicles_exit),
              flowRow('◇', 'Yengil avtotransport', p.light_vehicles_entry, p.light_vehicles_exit),
              flowRow('●', 'Fuqarolar', p.citizens_entry, p.citizens_exit),
            ]
          : [flowRow('▣', 'Avtotransport', p.vehicles_entry, p.vehicles_exit), flowRow('●', 'Fuqarolar', p.citizens_entry, p.citizens_exit)]
    const specificCards = type === 'AERO'
      ? [card('◎', 'Shaxsiy ko‘riklar', numberText(p.personal_inspections), 'primary')]
      : [card('◈', 'Bojxona ko‘riklari', numberText(p.customs_inspections), 'primary')]
    mainContent = `<section class="passport-flow"><div class="passport-flow-head"><span>HARAKAT KO‘RSATKICHI</span><b>↙ KIRISH</b><b>↗ CHIQISH</b></div>${flowRows.join('')}</section><section class="passport-stat-grid">${[...specificCards, ...commonCards].join('')}</section>`
  }
  const permissions = type === 'CHBP' ? `<span class="passport-permission">${p.allow_passenger_vehicles ? '✓ Yengil' : ''}${p.allow_passenger_vehicles && p.allow_cargo_vehicles ? ' · ' : ''}${p.allow_cargo_vehicles ? '✓ Yuk' : ''}</span>` : ''
  return `<div class="post-passport" data-post-id="${safeHtml(p.id)}" style="--post-accent:${accent};--post-score:${rating * 3.6}deg"><button type="button" class="passport-close" aria-label="Post pasportini yopish">×</button><header><div class="passport-heading"><span class="passport-emblem">⌖</span><div><small>BOJXONA POSTI PASPORTI</small><div><b>${safeHtml(type)}</b><em>${safeHtml(categoryText(p.post_category))}</em>${permissions}</div></div></div><div class="passport-score"><strong>${rating}</strong><small>UMUMIY BALL</small></div><h3>${safeHtml(p.post_name)}</h3><p><b>${safeHtml(p.post_code)}</b><span>${safeHtml(p.period_from)} — ${safeHtml(p.period_to)}</span></p></header>${mainContent}<footer class="passport-ranks"><article><span>Post turi bo‘yicha o‘rni</span><strong>#${safeHtml(p.ranking_position || '—')} <small>/ ${safeHtml(p.ranking_total || '—')}</small></strong><b>${safeHtml(Math.round(Number(p.type_ranking_score || 0)))} ball</b></article><article><span>Post toifasi bo‘yicha o‘rni</span><strong>#${safeHtml(p.category_ranking_position || '—')} <small>/ ${safeHtml(p.category_ranking_total || '—')}</small></strong><b>${safeHtml(Math.round(Number(p.category_ranking_score || 0)))} ball</b></article></footer></div>`
}

function sphereSize(p: Record<string, any>): number {
  const score = Math.max(0, Math.min(100, Number(p.ranking_score || 0)))
  return Math.round(18 + score / 100 * 16)
}

function sphereIcon(size: number, color: string): string {
  const stroke = '#f8fdff'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><radialGradient id="g" cx="32%" cy="25%" r="72%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".22" stop-color="${color}" stop-opacity=".9"/><stop offset=".72" stop-color="${color}"/><stop offset="1" stop-color="#06111c"/></radialGradient><filter id="s"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".48"/></filter></defs><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="url(#g)" stroke="${stroke}" stroke-width="1.4" filter="url(#s)"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function addUzbekistanBorder(ymaps: AnyObject, map: AnyObject, isAlive: () => boolean): void {
  if (!ymaps.Polyline) return
  void getUzbekistanBorder().then((result: AnyObject) => {
    if (!isAlive()) return
    for (const feature of result?.features || []) {
      const geometry = feature?.geometry
      const polygons = geometry?.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry?.type === 'MultiPolygon'
          ? geometry.coordinates
          : []
      for (const polygon of polygons) {
        for (const ring of polygon || []) {
          const coordinates = (ring || [])
            .filter((point: unknown) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
            .map(([lng, lat]: number[]) => [lat, lng])
          if (!isAlive() || coordinates.length < 2) continue
          map.geoObjects.add(new ymaps.Polyline(coordinates, {}, {
            strokeColor: '#78a4f5',
            strokeWidth: 2,
            strokeOpacity: 0.9,
            strokeStyle: 'solid',
            zIndex: 850,
          }))
        }
      }
    }
  }).catch(() => { /* The map remains usable when the optional border cannot load. */ })
}

export function YandexTransitMap({ apiKey, posts = empty, corridors = empty, selectedId, onCorridorSelect, loading }: { apiKey: string; posts?: FeatureCollection; corridors?: FeatureCollection; selectedId?: string | null; onCorridorSelect?: (properties: Record<string, unknown> | null) => void; loading?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AnyObject | null>(null)
  const ymapsRef = useRef<AnyObject | null>(null)
  const corridorObjects = useRef<AnyObject | null>(null)
  const postObjects = useRef<AnyObject | null>(null)
  const corridorLinesRef = useRef<Map<string, { line: AnyObject; color: string; width: number }>>(new Map())
  const lastFitKeyRef = useRef('')
  const [ready, setReady] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const fitUzbekistan = useCallback(() => mapRef.current?.setBounds([[36.6, 55.8], [45.7, 73.3]], { checkZoomRange: true, zoomMargin: 32 }), [])

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false) }
    document.body.style.overflow = fullscreen ? 'hidden' : ''
    window.addEventListener('keydown', close)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', close) }
  }, [fullscreen])

  useEffect(() => {
    let live = true
    let stopResize: (() => void) | undefined
    setReady(false)
    void loadYandexMaps(apiKey).then((ymaps) => {
      if (!live || !containerRef.current) return
      ymapsRef.current = ymaps
      const map = new ymaps.Map(containerRef.current, { center: [41.2, 64.6], zoom: 5, controls: ['zoomControl', 'typeSelector'] }, { suppressMapOpenBlock: true })
      mapRef.current = map
      const isAlive = () => live && mapRef.current === map
      addUzbekistanBorder(ymaps, map, isAlive)
      corridorObjects.current = new ymaps.GeoObjectCollection()
      postObjects.current = new ymaps.GeoObjectCollection()
      map.geoObjects.add(corridorObjects.current)
      map.geoObjects.add(postObjects.current)
      stopResize = observeMapSize(containerRef.current, map, isAlive)
      setReady(true)
    }).catch(() => { if (live) setReady(false) })
    return () => { live = false; stopResize?.(); const map = mapRef.current; mapRef.current = null; ymapsRef.current = null; corridorObjects.current = null; postObjects.current = null; corridorLinesRef.current.clear(); try { map?.behaviors?.disable('drag') } catch { /* already inactive */ }; map?.destroy() }
  }, [apiKey])

  useEffect(() => {
    const ymaps = ymapsRef.current
    const collection = corridorObjects.current
    if (!ready || !ymaps || !collection) return
    collection.removeAll()
    corridorLinesRef.current.clear()
    const bounds: number[][] = []
    for (const feature of corridors.features) {
      if (feature.geometry.type !== 'LineString') continue
      const properties = feature.properties || {}
      const coordinates = feature.geometry.coordinates.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)).map(([lng, lat]) => [lat, lng])
      if (coordinates.length < 2) continue
      coordinates.forEach((point) => bounds.push(point))
      const color = String(properties.color || '#22d3ee')
      const flow = Number(properties.declaration_count || 0)
      const width = flow >= 1000 ? 9 : flow >= 100 ? 7 : flow >= 10 ? 5 : 4
      const id = String(properties.id || '')
      const line = new ymaps.Polyline(coordinates, {}, { strokeColor: color, strokeWidth: width, strokeOpacity: 0.94 })
      line.events.add('click', () => onCorridorSelect?.(properties as Record<string, unknown>))
      collection.add(line)
      corridorLinesRef.current.set(id, { line, color, width })
    }
    const fitKey = corridors.features.map((feature) => String(feature.properties?.id || '')).join('|')
    if (bounds.length && fitKey !== lastFitKeyRef.current) {
      const lats = bounds.map((p) => p[0]); const lngs = bounds.map((p) => p[1])
      mapRef.current?.setBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { checkZoomRange: true, zoomMargin: 70 })
    }
    lastFitKeyRef.current = fitKey
  }, [corridors, onCorridorSelect, ready])

  useEffect(() => {
    for (const [id, item] of corridorLinesRef.current) {
      const selected = Boolean(selectedId) && id === selectedId
      item.line.options.set({ strokeColor: selected ? '#ffffff' : item.color, strokeWidth: selected ? item.width + 3 : item.width, zIndex: selected ? 900 : 200 })
    }
  }, [selectedId, corridors, ready])

  useEffect(() => {
    const ymaps = ymapsRef.current
    const collection = postObjects.current
    if (!ready || !ymaps || !collection) return
    collection.removeAll()
    for (const feature of posts.features) {
      if (feature.geometry.type !== 'Point') continue
      const [lng, lat] = feature.geometry.coordinates
      const p = feature.properties || {}
      const balloon = postStatisticsHtml(p)
      const flow = Number(p.total_flow || 0)
      const color = p.post_type === 'CHBP' ? '#fb4058' : p.post_type === 'PORT' ? '#34d399' : p.post_type === 'TIF' ? '#a78bfa' : '#38bdf8'
      const size = sphereSize(p)
      const marker = new ymaps.Placemark([lat, lng], { balloonContent: balloon, hintContent: balloon }, { iconLayout: 'default#image', iconImageHref: sphereIcon(size, color), iconImageSize: [size, size], iconImageOffset: [-size / 2, -size / 2], zIndex: 400 + Math.min(flow, 10_000), balloonMinWidth: 500, balloonMaxWidth: 520, balloonMaxHeight: 560 })
      marker.events.add('balloonopen', () => window.setTimeout(() => {
        document.querySelectorAll<HTMLButtonElement>(`[data-post-id="${String(p.id)}"] .passport-close`).forEach((close) => {
          close.onclick = () => marker.balloon.close()
        })
      }, 0))
      collection.add(marker)
    }
  }, [posts, ready])

  useEffect(() => { if (ready) setTimeout(() => mapRef.current?.container.fitToViewport(), 0) }, [fullscreen, ready])
  return <div className={`transit-map ${fullscreen ? 'is-fullscreen' : ''}`}>
    <div ref={containerRef} className="map-canvas yandex-map" aria-label="Yandex xaritasidagi tranzit yo'laklari" />
    {loading && <div className="map-progress"><span /></div>}
    <div className="map-provider-badge">YANDEX MAPS</div>
    <div className="map-tools"><button onClick={fitUzbekistan} title="Barcha O'zbekiston" aria-label="O‘zbekistonni to‘liq ko‘rsatish"><LocateFixed size={18}/></button><button className="fullscreen-map-button" onClick={() => setFullscreen((v) => !v)} title={fullscreen ? "Kichik ekranga qaytish" : "Xaritani katta ekranda ochish"} aria-label={fullscreen ? "Kichik ekranga qaytish" : "Xaritani katta ekranda ochish"}>{fullscreen ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}</button></div>
    <div className="map-legend"><strong>OQIM ZICHLIGI</strong><span><i className="line low"/> Past</span><span><i className="line mid"/> O'rta</span><span><i className="line high"/> Yuqori</span><span><i className="post-sphere"/> Post hajmi</span></div>
  </div>
}

export function YandexRouteBuilderMap({ apiKey, waypoints, geometry, posts = [], onAdd, onMove, onPostSelect }: { apiKey: string; waypoints: Waypoint[]; geometry?: GeoJSON.LineString; posts?: CustomsPost[]; onAdd: (lat: number, lng: number) => void; onMove: (index: number, lat: number, lng: number) => void; onPostSelect?: (post: CustomsPost) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AnyObject | null>(null)
  const ymapsRef = useRef<AnyObject | null>(null)
  const objectsRef = useRef<AnyObject | null>(null)
  const didInitialFitRef = useRef(false)
  const onAddRef = useRef(onAdd); const onMoveRef = useRef(onMove)
  const onPostSelectRef = useRef(onPostSelect)
  onAddRef.current = onAdd; onMoveRef.current = onMove
  onPostSelectRef.current = onPostSelect
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true; let stopResize: (() => void) | undefined
    setReady(false)
    void loadYandexMaps(apiKey).then((ymaps) => {
      if (!live || !container.current) return
      ymapsRef.current = ymaps
      const map = new ymaps.Map(container.current, { center: [41.2, 64.6], zoom: 5, controls: ['zoomControl', 'typeSelector'] }, { suppressMapOpenBlock: true })
      mapRef.current = map; objectsRef.current = new ymaps.GeoObjectCollection(); map.geoObjects.add(objectsRef.current)
      const isAlive = () => live && mapRef.current === map
      addUzbekistanBorder(ymaps, map, isAlive)
      map.events.add('click', (event: AnyObject) => { if (!isAlive() || event.get('target') !== map) return; const [lat, lng] = event.get('coords'); onAddRef.current(lat, lng) })
      stopResize = observeMapSize(container.current, map, isAlive); setReady(true)
    }).catch(() => { if (live) setReady(false) })
    return () => { live = false; stopResize?.(); const map = mapRef.current; mapRef.current = null; ymapsRef.current = null; objectsRef.current = null; try { map?.behaviors?.disable('drag') } catch { /* already inactive */ }; map?.destroy() }
  }, [apiKey])
  useEffect(() => {
    const ymaps = ymapsRef.current; const objects = objectsRef.current
    if (!ready || !ymaps || !objects) return
    objects.removeAll()
    posts.filter((post) => post.latitude != null && post.longitude != null).forEach((post) => {
      const preset = post.post_type === 'CHBP' ? 'islands#redCircleDotIcon' : post.post_type === 'TIF' ? 'islands#violetCircleDotIcon' : post.post_type === 'PORT' ? 'islands#greenCircleDotIcon' : 'islands#blueCircleDotIcon'
      const marker = new ymaps.Placemark([post.latitude, post.longitude], { hintContent: `${post.post_code} · ${post.post_name}`, balloonContentHeader: `${post.post_code} · ${post.post_name}`, balloonContentBody: `${post.post_type} · corridor roli uchun markerni bosing` }, { preset, zIndex: 300 })
      marker.events.add('click', () => onPostSelectRef.current?.(post)); objects.add(marker)
    })
    if (geometry) {
      const routeLine = new ymaps.Polyline(geometry.coordinates.map(([lng, lat]) => [lat, lng]), { hintContent: "Yo‘l ustiga bosib oraliq nuqta qo‘shing" }, { strokeColor: '#67e8f9', strokeWidth: 6, strokeOpacity: .96, cursor: 'crosshair' })
      routeLine.events.add('click', (event: AnyObject) => { const [lat, lng] = event.get('coords'); onAddRef.current(lat, lng) })
      objects.add(routeLine)
    }
    waypoints.forEach((point, index) => {
      const fixed = Boolean(point.post_code)
      const preset = point.waypoint_type === 'ENTRY_POST' || point.waypoint_type === 'EXIT_POST' ? 'islands#redCircleIcon' : point.waypoint_type.includes('GATEWAY') ? 'islands#darkBlueCircleIcon' : 'islands#blueCircleIcon'
      const marker = new ymaps.Placemark([point.latitude, point.longitude], { iconContent: String(index + 1), hintContent: point.label || point.waypoint_type }, { preset, draggable: !fixed, zIndex: 700 })
      marker.events.add('dragend', () => { const [lat, lng] = marker.geometry.getCoordinates(); onMoveRef.current(index, lat, lng) }); objects.add(marker)
    })
    const points = geometry?.coordinates.map(([lng, lat]) => [lat, lng]) || waypoints.map((w) => [w.latitude, w.longitude])
    if (!didInitialFitRef.current && points.length > 1) {
      const lats = points.map((p) => p[0]); const lngs = points.map((p) => p[1])
      mapRef.current?.setBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { checkZoomRange: true, zoomMargin: 55 })
      didInitialFitRef.current = true
    }
  }, [geometry, posts, ready, waypoints])
  return <div ref={container} className="route-builder-map yandex-map" aria-label="Yandex xaritasida corridor nuqtalarini tahrirlash" />
}

export function YandexLocationPicker({ apiKey, latitude, longitude, onChange }: { apiKey: string; latitude?: number; longitude?: number; onChange: (lat: number, lng: number) => void }) {
  const container = useRef<HTMLDivElement>(null); const mapRef = useRef<AnyObject | null>(null); const markerRef = useRef<AnyObject | null>(null); const ymapsRef = useRef<AnyObject | null>(null); const onChangeRef = useRef(onChange); const internalChangeRef = useRef(false)
  onChangeRef.current = onChange
  useEffect(() => {
    let live = true; let stopResize: (() => void) | undefined
    void loadYandexMaps(apiKey).then((ymaps) => {
      if (!live || !container.current) return
      ymapsRef.current = ymaps
      const hasPoint = latitude != null && longitude != null
      const map = new ymaps.Map(container.current, { center: hasPoint ? [latitude, longitude] : [41.2, 64.6], zoom: hasPoint ? 9 : 5, controls: ['zoomControl', 'typeSelector'] }, { suppressMapOpenBlock: true })
      mapRef.current = map
      const isAlive = () => live && mapRef.current === map
      addUzbekistanBorder(ymaps, map, isAlive)
      const setMarker = (lat: number, lng: number) => {
        if (!isAlive()) return
        const currentMarker = markerRef.current
        if (!currentMarker) {
          const marker = new ymaps.Placemark([lat, lng], {}, { preset: 'islands#redCircleDotIcon', draggable: true })
          markerRef.current = marker
          marker.events.add('dragend', () => { const [nextLat, nextLng] = marker.geometry.getCoordinates(); internalChangeRef.current = true; onChangeRef.current(nextLat, nextLng) })
          map.geoObjects.add(marker)
        } else currentMarker.geometry.setCoordinates([lat, lng])
      }
      if (hasPoint) setMarker(latitude!, longitude!)
      map.events.add('click', (event: AnyObject) => { if (!isAlive() || event.get('target') !== map) return; const [lat, lng] = event.get('coords'); setMarker(lat, lng); internalChangeRef.current = true; onChangeRef.current(lat, lng) })
      stopResize = observeMapSize(container.current, map, isAlive)
    }).catch(() => { /* The coordinate form remains available if Yandex cannot initialize. */ })
    return () => { live = false; stopResize?.(); const map = mapRef.current; mapRef.current = null; markerRef.current = null; ymapsRef.current = null; try { map?.behaviors?.disable('drag') } catch { /* already inactive */ }; map?.destroy() }
  }, [apiKey])
  useEffect(() => {
    const map = mapRef.current; const ymaps = ymapsRef.current
    if (!map || !ymaps || latitude == null || longitude == null) return
    const currentMarker = markerRef.current
    if (!currentMarker) {
      const marker = new ymaps.Placemark([latitude, longitude], {}, { preset: 'islands#redCircleDotIcon', draggable: true })
      markerRef.current = marker
      marker.events.add('dragend', () => { const [nextLat, nextLng] = marker.geometry.getCoordinates(); internalChangeRef.current = true; onChangeRef.current(nextLat, nextLng) })
      map.geoObjects.add(marker)
    } else currentMarker.geometry.setCoordinates([latitude, longitude])
    if (internalChangeRef.current) internalChangeRef.current = false
    else map.setCenter([latitude, longitude], Math.max(map.getZoom(), 10), { duration: 0 })
  }, [latitude, longitude])
  return <div className="location-picker yandex-map" ref={container} aria-label="Yandex xaritasidan post lokatsiyasini tanlash" />
}
