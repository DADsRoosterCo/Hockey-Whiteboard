// Server-side in-memory store for lines created via the MCP draw_rink_line tool.
// Lives at module scope so it persists across API requests within a single dev-server
// process. Not suitable for multi-instance production deployments without a shared
// backing store — swap this for Redis or a DB when needed.

import type { DrawRinkLineResult } from "./lineDrawingEngine"

const lines = new Map<string, DrawRinkLineResult>()

export function addLine(line: DrawRinkLineResult): void {
  lines.set(line.objectId, line)
}

export function getLine(objectId: string): DrawRinkLineResult | undefined {
  return lines.get(objectId)
}

export function getAllLines(): DrawRinkLineResult[] {
  return Array.from(lines.values())
}

export function removeLine(objectId: string): boolean {
  return lines.delete(objectId)
}

export function clearLines(): void {
  lines.clear()
}
