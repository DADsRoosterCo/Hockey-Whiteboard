# AI Coding Roadmap for the Hockey Rink Engine

This document outlines the architecture, domain model, utilities and settings for the Hockey Rink Engine.  It serves as the **single source of truth** for how the rink should be represented, rendered and configured.  Use this roadmap to prevent drift between files, avoid duplicated functionality and ensure consistent behaviour across versions.

## 1 Project Overview

The engine represents a **regulation hockey rink** as structured data rather than as a static SVG drawing.  The primary goals are:

* Provide a dimensionally‑accurate representation of the rink based on governing‑body rules.
* Expose a rich domain model for lines, circles, spots, zones, benches, penalty boxes and doors.
* Allow runtime logic (e.g. path timing, event derivation, analytics) to operate on the semantic model rather than on low‑level SVG coordinates.
* Enable configuration of visibility, line thickness, grid snapping and center‑ice logos through a unified settings interface.
* Ensure that future work (physics engines, AI event detection, drill imports) remains decoupled from rendering logic and geometry definitions.

To achieve these goals, the code base is organised into three main layers:

| Layer            | Responsibility                                                                                              |
|------------------|--------------------------------------------------------------------------------------------------------------|
| **Domain model** | Defines strong TypeScript types (`RinkSpec`, `RinkMarking`, `SemanticZone`, `BenchArea`, etc.) and holds the official rink specification (`hockeyCanadaRinkSpec.ts`). |
| **Geometry utils** | Provides pure functions to convert between rink units and SVG coordinates, create paths for arcs and rounded rectangles, perform hit‑testing and snapping, and lookup zones. |
| **Renderer**     | Implements `RinkCanvas.tsx`, a React component that converts the structured model into an interactive SVG.  It respects settings (grid, line thickness, semantic zones, benches, penalty boxes, doors, MCP handles, center logo) and uses geometry utilities to compute shapes. |

## 2 Domain Model

The **`rinkTypes.ts`** file defines the TypeScript types for all objects used by the engine.  Key interfaces include:

### 2.1 Units and Coordinates

* `Feet`, `Seconds`, `Degrees` – base units used throughout the model.
* `RinkPoint2D`, `RinkPoint3D` – 2D and 3D points measured from the left end board (`xFt`) and top side board (`yFt`), with optional height (`zFt`).

### 2.2 Markings

Markings describe all painted elements on the ice:

* **`RinkLineMarking`** – Vertical or horizontal lines such as the goal lines, blue lines, centre red line and hash marks.  Properties include `from`, `to`, `widthFt`, `color` and a semantic role.
* **`RinkCircleMarking`** – Circles such as the centre faceoff circle and end‑zone circles, with `center`, `radiusFt` and `lineWidthFt`.
* **`RinkSpotMarking`** – Spots for faceoff dots, defined by a `center` and `radiusFt`.
* **`RinkArcMarking`** – Arcs for goal creases, defined by a centre point, radius and start/end angles.
* **`RinkRectMarking`** – Rectangles used for benches, penalty boxes, doors and other rectangular features; include optional fill and line colors.

All of these types are discriminated unions collected into the union type `RinkMarking`.

### 2.3 Zones

Zones provide **semantic meaning** to different areas of the ice.  They are defined in `hockeyCanadaRinkSpec.ts` as `SemanticZone` objects with an `id`, `type`, `name`, a polygon (list of points) and optional height range.  Common zone types include:

* Defending and attacking zones (`left-defending-zone`, `right-defending-zone`)
* Neutral zone
* Goal creases (`left-crease-zone`, `right-crease-zone`)
* Specialized regions (low slot, high slot, corners, half wall, point lanes)
* Bench areas, penalty boxes and off‑ice areas

Zones are used by the runtime to derive events (e.g. zone entry, regroup) and to limit movement (e.g. players must enter and exit via a door zone when changing lines).

### 2.4 Benches, Penalty Boxes and Doors

