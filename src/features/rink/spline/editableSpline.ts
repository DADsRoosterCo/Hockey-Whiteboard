/**
 * EditableSpline – pure data model for a Bezier path editor.
 *
 * Design principles (from ticket):
 *  • Anchors and handles are fully independent objects with separate hit geometry.
 *  • Dragging a handle NEVER moves its anchor.
 *  • Smooth nodes mirror their in/out handles; sharp nodes (sharpStop / sharpPivot) do not.
 *  • This module is framework-free – no React, no side effects.
 */

// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------

export type Ft = number; // feet on the rink

export type Pt = { xFt: Ft; yFt: Ft };

// ---------------------------------------------------------------------------
// Anchor node types
// ---------------------------------------------------------------------------

/**
 * smooth     – continuous tangent; both handles are always mirrored through the anchor.
 * sharpStop  – direction discontinuity; player stops here; handles are independent.
 * sharpPivot – direction discontinuity; player pivots; handles are independent.
 */
export type AnchorNodeType = "smooth" | "sharpStop" | "sharpPivot";

/**
 * Arrow-head marker drawn at this anchor along the outgoing tangent direction.
 * none   – no marker
 * arrow  – solid filled triangle
 * open   – open chevron / V
 * tee    – perpendicular bar (full stop marker)
 * circle – filled circle (dot)
 */
export type ArrowHeadType = "none" | "arrow" | "open" | "tee" | "circle";

export interface AnchorNode {
  /** Unique stable ID for this anchor. */
  id: string;
  xFt: Ft;
  yFt: Ft;
  nodeType: AnchorNodeType;
  /** Optional arrowhead drawn at this anchor along the path direction. */
  arrowHead?: ArrowHeadType;
}

// ---------------------------------------------------------------------------
// Bezier handles
// ---------------------------------------------------------------------------

/**
 * For each anchor we store an optional incoming handle ("in", cp1) and an optional
 * outgoing handle ("out", cp2).  They are keyed by anchor id to avoid index
 * coupling that caused the legacy collision bugs.
 *
 * Invariant: the first anchor never has an "in" handle; the last never has an
 * "out" handle.  Interior smooth anchors always have both.
 */
export type HandleSide = "in" | "out";

export interface SplineHandles {
  [anchorId: string]: {
    in?: Pt;
    out?: Pt;
  };
}

// ---------------------------------------------------------------------------
// The spline itself
// ---------------------------------------------------------------------------

export interface EditableSpline {
  id: string;
  anchors: AnchorNode[];
  handles: SplineHandles;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

let _idCounter = 1;
function newId(prefix: string): string {
  return `${prefix}-${_idCounter++}`;
}

/** Create an empty spline with no anchors. */
export function createSpline(id?: string): EditableSpline {
  return { id: id ?? newId("spline"), anchors: [], handles: {} };
}

/** Append a new anchor to the end of the spline and auto-compute smooth handles. */
export function appendAnchor(
  spline: EditableSpline,
  pos: Pt,
  nodeType: AnchorNodeType = "smooth",
): EditableSpline {
  const anchor: AnchorNode = { id: newId("anchor"), xFt: pos.xFt, yFt: pos.yFt, nodeType };
  const anchors = [...spline.anchors, anchor];
  const handles = { ...spline.handles };

  // Compute Catmull-Rom tangents for the new anchor and its predecessor.
  const idx = anchors.length - 1;
  _recomputeHandlesAround(anchors, handles, idx);
  if (idx > 0) _recomputeHandlesAround(anchors, handles, idx - 1);

  return { ...spline, anchors, handles };
}

/** Move an anchor by id, shifting its handles by the same delta. */
export function moveAnchor(
  spline: EditableSpline,
  anchorId: string,
  newPos: Pt,
): EditableSpline {
  const anchors = spline.anchors.map((a) => (a.id === anchorId ? { ...a, ...newPos } : a));
  const old = spline.anchors.find((a) => a.id === anchorId);
  if (!old) return { ...spline, anchors };

  const dx = newPos.xFt - old.xFt;
  const dy = newPos.yFt - old.yFt;
  const existing = spline.handles[anchorId];
  const handles = {
    ...spline.handles,
    [anchorId]: {
      in:  existing?.in  ? { xFt: existing.in.xFt  + dx, yFt: existing.in.yFt  + dy } : undefined,
      out: existing?.out ? { xFt: existing.out.xFt + dx, yFt: existing.out.yFt + dy } : undefined,
    },
  };
  return { ...spline, anchors, handles };
}

/** Move a single handle. For smooth nodes, mirrors the opposite handle. */
export function moveHandle(
  spline: EditableSpline,
  anchorId: string,
  side: HandleSide,
  newPos: Pt,
): EditableSpline {
  const anchor = spline.anchors.find((a) => a.id === anchorId);
  if (!anchor) return spline;

  const existing = spline.handles[anchorId] ?? {};
  const isSmooth = anchor.nodeType === "smooth";

  const dx = newPos.xFt - anchor.xFt;
  const dy = newPos.yFt - anchor.yFt;
  const mirrorPos: Pt = { xFt: anchor.xFt - dx, yFt: anchor.yFt - dy };

  const updated: SplineHandles[string] = {
    in:  side === "in"  ? newPos : (isSmooth && side === "out" ? mirrorPos : (existing.in ?? undefined)),
    out: side === "out" ? newPos : (isSmooth && side === "in"  ? mirrorPos : (existing.out ?? undefined)),
  };

  return {
    ...spline,
    handles: { ...spline.handles, [anchorId]: updated },
  };
}

/** Change the node type of an anchor. */
export function setAnchorType(
  spline: EditableSpline,
  anchorId: string,
  nodeType: AnchorNodeType,
): EditableSpline {
  const anchors = spline.anchors.map((a) => (a.id === anchorId ? { ...a, nodeType } : a));
  return { ...spline, anchors };
}

/** Set the arrowhead type for an anchor. */
export function setAnchorArrowHead(
  spline: EditableSpline,
  anchorId: string,
  arrowHead: ArrowHeadType,
): EditableSpline {
  const anchors = spline.anchors.map((a) => (a.id === anchorId ? { ...a, arrowHead } : a));
  return { ...spline, anchors };
}

/** Remove an anchor by id and recompute adjacent handles. */
export function removeAnchor(
  spline: EditableSpline,
  anchorId: string,
): EditableSpline {
  const idx = spline.anchors.findIndex((a) => a.id === anchorId);
  if (idx === -1) return spline;

  const anchors = spline.anchors.filter((a) => a.id !== anchorId);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [anchorId]: _removed, ...handles } = spline.handles;

