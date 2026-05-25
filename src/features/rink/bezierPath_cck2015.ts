import type { NormalizedPoint, RinkType } from "./types";
import type { RinkDimensions } from "./rinkGeometry";
import { denormalize, getRinkDimensions, RINK } from "./rinkGeometry";

export interface BezierPoint {
  x: number;
  y: number;
  /** Incoming control handle (before this node). Absent on first node. */
  export function snapToRinkLandmark(
    point: NormalizedPoint,
    dims: RinkDimensions,
    snapThreshold = 0.028,
  ): SnapResult {
    // Work in SVG/rink coordinate space for geometry
    const sx = point.x * dims.coordWidth;
    const sy = point.y * dims.coordHeight;
    const snapDist = snapThreshold * dims.coordWidth;

    // Faceoff circles and center circle
    const circles = [
      { cx: RINK.END_FACE_OFF_X,              cy: RINK.FACE_OFF_Y_TOP, r: RINK.FACE_OFF_CIRCLE_R, label: "faceoff-tl" },
      { cx: RINK.END_FACE_OFF_X,              cy: RINK.FACE_OFF_Y_BOT, r: RINK.FACE_OFF_CIRCLE_R, label: "faceoff-bl" },
      { cx: RINK.NHL_W - RINK.END_FACE_OFF_X, cy: RINK.FACE_OFF_Y_TOP, r: RINK.FACE_OFF_CIRCLE_R, label: "faceoff-tr" },
      { cx: RINK.NHL_W - RINK.END_FACE_OFF_X, cy: RINK.FACE_OFF_Y_BOT, r: RINK.FACE_OFF_CIRCLE_R, label: "faceoff-br" },
      { cx: RINK.CENTER_X,                    cy: RINK.NHL_H / 2,       r: RINK.CENTER_CIRCLE_R,   label: "center-circle" },
    ];

    for (const circle of circles) {
      const distToCenter = Math.hypot(sx - circle.cx, sy - circle.cy);

      // Snap to faceoff dot (circle center)
      if (distToCenter < snapDist * 0.45) {
        return {
          point: { x: circle.cx / dims.coordWidth, y: circle.cy / dims.coordHeight },
          snapped: true,
          confidence: "high",
          landmark: `${circle.label}-dot`,
        };
      }

      // Snap to circle arc
      const distToArc = Math.abs(distToCenter - circle.r);
      if (distToArc < snapDist) {
        const angle = Math.atan2(sy - circle.cy, sx - circle.cx);
        return {
          point: {
            x: (circle.cx + circle.r * Math.cos(angle)) / dims.coordWidth,
            y: (circle.cy + circle.r * Math.sin(angle)) / dims.coordHeight,
          },
          snapped: true,
          confidence: distToArc < snapDist * 0.4 ? "high" : "medium",
          landmark: `${circle.label}-arc`,
        };
      }
    }

    // Neutral zone faceoff dots (no circle, just dot)
    const neutralDots = [
      { cx: RINK.NEU_FACE_OFF_X_L, cy: RINK.FACE_OFF_Y_TOP, label: "neutral-dot-tl" },
      { cx: RINK.NEU_FACE_OFF_X_L, cy: RINK.FACE_OFF_Y_BOT, label: "neutral-dot-bl" },
      { cx: RINK.NEU_FACE_OFF_X_R, cy: RINK.FACE_OFF_Y_TOP, label: "neutral-dot-tr" },
      { cx: RINK.NEU_FACE_OFF_X_R, cy: RINK.FACE_OFF_Y_BOT, label: "neutral-dot-br" },
    ];

    for (const dot of neutralDots) {
      if (Math.hypot(sx - dot.cx, sy - dot.cy) < snapDist * 0.45) {
        return {
          point: { x: dot.cx / dims.coordWidth, y: dot.cy / dims.coordHeight },
          snapped: true,
          confidence: "high",
          landmark: dot.label,
        };
      }
    }

    // Vertical rink lines (blue lines, goal lines, center line)
    const vLines = [
      { x: RINK.BLUE_LINE_X,              label: "left-blue-line" },
      { x: RINK.NHL_W - RINK.BLUE_LINE_X, label: "right-blue-line" },
      { x: RINK.CENTER_X,                 label: "center-line" },
      { x: RINK.GOAL_LINE_X,              label: "left-goal-line" },
      { x: RINK.NHL_W - RINK.GOAL_LINE_X, label: "right-goal-line" },
    ];

    for (const line of vLines) {
      const dist = Math.abs(sx - line.x);
      if (dist < snapDist) {
        return {
          point: { x: line.x / dims.coordWidth, y: point.y },
          snapped: true,
          confidence: dist < snapDist * 0.4 ? "high" : "medium",
          landmark: line.label,
        };
      }
    }

    return { point, snapped: false, confidence: "low" };
  }
  if (points.length <= 2) return [...points];

