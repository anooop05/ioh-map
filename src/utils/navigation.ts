export interface RouteInstruction {
  text: string
  endIndex: number
}

export interface WalkingRoute {
  labId: string
  origin: [number, number]
  destination: [number, number]
  points: [number, number][]
  cumulativeMeters: number[]
  distanceKm: number
  durationSeconds: number
  instructions: RouteInstruction[]
  source?: 'valhalla' | 'osrm' | 'direct'
}

export interface RouteProgress {
  distanceMeters: number
  distanceKm: number
  durationSeconds: number
  stepIndex: number
  currentInstruction: RouteInstruction | null
  lookAheadBearing: number
  distanceOffRoute: number
  isOffRoute: boolean
}

export function distanceMeters(start: [number, number], end: [number, number]): number {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const lat1 = radians(start[0])
  const lat2 = radians(end[0])
  const deltaLat = lat2 - lat1
  const deltaLon = radians(end[1] - start[1])
  const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

export function bearingBetween(start: [number, number], end: [number, number]): number {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const lat1 = radians(start[0])
  const lat2 = radians(end[0])
  const deltaLon = radians(end[1] - start[1])
  const y = Math.sin(deltaLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

export function smoothAngle(current: number, target: number, alpha = 0.25): number {
  const diff = ((((target - current) + 540) % 360) - 180)
  return (current + diff * alpha + 360) % 360
}

export function decodePolyline6(encoded: string): [number, number][] {
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

export function cumulativeRouteMeters(points: [number, number][]): number[] {
  const cumulative = new Array<number>(points.length).fill(0)
  for (let index = 1; index < points.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + distanceMeters(points[index - 1], points[index])
  }
  return cumulative
}

export function projectOnSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): { t: number; pt: [number, number]; dist: number } {
  const cosLat = Math.cos(a[0] * Math.PI / 180)
  const vx = (b[1] - a[1]) * cosLat * 111319.5
  const vy = (b[0] - a[0]) * 111132.9
  const px = (p[1] - a[1]) * cosLat * 111319.5
  const py = (p[0] - a[0]) * 111132.9
  const lenSq = vx * vx + vy * vy
  if (lenSq < 1e-4) return { t: 0, pt: a, dist: distanceMeters(p, a) }
  const t = Math.max(0, Math.min(1, (px * vx + py * vy) / lenSq))
  const pt: [number, number] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
  return { t, pt, dist: distanceMeters(p, pt) }
}

export function computeRouteProgress(
  route: WalkingRoute,
  position: [number, number],
  minRemainingDistanceMeters?: number,
): RouteProgress {
  const { points, cumulativeMeters, instructions } = route
  const totalMeters = cumulativeMeters.at(-1) ?? 0

  if (points.length < 2) {
    const d = distanceMeters(position, route.destination)
    return {
      distanceMeters: Math.round(d),
      distanceKm: d / 1000,
      durationSeconds: Math.ceil(d / 1.2),
      stepIndex: 0,
      currentInstruction: instructions[0] ?? null,
      lookAheadBearing: 0,
      distanceOffRoute: 0,
      isOffRoute: false,
    }
  }

  let bestDist = Number.POSITIVE_INFINITY
  let bestSeg = 0
  let bestT = 0
  let bestPt = points[0]

  for (let i = 0; i < points.length - 1; i += 1) {
    const proj = projectOnSegment(position, points[i], points[i + 1])
    if (proj.dist < bestDist) {
      bestDist = proj.dist
      bestSeg = i
      bestT = proj.t
      bestPt = proj.pt
    }
  }

  const isOffRoute = bestDist > 38
  const segLen = cumulativeMeters[bestSeg + 1] - cumulativeMeters[bestSeg]
  const walkedMeters = cumulativeMeters[bestSeg] + bestT * segLen
  let rawRemaining = Math.max(0, totalMeters - walkedMeters)

  // Avoid jumping upwards due to small GPS jitter while on track
  if (!isOffRoute && minRemainingDistanceMeters !== undefined && minRemainingDistanceMeters > 0) {
    if (rawRemaining > minRemainingDistanceMeters && rawRemaining - minRemainingDistanceMeters < 18) {
      rawRemaining = minRemainingDistanceMeters
    }
  }

  // Look-ahead bearing: look 22m ahead along polyline from current projected point
  const lookAheadDist = Math.min(totalMeters, walkedMeters + 22)
  let lookAheadPt = points[points.length - 1]
  for (let i = bestSeg; i < points.length - 1; i += 1) {
    if (cumulativeMeters[i + 1] >= lookAheadDist) {
      const segSpan = cumulativeMeters[i + 1] - cumulativeMeters[i]
      const frac = segSpan > 0 ? (lookAheadDist - cumulativeMeters[i]) / segSpan : 0
      lookAheadPt = [
        points[i][0] + frac * (points[i + 1][0] - points[i][0]),
        points[i][1] + frac * (points[i + 1][1] - points[i][1]),
      ]
      break
    }
  }

  const lookAheadBearing = bearingBetween(bestPt, lookAheadPt)

  // Determine current maneuver step
  let stepIndex = 0
  if (instructions.length > 0) {
    const foundIndex = instructions.findIndex((step) => step.endIndex > bestSeg)
    stepIndex = foundIndex >= 0 ? foundIndex : instructions.length - 1
  }
  const currentInstruction = instructions[stepIndex] ?? null

  const remainingRatio = totalMeters > 0 ? rawRemaining / totalMeters : 0
  const durationSeconds = Math.ceil(route.durationSeconds * remainingRatio)

  return {
    distanceMeters: Math.round(rawRemaining),
    distanceKm: rawRemaining / 1000,
    durationSeconds,
    stepIndex,
    currentInstruction,
    lookAheadBearing,
    distanceOffRoute: Math.round(bestDist),
    isOffRoute,
  }
}

export function createDirectRoute(
  labId: string,
  origin: [number, number],
  dest: [number, number],
  destName: string,
): WalkingRoute {
  const distM = distanceMeters(origin, dest)
  const stepsCount = 10
  const points: [number, number][] = []
  for (let i = 0; i <= stepsCount; i += 1) {
    const f = i / stepsCount
    points.push([origin[0] + f * (dest[0] - origin[0]), origin[1] + f * (dest[1] - origin[1])])
  }
  return {
    labId,
    origin,
    destination: dest,
    points,
    cumulativeMeters: cumulativeRouteMeters(points),
    distanceKm: distM / 1000,
    durationSeconds: Math.ceil(distM / 1.2),
    instructions: [
      { text: `Walk toward ${destName}`, endIndex: points.length - 1 },
      { text: `Arrive at ${destName}`, endIndex: points.length - 1 },
    ],
    source: 'direct',
  }
}

async function fetchFromValhalla(
  labId: string,
  origin: [number, number],
  dest: [number, number],
  destName: string,
  signal?: AbortSignal,
): Promise<WalkingRoute> {
  const response = await fetch('https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'ioh-campus-guide-prototype' },
    body: JSON.stringify({
      locations: [
        { lat: origin[0], lon: origin[1] },
        { lat: dest[0], lon: dest[1], name: destName },
      ],
      costing: 'pedestrian',
      units: 'kilometers',
    }),
    signal,
  })

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

  if (!response.ok || result.trip?.status !== 0) {
    throw new Error(result.error_message || result.error || result.trip?.status_message || 'Valhalla route error')
  }

  const summary = result.trip.summary
  const points = result.trip.legs?.flatMap((leg) => decodePolyline6(leg.shape ?? '')) ?? []
  const instructions = result.trip.legs?.flatMap((leg) =>
    leg.maneuvers?.map((maneuver) => ({
      text: maneuver.instruction ?? '',
      endIndex: maneuver.end_shape_index ?? Number.MAX_SAFE_INTEGER,
    })).filter((step): step is RouteInstruction => Boolean(step.text)) ?? []
  ) ?? []

  if (!summary || !Number.isFinite(summary.length) || !Number.isFinite(summary.time) || points.length < 2) {
    throw new Error('Incomplete Valhalla directions')
  }

  return {
    labId,
    origin,
    destination: dest,
    points,
    cumulativeMeters: cumulativeRouteMeters(points),
    distanceKm: summary.length as number,
    durationSeconds: summary.time as number,
    instructions,
    source: 'valhalla',
  }
}

async function fetchFromOsrm(
  labId: string,
  origin: [number, number],
  dest: [number, number],
  destName: string,
  signal?: AbortSignal,
): Promise<WalkingRoute> {
  const url = `https://router.project-osrm.org/route/v1/walking/${origin[1]},${origin[0]};${dest[1]},${dest[0]}?overview=full&geometries=geojson&steps=true`
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`)

  const data = await response.json() as {
    code?: string
    routes?: {
      distance: number
      duration: number
      geometry: { coordinates: [number, number][] }
      legs: {
        steps: {
          name?: string
          maneuver: { type: string; modifier?: string; location: [number, number] }
        }[]
      }[]
    }[]
  }

  if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
    throw new Error('No OSRM walking route found')
  }

  const route = data.routes[0]
  const points: [number, number][] = route.geometry.coordinates.map(([lon, lat]) => [lat, lon])
  if (points.length < 2) throw new Error('OSRM route points too short')

  const instructions: RouteInstruction[] = []
  let currentIdx = 0
  const steps = route.legs?.[0]?.steps ?? []

  for (const step of steps) {
    const name = step.name ? step.name.trim() : ''
    const mod = step.maneuver.modifier ? ` ${step.maneuver.modifier}` : ''
    let text: string

    if (step.maneuver.type === 'depart') {
      text = `Head ${name ? `on ${name}` : `toward ${destName}`}`
    } else if (step.maneuver.type === 'arrive') {
      text = `Arrive at ${destName}`
    } else if (step.maneuver.type === 'turn' || step.maneuver.type === 'end of road') {
      text = `Turn${mod}${name ? ` onto ${name}` : ''}`
    } else {
      text = `${step.maneuver.type.charAt(0).toUpperCase()}${step.maneuver.type.slice(1)}${mod}${name ? ` onto ${name}` : ''}`
    }

    const stepCoord: [number, number] = [step.maneuver.location[1], step.maneuver.location[0]]
    let bestIdx = currentIdx
    let bestDist = Number.POSITIVE_INFINITY
    for (let i = currentIdx; i < points.length; i += 1) {
      const d = Math.hypot(points[i][0] - stepCoord[0], points[i][1] - stepCoord[1])
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    currentIdx = Math.max(currentIdx, bestIdx)
    instructions.push({ text: text.trim(), endIndex: currentIdx })
  }

  if (instructions.length > 0) {
    instructions[instructions.length - 1].endIndex = points.length - 1
  }

  return {
    labId,
    origin,
    destination: dest,
    points,
    cumulativeMeters: cumulativeRouteMeters(points),
    distanceKm: route.distance / 1000,
    durationSeconds: route.duration,
    instructions,
    source: 'osrm',
  }
}

export async function fetchWalkingRoute(
  labId: string,
  origin: [number, number],
  dest: [number, number],
  destName: string,
): Promise<WalkingRoute> {
  // 1. Try Valhalla with a 5.5s timeout
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5500)
    const route = await fetchFromValhalla(labId, origin, dest, destName, controller.signal)
    clearTimeout(timer)
    return route
  } catch {
    // Continue to fallback
  }

  // 2. Try OSRM with a 5s timeout
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const route = await fetchFromOsrm(labId, origin, dest, destName, controller.signal)
    clearTimeout(timer)
    return route
  } catch {
    // Continue to fallback
  }

  // 3. Guaranteed offline/campus direct path fallback
  return createDirectRoute(labId, origin, dest, destName)
}
