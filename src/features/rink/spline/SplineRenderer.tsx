"use client";

/**
 * SplineRenderer – React SVG component that renders an EditableSpline.
 *
 * Visual layers (bottom to top):
 *  1. Cubic bezier path stroke
 *  2. Handle leader lines (anchor → handle)
 *  3. Anchor nodes (circle, with stop/pivot symbol for sharp nodes)
 *  4. Bezier handle diamonds
 *  5. Movement frame ticks (when frames are provided)
 *
 * All coordinates are in rink feet; the SVG viewBox is expected to also
 * be in rink feet so no separate scale transform is needed.
 */

import React, { memo } from "react";
import type { EditableSpline, AnchorNode, HandleSide, SplineHandles, ArrowHeadType } from "./editableSpline";
import { buildSvgPath } from "./editableSpline";
import type { MovementFrame } from "./movementFrameGenerator";
import type { PathInteractionState } from "./pathInteraction";

// ---------------------------------------------------------------------------
// Visual constants (in rink feet)
// ---------------------------------------------------------------------------

const ANCHOR_RADIUS_FT     = 1.6;
const HANDLE_RADIUS_FT     = 1.1;
const FRAME_TICK_RADIUS_FT = 0.9;

const STOP_SYMBOL_R_FT    = 2.2;
const PIVOT_SYMBOL_R_FT   = 2.0;
const PIVOT_ARROW_HALF_FT = 1.8;

