/**
 * strokeSmoothing – post-processing pipeline for user-drawn strokes.
 *
 * Pipeline (runs after pointer-up, before spline construction):
 *   1. Resample      – normalize arc-length spacing to eliminate density artifacts
 *   2. Pre-smooth    – Laplacian (weighted-average) passes BEFORE RDP so that
 *                      RDP anchor positions are placed on already-smooth loci,
 *                      not on jittery raw input
 *   3. RDP           – Ramer–Douglas–Peucker simplification keeps only key anchors
 *   4. Chaikin       – optional post-RDP corner cutting for polyline renderers
 *                      (skip when the output goes to a bezier/Catmull-Rom spline)
 *
 * Endpoints are always preserved for open paths.
 * Raw input points are never mutated; the pipeline returns new arrays.
 *
 * Performance: all stages are O(n) — well under 10 ms for 2 000-point strokes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Pt2 = { xFt: number; yFt: number };

/**
 * Tuning knobs exposed to callers.  Reasonable defaults are provided via
 * DEFAULT_SMOOTHING_CONFIG so callers that don't need customisation can
 * just call `smoothStroke(points)`.
 */
export type SmoothingConfig = {
  /**
   * Target arc-length spacing (ft) after resampling.
   * Smaller → more points fed into RDP, slightly slower but sharper detail.
   * Larger → faster, coarser.
   * Default 0.5 ft ≈ 6 inches on ice.
   */
  resampleSpacingFt: number;

  /**
   * Number of Laplacian (weighted-average) smoothing passes applied BEFORE
   * RDP.  Each pass is O(n) and keeps the point count the same, but moves
   * interior points toward their neighbours so that RDP picks anchor
   * positions from a smooth locus rather than from jittery raw input.
   * Default 3.  Set to 0 to skip.
   */
  preSmoothPasses: number;

  /**
   * RDP perpendicular-distance tolerance in feet.
   * Points whose deviation from the simplified line falls below this value
   * are pruned.  Higher = more aggressive jitter removal, less shape detail.
   * Default 0.4 ft ≈ 5 inches.
   */
  rdpEpsilonFt: number;

  /**
   * Number of Chaikin corner-cutting iterations applied AFTER RDP.
   * Useful when the output is consumed by a polyline renderer.  Set to 0
   * (default for BEZIER_ANCHOR_CONFIG) when the output goes to a bezier
   * builder that already applies Catmull-Rom tangent handles.
   */
  chaikinIterations: number;

  /**
   * When true (default), the first and last points of the input are clamped
   * back onto the output after the full pipeline to prevent endpoint drift.
   */
  preserveEndpoints: boolean;
};

export const DEFAULT_SMOOTHING_CONFIG: SmoothingConfig = {
  resampleSpacingFt: 0.5,
  preSmoothPasses: 3,
  rdpEpsilonFt: 0.4,
  chaikinIterations: 3,
  preserveEndpoints: true,
};

/** Stronger smoothing preset — fewer anchors, rounder curves. */
export const HIGH_SMOOTHING_CONFIG: SmoothingConfig = {
  resampleSpacingFt: 1.0,
  preSmoothPasses: 4,
  rdpEpsilonFt: 0.7,
  chaikinIterations: 4,
  preserveEndpoints: true,
};

/** Light smoothing — retains more shape detail, only removes obvious jitter. */
export const LIGHT_SMOOTHING_CONFIG: SmoothingConfig = {
  resampleSpacingFt: 0.3,
  preSmoothPasses: 1,
  rdpEpsilonFt: 0.2,
  chaikinIterations: 2,
  preserveEndpoints: true,
};

/**
 * Config for the draw-tool stroke → EditableSpline pipeline.
 *
 * Strategy: pre-smooth BEFORE RDP so that RDP anchors sit on smooth loci
 * rather than on jittery raw positions.  Chaikin is skipped post-RDP because
 * pathPointsToSpline applies Catmull-Rom tangent handles which already
 * produce a smooth bezier curve between anchors.  This keeps the editable
 * node count low (typically 6–16) while the rendered path looks smooth.
 */
