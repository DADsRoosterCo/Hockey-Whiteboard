// React component responsible for rendering a regulation hockey rink
// described by a RinkSpec. The canvas uses SVG to draw the rink
// outline, painted markings, optional grid, benches, penalty boxes,
// doors and semantic zone overlays. Consumers can customise the
// appearance via RinkSettings and override the spec.

import React, { useId } from "react"
import type {
  RinkSpec,
  RinkSettings,
  RinkMarking,
  RinkColor,
} from "./rinkTypes"
import { hockeyCanadaRinkSpec } from "./hockeyCanadaRinkSpec"
import {
  getRinkViewBox,
  roundedRinkPath,
  arcPath,
} from "./rinkGeometry"
import { RinkDebugOverlay } from "./RinkDebugOverlay"

// Colour palette mapping semantic colours to CSS colours. These may be
// adjusted to suit your design system. Unknown colours fall back to
// their literal name which allows users to specify hex values directly.
const COLOR_MAP: Record<string, string> = {
  red: "#dc2626",
  blue: "#0284c7",
  white: "#f8fafc",
  black: "#0f172a",
  "crease-blue": "rgba(14, 165, 233, 0.25)",
  "neutral-zone": "rgba(34, 197, 94, 0.08)",
  "defending-zone": "rgba(248, 191, 0, 0.06)",
  "attacking-zone": "rgba(239, 68, 68, 0.06)",
}

function colorFor(color: RinkColor | undefined): string {
  return (color && COLOR_MAP[color]) || (color as string) || "#000"
}

// Default renderer settings if none are provided. A line thickness scale
// of 1 means use the spec's line widths directly. Grid is on by
// default for development but can be disabled.
const DEFAULT_SETTINGS: RinkSettings = {
  lineThicknessScale: 1,
  showGrid: true,
  gridSizeFt: 1,
  showSemanticZones: false,
  showBenches: true,
  showPenaltyBoxes: true,
  showDoors: false,
  showDebugLabels: false,

  // Handles and overrides are off by default
  showMcpHandles: false,
  visibleMarkingIds: undefined,
  visibleZoneIds: undefined,
  benchOverrides: undefined,
  penaltyBoxOverrides: undefined,
  doorOverrides: undefined,
  centerLogoSrc: undefined,
  centerLogoSizeFt: undefined,
}

export type RinkCanvasProps = {
  /**
   * Rink specification to render. Defaults to the Hockey Canada
   * regulation rink. Extend or override this to support other rink
   * dimensions and markings.
   */
  spec?: RinkSpec
  /**
   * Rendering settings. Partial overrides are merged with the defaults.
   */
  settings?: Partial<RinkSettings>
  /**
   * Width of the container (CSS value). Defaults to 100%.
   */
  width?: number | string
  /**
   * Height of the container (CSS value). Defaults to 640px.
   */
  height?: number | string
  /**
   * Callback when the user clicks on the rink. Receives the
   * approximate rink coordinates in feet.
   */
  onRinkPointClick?: (point: { xFt: number; yFt: number }) => void
}

