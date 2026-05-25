import { describe, expect, it } from "vitest"
import type { DerivedEvent } from "../eventDerivation"
import {
  getDrillPlaybackStates,
  getDrillPlaybackWindow,
  getPathPlaybackState,
  getPlaybackEventsAtTime,
} from "../playback"
import type { SerializedPath } from "../serialization"

describe("playback runtime", () => {
  const paths: SerializedPath[] = [
    {
      id: "path-1",
      actorId: "actor-1",
      teamRole: "home",
      points: [
        { xFt: 10, yFt: 20, timeSec: 0, action: "carry" },
        { xFt: 30, yFt: 40, timeSec: 2, action: "pass" },
        { xFt: 50, yFt: 50, timeSec: 4, action: "receive" },
      ],
    },
  ]

  it("computes the drill playback window from timed path points", () => {
    expect(getDrillPlaybackWindow(paths)).toEqual({ startTimeSec: 0, endTimeSec: 4 })
    expect(getDrillPlaybackWindow([])).toEqual({ startTimeSec: 0, endTimeSec: 1 })
  })

  it("interpolates the actor position at an arbitrary playback time", () => {
    const state = getPathPlaybackState(paths[0], 1)

    expect(state?.isVisible).toBe(true)
    expect(state?.position).toMatchObject({
      xFt: 20,
      yFt: 30,
      timeSec: 1,
      action: "carry",
    })
  })

  it("clamps actor playback before the path starts and after it ends", () => {
    const earlyState = getPathPlaybackState(paths[0], -2)
    const lateState = getPathPlaybackState(paths[0], 9)

    expect(earlyState?.isVisible).toBe(false)
    expect(earlyState?.position).toMatchObject({ xFt: 10, yFt: 20, timeSec: 0 })
    expect(lateState?.isVisible).toBe(false)
    expect(lateState?.position).toMatchObject({ xFt: 50, yFt: 50, timeSec: 4, action: "receive" })
  })

  it("filters drill playback states to non-empty paths", () => {
    const states = getDrillPlaybackStates([
      ...paths,
      {
        id: "empty-path",
        actorId: "actor-2",
        points: [],
      },
    ], 1.5)

    expect(states).toHaveLength(1)
    expect(states[0].actorId).toBe("actor-1")
  })

  it("returns events active near the current playback time", () => {
    const events: DerivedEvent[] = [
      { id: "pass-1", type: "pass", timeSec: 2, endTimeSec: 2.4 },
      { id: "shot-1", type: "shot", timeSec: 4.2 },
    ]

    expect(getPlaybackEventsAtTime(events, 2.2).map((event) => event.id)).toEqual(["pass-1"])
    expect(getPlaybackEventsAtTime(events, 4.45).map((event) => event.id)).toEqual(["shot-1"])
    expect(getPlaybackEventsAtTime(events, 5.2)).toEqual([])
  })
})