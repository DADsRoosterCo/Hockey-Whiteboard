// Event derivation logic for hockey drills.
//
// The runtime layer derives structured events from timestamped path
// nodes, semantic zones and point-level actions. The derivation logic is
// deliberately pure so it can be reused by editors, tests and future
// analytics pipelines without depending on React or SVG code.

import type { RinkPoint2D, SemanticZone, SemanticZoneType } from "../rinkTypes"
import { isPointInsidePolygon } from "../rinkGeometry"

export type DerivedEventType =
  | "zone-entry"
  | "zone-exit"
  | "regroup"
  | "pass"
  | "shot"
  | "puck-possession-change"
  | "line-change"
  | "custom"
  | "stop"
  | "pivot"

export type RuntimePathAction = "carry" | "pass" | "receive" | "shot" | "stop" | "pivot"

export interface TimedPathPoint extends RinkPoint2D {
  timeSec?: number
  action?: RuntimePathAction
  metadata?: Record<string, unknown>
}

export interface DerivedPath {
  pathId: string
  actorId: string
  teamRole?: "home" | "away" | "neutral"
  points: TimedPathPoint[]
}

export interface DerivedEvent {
  id: string
  type: DerivedEventType
  timeSec: number
  endTimeSec?: number
  actorIds?: string[]
  pathId?: string
  confidence?: number
  data?: Record<string, unknown>
}

export interface EventDerivationParams {
  pathPoints?: RinkPoint2D[]
  timedPathPoints?: TimedPathPoint[]
  pathId?: string
  actorId?: string
  zones: SemanticZone[]
}

export interface DrillEventDerivationParams {
  paths: DerivedPath[]
  zones: SemanticZone[]
  passWindowSec?: number
}

type ZonedPoint = {
  point: TimedPathPoint
  timeSec: number
  zones: SemanticZone[]
}

type ZoneVisit = {
  zone: SemanticZone
  timeSec: number
}

const DEFAULT_PASS_WINDOW_SEC = 8
const MAJOR_ZONE_TYPES: SemanticZoneType[] = [
  "left-defending-zone",
  "neutral-zone",
  "right-defending-zone",
]

export function deriveEventsForPath(params: EventDerivationParams): DerivedEvent[] {
  const points = params.timedPathPoints
    ?? params.pathPoints?.map((point, index) => ({ ...point, timeSec: index }))
    ?? []

  if (points.length < 2) return []

  return deriveTimelineEventsForPath({
    pathId: params.pathId ?? "path-0",
    actorId: params.actorId ?? "actor-0",
    points,
  }, params.zones)
}

export function deriveEventsForDrill(params: DrillEventDerivationParams): DerivedEvent[] {
  const timelineEvents = params.paths.flatMap((path) => deriveTimelineEventsForPath(path, params.zones))
  const passEvents = derivePassEvents(params.paths, params.zones, params.passWindowSec ?? DEFAULT_PASS_WINDOW_SEC)

  return [...timelineEvents, ...passEvents].sort((left, right) => {
    if (left.timeSec !== right.timeSec) return left.timeSec - right.timeSec
    return left.id.localeCompare(right.id)
  })
}

