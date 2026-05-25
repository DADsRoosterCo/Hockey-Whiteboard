// Utilities for measuring and mapping distances along movement paths.
//
// Paths in the drill engine are represented by a sequence of points in
// rink feet. This module provides helper functions to compute the total
// length of a polyline, build cumulative segment metrics and translate
// between normalized progress (0–1) and physical distance (feet).

import type { RinkPoint2D } from "../rinkTypes"

/**
 * A metric segment describes a single segment of a path between two
 * consecutive points. The segment has both a physical length (in feet)
 * and a normalized length (fraction of the total length). The
 * cumulative start values track the beginning of the segment relative
 * to the entire path, expressed in both normalized and physical units.
 */
export interface PathMetricSegment {
  /** The fractional length of this segment relative to the total path length. */
  normLength: number
  /** The physical length in feet of this segment. */
  footLength: number
  /** The cumulative fractional length at which this segment begins. */
  cumulativeNormStart: number
  /** The cumulative physical length in feet at which this segment begins. */
  cumulativeFootStart: number
}

/**
 * A path metrics object summarises the distances along a path. It
 * contains a list of segments, the total normalized length (always 1
 * for paths of non‑zero length) and the total physical length.
 */
export interface PathMetrics {
  segments: PathMetricSegment[]
  totalNormLength: number
  totalFootLength: number
}

/**
 * Measure the total length of a polyline defined by a list of points in
 * feet. If fewer than two points are provided, the length is zero.
 */
export function measurePolylineDistanceFeet(points: RinkPoint2D[]): number {
  if (points.length < 2) return 0
  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const dx = points[i + 1].xFt - points[i].xFt
    const dy = points[i + 1].yFt - points[i].yFt
    total += Math.hypot(dx, dy)
  }
  return total
}

/**
 * Build path metrics for a sequence of points. The resulting object
 * allows quick conversion between normalized progress along the path
 * (0–1) and physical distance in feet. If the total length is zero,
 * all segments will have zero length and normalized values will be
 * evenly distributed.
 */
export function buildPathMetrics(points: RinkPoint2D[]): PathMetrics {
  const totalFootLength = measurePolylineDistanceFeet(points)
  const segments: PathMetricSegment[] = []
  if (points.length < 2) {
    return {
      segments,
      totalNormLength: 0,
      totalFootLength: 0,
    }
  }
  let cumulativeFoot = 0
  let cumulativeNorm = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const dx = points[i + 1].xFt - points[i].xFt
    const dy = points[i + 1].yFt - points[i].yFt
    const footLength = Math.hypot(dx, dy)
    const normLength = totalFootLength > 0 ? footLength / totalFootLength : 1 / (points.length - 1)
    segments.push({
      normLength,
      footLength,
      cumulativeNormStart: cumulativeNorm,
      cumulativeFootStart: cumulativeFoot,
    })
    cumulativeFoot += footLength
    cumulativeNorm += normLength
  }
  return {
    segments,
    totalNormLength: totalFootLength > 0 ? 1 : 0,
    totalFootLength,
  }
}

/**
 * Given path metrics and a normalized progress value between 0 and 1,
 * compute the corresponding physical distance in feet along the path.
 * Progress values below 0 return 0; values above 1 return the total
 * length.
 */
export function footDistanceAtProgress(metrics: PathMetrics, progress: number): number {
  if (!Number.isFinite(progress) || metrics.totalFootLength <= 0) return 0
  const clamped = Math.max(0, Math.min(1, progress))
  return clamped * metrics.totalFootLength
}

/**
 * Given path metrics and a physical distance in feet, compute the
 * normalized progress (0–1) along the path. Distances below 0 return
 * 0; distances greater than the total length return 1.
 */
export function progressAtFootDistance(metrics: PathMetrics, distanceFeet: number): number {
  if (!Number.isFinite(distanceFeet) || metrics.totalFootLength <= 0) return 0
  const clamped = Math.max(0, Math.min(metrics.totalFootLength, distanceFeet))
  return metrics.totalFootLength > 0 ? clamped / metrics.totalFootLength : 0
}