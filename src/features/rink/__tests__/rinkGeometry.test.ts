import { describe, it, expect } from "vitest"
import { hockeyCanadaRinkSpec } from "../hockeyCanadaRinkSpec"
import { getContainingSemanticZones, roundedRinkPath, arcPath } from "../rinkGeometry"
import type { RinkArcMarking, RinkLineMarking } from "../rinkTypes"

describe("hockeyCanadaRinkSpec geometry", () => {
  it("places goal lines at 11 ft and 189 ft", () => {
    const goalLines = hockeyCanadaRinkSpec.markings.filter(
      (m): m is RinkLineMarking => m.type === "line" && m.semanticRole === "goal-line",
    )
    const positions = goalLines.map((gl) => gl.xFt)
    expect(positions).toStrictEqual([11, 189])
  })

  it("places blue lines at 75 ft and 125 ft", () => {
    const blueLines = hockeyCanadaRinkSpec.markings.filter(
      (m): m is RinkLineMarking => m.type === "line" && m.semanticRole === "blue-line",
    )
    const positions = blueLines.map((bl) => bl.xFt)
    expect(positions).toStrictEqual([75, 125])
  })

  it("maps centre point to neutral zone", () => {
    const zones = getContainingSemanticZones(hockeyCanadaRinkSpec, { xFt: 100, yFt: 42.5 })
    expect(zones.map((z) => z.type)).toContain("neutral-zone")
  })

  it("maps point left of blue line to left defending zone", () => {
    const zones = getContainingSemanticZones(hockeyCanadaRinkSpec, { xFt: 40, yFt: 42.5 })
    expect(zones.map((z) => z.type)).toContain("left-defending-zone")
  })

  it("creates a rounded rink path that starts at the top-left curve", () => {
    const path = roundedRinkPath(hockeyCanadaRinkSpec)
    // Path should begin with an 'M r 0' command, where r is corner radius (28)
    expect(path.startsWith("M 28 0")).toBe(true)
  })

  it("produces a valid arc path for the goal crease", () => {
    const crease = hockeyCanadaRinkSpec.markings.find(
      (m): m is RinkArcMarking => m.type === "arc",
    )
    expect(crease).toBeDefined()
    if (!crease) {
      throw new Error("Expected the rink spec to include a goal crease arc")
    }
    const d = arcPath(crease.center, crease.radiusFt, crease.startDeg, crease.endDeg)
    expect(d.includes("A")).toBe(true)
    expect(d.includes(String(crease.radiusFt))).toBe(true)
  })
})