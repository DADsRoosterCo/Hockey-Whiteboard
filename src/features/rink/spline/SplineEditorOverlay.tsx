"use client";

/**
 * SplineEditorOverlay – self-contained SVG overlay for editing a single actor's
 * Bezier spline.
 *
 * Replaces the legacy bezierDragRef / handleBezierGroupPointerDown / global
 * window listener approach in rink-home.tsx.
 *
 * Interaction model (from ticket):
 *  • Click anchor → select anchor
 *  • Drag anchor  → move anchor (handles shift with it)
 *  • Click handle → select handle
 *  • Drag handle  → move handle ONLY (anchor stays put)
 *  • Handles are hit-tested BEFORE anchors so they are never occluded
 *  • Locking: in "locked" mode all pointer events are ignored
 */

import React, { useRef, useMemo } from "react";
import { SplineRenderer } from "./SplineRenderer";
import {
  usePathInteraction,
  type PathEditorMode,
  type UsePathInteractionOptions,
} from "./pathInteraction";
import {
  generateMovementFrames,
  resolveSpeedFtPerSec,
  type GeneratedMovementFrames,
} from "./movementFrameGenerator";
import type { EditableSpline, AnchorNodeType, AnchorNode, ArrowHeadType } from "./editableSpline";
import { setAnchorType, setAnchorArrowHead } from "./editableSpline";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SplineEditorOverlayProps {
  /** The spline to edit. */
  spline: EditableSpline;
  /** "new-path" | "edit-path" | "locked" */
  mode: PathEditorMode;
  /** Called whenever the spline is committed (pointer up after a drag, or new anchor added). */
  onSplineChange: (spline: EditableSpline) => void;
  /** Node type to assign to newly placed anchors. */
  defaultNodeType?: AnchorNodeType;
  /** Path stroke colour. */
  pathColor?: string;
  /** Selected element colour. */
  selectedColor?: string;
  /** Whether to show movement frame ticks. */
  showFrameTicks?: boolean;
  /** Player speed tier (0-6). Used for frame generation. */
  speedTier?: number;
  /** Age group string (e.g. "U13"). Used for frame generation. */
  ageGroup?: string;
  /** If provided the SVG viewBox / coordinate system is in rink feet. */
  viewBox?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SplineEditorOverlay({
  spline: externalSpline,
  mode,
  onSplineChange,
  defaultNodeType = "smooth",
  pathColor = "#2563eb",
  selectedColor = "#f59e0b",
  showFrameTicks = false,
  speedTier = 3,
  ageGroup = "U13",
  viewBox,
}: SplineEditorOverlayProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const interactionOptions: UsePathInteractionOptions = {
    svgRef,
    mode,
    defaultNodeType,
    onSplineChange,
  };

  const { interactionState, spline: liveSpline, svgPointerHandlers, setMode, setSpline } = usePathInteraction(
    externalSpline,
    interactionOptions,
  );

  // Sync mode changes from the parent.
  React.useEffect(() => {
    setMode(mode);
  }, [mode, setMode]);

  // When the parent swaps the spline entirely (actor change), sync via setSpline.
  // The parent should also pass a new `key` on actor switch to hard-reset the hook state.
  React.useEffect(() => {
    setSpline(externalSpline);
  }, [externalSpline, setSpline]);

  // Generate movement frames.
  const frames = useMemo<GeneratedMovementFrames | null>(() => {
    if (!showFrameTicks || liveSpline.anchors.length < 2) return null;
    const speedFtPerSec = resolveSpeedFtPerSec(ageGroup, speedTier);
    return generateMovementFrames(liveSpline, speedFtPerSec);
  }, [liveSpline, showFrameTicks, speedTier, ageGroup]);

  const selectedAnchor = interactionState.selectedAnchorId
    ? liveSpline.anchors.find((a) => a.id === interactionState.selectedAnchorId)
    : undefined;

  // Compute the out-tangent angle at the selected anchor so the menu rotates
  // to ride along the path direction.
  const menuRotDeg = useMemo(() => {
    if (!selectedAnchor) return 0;
    const anchors = liveSpline.anchors;
    const i = anchors.findIndex((a) => a.id === selectedAnchor.id);
    const h = liveSpline.handles[selectedAnchor.id];
    let dx: number, dy: number;
    if (h?.out) {
      dx = h.out.xFt - selectedAnchor.xFt; dy = h.out.yFt - selectedAnchor.yFt;
    } else if (h?.in) {
      dx = selectedAnchor.xFt - h.in.xFt; dy = selectedAnchor.yFt - h.in.yFt;
    } else if (i + 1 < anchors.length) {
      const n = anchors[i + 1];
      dx = n.xFt - selectedAnchor.xFt; dy = n.yFt - selectedAnchor.yFt;
    } else if (i > 0) {
      const p = anchors[i - 1];
      dx = selectedAnchor.xFt - p.xFt; dy = selectedAnchor.yFt - p.yFt;
    } else return 0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return 0;
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }, [selectedAnchor, liveSpline]);

  function handleSetNodeType(type: AnchorNodeType) {
    if (!interactionState.selectedAnchorId) return;
    const newSpline = setAnchorType(liveSpline, interactionState.selectedAnchorId, type);
    setSpline(newSpline);
    onSplineChange(newSpline);
  }

  function handleSetArrowHead(type: ArrowHeadType) {
    if (!interactionState.selectedAnchorId) return;
    const newSpline = setAnchorArrowHead(liveSpline, interactionState.selectedAnchorId, type);
    setSpline(newSpline);
    onSplineChange(newSpline);
  }

  const showHandles = mode !== "locked" && liveSpline.anchors.length > 1;

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: "none" }}
      aria-hidden="true"
      {...svgPointerHandlers}
    >
      {/* Hit-test areas for anchors and handles (invisible, generous size) */}
      <HitAreas spline={liveSpline} showHandles={showHandles} locked={mode === "locked"} />

      {/* Anchor pie menu — node type + arrowhead, inner/outer ring */}
      {selectedAnchor && mode === "edit-path" && (
        <AnchorPieMenu
          anchor={selectedAnchor}
          onNodeTypeChange={handleSetNodeType}
          onArrowHeadChange={handleSetArrowHead}
          accentColor={selectedColor}
          rotDeg={menuRotDeg}
        />
      )}

      {/* Visual rendering */}
      <SplineRenderer
        spline={liveSpline}
        interactionState={interactionState}
        frames={frames?.frames}
        pathColor={pathColor}
        selectedColor={selectedColor}
        showHandles={showHandles}
        showFrameTicks={showFrameTicks}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Hit-test helper (transparent circles / diamonds over each element)
