import type { DerivedEvent, TimedPathPoint } from "./eventDerivation"
import type { SerializedActor, SerializedPath } from "./serialization"

export interface PlaybackSamplePoint {
  xFt: number
  yFt: number
  timeSec: number
  action?: TimedPathPoint["action"]
}

export interface PathPlaybackState {
  pathId: string
  actorId: string
  teamRole?: SerializedPath["teamRole"]
  position: PlaybackSamplePoint
  isVisible: boolean
}

export function getDrillPlaybackWindow(paths: SerializedPath[]): { startTimeSec: number; endTimeSec: number } {
  const timedPoints = paths.flatMap((path) =>
    path.points.map((point, index) => getSamplePoint(point, index)),
  )

  if (timedPoints.length === 0) {
    return { startTimeSec: 0, endTimeSec: 1 }
  }

  const startTimeSec = timedPoints.reduce(
    (currentMin, point) => Math.min(currentMin, point.timeSec),
    timedPoints[0].timeSec,
  )
  const endTimeSec = timedPoints.reduce(
    (currentMax, point) => Math.max(currentMax, point.timeSec),
    timedPoints[0].timeSec,
  )

  return {
    startTimeSec,
    endTimeSec: Math.max(startTimeSec + 1, endTimeSec),
  }
}

export function getPathPlaybackState(path: SerializedPath, timeSec: number): PathPlaybackState | null {
  if (path.points.length === 0) {
    return null
  }

  const timedPoints = path.points.map((point, index) => getSamplePoint(point, index))
  const clampedTimeSec = clamp(timeSec, timedPoints[0].timeSec, timedPoints[timedPoints.length - 1].timeSec)

  return {
    pathId: path.id,
    actorId: path.actorId,
    teamRole: path.teamRole,
    position: sampleTimedPoints(timedPoints, clampedTimeSec),
    isVisible: timeSec >= timedPoints[0].timeSec && timeSec <= timedPoints[timedPoints.length - 1].timeSec,
  }
}

export function getDrillPlaybackStates(paths: SerializedPath[], timeSec: number): PathPlaybackState[] {
  return paths
    .map((path) => getPathPlaybackState(path, timeSec))
    .filter((state): state is PathPlaybackState => state !== null)
}

export function getPlaybackEventsAtTime(
  events: DerivedEvent[],
  timeSec: number,
  toleranceSec = 0.35,
): DerivedEvent[] {
  return events.filter((event) => {
    const eventEndTimeSec = event.endTimeSec ?? event.timeSec
    return timeSec >= event.timeSec - toleranceSec && timeSec <= eventEndTimeSec + toleranceSec
  })
}

function sampleTimedPoints(points: PlaybackSamplePoint[], timeSec: number): PlaybackSamplePoint {
  if (points.length === 1) {
    return points[0]
  }

  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1]
    const nextPoint = points[index]

    if (timeSec > nextPoint.timeSec) {
      continue
    }

    const segmentDurationSec = nextPoint.timeSec - previousPoint.timeSec
    if (segmentDurationSec <= 0) {
      return nextPoint
    }

    const progress = clamp((timeSec - previousPoint.timeSec) / segmentDurationSec, 0, 1)
    return {
      xFt: lerp(previousPoint.xFt, nextPoint.xFt, progress),
      yFt: lerp(previousPoint.yFt, nextPoint.yFt, progress),
      timeSec,
      action: progress < 1 ? previousPoint.action : nextPoint.action,
    }
  }

  return points[points.length - 1]
}

export interface PuckPlaybackState {
  xFt: number
  yFt: number
  inFlight: boolean
}

export function getPuckStateAtTime(
  paths: SerializedPath[],
  actors: SerializedActor[],
  events: DerivedEvent[],
  timeSec: number,
): PuckPlaybackState | null {
  const passEvents = events
    .filter((e) => e.type === "pass" && Array.isArray(e.actorIds) && e.actorIds.length >= 2)
    .sort((a, b) => a.timeSec - b.timeSec)

  const initialCarrierId =
    actors.find((a) => a.metadata?.hasPuck === true)?.id ??
    (passEvents.length > 0 ? passEvents[0].actorIds![0] : null)
  if (!initialCarrierId) return null

  let carrierId = initialCarrierId
  for (const event of passEvents) {
    if (event.timeSec >= timeSec) break
    if (event.endTimeSec !== undefined && event.endTimeSec <= timeSec) {
      carrierId = event.actorIds![1]
    }
  }

  const activePass = passEvents.find(
    (e) =>
      e.actorIds![0] === carrierId &&
      e.timeSec <= timeSec &&
      e.endTimeSec !== undefined &&
      e.endTimeSec > timeSec,
  )

  if (activePass) {
    const fromPathId = typeof activePass.data?.fromPathId === "string" ? activePass.data.fromPathId : null
    const toPathId = typeof activePass.data?.toPathId === "string" ? activePass.data.toPathId : null
    const passerPath = paths.find((p) => p.id === fromPathId) ?? paths.find((p) => p.actorId === activePass.actorIds![0])
    const receiverPath = paths.find((p) => p.id === toPathId) ?? paths.find((p) => p.actorId === activePass.actorIds![1])
    if (!passerPath || !receiverPath) return null

    const passPos = getPathPlaybackState(passerPath, activePass.timeSec)?.position
    const receivePos = getPathPlaybackState(receiverPath, activePass.endTimeSec!)?.position
    if (!passPos || !receivePos) return null

    const duration = activePass.endTimeSec! - activePass.timeSec
    const t = clamp(duration > 0 ? (timeSec - activePass.timeSec) / duration : 0, 0, 1)

    return {
      xFt: lerp(passPos.xFt, receivePos.xFt, t),
      yFt: lerp(passPos.yFt, receivePos.yFt, t),
      inFlight: true,
    }
  }

  const carrierPath = paths.find((p) => p.actorId === carrierId)
  if (!carrierPath) return null

  const state = getPathPlaybackState(carrierPath, timeSec)
  if (!state) return null

  return { xFt: state.position.xFt, yFt: state.position.yFt, inFlight: false }
}

function getSamplePoint(point: TimedPathPoint, index: number): PlaybackSamplePoint {
  return {
    xFt: point.xFt,
    yFt: point.yFt,
    timeSec: Number.isFinite(point.timeSec) ? (point.timeSec as number) : index,
    action: point.action,
  }
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}