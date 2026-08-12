import { useEffect, useState } from 'react'
import { api } from '../../api'

export interface PublicMapConfig {
  provider: 'osm' | 'yandex'
  requested_provider: 'osm' | 'yandex'
  yandex_maps_api_key?: string
  routing_provider: 'osrm' | 'yandex'
  routing_profile: 'driving' | 'truck'
}

type YandexApi = Record<string, any>

declare global {
  interface Window { ymaps?: YandexApi }
}

let configPromise: Promise<PublicMapConfig> | null = null
let yandexPromise: Promise<YandexApi> | null = null

export function getMapConfig(): Promise<PublicMapConfig> {
  if (!configPromise) configPromise = api<PublicMapConfig>('/map/config')
  return configPromise
}

export function useMapProvider(): PublicMapConfig | null {
  const [config, setConfig] = useState<PublicMapConfig | null>(null)
  useEffect(() => { let live = true; void getMapConfig().then((value) => live && setConfig(value)).catch(() => live && setConfig({ provider: 'osm', requested_provider: 'osm', routing_provider: 'osrm', routing_profile: 'driving' })); return () => { live = false } }, [])
  return config
}

export function loadYandexMaps(apiKey: string): Promise<YandexApi> {
  if (window.ymaps) return new Promise((resolve) => window.ymaps!.ready(() => resolve(window.ymaps!)))
  if (yandexPromise) return yandexPromise
  yandexPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`
    script.async = true
    script.onload = () => window.ymaps ? window.ymaps.ready(() => resolve(window.ymaps!)) : reject(new Error('Yandex Maps yuklanmadi'))
    script.onerror = () => reject(new Error('Yandex Maps skripti yuklanmadi'))
    document.head.appendChild(script)
  })
  return yandexPromise
}

export function safeHtml(value: unknown): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }
  return String(value ?? '').replace(/[&<>'"]/g, (char) => entities[char] || char)
}