// ---------------------------------------------------------------------------

/**
 * Invisible larger hit areas painted underneath the visual elements.
 * Because pointer-events are "none" on the SplineRenderer group,
 * these hit-areas are the sole targets for pointer events on the SVG.
 */
function HitAreas({ spline, showHandles, locked }: { spline: EditableSpline; showHandles: boolean; locked: boolean }) {
  const { anchors, handles } = spline;
  return (
    <g style={{ pointerEvents: locked ? "none" : "all" }}>
      {anchors.map((anchor) => (
        <circle
          key={`hit-anchor-${anchor.id}`}
          cx={anchor.xFt}
          cy={anchor.yFt}
          r={3.5}
          fill="transparent"
          stroke="none"
          data-anchor-id={anchor.id}
        />
      ))}

      {showHandles && anchors.map((anchor) => {
        const hData = handles[anchor.id];
        return (
          <React.Fragment key={`hit-handles-${anchor.id}`}>
            {hData?.in && (
              <circle
                cx={hData.in.xFt}
                cy={hData.in.yFt}
                r={2.8}
                fill="transparent"
                stroke="none"
                data-bezier-handle="true"
                data-anchor-id={anchor.id}
                data-handle-side="in"
              />
            )}
            {hData?.out && (
              <circle
                cx={hData.out.xFt}
                cy={hData.out.yFt}
                r={2.8}
                fill="transparent"
                stroke="none"
                data-bezier-handle="true"
                data-anchor-id={anchor.id}
                data-handle-side="out"
              />
            )}
          </React.Fragment>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Two-level anchor pie menu  (inner ring = category, outer ring = sub-options)
// ---------------------------------------------------------------------------

const PIE_GAP_DEG   = 4;    // degrees of gap between slices
const PIE_FONT_SIZE = 1.3;  // ft

// Inner (category) ring
const MAIN_INNER_R = 1.5;   // ft
const MAIN_OUTER_R = 4.6;   // ft
const MAIN_LABEL_R = 3.5;   // ft — textPath arc radius

// Outer (sub-option) ring
const SUB_INNER_R  = 5.0;   // ft
const SUB_OUTER_R  = 9.5;   // ft
const SUB_LABEL_R  = 8.0;   // ft — textPath arc radius
const SUB_ICON_R   = 6.4;   // ft — arrowhead preview midpoint

const MAIN_SLICES = [
  { id: "nodeType"  as const, label: "Type",  start: -180, end:    0 },
  { id: "arrowHead" as const, label: "Arrow", start:    0, end:  180 },
];

const NODE_TYPE_SUB: Array<{ type: AnchorNodeType; label: string; start: number; end: number }> = [
  { type: "smooth",     label: "Smooth", start: -150, end:  -30 },
  { type: "sharpStop",  label: "Stop",   start:  -30, end:   90 },
  { type: "sharpPivot", label: "Pivot",  start:   90, end:  210 },
];

const ARROWHEAD_SUB: Array<{ type: ArrowHeadType; label: string; start: number; end: number }> = [
  { type: "none",   label: "None",  start: -180, end: -108 },
  { type: "arrow",  label: "Arrow", start: -108, end:  -36 },
  { type: "open",   label: "Open",  start:  -36, end:   36 },
  { type: "tee",    label: "Tee",   start:   36, end:  108 },
  { type: "circle", label: "Dot",   start:  108, end:  180 },
];

function sliceArcPath(
  startDeg: number, endDeg: number,
  innerR: number, outerR: number,
  cx: number, cy: number,
  gapDeg = PIE_GAP_DEG,
): string {
  const toRad = (d: number) => d * (Math.PI / 180);
  const s = startDeg + gapDeg / 2;
  const e = endDeg   - gapDeg / 2;
  const ox1 = cx + outerR * Math.cos(toRad(s));  const oy1 = cy + outerR * Math.sin(toRad(s));
  const ox2 = cx + outerR * Math.cos(toRad(e));  const oy2 = cy + outerR * Math.sin(toRad(e));
  const ix1 = cx + innerR * Math.cos(toRad(e));  const iy1 = cy + innerR * Math.sin(toRad(e));
  const ix2 = cx + innerR * Math.cos(toRad(s));  const iy2 = cy + innerR * Math.sin(toRad(s));
  const large = (e - s > 180) ? 1 : 0;
  return [
    `M${ox1.toFixed(2)},${oy1.toFixed(2)}`,
    `A${outerR},${outerR},0,${large},1,${ox2.toFixed(2)},${oy2.toFixed(2)}`,
    `L${ix1.toFixed(2)},${iy1.toFixed(2)}`,
    `A${innerR},${innerR},0,${large},0,${ix2.toFixed(2)},${iy2.toFixed(2)}Z`,
  ].join("");
}

/**
 * Arc path suitable for SVG <textPath>. Reverses direction for bottom-half slices
 * so that text always reads left-to-right from outside the ring.
 */
function labelArcForText(startDeg: number, endDeg: number, cx: number, cy: number, radius: number): string {
  const toRad = (d: number) => d * (Math.PI / 180);
  const mid = (startDeg + endDeg) / 2;
  const isBottom = Math.sin(toRad(mid)) > 0; // mid below horizontal axis
  // Reverse path direction for bottom-half so glyphs face upward toward outside
  const [s, e, sweep] = isBottom
    ? [endDeg, startDeg, 0]   // CCW — text readable from outside at bottom
    : [startDeg, endDeg, 1];  // CW  — text readable from outside at top
  const span = Math.abs(endDeg - startDeg);
  const large = span > 180 ? 1 : 0;
  const x1 = (cx + radius * Math.cos(toRad(s))).toFixed(3);
  const y1 = (cy + radius * Math.sin(toRad(s))).toFixed(3);
  const x2 = (cx + radius * Math.cos(toRad(e))).toFixed(3);
  const y2 = (cy + radius * Math.sin(toRad(e))).toFixed(3);
  return `M${x1},${y1} A${radius},${radius},0,${large},${sweep},${x2},${y2}`;
}

/** Mini arrowhead shape drawn pointing radially outward, for the sub-ring icon. */
function SubArrowIcon({
  type, cx, cy, ux, uy, color,
}: {
  type: ArrowHeadType; cx: number; cy: number;
  ux: number; uy: number;   // unit outward direction
  color: string;
}) {
  const nx = -uy, ny = ux;  // perpendicular
  const L = 1.5, W = 0.9;
  const tipX = cx + ux * L,         tipY = cy + uy * L;
  const bX   = cx - ux * L,         bY   = cy - uy * L;

  switch (type) {
    case "none":
      return <line x1={cx - ux * L * 1.1} y1={cy - uy * L * 1.1} x2={cx + ux * L * 1.1} y2={cy + uy * L * 1.1} stroke={color} strokeWidth={0.4} strokeDasharray="0.7 0.4" pointerEvents="none" />;
    case "arrow":
      return <polygon points={`${tipX},${tipY} ${bX + nx*W},${bY + ny*W} ${bX - nx*W},${bY - ny*W}`} fill={color} pointerEvents="none" />;
    case "open":
      return <path d={`M${bX + nx*W},${bY + ny*W} L${tipX},${tipY} L${bX - nx*W},${bY - ny*W}`} fill="none" stroke={color} strokeWidth={0.38} strokeLinejoin="round" pointerEvents="none" />;
    case "tee":
      return (
        <g pointerEvents="none">
          <line x1={cx - ux * L} y1={cy - uy * L} x2={tipX} y2={tipY} stroke={color} strokeWidth={0.38} />
          <line x1={tipX + nx * W * 1.1} y1={tipY + ny * W * 1.1} x2={tipX - nx * W * 1.1} y2={tipY - ny * W * 1.1} stroke={color} strokeWidth={0.5} strokeLinecap="round" />
        </g>
      );
    case "circle":
      return <circle cx={cx} cy={cy} r={W * 0.85} fill={color} pointerEvents="none" />;
    default: return null;
  }
}

function AnchorPieMenu({
  anchor,
  onNodeTypeChange,
  onArrowHeadChange,
  accentColor,
  rotDeg,
}: {
  anchor: AnchorNode;
  onNodeTypeChange: (type: AnchorNodeType) => void;
  onArrowHeadChange: (type: ArrowHeadType) => void;
  accentColor: string;
  rotDeg: number;
}) {
  const [activeCategory, setActiveCategory] = React.useState<"nodeType" | "arrowHead" | null>(null);
  const cx = anchor.xFt;
  const cy = anchor.yFt;
  const toRad = (d: number) => d * (Math.PI / 180);
  const pid = anchor.id; // prefix for unique SVG def IDs

  const visibleMain = MAIN_SLICES.filter(({ id }) => activeCategory === null || activeCategory === id);
  const subItems = activeCategory === "nodeType" ? NODE_TYPE_SUB : activeCategory === "arrowHead" ? ARROWHEAD_SUB : [];

  return (
    <g
      transform={`rotate(${rotDeg.toFixed(2)}, ${cx}, ${cy})`}
      className="pointer-events-auto"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {/* SVG defs: arcs used as textPath guides */}
      <defs>
        {visibleMain.map(({ id, start, end }) => (
          <path key={id} id={`${pid}-m-${id}`}
            d={labelArcForText(start, end, cx, cy, MAIN_LABEL_R)} />
        ))}
        {subItems.map(({ type, start, end }) => (
          <path key={type} id={`${pid}-s-${type}`}
            d={labelArcForText(start, end, cx, cy, SUB_LABEL_R)} />
        ))}
      </defs>

      {/* ── Inner ring ───────────────────────────────────────────────────── */}
      {visibleMain.map(({ id, label, start, end }) => {
        const isSolo = activeCategory === id;
        return (
          <g
            key={id}
            className="cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setActiveCategory(activeCategory === id ? null : id); }}
          >
            {isSolo ? (
              /* Full donut when solo */
              <path
                d={`M${cx},${cy - MAIN_OUTER_R} A${MAIN_OUTER_R},${MAIN_OUTER_R},0,1,1,${cx - 0.001},${cy - MAIN_OUTER_R} Z M${cx},${cy - MAIN_INNER_R} A${MAIN_INNER_R},${MAIN_INNER_R},0,1,0,${cx - 0.001},${cy - MAIN_INNER_R} Z`}
                fill={accentColor} fillRule="evenodd"
              />
            ) : (
              <path
                d={sliceArcPath(start, end, MAIN_INNER_R, MAIN_OUTER_R, cx, cy)}
                fill="rgba(2,6,23,0.82)"
                stroke="rgba(255,255,255,0.14)"
                strokeWidth={0.3}
              />
            )}
            <text
              fontSize={PIE_FONT_SIZE}
              fontWeight={isSolo ? "700" : "400"}
              fill={isSolo ? "#020617" : "#e2e8f0"}
              className="select-none"
              pointerEvents="none"
            >
              <textPath href={`#${pid}-m-${id}`} startOffset="50%" textAnchor="middle">
                {label}
              </textPath>
            </text>
          </g>
        );
      })}

      {/* ── Outer ring: node-type ─────────────────────────────────────────── */}
      {activeCategory === "nodeType" && NODE_TYPE_SUB.map(({ type, label, start, end }) => {
        const isActive = anchor.nodeType === type;
        return (
          <g key={type} className="cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onNodeTypeChange(type); }}>
            <path
              d={sliceArcPath(start, end, SUB_INNER_R, SUB_OUTER_R, cx, cy)}
              fill={isActive ? accentColor : "rgba(2,6,23,0.82)"}
              stroke={isActive ? "none" : "rgba(255,255,255,0.14)"}
              strokeWidth={0.3}
            />
            <text
              fontSize={PIE_FONT_SIZE}
              fontWeight={isActive ? "700" : "400"}
              fill={isActive ? "#020617" : "#e2e8f0"}
              className="select-none"
              pointerEvents="none"
            >
              <textPath href={`#${pid}-s-${type}`} startOffset="50%" textAnchor="middle">
                {label}
              </textPath>
            </text>
          </g>
        );
      })}

      {/* ── Outer ring: arrowhead ────────────────────────────────────────── */}
      {activeCategory === "arrowHead" && ARROWHEAD_SUB.map(({ type, label, start, end }) => {
        const mid = (start + end) / 2;
        const ux = Math.cos(toRad(mid));
        const uy = Math.sin(toRad(mid));
        const iconCx = cx + SUB_ICON_R * ux;
        const iconCy = cy + SUB_ICON_R * uy;
        const isActive = (anchor.arrowHead ?? "none") === type;
        return (
          <g key={type} className="cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onArrowHeadChange(type); }}>
            <path
              d={sliceArcPath(start, end, SUB_INNER_R, SUB_OUTER_R, cx, cy)}
              fill={isActive ? accentColor : "rgba(2,6,23,0.82)"}
              stroke={isActive ? "none" : "rgba(255,255,255,0.14)"}
              strokeWidth={0.3}
            />
            <SubArrowIcon
              type={type} cx={iconCx} cy={iconCy} ux={ux} uy={uy}
              color={isActive ? "#020617" : "#e2e8f0"}
            />
            <text
              fontSize={PIE_FONT_SIZE - 0.1}
              fontWeight={isActive ? "700" : "400"}
              fill={isActive ? "#020617" : "#e2e8f0"}
              className="select-none"
              pointerEvents="none"
            >
              <textPath href={`#${pid}-s-${type}`} startOffset="50%" textAnchor="middle">
                {label}
              </textPath>
            </text>
          </g>
        );
      })}
    </g>
  );
}
