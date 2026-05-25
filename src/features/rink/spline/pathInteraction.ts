/**
 * PathInteraction – deterministic hit-testing and drag behaviour for the
 * editable spline.
 *
 * Design rules (from ticket):
 *  • Handles are tested BEFORE anchors in every pointer event.
 *  • Dragging a handle NEVER moves its anchor.
 *  • Editing is locked outside "new-path" and "edit-path" modes.
 *  • Hit radii are in FEET (rink coordinate space), not pixels.
 *
 * This is a pure-logic module (no React) so it can be tested without a DOM.
 * The React hook `usePathInteraction` is a thin wrapper that connects this
 * logic to SVG pointer events.
 */

import {
  moveAnchor,
  moveHandle,
  appendAnchor,
  type EditableSpline,
  type AnchorNodeType,
  type HandleSide,
  type Pt,
} from "./editableSpline";

// ---------------------------------------------------------------------------
// Hit radii (feet in rink space)
// ---------------------------------------------------------------------------

export const ANCHOR_HIT_RADIUS_FT = 2.5;
export const HANDLE_HIT_RADIUS_FT = 2.0;

// ---------------------------------------------------------------------------
// Editor modes
// ---------------------------------------------------------------------------

export type PathEditorMode = "new-path" | "edit-path" | "locked";

// ---------------------------------------------------------------------------
// Interaction result types
// ---------------------------------------------------------------------------

export type HitAnchor = { kind: "anchor"; anchorId: string };
export type HitHandle = { kind: "handle"; anchorId: string; side: HandleSide };
export type HitMiss  = { kind: "none" };

export type HitResult = HitAnchor | HitHandle | HitMiss;

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/**
 * Test a pointer position (in rink feet) against all handles first, then
 * anchors.  Returns the closest match within the respective hit radius.
 *
 * Priority: handles > anchors (prevents handles hidden behind anchors
 * from becoming unreachable).
 */
export function hitTest(
  spline: EditableSpline,
  pointerFt: Pt,
): HitResult {
  const { anchors, handles } = spline;
  let bestDist = Infinity;
  let bestResult: HitResult = { kind: "none" };

  // --- Pass 1: handles ---
  for (const anchor of anchors) {
    const hData = handles[anchor.id];
    for (const side of ["in", "out"] as HandleSide[]) {
      const h = hData?.[side];
      if (!h) continue;
      const d = Math.hypot(pointerFt.xFt - h.xFt, pointerFt.yFt - h.yFt);
      if (d <= HANDLE_HIT_RADIUS_FT && d < bestDist) {
        bestDist = d;
        bestResult = { kind: "handle", anchorId: anchor.id, side };
      }
    }
  }

  if (bestResult.kind === "handle") return bestResult; // handles win

  // --- Pass 2: anchors ---
  bestDist = Infinity;
  for (const anchor of anchors) {
    const d = Math.hypot(pointerFt.xFt - anchor.xFt, pointerFt.yFt - anchor.yFt);
    if (d <= ANCHOR_HIT_RADIUS_FT && d < bestDist) {
      bestDist = d;
      bestResult = { kind: "anchor", anchorId: anchor.id };
    }
  }

  return bestResult;
}

// ---------------------------------------------------------------------------
// Drag state machine
// ---------------------------------------------------------------------------

export type DragTarget =
  | { kind: "anchor"; anchorId: string; originFt: Pt }
  | { kind: "handle"; anchorId: string; side: HandleSide; originFt: Pt };

export interface PathInteractionState {
  mode: PathEditorMode;
  selectedAnchorId: string | null;
  selectedHandle: { anchorId: string; side: HandleSide } | null;
  drag: DragTarget | null;
}

export function createInteractionState(
  mode: PathEditorMode = "locked",
): PathInteractionState {
  return { mode, selectedAnchorId: null, selectedHandle: null, drag: null };
}

// ---------------------------------------------------------------------------
// Event handlers (pure functions – return new state + updated spline)
// ---------------------------------------------------------------------------

export interface PointerDownResult {
  state: PathInteractionState;
  spline: EditableSpline;
}

/**
 * Handle a pointer-down event in rink-coordinate space.
 *
 *  • In "locked" mode: no-op.
 *  • In "edit-path" mode: hit-test → start drag.
 *  • In "new-path" mode: if nothing is hit, append a new anchor.
 */
export function onPointerDown(
  state: PathInteractionState,
  spline: EditableSpline,
  pointerFt: Pt,
  nodeType: AnchorNodeType = "smooth",
): PointerDownResult {
  if (state.mode === "locked") return { state, spline };

  const hit = hitTest(spline, pointerFt);

  if (hit.kind === "handle") {
    const handle = spline.handles[hit.anchorId]?.[hit.side];
    return {
      state: {
        ...state,
        selectedHandle: { anchorId: hit.anchorId, side: hit.side },
        selectedAnchorId: null,
        drag: { kind: "handle", anchorId: hit.anchorId, side: hit.side, originFt: handle ?? pointerFt },
      },
      spline,
    };
  }

  if (hit.kind === "anchor") {
    const anchor = spline.anchors.find((a) => a.id === hit.anchorId);
    return {
      state: {
        ...state,
        selectedAnchorId: hit.anchorId,
        selectedHandle: null,
        drag: { kind: "anchor", anchorId: hit.anchorId, originFt: anchor ? { xFt: anchor.xFt, yFt: anchor.yFt } : pointerFt },
      },
      spline,
    };
  }

  // No hit
  if (state.mode === "new-path") {
    // Append a new anchor at the click position.
    const nextSpline = appendAnchor(spline, pointerFt, nodeType);
    const newAnchorId = nextSpline.anchors[nextSpline.anchors.length - 1].id;
    return {
      state: {
        ...state,
        selectedAnchorId: newAnchorId,
        selectedHandle: null,
        drag: null,
      },
      spline: nextSpline,
    };
  }

  // edit-path + no hit → deselect
  return {
    state: { ...state, selectedAnchorId: null, selectedHandle: null, drag: null },
    spline,
  };
}

