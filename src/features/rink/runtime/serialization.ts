// Serialization helpers for saving and loading drill runtime data.
//
// The runtime layer persists structured drill data with explicit
// versioning, path metrics hydration and validation. This keeps the
// editor code free of ad-hoc JSON handling and enforces a single,
// current wire format for saved drills.

import type { DerivedEvent, TimedPathPoint } from "./eventDerivation"
import type { RinkPoint2D } from "../rinkTypes"
import {
  projectActorRouteToSerializedPath,
  projectSerializedPathToActorRoute,
  type SerializedActorRoute,
  type SerializedActorRouteBezierHandle,
  type SerializedActorRouteBezierNode,
  type SerializedActorRouteNode,
  type SerializedActorRouteStyle,
} from "./routeProjection"
import { buildPathMetrics, type PathMetrics } from "./pathMetrics"

export const CURRENT_DRILL_SERIALIZATION_VERSION = "2.0.0"

export type SerializedAnnotationType = "cone" | "net" | "text" | "puck" | "stroke"

export interface SerializedAnnotation extends RinkPoint2D {
  id: string
  type: SerializedAnnotationType
  label?: string
  teamRole?: "home" | "away" | "neutral"
  rotationDeg?: number
  color?: string
  strokeWidth?: number
  metadata?: Record<string, unknown>
}

export interface SerializedDrillEditorPreferences {
  showCurvedPaths?: boolean
  curveIntensity?: number
  actorCurveModes?: Record<string, boolean>
}

export interface SerializedDrillMetadata {
  id: string
  name: string
  rinkSpecId?: string
  notes?: string
  createdAtIso?: string
  updatedAtIso?: string
  editorPreferences?: SerializedDrillEditorPreferences
}

export interface SerializedActor {
  id: string
  name: string
  teamRole?: "home" | "away" | "neutral"
  metadata?: Record<string, unknown>
}

export interface SerializedPath {
  id: string
  actorId: string
  label?: string
  teamRole?: "home" | "away" | "neutral"
  points: TimedPathPoint[]
  metrics?: PathMetrics
}

export type DrawLineArrowType = "none" | "arrow" | "open" | "tee" | "circle"

export interface SerializedDrawLine {
  id: string
  points: Array<{ xFt: number; yFt: number }>
  /** Total polyline arc length in feet, computed from anchor points. */
  totalLengthFt?: number
  color?: string
  lineType?: "solid" | "dashed" | "dotted"
  lineWeight?: "thin" | "medium" | "thick"
  startArrow?: DrawLineArrowType
  endArrow?: DrawLineArrowType
  attachedActorId?: string | null
}

export type {
  SerializedActorRoute,
  SerializedActorRouteBezierHandle,
  SerializedActorRouteBezierNode,
  SerializedActorRouteNode,
  SerializedActorRouteStyle,
}

export interface SerializedDrill {
  version: string
  metadata: SerializedDrillMetadata
  actors: SerializedActor[]
  paths: SerializedPath[]
  actorRoutes?: SerializedActorRoute[]
  annotations: SerializedAnnotation[]
  derivedEvents: DerivedEvent[]
  drawLines: SerializedDrawLine[]
}

export interface SerializedDrillInput {
  version: string
  metadata: SerializedDrillMetadata
  actors: SerializedActor[]
  paths?: SerializedPath[]
  actorRoutes?: SerializedActorRoute[]
  annotations?: SerializedAnnotation[]
  derivedEvents: DerivedEvent[]
  drawLines?: SerializedDrawLine[]
}

export function serializeDrill(data: SerializedDrillInput): SerializedDrill {
  return normalizeSerializedDrill(data)
}

export function deserializeDrill(obj: unknown): SerializedDrill {
  if (!isSerializedDrillShape(obj)) {
    throw new Error("Serialized drill must match the current format")
  }

  if (obj.version !== CURRENT_DRILL_SERIALIZATION_VERSION) {
    throw new Error(`Serialized drill version ${obj.version} is not supported`)
  }

  return normalizeSerializedDrill(obj)
}

