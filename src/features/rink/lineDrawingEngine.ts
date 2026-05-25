// Pure line-drawing engine called by the MCP layer. No rendering concerns here —
// this module is the application's authoritative source for line creation and measurement.
//
// Design contract: length always comes from measurePolylineDistanceFeet, never from the
// AI or MCP server. If this module changes how it measures, the MCP response changes too.

import { measurePolylineDistanceFeet } from "./runtime/pathMetrics"

// ─── Rink bounds (Hockey Canada 200 × 85 ft) ────────────────────────────────

const RINK_LENGTH_FT = 200
const RINK_WIDTH_FT = 85

// ─── Input / output schemas ──────────────────────────────────────────────────

export interface DrawRinkLineStyle {
  color?: string
  lineWeight?: number
  arrowStart?: boolean
  arrowEnd?: boolean
}

export interface DrawRinkLineMetadata {
  label?: string
  purpose?: string
}

export interface DrawRinkLineParams {
  /** Two-point line (backward compatible). Required unless `points` is given. */
  start?: { x: number; y: number }
  end?: { x: number; y: number }
  /** Polyline: 2 or more points. When provided, `start`/`end` are ignored. */
  points?: Array<{ x: number; y: number }>
  style?: DrawRinkLineStyle
  metadata?: DrawRinkLineMetadata
  /** When true, display the line length as a label on the canvas. Defaults to false. */
  showLength?: boolean
}

export interface DrawRinkLineResultStyle {
  color: string
  lineWeight: number
  arrowStart: boolean
  arrowEnd: boolean
}

export interface DrawRinkLineResult {
  objectId: string
  type: "line"
  start: { x: number; y: number }
  end: { x: number; y: number }
  /** Present for polylines (3+ points or explicit multi-point input). */
  points?: Array<{ x: number; y: number }>
  length: number | null
  units: string | null
  /** Whether to display the length as a canvas label. Always false by default. */
  showLength: boolean
  style: DrawRinkLineResultStyle
  metadata: { label: string | null; purpose: string | null }
  warning?: string
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string
  message: string
}

export function validateDrawRinkLineParams(params: DrawRinkLineParams): ValidationError[] {
  const errors: ValidationError[] = []

  const checkCoord = (axis: "x" | "y", value: unknown, label: string) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push({ field: label, message: "must be a finite number" })
      return
    }
    const max = axis === "x" ? RINK_LENGTH_FT : RINK_WIDTH_FT
    if (value < 0 || value > max) {
      errors.push({ field: label, message: `must be between 0 and ${max} ft` })
    }
  }

  const hasPoints = Array.isArray(params.points) && params.points.length >= 2

  if (hasPoints) {
    params.points!.forEach((pt, i) => {
      checkCoord("x", pt?.x, `points[${i}].x`)
      checkCoord("y", pt?.y, `points[${i}].y`)
    })
  } else {
    if (!params.start || !params.end) {
      errors.push({ field: "points", message: "provide either `points` (2+ items) or both `start` and `end`" })
    } else {
      checkCoord("x", params.start?.x, "start.x")
      checkCoord("y", params.start?.y, "start.y")
      checkCoord("x", params.end?.x, "end.x")
      checkCoord("y", params.end?.y, "end.y")
    }
  }

  if (params.style != null) {
    const { color, lineWeight, arrowStart, arrowEnd } = params.style

    if (color !== undefined && typeof color !== "string") {
      errors.push({ field: "style.color", message: "must be a string" })
    }
    if (lineWeight !== undefined) {
      if (typeof lineWeight !== "number" || !Number.isFinite(lineWeight) || lineWeight <= 0) {
        errors.push({ field: "style.lineWeight", message: "must be a positive number" })
      }
    }
    if (arrowStart !== undefined && typeof arrowStart !== "boolean") {
      errors.push({ field: "style.arrowStart", message: "must be a boolean" })
    }
    if (arrowEnd !== undefined && typeof arrowEnd !== "boolean") {
      errors.push({ field: "style.arrowEnd", message: "must be a boolean" })
    }
  }

  return errors
}

// ─── Engine function ─────────────────────────────────────────────────────────

const DEFAULT_COLOR = "#ffffff"
const DEFAULT_LINE_WEIGHT = 1.5

/**
 * Create a rink line using the application's measurement engine.
 * Length is derived from measurePolylineDistanceFeet — the canonical app function —
 * not from the MCP server or AI.
 */
export function drawRinkLine(params: DrawRinkLineParams): DrawRinkLineResult {
  const { style = {}, metadata = {} } = params

  // Resolve the canonical list of points
  const allPoints: Array<{ x: number; y: number }> =
    params.points && params.points.length >= 2
      ? params.points
      : [params.start!, params.end!]

  const start = allPoints[0]
  const end = allPoints[allPoints.length - 1]
  const isPolyline = allPoints.length > 2

  const resolvedStyle: DrawRinkLineResultStyle = {
    color: style.color ?? DEFAULT_COLOR,
    lineWeight: style.lineWeight ?? DEFAULT_LINE_WEIGHT,
    arrowStart: style.arrowStart ?? false,
    arrowEnd: style.arrowEnd ?? false,
  }

  // Delegate to the app's own measurement function — this is the authoritative length.
  const lengthFt = measurePolylineDistanceFeet(
    allPoints.map(p => ({ xFt: p.x, yFt: p.y }))
  )

  return {
    objectId: crypto.randomUUID(),
    type: "line",
    start,
    end,
    ...(isPolyline ? { points: allPoints } : {}),
    length: lengthFt,
    units: "feet",
    showLength: params.showLength ?? false,
    style: resolvedStyle,
    metadata: {
      label: metadata.label ?? null,
      purpose: metadata.purpose ?? null,
    },
  }
}
