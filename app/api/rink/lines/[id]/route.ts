import { NextRequest, NextResponse } from "next/server"
import { removeLine } from "@/src/features/rink/serverLineStore"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params
  const removed = removeLine(id)
  if (!removed) {
    return NextResponse.json({ error: "Line not found" }, { status: 404 })
  }
  return NextResponse.json({ deleted: id })
}
