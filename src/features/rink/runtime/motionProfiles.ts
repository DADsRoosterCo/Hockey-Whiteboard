// Runtime motion profiles and speed tables for the hockey drill engine.
//
// This module exposes functions to compute skating, passing and shooting
// speeds based on player age and a modifier. It also provides helpers to
// determine how far a puck or player will travel given a duration and
// modifier, and vice versa. These functions are pure and do not depend
// on any particular rendering or editor state.

// The motion kinds supported by the engine. Skating covers both forward
// and backward skating; ranged motions (passes and shots) are grouped
// together as they share similar speed band semantics.
export type MotionKind = "skating" | "pass" | "shot"

// The subset of motion kinds that have a minimum and maximum speed band.
type RangedMotionKind = Exclude<MotionKind, "skating">

// A speed band defines the minimum and maximum miles per hour for a
// particular motion at a given age. The engine interpolates within
// these bands based on a speed modifier.
type SpeedBand = {
  minMph: number
  maxMph: number
}

// Skating profiles define discrete anchor speeds for different motion
// intensities. These anchors are used to interpolate a continuous speed
// curve based on a normalized modifier in the range [-1, 1].
type SkatingSpeedProfile = {
  glideMph: number
  slowMph: number
  cruiseMph: number
  fastMph: number
  sprintMph: number
  topSpeedMph: number
}

// Context provided to motion profile calculations. Age group strings
// (e.g. "U9", "U11", "Adult") are parsed to extract a numeric age.
export interface MotionProfileContext {
  ageGroup?: string
  /**
   * Optional duration of a single animation frame in milliseconds.
   * When provided, functions that compute travel distance over a
   * duration will use this value instead of a global default.
   */
  stageDurationMs?: number
}

const FEET_PER_MILE = 5280
const SECONDS_PER_HOUR = 3600
const FEET_PER_MPH = FEET_PER_MILE / SECONDS_PER_HOUR

// Hard‑coded skating speed profiles by age. These values reflect
// observations of youth and adult hockey players and are intentionally
// conservative. Coaches may override these tables in future versions via
// settings or configuration.
const SKATING_SPEEDS: Record<number, SkatingSpeedProfile> = {
  7: { glideMph: 0.5, slowMph: 2, cruiseMph: 3, fastMph: 4, sprintMph: 5, topSpeedMph: 6 },
  8: { glideMph: 0.5, slowMph: 2, cruiseMph: 4, fastMph: 5, sprintMph: 6, topSpeedMph: 7 },
  9: { glideMph: 0.5, slowMph: 3, cruiseMph: 5, fastMph: 6, sprintMph: 7, topSpeedMph: 8 },
  10: { glideMph: 1, slowMph: 3, cruiseMph: 5, fastMph: 7, sprintMph: 8, topSpeedMph: 10 },
  11: { glideMph: 1, slowMph: 4, cruiseMph: 6, fastMph: 8, sprintMph: 10, topSpeedMph: 12 },
  12: { glideMph: 1, slowMph: 5, cruiseMph: 7, fastMph: 10, sprintMph: 12, topSpeedMph: 14 },
  13: { glideMph: 1, slowMph: 6, cruiseMph: 9, fastMph: 11, sprintMph: 13, topSpeedMph: 16 },
  14: { glideMph: 1, slowMph: 7, cruiseMph: 10, fastMph: 13, sprintMph: 15, topSpeedMph: 17 },
  15: { glideMph: 1, slowMph: 8, cruiseMph: 11, fastMph: 14, sprintMph: 17, topSpeedMph: 19 },
  16: { glideMph: 1, slowMph: 9, cruiseMph: 12, fastMph: 15, sprintMph: 18, topSpeedMph: 20 },
  17: { glideMph: 1, slowMph: 10, cruiseMph: 13, fastMph: 16, sprintMph: 19, topSpeedMph: 21 },
  18: { glideMph: 1, slowMph: 11, cruiseMph: 14, fastMph: 17, sprintMph: 20, topSpeedMph: 23 },
  19: { glideMph: 1, slowMph: 11, cruiseMph: 15, fastMph: 18, sprintMph: 21, topSpeedMph: 24 },
  20: { glideMph: 1, slowMph: 12, cruiseMph: 16, fastMph: 19, sprintMph: 22, topSpeedMph: 24 },
}