const PATH_STROKE_WIDTH    = 1.4; // ft
const LEADER_STROKE_WIDTH  = 0.5; // ft

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SplineRendererProps {
  spline: EditableSpline;
  interactionState: PathInteractionState;
  /** Movement frames derived from speed + arc-length. Optional. */
  frames?: MovementFrame[];
  /** Colour for the path stroke and anchor fill. */
  pathColor?: string;
  /** Colour for selected elements. */
  selectedColor?: string;
  /** Whether to show handles at all (only in edit modes). */
  showHandles?: boolean;
  /** Whether to show frame tick marks. */
  showFrameTicks?: boolean;
  /** Stroke dash array for the path (e.g. "4 3" for dashed). */
  strokeDashArray?: string;
  /** Opacity for the overall group. */
  opacity?: number;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AnchorSymbol({
  anchor,
  isSelected,
  pathColor,
  selectedColor,
}: {
  anchor: AnchorNode;
  isSelected: boolean;
  pathColor: string;
  selectedColor: string;
}) {
  const cx = anchor.xFt;
  const cy = anchor.yFt;
  const stroke = isSelected ? selectedColor : pathColor;

  if (anchor.nodeType === "sharpStop") {
    // Octagon stop symbol
    return (
      <circle
        cx={cx}
        cy={cy}
        r={STOP_SYMBOL_R_FT}
        fill={isSelected ? selectedColor : "none"}
        stroke={stroke}
        strokeWidth={0.45}
        data-anchor-id={anchor.id}
        data-anchor-type="sharpStop"
      />
    );
  }

  if (anchor.nodeType === "sharpPivot") {
    // Curved arrow pivot symbol
    const r = PIVOT_SYMBOL_R_FT;
    return (
      <g data-anchor-id={anchor.id} data-anchor-type="sharpPivot">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={0.4} strokeDasharray="1.2 0.8" />
        {/* Arrow head pointing right */}
        <polygon
          points={`${cx + r},${cy} ${cx + r - PIVOT_ARROW_HALF_FT},${cy - PIVOT_ARROW_HALF_FT * 0.6} ${cx + r - PIVOT_ARROW_HALF_FT},${cy + PIVOT_ARROW_HALF_FT * 0.6}`}
          fill={stroke}
        />
      </g>
    );
  }

  // smooth node
  return (
    <circle
      cx={cx}
      cy={cy}
      r={ANCHOR_RADIUS_FT}
      fill={isSelected ? selectedColor : pathColor}
      stroke="white"
      strokeWidth={0.3}
      data-anchor-id={anchor.id}
      data-anchor-type="smooth"
    />
  );
}

function HandleDiamond({
  anchorId,
  side,
  pos,
  isSelected,
  pathColor,
  selectedColor,
}: {
  anchorId: string;
  side: HandleSide;
  pos: { xFt: number; yFt: number };
  isSelected: boolean;
  pathColor: string;
  selectedColor: string;
}) {
  const r = HANDLE_RADIUS_FT;
  const { xFt: cx, yFt: cy } = pos;
  const fill = isSelected ? selectedColor : "white";
  const stroke = isSelected ? selectedColor : pathColor;

  return (
    <polygon
      points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
      fill={fill}
      stroke={stroke}
      strokeWidth={0.25}
      data-bezier-handle="true"
      data-anchor-id={anchorId}
      data-handle-side={side}
    />
  );
}

// ---------------------------------------------------------------------------
// Arrowhead rendering
// ---------------------------------------------------------------------------

/** Compute unit outgoing tangent at an anchor (direction of travel). */
function getOutTangent(
  anchor: AnchorNode,
  handles: SplineHandles,
  anchors: AnchorNode[],
  idx: number,
): { ux: number; uy: number } {
  const hData = handles[anchor.id];
  let dx: number, dy: number;

  if (hData?.out) {
    dx = hData.out.xFt - anchor.xFt;
    dy = hData.out.yFt - anchor.yFt;
  } else if (hData?.in) {
    // Last anchor: incoming direction
    dx = anchor.xFt - hData.in.xFt;
    dy = anchor.yFt - hData.in.yFt;
  } else if (idx + 1 < anchors.length) {
    const next = anchors[idx + 1];
    dx = next.xFt - anchor.xFt;
    dy = next.yFt - anchor.yFt;
  } else if (idx > 0) {
    const prev = anchors[idx - 1];
    dx = anchor.xFt - prev.xFt;
    dy = anchor.yFt - prev.yFt;
  } else {
    return { ux: 1, uy: 0 };
  }

  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return { ux: 1, uy: 0 };
  return { ux: dx / len, uy: dy / len };
}

const AH_HALF_LEN = 3.0;  // half-length of arrowhead shape (ft)
const AH_HALF_W   = 1.9;  // half-width (ft)

function ArrowHeadMark({
  anchor, handles, anchors, idx, color,
}: {
  anchor: AnchorNode;
  handles: SplineHandles;
  anchors: AnchorNode[];
  idx: number;
  color: string;
}) {
  const arrowHead: ArrowHeadType | undefined = anchor.arrowHead;
  if (!arrowHead || arrowHead === "none") return null;

  const { ux, uy } = getOutTangent(anchor, handles, anchors, idx);
  const nx = -uy; // perpendicular
  const ny = ux;
  const cx = anchor.xFt;
  const cy = anchor.yFt;
  const L = AH_HALF_LEN;
  const W = AH_HALF_W;

  const tipX  = cx + ux * L;         const tipY  = cy + uy * L;
  const baseX = cx - ux * L;         const baseY = cy - uy * L;

  switch (arrowHead) {
    case "arrow":
      return (
        <polygon
          points={`${tipX},${tipY} ${baseX + nx * W},${baseY + ny * W} ${baseX - nx * W},${baseY - ny * W}`}
          fill={color}
          pointerEvents="none"
        />
      );
    case "open":
      return (
        <path
          d={`M${baseX + nx * W},${baseY + ny * W} L${tipX},${tipY} L${baseX - nx * W},${baseY - ny * W}`}
          fill="none"
          stroke={color}
          strokeWidth={0.7}
          strokeLinejoin="round"
          pointerEvents="none"
        />
      );
    case "tee": {
      const barHalfW = W * 1.5;
      return (
        <line
          x1={cx + nx * barHalfW} y1={cy + ny * barHalfW}
          x2={cx - nx * barHalfW} y2={cy - ny * barHalfW}
          stroke={color}
          strokeWidth={0.8}
          strokeLinecap="round"
          pointerEvents="none"
        />
      );
    }
    case "circle":
      return (
        <circle
          cx={cx}
          cy={cy}
          r={ANCHOR_RADIUS_FT * 1.5}
          fill={color}
          pointerEvents="none"
        />
      );
    default:
      return null;
  }
}

function FrameTick({ frame, color }: { frame: MovementFrame; color: string }) {
  return (
    <circle
      cx={frame.pos.xFt}
      cy={frame.pos.yFt}
      r={FRAME_TICK_RADIUS_FT}
      fill={color}
      fillOpacity={0.55}
      stroke="white"
      strokeWidth={0.2}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const SplineRenderer = memo(function SplineRenderer({
  spline,
  interactionState,
  frames,
  pathColor = "#2563eb",
  selectedColor = "#f59e0b",
  showHandles = false,
  showFrameTicks = false,
  strokeDashArray,
  opacity = 1,
}: SplineRendererProps) {
  const { anchors, handles } = spline;
  const { selectedAnchorId, selectedHandle } = interactionState;

  const pathD = buildSvgPath(spline);

  return (
    <g opacity={opacity} style={{ pointerEvents: "none" }}>
      {/* 1. Path stroke */}
      {pathD && (
        <path
          d={pathD}
          fill="none"
          stroke={pathColor}
          strokeWidth={PATH_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={strokeDashArray}
        />
      )}

      {/* 2. Handle leader lines – only in edit mode with handles visible */}
      {showHandles && anchors.map((anchor) => {
        const hData = handles[anchor.id];
        return (
          <React.Fragment key={`leaders-${anchor.id}`}>
            {hData?.in && (
              <line
                x1={anchor.xFt} y1={anchor.yFt}
                x2={hData.in.xFt} y2={hData.in.yFt}
                stroke={pathColor}
                strokeWidth={LEADER_STROKE_WIDTH}
                strokeOpacity={0.55}
                strokeDasharray="1 1"
              />
            )}
            {hData?.out && (
              <line
                x1={anchor.xFt} y1={anchor.yFt}
                x2={hData.out.xFt} y2={hData.out.yFt}
                stroke={pathColor}
                strokeWidth={LEADER_STROKE_WIDTH}
                strokeOpacity={0.55}
                strokeDasharray="1 1"
              />
            )}
          </React.Fragment>
        );
      })}

      {/* 3. Anchor nodes */}
      {anchors.map((anchor) => (
        <AnchorSymbol
          key={anchor.id}
          anchor={anchor}
          isSelected={anchor.id === selectedAnchorId}
          pathColor={pathColor}
          selectedColor={selectedColor}
        />
      ))}

      {/* 3.5. Arrowhead markers */}
      {anchors.map((anchor, idx) => (
        <ArrowHeadMark
          key={`ah-${anchor.id}`}
          anchor={anchor}
          handles={handles}
          anchors={anchors}
          idx={idx}
          color={anchor.id === selectedAnchorId ? selectedColor : pathColor}
        />
      ))}

      {/* 4. Handle diamonds – only when edit mode + showHandles */}
      {showHandles && anchors.map((anchor) => {
        const hData = handles[anchor.id];
        return (
          <React.Fragment key={`handles-${anchor.id}`}>
            {hData?.in && (
              <HandleDiamond
                anchorId={anchor.id}
                side="in"
                pos={hData.in}
                isSelected={
                  selectedHandle?.anchorId === anchor.id &&
                  selectedHandle?.side === "in"
                }
                pathColor={pathColor}
                selectedColor={selectedColor}
              />
            )}
            {hData?.out && (
              <HandleDiamond
                anchorId={anchor.id}
                side="out"
                pos={hData.out}
                isSelected={
                  selectedHandle?.anchorId === anchor.id &&
                  selectedHandle?.side === "out"
                }
                pathColor={pathColor}
                selectedColor={selectedColor}
              />
            )}
          </React.Fragment>
        );
      })}

      {/* 5. Frame ticks */}
      {showFrameTicks && frames && frames.map((frame) => (
        <FrameTick key={frame.index} frame={frame} color={pathColor} />
      ))}
    </g>
  );
});

/**
 * Renders only the arrowhead marks for a spline — suitable for passive
 * (non-edit) rendering layered on top of an existing path stroke.
 */
export function ArrowHeads({ spline, color }: { spline: EditableSpline; color: string }) {
  const { anchors, handles } = spline;
  return (
    <>
      {anchors.map((anchor, idx) => (
        <ArrowHeadMark
          key={`ah-${anchor.id}`}
          anchor={anchor}
          handles={handles}
          anchors={anchors}
          idx={idx}
          color={color}
        />
      ))}
    </>
  );
}
