// Types defining the structure of a regulation hockey rink and its associated
// markings, zones, benches, doors, and settings. All units are in feet
// unless otherwise noted. These types form the backbone of the V2 rink
// engine and should not be coupled to any particular rendering layer.

export type Feet = number
export type Seconds = number
export type Degrees = number

// A 2D point on the rink in feet from the left and top boards.
export type RinkPoint2D = {
  xFt: Feet
  yFt: Feet
}

// A 3D point on the rink. zFt is optional and represents height above the ice.
export type RinkPoint3D = {
  xFt: Feet
  yFt: Feet
  zFt?: Feet
}

// The four sides of the rink used to describe benches, doors, etc.
export type RinkSide = "top" | "bottom" | "left" | "right"

// Basic colour tokens for markings and zones. Additional colours may be
// referenced directly as hex strings when rendering.
export type RinkColor =
  | "red"
  | "blue"
  | "white"
  | "black"
  | "crease-blue"
  | "neutral-zone"
  | "defending-zone"
  | "attacking-zone"

// Physical characteristics of the rink surface. The corner radius is the
// distance from the straight boards to the start of the rounded corners.
export type RinkSurfaceSpec = {
  lengthFt: Feet
  widthFt: Feet
  cornerRadiusFt: Feet
  boardHeightFt?: Feet
  glassHeightFt?: Feet
}

// A straight painted line on the rink. Lines may be vertical or horizontal.
export type RinkLineMarking = {
  id: string
  type: "line"
  name: string
  orientation: "vertical" | "horizontal"
  // The x or y position of the line when orientation is specified. These are
  // redundant with `from`/`to` but provide convenience when reading specs.
  xFt?: Feet
  yFt?: Feet
  from: RinkPoint2D
  to: RinkPoint2D
  widthFt: Feet
  color: RinkColor
  // Whether the line extends up the boards as a visual cue. This is used
  // for lines like the blue line and centre red line.
  extendsUpBoards?: boolean
  semanticRole?:
    | "goal-line"
    | "blue-line"
    | "centre-red-line"
    | "hash-mark"
    | "restraining-line"
}

// A circular marking such as a faceoff circle. The line width is the stroke
// thickness of the circle.
export type RinkCircleMarking = {
  id: string
  type: "circle"
  name: string
  center: RinkPoint2D
  radiusFt: Feet
  lineWidthFt: Feet
  color: RinkColor
  semanticRole?:
    | "centre-faceoff-circle"
    | "end-zone-faceoff-circle"
}

// A spot marking, typically used for faceoff spots. The radius is the
// painted spot radius.
export type RinkSpotMarking = {
  id: string
  type: "spot"
  name: string
  center: RinkPoint2D
  radiusFt: Feet
  color: RinkColor
  semanticRole?:
    | "centre-faceoff-spot"
    | "neutral-zone-faceoff-spot"
    | "end-zone-faceoff-spot"
}

// An arc marking, such as the semicircular goal creases. startDeg and
// endDeg define the arc in degrees (0° points right, 90° up). lineWidthFt
// defines the thickness of the arc stroke. fill is optional for filled arcs.
export type RinkArcMarking = {
  id: string
  type: "arc"
  name: string
  center: RinkPoint2D
  radiusFt: Feet
  startDeg: Degrees
  endDeg: Degrees
  lineWidthFt: Feet
  color: RinkColor
  fill?: RinkColor
  semanticRole?: "goal-crease"
}

// A rectangular marking, used for benches, penalty boxes, doors and other
// rectangular areas. fill and stroke are optional. When used for doors,
// the heightFt should represent the door thickness (painted line) rather
// than actual board height.
export type RinkRectMarking = {
  id: string
  type: "rect"
  name: string
  xFt: Feet
  yFt: Feet
  widthFt: Feet
  heightFt: Feet
  lineWidthFt?: Feet
  color?: RinkColor
  fill?: RinkColor
  semanticRole?:
    | "bench"
    | "penalty-box"
    | "scorekeeper-box"
    | "door"
    | "goal-frame"
}

// Union of all painted markings.
export type RinkMarking =
  | RinkLineMarking
  | RinkCircleMarking
  | RinkSpotMarking
  | RinkArcMarking
  | RinkRectMarking

// Enumeration of semantic zone identifiers. These represent contextual
// regions on the ice used for analytics and event derivation.
export type SemanticZoneType =
  | "left-defending-zone"
  | "right-defending-zone"
  | "neutral-zone"
  | "left-attacking-zone"
  | "right-attacking-zone"
  | "left-end-zone"
  | "right-end-zone"
  | "left-corner"
  | "right-corner"
  | "low-slot"
  | "high-slot"
  | "crease"
  | "behind-net"
  | "half-wall"
  | "point-lane"
  | "bench-area"
  | "penalty-box-area"
  | "off-ice-area"
  | "door-threshold"