* **`BenchArea`** – Represents the home and away benches.  Each bench has a `teamRole`, a `side` (`top` or `bottom`), `xFt`, `yFt`, `widthFt`, `depthFt` and a list of door IDs.
* **`PenaltyBoxArea`** – Similar to benches but used for penalty boxes.
* **`RinkDoor`** – Represents a door between zones.  Each door has an `id`, `type`, a `side`, a centre point, a `widthFt`, an optional swing direction and a `connects` object linking a bench or box to an on‑ice zone.

These structures allow the editor to place doors and boxes accurately relative to the playing surface and to enforce movement constraints.

### 2.5 Rink Specification

The **`RinkSpec`** type collects all of the above data into a single object.  Fields include:

* `surface`: dimensions of the rink (length, width, corner radius, board height, glass height)
* `defaults`: default line widths and grid size for unspecified markings
* `markings`: list of `RinkMarking` objects for all lines, circles, spots and arcs
* `semanticZones`: list of `SemanticZone` objects
* `benches` and `penaltyBoxes`: lists of `BenchArea` and `PenaltyBoxArea` objects
* `doors`: list of `RinkDoor` objects
* `metadata`: additional notes and version information

The canonical specification is defined in **`hockeyCanadaRinkSpec.ts`**, using the units and rules described in the Hockey Canada technical documents.

## 3 Geometry Utilities

Pure functions in **`rinkGeometry.ts`** implement geometry calculations and coordinate conversions.  Key utilities include:

* `getRinkViewBox(spec, paddingFt)` – Returns an SVG viewBox string based on rink dimensions and optional padding.
* `rinkPointToSvgPoint(point)` – Converts a `RinkPoint2D` into an SVG coordinate (feet to pixels are 1:1 in the viewBox space).
* `snapPointToGrid(point, gridSizeFt)` – Returns a new `RinkPoint2D` snapped to the nearest grid intersection.
* `isPointInsidePolygon(point, polygon)` – Determines whether a point lies inside a polygon; used for zone detection.
* `getContainingSemanticZones(spec, point)` – Returns all zones that contain a given point.
* `roundedRinkPath(spec)` – Creates an SVG path describing the outer perimeter of the rink with corner radius.
* `arcPath(center, radiusFt, startDeg, endDeg)` – Returns an SVG path string for a circular arc.

These functions are pure and stateless; they must not read or write to React state or DOM.  Geometry helpers live separately to avoid duplication and ensure consistent calculations across the application.

## 3.1 Runtime Modules

The new `runtime` folder introduces modules that capture movement logic, speed tables, path measurements, event derivation and serialization. These modules operate purely on feet‑based coordinates and time values and have no dependencies on React or SVG. The key modules are:

| Module | Purpose |
|---|---|
| `runtime/motionProfiles.ts` | Defines skating, passing and shooting speed tables by age and exposes helpers to compute travel distance and duration given a motion kind, age and speed modifier. |
| `runtime/pathMetrics.ts` | Provides utilities to measure polyline lengths in feet, build cumulative segment metrics and convert between normalized progress (0–1) and physical distance. |
| `runtime/eventDerivation.ts` | Contains placeholder logic for deriving high‑level events (zone entries/exits, regroups, passes and shots) from movement paths and zone definitions. |
| `runtime/serialization.ts` | Houses the serialization contracts for drills, paths and derived events. Centralising persistence logic in one place enables future version migrations and prevents ad‑hoc JSON structures. |

These modules embody the **runtime layer** of the architecture. They convert domain data (paths, zones, timing) into actionable analytics without knowledge of how the data will be rendered or edited. Future work will expand these modules with physics, timelines and AI event detection.

## 4 Renderer

The **`RinkCanvas.tsx`** component uses the domain model and geometry utilities to draw the rink.  Important responsibilities:

* Accept a `RinkSpec` and optional partial `RinkSettings` to customise the appearance.  These settings include line thickness scaling, grid display, zone overlays, bench and penalty box visibility, door rendering, MCP handles and a centre‑ice logo.
* Render the outer rink boundary using `roundedRinkPath` and clip subsequent layers to it.
* Draw the grid, lines, circles, spots, arcs, benches, boxes, doors and optionally semantic zones.  Each marking uses its width specified in feet scaled into the viewBox coordinate system.
* Support an optional `centerLogoSrc` and `centerLogoSizeFt` setting.  When provided, `RinkCanvas` renders an `<image>` element at the centre of the rink with the given size.  If no logo is provided, nothing is displayed at centre ice.
* Provide event callbacks (e.g. `onRinkPointClick`) that return points in rink feet; these points are then converted to semantic zones using `getContainingSemanticZones`.