export interface PointerMoveResult {
  state: PathInteractionState;
  spline: EditableSpline;
}

/**
 * Handle a pointer-move event.  If a drag is active, update the spline.
 * Dragging a handle does NOT move its anchor (strict separation).
 */
export function onPointerMove(
  state: PathInteractionState,
  spline: EditableSpline,
  pointerFt: Pt,
): PointerMoveResult {
  if (!state.drag) return { state, spline };

  const { drag } = state;

  if (drag.kind === "handle") {
    // Update handle position only.
    return {
      state,
      spline: moveHandle(spline, drag.anchorId, drag.side, pointerFt),
    };
  }

  if (drag.kind === "anchor") {
    // Update anchor position (and shift its handles by the same delta).
    return {
      state,
      spline: moveAnchor(spline, drag.anchorId, pointerFt),
    };
  }

  return { state, spline };
}

export interface PointerUpResult {
  state: PathInteractionState;
  spline: EditableSpline;
}

/** Handle pointer-up: end the drag, keep selection. */
export function onPointerUp(
  state: PathInteractionState,
  spline: EditableSpline,
): PointerUpResult {
  return { state: { ...state, drag: null }, spline };
}

// ---------------------------------------------------------------------------
// React hook (thin wrapper)
// ---------------------------------------------------------------------------

// Importing React here keeps the hook co-located without making the
// pure functions above React-dependent.
import { useCallback, useRef, useState } from "react";

export interface UsePathInteractionOptions {
  /** SVG element whose coordinate system is in rink feet. */
  svgRef: React.RefObject<SVGSVGElement | null>;
  /** Initial mode. */
  mode: PathEditorMode;
  /** Default node type for newly appended anchors. */
  defaultNodeType?: AnchorNodeType;
  /** Called after any committed spline change (drag end, append). */
  onSplineChange?: (spline: EditableSpline) => void;
}

export interface UsePathInteractionReturn {
  /** Current interaction state (selection, drag). */
  interactionState: PathInteractionState;
  /** Live spline – updated on every pointer move. */
  spline: EditableSpline;
  /** Pointer event handlers to spread onto the SVG element. */
  svgPointerHandlers: {
    onPointerDown: React.PointerEventHandler<SVGSVGElement>;
    onPointerMove: React.PointerEventHandler<SVGSVGElement>;
    onPointerUp: React.PointerEventHandler<SVGSVGElement>;
    onPointerCancel: React.PointerEventHandler<SVGSVGElement>;
  };
  /** Imperative API to drive state from outside (e.g. toolbar buttons). */
  setMode: (mode: PathEditorMode) => void;
  setSpline: (spline: EditableSpline) => void;
}

/** Convert an SVG pointer event position to rink feet coordinates. */
function svgPointerToFt(
  event: React.PointerEvent<SVGSVGElement>,
  svg: SVGSVGElement,
): Pt {
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { xFt: 0, yFt: 0 };
  const transformed = pt.matrixTransform(matrix.inverse());
  return { xFt: transformed.x, yFt: transformed.y };
}

export function usePathInteraction(
  initialSpline: EditableSpline,
  options: UsePathInteractionOptions,
): UsePathInteractionReturn {
  const { svgRef, mode: initialMode, defaultNodeType = "smooth", onSplineChange } = options;

  const [interactionState, setInteractionState] = useState<PathInteractionState>(() =>
    createInteractionState(initialMode),
  );
  const [spline, setSplineState] = useState<EditableSpline>(initialSpline);

  // Keep a ref so event handlers always see the latest values without stale closure issues.
  const stateRef = useRef(interactionState);
  const splineRef = useRef(spline);
  stateRef.current = interactionState;
  splineRef.current = spline;

  const applyResult = useCallback(
    (result: PointerDownResult | PointerMoveResult | PointerUpResult, commit: boolean) => {
      setInteractionState(result.state);
      setSplineState(result.spline);
      if (commit && onSplineChange) {
        onSplineChange(result.spline);
      }
    },
    [onSplineChange],
  );

  const handlePointerDown = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    (e) => {
      const svg = svgRef.current;
      if (!svg) return;
      const pointerFt = svgPointerToFt(e, svg);
      const result = onPointerDown(stateRef.current, splineRef.current, pointerFt, defaultNodeType);
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      applyResult(result, false);
    },
    [svgRef, defaultNodeType, applyResult],
  );

  const handlePointerMove = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    (e) => {
      if (!stateRef.current.drag) return;
      const svg = svgRef.current;
      if (!svg) return;
      const pointerFt = svgPointerToFt(e, svg);
      const result = onPointerMove(stateRef.current, splineRef.current, pointerFt);
      applyResult(result, false);
    },
    [svgRef, applyResult],
  );

  const handlePointerUp = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    (e) => {
      const result = onPointerUp(stateRef.current, splineRef.current);
      try { (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId); } catch { /* ok */ }
      applyResult(result, true /* commit */);
    },
    [applyResult],
  );

  const setMode = useCallback((newMode: PathEditorMode) => {
    setInteractionState((prev) => ({ ...prev, mode: newMode }));
  }, []);

  const setSpline = useCallback((nextSpline: EditableSpline) => {
    setSplineState(nextSpline);
  }, []);

  return {
    interactionState,
    spline,
    svgPointerHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
    },
    setMode,
    setSpline,
  };
}
