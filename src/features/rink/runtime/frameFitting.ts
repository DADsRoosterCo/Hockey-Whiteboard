import type { SerializedActorRoute, SerializedActorRouteBezierNode } from "./routeProjection"
import { sampleBezierRouteToTimedPoints } from "./routeProjection"
import { getTravelDistanceFeet } from "./motionProfiles"
import type { TimedPathPoint, RuntimePathAction } from "./eventDerivation"

function distanceBetween(a: { xFt: number; yFt: number }, b: { xFt: number; yFt: number }) {
  const dx = b.xFt - a.xFt
  const dy = b.yFt - a.yFt
  return Math.hypot(dx, dy)
}

function buildCumulativeDistances(points: { xFt: number; yFt: number }[]) {
  const cum: number[] = []
  let total = 0
  for (let i = 0; i < points.length; i += 1) {
    if (i === 0) cum.push(0)
    else {
      total += distanceBetween(points[i - 1], points[i])
      cum.push(total)
    }
  }
  return { cumulative: cum, total }
}

function pointAtDistance(points: { xFt: number; yFt: number }[], cumulative: number[], distance: number) {
  if (points.length === 0) return undefined
  if (points.length === 1) return { xFt: points[0].xFt, yFt: points[0].yFt }
  const total = cumulative[cumulative.length - 1]
  const clamped = Math.max(0, Math.min(total, distance))

  // find segment
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = cumulative[i]
    const end = cumulative[i + 1]
    if (clamped <= end || i === points.length - 2) {
      const segLen = end - start
      const local = segLen <= 0 ? 0 : (clamped - start) / segLen
      const a = points[i]
      const b = points[i + 1]
      return {
        xFt: a.xFt + (b.xFt - a.xFt) * local,
        yFt: a.yFt + (b.yFt - a.yFt) * local,
      }
    }
  }

  return { xFt: points[points.length - 1].xFt, yFt: points[points.length - 1].yFt }
}

/**
 * Generate frame-aligned timed points for a given actor route.
 *
 * - `frameDurationMs` defaults to 2000 (2s per frame)
 * - If bezier nodes are present the route is sampled into a polyline first
 */
export function generateFramePointsForRoute(
  route: SerializedActorRoute,
  ageGroup: string | undefined,
  speedModifier: number,
  frameDurationMs = 2000,
): TimedPathPoint[] {
  const useBezier = Array.isArray(route.bezierNodes) && route.bezierNodes.length === route.nodes.length

  const sampledPoints: TimedPathPoint[] = useBezier
    ? sampleBezierRouteToTimedPoints(route.nodes as TimedPathPoint[], route.bezierNodes as SerializedActorRouteBezierNode[])
    : route.nodes.map((n) => ({ xFt: n.xFt, yFt: n.yFt, timeSec: n.timeSec, action: n.action, metadata: n.metadata }))

  if (sampledPoints.length === 0) return []

  const spatialPoints = sampledPoints.map((p) => ({ xFt: p.xFt, yFt: p.yFt }))
  const { cumulative, total } = buildCumulativeDistances(spatialPoints)

  if (total <= 0) {
    // degenerate route: single point
    return [{ xFt: spatialPoints[0].xFt, yFt: spatialPoints[0].yFt, timeSec: 0, action: sampledPoints[0].action }]
  }

  const distancePerFrame = getTravelDistanceFeet("skating", ageGroup, speedModifier, frameDurationMs) ?? total
  const framesNeeded = Math.max(1, Math.ceil(total / distancePerFrame))

  const frames: TimedPathPoint[] = []
  for (let i = 0; i <= framesNeeded; i += 1) {
    const desiredDistance = Math.min(total, i * distancePerFrame)
    const pt = pointAtDistance(spatialPoints, cumulative, desiredDistance)!
    frames.push({ xFt: pt.xFt, yFt: pt.yFt, timeSec: (i * frameDurationMs) / 1000 })
  }

  // Map anchor actions/metadata to nearest frame (anchors in sampledPoints often carry action/metadata)
  for (let s = 0; s < sampledPoints.length; s += 1) {
    const sp = sampledPoints[s]
    if (!sp.action && !sp.metadata) continue
    const dist = cumulative[s]
    const frameIndex = Math.round(dist / distancePerFrame)
    const clamped = Math.max(0, Math.min(frames.length - 1, frameIndex))
    const existing = frames[clamped]
    if (!existing) continue
    // prefer explicit breakType metadata (e.g. 'stop'|'pivot') over legacy action fields
    const spNodeAction = sp.metadata?.breakType ?? sp.action ?? sp.metadata?.action ?? sp.metadata?.nodeAction
    if (spNodeAction) {
      if (!existing.action && typeof spNodeAction === "string") existing.action = spNodeAction as RuntimePathAction
      if (spNodeAction === "stop") {
        const nextIdx = Math.min(frames.length - 1, clamped + 1)
        if (frames[nextIdx]) {
          frames[nextIdx].xFt = existing.xFt
          frames[nextIdx].yFt = existing.yFt
        }
      } else if (spNodeAction === "pivot") {
        existing.metadata = { ...(existing.metadata ?? {}), pivot: sp.metadata }
      }
    } else {
      if (!existing.action) existing.action = sp.action
      if (!existing.metadata) existing.metadata = sp.metadata
    }
  }

  return frames
}

export default generateFramePointsForRoute
