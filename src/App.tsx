import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import '@tomickigrzegorz/leaflet-rotate'
import { crowdFor, initialLabs, slots, type CrowdStatus, type Lab } from './data/labs'
import { useGeolocation } from './hooks/useGeolocation'
import {
  computeRouteProgress,
  fetchWalkingRoute,
  smoothAngle,
  type RouteProgress,
  type WalkingRoute,
} from './utils/navigation'
import './App.css'

const CAMPUS: [number, number] = [12.9915, 80.2335]
const routeCasingStyle: L.PathOptions = { color: '#fff', weight: 12, opacity: 0.96, lineCap: 'round', lineJoin: 'round' }
const routeLineStyle: L.PathOptions = { color: '#3477d5', weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round' }

function getNavigationPositionIcon(arrowAngle: number) {
  return L.divIcon({
    className: 'navigation-position-wrap',
    html: `<span class="navigation-position"><span class="navigation-position-arrow" style="transform: rotate(${Math.round(arrowAngle)}deg)"></span></span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  })
}

type LabFilter = 'all' | CrowdStatus
const filters: { id: LabFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'filling', label: 'Filling fast' },
  { id: 'full', label: 'Full' },
]
const accessLabels: Record<Lab['access'], string> = { open: 'Open to visitors', closed: 'Closed', restricted: 'Access restricted' }
const crowdLabels: Record<CrowdStatus, string> = { open: 'Comfortable', filling: 'Filling fast', full: 'At capacity' }
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

function MapMotion({
  target,
  position,
  resetKey,
  locateKey,
  disabled,
}: {
  target: Lab | null
  position: [number, number] | null
  resetKey: number
  locateKey: number
  disabled: boolean
}) {
  const map = useMap()
  const didInitialLocate = useRef(false)
  const lastTarget = useRef<string | null>(null)
  const lastReset = useRef(resetKey)
  const lastLocate = useRef(locateKey)

  useEffect(() => {
    if (disabled) return

    if (target && target.id !== lastTarget.current) {
      lastTarget.current = target.id
      map.flyTo([target.latitude, target.longitude], Math.max(map.getZoom(), 17), { duration: 0.65 })
    } else if (!target && lastTarget.current) {
      lastTarget.current = null
    }

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
  }, [map, target, position, resetKey, locateKey, disabled])

  return null
}

function MarkerLayer({ labs, selected, onSelect }: { labs: Lab[]; selected: Lab | null; onSelect: (lab: Lab) => void }) {
  return labs.map((lab) => {
    const crowd = crowdFor(lab)
    const icon = L.divIcon({ className: `lab-marker-wrap ${crowd} ${selected?.id === lab.id ? 'selected' : ''}`, html: '<span class="lab-marker"></span>', iconSize: [28, 36], iconAnchor: [14, 31], popupAnchor: [0, -29] })
    return (
      <Marker key={lab.id} position={[lab.latitude, lab.longitude]} icon={icon} eventHandlers={{ click: () => onSelect(lab) }}>
        <Popup><strong>{lab.name}</strong><br />{lab.currentVisitors} / {lab.maxCapacity} visitors &middot; {crowdLabels[crowd]}<br /><span>{accessLabels[lab.access]}</span></Popup>
      </Marker>
    )
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
  return (
    <section className={`search-panel ${expanded ? '' : 'collapsed'}`} aria-label="Find a lab">
      <div className="brand-row"><div className="brand"><span className="brand-pin"><Icon name="pin" size={17} /></span><span><strong>IOH</strong><small> CAMPUS GUIDE</small></span></div><button type="button" className="icon-button panel-toggle" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Collapse lab list' : 'Expand lab list'}><Icon name={expanded ? 'chevron-up' : 'chevron-down'} /></button></div>
      {expanded && <>
        <form className="search-box" role="search" onSubmit={(event) => event.preventDefault()}>
          <button type="submit" className="search-submit" aria-label="Search labs"><Icon name="search" size={19} /></button>
          <input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); event.currentTarget.blur() } }} placeholder="Search labs or buildings" aria-label="Search labs or buildings" aria-controls="lab-search-results" autoComplete="off" autoCorrect="off" spellCheck={false} />
          {query && <button type="button" className="search-clear" aria-label="Clear search" onClick={() => { setQuery(''); searchInput.current?.focus() }}><Icon name="close" size={17} /></button>}
        </form>
        <div className="filter-row" aria-label="Filter labs">{filters.map(({ id, label }) => <button key={id} className={`filter-chip ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{label}</button>)}</div>
        <div className="list-heading"><span>{normalizedQuery ? 'SEARCH RESULTS' : 'EXPLORE CAMPUS'}</span><span aria-live="polite">{visible.length} {visible.length === 1 ? 'place' : 'places'}</span></div>
        <div className="lab-list" id="lab-search-results" aria-live="polite">{visible.map((lab) => (
          <button key={lab.id} className={`lab-row ${selected?.id === lab.id ? 'chosen' : ''}`} onClick={() => onSelect(lab)}>
            <span className={`status-dot ${crowdFor(lab)}`} /><span className="lab-copy"><strong>{lab.name}</strong><small>{lab.department}</small><small className="row-meta">{lab.currentVisitors} / {lab.maxCapacity} visitors <i>&middot;</i> {accessLabels[lab.access]}</small></span><span className="row-arrow"><Icon name="chevron-right" size={16} /></span>
          </button>
        ))}{visible.length === 0 && <div className="empty-state"><p>No labs match your search.</p><button type="button" onClick={() => { setQuery(''); setFilter('all'); searchInput.current?.focus() }}>Clear search and filters</button></div>}</div>
        <div className="panel-foot"><span className="demo-mark" /> Demo data &middot; locations unverified</div>
      </>}
    </section>
  )
}

