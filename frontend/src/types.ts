export type FeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>

export interface Country {
  alpha2: string
  alpha3: string
  name: string
  flag: string
}

export interface CustomsPost {
  id: string
  post_code: string
  post_name: string
  post_type: 'CHBP' | 'TIF' | 'AERO' | 'RW' | 'PORT'
  region?: string
  neighbor_country_code?: string
  latitude?: number
  longitude?: number
  location_verified: boolean
  is_active: boolean
}

export interface Waypoint {
  sequence_no: number
  waypoint_type: 'ORIGIN_GATEWAY' | 'ENTRY_POST' | 'VIA' | 'EXIT_POST' | 'DESTINATION_GATEWAY'
  latitude: number
  longitude: number
  post_code?: string
  gateway_id?: string
  label?: string
}

export interface Corridor {
  id: string
  code: string
  name: string
  origin_country_code?: string
  destination_country_code?: string
  entry_post_code: string
  exit_post_code: string
  status: string
  color?: string
  geometry?: GeoJSON.LineString
  distance_meters?: number
  duration_seconds?: number
  route_needs_review: boolean
  priority: number
  is_active: boolean
  waypoints: Waypoint[]
}

export interface AnalyticsData {
  meta: { date_from: string; date_to: string; refreshed_at: string; unavailable_count: number }
  kpis: {
    total_declarations: number
    active_corridors: number
    entry_posts: number
    exit_posts: number
    top_corridor: string
    avg_transit_minutes: number
    change_percent: number
  }
  corridors: FeatureCollection
  posts: FeatureCollection
  unavailable_routes: Array<Record<string, unknown>>
  top_pairs: Array<{ entry: string; exit: string; count: number }>
  country_share: Array<{ country: string; count: number; share: number }>
  trend: Array<{ date: string; count: number }>
}

export interface Filters {
  date_from: string
  date_to: string
  origin: string
  destination: string
  entry: string
  exit: string
  corridor: string
}

