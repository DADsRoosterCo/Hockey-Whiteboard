// Hockey Canada regulation rink specification (200 ft × 85 ft) expressed
// as a structured RinkSpec object. This spec captures the official
// rink dimensions, painted markings, semantic zones, benches, penalty
// boxes and door locations. It is based on the Hockey Canada Technical
// Rules and Part I of the rulebook. Consumers may import and render
// this spec directly or extend it with facility-specific overrides.

import type { RinkSpec } from "./rinkTypes"

// Feet conversion for inches
const INCH = 1 / 12

// Core dimensions
const LENGTH = 200
const WIDTH = 85
const CENTER_X = LENGTH / 2
const CENTER_Y = WIDTH / 2

// Goal line positions: 11 ft from each end board
const GOAL_LINE_LEFT = 11
const GOAL_LINE_RIGHT = LENGTH - GOAL_LINE_LEFT

// Blue line positions: 64 ft from each goal line on regulation size rinks
const BLUE_LINE_LEFT = GOAL_LINE_LEFT + 64
const BLUE_LINE_RIGHT = GOAL_LINE_RIGHT - 64

// End‑zone faceoff dot y positions (22 ft above/below centre)
const FACE_OFF_Y_TOP = CENTER_Y - 22
const FACE_OFF_Y_BOTTOM = CENTER_Y + 22

/**
 * Exported Hockey Canada rink specification. Consumers can customise
 * benches, penalty boxes and doors at runtime by cloning and
 * modifying this object. Where benches and penalty boxes are not
 * identical across facilities, the provided sizes serve as sensible
 * defaults.
 */
