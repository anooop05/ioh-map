import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import '@tomickigrzegorz/leaflet-rotate'
import { crowdFor, initialLabs, slots, type CrowdStatus, type Lab } from './data/labs'
import { useGeolocation } from './hooks/useGeolocation'
import './App.css'

const CAMPUS: [number, number] = [12.9915, 80.2335]
const routeCasingStyle: L.PathOptions = { color: '#fff', weight: 12, opacity: 0.96, lineCap: 'round', lineJoin: 'round' }
const routeLineStyle: L.PathOptions = { color: '#3477d5', weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round' }
const navigationPositionIcon = L.divIcon({
  className: 'navigation-position-wrap',
  html: '<span class="navigation-position"><span class="navigation-position-arrow"></span></span>',
  iconSize: [38, 38],
  iconAnchor: [19, 19],
})
type LabFilter = 'all' | CrowdStatus
const filters: { id: LabFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'open', label: 'Open' }, { id: 'filling', label: 'Filling fast' }, { id: 'full', label: 'Full' }]
const accessLabels: Record<Lab['access'], string> = { open: 'Open to visitors', closed: 'Closed', restricted: 'Access restricted' }
const crowdLabels: Record<CrowdStatus, string> = { open: 'Comfortable', filling: 'Filling fast', full: 'At capacity' }
type RouteInstruction = { text: string; endIndex: number }
type WalkingRoute = { labId: string; origin: [number, number]; points: [number, number][]; cumulativeMeters: number[]; distanceKm: number; durationSeconds: number; instructions: RouteInstruction[] }
type RouteState = 'idle' | 'loading' | 'ready' | 'error'
type IconName = 'search' | 'close' | 'chevron-up' | 'chevron-down' | 'chevron-right' | 'pin' | 'locate' | 'reset' | 'directions' | 'clock' | 'access' | 'plus' | 'minus' | 'back'

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const base = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }
  switch (name) {
    case 'search': return <svg {...base}><circle cx="10.8" cy="10.8" r="6.6" /><path d="m16 16 4.2 4.2" /></svg>
    case 'close': return <svg {...base}><path d="m6 6 12 12M18 6 6 18" /></svg>
    case 'chevron-up': return <svg {...base}><path d="m6 14 6-6 6 6" /></svg>
    case 'chevron-down': return <svg {...base}><path d="m6 10 6 6 6-6" /></svg>
    case 'chevron-right': return <svg {...base}><path d="m9 18 6-6-6-6" /></svg>
    case 'pin': return <svg {...base}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.4" /></svg>
    case 'locate': return <svg {...base}><circle cx="12" cy="12" r="6.2" /><circle cx="12" cy="12" r="1.8" /><path d="M12 2v3M12 19v3M2 12h3m14 0h3" /></svg>
    case 'reset': return <svg {...base}><path d="M4.2 10a8 8 0 1 1 .8 6.6" /><path d="M4 4v6h6" /><path d="m12 7 0 5 3 2" /></svg>
    case 'directions': return <svg {...base}><path d="M12 3 21 12l-9 9-9-9 9-9Z" /><path d="M9 15v-3a3 3 0 0 1 3-3h3m-3-3 3 3-3 3" /></svg>
    case 'clock': return <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></svg>
    case 'access': return <svg {...base}><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></svg>
    case 'plus': return <svg {...base}><path d="M12 5v14M5 12h14" /></svg>
    case 'minus': return <svg {...base}><path d="M5 12h14" /></svg>
    case 'back': return <svg {...base}><path d="m15 18-6-6 6-6M9 12h11" /></svg>
  }
}

function MapMotion({ target, position, resetKey, locateKey }: { target: Lab | null; position: [number, number] | null; resetKey: number; locateKey: number }) {
  const map = useMap()
  const didInitialLocate = useRef(false)
  const lastTarget = useRef<string | null>(null)
  const lastReset = useRef(resetKey)
  const lastLocate = useRef(locateKey)
  useEffect(() => {
    if (target && target.id !== lastTarget.current) {
      lastTarget.current = target.id
      map.flyTo([target.latitude, target.longitude], Math.max(map.getZoom(), 17), { duration: 0.65 })
    } else if (!target && lastTarget.current) lastTarget.current = null
    if (resetKey !== lastReset.current) {
      lastReset.current = resetKey
      map.flyTo(CAMPUS, 16, { duration: 0.65 })
    } else if (!target && position && !didInitialLocate.current) {
      map.flyTo(position, 17, { duration: 0.65 })
      didInitialLocate.current = true
    }
    if (locateKey !== lastLocate.current) {
      lastLocate.current = locateKey
      if (position) map.flyTo(position, Math.max(map.getZoom(), 17), { duration: 0.65 })
    }
  }, [map, target, position, resetKey, locateKey])
  return null
}

