import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { GripHorizontal, Minus, Plus } from 'lucide-react'
import { KPWK_RUNWAY_16, LAKESIDE_RUNWAY_22, NORTH_FIELD_RUNWAY_18 } from '../sim/airfields'
import type { FlightState, MissionRunway } from '../sim/types'

const WIDTH = 240
const HEIGHT = 164
const PADDING = 18
const PANEL_WIDTHS = [238, 360, 520] as const

interface MapPoint { readonly lat: number; readonly lon: number }
interface PanelPosition { readonly x: number; readonly y: number }
interface DragOrigin { readonly pointerX: number; readonly pointerY: number; readonly panelX: number; readonly panelY: number }

const runwayPoints = (runway: MissionRunway): readonly MapPoint[] => [
  { lat: runway.thresholdLat, lon: runway.thresholdLon },
  { lat: runway.farEndLat, lon: runway.farEndLon },
]

const initialPanelPosition = (): PanelPosition => typeof window !== 'undefined' && window.innerWidth <= 760
  ? { x: 12, y: 158 }
  : { x: 20, y: 76 }

const clampPanelPosition = (panel: HTMLElement | null, x: number, y: number): PanelPosition => {
  const bounds = panel?.getBoundingClientRect()
  const width = bounds?.width ?? 238
  const height = bounds?.height ?? 230
  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - width - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - height - 8)),
  }
}

export function FlightMinimap({ state }: { readonly state: FlightState }) {
  const panelRef = useRef<HTMLElement>(null)
  const dragOriginRef = useRef<DragOrigin | null>(null)
  const [panelPosition, setPanelPosition] = useState<PanelPosition>(initialPanelPosition)
  const [sizeIndex, setSizeIndex] = useState(0)
  const routePoints = state.route.waypoints
  const destinationRunway = state.route.destination === 'KLAK' ? LAKESIDE_RUNWAY_22 : KPWK_RUNWAY_16
  const visibleRunways = state.route.destination === 'KLAK'
    ? [NORTH_FIELD_RUNWAY_18, LAKESIDE_RUNWAY_22]
    : [NORTH_FIELD_RUNWAY_18, KPWK_RUNWAY_16]
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
  const mappedRoute = routePoints.map(mapPoint)
  const status = state.mission.phase === 'complete'
    ? `Arrived at ${state.route.destination ?? 'destination'}`
    : activeWaypoint
      ? `${activeWaypoint.name}${state.mission.distanceToNextFixNm === null ? '' : ` · ${state.mission.distanceToNextFixNm.toFixed(1)} NM`}`
      : 'Route pending'
  const routeProgress = routePoints.length === 0
    ? 'No active leg'
    : `Leg ${Math.min(state.route.activeWaypointIndex + 1, routePoints.length)} / ${routePoints.length}`

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const origin = dragOriginRef.current
      if (!origin) return
      setPanelPosition(clampPanelPosition(panelRef.current, origin.panelX + event.clientX - origin.pointerX, origin.panelY + event.clientY - origin.pointerY))
    }
    const end = () => { dragOriginRef.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [])

  useEffect(() => {
    setPanelPosition((current) => clampPanelPosition(panelRef.current, current.x, current.y))
  }, [sizeIndex])

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragOriginRef.current = { pointerX: event.clientX, pointerY: event.clientY, panelX: panelPosition.x, panelY: panelPosition.y }
  }

  const endDrag = () => { dragOriginRef.current = null }

  const moveWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const movement: Readonly<Record<string, readonly [number, number]>> = {
      ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12],
    }
    const delta = movement[event.key]
    if (!delta) return
    event.preventDefault()
    setPanelPosition((current) => clampPanelPosition(panelRef.current, current.x + delta[0], current.y + delta[1]))
  }

  return (
    <aside
      ref={panelRef}
      className="flight-minimap"
      style={{ left: panelPosition.x, top: panelPosition.y, width: Math.min(PANEL_WIDTHS[sizeIndex], window.innerWidth - 16) }}
      aria-label={`Movable route map. ${status}. ${routeProgress}.`}
    >
      <div className="minimap-heading">
        <div>
          <span>Navigation</span>
          <strong>{status}</strong>
        </div>
        <div className="minimap-actions">
          <button
            type="button"
            className="minimap-size-button"
            aria-label="Make navigation map smaller"
            title="Make map smaller"
            disabled={sizeIndex === 0}
            onClick={() => setSizeIndex((current) => Math.max(0, current - 1))}
          >
            <Minus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="minimap-size-button"
            aria-label="Make navigation map larger"
            title="Make map larger"
            disabled={sizeIndex === PANEL_WIDTHS.length - 1}
            onClick={() => setSizeIndex((current) => Math.min(PANEL_WIDTHS.length - 1, current + 1))}
          >
            <Plus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="minimap-drag-handle"
            aria-label="Move navigation map. Use arrow keys or drag."
            title="Drag to move map"
            onPointerDown={beginDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={moveWithKeyboard}
          >
            <GripHorizontal aria-hidden="true" />
          </button>
        </div>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={activeWaypoint ? `Aircraft tracking ${activeWaypoint.name}` : 'No active route'}>
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
          const isDeparture = runway.id === NORTH_FIELD_RUNWAY_18.id
          return (
            <g key={runway.id}>
              <line className={`minimap-runway ${isDeparture ? 'minimap-runway-departure' : 'minimap-runway-arrival'}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
              <text className="minimap-label" x={start.x + 6} y={start.y - 5}>{runway.airport} {runway.id.split('-')[1]}</text>
            </g>
          )
        })}
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
        <span>{state.route.destination ?? 'Awaiting route'} · {routeProgress}</span>
        <strong>{state.route.destination ? `${state.mission.distanceToThresholdNm.toFixed(1)} NM` : '—'}</strong>
      </div>
      <span className="sr-only">Destination runway {destinationRunway.id}.</span>
    </aside>
  )
}
