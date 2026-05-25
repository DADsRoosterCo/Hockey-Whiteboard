import type {
  SerializedActorRouteBezierNode,
  SerializedActorRouteNode,
} from "./runtime/serialization";

// New, clean Bezier editor core.
// Key goals:
// - Explicit separation of anchor nodes and handles
// - Deterministic handle ownership and mirroring for "smooth" nodes
// - Moving anchors never collapses handles into anchors and vice versa
// - Straightforward path string generation for rendering

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Produce bezier nodes from anchor points. This is a pure generator:
// anchor points -> bezier nodes (anchors + optional cp1/cp2). It does
// not attempt to keep any historical handle adjustments — callers store
// and re-use the resulting bezier node array when they want to persist
// manual handle changes.
export function fitRouteBezierNodes(
  points: SerializedActorRouteNode[],
  curveIntensity = 0.65,
): SerializedActorRouteBezierNode[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ xFt: points[0].xFt, yFt: points[0].yFt, nodeType: points[0].nodeType }];

  // tension controls how far handles extend from an anchor
  const tension = clamp(curveIntensity, 0, 1) * 0.45;

  return points.map((current, i) => {
    const prev = points[i - 1] ?? current;
    const next = points[i + 1] ?? current;
    const tangentX = (next.xFt - prev.xFt) * tension;
    const tangentY = (next.yFt - prev.yFt) * tension;

    const node: SerializedActorRouteBezierNode = {
      xFt: current.xFt,
      yFt: current.yFt,
      nodeType: current.nodeType ?? "smooth",
    };

    // cp1 exists when there is a previous anchor
    if (i > 0) {
      node.cp1Ft = { xFt: current.xFt - tangentX / 3, yFt: current.yFt - tangentY / 3 };
    }

    // cp2 exists when there is a next anchor
    if (i < points.length - 1) {
      node.cp2Ft = { xFt: current.xFt + tangentX / 3, yFt: current.yFt + tangentY / 3 };
    }

    return node;
  });
}

// Build an SVG path string from either raw anchor nodes or precomputed
// bezier nodes. When curved is false we render straight lines.
export function buildActorRoutePathData(
  anchors: Array<{ xFt: number; yFt: number }>,
  bezierNodes: SerializedActorRouteBezierNode[] | undefined,
  curved: boolean,
): string {
  if (anchors.length === 0) return "";
  if (!curved || !bezierNodes || bezierNodes.length < 2) {
    return anchors.map((p, i) => `${i === 0 ? "M" : "L"} ${p.xFt} ${p.yFt}`).join(" ");
  }

  let d = `M ${bezierNodes[0].xFt} ${bezierNodes[0].yFt}`;
  for (let i = 1; i < bezierNodes.length; i += 1) {
    const prev = bezierNodes[i - 1];
    const cur = bezierNodes[i];
    const cp1 = prev.cp2Ft ?? { xFt: prev.xFt, yFt: prev.yFt };
    const cp2 = cur.cp1Ft ?? { xFt: cur.xFt, yFt: cur.yFt };
    d += ` C ${cp1.xFt} ${cp1.yFt} ${cp2.xFt} ${cp2.yFt} ${cur.xFt} ${cur.yFt}`;
  }
  return d;
}

// Move an anchor node. Anchor movement translates any attached handles
// by the same delta so that manual handle offsets are preserved.
export function moveRouteBezierNode(
  bezierNodes: SerializedActorRouteBezierNode[],
  nodeIndex: number,
  point: { xFt: number; yFt: number },
): SerializedActorRouteBezierNode[] {
  return bezierNodes.map((node, i) => {
    if (i !== nodeIndex) return { ...node, cp1Ft: node.cp1Ft ? { ...node.cp1Ft } : undefined, cp2Ft: node.cp2Ft ? { ...node.cp2Ft } : undefined };
    const dx = point.xFt - node.xFt;
    const dy = point.yFt - node.yFt;
    return {
      ...node,
      xFt: point.xFt,
      yFt: point.yFt,
      cp1Ft: node.cp1Ft ? { xFt: node.cp1Ft.xFt + dx, yFt: node.cp1Ft.yFt + dy } : undefined,
      cp2Ft: node.cp2Ft ? { xFt: node.cp2Ft.xFt + dx, yFt: node.cp2Ft.yFt + dy } : undefined,
    };
  });
}