  const start = points[0];
  const end = points[points.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len2 = dx * dx + dy * dy;

  let maxDist = 0;
  let maxIndex = 0;

  for (let i = 1; i < points.length - 1; i++) {
    let dist: number;
    if (len2 === 0) {
      dist = Math.hypot(points[i].x - start.x, points[i].y - start.y);
    } else {
      const t = Math.max(
        0,
        Math.min(
          1,
          ((points[i].x - start.x) * dx + (points[i].y - start.y) * dy) / len2,
        ),
      );
      dist = Math.hypot(
        points[i].x - (start.x + t * dx),
        points[i].y - (start.y + t * dy),
      );
    }
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

// Fit Catmull-Rom tangents as cubic Bezier handles.
// tension=0.4 gives smooth but responsive curves.
export function fitBezierHandles(
  points: NormalizedPoint[],
  tension = 0.4,
): BezierPoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ x: points[0].x, y: points[0].y }];

  const fitted = points.map((curr, i) => {
    const prev = points[i - 1] ?? curr;
    const next = points[i + 1] ?? curr;
    const tx = (next.x - prev.x) * tension;
    const ty = (next.y - prev.y) * tension;

    const bp: BezierPoint = { x: curr.x, y: curr.y, nodeType: "smooth" };

    if (i > 0) {
      bp.cp1 = { x: curr.x - tx / 3, y: curr.y - ty / 3 };
    }
    if (i < points.length - 1) {
      bp.cp2 = { x: curr.x + tx / 3, y: curr.y + ty / 3 };
    }

    return bp;
  });

  return constrainOpenPathEndpointHandles(fitted);
}

function projectPointOntoSegment(
  point: NormalizedPoint,
  segmentStart: NormalizedPoint,
  segmentEnd: NormalizedPoint,
): NormalizedPoint {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-12) {
    return { x: segmentStart.x, y: segmentStart.y };
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) / len2),
  );

  return {
    x: segmentStart.x + dx * t,
    y: segmentStart.y + dy * t,
  };
}

function constrainEndpointHandle(
  bezierPoints: BezierPoint[],
  index: number,
  handleType: "cp1" | "cp2",
): BezierPoint[] {
  const node = bezierPoints[index];
  if (!node) return bezierPoints;

  if (handleType === "cp2") {
    const nextNode = bezierPoints[index + 1];
    if (!node.cp2 || !nextNode) return bezierPoints;

    return bezierPoints.map((point, pointIndex) =>
      pointIndex === index
        ? {
            ...point,
            cp2: projectPointOntoSegment(point.cp2!, point, nextNode),
          }
        : point,
    );
  }

  const previousNode = bezierPoints[index - 1];
  if (!node.cp1 || !previousNode) return bezierPoints;

  return bezierPoints.map((point, pointIndex) =>
    pointIndex === index
      ? {
          ...point,
          cp1: projectPointOntoSegment(point.cp1!, point, previousNode),
        }
      : point,
  );
}

export function constrainOpenPathEndpointHandles(bezierPoints: BezierPoint[]): BezierPoint[] {
  if (bezierPoints.length < 2) return bezierPoints;

  let constrained = bezierPoints;
  constrained = constrainEndpointHandle(constrained, 0, "cp2");
  constrained = constrainEndpointHandle(constrained, constrained.length - 1, "cp1");
  return constrained;
}

/**
 * Resample a polyline so anchor nodes are evenly spaced by arc length.
 * Always includes the exact start and end point.
 * targetSpacing is in normalized units (0.12 ≈ 24 ft on a full NHL rink).
 */
export function resampleAtEvenSpacing(
  points: NormalizedPoint[],
  targetSpacing: number,
): NormalizedPoint[] {
  if (points.length < 2) return [...points];

  // Compute cumulative arc lengths
  const cumLen: number[] = [0];
  for (let i = 0; i < points.length - 1; i++) {
    cumLen.push(cumLen[i] + Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y));
  }
  const totalLen = cumLen[cumLen.length - 1];
  if (totalLen < targetSpacing) return [points[0], points[points.length - 1]];

  const numIntervals = Math.max(1, Math.round(totalLen / targetSpacing));
  const spacing = totalLen / numIntervals;

  const result: NormalizedPoint[] = [points[0]];

  for (let n = 1; n < numIntervals; n++) {
    const target = n * spacing;
    // Binary-search for the segment containing this distance
    let lo = 0;
    let hi = points.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cumLen[mid] <= target) lo = mid; else hi = mid - 1;
    }
    const segLen = cumLen[lo + 1] - cumLen[lo];
    const t = segLen < 1e-9 ? 0 : (target - cumLen[lo]) / segLen;
    result.push({
      x: points[lo].x + (points[lo + 1].x - points[lo].x) * t,
      y: points[lo].y + (points[lo + 1].y - points[lo].y) * t,
    });
  }

  result.push(points[points.length - 1]);
  return result;
}

