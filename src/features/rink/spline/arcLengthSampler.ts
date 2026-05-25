/**
 * ArcLengthSampler – constant-speed traversal of a cubic Bezier spline.
 *
 * Algorithm:
 *  1. For each segment (anchor[i] → anchor[i+1]), sample the cubic bezier at
 *     SAMPLES_PER_SEGMENT evenly-spaced t values and accumulate chord lengths
 *     into a cumulative arc-length table.
 *  2. Expose `getPositionAtDistance(ft)` which binary-searches the table and
 *     interpolates for sub-sample precision.
 *
 * This is the same approach used by yasirkula/UnityBezierSolution's
 * EvenlySpacedPointsHolder and BezierWalkerWithSpeed.
 */

import type { EditableSpline, Pt } from "./editableSpline";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Number of chord samples per spline segment. Higher = more accurate lengths. */
const SAMPLES_PER_SEGMENT = 64;

// ---------------------------------------------------------------------------
// Table entry
// ---------------------------------------------------------------------------

interface ArcEntry {
  /** Cumulative arc-length in feet from the start of the spline to this sample. */
  distFt: number;
  /** Spline-global segment index (0-based). */
  segIndex: number;
  /** Parametric t within the segment [0, 1]. */
  t: number;
  /** World position. */
  pos: Pt;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ArcLengthTable {
  entries: ArcEntry[];
  /** Total length of the spline in feet. */
  totalFt: number;
  /** Number of cubic segments (= anchors - 1). */
  segmentCount: number;
}

// ---------------------------------------------------------------------------
// Cubic Bezier evaluation
// ---------------------------------------------------------------------------

function evalCubic(
  p0: Pt, cp1: Pt, cp2: Pt, p1: Pt, t: number,
): Pt {
  const mt = 1 - t;
  return {
    xFt: mt*mt*mt*p0.xFt + 3*mt*mt*t*cp1.xFt + 3*mt*t*t*cp2.xFt + t*t*t*p1.xFt,
    yFt: mt*mt*mt*p0.yFt + 3*mt*mt*t*cp1.yFt + 3*mt*t*t*cp2.yFt + t*t*t*p1.yFt,
  };
}

// ---------------------------------------------------------------------------
// Table construction
// ---------------------------------------------------------------------------

/**
 * Build an arc-length lookup table for the given spline.
 * Returns a zero-length table if the spline has fewer than 2 anchors.
 */
export function buildArcLengthTable(spline: EditableSpline): ArcLengthTable {
  const { anchors, handles } = spline;
  if (anchors.length < 2) {
    return { entries: [], totalFt: 0, segmentCount: 0 };
  }

  const entries: ArcEntry[] = [];
  let totalFt = 0;

  // Always push the very first point at distance 0.
  entries.push({ distFt: 0, segIndex: 0, t: 0, pos: { xFt: anchors[0].xFt, yFt: anchors[0].yFt } });

  for (let seg = 0; seg < anchors.length - 1; seg++) {
    const a0 = anchors[seg];
    const a1 = anchors[seg + 1];
    const cp1 = handles[a0.id]?.out ?? { xFt: a0.xFt, yFt: a0.yFt };
    const cp2 = handles[a1.id]?.in  ?? { xFt: a1.xFt, yFt: a1.yFt };

    let prevPos: Pt = { xFt: a0.xFt, yFt: a0.yFt };

    for (let s = 1; s <= SAMPLES_PER_SEGMENT; s++) {
      const t = s / SAMPLES_PER_SEGMENT;
      const pos = evalCubic(a0, cp1, cp2, a1, t);
      const chord = Math.hypot(pos.xFt - prevPos.xFt, pos.yFt - prevPos.yFt);
      totalFt += chord;
      entries.push({ distFt: totalFt, segIndex: seg, t, pos });
      prevPos = pos;
    }
  }

  return { entries, totalFt, segmentCount: anchors.length - 1 };
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * Return the world position on the spline at a given arc-length distance (feet).
 * Clamps to [0, totalFt].
 */
export function getPositionAtDistance(table: ArcLengthTable, distFt: number): Pt {
  if (table.entries.length === 0) return { xFt: 0, yFt: 0 };
  const clamped = Math.max(0, Math.min(table.totalFt, distFt));

  const { entries } = table;

  // Binary search for the first entry whose distFt >= clamped.
  let lo = 0;
  let hi = entries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].distFt < clamped) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  if (lo === 0) return entries[0].pos;
  if (lo >= entries.length) return entries[entries.length - 1].pos;

  const a = entries[lo - 1];
  const b = entries[lo];
  const span = b.distFt - a.distFt;
  if (span <= 0) return b.pos;

  const alpha = (clamped - a.distFt) / span;
  return {
    xFt: a.pos.xFt + alpha * (b.pos.xFt - a.pos.xFt),
    yFt: a.pos.yFt + alpha * (b.pos.yFt - a.pos.yFt),
  };
}

/**
 * Return the normalized spline parameter t ∈ [0, 1] corresponding to a given
 * arc-length distance.  Useful for deriving tangents.
 */
export function getNormalizedTAtDistance(table: ArcLengthTable, distFt: number): number {
  if (table.entries.length === 0 || table.totalFt <= 0) return 0;
  const clamped = Math.max(0, Math.min(table.totalFt, distFt));

  const { entries } = table;
  let lo = 0;
  let hi = entries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].distFt < clamped) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return 0;
  if (lo >= entries.length) return 1;

  const a = entries[lo - 1];
  const b = entries[lo];
  const segSpan = b.distFt - a.distFt;
  const alpha = segSpan > 0 ? (clamped - a.distFt) / segSpan : 0;

  // Blend t value within the segment
  const blendedLocalT = a.t + alpha * (b.t - a.t);
  // Convert to global normalized t across all segments
  return (a.segIndex + blendedLocalT) / table.segmentCount;
}

/**
 * Sample the spline at evenly-spaced distance intervals.
 * Returns `count` positions including start (distance 0) and end (distance totalFt).
 */
export function sampleEvenlySpaced(table: ArcLengthTable, count: number): Pt[] {
  if (count <= 0 || table.totalFt <= 0 || table.entries.length === 0) return [];
  const result: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const dist = (i / (count - 1)) * table.totalFt;
    result.push(getPositionAtDistance(table, dist));
  }
  return result;
}

/**
 * Sample the spline at regular distance intervals of `stepFt` feet.
 * First point is at distance 0; last point is at totalFt if it falls
 * on a boundary, otherwise truncated.
 */
export function sampleAtInterval(table: ArcLengthTable, stepFt: number): Pt[] {
  if (stepFt <= 0 || table.totalFt <= 0) return [];
  const result: Pt[] = [];
  let dist = 0;
  while (dist <= table.totalFt + 1e-6) {
    result.push(getPositionAtDistance(table, dist));
    dist += stepFt;
  }
  return result;
}