  if (idx > 0) _recomputeHandlesAround(anchors, handles, idx - 1);
  if (idx < anchors.length) _recomputeHandlesAround(anchors, handles, idx);

  return { ...spline, anchors, handles };
}

/** Insert an anchor at a specific index (e.g. midpoint insertion). */
export function insertAnchorAt(
  spline: EditableSpline,
  index: number,
  pos: Pt,
  nodeType: AnchorNodeType = "smooth",
): EditableSpline {
  const anchor: AnchorNode = { id: newId("anchor"), xFt: pos.xFt, yFt: pos.yFt, nodeType };
  const anchors = [
    ...spline.anchors.slice(0, index),
    anchor,
    ...spline.anchors.slice(index),
  ];
  const handles = { ...spline.handles };

  _recomputeHandlesAround(anchors, handles, index);
  if (index > 0) _recomputeHandlesAround(anchors, handles, index - 1);
  if (index < anchors.length - 1) _recomputeHandlesAround(anchors, handles, index + 1);

  return { ...spline, anchors, handles };
}

// ---------------------------------------------------------------------------
// SVG path data generation
// ---------------------------------------------------------------------------

/** Build an SVG cubic-bezier `d` attribute string from the spline. */
export function buildSvgPath(spline: EditableSpline): string {
  const { anchors, handles } = spline;
  if (anchors.length === 0) return "";
  if (anchors.length === 1) return `M ${anchors[0].xFt} ${anchors[0].yFt}`;

  let d = `M ${anchors[0].xFt} ${anchors[0].yFt}`;
  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const curr = anchors[i];
    const cp1 = handles[prev.id]?.out ?? { xFt: prev.xFt, yFt: prev.yFt };
    const cp2 = handles[curr.id]?.in  ?? { xFt: curr.xFt, yFt: curr.yFt };
    d += ` C ${cp1.xFt} ${cp1.yFt} ${cp2.xFt} ${cp2.yFt} ${curr.xFt} ${curr.yFt}`;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Serialization / migration helpers
// ---------------------------------------------------------------------------

export interface SplineJson {
  id: string;
  anchors: Array<{ id: string; xFt: number; yFt: number; nodeType: AnchorNodeType; arrowHead?: ArrowHeadType }>;
  handles: SplineHandles;
}

export function serializeSpline(spline: EditableSpline): SplineJson {
  return {
    id: spline.id,
    anchors: spline.anchors.map((a) => ({
      id: a.id, xFt: a.xFt, yFt: a.yFt, nodeType: a.nodeType,
      ...(a.arrowHead && a.arrowHead !== "none" ? { arrowHead: a.arrowHead } : {}),
    })),
    handles: JSON.parse(JSON.stringify(spline.handles)) as SplineHandles,
  };
}

export function deserializeSpline(json: SplineJson): EditableSpline {
  return {
    id: json.id,
    anchors: json.anchors.map((a) => ({
      id: a.id, xFt: a.xFt, yFt: a.yFt, nodeType: a.nodeType,
      ...(a.arrowHead ? { arrowHead: a.arrowHead } : {}),
    })),
    handles: json.handles,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const CATMULL_TENSION = 0.4;

/**
 * Recompute the in/out handles for anchor at `idx` using Catmull-Rom tangent
 * estimation.  Preserves existing handles if the node is not smooth.
 */
function _recomputeHandlesAround(
  anchors: AnchorNode[],
  handles: SplineHandles,
  idx: number,
): void {
  const anchor = anchors[idx];
  if (!anchor) return;
  if (anchor.nodeType !== "smooth") {
    // Sharp nodes: clear auto-computed handles (user sets them manually or they
    // collapse to the anchor position, producing a cusp).
    handles[anchor.id] = { in: undefined, out: undefined };
    return;
  }

  const prev = anchors[idx - 1] ?? anchor;
  const next = anchors[idx + 1] ?? anchor;
  const tx = (next.xFt - prev.xFt) * CATMULL_TENSION;
  const ty = (next.yFt - prev.yFt) * CATMULL_TENSION;

  handles[anchor.id] = {
    in:  idx > 0                  ? { xFt: anchor.xFt - tx, yFt: anchor.yFt - ty } : undefined,
    out: idx < anchors.length - 1 ? { xFt: anchor.xFt + tx, yFt: anchor.yFt + ty } : undefined,
  };
}