// Move a handle. This operation only adjusts the specified handle and,
// for "smooth" nodes, enforces a mirrored opposite handle so the curve
// direction remains continuous. For "hard" nodes the opposite handle is
// left untouched.
export function moveRouteBezierHandle(
  bezierNodes: SerializedActorRouteBezierNode[],
  nodeIndex: number,
  handleType: "cp1Ft" | "cp2Ft",
  point: { xFt: number; yFt: number },
): SerializedActorRouteBezierNode[] {
  return bezierNodes.map((node, i) => {
    if (i !== nodeIndex) return { ...node, cp1Ft: node.cp1Ft ? { ...node.cp1Ft } : undefined, cp2Ft: node.cp2Ft ? { ...node.cp2Ft } : undefined };

    const nextNode: SerializedActorRouteBezierNode = {
      ...node,
      nodeType: node.nodeType ?? "smooth",
      cp1Ft: handleType === "cp1Ft" ? { xFt: point.xFt, yFt: point.yFt } : (node.cp1Ft ? { ...node.cp1Ft } : undefined),
      cp2Ft: handleType === "cp2Ft" ? { xFt: point.xFt, yFt: point.yFt } : (node.cp2Ft ? { ...node.cp2Ft } : undefined),
    };


    // For continuous (smooth) nodes, mirror the opposite handle to keep
    // the tangent symmetric around the anchor.
    if (nextNode.nodeType !== "hard") {
      if (handleType === "cp1Ft") {
        nextNode.cp2Ft = { xFt: nextNode.xFt + (nextNode.xFt - point.xFt), yFt: nextNode.yFt + (nextNode.yFt - point.yFt) };
      } else {
        nextNode.cp1Ft = { xFt: nextNode.xFt + (nextNode.xFt - point.xFt), yFt: nextNode.yFt + (nextNode.yFt - point.yFt) };
      }
    }

    return nextNode;
  });
}

// ---------------------------------------------------------------------------
// Arc-length sampling along a bezier route
// ---------------------------------------------------------------------------

const BEZIER_SAMPLES_PER_SEGMENT = 64;

interface BezierSample {
  distFt: number;
  xFt: number;
  yFt: number;
}

export interface BezierSampleTable {
  samples: BezierSample[];
  totalFt: number;
}

/**
 * Build an arc-length lookup table by chord-sampling each cubic bezier
 * segment. Matches the control-point convention used by buildActorRoutePathData:
 *   cp1 = prev.cp2Ft (outgoing handle from prev anchor)
 *   cp2 = curr.cp1Ft (incoming handle to curr anchor)
 */
export function buildBezierSampleTable(
  nodes: SerializedActorRouteBezierNode[],
): BezierSampleTable {
  if (nodes.length < 2) {
    const samples: BezierSample[] = nodes.length === 1
      ? [{ distFt: 0, xFt: nodes[0].xFt, yFt: nodes[0].yFt }]
      : [];
    return { samples, totalFt: 0 };
  }

  const samples: BezierSample[] = [{ distFt: 0, xFt: nodes[0].xFt, yFt: nodes[0].yFt }];
  let totalFt = 0;

  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const curr = nodes[i];
    const cp1 = prev.cp2Ft ?? { xFt: prev.xFt, yFt: prev.yFt };
    const cp2 = curr.cp1Ft ?? { xFt: curr.xFt, yFt: curr.yFt };

    let px = prev.xFt;
    let py = prev.yFt;

    for (let s = 1; s <= BEZIER_SAMPLES_PER_SEGMENT; s++) {
      const t = s / BEZIER_SAMPLES_PER_SEGMENT;
      const mt = 1 - t;
      const x = mt*mt*mt*prev.xFt + 3*mt*mt*t*cp1.xFt + 3*mt*t*t*cp2.xFt + t*t*t*curr.xFt;
      const y = mt*mt*mt*prev.yFt + 3*mt*mt*t*cp1.yFt + 3*mt*t*t*cp2.yFt + t*t*t*curr.yFt;
      totalFt += Math.hypot(x - px, y - py);
      samples.push({ distFt: totalFt, xFt: x, yFt: y });
      px = x;
      py = y;
    }
  }

  return { samples, totalFt };
}

/**
 * Return the rink position at a given arc-length distance along a pre-built
 * bezier sample table. Clamps to [0, totalFt].
 */
export function sampleBezierAtDistance(
  table: BezierSampleTable,
  distFt: number,
): { xFt: number; yFt: number } {
  const { samples, totalFt } = table;
  if (samples.length === 0) return { xFt: 0, yFt: 0 };
  const clamped = Math.max(0, Math.min(totalFt, distFt));

  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].distFt < clamped) lo = mid + 1;
    else hi = mid;
  }

  if (lo === 0) return { xFt: samples[0].xFt, yFt: samples[0].yFt };
  if (lo >= samples.length) return { xFt: samples[samples.length - 1].xFt, yFt: samples[samples.length - 1].yFt };

  const a = samples[lo - 1];
  const b = samples[lo];
  const span = b.distFt - a.distFt;
  if (span <= 0) return { xFt: b.xFt, yFt: b.yFt };

  const alpha = (clamped - a.distFt) / span;
  return {
    xFt: a.xFt + alpha * (b.xFt - a.xFt),
    yFt: a.yFt + alpha * (b.yFt - a.yFt),
  };
}