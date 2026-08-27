import type { FlightState } from '../sim/types'
import { KPWK_RUNWAY_16, NORTH_FIELD_RUNWAY_18 } from '../sim/airfields'

const WIDTH = 240
const HEIGHT = 164
const PADDING = 18

interface MapPoint { readonly lat: number; readonly lon: number }

export function FlightMinimap({ state }: { readonly state: FlightState }) {
  const routePoints = state.route.waypoints
  const boundsPoints: readonly MapPoint[] = [
    { lat: NORTH_FIELD_RUNWAY_18.thresholdLat, lon: NORTH_FIELD_RUNWAY_18.thresholdLon },
    { lat: NORTH_FIELD_RUNWAY_18.farEndLat, lon: NORTH_FIELD_RUNWAY_18.farEndLon },
    { lat: KPWK_RUNWAY_16.thresholdLat, lon: KPWK_RUNWAY_16.thresholdLon },
    { lat: KPWK_RUNWAY_16.farEndLat, lon: KPWK_RUNWAY_16.farEndLon },
    ...routePoints,
  ]
  const referenceLatitude = boundsPoints.reduce((sum, point) => sum + point.lat, 0) / boundsPoints.length
  const longitudeScale = Math.cos(referenceLatitude * Math.PI / 180)
  const projected = boundsPoints.map((point) => ({
    x: point.lon * longitudeScale,
    y: -point.lat,
  }))
  const minX = Math.min(...projected.map((point) => point.x))
  const maxX = Math.max(...projected.map((point) => point.x))
  const minY = Math.min(...projected.map((point) => point.y))
  const maxY = Math.max(...projected.map((point) => point.y))
  const scale = Math.min(
    (WIDTH - PADDING * 2) / Math.max(maxX - minX, 0.0001),
    (HEIGHT - PADDING * 2) / Math.max(maxY - minY, 0.0001),
  )
  const mapPoint = (point: MapPoint) => ({
    x: PADDING + (point.lon * longitudeScale - minX) * scale,
    y: PADDING + (-point.lat - minY) * scale,
  })
  const aircraftPosition = mapPoint(state)
  const aircraft = {
    x: Math.min(WIDTH - PADDING, Math.max(PADDING, aircraftPosition.x)),
    y: Math.min(HEIGHT - PADDING, Math.max(PADDING, aircraftPosition.y)),
  }
  const northFieldStart = mapPoint({ lat: NORTH_FIELD_RUNWAY_18.thresholdLat, lon: NORTH_FIELD_RUNWAY_18.thresholdLon })
  const northFieldEnd = mapPoint({ lat: NORTH_FIELD_RUNWAY_18.farEndLat, lon: NORTH_FIELD_RUNWAY_18.farEndLon })
  const kpwkStart = mapPoint({ lat: KPWK_RUNWAY_16.thresholdLat, lon: KPWK_RUNWAY_16.thresholdLon })
  const kpwkEnd = mapPoint({ lat: KPWK_RUNWAY_16.farEndLat, lon: KPWK_RUNWAY_16.farEndLon })
  const fullRoute = routePoints.map(mapPoint)
  const activeWaypointIndex = state.route.activeWaypointIndex
  const activeRoute = routePoints.length === 0
    ? []
    : [
        activeWaypointIndex === 0 ? northFieldEnd : mapPoint(routePoints[activeWaypointIndex - 1]),
        mapPoint(routePoints[activeWaypointIndex]),
      ]
  const pointsAttribute = (points: readonly { x: number; y: number }[]) =>
    points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
  const activeWaypoint = routePoints[state.route.activeWaypointIndex]
  const status = state.mission.phase === 'complete'
    ? 'Arrived at KPWK'
    : activeWaypoint
      ? `${activeWaypoint.name}${state.mission.distanceToNextFixNm === null ? '' : ` · ${state.mission.distanceToNextFixNm.toFixed(1)} NM`}`
      : 'Route pending'

  return (
    <aside className="flight-minimap" aria-label={`Route map. ${status}.`}>
      <div className="minimap-heading">
        <span>Navigation</span>
        <strong>{status}</strong>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-hidden="true">
        <defs>
          <linearGradient id="minimap-surface" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#172019" />
            <stop offset="1" stopColor="#0b100c" />
          </linearGradient>
          <radialGradient id="minimap-range" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#9ad1a8" stopOpacity="0.07" />
            <stop offset="1" stopColor="#9ad1a8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect className="minimap-surface" x="0" y="0" width={WIDTH} height={HEIGHT} rx="10" />
        <circle className="minimap-range" cx={WIDTH / 2} cy={HEIGHT / 2} r="66" />
        <path className="minimap-grid" d={`M ${WIDTH / 2} 8 V ${HEIGHT - 8} M 8 ${HEIGHT / 2} H ${WIDTH - 8}`} />
        <g className="minimap-compass" transform={`translate(${WIDTH - 18} 18)`}>
          <path d="M 0 -8 L 3 1 L 0 0 L -3 1 Z" />
          <text x="0" y="9">N</text>
        </g>
        <line className="minimap-runway minimap-runway-departure" x1={northFieldStart.x} y1={northFieldStart.y} x2={northFieldEnd.x} y2={northFieldEnd.y} />
        <line className="minimap-runway minimap-runway-arrival" x1={kpwkStart.x} y1={kpwkStart.y} x2={kpwkEnd.x} y2={kpwkEnd.y} />
        <text className="minimap-label" x={northFieldStart.x + 6} y={northFieldStart.y - 5}>NF 18</text>
        <text className="minimap-label" x={kpwkStart.x + 6} y={kpwkStart.y - 5}>KPWK 16</text>
        {fullRoute.length > 1 ? <polyline className="minimap-route-history" points={pointsAttribute(fullRoute)} /> : null}
        {activeRoute.length > 1 ? <polyline className="minimap-route-active" points={pointsAttribute(activeRoute)} /> : null}
        {fullRoute.map((point, index) => (
          <circle
            key={routePoints[index].id}
            className={index === state.route.activeWaypointIndex ? 'minimap-fix minimap-fix-active' : 'minimap-fix'}
            cx={point.x}
            cy={point.y}
            r={index === state.route.activeWaypointIndex ? 3.2 : 2.2}
          />
        ))}
        <g className="minimap-aircraft" transform={`translate(${aircraft.x} ${aircraft.y}) rotate(${state.headingDeg})`}>
          <circle r="6.5" />
          <path d="M 0 -6.5 L 3.5 4.5 L 0 2.8 L -3.5 4.5 Z" />
        </g>
      </svg>
      <div className="minimap-footer">
        <span>{state.route.destination ?? 'Awaiting route'}</span>
        <strong>{state.route.destination ? `${state.mission.distanceToThresholdNm.toFixed(1)} NM` : '—'}</strong>
      </div>
    </aside>
  )
}
