import type {
  ConfigurationProcedure, DiversionPlan,
  EmergencyDecisionContext, FlightEventType, FlightPlanReview, FlightState, MissionBrief,
  MissionPhase, RoutePlan,
} from '../sim/types.ts'
import type { PilotManual } from './pilotManual.ts'
export { CHECKRIDE_SEEDS as checkrideSeeds } from '../sim/missionProfiles.ts'

type JsonSchema = Readonly<Record<string, unknown>>
export type ToolReceiptTone = 'neutral' | 'success' | 'warning' | 'critical' | 'automation'
export type AgentFlightState = Omit<FlightState, 'checkride'> & {
  readonly checkride: Omit<FlightState['checkride'], 'seed' | 'wallClockDeadlineSeconds' | 'wallClockSecondsRemaining'>
}

export interface FlightToolGuidance {
  readonly phase: MissionPhase
  readonly objective: string
  readonly controlCue: string | null
  readonly procedure: ConfigurationProcedure
  readonly hazards: readonly string[]
  readonly availableActions: readonly FlightToolName[]
  readonly eventRevision: number
  readonly decisionSecondsRemaining: number | null
}

export interface FlightToolReceipt<T> {
  readonly ok: true
  readonly summary: string
  readonly tone: ToolReceiptTone
  readonly guidance: FlightToolGuidance
  readonly details: T
}

export const routePlans = ['continue_kmdw', 'return_kstl'] as const satisfies readonly RoutePlan[]
export const flightEventValues = ['emergency_detected', 'decision_timer_expired', 'atc_clearance_received', 'atc_clearance_accepted', 'plan_updated', 'route_progress_stalled', 'checkpoint_reached', 'comfort_limit_approaching', 'passenger_safety_update', 'stall_warning', 'configuration_required', 'configuration_confirmed', 'go_around_required', 'approach_stable', 'touchdown', 'mission_complete', 'mission_failed'] as const satisfies readonly FlightEventType[]

export interface FlightToolCommandInput {
  readonly id: string
  readonly when: { readonly type: 'immediate' | 'airspeed_at_least' | 'altitude_at_least' | 'active_waypoint' | 'distance_to_runway_at_most' | 'aircraft_phase'; readonly value?: number | string }
  readonly lateral: { readonly mode: 'heading' | 'track_fix' | 'bank'; readonly heading_deg?: number; readonly waypoint_id?: string; readonly bank_deg?: number }
  readonly vertical: { readonly mode: 'pitch' | 'altitude'; readonly pitch_deg?: number; readonly altitude_ft?: number }
  readonly energy: { readonly mode: 'throttle' | 'airspeed'; readonly throttle?: number; readonly airspeed_kt?: number }
  readonly gear_down: boolean
  readonly flaps_deg: 0 | 10 | 20 | 30
}

export interface FlightToolArguments {
  read_pilot_manual: Record<string, never>
  start_flight: Record<string, never>
  program_flight_plan: {
    readonly plan: 'continue_kmdw' | 'return_kstl'
    readonly commands: readonly FlightToolCommandInput[]
    readonly go_around?: {
      readonly commands: readonly FlightToolCommandInput[]
    }
    readonly restart_route?: boolean
    readonly reason: string
  }
  request_diversion: { readonly plan: DiversionPlan; readonly reason: string }
  accept_clearance: { readonly clearance_id: string; readonly readback: string }
  wait_for_flight_event: { readonly after_revision?: number; readonly events?: readonly FlightEventType[]; readonly timeout_ms?: number }
}

export interface FlightToolResults {
  read_pilot_manual: FlightToolReceipt<{ readonly manual: PilotManual }>
  start_flight: FlightToolReceipt<{ readonly runId: string; readonly state: AgentFlightState; readonly brief: MissionBrief }>
  program_flight_plan: FlightToolActionResult
  request_diversion: FlightToolActionResult
  accept_clearance: FlightToolActionResult
  wait_for_flight_event: FlightToolWaitResult
}

export interface FlightToolActionResult {
  readonly accepted: boolean
  readonly ok: boolean
  readonly summary: string
  readonly eventRevision: number
  readonly state: AgentFlightState
  readonly tone: ToolReceiptTone
  readonly guidance: FlightToolGuidance
  readonly planReview?: FlightPlanReview
}

export interface FlightToolWaitResult {
  readonly revision: number
  readonly event: FlightEventType | 'timeout'
  readonly message: string
  readonly state: AgentFlightState
  readonly ok: true
  readonly summary: string
  readonly tone: ToolReceiptTone
  readonly guidance: FlightToolGuidance
  readonly decisionContext: EmergencyDecisionContext | null
}

export type FlightToolName = keyof FlightToolArguments
export interface FlightToolDefinition<Name extends FlightToolName = FlightToolName> { readonly name: Name; readonly title: string; readonly description: string; readonly inputSchema: JsonSchema; readonly readOnly: boolean }

const emptySchema = { type: 'object', properties: {}, additionalProperties: false } as const

const commandSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    when: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['immediate', 'airspeed_at_least', 'altitude_at_least', 'active_waypoint', 'distance_to_runway_at_most', 'aircraft_phase'] }, value: { type: ['number', 'string'] } },
      required: ['type'], additionalProperties: false,
    },
    lateral: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['heading', 'track_fix', 'bank'] }, heading_deg: { type: 'number', minimum: 0, maximum: 359.999 }, waypoint_id: { type: 'string', minLength: 1 }, bank_deg: { type: 'number', minimum: -25, maximum: 25 } },
      required: ['mode'], additionalProperties: false,
    },
    vertical: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['pitch', 'altitude'] }, pitch_deg: { type: 'number', minimum: -10, maximum: 15 }, altitude_ft: { type: 'number', minimum: 585, maximum: 6000 } },
      required: ['mode'], additionalProperties: false,
    },
    energy: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['throttle', 'airspeed'] }, throttle: { type: 'number', minimum: 0, maximum: 1 }, airspeed_kt: { type: 'number', minimum: 120, maximum: 260 } },
      required: ['mode'], additionalProperties: false,
    },
    gear_down: { type: 'boolean' },
    flaps_deg: { type: 'number', enum: [0, 10, 20, 30] },
  },
  required: ['id', 'when', 'lateral', 'vertical', 'energy', 'gear_down', 'flaps_deg'], additionalProperties: false,
} as const

export const flightToolDefinitions = [
  {
    name: 'read_pilot_manual', title: 'Read pilot operating manual before flight', readOnly: true,
    description: 'Read this before programming a flight. It publishes the aircraft-specific takeoff, approach, flare, touchdown, rollout, and pre-armed go-around limits needed to choose exact commands. It contains no sealed scenario information.',
    inputSchema: emptySchema,
  },
  {
    name: 'start_flight', title: 'Start flight', readOnly: false,
    description: 'Select agent mode for a fresh flight and receive the full mission brief and current state. The selected mode stays locked until the run is reset. The brief publishes route checkpoints and exact crossing targets; it does not prescribe controls. The environment privately selects a reproducible scenario, and no future condition is disclosed before its flight event. Submit the ordered exact command program before takeoff.',
    inputSchema: emptySchema,
  },
  {
    name: 'program_flight_plan', title: 'Program flight plan', readOnly: false,
    description: 'Author the flight as 2-16 ordered exact commands. Each command persists until the next trigger. Choose one lateral mode, one vertical mode, one energy mode, plus exact gear and flaps. The first trigger must be immediate. Use active_waypoint commands to fly each published checkpoint. The simulator tracks your declared setpoints at 60 Hz; it never chooses pitch, speed, configuration, flare, or rollout. Landing programs need a distance-triggered exact-pitch flare and an aircraft_phase landing_roll command. Put exact missed-approach commands in go_around.commands to pre-arm an immediate response to an unsafe approach. Replacing commands preserves route progress. Read read_pilot_manual for the aircraft-specific limits.',
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: 'string', enum: routePlans },
        commands: {
          type: 'array', minItems: 2, maxItems: 16,
          items: commandSchema,
        },
        go_around: {
          type: 'object',
          properties: { commands: { type: 'array', minItems: 2, maxItems: 16, items: commandSchema } },
          required: ['commands'], additionalProperties: false,
        },
        restart_route: { type: 'boolean', default: false },
        reason: { type: 'string', minLength: 1 },
      },
      required: ['plan', 'commands', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_diversion', title: 'Request ATC diversion', readOnly: false,
    description: 'After emergency_detected, choose one route from that event response\'s decisionContext.routeOptions. This sends the request to simulated ATC but does not change the active route. Wait for atc_clearance_received before acting.',
    inputSchema: { type: 'object', properties: { plan: { type: 'string', enum: routePlans }, reason: { type: 'string', minLength: 1 } }, required: ['plan', 'reason'], additionalProperties: false },
  },
  {
    name: 'accept_clearance', title: 'Read back ATC clearance', readOnly: false,
    description: 'Accept the current ATC clearance by copying its clearance.id and reading back its destination, runway, altitude, and initial heading. The clearance then publishes the complete route and crossing targets. Replace the command program so the aircraft meets each checkpoint.',
    inputSchema: { type: 'object', properties: { clearance_id: { type: 'string', minLength: 1 }, readback: { type: 'string', minLength: 1 } }, required: ['clearance_id', 'readback'], additionalProperties: false },
  },
  {
    name: 'wait_for_flight_event', title: 'Wait for flight event', readOnly: true,
    description: 'Wait without polling for route, comfort, configuration, touchdown, completion, or failure events. The current state is returned with every event. emergency_detected also returns the newly unsealed evidence, fuel, decision time, and route options as decisionContext. Emergency and failure events preempt routine notices. The aircraft keeps executing the active command program for the entire wait.',
    inputSchema: { type: 'object', properties: { after_revision: { type: 'number', minimum: 0 }, events: { type: 'array', items: { type: 'string', enum: flightEventValues }, minItems: 1 }, timeout_ms: { type: 'number', minimum: 1000, maximum: 15000, default: 15000 } }, additionalProperties: false },
  },
] as const satisfies readonly FlightToolDefinition[]