function normalizeSerializedDrill(input: SerializedDrillInput): SerializedDrill {
  const metadata = normalizeMetadata(input.metadata)
  const actors = normalizeActors(input.actors)
  const normalizedPaths = Array.isArray(input.paths)
    ? input.paths.map((path, index) => normalizePath(path, index))
    : []
  const normalizedActorRoutes = Array.isArray(input.actorRoutes)
    ? input.actorRoutes.map((route, index) => normalizeActorRoute(route, index))
    : []
  const actorRoutes = normalizedActorRoutes.length > 0
    ? normalizedActorRoutes
    : normalizedPaths.map(projectSerializedPathToActorRoute)
  const paths = actorRoutes.length > 0
    ? actorRoutes.map((route) => projectActorRouteToSerializedPath(route, { generateFrames: false }))
    : normalizedPaths
  const actorIds = new Set(actors.map((actor) => actor.id))

  for (const path of paths) {
    if (!actorIds.has(path.actorId)) {
      throw new Error(`Path ${path.id} references unknown actor ${path.actorId}`)
    }
  }

  const derivedEvents = normalizeDerivedEvents(input.derivedEvents)
  const annotations = normalizeAnnotations(input.annotations)
  const drawLines = normalizeDrawLines(input.drawLines)

  return {
    version: CURRENT_DRILL_SERIALIZATION_VERSION,
    metadata,
    actors,
    paths,
    actorRoutes,
    annotations,
    derivedEvents,
    drawLines,
  }
}

function normalizeMetadata(metadata: SerializedDrillMetadata): SerializedDrillMetadata {
  if (!metadata || typeof metadata.id !== "string" || typeof metadata.name !== "string") {
    throw new Error("Serialized drill metadata must include string id and name")
  }

  return {
    id: metadata.id,
    name: metadata.name,
    rinkSpecId: readOptionalString(metadata.rinkSpecId),
    notes: readOptionalString(metadata.notes),
    createdAtIso: readOptionalString(metadata.createdAtIso),
    updatedAtIso: readOptionalString(metadata.updatedAtIso),
    editorPreferences: normalizeEditorPreferences(metadata.editorPreferences),
  }
}

function normalizeEditorPreferences(value: unknown): SerializedDrillEditorPreferences | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const actorCurveModes = isRecord(value.actorCurveModes)
    ? Object.fromEntries(
        Object.entries(value.actorCurveModes).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
      )
    : undefined

  return {
    showCurvedPaths: readOptionalBoolean(value.showCurvedPaths),
    curveIntensity: readOptionalFiniteNumber(value.curveIntensity),
    actorCurveModes: actorCurveModes && Object.keys(actorCurveModes).length > 0 ? actorCurveModes : undefined,
  }
}

function normalizeActors(actors: SerializedActor[]): SerializedActor[] {
  if (!Array.isArray(actors)) {
    throw new Error("Serialized drill actors must be an array")
  }

  if (actors.length === 0) return []

  return actors.map((actor) => {
    if (!actor || typeof actor.id !== "string" || typeof actor.name !== "string") {
      throw new Error("Serialized actor must include string id and name")
    }

    return {
      id: actor.id,
      name: actor.name,
      teamRole: readOptionalTeamRole(actor.teamRole),
      metadata: actor.metadata,
    }
  })
}

function normalizePath(path: SerializedPath, index: number): SerializedPath {
  if (!path || typeof path.id !== "string" || typeof path.actorId !== "string") {
    throw new Error(`Serialized path at index ${index} must include string id and actorId`)
  }

  if (!Array.isArray(path.points)) {
    throw new Error(`Serialized path ${path.id} must include a points array`)
  }

  const points = path.points.map((point, pointIndex) => normalizePoint(point, path.id, pointIndex))

  return {
    id: path.id,
    actorId: path.actorId,
    label: readOptionalString(path.label),
    teamRole: readOptionalTeamRole(path.teamRole),
    points,
    metrics: buildPathMetrics(points),
  }
}

function normalizeActorRoute(route: SerializedActorRoute, index: number): SerializedActorRoute {
  if (!route || typeof route.id !== "string" || typeof route.actorId !== "string") {
    throw new Error(`Serialized actor route at index ${index} must include string id and actorId`)
  }

  if (!Array.isArray(route.nodes)) {
    throw new Error(`Serialized actor route ${route.id} must include a nodes array`)
  }

  const nodes = route.nodes.map((node, nodeIndex) => normalizeRouteNode(node, route.id, nodeIndex))
  const bezierNodes = Array.isArray(route.bezierNodes)
    ? route.bezierNodes.map((node, nodeIndex) => normalizeBezierNode(node, route.id, nodeIndex))
    : undefined
  const style = normalizeActorRouteStyle(route.style)

  return {
    id: route.id,
    actorId: route.actorId,
    label: readOptionalString(route.label),
    teamRole: readOptionalTeamRole(route.teamRole),
    nodes,
    bezierNodes: bezierNodes && bezierNodes.length > 0 ? bezierNodes : undefined,
    style,
    metrics: buildPathMetrics(nodes),
  }
}

