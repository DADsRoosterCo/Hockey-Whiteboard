import { buildPathMetrics, type PathMetrics, progressAtFootDistance } from "./pathMetrics"
import type { TimedPathPoint } from "./eventDerivation"
import { getTravelDistanceFeet } from "./motionProfiles"

export type SerializedRouteNodeType = "smooth" | "hard"

export interface SerializedActorRouteNode extends TimedPathPoint {
  nodeType?: SerializedRouteNodeType
}

export interface SerializedActorRouteBezierHandle {
  xFt: number
  yFt: number
}

export interface SerializedActorRouteBezierNode {
  xFt: number
  yFt: number
  cp1Ft?: SerializedActorRouteBezierHandle
  cp2Ft?: SerializedActorRouteBezierHandle
  nodeType?: SerializedRouteNodeType
}

export interface SerializedActorRouteStyle {
  curved?: boolean
  curveIntensity?: number
  lineStyle?: "solid" | "dashed" | "dotted"
}

export interface SerializedActorRoute {
  id: string
  actorId: string
  label?: string
  teamRole?: "home" | "away" | "neutral"
  nodes: SerializedActorRouteNode[]
  bezierNodes?: SerializedActorRouteBezierNode[]
  style?: SerializedActorRouteStyle
  metrics?: PathMetrics
}

export interface RuntimeSerializedPath {
  id: string
  actorId: string
  label?: string
  teamRole?: "home" | "away" | "neutral"
  points: TimedPathPoint[]
  metrics?: PathMetrics
}

const BEZIER_SAMPLES_PER_SEGMENT = 20

function evalCubicBezier(
  p0: { xFt: number; yFt: number },
  cp1: { xFt: number; yFt: number },
  cp2: { xFt: number; yFt: number },
  p1: { xFt: number; yFt: number },
  t: number,
): { xFt: number; yFt: number } {
  const mt = 1 - t
  return {
    xFt: mt*mt*mt * p0.xFt + 3*mt*mt*t * cp1.xFt + 3*mt*t*t * cp2.xFt + t*t*t * p1.xFt,
    yFt: mt*mt*mt * p0.yFt + 3*mt*mt*t * cp1.yFt + 3*mt*t*t * cp2.yFt + t*t*t * p1.yFt,
  }
}

export function sampleBezierRouteToTimedPoints(
  nodes: TimedPathPoint[],
  bezierNodes: SerializedActorRouteBezierNode[],
): TimedPathPoint[] {
  const result: TimedPathPoint[] = []

  result.push({
    xFt: bezierNodes[0].xFt,
    yFt: bezierNodes[0].yFt,
    timeSec: nodes[0].timeSec,
    action: nodes[0].action,
    metadata: nodes[0].metadata,
  })

  for (let i = 1; i < bezierNodes.length; i += 1) {
    const prevBez = bezierNodes[i - 1]
    const currBez = bezierNodes[i]
    const prevNode = nodes[i - 1]
    const currNode = nodes[i]

    const p0 = prevBez
    const cp1 = prevBez.cp2Ft ?? prevBez
    const cp2 = currBez.cp1Ft ?? currBez
    const p1 = currBez

    const startTime = prevNode.timeSec
    const endTime = currNode.timeSec

    for (let s = 1; s <= BEZIER_SAMPLES_PER_SEGMENT; s += 1) {
      const t = s / BEZIER_SAMPLES_PER_SEGMENT
      const pt = evalCubicBezier(p0, cp1, cp2, p1, t)
      const isAnchor = s === BEZIER_SAMPLES_PER_SEGMENT
      result.push({
        xFt: pt.xFt,
        yFt: pt.yFt,
        timeSec: startTime !== undefined && endTime !== undefined
          ? startTime + (endTime - startTime) * t
          : undefined,
        action: isAnchor ? currNode.action : undefined,
        metadata: isAnchor ? currNode.metadata : undefined,
      })
    }
  }

  return result
}