// A polygonal region on the rink with an optional vertical extent (zMinFt,
// zMaxFt) for potential future use when modelling 3D interactions.
export type SemanticZone = {
  id: string
  type: SemanticZoneType
  name: string
  polygon: RinkPoint2D[]
  color?: RinkColor
  zMinFt?: Feet
  zMaxFt?: Feet
  metadata?: Record<string, unknown>
}

// Enumeration of door types. Doors connect zones (e.g. bench to ice) and
// may swing inward, outward or slide. Doors are important for line
// changes and bench transitions.
export type RinkDoorType =
  | "home-bench"
  | "away-bench"
  | "home-penalty-box"
  | "away-penalty-box"
  | "scorekeeper"
  | "zamboni"
  | "service"

export type RinkDoor = {
  id: string
  type: RinkDoorType
  name: string
  side: RinkSide
  center: RinkPoint2D
  widthFt: Feet
  swingDirection?: "inward" | "outward" | "sliding"
  connects: {
    fromZoneId: string
    toZoneId: string
  }
}

// A bench area for either the home or away team. Benches have doors
// referenced by ID for players to enter/exit the ice.
export type BenchArea = {
  id: string
  teamRole: "home" | "away"
  side: RinkSide
  xFt: Feet
  yFt: Feet
  widthFt: Feet
  depthFt: Feet
  doors: string[]
}

// A penalty box area for either the home or away team. Penalty boxes have
// doors for players to enter/exit.
export type PenaltyBoxArea = {
  id: string
  teamRole: "home" | "away"
  side: RinkSide
  xFt: Feet
  yFt: Feet
  widthFt: Feet
  depthFt: Feet
  doors: string[]
}

// User-configurable rendering settings. These control how the rink is
// displayed but do not affect the underlying geometry.
export type RinkSettings = {
  lineThicknessScale: number
  showGrid: boolean
  gridSizeFt: Feet
  showSemanticZones: boolean
  showBenches: boolean
  showPenaltyBoxes: boolean
  showDoors: boolean
  showDebugLabels: boolean

  /**
   * When true, MCP handles defined on the RinkSpec will be drawn as
   * draggable control points. These handles are intended for editor
   * functionality and are hidden by default.
   */
  showMcpHandles?: boolean

  /**
   * If provided, only markings whose IDs are included will be drawn.
   * When undefined, all markings are drawn.
   */
  visibleMarkingIds?: string[]

  /**
   * If provided, only semantic zones whose IDs are included will be
   * shaded when showSemanticZones is true. When undefined, all
   * semantic zones are shaded.
   */
  visibleZoneIds?: string[]

  /**
   * Optional overrides for benches. These arrays replace the benches
   * defined on the RinkSpec for rendering purposes. They do not
   * mutate the underlying spec.
   */
  benchOverrides?: BenchArea[]

  /**
   * Optional overrides for penalty boxes.
   */
  penaltyBoxOverrides?: PenaltyBoxArea[]

  /**
   * Optional overrides for doors.
   */
  doorOverrides?: RinkDoor[]

  /**
   * Optional image source for a logo placed at centre ice. This can be a
   * URL or data URI. When defined, RinkCanvas will render the image
   * centred on the rink. If undefined, no logo is drawn.
   */
  centerLogoSrc?: string

  /**
   * Size of the centre ice logo in feet. This controls both width and
   * height of the rendered logo. Defaults to 20 ft if not provided.
   */
  centerLogoSizeFt?: number
}

// The complete rink specification combining surface dimensions, defaults,
// markings, semantic zones, benches, penalty boxes, doors and metadata.
export type RinkSpec = {
  id: string
  name: string
  governingBody: "Hockey Canada"
  version: string
  units: "feet"

  surface: RinkSurfaceSpec

  defaults: {
    lineWidthFt: Feet
    majorLineWidthFt: Feet
    gridSizeFt: Feet
  }

  markings: RinkMarking[]
  semanticZones: SemanticZone[]
  doors: RinkDoor[]
  benches: BenchArea[]
  penaltyBoxes: PenaltyBoxArea[]

  /**
   * Optional control handles (MCP handles) around the rink surface.
   * These points are used in editors to manipulate the rink geometry.
   * They do not affect rendering of markings by default. If defined
   * they can be displayed when settings.showMcpHandles is true.
   */
  mcpHandles?: RinkPoint2D[]

  metadata: {
    source: string
    notes?: string
  }
}