function deriveTimelineEventsForPath(path: DerivedPath, zones: SemanticZone[]): DerivedEvent[] {
  if (path.points.length < 2) return []

  const zonedPoints = path.points.map((point, index) => ({
    point,
    timeSec: getPointTimeSec(point, index),
    zones: getZonesForPoint(point, zones),
  }))

  const events: DerivedEvent[] = []
  let previousZoneIds = zonedPoints[0].zones.map((zone) => zone.id)

  for (let index = 1; index < zonedPoints.length; index += 1) {
    const current = zonedPoints[index]
    const currentZoneIds = current.zones.map((zone) => zone.id)

    for (const zone of current.zones) {
      if (!previousZoneIds.includes(zone.id)) {
        events.push(createEvent({
          type: "zone-entry",
          timeSec: current.timeSec,
          actorIds: [path.actorId],
          pathId: path.pathId,
          confidence: 0.98,
          data: {
            zoneId: zone.id,
            zoneType: zone.type,
          },
        }))
      }
    }

    for (const previousZoneId of previousZoneIds) {
      if (!currentZoneIds.includes(previousZoneId)) {
        const exitedZone = zones.find((zone) => zone.id === previousZoneId)
        events.push(createEvent({
          type: "zone-exit",
          timeSec: current.timeSec,
          actorIds: [path.actorId],
          pathId: path.pathId,
          confidence: 0.98,
          data: {
            zoneId: previousZoneId,
            zoneType: exitedZone?.type,
          },
        }))
      }
    }

    if (current.point.action === "shot") {
      events.push(createEvent({
        type: "shot",
        timeSec: current.timeSec,
        actorIds: [path.actorId],
        pathId: path.pathId,
        confidence: 1,
        data: {
          zoneIds: currentZoneIds,
        },
      }))
    }

    if (current.point.action === "stop") {
      events.push(createEvent({
        type: "stop",
        timeSec: current.timeSec,
        actorIds: [path.actorId],
        pathId: path.pathId,
        confidence: 0.98,
        data: {
          zoneIds: currentZoneIds,
        },
      }))
    }

    if (current.point.action === "pivot") {
      events.push(createEvent({
        type: "pivot",
        timeSec: current.timeSec,
        actorIds: [path.actorId],
        pathId: path.pathId,
        confidence: 0.98,
        data: {
          zoneIds: currentZoneIds,
          metadata: current.point.metadata,
        },
      }))
    }

    previousZoneIds = currentZoneIds
  }

  const regroupEvents = deriveRegroupEvents(path, zonedPoints)
  return [...events, ...regroupEvents].sort((left, right) => left.timeSec - right.timeSec)
}

function deriveRegroupEvents(path: DerivedPath, zonedPoints: ZonedPoint[]): DerivedEvent[] {
  const visits = buildMajorZoneVisits(zonedPoints)
  const regroupEvents: DerivedEvent[] = []

  for (let index = 0; index < visits.length - 2; index += 1) {
    const first = visits[index]
    const middle = visits[index + 1]
    const third = visits[index + 2]

    if (first.zone.type === "neutral-zone") continue
    if (middle.zone.type !== "neutral-zone") continue
    if (third.zone.id !== first.zone.id) continue

    regroupEvents.push(createEvent({
      type: "regroup",
      timeSec: third.timeSec,
      actorIds: [path.actorId],
      pathId: path.pathId,
      confidence: 0.85,
      data: {
        zoneId: first.zone.id,
        throughZoneId: middle.zone.id,
      },
    }))
  }

  return regroupEvents
}

function buildMajorZoneVisits(zonedPoints: ZonedPoint[]): ZoneVisit[] {
  const visits: ZoneVisit[] = []

  for (const zonedPoint of zonedPoints) {
    const majorZone = zonedPoint.zones.find((zone) => MAJOR_ZONE_TYPES.includes(zone.type))
    if (!majorZone) continue

    const lastVisit = visits[visits.length - 1]
    if (lastVisit?.zone.id === majorZone.id) continue

    visits.push({
      zone: majorZone,
      timeSec: zonedPoint.timeSec,
    })
  }

  return visits
}

