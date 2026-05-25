#!/usr/bin/env node
// Whiteboard MCP Server — stdio transport
//
// Design principle: this server is a thin adapter. It validates inputs, forwards
// the request to the running Next.js app, and returns the app's result verbatim.
// It never calculates geometry or length itself. The app is the authority.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const APP_BASE_URL = process.env.WHITEBOARD_APP_URL ?? "http://localhost:3000"
const LINES_ENDPOINT = `${APP_BASE_URL}/api/rink/lines`

// ─── Zod shapes used as inputSchema (ZodRawShapeCompat) ──────────────────────

const StyleShape = {
  color: z.string().optional().describe("CSS color string e.g. '#ff0000'"),
  lineWeight: z.number().positive().optional().describe("Stroke width in SVG units (feet)"),
  arrowStart: z.boolean().optional().describe("Arrowhead at start point"),
  arrowEnd: z.boolean().optional().describe("Arrowhead at end point"),
}

const MetadataShape = {
  label: z.string().optional(),
  purpose: z.string().optional(),
}

const PointShape = {
  x: z.number(),
  y: z.number(),
}

// ─── Validation for the forwarded payload ─────────────────────────────────────

const DrawRinkLineSchema = z.object({
  start: z.object(PointShape).optional(),
  end: z.object(PointShape).optional(),
  points: z.array(z.object(PointShape)).min(2).optional(),
  style: z.object(StyleShape).optional(),
  metadata: z.object(MetadataShape).optional(),
  showLength: z.boolean().optional(),
})

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "whiteboard-rink",
  version: "0.1.0",
})

server.registerTool(
  "draw_rink_line",
  {
    description:
      "Draws a line on the rink using the application's native drawing engine. " +
      "Supports line weight, color, and arrowheads. " +
      "Returns the created object ID and the application-calculated line length in feet. " +
      "Never substitutes its own geometry: length is always the value the app computed.",
    inputSchema: {
      start: z.object(PointShape).optional().describe("Start point in rink feet (0–200 x, 0–85 y). Required unless `points` is given."),
      end: z.object(PointShape).optional().describe("End point in rink feet (0–200 x, 0–85 y). Required unless `points` is given."),
      points: z.array(z.object(PointShape)).min(2).optional().describe("Polyline with 2+ points in rink feet. When provided, `start`/`end` are ignored and the entire path is drawn as one stroke."),
      style: z.object(StyleShape).optional().describe("Visual style overrides"),
      metadata: z.object(MetadataShape).optional().describe("Optional label and purpose for analytics"),
      showLength: z.boolean().optional().describe("When true, display the line length as a label on the canvas. Defaults to false (length is always returned in the response but hidden on canvas by default)."),
    },
  },
  async (args) => {
    // ── 1. Zod re-validates the full payload before forwarding ────────────────
    const parsed = DrawRinkLineSchema.safeParse(args)
    if (!parsed.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Invalid input",
              details: parsed.error.flatten().fieldErrors,
            }),
          },
        ],
        isError: true,
      }
    }

    // ── 2. Delegate to the app — this is the authority for length ────────────
    let response: Response
    try {
      response = await fetch(LINES_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: `Could not reach the whiteboard app at ${APP_BASE_URL}. Is it running?`,
              cause: message,
            }),
          },
        ],
        isError: true,
      }
    }

    // ── 3. Return app result verbatim — no recalculation ─────────────────────
    const body = await response.json()

    if (!response.ok) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(body) }],
        isError: true,
      }
    }

    // body is DrawRinkLineResult — pass straight through.
    return {
      content: [{ type: "text" as const, text: JSON.stringify(body) }],
    }
  },
)

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
