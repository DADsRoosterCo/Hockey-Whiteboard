// Geometry utilities for working with RinkSpec objects. These functions
// convert between rink coordinates and SVG coordinates, construct paths
// for rounded rink outlines and arcs, provide grid snapping, and test
// whether points lie inside polygons. Utilities are pure and free of
// rendering concerns.

import type { RinkPoint2D, RinkSpec } from "./rinkTypes"

/**
 * Construct an SVG viewBox string for the rink. A small padding (in feet)
 * may be applied to ensure that lines and labels render fully within
 * the SVG viewport. The viewBox is in rink units (feet).
 */
export function getRinkViewBox(spec: RinkSpec, paddingFt = 12): string {
  const { lengthFt, widthFt } = spec.surface
  return `${-paddingFt} ${-paddingFt} ${lengthFt + paddingFt * 2} ${
    widthFt + paddingFt * 2
  }`
}

/**
 * Convert a rink coordinate into an SVG coordinate. For now this is a
 * no-op because our SVG coordinates map directly to feet units. This
 * function exists to support future coordinate systems (e.g. flipping
 * y-axis or scaling to pixel units).
 */
export function rinkPointToSvgPoint(point: RinkPoint2D): { x: number; y: number } {
  return {
    x: point.xFt,
    y: point.yFt,
  }
}

/**
 * Snap a point to the nearest grid intersection. Grid size is in feet.
 */
export function snapPointToGrid(point: RinkPoint2D, gridSizeFt: number): RinkPoint2D {
  return {
    xFt: Math.round(point.xFt / gridSizeFt) * gridSizeFt,
    yFt: Math.round(point.yFt / gridSizeFt) * gridSizeFt,
  }
}

/**
 * Ray-casting algorithm to determine whether a point lies inside a polygon.
 * The polygon is defined by a list of points in order. Returns true if
 * inside or on the boundary, false otherwise.
 */
export function isPointInsidePolygon(point: RinkPoint2D, polygon: RinkPoint2D[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].xFt
    const yi = polygon[i].yFt
    const xj = polygon[j].xFt
    const yj = polygon[j].yFt
    const intersect = yi > point.yFt !== yj > point.yFt &&
      point.xFt < ((xj - xi) * (point.yFt - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Given a RinkSpec and a point, return all semantic zones that contain
 * that point. Useful for analytics and event derivation.
 */
export function getContainingSemanticZones(
  spec: RinkSpec,
  point: RinkPoint2D,
): RinkSpec["semanticZones"] {
  return spec.semanticZones.filter((zone) => isPointInsidePolygon(point, zone.polygon))
}

/**
 * Generate an SVG path for the rounded rectangle outline of the rink.
 * The corners are circular arcs with radius equal to spec.surface.cornerRadiusFt.
 */
export function roundedRinkPath(spec: RinkSpec): string {
  const { lengthFt: l, widthFt: w, cornerRadiusFt: r } = spec.surface
  return [
    `M ${r} 0`, // start at top-left straight section
    `H ${l - r}`, // top straight section
    `A ${r} ${r} 0 0 1 ${l} ${r}`, // top-right corner arc
    `V ${w - r}`, // right straight section
    `A ${r} ${r} 0 0 1 ${l - r} ${w}`, // bottom-right corner
    `H ${r}`, // bottom straight section
    `A ${r} ${r} 0 0 1 0 ${w - r}`, // bottom-left corner
    `V ${r}`, // left straight section
    `A ${r} ${r} 0 0 1 ${r} 0`, // top-left corner
    "Z",
  ].join(" ")
}

/**
 * Generate an SVG arc path. This returns a path string starting at the
 * start angle and sweeping to the end angle in a clockwise direction.
 * Angles are measured in degrees where 0° points to the right and
 * positive angles rotate anticlockwise. The largeArcFlag is set based on
 * the sweep angle. Note: arcs greater than 360° are not supported.
 */
export function arcPath(
  center: RinkPoint2D,
  radiusFt: number,
  startDeg: number,
  endDeg: number,
): string {
  const startRad = (Math.PI / 180) * startDeg
  const endRad = (Math.PI / 180) * endDeg
  const start = {
    x: center.xFt + radiusFt * Math.cos(startRad),
    y: center.yFt + radiusFt * Math.sin(startRad),
  }
  const end = {
    x: center.xFt + radiusFt * Math.cos(endRad),
    y: center.yFt + radiusFt * Math.sin(endRad),
  }
  const sweep = endDeg - startDeg
  const largeArcFlag = Math.abs(sweep) > 180 ? 1 : 0
  // Sweep flag: 1 for positive angle (clockwise), 0 for counterclockwise
  const sweepFlag = sweep >= 0 ? 1 : 0
  return `M ${start.x} ${start.y} A ${radiusFt} ${radiusFt} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`
}