function decodePolyline6(encoded: string): [number, number][] {
  const points: [number, number][] = []
  let index = 0
  let lat = 0
  let lon = 0
  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index < encoded.length)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    result = 0
    shift = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index < encoded.length)
    lon += result & 1 ? ~(result >> 1) : result >> 1
    points.push([lat / 1e6, lon / 1e6])
  }
  return points
}

function nearestRouteIndex(points: [number, number][], position: [number, number]) {
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  points.forEach((point, index) => {
    const distance = Math.hypot(point[0] - position[0], point[1] - position[1])
    if (distance < nearestDistance) {
      nearestIndex = index
      nearestDistance = distance
    }
  })
  return nearestIndex
}

function distanceMeters(start: [number, number], end: [number, number]) {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const lat1 = radians(start[0])
  const lat2 = radians(end[0])
  const deltaLat = lat2 - lat1
  const deltaLon = radians(end[1] - start[1])
  const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function cumulativeRouteMeters(points: [number, number][]) {
  const cumulative = new Array<number>(points.length).fill(0)
  for (let index = 1; index < points.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + distanceMeters(points[index - 1], points[index])
  }
  return cumulative
}

function remainingRoute(route: WalkingRoute | null, position: [number, number] | null, routeIndex: number): WalkingRoute | null {
  if (!route || !position || route.points.length < 2) return route
  const remainingMeters = route.cumulativeMeters.at(-1)! - route.cumulativeMeters[routeIndex]
  const remainingDistanceKm = remainingMeters / 1000
  const ratio = route.distanceKm > 0 ? remainingDistanceKm / route.distanceKm : 0
  return {
    ...route,
    distanceKm: remainingDistanceKm,
    durationSeconds: Math.ceil(route.durationSeconds * ratio),
  }
}

function nextInstruction(route: WalkingRoute | null, position: [number, number] | null, routeIndex?: number) {
  if (!route || route.instructions.length === 0) return { instruction: null, index: 0 }
  const currentIndex = routeIndex ?? (position ? nearestRouteIndex(route.points, position) : 0)
  const index = route.instructions.findIndex((step) => step.endIndex > currentIndex)
  const safeIndex = index < 0 ? route.instructions.length - 1 : index
  return { instruction: route.instructions[safeIndex], index: safeIndex }
}

function bearingTowardRoute(route: WalkingRoute | null, position: [number, number], routeIndex?: number) {
  if (!route || route.points.length < 2) return null
  const index = routeIndex ?? nearestRouteIndex(route.points, position)
  const start = route.points[Math.min(index, route.points.length - 2)]
  const end = route.points[Math.min(index + 1, route.points.length - 1)]
  const radians = (degrees: number) => degrees * Math.PI / 180
  const lat1 = radians(start[0])
  const lat2 = radians(end[0])
  const deltaLon = radians(end[1] - start[1])
  const y = Math.sin(deltaLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function MarkerLayer({ labs, selected, onSelect }: { labs: Lab[]; selected: Lab | null; onSelect: (lab: Lab) => void }) {
  return labs.map((lab) => {
    const crowd = crowdFor(lab)
    const icon = L.divIcon({ className: `lab-marker-wrap ${crowd} ${selected?.id === lab.id ? 'selected' : ''}`, html: '<span class="lab-marker"></span>', iconSize: [28, 36], iconAnchor: [14, 31], popupAnchor: [0, -29] })
    return <Marker key={lab.id} position={[lab.latitude, lab.longitude]} icon={icon} eventHandlers={{ click: () => onSelect(lab) }}>
      <Popup><strong>{lab.name}</strong><br />{lab.currentVisitors} / {lab.maxCapacity} visitors &middot; {crowdLabels[crowd]}<br /><span>{accessLabels[lab.access]}</span></Popup>
    </Marker>
  })
}

function SearchPanel({ labs, selected, onSelect }: { labs: Lab[]; selected: Lab | null; onSelect: (lab: Lab) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LabFilter>('all')
  const [expanded, setExpanded] = useState(true)
  const searchInput = useRef<HTMLInputElement>(null)
  const normalizedQuery = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  const visible = labs.filter((lab) => {
    const searchable = `${lab.name} ${lab.department}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const match = searchable.includes(normalizedQuery)
    const isAvailable = lab.access === 'open' && crowdFor(lab) === 'open'
    return match && (filter === 'all' || (filter === 'open' ? isAvailable : crowdFor(lab) === filter))
  })
  return <section className={`search-panel ${expanded ? '' : 'collapsed'}`} aria-label="Find a lab">
    <div className="brand-row"><div className="brand"><span className="brand-pin"><Icon name="pin" size={17} /></span><span><strong>IOH</strong><small> CAMPUS GUIDE</small></span></div><button type="button" className="icon-button panel-toggle" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Collapse lab list' : 'Expand lab list'}><Icon name={expanded ? 'chevron-up' : 'chevron-down'} /></button></div>
    {expanded && <>
      <form className="search-box" role="search" onSubmit={(event) => event.preventDefault()}>
        <button type="submit" className="search-submit" aria-label="Search labs"><Icon name="search" size={19} /></button>
        <input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); event.currentTarget.blur() } }} placeholder="Search labs or buildings" aria-label="Search labs or buildings" aria-controls="lab-search-results" autoComplete="off" autoCorrect="off" spellCheck={false} />
        {query && <button type="button" className="search-clear" aria-label="Clear search" onClick={() => { setQuery(''); searchInput.current?.focus() }}><Icon name="close" size={17} /></button>}
      </form>
      <div className="filter-row" aria-label="Filter labs">{filters.map(({ id, label }) => <button key={id} className={`filter-chip ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{label}</button>)}</div>
      <div className="list-heading"><span>{normalizedQuery ? 'SEARCH RESULTS' : 'EXPLORE CAMPUS'}</span><span aria-live="polite">{visible.length} {visible.length === 1 ? 'place' : 'places'}</span></div>
      <div className="lab-list" id="lab-search-results" aria-live="polite">{visible.map((lab) => <button key={lab.id} className={`lab-row ${selected?.id === lab.id ? 'chosen' : ''}`} onClick={() => onSelect(lab)}>
        <span className={`status-dot ${crowdFor(lab)}`} /><span className="lab-copy"><strong>{lab.name}</strong><small>{lab.department}</small><small className="row-meta">{lab.currentVisitors} / {lab.maxCapacity} visitors <i>&middot;</i> {accessLabels[lab.access]}</small></span><span className="row-arrow"><Icon name="chevron-right" size={16} /></span>
      </button>)}{visible.length === 0 && <div className="empty-state"><p>No labs match your search.</p><button type="button" onClick={() => { setQuery(''); setFilter('all'); searchInput.current?.focus() }}>Clear search and filters</button></div>}</div>
      <div className="panel-foot"><span className="demo-mark" /> Demo data &middot; locations unverified</div>
    </>}
  </section>
}

function DetailsCard({ lab, onClose, onDirections, route, routeState, routeError }: {
  lab: Lab | null
  onClose: () => void
  onDirections: (lab: Lab) => void
  route: WalkingRoute | null
  routeState: RouteState
  routeError: string
}) {
  if (!lab) return null
  const crowd = crowdFor(lab)
  const pct = Math.min(100, Math.round(lab.currentVisitors / Math.max(lab.maxCapacity, 1) * 100))
  return <section className="details-card" aria-label={`${lab.name} details`}>
    <div className="detail-top"><div><span className="eyebrow">LAB DETAILS</span><h2>{lab.name}</h2><p>{lab.department}</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close lab details"><Icon name="close" /></button></div>
    <div className="capacity-heading"><span>Current visitors</span><strong>{lab.currentVisitors} <small>/ {lab.maxCapacity}</small></strong></div>
    <div className="progress-track" role="progressbar" aria-label="Lab capacity" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span className={crowd} style={{ width: `${pct}%` }} /></div>
    <div className="capacity-foot"><span>{pct}% capacity</span><span className={`crowd-label ${crowd}`}><i />{crowdLabels[crowd]}</span></div>
    <div className="detail-info"><div><span className="info-icon"><Icon name="clock" size={16} /></span><span><small>OPENING HOURS</small><strong>{lab.openingTime} &ndash; {lab.closingTime}</strong></span></div><div><span className="info-icon"><Icon name="access" size={16} /></span><span><small>ACCESS</small><strong className={lab.access !== 'open' ? 'access-alert' : ''}>{accessLabels[lab.access]}</strong></span></div></div>
    <p className="description">{lab.description}</p>
    <div className="detail-actions"><button className="directions-button" onClick={() => onDirections(lab)}><Icon name="directions" size={17} /> Directions</button><span className="coords-note">Illustrative location</span></div>
    {routeState === 'loading' && <p className="route-message" role="status">Finding a walking route from your position&hellip;</p>}
    {routeState === 'error' && <p className="route-message route-error" role="status">{routeError}</p>}
    {routeState === 'ready' && route && <div className="route-results"><div className="route-summary"><strong>{route.distanceKm < 1 ? `${Math.round(route.distanceKm * 1000)} m` : `${route.distanceKm.toFixed(1)} km`}</strong><span>&middot;</span><strong>{Math.max(1, Math.ceil(route.durationSeconds / 60))} min walk</strong><small>via OpenStreetMap data</small></div><ol>{route.instructions.map((step, index) => <li key={`${index}-${step.text}`}>{step.text}</li>)}</ol></div>}
  </section>
}

function MapControls({ onZoom, onLocate, onReset, locating, detailsOpen }: { onZoom: (delta: number) => void; onLocate: () => void; onReset: () => void; locating: boolean; detailsOpen: boolean }) {
  return <div className={`map-controls ${detailsOpen ? 'with-details' : ''}`}><div className="zoom-control"><button onClick={() => onZoom(1)} aria-label="Zoom in"><Icon name="plus" size={18} /></button><span /><button onClick={() => onZoom(-1)} aria-label="Zoom out"><Icon name="minus" size={18} /></button></div><button onClick={onLocate} aria-label="Locate me" title="Locate me" className={locating ? 'locating' : ''}><Icon name="locate" /></button><button onClick={onReset} aria-label="Reset map view" title="Reset map view"><Icon name="reset" /></button></div>
}

function DirectionsPanel({ lab, route, status, error, instruction, instructionIndex, onBack, onRetry }: {
  lab: Lab
  route: WalkingRoute | null
  status: RouteState
  error: string
  instruction: RouteInstruction | null
  instructionIndex: number
  onBack: () => void
  onRetry: () => void
}) {
  return <section className="directions-panel" aria-label="Walking directions">
    <header className="directions-header"><button className="icon-button directions-back" onClick={onBack} aria-label="Back to map"><Icon name="back" /></button><div><span className="eyebrow">WALKING DIRECTIONS</span><h2>{lab.name}</h2></div><button className="icon-button directions-close" onClick={onBack} aria-label="Close directions"><Icon name="close" /></button></header>
    {status === 'loading' && <><div className="directions-loading"><span className="route-spinner" /><span>{route ? <>Updating from your current position&hellip;</> : <>Finding a walking route&hellip;</>}</span></div>{route && <><div className="directions-summary"><span className="summary-walk"><Icon name="directions" size={17} /><strong>Walk</strong></span><strong>{route.distanceKm < 1 ? `${Math.round(route.distanceKm * 1000)} m` : `${route.distanceKm.toFixed(1)} km`}</strong><span>{Math.max(1, Math.ceil(route.durationSeconds / 60))} min</span></div><div className="direction-current-step"><span>{instruction ? `STEP ${instructionIndex + 1} OF ${route.instructions.length}` : 'FOLLOW THE BLUE LINE'}</span><strong>{instruction?.text ?? 'Continue along the highlighted path.'}</strong></div></>}</>}
    {status === 'error' && <div className="directions-error"><p>{error}</p><button onClick={onRetry}>Try again</button></div>}
    {status === 'ready' && route && <><div className="directions-summary"><span className="summary-walk"><Icon name="directions" size={17} /><strong>Walk</strong></span><strong>{route.distanceKm < 1 ? `${Math.round(route.distanceKm * 1000)} m` : `${route.distanceKm.toFixed(1)} km`}</strong><span>{Math.max(1, Math.ceil(route.durationSeconds / 60))} min</span></div><div className="direction-current-step"><span>{instruction ? `STEP ${instructionIndex + 1} OF ${route.instructions.length}` : 'FOLLOW THE BLUE LINE'}</span><strong>{instruction?.text ?? 'Continue along the highlighted path.'}</strong></div><ol className="directions-steps">{route.instructions.map((step, index) => <li key={`${index}-${step.text}`} className={index === instructionIndex ? 'current' : ''}>{step.text}</li>)}</ol><p className="directions-footnote">Route follows mapped pedestrian paths. Lab pin and paths are illustrative.</p></>}
  </section>
}

function VisitorPage({ labs, selected, setSelected, geolocation, resetKey, setResetKey, navigationActive, setNavigationActive }: {
  labs: Lab[]
  selected: Lab | null
  setSelected: (lab: Lab | null) => void
  geolocation: ReturnType<typeof useGeolocation>
  resetKey: number
  setResetKey: Dispatch<SetStateAction<number>>
  navigationActive: boolean
  setNavigationActive: Dispatch<SetStateAction<boolean>>
}) {
  const [route, setRoute] = useState<WalkingRoute | null>(null)
  const [routeOrigin, setRouteOrigin] = useState<[number, number] | null>(null)
  const [routeState, setRouteState] = useState<RouteState>('idle')
  const [routeError, setRouteError] = useState('')
  const [routeRequestKey, setRouteRequestKey] = useState(0)
  const [locateKey, setLocateKey] = useState(0)
  const [followKey, setFollowKey] = useState(0)
  const requestSequence = useRef(0)
  const routeOriginRef = useRef<[number, number] | null>(null)
  const latestPositionRef = useRef<[number, number] | null>(null)
  const routeRefreshTimer = useRef<number | null>(null)
  const lastRouteRequestAt = useRef(0)
  const latitude = geolocation.position?.[0]
  const longitude = geolocation.position?.[1]

  useEffect(() => {
    if (latitude === undefined || longitude === undefined) return
    const current: [number, number] = [latitude, longitude]
    latestPositionRef.current = current
    if (!routeOriginRef.current) {
      routeOriginRef.current = current
      setRouteOrigin(current)
      return
    }
    if (!navigationActive || !selected || distanceMeters(routeOriginRef.current, current) < 18 || routeRefreshTimer.current !== null) return
    const wait = Math.max(0, 6000 - (Date.now() - lastRouteRequestAt.current))
    routeRefreshTimer.current = window.setTimeout(() => {
      routeRefreshTimer.current = null
      const latest = latestPositionRef.current
      if (latest && routeOriginRef.current && distanceMeters(routeOriginRef.current, latest) >= 18) {
        routeOriginRef.current = latest
        setRouteOrigin(latest)
      }
    }, wait)
  }, [latitude, longitude, navigationActive, selected])

  useEffect(() => () => {
    if (routeRefreshTimer.current !== null) window.clearTimeout(routeRefreshTimer.current)
  }, [])

  useEffect(() => {
    if (!navigationActive) {
      requestSequence.current += 1
      return
    }
    if (!selected) {
      requestSequence.current += 1
      return
    }
    if (!routeOrigin) return

    routeOriginRef.current = routeOrigin
    lastRouteRequestAt.current = Date.now()
    const requestId = ++requestSequence.current
    window.setTimeout(() => {
      if (requestId === requestSequence.current) {
        setRouteError('')
        setRouteState('loading')
      }
    }, 0)
    fetch('https://valhalla1.openstreetmap.de/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'ioh-campus-guide-prototype' },
      body: JSON.stringify({
        locations: [
          { lat: routeOrigin[0], lon: routeOrigin[1] },
          { lat: selected.latitude, lon: selected.longitude, name: selected.name },
        ],
        costing: 'pedestrian',
        units: 'kilometers',
      }),
    }).then(async (response) => {
      const result = await response.json() as {
        error?: string
        error_message?: string
        trip?: {
          status?: number
          status_message?: string
          summary?: { length?: number; time?: number }
          legs?: { shape?: string; maneuvers?: { instruction?: string; end_shape_index?: number }[] }[]
        }
      }
      if (!response.ok || result.trip?.status !== 0) throw new Error(result.error_message || result.error || result.trip?.status_message || 'No walking route was found.')
      const summary = result.trip.summary
      const points = result.trip.legs?.flatMap((leg) => decodePolyline6(leg.shape ?? '')) ?? []
      const instructions = result.trip.legs?.flatMap((leg) => leg.maneuvers?.map((maneuver) => ({ text: maneuver.instruction, endIndex: maneuver.end_shape_index ?? Number.MAX_SAFE_INTEGER })).filter((step): step is RouteInstruction => Boolean(step.text)) ?? []) ?? []
      if (!summary || !Number.isFinite(summary.length) || !Number.isFinite(summary.time) || points.length < 2) throw new Error('The route service returned incomplete directions.')
      if (requestId !== requestSequence.current) return
      setRoute({ labId: selected.id, origin: routeOrigin, points, cumulativeMeters: cumulativeRouteMeters(points), distanceKm: summary.length as number, durationSeconds: summary.time as number, instructions })
      setRouteState('ready')
    }).catch((error: unknown) => {
      if (requestId !== requestSequence.current) return
      setRoute(null)
      setRouteError(error instanceof Error && error.message !== 'Failed to fetch' ? error.message : 'Walking directions are unavailable right now. Check your connection and try again.')
      setRouteState('error')
    })
  }, [navigationActive, selected, routeOrigin, routeRequestKey])

  function directions(lab: Lab) {
    setSelected(lab)
    setNavigationActive(true)
    if (geolocation.position) {
      routeOriginRef.current = geolocation.position
      setRouteOrigin(geolocation.position)
    }
    if (!geolocation.position) geolocation.locate()
    setRouteRequestKey((current) => current + 1)
  }
  function zoom(delta: number) { window.dispatchEvent(new CustomEvent<number>('ioh-map-zoom', { detail: delta })) }
  const routeForSelected = route?.labId === selected?.id ? route : null
  const routeProgressIndex = routeForSelected && geolocation.position ? nearestRouteIndex(routeForSelected.points, geolocation.position) : 0
  const activeRoute = useMemo(() => remainingRoute(routeForSelected, geolocation.position, routeProgressIndex), [routeForSelected, geolocation.position, routeProgressIndex])
  const visibleRouteState: RouteState = selected && !geolocation.position ? (geolocation.error ? 'error' : 'loading') : selected && !routeOrigin ? 'loading' : routeState
  const visibleRouteError = selected && !geolocation.position && geolocation.error ? 'Turn on location access to get walking directions.' : routeError
  const instructionProgress = nextInstruction(routeForSelected, geolocation.position, routeProgressIndex)
  function locateAndCenter() {
    geolocation.locate()
    setLocateKey((current) => current + 1)
  }
  function focusNavigationPosition() {
    geolocation.locate()
    setFollowKey((current) => current + 1)
  }
  return <main className="visitor-page">
    <MapContainer center={CAMPUS} zoom={16} minZoom={3} maxZoom={20} zoomSnap={0.25} zoomDelta={1} wheelPxPerZoomLevel={120} wheelDebounceTime={60} rotate bearing={0} touchRotate={false} dragRotate={false} shiftKeyRotate={false} zoomControl={false} className="map" scrollWheelZoom>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} maxZoom={20} keepBuffer={4} updateWhenIdle={false} updateWhenZooming={false} />
      <MapMotion target={selected} position={geolocation.position} resetKey={resetKey} locateKey={locateKey} />
      <MapEventBridge />
      <MapNavigationCamera active={navigationActive} position={geolocation.position} route={routeForSelected} routeIndex={routeProgressIndex} followKey={followKey} />
      {!navigationActive && <MarkerLayer labs={labs} selected={selected} onSelect={setSelected} />}
      {navigationActive && selected && <MarkerLayer labs={[selected]} selected={selected} onSelect={setSelected} />}
      {geolocation.position && (navigationActive
        ? <Marker position={geolocation.position} icon={navigationPositionIcon} zIndexOffset={1000}><Popup>Your current location</Popup></Marker>
        : <CircleMarker center={geolocation.position} radius={7} pathOptions={{ color: '#fff', weight: 3, fillColor: '#4386f5', fillOpacity: 1 }}><Popup>Your current location</Popup></CircleMarker>)}
      {navigationActive && activeRoute && <>
        <Polyline positions={activeRoute.points} pathOptions={routeCasingStyle} />
        <Polyline positions={activeRoute.points} pathOptions={routeLineStyle} />
      </>}
    </MapContainer>
    {!navigationActive && <SearchPanel labs={labs} selected={selected} onSelect={setSelected} />}
    {!navigationActive && <div className="map-caption"><span className="caption-dot" /> IIT Madras &middot; Chennai <span className="caption-divider">|</span> Campus paths may be incomplete</div>}
    {!navigationActive && <MapControls onZoom={zoom} onLocate={locateAndCenter} locating={geolocation.loading} detailsOpen={Boolean(selected)} onReset={() => { setSelected(null); setResetKey((v) => v + 1) }} />}
    {navigationActive && <button type="button" className="follow-control" onClick={focusNavigationPosition} aria-label="Return to my current location" title="Return to my current location"><Icon name="locate" size={21} /></button>}
    {!navigationActive && <DetailsCard lab={selected} onClose={() => setSelected(null)} onDirections={directions} route={activeRoute} routeState={visibleRouteState} routeError={visibleRouteError} />}
    {navigationActive && selected && <DirectionsPanel lab={selected} route={activeRoute} status={visibleRouteState} error={visibleRouteError} instruction={instructionProgress.instruction} instructionIndex={instructionProgress.index} onBack={() => setNavigationActive(false)} onRetry={() => directions(selected)} />}
    {!navigationActive && geolocation.error && <div className="toast" role="status"><span>{geolocation.error}</span><button onClick={geolocation.clearError} aria-label="Dismiss message">&times;</button></div>}
  </main>
}

function MapEventBridge() {
  const map = useMap()
  useEffect(() => {
    const handler = (event: Event) => {
      const delta = (event as CustomEvent<number>).detail
      map.setZoom(Math.max(3, Math.min(20, map.getZoom() + delta)))
    }
    window.addEventListener('ioh-map-zoom', handler)
    return () => window.removeEventListener('ioh-map-zoom', handler)
  }, [map])
  return null
}

function MapNavigationCamera({ active, position, route, routeIndex, followKey }: { active: boolean; position: [number, number] | null; route: WalkingRoute | null; routeIndex: number; followKey: number }) {
  const map = useMap()
  const wasActive = useRef(false)
  const previousPosition = useRef<[number, number] | null>(null)
  const previousFollowKey = useRef(followKey)
  useEffect(() => {
    if (!active) {
      if (wasActive.current) {
        map.stopHeadingUp()
        map.setBearing(0)
        wasActive.current = false
        previousPosition.current = null
      }
      previousFollowKey.current = followKey
      return
    }
    if (!position) return

    const alignPointerLow = (animate = false) => {
      const size = map.getSize()
      const pointer = map.latLngToContainerPoint(position)
      const target = L.point(size.x / 2, size.y * 0.72)
      const offset = pointer.subtract(target)
      const movementThreshold = animate ? 12 : 1
      if (offset.distanceTo(L.point(0, 0)) > movementThreshold) map.panBy(offset, { animate, duration: 0.22 })
    }

    const requestedFollow = followKey !== previousFollowKey.current
    previousFollowKey.current = followKey
    const newPosition = !previousPosition.current || previousPosition.current[0] !== position[0] || previousPosition.current[1] !== position[1]
    if (!wasActive.current) {
      map.once('moveend', () => alignPointerLow())
      map.flyTo(position, 17.5, { duration: 0.8 })
      wasActive.current = true
    } else if (requestedFollow) {
      map.stop()
      alignPointerLow(true)
    } else if (newPosition) {
      alignPointerLow(true)
    }
    previousPosition.current = position
    const direction = bearingTowardRoute(route, position, routeIndex)
    if (direction === null) map.setBearing(0)
    else map.setHeading(direction, { ease: 0.12, deadzone: 12 })
  }, [map, active, position, route, routeIndex, followKey])
  return null
}

function AdminPage({ labs, setLabs, slot, setSlot, onBack }: {
  labs: Lab[]
  setLabs: Dispatch<SetStateAction<Lab[]>>
  slot: string
  setSlot: Dispatch<SetStateAction<string>>
  onBack: () => void
}) {
  const [capacityDrafts, setCapacityDrafts] = useState<Record<string, string>>({})
  const update = <K extends keyof Lab>(id: string, key: K, value: Lab[K]) => setLabs((current) => current.map((lab) => lab.id === id ? { ...lab, [key]: value } : lab))
  function commitCapacity(lab: Lab) {
    const draft = capacityDrafts[lab.id]
    if (draft === undefined) return
    const capacity = Number(draft)
    if (Number.isInteger(capacity) && capacity > 0) {
      setLabs((current) => current.map((item) => item.id === lab.id ? { ...item, maxCapacity: capacity, currentVisitors: Math.min(item.currentVisitors, capacity) } : item))
    }
    setCapacityDrafts((current) => {
      const next = { ...current }
      delete next[lab.id]
      return next
    })
  }
  return <main className="admin-page"><header className="admin-header"><button className="back-button" onClick={onBack}><Icon name="back" size={18} /> <span>Back to map</span></button><div className="brand admin-brand"><span className="brand-pin"><Icon name="pin" size={17} /></span><span><strong>IOH</strong><small> ADMIN</small></span></div><span className="session-tag">LOCAL SESSION</span></header>
    <section className="admin-content"><div className="admin-title"><div><span className="eyebrow">EVENT OPERATIONS</span><h1>Lab capacity</h1><p>Manage visitor counts and access for the selected event slot.</p></div><label className="slot-select"><span>EVENT SLOT</span><select value={slot} onChange={(e) => setSlot(e.target.value)}>{slots.map((item) => <option key={item}>{item}</option>)}</select></label></div>
      <div className="admin-notice"><span aria-hidden="true">i</span><p>Prototype admin controls. Changes stay in this browser session and are not synchronized across devices. This switch is not secure authentication.</p></div>
      <div className="admin-labs">{labs.map((lab) => <article key={lab.id} className="admin-lab"><div className="admin-lab-heading"><div><h2>{lab.name}</h2><p>{lab.department}</p></div><span className={`access-pill ${lab.access}`}>{lab.access === 'open' ? 'Open' : lab.access === 'closed' ? 'Closed' : 'Restricted'}</span></div>
        <div className="admin-controls"><div className="count-control"><span>VISITORS</span><div><button onClick={() => update(lab.id, 'currentVisitors', Math.max(0, lab.currentVisitors - 1))} aria-label={`Decrease ${lab.name} visitors`}><Icon name="minus" size={14} /></button><strong>{lab.currentVisitors}</strong><button onClick={() => update(lab.id, 'currentVisitors', Math.min(lab.maxCapacity, lab.currentVisitors + 1))} aria-label={`Increase ${lab.name} visitors`}><Icon name="plus" size={14} /></button><small>/ {lab.maxCapacity}</small></div></div>
          <label className="capacity-edit"><span>MAX CAPACITY</span><input type="number" min="1" step="1" value={capacityDrafts[lab.id] ?? String(lab.maxCapacity)} onChange={(e) => setCapacityDrafts((current) => ({ ...current, [lab.id]: e.target.value }))} onBlur={() => commitCapacity(lab)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} /></label>
          <label className="access-edit"><span>ACCESS STATUS</span><select value={lab.access} onChange={(e) => update(lab.id, 'access', e.target.value as Lab['access'])}><option value="open">Open</option><option value="closed">Closed</option><option value="restricted">Restricted</option></select></label></div>
        <div className="admin-card-foot"><span className={`status-dot ${crowdFor(lab)}`} />{lab.currentVisitors} / {lab.maxCapacity} visitors &middot; {crowdLabels[crowdFor(lab)]}</div>
      </article>)}</div>
    </section>
  </main>
}

function getAppRoute(): 'visitor' | 'admin' {
  return window.location.pathname.replace(/\/+$/, '') === '/admin' ? 'admin' : 'visitor'
}

function useAppRoute() {
  const [route, setRoute] = useState<'visitor' | 'admin'>(getAppRoute)
  useEffect(() => {
    const handlePopState = () => setRoute(getAppRoute())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])
  function navigate(path: '/' | '/admin') {
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
    setRoute(path === '/admin' ? 'admin' : 'visitor')
  }
  return [route, navigate] as const
}

export default function App() {
  const [labs, setLabs] = useState(initialLabs)
  const [selected, setSelected] = useState<Lab | null>(null)
  const [page, navigate] = useAppRoute()
  const [slot, setSlot] = useState<string>(slots[0])
  const [resetKey, setResetKey] = useState(0)
  const [navigationActive, setNavigationActive] = useState(false)
  const geolocation = useGeolocation()
  const currentSelected = useMemo(() => labs.find((lab) => lab.id === selected?.id) || null, [labs, selected])
  return <>{page === 'visitor' ? <VisitorPage labs={labs} selected={currentSelected} setSelected={setSelected} geolocation={geolocation} resetKey={resetKey} setResetKey={setResetKey} navigationActive={navigationActive} setNavigationActive={setNavigationActive} /> : <AdminPage labs={labs} setLabs={setLabs} slot={slot} setSlot={setSlot} onBack={() => navigate('/')} />}</>
}
