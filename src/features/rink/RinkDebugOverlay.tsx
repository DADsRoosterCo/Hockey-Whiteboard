// Debug overlay for the rink. This component optionally renders labels
// indicating the names of semantic zones. It is only rendered when
// settings.showDebugLabels is true. It should be used within an SVG
// context and does not apply its own clipping.

import React from "react"
import type { RinkSpec, RinkSettings, SemanticZone } from "./rinkTypes"

interface RinkDebugOverlayProps {
  spec: RinkSpec
  settings: RinkSettings
}

/**
 * Compute the centroid of a polygon. The centroid is the arithmetic mean
 * of the polygon's vertices. This is a simple approach suitable for
 * convex polygons and roughly centred labels. For concave shapes the
 * centroid may lie outside the polygon.
 */
function getPolygonCentroid(polygon: SemanticZone["polygon"]): { xFt: number; yFt: number } {
  let xSum = 0
  let ySum = 0
  const n = polygon.length
  polygon.forEach((pt) => {
    xSum += pt.xFt
    ySum += pt.yFt
  })
  return { xFt: xSum / n, yFt: ySum / n }
}

export function RinkDebugOverlay({ spec, settings }: RinkDebugOverlayProps) {
  if (!settings.showDebugLabels) return null
  return (
    <g className="rink-debug-overlay">
      {(settings.visibleZoneIds
        ? spec.semanticZones.filter((z) => settings.visibleZoneIds!.includes(z.id))
        : spec.semanticZones
      ).map((zone) => {
        const centroid = getPolygonCentroid(zone.polygon)
        return (
          <text
            key={zone.id}
            x={centroid.xFt}
            y={centroid.yFt}
            fill="#6b7280"
            fontSize="3"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {zone.name}
          </text>
        )
      })}
    </g>
  )
}