export const BEZIER_ANCHOR_CONFIG: SmoothingConfig = {
  resampleSpacingFt: 0.5,
  preSmoothPasses: 6,
  rdpEpsilonFt: 0.5,
  chaikinIterations: 0,
  preserveEndpoints: true,
};

// ---------------------------------------------------------------------------
// Stage 1 – Resample
// ---------------------------------------------------------------------------



/** Euclidean distance between two points. */
function dist(a: Pt2, b: Pt2): number {
  return Math.hypot(b.xFt - a.xFt, b.yFt - a.yFt);
}

/**
 * Resample `points` so that consecutive samples are spaced ~`spacingFt` apart
 * along the polyline arc length.  The first and last input points are always
 * included in the output.
 *
 * Short strokes (total length < spacingFt) return just the two endpoints.
 */
export function resamplePoints(points: Pt2[], spacingFt: number): Pt2[] {
  if (points.length < 2) return points.slice();

  // Build cumulative arc lengths.
  const arcLen: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    arcLen.push(arcLen[i - 1] + dist(points[i - 1], points[i]));
  }
  const totalLen = arcLen[arcLen.length - 1];

  if (totalLen <= spacingFt) {
    // Stroke too short to resample meaningfully — return endpoints only.
    return [points[0], points[points.length - 1]];
  }

  const n = Math.max(2, Math.round(totalLen / spacingFt));
  const result: Pt2[] = [points[0]];

  let segIdx = 0;
  for (let k = 1; k < n; k++) {
    const targetLen = (k / n) * totalLen;
    // Advance segment pointer to the segment that contains targetLen.
    while (segIdx < points.length - 2 && arcLen[segIdx + 1] < targetLen) {
      segIdx++;
    }
    const segStart = arcLen[segIdx];
    const segEnd = arcLen[segIdx + 1];
    const segLen = segEnd - segStart;
    const t = segLen < 1e-9 ? 0 : (targetLen - segStart) / segLen;
    result.push({
      xFt: points[segIdx].xFt + t * (points[segIdx + 1].xFt - points[segIdx].xFt),
      yFt: points[segIdx].yFt + t * (points[segIdx + 1].yFt - points[segIdx].yFt),
    });
  }

  result.push(points[points.length - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// Stage 2 – Laplacian pre-smoothing (applied BEFORE RDP)
// ---------------------------------------------------------------------------

/**
 * One pass of weighted-average (Laplacian) smoothing.
 * Each interior point is moved to `(prev + 2·current + next) / 4`.
 * The point count is unchanged; endpoints are always fixed.
 * O(n) — safe to run multiple times on large strokes.
 */
function laplacianPass(points: Pt2[]): Pt2[] {
  if (points.length <= 2) return points.slice();
  const result: Pt2[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    result.push({
      xFt: (points[i - 1].xFt + 2 * points[i].xFt + points[i + 1].xFt) / 4,
      yFt: (points[i - 1].yFt + 2 * points[i].yFt + points[i + 1].yFt) / 4,
    });
  }
  result.push(points[points.length - 1]);
  return result;
}

/**
 * Apply `passes` rounds of Laplacian smoothing in-place (point count unchanged).
 * Endpoints are pinned throughout.  Use as a pre-RDP step so that RDP places
 * anchor points on smooth loci rather than on jittery raw positions.
 */
export function laplacianSmooth(points: Pt2[], passes: number): Pt2[] {
  if (passes <= 0 || points.length <= 2) return points.slice();
  let current = points;
  for (let i = 0; i < passes; i++) current = laplacianPass(current);
  return current;
}

// ---------------------------------------------------------------------------
// Stage 3 – Ramer–Douglas–Peucker simplification
// ---------------------------------------------------------------------------

/** Perpendicular distance from point `p` to the line through `a`–`b`. */
function perpDistance(p: Pt2, a: Pt2, b: Pt2): number {
  const dx = b.xFt - a.xFt;
  const dy = b.yFt - a.yFt;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return dist(p, a);
  // Signed area of the triangle / base length
  return Math.abs(dy * p.xFt - dx * p.yFt + b.xFt * a.yFt - b.yFt * a.xFt) / Math.sqrt(lenSq);
}

function rdpRecurse(
  points: Pt2[],
  start: number,
  end: number,
  epsilon: number,
  keep: boolean[],
): void {
  if (end <= start + 1) return;

  let maxDist = 0;
  let maxIdx = start;
  const a = points[start];
  const b = points[end];

  for (let i = start + 1; i < end; i++) {
    const d = perpDistance(points[i], a, b);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    keep[maxIdx] = true;
    rdpRecurse(points, start, maxIdx, epsilon, keep);
    rdpRecurse(points, maxIdx, end, epsilon, keep);
  }
}

/**
 * Ramer–Douglas–Peucker polyline simplification.
 *
 * Removes intermediate points whose perpendicular deviation from the
 * simplified line is less than `epsilonFt`.  Endpoints are always kept.
 */
export function rdpSimplify(points: Pt2[], epsilonFt: number): Pt2[] {
  if (points.length <= 2) return points.slice();

  const keep: boolean[] = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  rdpRecurse(points, 0, points.length - 1, epsilonFt, keep);

  return points.filter((_, i) => keep[i]);
}

// ---------------------------------------------------------------------------
// Stage 4 – Chaikin corner cutting (optional, for polyline renderers)
// ---------------------------------------------------------------------------

/**
 * One pass of Chaikin corner cutting: each segment [P_i, P_{i+1}] generates
 * two new points at the 1/4 and 3/4 positions.  Endpoints are fixed.
 */
function chaikinPass(points: Pt2[]): Pt2[] {
  if (points.length <= 2) return points.slice();

  const result: Pt2[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    result.push({ xFt: 0.75 * a.xFt + 0.25 * b.xFt, yFt: 0.75 * a.yFt + 0.25 * b.yFt });
    result.push({ xFt: 0.25 * a.xFt + 0.75 * b.xFt, yFt: 0.25 * a.yFt + 0.75 * b.yFt });
  }
  result.push(points[points.length - 1]);
  return result;
}

/**
 * Apply `iterations` rounds of Chaikin corner cutting.
 * Endpoints are clamped back to their original positions each iteration
 * to prevent drift.
 */
export function chaikinSmooth(points: Pt2[], iterations: number): Pt2[] {
  if (iterations <= 0 || points.length <= 2) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  let current = points;
  for (let i = 0; i < iterations; i++) {
    current = chaikinPass(current);
    // Re-pin endpoints after each pass.
    current[0] = first;
    current[current.length - 1] = last;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full smoothing pipeline on a raw freehand stroke.
 *
 * Returns the smoothed polyline points ready to be passed to
 * `pathPointsToSpline` / `buildStrokeSpline`.
 *
 * The raw `points` array is never mutated.
 */
export function smoothStroke(
  points: Pt2[],
  config: SmoothingConfig = DEFAULT_SMOOTHING_CONFIG,
): Pt2[] {
  if (points.length < 2) return points.slice();

  // 1. Resample to uniform arc-length spacing.
  const resampled = resamplePoints(points, config.resampleSpacingFt);

  // 2. Laplacian pre-smoothing: move interior points toward their neighbours
  //    so that RDP sees a smooth curve and places anchors at clean positions.
  const preSmoothed = laplacianSmooth(resampled, config.preSmoothPasses);

  // 3. RDP simplification — keep only structurally significant anchors.
  const simplified = rdpSimplify(preSmoothed, config.rdpEpsilonFt);

  // 4. Optional Chaikin post-smoothing — for polyline renderers.
  //    Set chaikinIterations = 0 when the output goes to a bezier spline
  //    builder (Catmull-Rom handles already produce smooth curves).
  const smoothed = chaikinSmooth(simplified, config.chaikinIterations);

  // 5. Re-pin endpoints to the original raw input.
  if (config.preserveEndpoints && smoothed.length >= 2) {
    smoothed[0] = points[0];
    smoothed[smoothed.length - 1] = points[points.length - 1];
  }

  return smoothed;
}
