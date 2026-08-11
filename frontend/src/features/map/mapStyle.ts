import type { StyleSpecification } from 'maplibre-gl'

export function getMapStyle(): string | StyleSpecification {
  const configured = import.meta.env.VITE_MAP_STYLE_URL
  if (configured) return configured
  return {
    version: 8,
    name: 'Transit Dark',
    sources: {
      osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#07111f' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.9, 'raster-brightness-max': 0.45, 'raster-contrast': 0.35, 'raster-opacity': 0.72 } },
    ],
  }
}

