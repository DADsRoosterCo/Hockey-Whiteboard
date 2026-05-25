import { test, expect } from "@playwright/test"

// ── helpers ──────────────────────────────────────────────────────────────────

const LINES_ENDPOINT = "/api/rink/lines"

interface DrawRinkLineResult {
  objectId: string
  type: "line"
  start: { x: number; y: number }
  end: { x: number; y: number }
  length: number | null
  units: string | null
  style: { color: string; lineWeight: number; arrowStart: boolean; arrowEnd: boolean }
  metadata: { label: string | null; purpose: string | null }
  warning?: string
}

// ── test suite ────────────────────────────────────────────────────────────────

test.describe("MCP draw_rink_line endpoint", () => {
  // Clear MCP lines before each test so tests don't interfere with each other.
  // The store exposes GET, so we call the API directly via the Playwright request context.

  test("POST /api/rink/lines returns app-calculated length and draws on canvas", async ({ page, request }) => {
    // Navigate first so the polling effect is active when the line arrives.
    await page.goto("/")

    // ── 1. Call the MCP endpoint ──────────────────────────────────────────────
    const body = {
      start: { x: 25, y: 42.5 },
      end: { x: 175, y: 42.5 },
      style: { color: "#ffdd00", lineWeight: 2, arrowEnd: true },
      metadata: { label: "Centre-ice line", purpose: "test" },
    }

    const response = await request.post(LINES_ENDPOINT, { data: body })
    expect(response.status()).toBe(201)

    const result = (await response.json()) as DrawRinkLineResult

    // ── 2. Verify structure ───────────────────────────────────────────────────
    expect(result.type).toBe("line")
    expect(result.objectId).toMatch(/^[0-9a-f-]{36}$/) // UUID v4 pattern
    expect(result.start).toEqual({ x: 25, y: 42.5 })
    expect(result.end).toEqual({ x: 175, y: 42.5 })
    expect(result.units).toBe("feet")

    // ── 3. Length must come from the app, not the AI ──────────────────────────
    // A horizontal line from x=25 to x=175 at the same y is exactly 150 ft.
    expect(result.length).toBeCloseTo(150, 4)

    // ── 4. Style is echoed back with defaults filled in ───────────────────────
    expect(result.style.color).toBe("#ffdd00")
    expect(result.style.lineWeight).toBe(2)
    expect(result.style.arrowEnd).toBe(true)
    expect(result.style.arrowStart).toBe(false)

    // ── 5. Line appears on the canvas within the poll window ─────────────────
    // The overlay polls every 2 s. We allow up to 5 s for it to appear.
    // SVG <line> primitives have no layout bounding box so Playwright treats them as
    // "hidden" — use toBeAttached() to confirm the element is in the DOM instead.
    const lineEl = page.locator(`[data-testid="mcp-line"][data-object-id="${result.objectId}"]`)
    await expect(lineEl).toBeAttached({ timeout: 5000 })

    // The SVG element must carry the app-calculated length so the AI can read it.
    const dataLength = await lineEl.getAttribute("data-length")
    expect(Number(dataLength)).toBeCloseTo(150, 4)

    // ── 6. Screenshot for visual confirmation ─────────────────────────────────
    await page.screenshot({ path: "tests/screenshots/mcp-line-drawn.png", fullPage: false })
  })

  test("POST /api/rink/lines with arrowheads on both ends", async ({ request }) => {
    const response = await request.post(LINES_ENDPOINT, {
      data: {
        start: { x: 100, y: 10 },
        end: { x: 100, y: 75 },
        style: { color: "#00ccff", lineWeight: 1.5, arrowStart: true, arrowEnd: true },
      },
    })
    expect(response.status()).toBe(201)
    const result = (await response.json()) as DrawRinkLineResult
    // Vertical line spanning 65 ft
    expect(result.length).toBeCloseTo(65, 4)
    expect(result.style.arrowStart).toBe(true)
    expect(result.style.arrowEnd).toBe(true)
  })

  test("POST /api/rink/lines rejects out-of-bounds coordinates", async ({ request }) => {
    const response = await request.post(LINES_ENDPOINT, {
      data: {
        start: { x: -5, y: 42.5 },
        end: { x: 250, y: 42.5 },
      },
    })
    expect(response.status()).toBe(422)
    const body = await response.json()
    expect(body.error).toBe("Validation failed")
  })

  test("GET /api/rink/lines returns all created lines", async ({ request }) => {
    // Draw a line first, then fetch the list.
    await request.post(LINES_ENDPOINT, {
      data: { start: { x: 50, y: 20 }, end: { x: 50, y: 65 } },
    })
    const response = await request.get(LINES_ENDPOINT)
    expect(response.status()).toBe(200)
    const lines = (await response.json()) as DrawRinkLineResult[]
    expect(Array.isArray(lines)).toBe(true)
    expect(lines.length).toBeGreaterThan(0)
    // Every line must have an app-calculated length
    for (const line of lines) {
      expect(line.length).not.toBeNull()
    }
  })
})
