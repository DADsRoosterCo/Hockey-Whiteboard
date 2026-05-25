// Next.js Route Handler — the bridge between the MCP server and the app's drawing engine.
//
// POST /api/rink/lines   — create a line via draw_rink_line
// GET  /api/rink/lines   — fetch all MCP-created lines (for the React overlay to consume)
// DELETE /api/rink/lines/:id would live in app/api/rink/lines/[id]/route.ts if needed.

import { NextRequest, NextResponse } from "next/server"
import { drawRinkLine, validateDrawRinkLineParams } from "@/src/features/rink/lineDrawingEngine"
import { addLine, getAllLines, clearLines } from "@/src/features/rink/serverLineStore"

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const params = body as Parameters<typeof drawRinkLine>[0]
  const errors = validateDrawRinkLineParams(params)
  if (errors.length > 0) {
    return NextResponse.json({ error: "Validation failed", details: errors }, { status: 422 })
  }

  const result = drawRinkLine(params)
  addLine(result)

  return NextResponse.json(result, { status: 201 })
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getAllLines())
}

export async function DELETE(): Promise<NextResponse> {
  clearLines()
  return NextResponse.json({ cleared: true })
}