// Speed bands for shots and passes by age. These define the range of
// possible miles per hour values that a player can produce when
// shooting or passing the puck. Interpolation within a band is
// controlled by the normalized speed modifier.
const SHOT_SPEEDS: Record<number, SpeedBand> = {
  7: { minMph: 10, maxMph: 20 },
  8: { minMph: 15, maxMph: 25 },
  9: { minMph: 20, maxMph: 30 },
  10: { minMph: 25, maxMph: 35 },
  11: { minMph: 30, maxMph: 40 },
  12: { minMph: 35, maxMph: 50 },
  13: { minMph: 45, maxMph: 60 },
  14: { minMph: 50, maxMph: 65 },
  15: { minMph: 55, maxMph: 75 },
  16: { minMph: 60, maxMph: 80 },
  17: { minMph: 65, maxMph: 85 },
  18: { minMph: 70, maxMph: 90 },
  19: { minMph: 75, maxMph: 95 },
  20: { minMph: 80, maxMph: 100 },
}

const PASS_SPEEDS: Record<number, SpeedBand> = {
  7: { minMph: 5, maxMph: 12 },
  8: { minMph: 8, maxMph: 15 },
  9: { minMph: 10, maxMph: 18 },
  10: { minMph: 12, maxMph: 22 },
  11: { minMph: 15, maxMph: 25 },
  12: { minMph: 18, maxMph: 30 },
  13: { minMph: 22, maxMph: 35 },
  14: { minMph: 25, maxMph: 40 },
  15: { minMph: 30, maxMph: 45 },
  16: { minMph: 35, maxMph: 50 },
  17: { minMph: 40, maxMph: 55 },
  18: { minMph: 45, maxMph: 60 },
  19: { minMph: 50, maxMph: 65 },
  20: { minMph: 55, maxMph: 70 },
}

// Clamp an age value into the supported range (7–20). If the value
// falls outside this range, it is clamped to the nearest bound.
function clampAge(age: number): number {
  return Math.max(7, Math.min(20, Math.round(age)))
}

// Convert a user‑supplied speed modifier into the normalized range [0, 1]
// used for ranged motion interpolation. Values outside [-1, 1] are
// clamped to the range. A modifier of -1 maps to 0 (minimum) and 1
// maps to 1 (maximum).
function clampModifier(speedModifier: number): number {
  if (!Number.isFinite(speedModifier)) return 0.5
  return Math.max(0, Math.min(1, (speedModifier + 1) / 2))
}

// Discrete anchor points used to interpolate skating speeds. Each anchor
// pairs a normalized modifier value with a key into the speed profile.
const SKATING_SPEED_ANCHORS = [
  { modifier: -1, key: "glideMph" },
  { modifier: -0.5, key: "slowMph" },
  { modifier: 0, key: "cruiseMph" },
  { modifier: 0.5, key: "fastMph" },
  { modifier: 0.75, key: "sprintMph" },
  { modifier: 1, key: "topSpeedMph" },
] as const

// Given a skating profile and a modifier in the range [-1, 1], compute
// the corresponding miles per hour by interpolating between anchor
// points. Linear interpolation is used between anchors. Values outside
// the anchor range are clamped to the nearest anchor.
function interpolateSpeedBetweenAnchors(
  profile: SkatingSpeedProfile,
  modifier: number,
): number {
  if (modifier <= SKATING_SPEED_ANCHORS[0].modifier) {
    const low = SKATING_SPEED_ANCHORS[0]
    const high = SKATING_SPEED_ANCHORS[1]
    const lowMph = profile[low.key]
    const highMph = profile[high.key]
    const progress = (modifier - low.modifier) / (high.modifier - low.modifier)
    return lowMph + (highMph - lowMph) * progress
  }
  for (let index = 0; index < SKATING_SPEED_ANCHORS.length - 1; index += 1) {
    const low = SKATING_SPEED_ANCHORS[index]
    const high = SKATING_SPEED_ANCHORS[index + 1]
    if (modifier <= high.modifier) {
      const lowMph = profile[low.key]
      const highMph = profile[high.key]
      const progress = (modifier - low.modifier) / (high.modifier - low.modifier)
      return lowMph + (highMph - lowMph) * progress
    }
  }
  const low = SKATING_SPEED_ANCHORS[SKATING_SPEED_ANCHORS.length - 2]
  const high = SKATING_SPEED_ANCHORS[SKATING_SPEED_ANCHORS.length - 1]
  const lowMph = profile[low.key]
  const highMph = profile[high.key]
  const progress = (modifier - low.modifier) / (high.modifier - low.modifier)
  return lowMph + (highMph - lowMph) * progress
}

