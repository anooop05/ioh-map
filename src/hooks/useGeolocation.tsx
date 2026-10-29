import { useCallback, useEffect, useRef, useState } from 'react'

function unavailableMessage() {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Location needs HTTPS on your phone. Open this app over HTTPS, or use localhost on the same device.'
  }
  return typeof navigator !== 'undefined' && !navigator.geolocation ? 'Location is not available in this browser.' : ''
}

export function useGeolocation() {
  const [position, setPosition] = useState<[number, number] | null>(null)
  const [heading, setHeading] = useState<number | null>(null)
  const [error, setError] = useState(unavailableMessage)
  const [loading, setLoading] = useState(() => typeof navigator !== 'undefined' && Boolean(navigator.geolocation))
  const lastPosition = useRef<[number, number] | null>(null)

  const updatePosition = useCallback((result: GeolocationPosition) => {
    const measured: [number, number] = [result.coords.latitude, result.coords.longitude]
    const previous = lastPosition.current
    const accuracy = result.coords.accuracy
    const smoothing = accuracy <= 8 ? 0.55 : accuracy <= 20 ? 0.38 : 0.22
    const next: [number, number] = previous
      ? [previous[0] + (measured[0] - previous[0]) * smoothing, previous[1] + (measured[1] - previous[1]) * smoothing]
      : measured
    lastPosition.current = next
    setPosition(next)
    setHeading(Number.isFinite(result.coords.heading) ? result.coords.heading : null)
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
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 },
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
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    )
  }, [updatePosition])

  return { position, heading, error, loading, locate, clearError: () => setError('') }
}
