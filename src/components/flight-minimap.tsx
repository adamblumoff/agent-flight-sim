import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { KMDW_RUNWAY_31C, KSTL_RUNWAY_12R, KSTL_RUNWAY_30L } from '../sim/airfields'
import { checkpointCaptureRadiusNm } from '../sim/checkpoints'
import type { FlightState, MissionRunway } from '../sim/types'

const WIDTH = 240
const HEIGHT = 164
const PADDING = 18

interface MapPoint { readonly lat: number; readonly lon: number }

const runwayPoints = (runway: MissionRunway): readonly MapPoint[] => [
  { lat: runway.thresholdLat, lon: runway.thresholdLon },
  { lat: runway.farEndLat, lon: runway.farEndLon },
]

export function FlightMinimap({ state }: { readonly state: FlightState }) {
  const [collapsed, setCollapsed] = useState(false)
  const routePoints = state.route.waypoints
  const destinationRunway = state.route.destination === 'KMDW'
    ? KMDW_RUNWAY_31C
    : state.route.destination === 'KSTL' ? KSTL_RUNWAY_30L : KSTL_RUNWAY_12R
  const visibleRunways = state.route.destination === 'KMDW'
    ? [KSTL_RUNWAY_12R, KMDW_RUNWAY_31C]
    : state.route.destination === 'KSTL' ? [KSTL_RUNWAY_30L] : [KSTL_RUNWAY_12R]
  const boundsPoints: readonly MapPoint[] = [state, ...visibleRunways.flatMap(runwayPoints), ...routePoints]
  const referenceLatitude = boundsPoints.reduce((sum, point) => sum + point.lat, 0) / boundsPoints.length
  const longitudeScale = Math.cos(referenceLatitude * Math.PI / 180)
  const projected = boundsPoints.map((point) => ({ x: point.lon * longitudeScale, y: -point.lat }))
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
  const aircraft = mapPoint(state)
  const activeWaypoint = routePoints[state.route.activeWaypointIndex]
  const activeFix = activeWaypoint ? mapPoint(activeWaypoint) : null
  const activeCaptureRadius = activeWaypoint ? checkpointCaptureRadiusNm(activeWaypoint, state.controlOwner) : null
  const activeCaptureRadiusPixels = activeWaypoint && activeFix && activeCaptureRadius
    ? Math.abs(mapPoint({ lat: activeWaypoint.lat, lon: activeWaypoint.lon + activeCaptureRadius / (60 * longitudeScale) }).x - activeFix.x)
    : 0
  const mappedRoute = routePoints.map(mapPoint)
  const status = state.mission.phase === 'complete'
    ? `Arrived at ${state.route.destination ?? 'destination'}`
    : activeWaypoint
      ? `${activeWaypoint.name}${state.mission.distanceToNextFixNm === null ? '' : ` · ${state.mission.distanceToNextFixNm < 1 ? state.mission.distanceToNextFixNm.toFixed(2) : state.mission.distanceToNextFixNm.toFixed(1)} NM`}`
      : 'Route pending'
  const routeProgress = routePoints.length === 0
    ? 'No active leg'
    : `Leg ${Math.min(state.route.activeWaypointIndex + 1, routePoints.length)} / ${routePoints.length}`

  return (
    <aside
      className={`flight-minimap${collapsed ? ' flight-minimap--collapsed' : ''}`}
      aria-label={`Route map. ${status}. ${routeProgress}.`}
    >
      <button
        type="button"
        className="minimap-collapse-toggle"
        aria-label={collapsed ? 'Expand route map' : 'Collapse route map'}
        title={collapsed ? 'Expand route map' : 'Collapse route map'}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
      >
        {collapsed ? <Plus aria-hidden="true" /> : <Minus aria-hidden="true" />}
      </button>
      <svg className="minimap-map" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={activeWaypoint ? `Aircraft tracking ${activeWaypoint.name}` : 'No active route'}>
        <defs>
          <linearGradient id="minimap-surface" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#172019" />
            <stop offset="1" stopColor="#0b100c" />
          </linearGradient>
          <radialGradient id="minimap-range" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#9ad1a8" stopOpacity="0.07" />
            <stop offset="1" stopColor="#9ad1a8" stopOpacity="0" />
          </radialGradient>
          <marker id="minimap-active-head" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 Z" />
          </marker>
        </defs>
        <rect className="minimap-surface" x="0" y="0" width={WIDTH} height={HEIGHT} rx="10" />
        <circle className="minimap-range" cx={WIDTH / 2} cy={HEIGHT / 2} r="66" />
        <path className="minimap-grid" d={`M ${WIDTH / 2} 8 V ${HEIGHT - 8} M 8 ${HEIGHT / 2} H ${WIDTH - 8}`} />
        <g className="minimap-compass" transform={`translate(${WIDTH - 18} 18)`}>
          <path d="M 0 -8 L 3 1 L 0 0 L -3 1 Z" />
          <text x="0" y="9">N</text>
        </g>
        {visibleRunways.map((runway) => {
          const start = mapPoint({ lat: runway.thresholdLat, lon: runway.thresholdLon })
          const end = mapPoint({ lat: runway.farEndLat, lon: runway.farEndLon })
          const isDeparture = runway.id === KSTL_RUNWAY_12R.id
          return (
            <g key={runway.id}>
              <line className={`minimap-runway ${isDeparture ? 'minimap-runway-departure' : 'minimap-runway-arrival'}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
              <text className="minimap-label" x={start.x + 6} y={start.y - 5}>{runway.airport} {runway.id.split('-')[1]}</text>
            </g>
          )
        })}
        {activeFix ? <circle className="minimap-capture-ring" cx={activeFix.x} cy={activeFix.y} r={activeCaptureRadiusPixels} /> : null}
        {activeFix ? <line className="minimap-route-active" x1={aircraft.x} y1={aircraft.y} x2={activeFix.x} y2={activeFix.y} markerEnd="url(#minimap-active-head)" /> : null}
        {mappedRoute.map((point, index) => {
          const waypoint = routePoints[index]
          const complete = state.route.completedWaypointIds.includes(waypoint.id)
          const active = index === state.route.activeWaypointIndex
          return (
            <g key={waypoint.id}>
              <circle className={`minimap-fix${active ? ' minimap-fix-active' : ''}${complete ? ' minimap-fix-complete' : ''}`} cx={point.x} cy={point.y} r={active ? 3.2 : 2.2} />
              {active ? <text className="minimap-fix-label" x={point.x + 5} y={point.y - 5}>{index + 1}</text> : null}
            </g>
          )
        })}
        <g className="minimap-aircraft" transform={`translate(${aircraft.x} ${aircraft.y}) rotate(${state.headingDeg})`}>
          <circle r="6.5" />
          <path d="M 0 -6.5 L 3.5 4.5 L 0 2.8 L -3.5 4.5 Z" />
        </g>
      </svg>
      <div className="minimap-footer">
        <div>
          <strong>{status}</strong>
          <span>{state.route.destination ?? 'Awaiting route'} · {routeProgress}{activeCaptureRadius ? ` · ${activeCaptureRadius.toFixed(2)} NM gate` : ''}</span>
        </div>
        <strong>{state.route.destination ? `${state.mission.distanceToThresholdNm.toFixed(1)} NM` : '—'}</strong>
      </div>
      <span className="sr-only">Destination runway {destinationRunway.id}.</span>
    </aside>
  )
}