function DetailsCard({
  lab,
  onClose,
  onDirections,
  route,
  routeState,
  routeError,
}: {
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
  return (
    <section className="details-card" aria-label={`${lab.name} details`}>
      <div className="detail-top"><div><span className="eyebrow">LAB DETAILS</span><h2>{lab.name}</h2><p>{lab.department}</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close lab details"><Icon name="close" /></button></div>
      <div className="capacity-heading"><span>Current visitors</span><strong>{lab.currentVisitors} <small>/ {lab.maxCapacity}</small></strong></div>
      <div className="progress-track" role="progressbar" aria-label="Lab capacity" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span className={crowd} style={{ width: `${pct}%` }} /></div>
      <div className="capacity-foot"><span>{pct}% capacity</span><span className={`crowd-label ${crowd}`}><i />{crowdLabels[crowd]}</span></div>
      <div className="detail-info"><div><span className="info-icon"><Icon name="clock" size={16} /></span><span><small>OPENING HOURS</small><strong>{lab.openingTime} &ndash; {lab.closingTime}</strong></span></div><div><span className="info-icon"><Icon name="access" size={16} /></span><span><small>ACCESS</small><strong className={lab.access !== 'open' ? 'access-alert' : ''}>{accessLabels[lab.access]}</strong></span></div></div>
      <p className="description">{lab.description}</p>
      <div className="detail-actions"><button className="directions-button" onClick={() => onDirections(lab)}><Icon name="directions" size={17} /> Directions</button><span className="coords-note">Illustrative location</span></div>
      {routeState === 'loading' && <p className="route-message" role="status">Finding a walking route from your position&hellip;</p>}
      {routeState === 'error' && <p className="route-message route-error" role="status">{routeError}</p>}
      {routeState === 'ready' && route && (
        <div className="route-results">
          <div className="route-summary">
            <strong>{route.distanceKm < 1 ? `${Math.round(route.distanceKm * 1000)} m` : `${route.distanceKm.toFixed(1)} km`}</strong>
            <span>&middot;</span>
            <strong>{Math.max(1, Math.ceil(route.durationSeconds / 60))} min walk</strong>
            <small>{route.source === 'direct' ? 'direct path' : 'via OpenStreetMap'}</small>
          </div>
          <ol>{route.instructions.map((step, index) => <li key={`${index}-${step.text}`}>{step.text}</li>)}</ol>
        </div>
      )}
    </section>
  )
}

function MapControls({ onZoom, onLocate, onReset, locating, detailsOpen }: { onZoom: (delta: number) => void; onLocate: () => void; onReset: () => void; locating: boolean; detailsOpen: boolean }) {
  return (
    <div className={`map-controls ${detailsOpen ? 'with-details' : ''}`}>
      <div className="zoom-control"><button onClick={() => onZoom(1)} aria-label="Zoom in"><Icon name="plus" size={18} /></button><span /><button onClick={() => onZoom(-1)} aria-label="Zoom out"><Icon name="minus" size={18} /></button></div>
      <button onClick={onLocate} aria-label="Locate me" title="Locate me" className={locating ? 'locating' : ''}><Icon name="locate" /></button>
      <button onClick={onReset} aria-label="Reset map view" title="Reset map view"><Icon name="reset" /></button>
    </div>
  )
}

function DirectionsPanel({
  lab,
  route,
  progress,
  status,
  error,
  onBack,
  onRetry,
}: {
  lab: Lab
  route: WalkingRoute | null
  progress: RouteProgress | null
  status: RouteState
  error: string
  onBack: () => void
  onRetry: () => void
}) {
  const distanceText = progress
    ? progress.distanceKm < 1 ? `${progress.distanceMeters} m` : `${progress.distanceKm.toFixed(1)} km`
    : route ? route.distanceKm < 1 ? `${Math.round(route.distanceKm * 1000)} m` : `${route.distanceKm.toFixed(1)} km` : ''

  const durationMinutes = Math.max(
    1,
    Math.ceil((progress ? progress.durationSeconds : (route?.durationSeconds ?? 60)) / 60),
  )

  const isArrived = progress ? progress.distanceMeters <= 15 : false

  return (
    <section className="directions-panel" aria-label="Walking directions">
      <header className="directions-header">
        <button className="icon-button directions-back" onClick={onBack} aria-label="Back to map"><Icon name="back" /></button>
        <div>
          <span className="eyebrow">WALKING DIRECTIONS</span>
          <h2>{lab.name}</h2>
        </div>
        <button className="icon-button directions-close" onClick={onBack} aria-label="Close directions"><Icon name="close" /></button>
      </header>

      {status === 'loading' && !route && (
        <div className="directions-loading">
          <span className="route-spinner" />
          <span>Finding a walking route&hellip;</span>
        </div>
      )}

      {status === 'error' && !route && (
        <div className="directions-error">
          <p>{error}</p>
          <button onClick={onRetry}>Try again</button>
        </div>
      )}

      {route && (
        <>
          <div className="directions-summary">
            <span className="summary-walk"><Icon name="directions" size={17} /><strong>Walk</strong></span>
            <strong>{distanceText}</strong>
            <span>{durationMinutes} min</span>
            {route.source === 'direct' && <small>(direct path)</small>}
          </div>

          <div className="direction-current-step">
            <span>
              {isArrived
                ? 'DESTINATION REACHED'
                : progress?.currentInstruction
                  ? `STEP ${progress.stepIndex + 1} OF ${route.instructions.length}`
                  : 'FOLLOW THE BLUE LINE'}
            </span>
            <strong>
              {isArrived
                ? `You have arrived at ${lab.name}.`
                : (progress?.currentInstruction?.text ?? 'Continue along the highlighted path.')}
            </strong>
          </div>

          <ol className="directions-steps">
            {route.instructions.map((step, index) => (
              <li key={`${index}-${step.text}`} className={index === (progress?.stepIndex ?? 0) ? 'current' : ''}>
                {step.text}
              </li>
            ))}
          </ol>
          <p className="directions-footnote">Route follows campus pedestrian paths. Lab pin and paths are illustrative.</p>
        </>
      )}
    </section>
  )
}

function VisitorPage({
  labs,
  selected,
  setSelected,
  geolocation,
  resetKey,
  setResetKey,
  navigationActive,
  setNavigationActive,
}: {
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
  const [routeState, setRouteState] = useState<RouteState>('idle')
  const [routeError, setRouteError] = useState('')
  const [routeRequestKey, setRouteRequestKey] = useState(0)
  const [locateKey, setLocateKey] = useState(0)
  const [followKey, setFollowKey] = useState(0)
  const [isFollowing, setIsFollowing] = useState(true)
  const [navMode, setNavMode] = useState<'heading-up' | 'north-up'>('heading-up')
  const [mapBearing, setMapBearing] = useState(0)

  const requestSequence = useRef(0)
  const offRouteCounter = useRef(0)
  const lastRerouteAt = useRef(0)

  // Compute live progress along polyline
  const routeForSelected = route?.labId === selected?.id ? route : null
  const progress = useMemo(() => {
    if (!routeForSelected || !geolocation.position) return null
    return computeRouteProgress(routeForSelected, geolocation.position)
  }, [routeForSelected, geolocation.position])

  const userPos = geolocation.position
  const locate = geolocation.locate
  const hasRoute = Boolean(route)
  const currentRouteLabId = route?.labId

  // Fetch initial walking route with multi-tier fallback
  useEffect(() => {
    if (!navigationActive || !selected) {
      requestSequence.current += 1
      return
    }

    if (!userPos) {
      locate()
      return
    }

    const requestId = ++requestSequence.current
    window.setTimeout(() => {
      if (requestId === requestSequence.current) {
        setRouteError('')
        if (currentRouteLabId !== selected.id) {
          setRouteState('loading')
        }
      }
    }, 0)

    fetchWalkingRoute(selected.id, userPos, [selected.latitude, selected.longitude], selected.name)
      .then((newRoute) => {
        if (requestId !== requestSequence.current) return
        setRoute(newRoute)
        setRouteState('ready')
      })
      .catch((err: unknown) => {
        if (requestId !== requestSequence.current) return
        if (!hasRoute) {
          setRouteError(err instanceof Error ? err.message : 'Walking directions are unavailable right now.')
          setRouteState('error')
        }
      })
  }, [navigationActive, selected, routeRequestKey, userPos, locate, currentRouteLabId, hasRoute])

  // Background rerouting only when user genuinely walks off-route (> 38m away)
  const isOffRoute = progress?.isOffRoute ?? false
  useEffect(() => {
    if (!navigationActive || !selected || !route || !geolocation.position) return

    if (!isOffRoute) {
      offRouteCounter.current = 0
      return
    }

    // Require 3 consecutive readings off-route to avoid single-second GPS spikes
    offRouteCounter.current += 1
    if (offRouteCounter.current < 3) return

    const now = Date.now()
    if (now - lastRerouteAt.current < 10000) return
    lastRerouteAt.current = now

    const currentPos = geolocation.position
    fetchWalkingRoute(selected.id, currentPos, [selected.latitude, selected.longitude], selected.name)
      .then((newRoute) => {
        setRoute(newRoute)
        offRouteCounter.current = 0
      })
      .catch(() => {
        // Silently preserve current route if background reroute fails
      })
  }, [navigationActive, selected, route, geolocation.position, isOffRoute])

  function directions(lab: Lab) {
    setSelected(lab)
    setNavigationActive(true)
    setIsFollowing(true)
    if (!geolocation.position) geolocation.locate()
    setRouteRequestKey((current) => current + 1)
  }

  function zoom(delta: number) {
    window.dispatchEvent(new CustomEvent<number>('ioh-map-zoom', { detail: delta }))
  }

  function locateAndCenter() {
    geolocation.locate()
    setLocateKey((current) => current + 1)
  }

  function focusNavigationPosition() {
    geolocation.locate()
    setIsFollowing(true)
    setFollowKey((current) => current + 1)
  }

  const toggleNavMode = useCallback(() => {
    setNavMode((current) => (current === 'heading-up' ? 'north-up' : 'heading-up'))
  }, [])

  const handleUserPan = useCallback(() => {
    setIsFollowing(false)
  }, [])

  // Position arrow angle:
  // In North-Up, arrow rotates to user travel heading (compass / movement / lookahead).
  // In Heading-Up, the map itself rotates, so arrow points straight up.
  const effectiveHeading = geolocation.heading ?? progress?.lookAheadBearing ?? 0
  const navArrowAngle = navMode === 'heading-up' ? 0 : effectiveHeading
  const navigationPositionIcon = useMemo(() => getNavigationPositionIcon(navArrowAngle), [navArrowAngle])

  return (
    <main className="visitor-page">
      <MapContainer
        center={CAMPUS}
        zoom={16}
        minZoom={3}
        maxZoom={20}
        zoomSnap={0.25}
        zoomDelta={1}
        wheelPxPerZoomLevel={120}
        wheelDebounceTime={60}
        rotate
        bearing={0}
        touchRotate={false}
        dragRotate={false}
        shiftKeyRotate={false}
        zoomControl={false}
        className="map"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxNativeZoom={19}
          maxZoom={20}
          keepBuffer={4}
          updateWhenIdle={false}
          updateWhenZooming={false}
        />
        <MapMotion target={selected} position={geolocation.position} resetKey={resetKey} locateKey={locateKey} disabled={navigationActive} />
        <MapEventBridge />
        <MapNavigationCamera
          active={navigationActive}
          position={geolocation.position}
          heading={geolocation.heading}
          routeBearing={progress?.lookAheadBearing ?? null}
          navMode={navMode}
          isFollowing={isFollowing}
          onUserPan={handleUserPan}
          setMapBearing={setMapBearing}
          followKey={followKey}
        />
        {!navigationActive && <MarkerLayer labs={labs} selected={selected} onSelect={setSelected} />}
        {navigationActive && selected && <MarkerLayer labs={[selected]} selected={selected} onSelect={setSelected} />}
        {geolocation.position && (navigationActive ? (
          <Marker position={geolocation.position} icon={navigationPositionIcon} zIndexOffset={1000}>
            <Popup>Your current location</Popup>
          </Marker>
        ) : (
          <CircleMarker center={geolocation.position} radius={7} pathOptions={{ color: '#fff', weight: 3, fillColor: '#4386f5', fillOpacity: 1 }}>
            <Popup>Your current location</Popup>
          </CircleMarker>
        ))}
        {navigationActive && routeForSelected && (
          <>
            <Polyline positions={routeForSelected.points} pathOptions={routeCasingStyle} />
            <Polyline positions={routeForSelected.points} pathOptions={routeLineStyle} />
          </>
        )}
      </MapContainer>

      {!navigationActive && <SearchPanel labs={labs} selected={selected} onSelect={setSelected} />}
      {!navigationActive && <div className="map-caption"><span className="caption-dot" /> IIT Madras &middot; Chennai <span className="caption-divider">|</span> Campus paths may be incomplete</div>}
      {!navigationActive && <MapControls onZoom={zoom} onLocate={locateAndCenter} locating={geolocation.loading} detailsOpen={Boolean(selected)} onReset={() => { setSelected(null); setResetKey((v) => v + 1) }} />}

      {navigationActive && (
        <>
          <button
            type="button"
            className="compass-control"
            onClick={toggleNavMode}
            aria-label={navMode === 'heading-up' ? 'Switch to North-up view' : 'Switch to Heading-up view'}
            title={navMode === 'heading-up' ? 'Switch to North-up view' : 'Switch to Heading-up view'}
          >
            <span className="compass-needle-wrap" style={{ transform: `rotate(${-mapBearing}deg)` }}>
              <i className="needle-north" />
              <i className="needle-south" />
            </span>
            <span className="compass-badge">{navMode === 'heading-up' ? 'HDG' : 'N'}</span>
          </button>

          <button
            type="button"
            className={`follow-control ${!isFollowing ? 'uncentered' : ''}`}
            onClick={focusNavigationPosition}
            aria-label="Return to my current location"
            title="Return to my current location"
          >
            {!isFollowing && <span className="recenter-badge">Re-center</span>}
            <Icon name="locate" size={21} />
          </button>
        </>
      )}

      {!navigationActive && (
        <DetailsCard
          lab={selected}
          onClose={() => setSelected(null)}
          onDirections={directions}
          route={routeForSelected}
          routeState={routeState}
          routeError={routeError}
        />
      )}

      {navigationActive && selected && (
        <DirectionsPanel
          lab={selected}
          route={routeForSelected}
          progress={progress}
          status={routeState}
          error={routeError}
          onBack={() => setNavigationActive(false)}
          onRetry={() => directions(selected)}
        />
      )}

      {!navigationActive && geolocation.error && (
        <div className="toast" role="status">
          <span>{geolocation.error}</span>
          <button onClick={geolocation.clearError} aria-label="Dismiss message">&times;</button>
        </div>
      )}
    </main>
  )
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

function MapNavigationCamera({
  active,
  position,
  heading,
  routeBearing,
  navMode,
  isFollowing,
  onUserPan,
  setMapBearing,
  followKey,
}: {
  active: boolean
  position: [number, number] | null
  heading: number | null
  routeBearing: number | null
  navMode: 'heading-up' | 'north-up'
  isFollowing: boolean
  onUserPan: () => void
  setMapBearing: Dispatch<SetStateAction<number>>
  followKey: number
}) {
  const map = useMap()
  const wasActive = useRef(false)
  const previousFollowKey = useRef(followKey)
  const currentHeadingRef = useRef(0)

  // Listen to manual map drag or touch gesture to stop auto-panning
  useEffect(() => {
    const handleDragStart = () => {
      onUserPan()
    }
    const handleRotate = () => {
      if (typeof map.getBearing === 'function') {
        setMapBearing(Math.round(map.getBearing()))
      }
    }
    map.on('dragstart', handleDragStart)
    map.on('rotatestart', handleDragStart)
    map.on('rotate', handleRotate)
    return () => {
      map.off('dragstart', handleDragStart)
      map.off('rotatestart', handleDragStart)
      map.off('rotate', handleRotate)
    }
  }, [map, onUserPan, setMapBearing])

  // Handle deactivation
  useEffect(() => {
    if (!active) {
      if (wasActive.current) {
        if (typeof map.stopHeadingUp === 'function') map.stopHeadingUp()
        if (typeof map.setBearing === 'function') map.setBearing(0)
        setMapBearing(0)
        wasActive.current = false
      }
      return
    }
    wasActive.current = true
  }, [active, map, setMapBearing])

  // Camera positioning and orientation
  useEffect(() => {
    if (!active || !position) return

    const requestedFollow = followKey !== previousFollowKey.current
    previousFollowKey.current = followKey

    if (!wasActive.current || requestedFollow) {
      map.stop()
      map.flyTo(position, 17.5, { duration: 0.5 })
      wasActive.current = true
      return
    }

    if (!isFollowing) return

    if (navMode === 'heading-up') {
      const targetHeading = heading ?? routeBearing ?? 0
      const smoothed = smoothAngle(currentHeadingRef.current, targetHeading, 0.22)
      currentHeadingRef.current = smoothed

      if (typeof map.setHeading === 'function') {
        map.setHeading(smoothed, { ease: 0.16, deadzone: 2 })
      }

      // Smoothly offset pointer towards bottom without competing pan animations
      const size = map.getSize()
      const currentPoint = map.latLngToContainerPoint(position)
      const targetPoint = L.point(size.x / 2, size.y * 0.70)
      const diff = currentPoint.subtract(targetPoint)
      if (diff.distanceTo(L.point(0, 0)) > 6) {
        map.panBy(diff, { animate: false })
      }
    } else {
      // North-up mode
      if (typeof map.stopHeadingUp === 'function') map.stopHeadingUp()
      if (typeof map.setBearing === 'function' && map.getBearing() !== 0) {
        map.setBearing(0)
        setMapBearing(0)
      }

      const size = map.getSize()
      const currentPoint = map.latLngToContainerPoint(position)
      const targetPoint = L.point(size.x / 2, size.y * 0.60)
      const diff = currentPoint.subtract(targetPoint)
      if (diff.distanceTo(L.point(0, 0)) > 6) {
        map.panBy(diff, { animate: false })
      }
    }
  }, [active, position, heading, routeBearing, navMode, isFollowing, followKey, map, setMapBearing])

  return null
}

function AdminPage({
  labs,
  setLabs,
  slot,
  setSlot,
  onBack,
}: {
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
  return (
    <main className="admin-page">
      <header className="admin-header">
        <button className="back-button" onClick={onBack}><Icon name="back" size={18} /> <span>Back to map</span></button>
        <div className="brand admin-brand"><span className="brand-pin"><Icon name="pin" size={17} /></span><span><strong>IOH</strong><small> ADMIN</small></span></div>
        <span className="session-tag">LOCAL SESSION</span>
      </header>
      <section className="admin-content">
        <div className="admin-title">
          <div><span className="eyebrow">EVENT OPERATIONS</span><h1>Lab capacity</h1><p>Manage visitor counts and access for the selected event slot.</p></div>
          <label className="slot-select"><span>EVENT SLOT</span><select value={slot} onChange={(e) => setSlot(e.target.value)}>{slots.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <div className="admin-notice"><span aria-hidden="true">i</span><p>Prototype admin controls. Changes stay in this browser session and are not synchronized across devices. This switch is not secure authentication.</p></div>
        <div className="admin-labs">
          {labs.map((lab) => (
            <article key={lab.id} className="admin-lab">
              <div className="admin-lab-heading"><div><h2>{lab.name}</h2><p>{lab.department}</p></div><span className={`access-pill ${lab.access}`}>{lab.access === 'open' ? 'Open' : lab.access === 'closed' ? 'Closed' : 'Restricted'}</span></div>
              <div className="admin-controls">
                <div className="count-control">
                  <span>VISITORS</span>
                  <div>
                    <button onClick={() => update(lab.id, 'currentVisitors', Math.max(0, lab.currentVisitors - 1))} aria-label={`Decrease ${lab.name} visitors`}><Icon name="minus" size={14} /></button>
                    <strong>{lab.currentVisitors}</strong>
                    <button onClick={() => update(lab.id, 'currentVisitors', Math.min(lab.maxCapacity, lab.currentVisitors + 1))} aria-label={`Increase ${lab.name} visitors`}><Icon name="plus" size={14} /></button>
                    <small>/ {lab.maxCapacity}</small>
                  </div>
                </div>
                <label className="capacity-edit">
                  <span>MAX CAPACITY</span>
                  <input type="number" min="1" step="1" value={capacityDrafts[lab.id] ?? String(lab.maxCapacity)} onChange={(e) => setCapacityDrafts((current) => ({ ...current, [lab.id]: e.target.value }))} onBlur={() => commitCapacity(lab)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                </label>
                <label className="access-edit">
                  <span>ACCESS STATUS</span>
                  <select value={lab.access} onChange={(e) => update(lab.id, 'access', e.target.value as Lab['access'])}>
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                    <option value="restricted">Restricted</option>
                  </select>
                </label>
              </div>
              <div className="admin-card-foot"><span className={`status-dot ${crowdFor(lab)}`} />{lab.currentVisitors} / {lab.maxCapacity} visitors &middot; {crowdLabels[crowdFor(lab)]}</div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
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

  return (
    <>
      {page === 'visitor' ? (
        <VisitorPage
          labs={labs}
          selected={currentSelected}
          setSelected={setSelected}
          geolocation={geolocation}
          resetKey={resetKey}
          setResetKey={setResetKey}
          navigationActive={navigationActive}
          setNavigationActive={setNavigationActive}
        />
      ) : (
        <AdminPage labs={labs} setLabs={setLabs} slot={slot} setSlot={setSlot} onBack={() => navigate('/')} />
      )}
    </>
  )
}