export interface ProjectRouteOpts {
  /** When true (default) generate fixed-duration frames for playback. */
  generateFrames?: boolean
  travelDurationMs?: number
  ageGroup?: string
  speedModifier?: number
}

export function projectActorRouteToSerializedPath(
  route: SerializedActorRoute,
  opts?: ProjectRouteOpts,
): RuntimeSerializedPath {
  const useBezier =
    route.bezierNodes != null &&
    route.bezierNodes.length === route.nodes.length &&
    route.bezierNodes.length >= 2

  const shouldGenerateFrames = opts?.generateFrames !== false

  let points: TimedPathPoint[]

  if (shouldGenerateFrames) {
    points = generateFramesFromRoute(route, opts?.travelDurationMs ?? 2000, opts?.ageGroup, opts?.speedModifier)
  } else {
    points = useBezier
      ? sampleBezierRouteToTimedPoints(route.nodes, route.bezierNodes!)
      : route.nodes.map((node) => ({
          xFt: node.xFt,
          yFt: node.yFt,
          timeSec: node.timeSec,
          action: node.action,
          metadata: node.metadata,
        }))
  }

  return {
    id: route.id,
    actorId: route.actorId,
    label: route.label,
    teamRole: route.teamRole,
    points,
    metrics: buildPathMetrics(points),
  }
}

export function projectSerializedPathToActorRoute(path: RuntimeSerializedPath): SerializedActorRoute {
  const nodes = path.points.map((point) => ({
    xFt: point.xFt,
    yFt: point.yFt,
    timeSec: point.timeSec,
    action: point.action,
    metadata: point.metadata,
  }))

  return {
    id: path.id,
    actorId: path.actorId,
    label: path.label,
    teamRole: path.teamRole,
    nodes,
    metrics: buildPathMetrics(nodes),
  }
}

export function projectActorRoutesToSerializedPaths(routes: SerializedActorRoute[]): RuntimeSerializedPath[] {
  return routes.map((route) => projectActorRouteToSerializedPath(route))
}

/**
 * Generate frame-aligned timed points from a canonical route.
 * Produces points spaced by travelDistance (computed via motionProfiles)
 * and assigns `timeSec = frameIndex * (travelDurationMs / 1000)`.
 */
