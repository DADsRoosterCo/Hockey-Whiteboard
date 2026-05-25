/**
 * splineBridge – converts between the legacy SerializedPath format and the
 * new EditableSpline.
 *
 * Direction A: SerializedPath → EditableSpline  (when starting an edit session)
 * Direction B: EditableSpline → SerializedPath  (when committing an edit session)
 */

import type { TimedPathPoint } from "../runtime/eventDerivation";
import type { SerializedActorRouteBezierNode } from "../runtime/routeProjection";
import type { EditableSpline, AnchorNodeType, SplineHandles } from "./editableSpline";
import { createSpline } from "./editableSpline";

// ---------------------------------------------------------------------------
// A: SerializedPath → EditableSpline
// ---------------------------------------------------------------------------

/** Determine the AnchorNodeType from a path point's metadata. */
function anchorTypeFromMetadata(pt: TimedPathPoint): AnchorNodeType {
  const bt = pt.metadata?.["breakType"] as string | undefined;
  if (bt === "stop")  return "sharpStop";
  if (bt === "pivot") return "sharpPivot";
  return "smooth";
}

/**
 * Build an EditableSpline from an array of TimedPathPoints.
 *
 * Old bezierNodes (if provided) are migrated into the new `handles` format.
 * If no bezierNodes are provided, handles are auto-computed from Catmull-Rom tangents.
 */
export function pathPointsToSpline(
  splineId: string,
  points: TimedPathPoint[],
  legacyBezierNodes?: SerializedActorRouteBezierNode[],
  tension = 0.4,
): EditableSpline {
  if (points.length === 0) return createSpline(splineId);

  const TENSION = tension;

  const anchors: EditableSpline["anchors"] = points.map((pt, i) => ({
    id: `${splineId}-a${i}`,
    xFt: pt.xFt,
    yFt: pt.yFt,
    nodeType: anchorTypeFromMetadata(pt),
  }));

  const handles: SplineHandles = {};

  if (legacyBezierNodes && legacyBezierNodes.length === points.length) {
    // Migrate legacy cp1Ft / cp2Ft to the new in/out scheme.
    // Legacy: cp1Ft = incoming control point, cp2Ft = outgoing control point.
    for (let i = 0; i < anchors.length; i++) {
      const legNode = legacyBezierNodes[i];
      const anchor  = anchors[i];
      handles[anchor.id] = {
        in:  legNode.cp1Ft ? { xFt: legNode.cp1Ft.xFt, yFt: legNode.cp1Ft.yFt } : undefined,
        out: legNode.cp2Ft ? { xFt: legNode.cp2Ft.xFt, yFt: legNode.cp2Ft.yFt } : undefined,
      };
    }
  } else {
    // Auto-compute Catmull-Rom tangents for smooth nodes.
    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i];
      if (anchor.nodeType !== "smooth") {
        handles[anchor.id] = { in: undefined, out: undefined };
        continue;
      }
      const prev = anchors[i - 1] ?? anchor;
      const next = anchors[i + 1] ?? anchor;
      const tx = (next.xFt - prev.xFt) * TENSION;
      const ty = (next.yFt - prev.yFt) * TENSION;
      handles[anchor.id] = {
        in:  i > 0                    ? { xFt: anchor.xFt - tx, yFt: anchor.yFt - ty } : undefined,
        out: i < anchors.length - 1   ? { xFt: anchor.xFt + tx, yFt: anchor.yFt + ty } : undefined,
      };
    }
  }

  return { id: splineId, anchors, handles };
}

// ---------------------------------------------------------------------------
// B: EditableSpline → updated TimedPathPoints (anchor positions only)
// ---------------------------------------------------------------------------

/**
 * Merge updated anchor positions from the edited spline back onto the original
 * TimedPathPoints array.  Time, action, and metadata are preserved from the
 * original points (indexed by position in the array).
 *
 * If the anchor count changed (user added/removed nodes), the time values are
 * re-interpolated linearly to maintain relative ordering.
 */
export function splineToPathPoints(
  spline: EditableSpline,
  originalPoints: TimedPathPoint[],
): TimedPathPoint[] {
  if (spline.anchors.length === 0) return [];

  const anchors = spline.anchors;

  if (anchors.length === originalPoints.length) {
    // Same count: map 1-to-1 preserving metadata.
    return anchors.map((anchor, i) => ({
      ...originalPoints[i],
      xFt: anchor.xFt,
      yFt: anchor.yFt,
      metadata: anchorMetadataFromType(anchor.nodeType, originalPoints[i]?.metadata),
    }));
  }

  // Count changed: re-distribute time values evenly.
  const startTime = originalPoints[0]?.timeSec ?? 0;
  const endTime   = originalPoints[originalPoints.length - 1]?.timeSec ?? (originalPoints.length - 1);
  const totalTime = endTime - startTime;

  return anchors.map((anchor, i) => {
    const fracTime = anchors.length > 1 ? (i / (anchors.length - 1)) * totalTime + startTime : startTime;
    const srcPt = originalPoints[Math.min(i, originalPoints.length - 1)];
    return {
      xFt: anchor.xFt,
      yFt: anchor.yFt,
      timeSec: fracTime,
      action: srcPt?.action ?? "carry",
      metadata: anchorMetadataFromType(anchor.nodeType, srcPt?.metadata),
    } as TimedPathPoint;
  });
}

/**
 * Merge the node type back into a point's metadata so the legacy event system
 * still sees stop/pivot markers.
 */
function anchorMetadataFromType(
  nodeType: AnchorNodeType,
  existingMeta: unknown,
): Record<string, unknown> | undefined {
  const base: Record<string, unknown> = typeof existingMeta === "object" && existingMeta !== null
    ? { ...(existingMeta as Record<string, unknown>) }
    : {};

  if (nodeType === "sharpStop") {
    base.breakType = "stop";
  } else if (nodeType === "sharpPivot") {
    base.breakType = "pivot";
  } else {
    delete base.breakType;
  }

  return Object.keys(base).length > 0 ? base : undefined;
}

// ---------------------------------------------------------------------------
// C: EditableSpline → legacy SerializedActorRouteBezierNode[]
// ---------------------------------------------------------------------------

/**
 * Convert the new handles format back to the legacy bezierNodes format so that
 * existing rendering code (e.g. buildActorRoutePathData) continues to work
 * while we transition away from it.
 */
export function splineToLegacyBezierNodes(
  spline: EditableSpline,
): SerializedActorRouteBezierNode[] {
  return spline.anchors.map((anchor) => {
    const h = spline.handles[anchor.id];
    return {
      xFt: anchor.xFt,
      yFt: anchor.yFt,
      nodeType: anchor.nodeType === "smooth" ? "smooth" : "hard",
      cp1Ft: h?.in  ? { xFt: h.in.xFt,  yFt: h.in.yFt  } : undefined,
      cp2Ft: h?.out ? { xFt: h.out.xFt, yFt: h.out.yFt } : undefined,
    };
  });
}

// Re-export AnchorNodeType for convenience.
export type { AnchorNodeType };