function derivePassEvents(
  paths: DerivedPath[],
  zones: SemanticZone[],
  passWindowSec: number,
): DerivedEvent[] {
  const passNodes = paths.flatMap((path) =>
    path.points
      .map((point, index) => ({ path, point, timeSec: getPointTimeSec(point, index) }))
      .filter((entry) => entry.point.action === "pass"),
  )

  const receiveNodes = paths.flatMap((path) =>
    path.points
      .map((point, index) => ({ path, point, timeSec: getPointTimeSec(point, index) }))
      .filter((entry) => entry.point.action === "receive"),
  )

  const matchedReceiveIds = new Set<string>()
  const events: DerivedEvent[] = []

  for (const passNode of passNodes.sort((left, right) => left.timeSec - right.timeSec)) {
    const explicitTargetActorId = typeof passNode.point.metadata?.passTargetActorId === "string"
      ? passNode.point.metadata.passTargetActorId
      : null

    const receiveNode = receiveNodes
      .filter((candidate) => candidate.path.actorId !== passNode.path.actorId)
      .filter((candidate) => !matchedReceiveIds.has(getNodeMatchId(candidate.path.pathId, candidate.timeSec)))
      .filter((candidate) => candidate.timeSec >= passNode.timeSec)
      .filter((candidate) => !explicitTargetActorId || candidate.path.actorId === explicitTargetActorId)
      .filter((candidate) => candidate.timeSec - passNode.timeSec <= (explicitTargetActorId ? passWindowSec * 3 : passWindowSec))
      .sort((left, right) => left.timeSec - right.timeSec)[0]

    if (!receiveNode) {
      if (!explicitTargetActorId) continue

      // Explicit target set but no receive node — synthesize from target's path
      const targetPath = paths.find((p) => p.actorId === explicitTargetActorId)
      if (!targetPath || targetPath.points.length === 0) continue

      const targetPointTimes = targetPath.points.map((pt, i) => getPointTimeSec(pt, i))
      const receiveTimeSec =
        targetPointTimes.find((t) => t >= passNode.timeSec) ??
        targetPointTimes[targetPointTimes.length - 1]

      const passZones = getZonesForPoint(passNode.point, zones).map((z) => z.id)

      events.push(createEvent({
        type: "pass",
        timeSec: passNode.timeSec,
        endTimeSec: receiveTimeSec,
        actorIds: [passNode.path.actorId, explicitTargetActorId],
        pathId: passNode.path.pathId,
        confidence: 0.95,
        data: {
          fromPathId: passNode.path.pathId,
          toPathId: targetPath.pathId,
          passZoneIds: passZones,
          explicit: true,
        },
      }))

      events.push(createEvent({
        type: "puck-possession-change",
        timeSec: receiveTimeSec,
        actorIds: [passNode.path.actorId, explicitTargetActorId],
        pathId: targetPath.pathId,
        confidence: 0.95,
        data: {
          fromActorId: passNode.path.actorId,
          toActorId: explicitTargetActorId,
          reason: "pass-complete",
        },
      }))

      continue
    }

    matchedReceiveIds.add(getNodeMatchId(receiveNode.path.pathId, receiveNode.timeSec))

    const passZones = getZonesForPoint(passNode.point, zones).map((zone) => zone.id)
    const receiveZones = getZonesForPoint(receiveNode.point, zones).map((zone) => zone.id)

    events.push(createEvent({
      type: "pass",
      timeSec: passNode.timeSec,
      endTimeSec: receiveNode.timeSec,
      actorIds: [passNode.path.actorId, receiveNode.path.actorId],
      pathId: passNode.path.pathId,
      confidence: explicitTargetActorId ? 1.0 : 0.9,
      data: {
        fromPathId: passNode.path.pathId,
        toPathId: receiveNode.path.pathId,
        passZoneIds: passZones,
        receiveZoneIds: receiveZones,
        explicit: explicitTargetActorId !== null,
      },
    }))

    events.push(createEvent({
      type: "puck-possession-change",
      timeSec: receiveNode.timeSec,
      actorIds: [passNode.path.actorId, receiveNode.path.actorId],
      pathId: receiveNode.path.pathId,
      confidence: 0.9,
      data: {
        fromActorId: passNode.path.actorId,
        toActorId: receiveNode.path.actorId,
        reason: "pass-complete",
      },
    }))
  }

  return events
}

function getZonesForPoint(point: RinkPoint2D, zones: SemanticZone[]): SemanticZone[] {
  return zones.filter((zone) => isPointInsidePolygon(point, zone.polygon))
}

function getPointTimeSec(point: TimedPathPoint, index: number): number {
  return Number.isFinite(point.timeSec) ? (point.timeSec as number) : index
}

function getNodeMatchId(pathId: string, timeSec: number): string {
  return `${pathId}:${timeSec.toFixed(3)}`
}

function createEvent(event: Omit<DerivedEvent, "id">): DerivedEvent {
  const actorKey = event.actorIds?.join("-") ?? "none"
  const pathKey = event.pathId ?? "pathless"
  const timeKey = event.timeSec.toFixed(3)
  const endTimeKey = event.endTimeSec !== undefined ? `:${event.endTimeSec.toFixed(3)}` : ""
  const dataKey = serializeEventDataKey(event.data)

  return {
    id: `${event.type}:${pathKey}:${actorKey}:${timeKey}${endTimeKey}${dataKey}`,
    ...event,
  }
}

function serializeEventDataKey(data: DerivedEvent["data"]): string {
  if (!data) return ""

  const sortedEntries = Object.entries(data).sort(([left], [right]) => left.localeCompare(right))

  return sortedEntries.reduce((key, [entryKey, entryValue]) => {
    if (entryValue === undefined) return key

    const normalizedValue = Array.isArray(entryValue)
      ? entryValue.join(",")
      : String(entryValue)

    return `${key}:${entryKey}=${normalizedValue}`
  }, "")
}