export function generateFramesFromRoute(
  route: SerializedActorRoute,
  travelDurationMs = 2000,
  ageGroup?: string,
  speedModifier = 0,
): TimedPathPoint[] {
  const useBezier =
    route.bezierNodes != null &&
    route.bezierNodes.length === route.nodes.length &&
    route.bezierNodes.length >= 2

  const sampled: TimedPathPoint[] = useBezier
    ? sampleBezierRouteToTimedPoints(route.nodes, route.bezierNodes!)
    : route.nodes.map((n) => ({ xFt: n.xFt, yFt: n.yFt }))

  const metrics = buildPathMetrics(sampled)
  const totalFootLength = metrics.totalFootLength

  // If there are fewer than two sampled points (no segments), we can't
  // interpolate along segments. Return the sampled points with time
  // assigned based on frame timing so callers still receive usable
  // timed frames instead of throwing when accessing segment metrics.
  if (sampled.length < 2 || metrics.segments.length === 0) {
    return sampled.map((p, idx) => ({
      xFt: p.xFt,
      yFt: p.yFt,
      timeSec: (idx * travelDurationMs) / 1000,
      action: p.action,
      metadata: p.metadata,
    }))
  }

  const distancePerFrame = getTravelDistanceFeet("skating", ageGroup, speedModifier, travelDurationMs) ?? 0

  const framesNeeded = distancePerFrame > 0
    ? Math.max(1, Math.ceil(totalFootLength / distancePerFrame))
    : 1

  const frames: TimedPathPoint[] = []

  for (let i = 0; i <= framesNeeded; i += 1) {
    const desiredDistance = Math.min(i * distancePerFrame, totalFootLength)

    // Find segment containing desiredDistance (defensively)
    let segIndex = 0
    for (let s = 0; s < metrics.segments.length; s += 1) {
      const segCandidate = metrics.segments[s]
      if (!segCandidate) continue
      const segStart = segCandidate.cumulativeFootStart ?? 0
      const segEnd = segStart + (segCandidate.footLength ?? 0)
      if (desiredDistance <= segEnd || s === metrics.segments.length - 1) {
        segIndex = s
        break
      }
    }

    // Clamp to safe index and warn if out-of-range
    const safeIndex = Math.max(0, Math.min(segIndex, Math.max(0, metrics.segments.length - 1)))
    let seg = metrics.segments[safeIndex]
    if (!seg) {
      // eslint-disable-next-line no-console
      console.warn("generateFramesFromRoute: no segment available after clamping", { segIndex, safeIndex, segments: metrics.segments.length, desiredDistance })
      // create a fallback zero-length segment
      seg = { cumulativeFootStart: 0, footLength: 0, normLength: 0, cumulativeNormStart: 0 }
    }
    const segStart = seg.cumulativeFootStart
    const segmentLength = seg.footLength
    const localT = segmentLength > 0 ? (desiredDistance - segStart) / segmentLength : 0

    // Interpolate between sampled[safeIndex] and sampled[safeIndex + 1]
    const a = sampled[safeIndex]
    const b = sampled[Math.min(safeIndex + 1, sampled.length - 1)]
    const xFt = a.xFt + (b.xFt - a.xFt) * localT
    const yFt = a.yFt + (b.yFt - a.yFt) * localT

    frames.push({
      xFt,
      yFt,
      timeSec: (i * travelDurationMs) / 1000,
    })
  }

  // Map anchor semantics (nearest anchor → frame index) and propagate action/metadata
  for (let nodeIndex = 0; nodeIndex < route.nodes.length; nodeIndex += 1) {
    const anchor = route.nodes[nodeIndex]
    // find nearest sampled point index for anchor
    let cumulative = 0
    let foundDist = 0
    let foundIndex = 0
    for (let s = 0; s < sampled.length - 1; s += 1) {
      const dx = sampled[s + 1].xFt - sampled[s].xFt
      const dy = sampled[s + 1].yFt - sampled[s].yFt
      const segLen = Math.hypot(dx, dy)
      const dxA = anchor.xFt - sampled[s].xFt
      const dyA = anchor.yFt - sampled[s].yFt
      const distToSample = Math.hypot(dxA, dyA)
      if (s === 0 || distToSample < foundDist) {
        foundDist = distToSample
        foundIndex = s
        foundDist = distToSample
      }
      cumulative += segLen
    }

    // anchor cumulative distance approx
    const anchorDistance = Math.min(metrics.totalFootLength, foundIndex * (metrics.totalFootLength / Math.max(1, sampled.length - 1)))
    const frameIndex = distancePerFrame > 0 ? Math.round(anchorDistance / distancePerFrame) : 0
    const clampedFrameIndex = Math.max(0, Math.min(frames.length - 1, frameIndex))
    const target = frames[clampedFrameIndex]
    if (!target) continue
    if (anchor.action !== undefined) target.action = anchor.action
    if (anchor.metadata !== undefined) target.metadata = anchor.metadata
    // Node-level semantics: nodeType hard -> mark action in metadata if not part of RuntimePathAction
    if ((anchor as any).nodeType === "hard") {
      const nodeAction = (anchor as any).metadata?.breakType ?? (anchor as any).action ?? anchor.metadata?.action ?? anchor.metadata?.nodeAction
      if (nodeAction === "stop") {
        target.action = "stop" as any
        // duplicate same position into next frame to represent a pause if available
        const nextIdx = Math.min(frames.length - 1, clampedFrameIndex + 1)
        if (frames[nextIdx]) {
          frames[nextIdx].xFt = target.xFt
          frames[nextIdx].yFt = target.yFt
        }
      } else if (nodeAction === "pivot") {
        target.action = "pivot" as any
        target.metadata = { ...(target.metadata ?? {}), pivot: anchor.metadata }
      }
    }
  }

  // compute metrics for frames
  return frames
}