export function RinkCanvas({
  spec = hockeyCanadaRinkSpec,
  settings: userSettings = {},
  width = "100%",
  height = "640px",
  onRinkPointClick,
}: RinkCanvasProps) {
  const instanceId = useId()
  const clipId = `${instanceId}-rink-clip`
  const gridId = `${instanceId}-rink-grid`

  const settings: RinkSettings = { ...DEFAULT_SETTINGS, ...userSettings }
  const viewBox = getRinkViewBox(spec)
  const rinkPath = roundedRinkPath(spec)

  // Compute centre coordinates for the rink
  const centreX = spec.surface.lengthFt / 2
  const centreY = spec.surface.widthFt / 2
  const logoSize = settings.centerLogoSizeFt || 20
  const logoHalf = logoSize / 2

  // Handle click events on the SVG to return rink coordinates.
  // Uses getScreenCTM so the viewBox padding and preserveAspectRatio
  // letterboxing are accounted for correctly.
  function handleClick(evt: React.MouseEvent<SVGSVGElement>) {
    if (!onRinkPointClick) return
    const svg = evt.currentTarget
    const matrix = svg.getScreenCTM()
    if (!matrix) return
    const pt = svg.createSVGPoint()
    pt.x = evt.clientX
    pt.y = evt.clientY
    const rinkPt = pt.matrixTransform(matrix.inverse())
    onRinkPointClick({
      xFt: Math.max(0, Math.min(spec.surface.lengthFt, rinkPt.x)),
      yFt: Math.max(0, Math.min(spec.surface.widthFt, rinkPt.y)),
    })
  }

  // Render a single marking based on its type. The discriminated union
  // narrows the type automatically in each case branch.
  function renderMarking(mark: RinkMarking) {
    switch (mark.type) {
      case "line":
        return (
          <line
            key={mark.id}
            x1={mark.from.xFt}
            y1={mark.from.yFt}
            x2={mark.to.xFt}
            y2={mark.to.yFt}
            stroke={colorFor(mark.color)}
            strokeWidth={(mark.widthFt || spec.defaults.lineWidthFt) * settings.lineThicknessScale}
          />
        )
      case "circle":
        return (
          <circle
            key={mark.id}
            cx={mark.center.xFt}
            cy={mark.center.yFt}
            r={mark.radiusFt}
            fill="none"
            stroke={colorFor(mark.color)}
            strokeWidth={mark.lineWidthFt * settings.lineThicknessScale}
          />
        )
      case "spot":
        return (
          <circle
            key={mark.id}
            cx={mark.center.xFt}
            cy={mark.center.yFt}
            r={mark.radiusFt}
            fill={colorFor(mark.color)}
          />
        )
      case "arc":
        return (
          <path
            key={mark.id}
            d={arcPath(mark.center, mark.radiusFt, mark.startDeg, mark.endDeg)}
            fill={mark.fill ? colorFor(mark.fill) : "none"}
            stroke={colorFor(mark.color)}
            strokeWidth={mark.lineWidthFt * settings.lineThicknessScale}
          />
        )
      case "rect": {
        const strokeWidth = mark.lineWidthFt
          ? mark.lineWidthFt * settings.lineThicknessScale
          : 0
        return (
          <rect
            key={mark.id}
            x={mark.xFt}
            y={mark.yFt}
            width={mark.widthFt}
            height={mark.heightFt}
            fill={mark.fill ? colorFor(mark.fill) : "none"}
            stroke={mark.color ? colorFor(mark.color) : "none"}
            strokeWidth={strokeWidth}
          />
        )
      }
      default:
        return null
    }
  }

  return (
    <div
      style={{
        width,
        height,
        position: "relative",
      }}
    >
      <svg
        viewBox={viewBox}
        width="100%"
        height="100%"
        className="wb-rink-svg"
        preserveAspectRatio="xMidYMid meet"
        onClick={handleClick}
      >
        {/* Clip path for the rink shape */}
        <defs>
          <clipPath id={clipId}>
            <path d={rinkPath} />
          </clipPath>
          {/* Grid pattern definition */}
          {settings.showGrid && (
            <pattern
              id={gridId}
              width={settings.gridSizeFt}
              height={settings.gridSizeFt}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${settings.gridSizeFt} 0 L 0 0 0 ${settings.gridSizeFt}`}
                fill="none"
                stroke="#e5e7eb"
                strokeWidth={0.03}
              />
            </pattern>
          )}
        </defs>

        {/* Rink outline */}
        <path
          d={rinkPath}
          fill={colorFor("white")}
          stroke={colorFor("black")}
          strokeWidth={spec.defaults.lineWidthFt * settings.lineThicknessScale}
        />

        {/* Grid inside the rink clip */}
        {settings.showGrid && (
          <rect
            x={0}
            y={0}
            width={spec.surface.lengthFt}
            height={spec.surface.widthFt}
            fill={`url(#${gridId})`}
            clipPath={`url(#${clipId})`}
          />
        )}

        {/* Semantic zones shading */}
        {settings.showSemanticZones && (
          <g clipPath={`url(#${clipId})`}>
            {(settings.visibleZoneIds
              ? spec.semanticZones.filter((zone) => settings.visibleZoneIds!.includes(zone.id))
              : spec.semanticZones
            ).map((zone) => (
              <polygon
                key={zone.id}
                points={zone.polygon
                  .map((p) => `${p.xFt},${p.yFt}`)
                  .join(" ")}
                fill={zone.color ? colorFor(zone.color) : "none"}
                opacity={0.15}
              />
            ))}
          </g>
        )}

        {/* Centre ice logo */}
        {settings.centerLogoSrc && (
          <image
            href={settings.centerLogoSrc}
            x={centreX - logoHalf}
            y={centreY - logoHalf}
            width={logoSize}
            height={logoSize}
            preserveAspectRatio="xMidYMid meet"
            clipPath={`url(#${clipId})`}
          />
        )}

        {/* Paint all rink markings */}
        <g clipPath={`url(#${clipId})`}>
          {(settings.visibleMarkingIds
            ? spec.markings.filter((m) => settings.visibleMarkingIds!.includes(m.id))
            : spec.markings
          ).map((m) => renderMarking(m))}
        </g>

        {/* Benches — rendered outside the rink clip because they sit off-ice */}
        {settings.showBenches && (
          <g>
            {(settings.benchOverrides || spec.benches).map((bench) => (
              <rect
                key={bench.id}
                x={bench.xFt}
                y={bench.yFt}
                width={bench.widthFt}
                height={bench.depthFt}
                fill="#fde68a"
                opacity={0.4}
                stroke="#f59e0b"
                strokeWidth={0.2}
              />
            ))}
          </g>
        )}

        {/* Penalty boxes — rendered outside the rink clip because they sit off-ice */}
        {settings.showPenaltyBoxes && (
          <g>
            {(settings.penaltyBoxOverrides || spec.penaltyBoxes).map((box) => (
              <rect
                key={box.id}
                x={box.xFt}
                y={box.yFt}
                width={box.widthFt}
                height={box.depthFt}
                fill="#fecaca"
                opacity={0.4}
                stroke="#f87171"
                strokeWidth={0.2}
              />
            ))}
          </g>
        )}

        {/* Doors — rendered outside the rink clip; door rects straddle the board line */}
        {settings.showDoors && (
          <g>
            {(settings.doorOverrides || spec.doors).map((door) => (
              <rect
                key={door.id}
                x={door.center.xFt - door.widthFt / 2}
                y={door.center.yFt - 0.1}
                width={door.widthFt}
                height={0.2}
                fill="#86efac"
              />
            ))}
          </g>
        )}

        {/* MCP handles — rendered outside the rink clip so corner handles
            remain fully visible at the rounded-rect boundary */}
        {settings.showMcpHandles && spec.mcpHandles && (
          <g>
            {spec.mcpHandles.map((handle, index) => (
              <circle
                key={`mcp-${index}`}
                cx={handle.xFt}
                cy={handle.yFt}
                r={0.5}
                fill="#6366f1"
                stroke="#4338ca"
                strokeWidth={0.1}
              />
            ))}
          </g>
        )}

        {/* Debug labels */}
        <RinkDebugOverlay spec={spec} settings={settings} />
      </svg>
    </div>
  )
}