The renderer has no knowledge of players, pucks or animations; those concerns belong to other modules.

## 5 Settings

Settings control how the rink is rendered without changing the underlying specification.  They include:

* `lineThicknessScale` – A multiplier applied to all line widths; default is 1.  This allows users to adjust thickness for large/small screens.
* `showGrid`, `gridSizeFt` – Toggles the 1‑ft grid and sets its spacing.
* `showSemanticZones` – When true, overlays zone polygons with translucent colours for debugging or analytics.
* `showBenches`, `showPenaltyBoxes`, `showDoors` – Control the visibility of benches, penalty boxes and doors.
* `showDebugLabels` – When true, displays IDs and names on rink elements; useful for development.
* `showMcpHandles` – Toggles the MCP corner handles used for resizing the rink container or performing transforms.  Handles are defined as small draggable nodes at the corners of the rink.
* `centerLogoSrc`, `centerLogoSizeFt` – URL or imported asset and physical size for a logo displayed at centre ice; if null, no logo is shown.

Settings are passed as a prop to `RinkCanvas` and should not be stored globally.  The object definition for settings lives in `rinkTypes.ts`.

## 6 Anti‑Drift Rules

1. **RinkSpec is the authority.**  Never hard‑code geometry values in components; always read from the current `RinkSpec`.  When adding new markings or zones, update the spec file and domain types.
2. **Isolate concerns.**  Keep geometry utilities pure and separate from React.  Keep rendering code free of business logic.  Keep event/physics logic free of direct SVG manipulation.
3. **Version everything.**  The specification includes a `version` string.  When changing the model shape (e.g. adding new zone types or markings) increment the version and implement migration logic.
4. **No implicit invariants.**  Enforce all invariants in code (e.g. exactly two goal lines, four end‑zone faceoff spots) rather than relying on developer memory.  Use type discriminants and semantic roles to validate new objects.
5. **Unified units.**  Use feet for all geometry.  Do not mix pixels, percentages or arbitrary units in the domain model.
6. **Separation of runtime state.**  Player positions, puck paths, timing data and event derivations belong in other modules.  They must not contaminate `RinkSpec` or mark metadata.

## 7 Phased Roadmap

This roadmap emphasises building the rink foundation first, then layering complexity:

1. **Phase 1 – Geometry and Rendering:**
   * Define domain types and specification (`RinkSpec` and related types).
   * Implement geometry utilities (viewBox, snapping, path creation, zone detection).
   * Build `RinkCanvas` to render the specification as an SVG, respecting settings and line thickness scaling.
   * Add MCP handles and settings controls.
   * Add optional centre logo support.

2. **Phase 2 – Movement Engine:**
   * Introduce path nodes with time stamps and speed profiles.  Derive maximum node spacing from an age‑speed table in settings.
   * Validate paths based on allowed speeds; automatically insert intermediate nodes when distances exceed permissible speeds.
   * Provide editing controls for adding, moving and removing nodes.

3. **Phase 3 – Event Derivation:**
   * Use zone crossings and path actions to derive events such as zone entries, regroups, passes and shots.
   * Represent derived events with types that reference actors, time ranges and confidence values.
   * Offer a plugin framework for adding more sophisticated event rules.

4. **Phase 4 – Embeddable Package:**
   * Package the editor as a React component and an embeddable script for use on other websites.
   * Provide an API for loading and saving drills in structured JSON format.

5. **Phase 5 – Import/Export & AI:**
   * Support import of drills defined with the same legend (e.g. via JSON or SVG) and export to common formats.
   * Add AI‑powered suggestions, classification and analytics using the semantic zone data.

Following this roadmap will ensure a clean separation of concerns, facilitate collaboration and enable future enhancements without breaking existing functionality.