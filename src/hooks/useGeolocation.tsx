import { useCallback, useEffect, useRef, useState } from 'react'
import { bearingBetween, distanceMeters } from '../utils/navigation'

function unavailableMessage() {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Location needs HTTPS on your phone. Open this app over HTTPS, or use localhost on the same device.'
  }
  return typeof navigator !== 'undefined' && !navigator.geolocation ? 'Location is not available in this browser.' : ''
}

export function useGeolocation() {
  const [position, setPosition] = useState<[number, number] | null>(null)
  const [heading, setHeading] = useState<number | null>(null)
  const [compassHeading, setCompassHeading] = useState<number | null>(null)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [error, setError] = useState(unavailableMessage)
  const [loading, setLoading] = useState(() => typeof navigator !== 'undefined' && Boolean(navigator.geolocation))

  const lastPosition = useRef<[number, number] | null>(null)
  const compassHeadingRef = useRef<number | null>(null)
  const movementHeadingRef = useRef<number | null>(null)

  // Listen to device compass / orientation events on smartphones
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleOrientation = (event: DeviceOrientationEvent) => {
      let deg: number | null = null
      // iOS WebKit compass
      if ('webkitCompassHeading' in event && typeof (event as unknown as { webkitCompassHeading: number }).webkitCompassHeading === 'number') {
        deg = (event as unknown as { webkitCompassHeading: number }).webkitCompassHeading
      } else if (event.alpha !== null && typeof event.alpha === 'number') {
        // Android Chrome absolute / standard orientation
        deg = (360 - event.alpha) % 360
      }

      if (deg !== null && Number.isFinite(deg)) {
        const rounded = Math.round(deg)
        compassHeadingRef.current = rounded
        setCompassHeading(rounded)
      }
    }

    window.addEventListener('deviceorientationabsolute', handleOrientation, true)
    window.addEventListener('deviceorientation', handleOrientation, true)

    return () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation, true)
      window.removeEventListener('deviceorientation', handleOrientation, true)
    }
  }, [])

  const updatePosition = useCallback((result: GeolocationPosition) => {
    const measured: [number, number] = [result.coords.latitude, result.coords.longitude]
    const previous = lastPosition.current
    const acc = result.coords.accuracy ?? 15
    setAccuracy(acc)

    // Dynamic smoothing based on GPS accuracy
    const smoothing = acc <= 8 ? 0.6 : acc <= 20 ? 0.42 : 0.25
    const next: [number, number] = previous
      ? [previous[0] + (measured[0] - previous[0]) * smoothing, previous[1] + (measured[1] - previous[1]) * smoothing]
      : measured
    lastPosition.current = next
    setPosition(next)

    // Compute movement heading if user has moved at least 1.8 meters
    if (previous && distanceMeters(previous, next) >= 1.8) {
      movementHeadingRef.current = Math.round(bearingBetween(previous, next))
    }

    const gpsHeading = Number.isFinite(result.coords.heading) && result.coords.heading !== null && result.coords.heading >= 0
      ? Math.round(result.coords.heading)
      : null

    const effectiveHeading = compassHeadingRef.current ?? gpsHeading ?? movementHeadingRef.current
    if (effectiveHeading !== null) {
      setHeading(effectiveHeading)
    }

    setError('')
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      updatePosition,
      (reason) => {
        setError(reason.code === 1 ? 'Location permission was denied.' : 'Could not determine your location. Try again outdoors.')
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [updatePosition])

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setError(unavailableMessage())
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      updatePosition,
      (reason) => {
        setError(reason.code === 1 ? 'Location permission was denied.' : 'Could not determine your location. Try again outdoors.')
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
    )
  }, [updatePosition])

  return {
    position,
    heading,
    compassHeading,
    accuracy,
    error,
    loading,
    locate,
    clearError: () => setError(''),
  }
}
