"use client";
import { useEffect, useRef, useState } from "react";

export interface PieMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  iconColor?: string;
  action?: () => void;
  active?: boolean;
  danger?: boolean;
  keepOpen?: boolean;  // sub-items: collapse ring but don't close menu
  subItems?: PieMenuItem[];
  input?: {
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
  };
}

interface PieMenuProps {
  leftPx: number;
  topPx: number;
  items: PieMenuItem[];
  centerLabel: string;
  onClose: () => void;
}

const CX = 90;
const CY = 90;
const INNER_R = 22;
const OUTER_R = 72;
const ICON_R = 46;
const LABEL_R = 62;
const SUB_INNER_R = 78;
const SUB_OUTER_R = 110;
// Sub-item label radius: move labels further outward so they don't touch icons
// (this creates breathing room; icons are moved outward a bit as well).
const SUB_LABEL_R = 102;
// Sub-item icon radius
// Place sub-item icons slightly inward from the sub-label radius so they sit
// on a circular path beneath the label. Increased to sit closer to the outer
// ring while still remaining inside the label arc.
const SUB_ICON_R = SUB_LABEL_R - 12; // 90
const SIZE = 180;
const GAP_DEG = 3;
const SUB_GAP_DEG = 2;

function toRad(deg: number): number {
  return (deg - 90) * (Math.PI / 180);
}

function arcPathRing(startDeg: number, endDeg: number, innerR: number, outerR: number, gapDeg: number): string {
  const s = startDeg + gapDeg / 2;
  const e = endDeg - gapDeg / 2;
  const c = (d: number) => Math.cos(toRad(d));
  const s2 = (d: number) => Math.sin(toRad(d));
  const x1 = CX + outerR * c(s), y1 = CY + outerR * s2(s);
  const x2 = CX + outerR * c(e), y2 = CY + outerR * s2(e);
  const x3 = CX + innerR * c(e), y3 = CY + innerR * s2(e);
  const x4 = CX + innerR * c(s), y4 = CY + innerR * s2(s);
  const large = e - s > 180 ? 1 : 0;
  return `M${x1.toFixed(2)},${y1.toFixed(2)}A${outerR},${outerR},0,${large},1,${x2.toFixed(2)},${y2.toFixed(2)}L${x3.toFixed(2)},${y3.toFixed(2)}A${innerR},${innerR},0,${large},0,${x4.toFixed(2)},${y4.toFixed(2)}Z`;
}

function labelArcPath(startDeg: number, endDeg: number, radius: number): string {
  const s = startDeg + GAP_DEG / 2;
  const e = endDeg - GAP_DEG / 2;
  const c = (d: number) => Math.cos(toRad(d));
  const s2 = (d: number) => Math.sin(toRad(d));
  const x1 = CX + radius * c(s), y1 = CY + radius * s2(s);
  const x2 = CX + radius * c(e), y2 = CY + radius * s2(e);
  const large = e - s > 180 ? 1 : 0;
  return `M${x1.toFixed(2)},${y1.toFixed(2)}A${radius},${radius},0,${large},1,${x2.toFixed(2)},${y2.toFixed(2)}`;
}

