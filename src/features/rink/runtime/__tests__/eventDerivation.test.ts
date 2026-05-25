import { describe, expect, it } from "vitest"
import { hockeyCanadaRinkSpec } from "../../hockeyCanadaRinkSpec"
import {
  deriveEventsForDrill,
  deriveEventsForPath,
  type DerivedPath,
  type TimedPathPoint,
} from "../eventDerivation"

describe("event derivation", () => {
  it("derives zone transitions using point timestamps", () => {
    const points: TimedPathPoint[] = [
      { xFt: 40, yFt: 42.5, timeSec: 0 },
      { xFt: 100, yFt: 42.5, timeSec: 2 },
      { xFt: 150, yFt: 42.5, timeSec: 4 },
    ]

    const events = deriveEventsForPath({
      timedPathPoints: points,
      pathId: "skater-1-path",
      actorId: "skater-1",
      zones: hockeyCanadaRinkSpec.semanticZones,
    })

    const entries = events.filter((event) => event.type === "zone-entry")

    // Assert the major zone transitions at the correct timestamps. Sub-zones
    // (e.g. high-slot-right) may also fire at the same time — check for the
    // presence of the expected zones rather than exact array equality so the
    // assertion stays valid as sub-zones are added to the spec.
    const neutralEntry = entries.find((e) => e.data?.zoneId === "neutral-zone")
    const rightDefEntry = entries.find((e) => e.data?.zoneId === "right-defending-zone")

    expect(neutralEntry).toBeDefined()
    expect(neutralEntry?.timeSec).toBe(2)
    expect(rightDefEntry).toBeDefined()
    expect(rightDefEntry?.timeSec).toBe(4)
  })

  it("detects regroup patterns when a path returns to the same major zone through neutral ice", () => {
    const events = deriveEventsForPath({
      timedPathPoints: [
        { xFt: 140, yFt: 42.5, timeSec: 0 },
        { xFt: 118, yFt: 42.5, timeSec: 1.5 },
        { xFt: 132, yFt: 42.5, timeSec: 3 },
      ],
      pathId: "skater-2-path",
      actorId: "skater-2",
      zones: hockeyCanadaRinkSpec.semanticZones,
    })

    const regroupEvent = events.find((event) => event.type === "regroup")
    expect(regroupEvent).toBeDefined()
    expect(regroupEvent?.timeSec).toBe(3)
    expect(regroupEvent?.data?.zoneId).toBe("right-defending-zone")
  })

  it("assigns unique ids to same-time zone transitions", () => {
    const events = deriveEventsForPath({
      timedPathPoints: [
        { xFt: 40, yFt: 42.5, timeSec: 0 },
        { xFt: 100, yFt: 42.5, timeSec: 2 },
      ],
      pathId: "home-forward-1-path",
      actorId: "home-forward-1",
      zones: hockeyCanadaRinkSpec.semanticZones,
    })

    const ids = events.map((event) => event.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it("matches pass and receive actions across actor paths", () => {
    const paths: DerivedPath[] = [
      {
        pathId: "passer-path",
        actorId: "passer",
        points: [
          { xFt: 100, yFt: 42.5, timeSec: 0 },
          { xFt: 108, yFt: 42.5, timeSec: 2, action: "pass" },
        ],
      },
      {
        pathId: "receiver-path",
        actorId: "receiver",
        points: [
          { xFt: 114, yFt: 42.5, timeSec: 0 },
          { xFt: 122, yFt: 42.5, timeSec: 3, action: "receive" },
          { xFt: 130, yFt: 42.5, timeSec: 4, action: "shot" },
        ],
      },
    ]

    const events = deriveEventsForDrill({
      paths,
      zones: hockeyCanadaRinkSpec.semanticZones,
    })

    const passEvent = events.find((event) => event.type === "pass")
    const possessionEvent = events.find((event) => event.type === "puck-possession-change")
    const shotEvent = events.find((event) => event.type === "shot")

    expect(passEvent?.actorIds).toEqual(["passer", "receiver"])
    expect(passEvent?.timeSec).toBe(2)
    expect(passEvent?.endTimeSec).toBe(3)
    expect(possessionEvent?.timeSec).toBe(3)
    expect(shotEvent?.timeSec).toBe(4)
  })
})