function normalizeRouteNode(node: SerializedActorRouteNode, routeId: string, nodeIndex: number): SerializedActorRouteNode {
  const normalizedPoint = normalizePoint(node, routeId, nodeIndex)

  return {
    ...normalizedPoint,
    nodeType: readOptionalRouteNodeType(node.nodeType),
  }
}

function normalizeBezierNode(
  node: SerializedActorRouteBezierNode,
  routeId: string,
  nodeIndex: number,
): SerializedActorRouteBezierNode {
  if (!node || !Number.isFinite(node.xFt) || !Number.isFinite(node.yFt)) {
    throw new Error(`Bezier node ${nodeIndex} on actor route ${routeId} must contain finite xFt and yFt values`)
  }

  return {
    xFt: Number(node.xFt),
    yFt: Number(node.yFt),
    cp1Ft: normalizeBezierHandle(node.cp1Ft, routeId, nodeIndex, "cp1Ft"),
    cp2Ft: normalizeBezierHandle(node.cp2Ft, routeId, nodeIndex, "cp2Ft"),
    nodeType: readOptionalRouteNodeType(node.nodeType),
  }
}

function normalizeBezierHandle(
  handle: SerializedActorRouteBezierHandle | undefined,
  routeId: string,
  nodeIndex: number,
  handleName: "cp1Ft" | "cp2Ft",
): SerializedActorRouteBezierHandle | undefined {
  if (!handle) {
    return undefined
  }

  if (!Number.isFinite(handle.xFt) || !Number.isFinite(handle.yFt)) {
    throw new Error(`Bezier handle ${handleName} on node ${nodeIndex} of actor route ${routeId} must be finite`)
  }

  return {
    xFt: Number(handle.xFt),
    yFt: Number(handle.yFt),
  }
}

function normalizeActorRouteStyle(style: SerializedActorRouteStyle | undefined): SerializedActorRouteStyle | undefined {
  if (!style || !isRecord(style)) {
    return undefined
  }

  return {
    curved: readOptionalBoolean(style.curved),
    curveIntensity: readOptionalFiniteNumber(style.curveIntensity),
    lineStyle: readOptionalRouteLineStyle(style.lineStyle),
  }
}

function normalizePoint(point: TimedPathPoint, pathId: string, pointIndex: number): TimedPathPoint {
  if (!point || !Number.isFinite(point.xFt) || !Number.isFinite(point.yFt)) {
    throw new Error(`Point ${pointIndex} on path ${pathId} must contain finite xFt and yFt values`)
  }

  const timeSec = point.timeSec
  if (timeSec !== undefined && !Number.isFinite(timeSec)) {
    throw new Error(`Point ${pointIndex} on path ${pathId} has a non-finite timeSec value`)
  }

  return {
    xFt: point.xFt,
    yFt: point.yFt,
    timeSec,
    action: point.action,
    metadata: point.metadata,
  }
}

function normalizeDerivedEvents(events: DerivedEvent[]): DerivedEvent[] {
  if (!Array.isArray(events)) {
    throw new Error("Serialized drill derivedEvents must be an array")
  }

  return events.map((event, index) => {
    if (!event || typeof event.type !== "string" || !Number.isFinite(event.timeSec)) {
      throw new Error(`Derived event at index ${index} is invalid`)
    }

    return {
      id: typeof event.id === "string" ? event.id : `${event.type}:event:${index}`,
      type: event.type,
      timeSec: event.timeSec,
      endTimeSec: event.endTimeSec,
      actorIds: Array.isArray(event.actorIds) ? [...event.actorIds] : undefined,
      pathId: readOptionalString(event.pathId),
      confidence: Number.isFinite(event.confidence) ? event.confidence : undefined,
      data: event.data,
    }
  }).sort((left, right) => left.timeSec - right.timeSec)
}