/**
 * Full pipeline: raw stroke points → noise removal → even node spacing → Bezier handles.
 *
 * epsilon     — Douglas-Peucker tolerance (normalized). Removes sub-threshold wiggles.
 * nodeSpacing — target arc-length gap between anchor nodes (normalized).
 *               0.12 ≈ 24 ft, 0.15 ≈ 30 ft on a full NHL rink.
 */
export function smoothFreehandPath(
  rawPoints: NormalizedPoint[],
  epsilon = 0.015,
  nodeSpacing = 0.18,
): BezierPoint[] {
  if (rawPoints.length < 2) return rawPoints.map((p) => ({ x: p.x, y: p.y }));

  // 1. Remove noise below epsilon tolerance
  const simplified = douglasPeucker(rawPoints, epsilon);
  const denoised = simplified.length < 2 ? rawPoints.slice(0, 2) : simplified;

  // 2. Redistribute anchor points at even arc-length intervals
  const evenly = resampleAtEvenSpacing(denoised, nodeSpacing);

  // 3. Fit smooth Bezier handles via Catmull-Rom tangents
  return fitBezierHandles(evenly);
}

/**
 * Resample a polyline to exactly `count` evenly-spaced points by arc length.
 * Always preserves exact start and end points.
 */
export function resamplePolylineToCount(
  points: NormalizedPoint[],
  count: number,
): NormalizedPoint[] {
  if (count <= 1) return [points[0]];
  if (count === 2) return [points[0], points[points.length - 1]];

  const cumLen: number[] = [0];
  for (let i = 0; i < points.length - 1; i++) {
    cumLen.push(cumLen[i] + Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y));
  }
  const totalLen = cumLen[cumLen.length - 1];

  const result: NormalizedPoint[] = [points[0]];
  for (let n = 1; n < count - 1; n++) {
    const target = (n / (count - 1)) * totalLen;
    let lo = 0;
    let hi = points.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cumLen[mid] <= target) lo = mid; else hi = mid - 1;
    }
    const segLen = cumLen[lo + 1] - cumLen[lo];
    const t = segLen < 1e-9 ? 0 : (target - cumLen[lo]) / segLen;
    result.push({
      x: points[lo].x + (points[lo + 1].x - points[lo].x) * t,
      y: points[lo].y + (points[lo + 1].y - points[lo].y) * t,
    });
  }
  result.push(points[points.length - 1]);
  return result;
}

/**
 * Resample a bezier path to exactly `targetCount` nodes evenly distributed
 * by arc length, then refit smooth Bezier handles.
 * Hard (corner) nodes from the original path are transferred to the nearest
 * new node by arc-length fraction so user-set corners are not lost.
 */
export function resampleBezierToNodeCount(
  bezierPoints: BezierPoint[],
  targetCount: number,
): BezierPoint[] {
  if (targetCount < 2 || bezierPoints.length < 2) return bezierPoints;

  const samplesPerSegment = 30;
  const polyline = bezierToPolyline(bezierPoints, samplesPerSegment);

  // Cumulative arc lengths of the polyline
  const cumLen: number[] = [0];
  for (let i = 0; i < polyline.length - 1; i++) {
    cumLen.push(cumLen[i] + Math.hypot(polyline[i + 1].x - polyline[i].x, polyline[i + 1].y - polyline[i].y));
  }
  const totalLen = cumLen[cumLen.length - 1];

  const resampled = resamplePolylineToCount(polyline, targetCount);
  const result = fitBezierHandles(resampled);

  // Transfer hard nodeType/breakType from each original hard node to the
  // nearest new node (by arc-length fraction). New nodes between hard nodes
  // stay smooth.
  for (let k = 0; k < bezierPoints.length; k++) {
    const orig = bezierPoints[k];
    if (orig.nodeType !== "hard") continue;

    const polyIdx = Math.min(k * samplesPerSegment, polyline.length - 1);
    const origFrac = totalLen > 0 ? cumLen[polyIdx] / totalLen : k / (bezierPoints.length - 1);

    let closest = 0;
    let minDist = Infinity;
    for (let n = 0; n < targetCount; n++) {
      const d = Math.abs(n / (targetCount - 1) - origFrac);
      if (d < minDist) { minDist = d; closest = n; }
    }

    result[closest] = {
      ...result[closest],
      nodeType: "hard",
      ...(orig.breakType ? { breakType: orig.breakType } : {}),
    };
  }

  return result;
}

export function resampleBezierToCenteredFootSpacing(
  bezierPoints: BezierPoint[],
  rinkType: RinkType,