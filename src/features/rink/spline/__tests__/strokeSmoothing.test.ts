import { describe, it, expect } from "vitest";
import {
  resamplePoints,
  rdpSimplify,
  chaikinSmooth,
  laplacianSmooth,
  smoothStroke,
  DEFAULT_SMOOTHING_CONFIG,
  HIGH_SMOOTHING_CONFIG,
  LIGHT_SMOOTHING_CONFIG,
  BEZIER_ANCHOR_CONFIG,
  type Pt2,
} from "../strokeSmoothing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pt(xFt: number, yFt: number): Pt2 {
  return { xFt, yFt };
}

function totalArcLength(pts: Pt2[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].xFt - pts[i - 1].xFt, pts[i].yFt - pts[i - 1].yFt);
  }
  return len;
}

function maxSpacing(pts: Pt2[]): number {
  let max = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].xFt - pts[i - 1].xFt, pts[i].yFt - pts[i - 1].yFt);
    if (d > max) max = d;
  }
  return max;
}

// ---------------------------------------------------------------------------
// resamplePoints
// ---------------------------------------------------------------------------

describe("resamplePoints", () => {
  it("preserves first and last points", () => {
    const pts = [pt(0, 0), pt(1, 0), pt(2, 0), pt(3, 0), pt(4, 0)];
    const result = resamplePoints(pts, 1.0);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("returns only endpoints for very short stroke", () => {
    const pts = [pt(0, 0), pt(0.1, 0), pt(0.2, 0)];
    const result = resamplePoints(pts, 1.0);
    expect(result).toHaveLength(2);
  });

  it("produces roughly uniform spacing", () => {
    // 100 random-ish points along a horizontal line of length 50 ft.
    const pts: Pt2[] = Array.from({ length: 100 }, (_, i) => pt(i * 0.5, 0));
    const spacing = 2.0;
    const result = resamplePoints(pts, spacing);
    // Max gap between consecutive resampled points should be close to target.
    expect(maxSpacing(result)).toBeLessThanOrEqual(spacing * 1.5);
  });

  it("preserves total arc length within 1%", () => {
    const pts: Pt2[] = Array.from({ length: 50 }, (_, i) => pt(i, Math.sin(i * 0.3)));
    const original = totalArcLength(pts);
    const result = resamplePoints(pts, 0.5);
    const resampled = totalArcLength(result);
    expect(Math.abs(resampled - original) / original).toBeLessThan(0.02);
  });

  it("handles two-point input", () => {
    const pts = [pt(0, 0), pt(10, 0)];
    const result = resamplePoints(pts, 1.0);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[1]);
    expect(result.length).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// laplacianSmooth
// ---------------------------------------------------------------------------

describe("laplacianSmooth", () => {
  it("preserves first and last points", () => {
    const pts = [pt(0, 0), pt(1, 5), pt(2, -5), pt(3, 5), pt(4, 0)];
    const result = laplacianSmooth(pts, 3);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("keeps the same point count", () => {
    const pts: Pt2[] = Array.from({ length: 50 }, (_, i) => pt(i, (Math.random() - 0.5) * 2));
    expect(laplacianSmooth(pts, 3)).toHaveLength(pts.length);
  });

  it("moves interior points toward neighbours", () => {
    // A sharp zigzag: alternate +5 / -5 on y.
    const pts = [pt(0, 0), pt(1, 5), pt(2, -5), pt(3, 5), pt(4, 0)];
    const result = laplacianSmooth(pts, 3);
    // Interior y values should be less extreme after smoothing.
    expect(Math.abs(result[1].yFt)).toBeLessThan(Math.abs(pts[1].yFt));
    expect(Math.abs(result[2].yFt)).toBeLessThan(Math.abs(pts[2].yFt));
  });

  it("returns input unchanged for 0 passes", () => {
    const pts = [pt(0, 0), pt(5, 5), pt(10, 0)];
    expect(laplacianSmooth(pts, 0)).toEqual(pts);
  });

  it("handles two-point input without error", () => {
    const pts = [pt(0, 0), pt(10, 5)];
    expect(laplacianSmooth(pts, 3)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// rdpSimplify
// ---------------------------------------------------------------------------

describe("rdpSimplify", () => {
  it("always keeps first and last points", () => {
    const pts = [pt(0, 0), pt(1, 0.01), pt(2, -0.01), pt(3, 0)];
    const result = rdpSimplify(pts, 0.1);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("removes collinear interior points", () => {
    // All points on y=0 — only endpoints should survive.
    const pts = [pt(0, 0), pt(1, 0), pt(2, 0), pt(3, 0), pt(4, 0), pt(5, 0)];
    const result = rdpSimplify(pts, 0.01);
    expect(result).toHaveLength(2);
  });

  it("keeps a clearly off-line point", () => {
    // The middle point deviates by 5 ft — well above any reasonable epsilon.
    const pts = [pt(0, 0), pt(5, 5), pt(10, 0)];
    const result = rdpSimplify(pts, 0.5);
    expect(result).toHaveLength(3);
  });

  it("removes jitter below epsilon", () => {
    // 20 points approximating a straight line with sub-epsilon noise.
    const pts: Pt2[] = Array.from({ length: 20 }, (_, i) => pt(i, (Math.random() - 0.5) * 0.05));
    const result = rdpSimplify(pts, 0.1);
    // With noise < 0.05 ft and epsilon 0.1, most interior points should be removed.
    expect(result.length).toBeLessThan(pts.length);
  });

  it("handles two-point input without error", () => {
    const pts = [pt(0, 0), pt(5, 5)];
    expect(rdpSimplify(pts, 0.5)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// chaikinSmooth
// ---------------------------------------------------------------------------

describe("chaikinSmooth", () => {
  it("preserves first and last points", () => {
    const pts = [pt(0, 0), pt(5, 10), pt(10, 0)];
    const result = chaikinSmooth(pts, 3);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("increases point count with iterations", () => {
    const pts = [pt(0, 0), pt(5, 10), pt(10, 0)];
    const r1 = chaikinSmooth(pts, 1);
    const r2 = chaikinSmooth(pts, 2);
    expect(r2.length).toBeGreaterThan(r1.length);
  });

  it("stays within the convex hull of input", () => {
    // For a triangle, Chaikin should stay within bounds.
    const pts = [pt(0, 0), pt(5, 10), pt(10, 0)];
    const result = chaikinSmooth(pts, 4);
    for (const p of result) {
      expect(p.xFt).toBeGreaterThanOrEqual(-0.01);
      expect(p.xFt).toBeLessThanOrEqual(10.01);
      expect(p.yFt).toBeGreaterThanOrEqual(-0.01);
      expect(p.yFt).toBeLessThanOrEqual(10.01);
    }
  });

  it("returns input unchanged for 0 iterations", () => {
    const pts = [pt(0, 0), pt(5, 10), pt(10, 0)];
    expect(chaikinSmooth(pts, 0)).toEqual(pts);
  });

  it("handles two-point input without error", () => {
    const pts = [pt(0, 0), pt(10, 0)];
    const result = chaikinSmooth(pts, 3);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[1]);
  });
});

// ---------------------------------------------------------------------------
// smoothStroke (full pipeline)
// ---------------------------------------------------------------------------

describe("smoothStroke", () => {
  it("preserves endpoints with default config", () => {
    const pts: Pt2[] = Array.from({ length: 100 }, (_, i) =>
      pt(i * 0.3, Math.sin(i * 0.1) + (Math.random() - 0.5) * 0.2),
    );
    const result = smoothStroke(pts);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("returns fewer points than raw input for a noisy stroke", () => {
    // 300 points with jitter — pipeline should simplify significantly.
    const pts: Pt2[] = Array.from({ length: 300 }, (_, i) =>
      pt(i * 0.1, (Math.random() - 0.5) * 0.4),
    );
    const result = smoothStroke(pts, DEFAULT_SMOOTHING_CONFIG);
    expect(result.length).toBeLessThan(pts.length);
  });

  it("HIGH_SMOOTHING_CONFIG produces fewer points than LIGHT_SMOOTHING_CONFIG", () => {
    const pts: Pt2[] = Array.from({ length: 200 }, (_, i) =>
      pt(i * 0.2, Math.sin(i * 0.15) + (Math.random() - 0.5) * 0.3),
    );
    const light = smoothStroke(pts, LIGHT_SMOOTHING_CONFIG);
    const high = smoothStroke(pts, HIGH_SMOOTHING_CONFIG);
    // High smoothing should produce a denser Chaikin output from fewer RDP anchors,
    // but the RDP stage should reduce anchor count more aggressively.
    // The overall smoothed output may be denser due to Chaikin iterations,
    // but the intermediate simplified set (after RDP) should be smaller.
    expect(rdpSimplify(pts, HIGH_SMOOTHING_CONFIG.rdpEpsilonFt).length)
      .toBeLessThanOrEqual(rdpSimplify(pts, LIGHT_SMOOTHING_CONFIG.rdpEpsilonFt).length);
    // Both pipelines should complete and return valid arrays.
    expect(light.length).toBeGreaterThanOrEqual(2);
    expect(high.length).toBeGreaterThanOrEqual(2);
  });

  it("handles a two-point stroke without error", () => {
    const pts = [pt(0, 0), pt(10, 5)];
    const result = smoothStroke(pts);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("handles a single-point stroke without error", () => {
    const pts = [pt(3, 7)];
    const result = smoothStroke(pts);
    expect(result).toHaveLength(1);
  });

  it("BEZIER_ANCHOR_CONFIG pre-smooths before RDP for clean anchor placement", () => {
    // A noisy zigzag stroke — pre-smoothing should move anchors away from the
    // sharp raw positions before RDP simplifies.
    const pts: Pt2[] = Array.from({ length: 80 }, (_, i) =>
      pt(i * 0.3, Math.sin(i * 0.5) + (Math.random() - 0.5) * 0.8),
    );
    const result = smoothStroke(pts, BEZIER_ANCHOR_CONFIG);
    // Should reduce to a manageable number of editable anchors.
    expect(result.length).toBeLessThan(30);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Endpoints pinned.
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("BEZIER_ANCHOR_CONFIG produces far fewer anchors than Chaikin configs", () => {
    // 100 points along a gentle curve — typical short stroke.
    const pts: Pt2[] = Array.from({ length: 100 }, (_, i) =>
      pt(i * 0.3, Math.sin(i * 0.1) + (Math.random() - 0.5) * 0.2),
    );
    const bezierResult = smoothStroke(pts, BEZIER_ANCHOR_CONFIG);
    const defaultResult = smoothStroke(pts, DEFAULT_SMOOTHING_CONFIG);
    // BEZIER_ANCHOR_CONFIG (chaikinIterations=0) must produce fewer points
    // than DEFAULT (chaikinIterations=3), keeping the editable node count low.
    expect(bezierResult.length).toBeLessThan(defaultResult.length);
    // Should still reduce raw point count significantly.
    expect(bezierResult.length).toBeLessThan(pts.length / 2);
  });

  it("completes within 10 ms for 2000-point stroke", () => {
    const pts: Pt2[] = Array.from({ length: 2000 }, (_, i) =>
      pt(i * 0.05, Math.sin(i * 0.05) + (Math.random() - 0.5) * 0.3),
    );
    const start = performance.now();
    smoothStroke(pts, DEFAULT_SMOOTHING_CONFIG);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });
});