function normalizeAnnotations(annotations: SerializedAnnotation[] | undefined): SerializedAnnotation[] {
  if (!annotations) {
    return []
  }

  if (!Array.isArray(annotations)) {
    throw new Error("Serialized drill annotations must be an array")
  }

  return annotations.map((annotation, index) => {
    if (!annotation || typeof annotation.id !== "string" || typeof annotation.type !== "string") {
      throw new Error(`Annotation at index ${index} is invalid`)
    }

    // Accept legacy/dev annotation types ('arrow', 'draw') by coercing them to
    // the supported runtime annotation type 'stroke'. This prevents the
    // serializer from throwing on older or dev-generated data after the UI
    // removed Arrow/Draw tools.
    let resolvedType: unknown = annotation.type
    if (annotation.type === "arrow" || annotation.type === "draw") {
      resolvedType = "stroke"
    }

    if (!isSerializedAnnotationType(resolvedType)) {
      throw new Error(`Annotation at index ${index} is invalid`)
    }

    if (!Number.isFinite(annotation.xFt) || !Number.isFinite(annotation.yFt)) {
      throw new Error(`Annotation ${annotation.id} must include finite xFt and yFt values`)
    }

    const rotationDeg = annotation.rotationDeg
    if (rotationDeg !== undefined && !Number.isFinite(rotationDeg)) {
      throw new Error(`Annotation ${annotation.id} has a non-finite rotationDeg value`)
    }

    return {
      id: annotation.id,
      type: resolvedType as SerializedAnnotationType,
      label: readOptionalString(annotation.label),
      teamRole: readOptionalTeamRole(annotation.teamRole),
      xFt: annotation.xFt,
      yFt: annotation.yFt,
      rotationDeg: rotationDeg !== undefined ? Number(rotationDeg) : undefined,
      color: readOptionalString(annotation.color),
      strokeWidth: typeof annotation.strokeWidth === "number" && Number.isFinite(annotation.strokeWidth) ? annotation.strokeWidth : undefined,
      metadata: isRecord(annotation.metadata) ? annotation.metadata : undefined,
    }
  })
}

function normalizeDrawLines(drawLines: unknown): SerializedDrawLine[] {
  if (!Array.isArray(drawLines)) return []
  return drawLines
    .filter((dl): dl is Record<string, unknown> => isRecord(dl) && typeof dl.id === "string" && Array.isArray(dl.points))
    .map((dl) => ({
      id: dl.id as string,
      points: (dl.points as Array<unknown>)
        .filter((pt): pt is Record<string, unknown> => isRecord(pt) && Number.isFinite((pt as Record<string, unknown>).xFt) && Number.isFinite((pt as Record<string, unknown>).yFt))
        .map((pt) => ({ xFt: Number(pt.xFt), yFt: Number(pt.yFt) })),
      color: readOptionalString(dl.color),
      lineType: dl.lineType === "dashed" || dl.lineType === "dotted" ? dl.lineType : "solid",
      lineWeight: dl.lineWeight === "thin" || dl.lineWeight === "thick" ? dl.lineWeight : "medium",
      startArrow: normalizeDrawArrow(dl.startArrow ?? (dl.arrowheads === "start" || dl.arrowheads === "both" ? "arrow" : undefined), "none"),
      endArrow: normalizeDrawArrow(dl.endArrow ?? (dl.arrowheads === "end" || dl.arrowheads === "both" ? "arrow" : undefined), "arrow"),
      attachedActorId: typeof dl.attachedActorId === "string" ? dl.attachedActorId : null,
    }))
}

function normalizeDrawArrow(value: unknown, defaultValue: DrawLineArrowType): DrawLineArrowType {
  return value === "none" || value === "arrow" || value === "open" || value === "tee" || value === "circle"
    ? value
    : defaultValue
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function readOptionalFiniteNumber(value: unknown): number | undefined {
  return Number.isFinite(value) ? Number(value) : undefined
}

function readOptionalTeamRole(value: unknown): "home" | "away" | "neutral" | undefined {
  return value === "home" || value === "away" || value === "neutral" ? value : undefined
}

function isSerializedDrillShape(value: unknown): value is SerializedDrillInput {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.version === "string"
    && isRecord(value.metadata)
    && Array.isArray(value.actors)
    && (Array.isArray(value.paths) || Array.isArray(value.actorRoutes))
    && Array.isArray(value.derivedEvents)
}

function readOptionalRouteNodeType(value: unknown): "smooth" | "hard" | undefined {
  return value === "smooth" || value === "hard" ? value : undefined
}

function readOptionalRouteLineStyle(value: unknown): "solid" | "dashed" | "dotted" | undefined {
  return value === "solid" || value === "dashed" || value === "dotted" ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isSerializedAnnotationType(value: unknown): value is SerializedAnnotationType {
  return value === "cone" || value === "net" || value === "text" || value === "puck" || value === "stroke"
}