export const hockeyCanadaRinkSpec: RinkSpec = {
  id: "hockey-canada-200x85-v2024",
  name: "Hockey Canada 200 ft x 85 ft Regulation Rink",
  governingBody: "Hockey Canada",
  version: "2.0.0",
  units: "feet",

  surface: {
    lengthFt: LENGTH,
    widthFt: WIDTH,
    cornerRadiusFt: 28,
    boardHeightFt: 3.5,
    glassHeightFt: 8,
  },

  defaults: {
    // Standard line width for minor markings such as goal lines and crease
    lineWidthFt: 2 * INCH,
    // Major lines (centre and blue) are 12 inches wide
    majorLineWidthFt: 12 * INCH,
    // Default grid resolution in feet
    gridSizeFt: 1,
  },

  markings: [
    // Goal lines
    {
      id: "left-goal-line",
      type: "line",
      name: "Left Goal Line",
      orientation: "vertical",
      xFt: GOAL_LINE_LEFT,
      from: { xFt: GOAL_LINE_LEFT, yFt: 0 },
      to: { xFt: GOAL_LINE_LEFT, yFt: WIDTH },
      widthFt: 2 * INCH,
      color: "red",
      semanticRole: "goal-line",
    },
    {
      id: "right-goal-line",
      type: "line",
      name: "Right Goal Line",
      orientation: "vertical",
      xFt: GOAL_LINE_RIGHT,
      from: { xFt: GOAL_LINE_RIGHT, yFt: 0 },
      to: { xFt: GOAL_LINE_RIGHT, yFt: WIDTH },
      widthFt: 2 * INCH,
      color: "red",
      semanticRole: "goal-line",
    },
    // Blue lines
    {
      id: "left-blue-line",
      type: "line",
      name: "Left Blue Line",
      orientation: "vertical",
      xFt: BLUE_LINE_LEFT,
      from: { xFt: BLUE_LINE_LEFT, yFt: 0 },
      to: { xFt: BLUE_LINE_LEFT, yFt: WIDTH },
      widthFt: 12 * INCH,
      color: "blue",
      extendsUpBoards: true,
      semanticRole: "blue-line",
    },
    {
      id: "right-blue-line",
      type: "line",
      name: "Right Blue Line",
      orientation: "vertical",
      xFt: BLUE_LINE_RIGHT,
      from: { xFt: BLUE_LINE_RIGHT, yFt: 0 },
      to: { xFt: BLUE_LINE_RIGHT, yFt: WIDTH },
      widthFt: 12 * INCH,
      color: "blue",
      extendsUpBoards: true,
      semanticRole: "blue-line",
    },
    // Centre red line
    {
      id: "centre-red-line",
      type: "line",
      name: "Centre Red Line",
      orientation: "vertical",
      xFt: CENTER_X,
      from: { xFt: CENTER_X, yFt: 0 },
      to: { xFt: CENTER_X, yFt: WIDTH },
      widthFt: 12 * INCH,
      color: "red",
      extendsUpBoards: true,
      semanticRole: "centre-red-line",
    },
    // Centre faceoff circle & spot
    {
      id: "centre-faceoff-circle",
      type: "circle",
      name: "Centre Faceoff Circle",
      center: { xFt: CENTER_X, yFt: CENTER_Y },
      radiusFt: 15,
      lineWidthFt: 2 * INCH,
      color: "blue",
      semanticRole: "centre-faceoff-circle",
    },
    {
      id: "centre-faceoff-spot",
      type: "spot",
      name: "Centre Faceoff Spot",
      center: { xFt: CENTER_X, yFt: CENTER_Y },
      radiusFt: 0.5,
      color: "blue",
      semanticRole: "centre-faceoff-spot",
    },
    // End zone faceoff circles and spots
    {
      id: "left-top-end-zone-faceoff-circle",
      type: "circle",
      name: "Left Top End Zone Faceoff Circle",
      center: { xFt: GOAL_LINE_LEFT + 20, yFt: FACE_OFF_Y_TOP },
      radiusFt: 15,
      lineWidthFt: 2 * INCH,
      color: "red",
      semanticRole: "end-zone-faceoff-circle",
    },
    {
      id: "left-bottom-end-zone-faceoff-circle",
      type: "circle",
      name: "Left Bottom End Zone Faceoff Circle",
      center: { xFt: GOAL_LINE_LEFT + 20, yFt: FACE_OFF_Y_BOTTOM },
      radiusFt: 15,
      lineWidthFt: 2 * INCH,
      color: "red",
      semanticRole: "end-zone-faceoff-circle",
    },
    {
      id: "right-top-end-zone-faceoff-circle",
      type: "circle",
      name: "Right Top End Zone Faceoff Circle",
      center: { xFt: GOAL_LINE_RIGHT - 20, yFt: FACE_OFF_Y_TOP },
      radiusFt: 15,
      lineWidthFt: 2 * INCH,
      color: "red",
      semanticRole: "end-zone-faceoff-circle",
    },
    {
      id: "right-bottom-end-zone-faceoff-circle",
      type: "circle",
      name: "Right Bottom End Zone Faceoff Circle",
      center: { xFt: GOAL_LINE_RIGHT - 20, yFt: FACE_OFF_Y_BOTTOM },
      radiusFt: 15,
      lineWidthFt: 2 * INCH,
      color: "red",
      semanticRole: "end-zone-faceoff-circle",
    },
    // End zone faceoff spots
    {
      id: "left-top-end-zone-faceoff-spot",
      type: "spot",
      name: "Left Top End Zone Faceoff Spot",
      center: { xFt: GOAL_LINE_LEFT + 20, yFt: FACE_OFF_Y_TOP },
      radiusFt: 1,
      color: "red",
      semanticRole: "end-zone-faceoff-spot",
    },
    {
      id: "left-bottom-end-zone-faceoff-spot",
      type: "spot",
      name: "Left Bottom End Zone Faceoff Spot",
      center: { xFt: GOAL_LINE_LEFT + 20, yFt: FACE_OFF_Y_BOTTOM },
      radiusFt: 1,
      color: "red",
      semanticRole: "end-zone-faceoff-spot",
    },
    {
      id: "right-top-end-zone-faceoff-spot",
      type: "spot",
      name: "Right Top End Zone Faceoff Spot",
      center: { xFt: GOAL_LINE_RIGHT - 20, yFt: FACE_OFF_Y_TOP },
      radiusFt: 1,
      color: "red",
      semanticRole: "end-zone-faceoff-spot",
    },
    {
      id: "right-bottom-end-zone-faceoff-spot",
      type: "spot",
      name: "Right Bottom End Zone Faceoff Spot",
      center: { xFt: GOAL_LINE_RIGHT - 20, yFt: FACE_OFF_Y_BOTTOM },
      radiusFt: 1,
      color: "red",
      semanticRole: "end-zone-faceoff-spot",
    },
    // Neutral zone faceoff spots
    {
      id: "left-top-neutral-zone-faceoff-spot",
      type: "spot",
      name: "Left Top Neutral Zone Faceoff Spot",
      center: { xFt: BLUE_LINE_LEFT + 5, yFt: FACE_OFF_Y_TOP },
      radiusFt: 1,
      color: "red",
      semanticRole: "neutral-zone-faceoff-spot",
    },
    {
      id: "left-bottom-neutral-zone-faceoff-spot",
      type: "spot",
      name: "Left Bottom Neutral Zone Faceoff Spot",
      center: { xFt: BLUE_LINE_LEFT + 5, yFt: FACE_OFF_Y_BOTTOM },
      radiusFt: 1,
      color: "red",
      semanticRole: "neutral-zone-faceoff-spot",
    },
    {
      id: "right-top-neutral-zone-faceoff-spot",
      type: "spot",
      name: "Right Top Neutral Zone Faceoff Spot",
      center: { xFt: BLUE_LINE_RIGHT - 5, yFt: FACE_OFF_Y_TOP },
      radiusFt: 1,
      color: "red",
      semanticRole: "neutral-zone-faceoff-spot",
    },
    {
      id: "right-bottom-neutral-zone-faceoff-spot",
      type: "spot",
      name: "Right Bottom Neutral Zone Faceoff Spot",
      center: { xFt: BLUE_LINE_RIGHT - 5, yFt: FACE_OFF_Y_BOTTOM },
      radiusFt: 1,
      color: "red",
      semanticRole: "neutral-zone-faceoff-spot",
    },
    // Goal creases (arcs)
    {
      id: "left-goal-crease",
      type: "arc",
      name: "Left Goal Crease",
      center: { xFt: GOAL_LINE_LEFT, yFt: CENTER_Y },
      radiusFt: 6,
      startDeg: -90,
      endDeg: 90,
      lineWidthFt: 2 * INCH,
      color: "red",
      fill: "crease-blue",
      semanticRole: "goal-crease",
    },
    {
      id: "right-goal-crease",
      type: "arc",
      name: "Right Goal Crease",
      center: { xFt: GOAL_LINE_RIGHT, yFt: CENTER_Y },
      radiusFt: 6,
      startDeg: 90,
      endDeg: 270,
      lineWidthFt: 2 * INCH,
      color: "red",
      fill: "crease-blue",
      semanticRole: "goal-crease",
    },
  ],

  semanticZones: [
    {
      id: "left-defending-zone",
      type: "left-defending-zone",
      name: "Left Defending Zone",
      polygon: [
        { xFt: 0, yFt: 0 },
        { xFt: BLUE_LINE_LEFT, yFt: 0 },
        { xFt: BLUE_LINE_LEFT, yFt: WIDTH },
        { xFt: 0, yFt: WIDTH },
      ],
      color: "defending-zone",
      zMinFt: 0,
      zMaxFt: 12,
    },
    {
      id: "neutral-zone",
      type: "neutral-zone",
      name: "Neutral Zone",
      polygon: [
        { xFt: BLUE_LINE_LEFT, yFt: 0 },
        { xFt: BLUE_LINE_RIGHT, yFt: 0 },
        { xFt: BLUE_LINE_RIGHT, yFt: WIDTH },
        { xFt: BLUE_LINE_LEFT, yFt: WIDTH },
      ],
      color: "neutral-zone",
      zMinFt: 0,
      zMaxFt: 12,
    },
    {
      id: "right-defending-zone",
      type: "right-defending-zone",
      name: "Right Defending Zone",
      polygon: [
        { xFt: BLUE_LINE_RIGHT, yFt: 0 },
        { xFt: LENGTH, yFt: 0 },
        { xFt: LENGTH, yFt: WIDTH },
        { xFt: BLUE_LINE_RIGHT, yFt: WIDTH },
      ],
      color: "defending-zone",
      zMinFt: 0,
      zMaxFt: 12,
    },
    {
      id: "left-crease-zone",
      type: "crease",
      name: "Left Crease Zone",
      // 10-segment arc approximation of the semicircular crease (radius 6 ft,
      // -90° to 90°) anchored to the goal line, traversed in SVG clockwise order.
      polygon: [
        { xFt: GOAL_LINE_LEFT, yFt: CENTER_Y - 6 },
        { xFt: GOAL_LINE_LEFT + 1.85, yFt: CENTER_Y - 5.71 },
        { xFt: GOAL_LINE_LEFT + 3.53, yFt: CENTER_Y - 4.85 },
        { xFt: GOAL_LINE_LEFT + 4.85, yFt: CENTER_Y - 3.53 },
        { xFt: GOAL_LINE_LEFT + 5.71, yFt: CENTER_Y - 1.85 },
        { xFt: GOAL_LINE_LEFT + 6, yFt: CENTER_Y },
        { xFt: GOAL_LINE_LEFT + 5.71, yFt: CENTER_Y + 1.85 },
        { xFt: GOAL_LINE_LEFT + 4.85, yFt: CENTER_Y + 3.53 },
        { xFt: GOAL_LINE_LEFT + 3.53, yFt: CENTER_Y + 4.85 },
        { xFt: GOAL_LINE_LEFT + 1.85, yFt: CENTER_Y + 5.71 },
        { xFt: GOAL_LINE_LEFT, yFt: CENTER_Y + 6 },
      ],
      color: "crease-blue",
      zMinFt: 0,
      zMaxFt: 8,
    },
    {
      id: "right-crease-zone",
      type: "crease",
      name: "Right Crease Zone",
      // 10-segment arc approximation of the semicircular crease (radius 6 ft,
      // 90° to 270°) anchored to the goal line, traversed in SVG clockwise order.
      polygon: [
        { xFt: GOAL_LINE_RIGHT, yFt: CENTER_Y + 6 },
        { xFt: GOAL_LINE_RIGHT - 1.85, yFt: CENTER_Y + 5.71 },
        { xFt: GOAL_LINE_RIGHT - 3.53, yFt: CENTER_Y + 4.85 },
        { xFt: GOAL_LINE_RIGHT - 4.85, yFt: CENTER_Y + 3.53 },
        { xFt: GOAL_LINE_RIGHT - 5.71, yFt: CENTER_Y + 1.85 },
        { xFt: GOAL_LINE_RIGHT - 6, yFt: CENTER_Y },
        { xFt: GOAL_LINE_RIGHT - 5.71, yFt: CENTER_Y - 1.85 },
        { xFt: GOAL_LINE_RIGHT - 4.85, yFt: CENTER_Y - 3.53 },
        { xFt: GOAL_LINE_RIGHT - 3.53, yFt: CENTER_Y - 4.85 },
        { xFt: GOAL_LINE_RIGHT - 1.85, yFt: CENTER_Y - 5.71 },
        { xFt: GOAL_LINE_RIGHT, yFt: CENTER_Y - 6 },
      ],
      color: "crease-blue",
      zMinFt: 0,
      zMaxFt: 8,
    },

    // --- LEFT END sub-zones ---
    {
      id: "behind-net-left",
      type: "behind-net",
      name: "Left Behind Net",
      polygon: [
        { xFt: 0, yFt: 30 },
        { xFt: GOAL_LINE_LEFT, yFt: 30 },
        { xFt: GOAL_LINE_LEFT, yFt: 55 },
        { xFt: 0, yFt: 55 },
      ],
    },
    {
      id: "low-slot-left",
      type: "low-slot",
      name: "Left Low Slot",
      polygon: [
        { xFt: GOAL_LINE_LEFT, yFt: 30 },
        { xFt: 40, yFt: 30 },
        { xFt: 40, yFt: 55 },
        { xFt: GOAL_LINE_LEFT, yFt: 55 },
      ],
    },
    {
      id: "high-slot-left",
      type: "high-slot",
      name: "Left High Slot",
      polygon: [
        { xFt: 40, yFt: 30 },
        { xFt: BLUE_LINE_LEFT, yFt: 30 },
        { xFt: BLUE_LINE_LEFT, yFt: 55 },
        { xFt: 40, yFt: 55 },
      ],
    },
    {
      id: "left-corner-top",
      type: "left-corner",
      name: "Left Corner Top",
      polygon: [
        { xFt: 0, yFt: 0 },
        { xFt: 40, yFt: 0 },
        { xFt: 40, yFt: FACE_OFF_Y_TOP },
        { xFt: 0, yFt: FACE_OFF_Y_TOP },
      ],
    },
    {
      id: "left-corner-bottom",
      type: "left-corner",
      name: "Left Corner Bottom",
      polygon: [
        { xFt: 0, yFt: FACE_OFF_Y_BOTTOM },
        { xFt: 40, yFt: FACE_OFF_Y_BOTTOM },
        { xFt: 40, yFt: WIDTH },
        { xFt: 0, yFt: WIDTH },
      ],
    },
    {
      id: "half-wall-top-left",
      type: "half-wall",
      name: "Left Half Wall Top",
      polygon: [
        { xFt: 20, yFt: 0 },
        { xFt: BLUE_LINE_LEFT, yFt: 0 },
        { xFt: BLUE_LINE_LEFT, yFt: FACE_OFF_Y_TOP },
        { xFt: 20, yFt: FACE_OFF_Y_TOP },
      ],
    },
    {
      id: "half-wall-bottom-left",
      type: "half-wall",
      name: "Left Half Wall Bottom",
      polygon: [
        { xFt: 20, yFt: FACE_OFF_Y_BOTTOM },
        { xFt: BLUE_LINE_LEFT, yFt: FACE_OFF_Y_BOTTOM },
        { xFt: BLUE_LINE_LEFT, yFt: WIDTH },
        { xFt: 20, yFt: WIDTH },
      ],
    },
    {
      id: "point-lane-top-left",
      type: "point-lane",
      name: "Left Point Lane Top",
      polygon: [
        { xFt: 60, yFt: 0 },
        { xFt: BLUE_LINE_LEFT, yFt: 0 },
        { xFt: BLUE_LINE_LEFT, yFt: 30 },
        { xFt: 60, yFt: 30 },
      ],
    },
    {
      id: "point-lane-bottom-left",
      type: "point-lane",
      name: "Left Point Lane Bottom",
      polygon: [
        { xFt: 60, yFt: 55 },
        { xFt: BLUE_LINE_LEFT, yFt: 55 },
        { xFt: BLUE_LINE_LEFT, yFt: WIDTH },
        { xFt: 60, yFt: WIDTH },
      ],
    },

    // --- RIGHT END sub-zones (mirrored) ---
    {
      id: "behind-net-right",
      type: "behind-net",
      name: "Right Behind Net",
      polygon: [
        { xFt: GOAL_LINE_RIGHT, yFt: 30 },
        { xFt: LENGTH, yFt: 30 },
        { xFt: LENGTH, yFt: 55 },
        { xFt: GOAL_LINE_RIGHT, yFt: 55 },
      ],
    },
    {
      id: "low-slot-right",
      type: "low-slot",
      name: "Right Low Slot",
      polygon: [
        { xFt: LENGTH - 40, yFt: 30 },
        { xFt: GOAL_LINE_RIGHT, yFt: 30 },
        { xFt: GOAL_LINE_RIGHT, yFt: 55 },
        { xFt: LENGTH - 40, yFt: 55 },
      ],
    },
    {
      id: "high-slot-right",
      type: "high-slot",
      name: "Right High Slot",
      polygon: [
        { xFt: BLUE_LINE_RIGHT, yFt: 30 },
        { xFt: LENGTH - 40, yFt: 30 },
        { xFt: LENGTH - 40, yFt: 55 },
        { xFt: BLUE_LINE_RIGHT, yFt: 55 },
      ],
    },
    {
      id: "right-corner-top",
      type: "right-corner",
      name: "Right Corner Top",
      polygon: [
        { xFt: LENGTH - 40, yFt: 0 },
        { xFt: LENGTH, yFt: 0 },
        { xFt: LENGTH, yFt: FACE_OFF_Y_TOP },
        { xFt: LENGTH - 40, yFt: FACE_OFF_Y_TOP },
      ],
    },
    {
      id: "right-corner-bottom",
      type: "right-corner",
      name: "Right Corner Bottom",
      polygon: [
        { xFt: LENGTH - 40, yFt: FACE_OFF_Y_BOTTOM },
        { xFt: LENGTH, yFt: FACE_OFF_Y_BOTTOM },
        { xFt: LENGTH, yFt: WIDTH },
        { xFt: LENGTH - 40, yFt: WIDTH },
      ],
    },
    {
      id: "half-wall-top-right",
      type: "half-wall",
      name: "Right Half Wall Top",
      polygon: [
        { xFt: BLUE_LINE_RIGHT, yFt: 0 },
        { xFt: LENGTH - 20, yFt: 0 },
        { xFt: LENGTH - 20, yFt: FACE_OFF_Y_TOP },
        { xFt: BLUE_LINE_RIGHT, yFt: FACE_OFF_Y_TOP },
      ],
    },
    {
      id: "half-wall-bottom-right",
      type: "half-wall",
      name: "Right Half Wall Bottom",
      polygon: [
        { xFt: BLUE_LINE_RIGHT, yFt: FACE_OFF_Y_BOTTOM },
        { xFt: LENGTH - 20, yFt: FACE_OFF_Y_BOTTOM },
        { xFt: LENGTH - 20, yFt: WIDTH },
        { xFt: BLUE_LINE_RIGHT, yFt: WIDTH },
      ],
    },
    {
      id: "point-lane-top-right",
      type: "point-lane",
      name: "Right Point Lane Top",
      polygon: [
        { xFt: BLUE_LINE_RIGHT, yFt: 0 },
        { xFt: LENGTH - 60, yFt: 0 },
        { xFt: LENGTH - 60, yFt: 30 },
        { xFt: BLUE_LINE_RIGHT, yFt: 30 },
      ],
    },
    {
      id: "point-lane-bottom-right",
      type: "point-lane",
      name: "Right Point Lane Bottom",
      polygon: [
        { xFt: BLUE_LINE_RIGHT, yFt: 55 },
        { xFt: LENGTH - 60, yFt: 55 },
        { xFt: LENGTH - 60, yFt: WIDTH },
        { xFt: BLUE_LINE_RIGHT, yFt: WIDTH },
      ],
    },

    // --- DOOR THRESHOLD zones ---
    {
      id: "door-home-bench-left",
      type: "door-threshold",
      name: "Home Bench Left Door Threshold",
      polygon: [
        { xFt: 53, yFt: 0 },
        { xFt: 57, yFt: 0 },
        { xFt: 57, yFt: 3 },
        { xFt: 53, yFt: 3 },
      ],
    },
    {
      id: "door-home-bench-right",
      type: "door-threshold",
      name: "Home Bench Right Door Threshold",
      polygon: [
        { xFt: 78, yFt: 0 },
        { xFt: 82, yFt: 0 },
        { xFt: 82, yFt: 3 },
        { xFt: 78, yFt: 3 },
      ],
    },
    {
      id: "door-away-bench-left",
      type: "door-threshold",
      name: "Away Bench Left Door Threshold",
      polygon: [
        { xFt: 118, yFt: 0 },
        { xFt: 122, yFt: 0 },
        { xFt: 122, yFt: 3 },
        { xFt: 118, yFt: 3 },
      ],
    },
    {
      id: "door-away-bench-right",
      type: "door-threshold",
      name: "Away Bench Right Door Threshold",
      polygon: [
        { xFt: 143, yFt: 0 },
        { xFt: 147, yFt: 0 },
        { xFt: 147, yFt: 3 },
        { xFt: 143, yFt: 3 },
      ],
    },
    {
      id: "door-home-penalty-box",
      type: "door-threshold",
      name: "Home Penalty Box Door Threshold",
      polygon: [
        { xFt: 82, yFt: 82 },
        { xFt: 86, yFt: 82 },
        { xFt: 86, yFt: WIDTH },
        { xFt: 82, yFt: WIDTH },
      ],
    },
    {
      id: "door-away-penalty-box",
      type: "door-threshold",
      name: "Away Penalty Box Door Threshold",
      polygon: [
        { xFt: 114, yFt: 82 },
        { xFt: 118, yFt: 82 },
        { xFt: 118, yFt: WIDTH },
        { xFt: 114, yFt: WIDTH },
      ],
    },
  ],

  benches: [
    {
      id: "home-bench",
      teamRole: "home",
      side: "top",
      // Default bench spans from roughly the middle of the neutral zone
      // outward. Adjust x/y/width/depth for specific venues.
      xFt: 45,
      yFt: -8,
      widthFt: 45,
      depthFt: 8,
      doors: ["home-bench-door-left", "home-bench-door-right"],
    },
    {
      id: "away-bench",
      teamRole: "away",
      side: "top",
      xFt: 110,
      yFt: -8,
      widthFt: 45,
      depthFt: 8,
      doors: ["away-bench-door-left", "away-bench-door-right"],
    },
  ],

  penaltyBoxes: [
    {
      id: "home-penalty-box",
      teamRole: "home",
      side: "bottom",
      xFt: BLUE_LINE_LEFT,
      yFt: WIDTH,
      widthFt: 18,
      depthFt: 8,
      doors: ["home-penalty-box-door"],
    },
    {
      id: "away-penalty-box",
      teamRole: "away",
      side: "bottom",
      xFt: BLUE_LINE_RIGHT - 18,
      yFt: WIDTH,
      widthFt: 18,
      depthFt: 8,
      doors: ["away-penalty-box-door"],
    },
  ],

  doors: [
    {
      id: "home-bench-door-left",
      type: "home-bench",
      name: "Home Bench Left Door",
      side: "top",
      center: { xFt: 55, yFt: 0 },
      widthFt: 4,
      swingDirection: "inward",
      connects: {
        fromZoneId: "home-bench",
        toZoneId: "neutral-zone",
      },
    },
    {
      id: "home-bench-door-right",
      type: "home-bench",
      name: "Home Bench Right Door",
      side: "top",
      center: { xFt: 80, yFt: 0 },
      widthFt: 4,
      swingDirection: "inward",
      connects: {
        fromZoneId: "home-bench",
        toZoneId: "neutral-zone",
      },
    },
    {
      id: "away-bench-door-left",
      type: "away-bench",
      name: "Away Bench Left Door",
      side: "top",
      center: { xFt: 120, yFt: 0 },
      widthFt: 4,
      swingDirection: "inward",
      connects: {
        fromZoneId: "away-bench",
        toZoneId: "neutral-zone",
      },
    },
    {
      id: "away-bench-door-right",
      type: "away-bench",
      name: "Away Bench Right Door",
      side: "top",
      center: { xFt: 145, yFt: 0 },
      widthFt: 4,
      swingDirection: "inward",
      connects: {
        fromZoneId: "away-bench",
        toZoneId: "neutral-zone",
      },
    },
    {
      id: "home-penalty-box-door",
      type: "home-penalty-box",
      name: "Home Penalty Box Door",
      side: "bottom",
      center: { xFt: BLUE_LINE_LEFT + 9, yFt: WIDTH },
      widthFt: 4,
      swingDirection: "inward",
      connects: {
        fromZoneId: "home-penalty-box",
        toZoneId: "neutral-zone",
      },
    },
    {
      id: "away-penalty-box-door",
      type: "away-penalty-box",
      name: "Away Penalty Box Door",
      side: "bottom",
      center: { xFt: BLUE_LINE_RIGHT - 9, yFt: WIDTH },
      widthFt: 4,
      swingDirection: "inward",
      connects: {
        fromZoneId: "away-penalty-box",
        toZoneId: "neutral-zone",
      },
    },
  ],

  metadata: {
    source: "Hockey Canada Part I Technical Rules",
    notes:
      "Bench, penalty box and door dimensions are configurable defaults and should be overridden per facility when exact venue data is available.",
  },

  // Default MCP handles placed at the four corners of the rink. These
  // points can be used in editing tools to adjust the rink surface.
  mcpHandles: [
    { xFt: 0, yFt: 0 },
    { xFt: LENGTH, yFt: 0 },
    { xFt: LENGTH, yFt: WIDTH },
    { xFt: 0, yFt: WIDTH },
  ],
}