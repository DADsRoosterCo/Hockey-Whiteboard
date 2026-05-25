import { describe, expect, it } from "vitest"
import { getMaxSkatingFtPerSec, getSkatingFtPerSec } from "../motionProfiles"

const FEET_PER_MPH = 5280 / 3600

describe("motion profiles", () => {
  it("maps skating tiers to the age-based skating profile anchors", () => {
    expect(getSkatingFtPerSec("U11", -1)).toBeCloseTo(1 * FEET_PER_MPH)
    expect(getSkatingFtPerSec("U11", -0.5)).toBeCloseTo(4 * FEET_PER_MPH)
    expect(getSkatingFtPerSec("U11", 0)).toBeCloseTo(6 * FEET_PER_MPH)
    expect(getSkatingFtPerSec("U11", 0.5)).toBeCloseTo(8 * FEET_PER_MPH)
    expect(getSkatingFtPerSec("U11", 0.75)).toBeCloseTo(10 * FEET_PER_MPH)
    expect(getSkatingFtPerSec("U11", 1)).toBeCloseTo(12 * FEET_PER_MPH)
  })

  it("keeps max skating speed aligned with the top skating tier", () => {
    expect(getMaxSkatingFtPerSec("U15")).toBe(getSkatingFtPerSec("U15", 1))
  })
})