export function PieMenu({ leftPx, topPx, items, centerLabel, onClose }: PieMenuProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [activePrimaryId, setActivePrimaryId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sliceDeg = 360 / items.length;

  const renderIcon = (
    icon: React.ReactNode | undefined,
    x: number,
    y: number,
    iconColor?: string,
    angleDeg?: number,
    radius?: number,
    opts?: { orientation?: "upright" | "radial"; angleOffset?: number },
  ) => {
    if (icon === undefined || icon === null || icon === "") return null;
    // Do not downscale icons — render at native size so logos remain correct.
    const ICON_SCALE = 1;
    // If an angle and radius are provided, position the icon along the circular path
    // by rotating about the pie center (`CX`,`CY`) then translating outward by `radius`.
    if (typeof angleDeg === "number" && typeof radius === "number") {
      // Position along the circular path: outer group places the icon center,
      // inner group counter-rotates + scales the icon so it stays upright.
      const rot = angleDeg - 90;
      const outer = `translate(${CX} ${CY}) rotate(${rot}) translate(${radius} 0)`;
      const orientation = opts?.orientation ?? "upright";
      const angleOffset = opts?.angleOffset ?? 0;
      // For `upright` icons we counter-rotate by -rot so they remain visually upright;
      // for `radial` icons we do not cancel the outer rotation (we may still apply
      // a small angleOffset to tweak orientation per-icon).
      const inner = orientation === "upright"
        ? `rotate(${ -rot + angleOffset }) scale(${ICON_SCALE})`
        : `rotate(${ angleOffset }) scale(${ICON_SCALE})`;
      if (typeof icon === "string") {
        return (
          <g transform={outer}>
            <g transform={inner} className="wb-pie-icon" style={iconColor ? { color: iconColor } : undefined}>
              <text
                x={0}
                y={0}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={iconColor ?? "currentColor"}
              >
                {icon}
              </text>
            </g>
          </g>
        );
      }
      return (
        <g transform={outer}>
          <g
            className="wb-pie-icon"
            transform={inner}
            style={iconColor ? { color: iconColor } : undefined}
            fill={iconColor ?? "currentColor"}
          >
            {icon}
          </g>
        </g>
      );
    }

    // Fallback: position by x/y (preserves existing behavior)
    if (typeof icon === "string") {
      return (
        <g transform={`translate(${x} ${y}) scale(${ICON_SCALE})`}>
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="middle"
            className="wb-pie-icon"
            style={iconColor ? { color: iconColor } : undefined}
            fill={iconColor ?? undefined}
          >
            {icon}
          </text>
        </g>
      );
    }
    return (
      <g
        className="wb-pie-icon"
        transform={`translate(${x} ${y}) scale(${ICON_SCALE})`}
        style={iconColor ? { color: iconColor } : undefined}
        fill={iconColor ?? "currentColor"}
      >
        {icon}
      </g>
    );
  };

  // Close on outside click (capture phase so SVG events still reach their handlers)
  // and on Escape key
  useEffect(() => {
    const handleDoc = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActivePrimaryId(null);
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActivePrimaryId(null);
        onClose();
      }
    };
    document.addEventListener("pointerdown", handleDoc, { capture: true });
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handleDoc, { capture: true });
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="wb-pie-menu"
      style={{ left: `${leftPx}px`, top: `${topPx}px` } as React.CSSProperties}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="wb-pie-svg"
        aria-label={centerLabel}
      >
        <defs>
          {items.map((item, i) => {
            const startDeg = i * sliceDeg;
            const endDeg = startDeg + sliceDeg;
            return (
              <path
                key={`label-path-${item.id}`}
                id={`wb-pie-label-path-${item.id}`}
                d={labelArcPath(startDeg, endDeg, LABEL_R)}
              />
            );
          })}

          {/* Sub-item label paths (spread around full circumference) */}
          {items.map((item) => {
            if (!item.subItems || item.subItems.length === 0) return null;
            const subSliceDeg = 360 / item.subItems.length;
            return item.subItems.map((subItem, subIndex) => {
              const subStart = subIndex * subSliceDeg;
              const subEnd = subStart + subSliceDeg;
              return (
                <path
                  key={`sub-label-path-${item.id}-${subItem.id}`}
                  id={`wb-pie-sub-label-path-${item.id}-${subItem.id}`}
                  d={labelArcPath(subStart, subEnd, SUB_LABEL_R)}
                />
              );
            });
          })}
        </defs>
        {items.map((item, i) => {
          const startDeg = i * sliceDeg;
          const endDeg = startDeg + sliceDeg;
          const midDeg = startDeg + sliceDeg / 2;
          const isHovered = hoveredId === item.id;
          const isExpanded = activePrimaryId === item.id && item.subItems && item.subItems.length > 0;

          const ix = CX + ICON_R * Math.cos(toRad(midDeg));
          const iy = CY + ICON_R * Math.sin(toRad(midDeg));
          const labelPathId = `wb-pie-label-path-${item.id}`;

          const isHidden = activePrimaryId !== null && activePrimaryId !== item.id;

          const cls = [
            "wb-pie-slice",
            item.active && item.subItems && item.subItems.length > 0 ? "wb-pie-slice--active" : "",
            item.danger ? "wb-pie-slice--danger" : "",
            isHovered ? "wb-pie-slice--hover" : "",
            isHidden ? "wb-pie-slice--hidden" : "",
          ].filter(Boolean).join(" ");

          return (
            <g key={item.id}>
              <g
                className={cls}
                role="button"
                aria-label={item.label}
                onPointerEnter={() => setHoveredId(item.id)}
                onPointerLeave={() => setHoveredId(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.subItems && item.subItems.length > 0) {
                    setActivePrimaryId((prev) => prev === item.id ? null : item.id);
                    return;
                  }
                  item.action?.();
                  if (item.keepOpen) return;
                  setActivePrimaryId(null);
                  onClose();
                }}
              >
                <path d={arcPathRing(startDeg, endDeg, INNER_R, OUTER_R, GAP_DEG)} />
                {renderIcon(item.icon, ix, iy, item.iconColor, midDeg, ICON_R)}
                <text className="wb-pie-label">
                  <textPath href={`#${labelPathId}`} startOffset="50%" textAnchor="middle">
                    {item.label}
                  </textPath>
                </text>
              </g>

              {isExpanded && item.subItems && item.subItems.length > 0 && (() => {
                const subSliceDeg = 360 / item.subItems.length;
                return item.subItems.map((subItem, subIndex) => {
                  const subStart = subIndex * subSliceDeg;
                  const subEnd = subStart + subSliceDeg;
                  const subMid = subStart + subSliceDeg / 2;
                  const sx = CX + SUB_ICON_R * Math.cos(toRad(subMid));
                  const sy = CY + SUB_ICON_R * Math.sin(toRad(subMid));
                  const _slx = CX + SUB_LABEL_R * Math.cos(toRad(subMid));
                  const _sly = CY + SUB_LABEL_R * Math.sin(toRad(subMid));
                  // Compute approximate available arc length for this sub-label and use it to constrain text
                  const subRad = (subEnd - subStart) * (Math.PI / 180);
                  const approxArcLen = subRad * SUB_LABEL_R;
                  const _textLen = Math.max(28, approxArcLen * 0.85);
                  const isSpeedSub = item.id === "skate" && subItem.id.startsWith?.("skate-speed-");
                  const subCls = [
                    "wb-pie-sub-slice",
                    subItem.active ? "wb-pie-slice--active" : "",
                    subItem.danger ? "wb-pie-slice--danger" : "",
                    isSpeedSub ? "wb-pie-sub-slice--speed" : "",
                  ].filter(Boolean).join(" ");

                  if (subItem.input) {
                    return (
                      <foreignObject
                        key={subItem.id}
                        x={sx - 36}
                        y={sy - 12}
                        width={72}
                        height={24}
                        className="wb-pie-input-wrap"
                      >
                        <input
                          className="wb-pie-input"
                          value={subItem.input.value}
                          placeholder={subItem.input.placeholder}
                          onChange={(e) => subItem.input?.onChange(e.target.value)}
                        />
                      </foreignObject>
                    );
                  }

                  // Default angle offset (deg) for fine tuning certain icons.
                  // Most sub-icons should be rotated +90° relative to the radial
                  // orientation so they point consistently; override per-item below.
                  let angleOffset = 90;
                  // Lateral icon should be rotated -90deg to point correctly
                  if (subItem.id === "skate-lateral") angleOffset = -90;
                  // Fast speed tier should rotate +90deg relative to radial
                  if (subItem.id.startsWith?.("skate-speed-") && subItem.label === "Fast") angleOffset = 90;

                  return (
                    <g
                      key={subItem.id}
                      className={subCls}
                      role="button"
                      aria-label={subItem.label}
                      onClick={(e) => {
                        e.stopPropagation();
                        subItem.action?.();
                        if (!subItem.keepOpen) {
                          setActivePrimaryId(null);
                          onClose();
                        }
                      }}
                    >
                      <path d={arcPathRing(subStart, subEnd, SUB_INNER_R, SUB_OUTER_R, SUB_GAP_DEG)} />
                      {renderIcon(subItem.icon, sx, sy, subItem.iconColor, subMid, SUB_ICON_R, { orientation: "radial", angleOffset })}
                      <text className="wb-pie-label">
                        <textPath
                          href={`#wb-pie-sub-label-path-${item.id}-${subItem.id}`}
                          startOffset="50%"
                          textAnchor="middle"
                        >
                          {subItem.label}
                        </textPath>
                      </text>
                    </g>
                  );
                });
              })()}
            </g>
          );
        })}

      </svg>
    </div>
  );
}
