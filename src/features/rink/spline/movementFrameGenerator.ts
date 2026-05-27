/**
 * MovementFrameGenerator – derives movement frames from a spline.
 *
 * Core rule (from ticket):
 *   FRAME_INTERVAL_SEC = 2
 *   distancePerFrame   = playerSpeedFtPerSec × 2
 *
 * Changing player speed regenerates frame placement but does NOT alter
 * the master spline shape.
 *
 * Sharp nodes (sharpStop / sharpPivot) force a frame at their exact
 * anchor position and reset distance accumulation for the next leg.
 */

import type { EditableSpline, AnchorNode, Pt } from "./editableSpline";
import {
  buildArcLengthTable,
  getPositionAtDistance,
  type ArcLengthTable,
} from "./arcLengthSampler";
import { getSkatingFtPerSec } from "../runtime/motionProfiles";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed timeline interval in seconds (ticket requirement). */
export const FRAME_INTERVAL_SEC = 2;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single movement frame generated from the spline. */
export interface MovementFrame {
  /** Frame index starting at 0 for the very first anchor. */
  index: number;
  /** Absolute time in seconds from the start of the path. */
  timeSec: number;
  /** Position on the rink in feet. */
  pos: Pt;
  /**
   * If this frame coincides with a sharp anchor (stop/pivot), the
   * anchor is referenced here so the renderer can draw the correct symbol.
   */
  sharpAnchor?: AnchorNode;
}

export interface GeneratedMovementFrames {
  frames: MovementFrame[];
  /** Cumulative arc-length table used during generation (for inspection / debug). */
  table: ArcLengthTable;
  /** Total path length in feet. */
  totalFt: number;
  /** Total duration of the path in seconds. */
  totalSec: number;
  /** Speed used for frame generation (ft/s). */
  speedFtPerSec: number;
}

// ---------------------------------------------------------------------------
// Speed resolution
// ---------------------------------------------------------------------------

/** Resolve a player speed in ft/s from the editor's speedTier (0-6) and ageGroup. */
export function resolveSpeedFtPerSec(
  ageGroup: string,
  speedTier: number,
): number {
  // speedTier 0 = pause (0 ft/s), 1-6 map to glide/slow/cruise/fast/sprint/top-speed
  // Modifier values must match getActorSpeedModifier() in rink-home.tsx.
  if (speedTier === 0) return 0;
  const modifiers = [-1, -0.5, 0, 0.5, 0.75, 1];
  const modifier = modifiers[Math.min(speedTier - 1, modifiers.length - 1)];
  return getSkatingFtPerSec(ageGroup, modifier) ?? 10; // 10 ft/s fallback
}

// ---------------------------------------------------------------------------
// Frame generation
// ---------------------------------------------------------------------------

/**
 * Generate movement frames for the given spline.
 *
 * Algorithm:
 *  1. Build arc-length table for the spline.
 *  2. Walk the spline by distance intervals (distancePerFrame).
 *  3. At each sharp anchor, force a frame at the exact anchor position
 *     and restart the distance accumulator from that point.
 */
export function generateMovementFrames(
  spline: EditableSpline,
  speedFtPerSec: number,
): GeneratedMovementFrames {
  const table = buildArcLengthTable(spline);

  if (table.totalFt <= 0 || speedFtPerSec <= 0 || spline.anchors.length < 2) {
    return {
      frames: spline.anchors.length > 0
        ? [{ index: 0, timeSec: 0, pos: { xFt: spline.anchors[0].xFt, yFt: spline.anchors[0].yFt } }]
        : [],
      table,
      totalFt: table.totalFt,
      totalSec: 0,
      speedFtPerSec,
    };
  }

  const distPerFrame = speedFtPerSec * FRAME_INTERVAL_SEC;
  const frames: MovementFrame[] = [];

  // Frame 0 is always the start anchor.
  frames.push({
    index: 0,
    timeSec: 0,
    pos: { xFt: spline.anchors[0].xFt, yFt: spline.anchors[0].yFt },
  });

  // Build a lookup: anchor → cumulative distance at that anchor.
  // Anchors sit at the end of their respective bezier segments.
  const anchorDistances = _buildAnchorDistanceMap(spline, table);

  let frameIndex = 1;
  let timeSec = FRAME_INTERVAL_SEC;
  let distanceFt = distPerFrame;

  // Collect sharp anchor distances so we can detect when we cross one.
  const sharpAnchors = spline.anchors
    .slice(1) // skip the first; it's frame 0
    .filter((a) => a.nodeType !== "smooth")
    .map((a) => ({ anchor: a, distFt: anchorDistances.get(a.id) ?? Infinity }))
    .sort((a, b) => a.distFt - b.distFt);

  let sharpIdx = 0; // pointer into sharpAnchors

  while (distanceFt <= table.totalFt + 1e-6) {
    // Check if a sharp anchor falls before this frame's distance.
    const nextSharp = sharpAnchors[sharpIdx];
    if (nextSharp && nextSharp.distFt < distanceFt - 1e-4) {
      // Emit a frame exactly at the sharp anchor.
      const sharpTimeSec = nextSharp.distFt / speedFtPerSec;
      frames.push({
        index: frameIndex++,
        timeSec: sharpTimeSec,
        pos: { xFt: nextSharp.anchor.xFt, yFt: nextSharp.anchor.yFt },
        sharpAnchor: nextSharp.anchor,
      });
      sharpIdx++;

      // Reset accumulator from the sharp anchor position onward.
      // The next normal frame continues from the sharp anchor in distance units,
      // but the time clock continues uninterrupted.
      distanceFt = nextSharp.distFt + distPerFrame;
      timeSec = sharpTimeSec + FRAME_INTERVAL_SEC;
      continue;
    }

    const pos = getPositionAtDistance(table, distanceFt);
    frames.push({ index: frameIndex++, timeSec, pos });

    distanceFt += distPerFrame;
    timeSec += FRAME_INTERVAL_SEC;
  }

  // Always include the final anchor as the last frame if not already there.
  const last = spline.anchors[spline.anchors.length - 1];
  const lastFrame = frames[frames.length - 1];
  const endDist = Math.hypot(lastFrame.pos.xFt - last.xFt, lastFrame.pos.yFt - last.yFt);
  if (endDist > 0.5) {
    frames.push({
      index: frameIndex,
      timeSec: table.totalFt / speedFtPerSec,
      pos: { xFt: last.xFt, yFt: last.yFt },
    });
  }

  const totalSec = table.totalFt / speedFtPerSec;

  return { frames, table, totalFt: table.totalFt, totalSec, speedFtPerSec };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Build a Map<anchorId, cumulativeDistFt> for all anchors in the spline. */
function _buildAnchorDistanceMap(
  spline: EditableSpline,
  table: ArcLengthTable,
): Map<string, number> {
  const map = new Map<string, number>();
  if (table.entries.length === 0) return map;

  // Anchor i sits at the END of segment (i-1), i.e. at segIndex=i-1 with t=1.
  // The last entry for a segment has t=1 and segIndex=i-1.
  for (let i = 1; i < spline.anchors.length; i++) {
    const anchor = spline.anchors[i];
    // Find the arc-length entry with segIndex = i-1 and t = 1.
    // Since we sample in order, this is the last entry with segIndex === i-1.
    const targetSeg = i - 1;
    let bestDist = 0;
    for (const entry of table.entries) {
      if (entry.segIndex === targetSeg) {
        bestDist = entry.distFt;
      }
    }
    map.set(anchor.id, bestDist);
  }
  return map;
}
