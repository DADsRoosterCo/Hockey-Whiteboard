import { describe, expect, it } from "vitest"
import {
  CURRENT_DRILL_SERIALIZATION_VERSION,
  deserializeDrill,
  serializeDrill,
  type SerializedDrillInput,
  type SerializedDrill,
} from "../serialization"

describe("drill serialization", () => {
  it("hydrates path metrics and normalizes the current serialization format", () => {
    const drill: SerializedDrill = {
      version: CURRENT_DRILL_SERIALIZATION_VERSION,
      metadata: {
        id: "drill-1",
        name: "Neutral zone pass",
        editorPreferences: {
          showCurvedPaths: true,
          curveIntensity: 0.7,
          actorCurveModes: {
            passer: true,
            receiver: false,
          },
        },
      },
      actors: [
        { id: "passer", name: "Passer", teamRole: "home" },
        { id: "receiver", name: "Receiver", teamRole: "home" },
      ],
      paths: [
        {
          id: "passer-path",
          actorId: "passer",
          points: [
            { xFt: 0, yFt: 0, timeSec: 0 },
            { xFt: 3, yFt: 4, timeSec: 1, action: "pass" },
          ],
        },
      ],
      annotations: [
        {
          id: "cone-1",
          type: "cone",
          xFt: 42,
          yFt: 18,
        },
        {
          id: "text-1",
          type: "text",
          label: "Regroup",
          xFt: 80,
          yFt: 24,
        },
      ],
      derivedEvents: [],
      drawLines: [],
    }

    const serialized = serializeDrill(drill)

    expect(serialized.version).toBe(CURRENT_DRILL_SERIALIZATION_VERSION)
    expect(serialized.paths[0].metrics?.totalFootLength).toBeCloseTo(5, 1)
    expect(serialized.paths[0].points.some((pt) => pt.action === "pass")).toBe(true)
    expect(serialized.metadata.editorPreferences?.curveIntensity).toBe(0.7)
    expect(serialized.metadata.editorPreferences?.actorCurveModes?.receiver).toBe(false)
    expect(serialized.annotations).toHaveLength(2)
    expect(serialized.annotations[1].label).toBe("Regroup")
  })

  it("rejects legacy drill payloads", () => {
    expect(() => deserializeDrill({
      version: "0.1.0",
      paths: [
        {
          id: "legacy-path",
          points: [
            { xFt: 10, yFt: 10 },
            { xFt: 13, yFt: 14 },
          ],
        },
      ],
      derivedEvents: [
        {
          type: "zone-entry",
          timeSec: 1,
        },
      ],
    })).toThrow("current format")
  })

  it("rejects previous-version drill payloads", () => {
    expect(() => deserializeDrill({
      version: "1.1.0",
      metadata: {
        id: "drill-2",
        name: "With annotations",
      },
      actors: [{ id: "skater-1", name: "Skater 1" }],
      paths: [{ id: "path-1", actorId: "skater-1", points: [] }],
      annotations: [
        { id: "puck-1", type: "puck", xFt: 20, yFt: 20 },
        { id: "note-1", type: "text", xFt: 30, yFt: 30, label: "Delay" },
      ],
      derivedEvents: [],
    })).toThrow("is not supported")
  })

  it("preserves optional annotations from current payloads", () => {
    const migrated = deserializeDrill({
      version: CURRENT_DRILL_SERIALIZATION_VERSION,
      metadata: {
        id: "drill-2",
        name: "With annotations",
      },
      actors: [{ id: "skater-1", name: "Skater 1" }],
      paths: [{ id: "path-1", actorId: "skater-1", points: [] }],
      annotations: [
        { id: "puck-1", type: "puck", xFt: 20, yFt: 20 },
        { id: "note-1", type: "text", xFt: 30, yFt: 30, label: "Delay" },
      ],
      derivedEvents: [],
    })

    expect(migrated.annotations.map((annotation) => annotation.type)).toEqual(["puck", "text"])
    expect(migrated.annotations[1].label).toBe("Delay")
  })

  it("projects actor-owned routes back into compatible runtime paths", () => {
    const drill: SerializedDrillInput = {
      version: CURRENT_DRILL_SERIALIZATION_VERSION,
      metadata: {
        id: "drill-3",
        name: "Actor owned route",
      },
      actors: [{ id: "carrier", name: "Carrier", teamRole: "home" }],
      actorRoutes: [
        {
          id: "carrier-route",
          actorId: "carrier",
          teamRole: "home",
          nodes: [
            { xFt: 10, yFt: 10, timeSec: 0, nodeType: "hard" },
            { xFt: 13, yFt: 14, timeSec: 1, action: "pass" },
          ],
          bezierNodes: [
            { xFt: 10, yFt: 10, nodeType: "hard" },
            { xFt: 13, yFt: 14, cp1Ft: { xFt: 11, yFt: 12 }, cp2Ft: { xFt: 12, yFt: 13 } },
          ],
          style: {
            curved: true,
            curveIntensity: 0.65,
            lineStyle: "solid",
          },
        },
      ],
      derivedEvents: [],
    }

    const serialized = serializeDrill(drill)

    expect(serialized.actorRoutes).toHaveLength(1)
    expect(serialized.paths).toHaveLength(1)
    expect(serialized.paths[0].id).toBe("carrier-route")
    // Sampling density may vary; ensure at least one sampled point carries the action
    expect(serialized.paths[0].points.some((pt) => pt.action === "pass")).toBe(true)
    expect(serialized.paths[0].metrics?.totalFootLength).toBeCloseTo(5, 1)
    expect(serialized.actorRoutes?.[0].nodes[0].nodeType).toBe("hard")
    expect(serialized.actorRoutes?.[0].bezierNodes?.[1].cp1Ft?.xFt).toBe(11)
    expect(serialized.annotations).toEqual([])
  })
})