// Compute the skating speed in miles per hour for a given age and
// modifier. If the age is outside the supported range, it is clamped.
function getSkatingSpeedMph(age: number, speedModifier: number): number {
  return interpolateSpeedBetweenAnchors(SKATING_SPEEDS[clampAge(age)], speedModifier)
}

// Given a ranged motion kind and age, return the appropriate speed band.
function pickSpeedBand(kind: RangedMotionKind, age: number): SpeedBand {
  const clampedAge = clampAge(age)
  if (kind === "shot") return SHOT_SPEEDS[clampedAge]
  return PASS_SPEEDS[clampedAge]
}

/**
 * Parse a user friendly age group string (e.g. "U11", "11U") into a
 * numeric age. If the string does not contain a valid age between 7
 * and 20, null is returned. This helper may be used when the age
 * groups are stored as strings in user input or settings.
 */
export function parseAgeGroup(ageGroup?: string): number | null {
  if (!ageGroup) return null
  const matches = ageGroup.match(/\d{1,2}/g)
  if (!matches || matches.length === 0) return null
  for (const match of matches) {
    const age = Number(match)
    if (age >= 7 && age <= 20) {
      return age
    }
  }
  return null
}

/**
 * Compute the motion speed in miles per hour for a motion type and age
 * group. The speed modifier is expected to be in the range [-1, 1].
 * The return value will be null if the age group cannot be parsed.
 */
export function getSpeedMph(
  kind: MotionKind,
  ageGroup: string | undefined,
  speedModifier: number,
): number | null {
  const age = parseAgeGroup(ageGroup)
  if (age === null) return null
  if (kind === "skating") {
    return getSkatingSpeedMph(age, speedModifier)
  }
  const band = pickSpeedBand(kind as RangedMotionKind, age)
  const modifier = clampModifier(speedModifier)
  return band.minMph + (band.maxMph - band.minMph) * modifier
}

/**
 * Given a motion kind, age group, speed modifier and duration (ms),
 * compute the travel distance in feet. Returns null if the age group
 * cannot be parsed or duration is non‑finite. Durations <= 0 return 0.
 */
export function getTravelDistanceFeet(
  kind: MotionKind,
  ageGroup: string | undefined,
  speedModifier: number,
  durationMs: number,
): number | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0
  const speedMph = getSpeedMph(kind, ageGroup, speedModifier)
  if (speedMph === null) return null
  return speedMph * FEET_PER_MPH * (durationMs / 1000)
}

/**
 * Return the skating speed in feet per second for an age group and
 * normalized skating modifier in the range [-1, 1]. Returns null when
 * the age group string cannot be parsed.
 */
export function getSkatingFtPerSec(
  ageGroup: string | undefined,
  speedModifier: number,
): number | null {
  const mph = getSpeedMph("skating", ageGroup, speedModifier)
  return mph === null ? null : mph * FEET_PER_MPH
}

/**
 * Return the top skating speed in feet per second for an age group.
 * Returns null when the age group string cannot be parsed.
 */
export function getMaxSkatingFtPerSec(ageGroup: string | undefined): number | null {
  return getSkatingFtPerSec(ageGroup, 1.0)
}

// Maximum continuous skating distance in feet per route segment by age.
// Represents a realistic single-effort sprint before a natural stop or action.
const MAX_SKATING_SEGMENT_FT: Record<number, number> = {
  7:  40,
  8:  55,
  9:  70,
  10:  90,
  11: 110,
  12: 130,
  13: 155,
  14: 175,
  15: 200,
  16: 220,
  17: 240,
  18: 255,
  19: 265,
  20: 275,
}

/**
 * Return the maximum skating segment length in feet for an age group.
 * Returns null when the age group string cannot be parsed.
 */
export function getMaxSkatingSegmentFt(ageGroup: string | undefined): number | null {
  const age = parseAgeGroup(ageGroup)
  if (age === null) return null
  return MAX_SKATING_SEGMENT_FT[clampAge(age)]
}

/**
 * Given a motion kind, age group, speed modifier and distance (ft),
 * compute the required travel duration in milliseconds. Returns null
 * if the age group cannot be parsed. Distances <= 0 return 0.
 */
export function getTravelDurationMs(
  kind: MotionKind,
  ageGroup: string | undefined,
  speedModifier: number,
  distanceFeet: number,
): number | null {
  if (!Number.isFinite(distanceFeet) || distanceFeet <= 0) return 0
  const speedMph = getSpeedMph(kind, ageGroup, speedModifier)
  if (speedMph === null || speedMph <= 0) return null
  return (distanceFeet / (speedMph * FEET_PER_MPH)) * 1000
}

