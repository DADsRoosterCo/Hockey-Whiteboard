"use client";

import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useLayoutEffect, memo } from "react";
import { RinkCanvas } from "@/src/features/rink/RinkCanvas";
import { hockeyCanadaRinkSpec } from "@/src/features/rink/hockeyCanadaRinkSpec";
import { getContainingSemanticZones, getRinkViewBox } from "@/src/features/rink/rinkGeometry";
import {
  deriveEventsForDrill,
  type TimedPathPoint,
  type RuntimePathAction,
} from "@/src/features/rink/runtime/eventDerivation";
import { buildPathMetrics, measurePolylineDistanceFeet } from "@/src/features/rink/runtime/pathMetrics";
import {
  CURRENT_DRILL_SERIALIZATION_VERSION,
  serializeDrill,
  type SerializedActor,
  type SerializedAnnotation,
  type SerializedAnnotationType,
  type SerializedDrill,
  type SerializedPath,
  type SerializedDrawLine,
  type DrawLineArrowType,
} from "@/src/features/rink/runtime/serialization";
import { getSkatingFtPerSec } from "@/src/features/rink/runtime/motionProfiles";
import {
  getDrillPlaybackStates,
  getDrillPlaybackWindow,
  getPathPlaybackState,
  getPlaybackEventsAtTime,
  getPuckStateAtTime,
} from "@/src/features/rink/runtime/playback";
import {
  buildActorRoutePathData,
  fitRouteBezierNodes,
  moveRouteBezierHandle,
  moveRouteBezierNode,
} from "@/src/features/rink/routeBezier";
import type { SerializedActorRouteBezierNode } from "@/src/features/rink/runtime/serialization";
import { sampleBezierRouteToTimedPoints } from "@/src/features/rink/runtime/routeProjection";
import { PieMenu, type PieMenuItem } from "@/app/_components/pie-menu";

const OVERLAY_VIEW_BOX = getRinkViewBox(hockeyCanadaRinkSpec);

type SelectedPoint = {
  xFt: number;
  yFt: number;
  zoneNames: string[];
};

type EditorTool =
  | "select"
  | "player"
  | "lineup"
  | "draw"
  | "zone"
  | SerializedAnnotationType;

type RouteGestureMode = "extend" | "move-route";

type BezierHandleDrag = {
  pointerId: number;
  pathId: string;
  nodeIndex: number;
  handleType: "cp1Ft" | "cp2Ft";
  initialPointer: { xFt: number; yFt: number };
  initialCp: { xFt: number; yFt: number };
};

type DragState =
  | { kind: "path-point"; actorId: string; pointIndex: number }
  | {
      kind: "route-translate";
      actorId: string;
      pointerStart: { xFt: number; yFt: number };
      originPoints: Array<{ xFt: number; yFt: number }>;
    }
  | {
      kind: "draw-line-translate";
      drawLineId: string;
      pointerStart: { xFt: number; yFt: number };
      originPoints: Array<{ xFt: number; yFt: number }>;
    }
  | { kind: "draw-line-point"; drawLineId: string; pointIndex: number }
  | { kind: "draw-line-bezier-node"; drawLineId: string; nodeIndex: number }
  | { kind: "annotation"; annotationId: string };

type FreehandDraft = {
  actorId: string | null;
  pointerId: number;
  points: Array<{ xFt: number; yFt: number }>;
};

type PendingSelectionGesture =
  | {
      kind: "actor";
      actorId: string;
      pointerId: number;
      pointerStart: { xFt: number; yFt: number };
      draftStart: { xFt: number; yFt: number };
      routeMode: RouteGestureMode;
    }
  | {
      kind: "annotation";
      annotationId: string;
      pointerId: number;
      pointerStart: { xFt: number; yFt: number };
    };

type EditorSnapshot = {
  actors: SerializedActor[];
  annotations: SerializedAnnotation[];
  paths: SerializedPath[];
  drawLines: SerializedDrawLine[];
  activeActorId: string | null;
  activeTool: EditorTool;
  nextAction: RuntimePathAction;
  showCurvedPaths: boolean;
  curveIntensity: number;
  curveModeByActor: Record<string, boolean>;
  selectedAnnotationId: string | null;
  selectedDrawLineId: string | null;
  selectedPoint: SelectedPoint | null;
};

type ActorEditorState = {
  positionTag: string;
  speedTier: number;
  hasPuck: boolean;
  skateBackward: boolean;
  skateLateral: boolean;
  goalieMovement: "none" | "padslide" | "butterflyslide";
  customColor?: string;
};

type NodeBreakType = "stop" | "pivot";

type RouteLineType =
  | "skate"
  | "skate-with-puck"
  | "backward"
  | "backward-with-puck"
  | "lateral"
  | "lateral-with-puck"
  | "goalie-padslide"
  | "goalie-butterflyslide";

type RouteLegendItem = {
  label: string;
  lineType: RouteLineType | "pass" | "shot" | NodeBreakType;
  active?: boolean;
};

const INITIAL_ACTORS: SerializedActor[] = [];

function createDefaultAnchorPoint(
  teamRole: SerializedActor["teamRole"],
  slotIndex = 0,
) {
  const laneCount = 5;
  const laneIndex = ((slotIndex % laneCount) + laneCount) % laneCount;
  const verticalStep = hockeyCanadaRinkSpec.surface.widthFt / (laneCount + 1);
  const yFt = verticalStep * (laneIndex + 1);
  const xFtByRole: Record<NonNullable<SerializedActor["teamRole"]>, number> = {
    home: hockeyCanadaRinkSpec.surface.lengthFt * 0.3,
    away: hockeyCanadaRinkSpec.surface.lengthFt * 0.7,
    neutral: hockeyCanadaRinkSpec.surface.lengthFt * 0.5,
  };

  return {
    xFt: xFtByRole[teamRole ?? "neutral"],
    yFt,
    timeSec: 0,
    action: "carry" as RuntimePathAction,
  };
}

function createDefaultPathForActor(
  actor: SerializedActor,
  slotIndex = 0,
): SerializedPath {
  return {
    id: `${actor.id}-path`,
    actorId: actor.id,
    label: `${actor.name} Path`,
    teamRole: actor.teamRole,
    points: [createDefaultAnchorPoint(actor.teamRole, slotIndex)],
  };
}

const INITIAL_PATHS: SerializedPath[] = INITIAL_ACTORS.map((actor, index) => createDefaultPathForActor(actor, index));

const AGE_GROUP_OPTIONS = [
  "U7", "U8", "U9", "U10", "U11", "U12", "U13",
  "U14", "U15", "U16", "U17", "U18", "U19", "U20",
];

const ACTOR_COLORS: Record<string, { stroke: string; fill: string; token: string }> = {
  home: { stroke: "#0ea5e9", fill: "rgba(14, 165, 233, 0.18)", token: "#0369a1" },
  away: { stroke: "#ef4444", fill: "rgba(239, 68, 68, 0.18)", token: "#b91c1c" },
  neutral: { stroke: "#a78bfa", fill: "rgba(167, 139, 250, 0.18)", token: "#7c3aed" },
};

const COLOR_SWATCHES = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#14b8a6",
];

const ROUTE_LINEWEIGHT_SCALE = 0.75;

const ROUTE_STROKE_WIDTH = {
  active: 1.8 * ROUTE_LINEWEIGHT_SCALE,
  inactive: 1.3 * ROUTE_LINEWEIGHT_SCALE,
  draft: 1.7 * ROUTE_LINEWEIGHT_SCALE,
  arrow: 0.6 * ROUTE_LINEWEIGHT_SCALE,
} as const;

type EditorToolItem = { label: string; value: EditorTool; icon: string };

const EDITOR_TOOL_ITEMS: EditorToolItem[] = [
  { label: "Select / Move", value: "select", icon: "↖" },
  { label: "Player", value: "player", icon: "●" },
  { label: "Cone", value: "cone", icon: "▲" },
  { label: "Net", value: "net", icon: "⊟" },
  { label: "Text", value: "text", icon: "T" },
  { label: "Pucks", value: "puck", icon: "⬤" },
  { label: "Lineup", value: "lineup", icon: "≡" },
  { label: "Draw", value: "draw", icon: "∿" },
  { label: "Zone", value: "zone", icon: "▦" },
];

const _POSITION_TYPES = ["F", "D", "C", "G", "X", "O", "N"] as const;

const _GOALIE_MOVEMENT_OPTIONS: Array<{ label: string; value: ActorEditorState["goalieMovement"] }> = [
  { label: "None", value: "none" },
  { label: "Padslide", value: "padslide" },
  { label: "Butterfly", value: "butterflyslide" },
];
const SPEED_OPTIONS = [
  { icon: "0", title: "Pause" },
  { icon: "~", title: "Glide" },
  { icon: ">", title: "Slow" },
  { icon: ">>", title: "Cruise" },
  { icon: ">>>", title: "Fast" },
  { icon: ">>>>", title: "Sprint" },
  { icon: "⚡", title: "Top speed" },
] as const;

const _TEAM_BUTTONS: Array<{ label: string; value: SerializedActor["teamRole"] }> = [
  { label: "X", value: "away" },
  { label: "O", value: "home" },
  { label: "N", value: "neutral" },
];

const DRILL_CATEGORIES = [
  "PENALTY KILL STRUCTURE",
  "FACEOFF EXECUTION",
  "REGROUP FREERIDE",
  "BEAT COVERAGE",
  "SOFT CONTROL AS A UNIT",
  "SIDE AREA WALL BACK",
];

const _ACTION_OPTIONS: Array<{ label: string; value: RuntimePathAction }> = [
  { label: "Carry", value: "carry" },
  { label: "Pass", value: "pass" },
  { label: "Receive", value: "receive" },
  { label: "Shot", value: "shot" },
];

const FREEHAND_POINT_SPACING_FT = 0.9;
const FREEHAND_ANCHOR_SPACING_FT = 25;
const FREEHAND_TURN_THRESHOLD_DEG = 22;
const MAX_SEGMENT_DURATION_SEC = 2;
const TAP_DRAG_THRESHOLD_FT = 1.25;
const ROUTE_NODE_HIT_RADIUS_FT = 6.5;
const _BEZIER_HANDLE_HIT_RADIUS_FT = 6;
const BEZIER_HANDLE_LEADER_EXT_FT = 7;

function getBezierHandleDisplayPos(
  node: { xFt: number; yFt: number },
  cp: { xFt: number; yFt: number },
): { xFt: number; yFt: number } {
  const dx = cp.xFt - node.xFt;
  const dy = cp.yFt - node.yFt;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.01) return { xFt: cp.xFt + BEZIER_HANDLE_LEADER_EXT_FT, yFt: cp.yFt };
  const scale = (dist + BEZIER_HANDLE_LEADER_EXT_FT) / dist;
  return { xFt: node.xFt + dx * scale, yFt: node.yFt + dy * scale };
}

export function RinkHome() {
  const overlaySvgRef = useRef<SVGSVGElement | null>(null);
  const dragMovedRef = useRef(false);
  const dragStartSnapshotRef = useRef<EditorSnapshot | null>(null);
  const freehandDraftRef = useRef<FreehandDraft | null>(null);
  const bezierDragRef = useRef<BezierHandleDrag | null>(null);
  const drawLineBezierDragRef = useRef<(BezierHandleDrag & { drawLineId: string }) | null>(null);
  const pendingSelectionGestureRef = useRef<PendingSelectionGesture | null>(null);
  const nextActorIdRef = useRef(INITIAL_ACTORS.length + 1);
  const playbackFrameRef = useRef<number | null>(null);
  const playbackLastTickRef = useRef<number | null>(null);
  const playbackTimeRef = useRef(0);
  const lastScrubberTickRef = useRef(0);
  // Core editor state
  const [showZones, setShowZones] = useState(false);
  const [showCurvedPaths, setShowCurvedPaths] = useState(true);
  const [curveIntensity, setCurveIntensity] = useState(0.65);
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint | null>(null);
  const [actors, setActors] = useState(INITIAL_ACTORS);
  const [annotations, setAnnotations] = useState<SerializedAnnotation[]>([]);
  const [paths, setPaths] = useState(INITIAL_PATHS);
  const [activeActorId, setActiveActorId] = useState<string | null>(INITIAL_ACTORS[0]?.id ?? null);
  const [selectedRouteActorId, setSelectedRouteActorId] = useState<string | null>(INITIAL_ACTORS[0]?.id ?? null);
  const [activeTool, setActiveTool] = useState<EditorTool>("select");
  const [nextAction, setNextAction] = useState<RuntimePathAction>("carry");
  const [ageGroup, setAgeGroup] = useState("U13");
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<number | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTimeSec, setPlaybackTimeSec] = useState(0);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [freehandDraftActorId, setFreehandDraftActorId] = useState<string | null>(null);
  const [freehandDraftPoints, setFreehandDraftPoints] = useState<Array<{ xFt: number; yFt: number }>>([]);
  const [curveModeByActor, setCurveModeByActor] = useState<Record<string, boolean>>(
    () => buildCurveModesForActors(INITIAL_ACTORS),
  );
  const [bezierNodesByPath, setBezierNodesByPath] = useState<Record<string, SerializedActorRouteBezierNode[]>>(
    () => Object.fromEntries(INITIAL_PATHS.map((p) => [p.id, fitRouteBezierNodes(p.points)])),
  );
  const [drawLines, setDrawLines] = useState<SerializedDrawLine[]>([]);
  const [selectedDrawLineId, setSelectedDrawLineId] = useState<string | null>(null);
  const [drawLineMode, setDrawLineMode] = useState<"move" | "edit" | null>(null);
  const [editingDrawLineId, setEditingDrawLineId] = useState<string | null>(null);
  const [bezierNodesByDrawLine, setBezierNodesByDrawLine] = useState<Record<string, SerializedActorRouteBezierNode[]>>({});
  const [selectedDrawLineNodeIndex, setSelectedDrawLineNodeIndex] = useState<number | null>(null);
  const nextDrawLineIdRef = useRef(1);

  // UI panel state
  const [legendOpen, setLegendOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [routeGestureMode, setRouteGestureMode] = useState<RouteGestureMode>("extend");
  const [pieMenuOpen, setPieMenuOpen] = useState(false);

  const derivedEvents = useMemo(() => deriveEventsForDrill({
    paths: paths.map((path) => ({
      pathId: path.id,
      actorId: path.actorId,
      teamRole: path.teamRole,
      points: path.points,
    })),
    zones: hockeyCanadaRinkSpec.semanticZones,
  }), [paths]);

  const serializedDrill: SerializedDrill = useMemo(() => serializeDrill({
    version: CURRENT_DRILL_SERIALIZATION_VERSION,
    metadata: {
      id: "whiteboard-session",
      name: "Whiteboard Session",
      rinkSpecId: hockeyCanadaRinkSpec.id,
      notes: "",
      editorPreferences: {
        showCurvedPaths,
        curveIntensity,
        actorCurveModes: curveModeByActor,
      },
    },
    actors,
    paths,
    annotations,
    derivedEvents,
    drawLines,
  }), [paths, actors, annotations, derivedEvents, drawLines, showCurvedPaths, curveIntensity, curveModeByActor]);

  const activeActor = actors.find((a) => a.id === activeActorId) ?? null;
  const activeAnnotation = annotations.find((a) => a.id === selectedAnnotationId) ?? null;
  const activePath = activeActorId ? paths.find((p) => p.actorId === activeActorId) ?? null : null;
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const canDeleteSelection = selectedAnnotationId !== null
    || selectedNodeIndex !== null
    || selectedDrawLineId !== null
    || (pieMenuOpen && selectedRouteActorId !== null);
  const activeActorEditor = getActorEditorState(activeActor);
  const activeRouteLineType = useMemo(() => getRouteLineType(activeActorEditor), [activeActorEditor]);
  const routeLegendItems = useMemo<RouteLegendItem[]>(() => [
    { label: "Direction", lineType: "skate", active: activeRouteLineType === "skate" },
    { label: "Skate", lineType: "skate", active: activeRouteLineType === "skate" },
    { label: "Skate With Puck", lineType: "skate-with-puck", active: activeRouteLineType === "skate-with-puck" },
    { label: "Pass", lineType: "pass", active: nextAction === "pass" },
    { label: "Shot", lineType: "shot", active: nextAction === "shot" },
    { label: "Stop", lineType: "stop", active: selectedNodeIndex !== null && activePath ? getNodeBreakType(activePath.points[selectedNodeIndex]) === "stop" : false },
    { label: "Pivot", lineType: "pivot", active: selectedNodeIndex !== null && activePath ? getNodeBreakType(activePath.points[selectedNodeIndex]) === "pivot" : false },
    { label: "Backwards Skating", lineType: "backward", active: activeRouteLineType === "backward" },
    { label: "Backwards Skating With Puck", lineType: "backward-with-puck", active: activeRouteLineType === "backward-with-puck" },
    { label: "Lateral Skating", lineType: "lateral", active: activeRouteLineType === "lateral" },
    { label: "Lateral Skating With Puck", lineType: "lateral-with-puck", active: activeRouteLineType === "lateral-with-puck" },
    { label: "Goalie Padslide", lineType: "goalie-padslide", active: activeRouteLineType === "goalie-padslide" },
    { label: "Goalie Butterflyslide", lineType: "goalie-butterflyslide", active: activeRouteLineType === "goalie-butterflyslide" },
  ], [activePath, activeRouteLineType, nextAction, selectedNodeIndex]);
  const playbackWindow = useMemo(() => getDrillPlaybackWindow(paths), [paths]);
  const timelineMaxTime = Math.max(playbackWindow.endTimeSec, 0.1);
  const [actorPieMenuPosition, setActorPieMenuPosition] = useState<{ leftPx: number; topPx: number } | null>(null);
  const [annotationPieMenuPosition, setAnnotationPieMenuPosition] = useState<{ leftPx: number; topPx: number } | null>(null);
  const [drawLinePieMenuPosition, setDrawLinePieMenuPosition] = useState<{ leftPx: number; topPx: number } | null>(null);
  const actorPieMenuRafRef = useRef<number | null>(null);
  const annotationPieMenuRafRef = useRef<number | null>(null);
  const drawLinePieMenuRafRef = useRef<number | null>(null);

  const getMenuPositionFromPoint = useCallback((point: { xFt: number; yFt: number }) => {
    const svg = overlaySvgRef.current;
    if (!svg) return null;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const screenPoint = svg.createSVGPoint();
    screenPoint.x = point.xFt;
    screenPoint.y = point.yFt;
    const transformed = screenPoint.matrixTransform(matrix);
    const bounds = svg.getBoundingClientRect();
    return { leftPx: transformed.x - bounds.left, topPx: transformed.y - bounds.top };
  }, []);

  useLayoutEffect(() => {
    if (actorPieMenuRafRef.current) {
      cancelAnimationFrame(actorPieMenuRafRef.current);
      actorPieMenuRafRef.current = null;
    }
    if (pieMenuOpen && activePath?.points.length) {
      const pos = getMenuPositionFromPoint(activePath.points[0]);
      actorPieMenuRafRef.current = requestAnimationFrame(() => setActorPieMenuPosition(pos));
    } else {
      actorPieMenuRafRef.current = requestAnimationFrame(() => setActorPieMenuPosition(null));
    }
    return () => {
      if (actorPieMenuRafRef.current) cancelAnimationFrame(actorPieMenuRafRef.current);
      actorPieMenuRafRef.current = null;
    };
  }, [pieMenuOpen, activePath, getMenuPositionFromPoint]);

  useLayoutEffect(() => {
    if (annotationPieMenuRafRef.current) {
      cancelAnimationFrame(annotationPieMenuRafRef.current);
      annotationPieMenuRafRef.current = null;
    }
    if (pieMenuOpen && activeAnnotation) {
      const pos = getMenuPositionFromPoint(activeAnnotation);
      annotationPieMenuRafRef.current = requestAnimationFrame(() => setAnnotationPieMenuPosition(pos));
    } else {
      annotationPieMenuRafRef.current = requestAnimationFrame(() => setAnnotationPieMenuPosition(null));
    }
    return () => {
      if (annotationPieMenuRafRef.current) cancelAnimationFrame(annotationPieMenuRafRef.current);
      annotationPieMenuRafRef.current = null;
    };
  }, [pieMenuOpen, activeAnnotation, getMenuPositionFromPoint]);

  useLayoutEffect(() => {
    if (!pieMenuOpen) return;
    const handleResize = () => {
      if (actorPieMenuRafRef.current) {
        cancelAnimationFrame(actorPieMenuRafRef.current);
        actorPieMenuRafRef.current = null;
      }
      if (annotationPieMenuRafRef.current) {
        cancelAnimationFrame(annotationPieMenuRafRef.current);
        annotationPieMenuRafRef.current = null;
      }
      if (activePath?.points.length) {
        const pos = getMenuPositionFromPoint(activePath.points[0]);
        actorPieMenuRafRef.current = requestAnimationFrame(() => setActorPieMenuPosition(pos));
      }
      if (activeAnnotation) {
        const pos = getMenuPositionFromPoint(activeAnnotation);
        annotationPieMenuRafRef.current = requestAnimationFrame(() => setAnnotationPieMenuPosition(pos));
      }
      const selDrawLine = drawLines.find((l) => l.id === selectedDrawLineId);
      if (selDrawLine && selDrawLine.points.length > 0) {
        const pos = getMenuPositionFromPoint(selDrawLine.points[0]);
        drawLinePieMenuRafRef.current = requestAnimationFrame(() => setDrawLinePieMenuPosition(pos));
      }
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (actorPieMenuRafRef.current) cancelAnimationFrame(actorPieMenuRafRef.current);
      if (annotationPieMenuRafRef.current) cancelAnimationFrame(annotationPieMenuRafRef.current);
      if (drawLinePieMenuRafRef.current) cancelAnimationFrame(drawLinePieMenuRafRef.current);
      actorPieMenuRafRef.current = null;
      annotationPieMenuRafRef.current = null;
      drawLinePieMenuRafRef.current = null;
    };
  }, [pieMenuOpen, activePath, activeAnnotation, drawLines, selectedDrawLineId, getMenuPositionFromPoint]);

  useLayoutEffect(() => {
    if (drawLinePieMenuRafRef.current) {
      cancelAnimationFrame(drawLinePieMenuRafRef.current);
      drawLinePieMenuRafRef.current = null;
    }
    const selDrawLine = drawLines.find((l) => l.id === selectedDrawLineId);
    if (pieMenuOpen && selDrawLine && selDrawLine.points.length > 0) {
      let anchor: { xFt: number; yFt: number };
      if (drawLineMode === "edit" && selectedDrawLineNodeIndex !== null && selDrawLine.points[selectedDrawLineNodeIndex]) {
        anchor = selDrawLine.points[selectedDrawLineNodeIndex];
      } else {
        anchor = selDrawLine.points[0];
      }
      const pos = getMenuPositionFromPoint(anchor);
      drawLinePieMenuRafRef.current = requestAnimationFrame(() => setDrawLinePieMenuPosition(pos));
    } else {
      drawLinePieMenuRafRef.current = requestAnimationFrame(() => setDrawLinePieMenuPosition(null));
    }
    return () => {
      if (drawLinePieMenuRafRef.current) cancelAnimationFrame(drawLinePieMenuRafRef.current);
      drawLinePieMenuRafRef.current = null;
    };
  }, [pieMenuOpen, selectedDrawLineId, selectedDrawLineNodeIndex, drawLineMode, drawLines, getMenuPositionFromPoint]);
  const syncedBezierNodesByPath = useMemo(() => {
    const next = { ...bezierNodesByPath };
    for (const path of paths) {
      const existing = next[path.id];
      if (!existing) {
        next[path.id] = fitRouteBezierNodes(path.points);
        continue;
      }
      if (existing.length === path.points.length) {
        // Length unchanged — keep existing nodes (preserves manual handle adjustments).
        continue;
      }
      if (existing.length > 0 && existing.length < path.points.length) {
        // Path grew: preserve interior nodes, recompute from the junction outward
        // so that the curve flows smoothly into the new tail.
        const tension = 0.65 * 0.45;
        const recomputeFrom = Math.max(0, existing.length - 1);
        const extended: typeof existing = existing.slice(0, recomputeFrom);
        for (let i = recomputeFrom; i < path.points.length; i += 1) {
          const prev = path.points[i - 1] ?? path.points[i];
          const curr = path.points[i];
          const nextPt = path.points[i + 1] ?? curr;
          const tX = (nextPt.xFt - prev.xFt) * tension;
          const tY = (nextPt.yFt - prev.yFt) * tension;
          extended.push({
            xFt: curr.xFt,
            yFt: curr.yFt,
            nodeType: "smooth",
            cp1Ft: i > 0 ? { xFt: curr.xFt - tX / 3, yFt: curr.yFt - tY / 3 } : undefined,
            cp2Ft: i < path.points.length - 1 ? { xFt: curr.xFt + tX / 3, yFt: curr.yFt + tY / 3 } : undefined,
          });
        }
        next[path.id] = extended;
        continue;
      }
      // Path shrank or was otherwise restructured: full recalculate.
      next[path.id] = fitRouteBezierNodes(path.points);
    }
    return next;
  }, [bezierNodesByPath, paths]);

  // Synced bezier nodes for draw lines — computed from raw anchor points, cached per line id.
  const syncedBezierNodesByDrawLine = useMemo(() => {
    const next = { ...bezierNodesByDrawLine };
    for (const line of drawLines) {
      const existing = next[line.id];
      if (!existing || existing.length !== line.points.length) {
        next[line.id] = fitRouteBezierNodes(line.points.map((p) => ({ ...p, nodeType: "smooth" as const })));
      }
    }
    return next;
  }, [bezierNodesByDrawLine, drawLines]);

  const bezierSampledPaths = useMemo(
    () => paths.map((path) => {
      const bezierNodes = syncedBezierNodesByPath[path.id];
      if (!bezierNodes || bezierNodes.length !== path.points.length || bezierNodes.length < 2) {
        return path;
      }
      return { ...path, points: sampleBezierRouteToTimedPoints(path.points, bezierNodes) };
    }),
    [paths, syncedBezierNodesByPath],
  );

  const playbackStates = useMemo(
    () => getDrillPlaybackStates(bezierSampledPaths, playbackTimeSec).filter((s) => s.isVisible),
    [bezierSampledPaths, playbackTimeSec],
  );

  const activePlaybackEventIds = useMemo(
    () => new Set(getPlaybackEventsAtTime(derivedEvents, playbackTimeSec).map((e) => e.id)),
    [derivedEvents, playbackTimeSec],
  );

  const passTrajectories = useMemo(() => {
    return derivedEvents
      .filter((e) => e.type === "pass" && Array.isArray(e.actorIds) && e.actorIds.length >= 2 && e.endTimeSec !== undefined)
      .map((e) => {
        const fromPathId = typeof e.data?.fromPathId === "string" ? e.data.fromPathId : null;
        const toPathId = typeof e.data?.toPathId === "string" ? e.data.toPathId : null;
        const passerPath = bezierSampledPaths.find((p) => p.id === fromPathId) ?? bezierSampledPaths.find((p) => p.actorId === e.actorIds![0]);
        const receiverPath = bezierSampledPaths.find((p) => p.id === toPathId) ?? bezierSampledPaths.find((p) => p.actorId === e.actorIds![1]);
        if (!passerPath || !receiverPath) return null;
        const passPos = getPathPlaybackState(passerPath, e.timeSec)?.position;
        const receivePos = getPathPlaybackState(receiverPath, e.endTimeSec!)?.position;
        if (!passPos || !receivePos) return null;
        return { id: e.id, fromXFt: passPos.xFt, fromYFt: passPos.yFt, toXFt: receivePos.xFt, toYFt: receivePos.yFt };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);
  }, [derivedEvents, bezierSampledPaths]);

  const handleEditorKeydown = useEffectEvent((event: KeyboardEvent) => {
    if (isEditableElement(event.target)) return;

    const key = event.key.toLowerCase();
    const hasPrimaryModifier = (event.ctrlKey || event.metaKey) && !event.altKey;

    if (hasPrimaryModifier && key === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        redoLastChange();
      } else {
        undoLastChange();
      }
      return;
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey && key === "y") {
      event.preventDefault();
      redoLastChange();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (!canDeleteSelection) return;
      event.preventDefault();
      deleteCurrentSelection();
      return;
    }

    if (event.key !== "Escape") return;
    setSelectedNodeIndex(null);
    setPieMenuOpen(false);
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleEditorKeydown(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    playbackTimeRef.current = playbackTimeSec;
  }, [playbackTimeSec]);

  useEffect(() => {
    const clamped = clamp(playbackTimeRef.current, playbackWindow.startTimeSec, playbackWindow.endTimeSec);
    playbackTimeRef.current = clamped;
    setPlaybackTimeSec(clamped);
  }, [playbackWindow.endTimeSec, playbackWindow.startTimeSec]);

  useEffect(() => {
    if (!isPlaying) {
      playbackLastTickRef.current = null;
      if (playbackFrameRef.current !== null) {
        cancelAnimationFrame(playbackFrameRef.current);
        playbackFrameRef.current = null;
      }
      return;
    }

    function tick(timestamp: number) {
      if (playbackLastTickRef.current === null) {
        playbackLastTickRef.current = timestamp;
        lastScrubberTickRef.current = timestamp;
        playbackFrameRef.current = requestAnimationFrame(tick);
        return;
      }
      const deltaSec = (timestamp - playbackLastTickRef.current) / 1000;
      playbackLastTickRef.current = timestamp;
      const nextTimeSec = playbackTimeRef.current + deltaSec;

      if (nextTimeSec >= playbackWindow.endTimeSec) {
        playbackTimeRef.current = playbackWindow.endTimeSec;
        setPlaybackTimeSec(playbackWindow.endTimeSec);
        setIsPlaying(false);
        return;
      }
      playbackTimeRef.current = nextTimeSec;
      // Throttle React state updates to ~15fps — PlaybackLayer reads the ref at full 60fps
      if (timestamp - lastScrubberTickRef.current >= 67) {
        setPlaybackTimeSec(nextTimeSec);
        lastScrubberTickRef.current = timestamp;
      }
      playbackFrameRef.current = requestAnimationFrame(tick);
    }

    playbackFrameRef.current = requestAnimationFrame(tick);
    return () => {
      playbackLastTickRef.current = null;
      if (playbackFrameRef.current !== null) {
        cancelAnimationFrame(playbackFrameRef.current);
        playbackFrameRef.current = null;
      }
    };
  }, [isPlaying, playbackWindow.endTimeSec]);

  // ── Snapshot helpers ──────────────────────────────────────────────────────

  function createSnapshot(): EditorSnapshot {
    return {
      actors: actors.map((a) => ({ ...a })),
      annotations: annotations.map((a) => ({ ...a, metadata: a.metadata ? { ...a.metadata } : undefined })),
      paths: paths.map((p) => ({ ...p, points: p.points.map((pt) => ({ ...pt })) })),
      drawLines: drawLines.map((l) => ({ ...l, points: l.points.map((p) => ({ ...p })) })),
      activeActorId,
      activeTool,
      nextAction,
      showCurvedPaths,
      curveIntensity,
      curveModeByActor: { ...curveModeByActor },
      selectedAnnotationId,
      selectedDrawLineId,
      selectedPoint: selectedPoint ? { ...selectedPoint, zoneNames: [...selectedPoint.zoneNames] } : null,
    };
  }

  function applySnapshot(snapshot: EditorSnapshot) {
    setActors(snapshot.actors.map((a) => ({ ...a })));
    setAnnotations(snapshot.annotations.map((a) => ({
      ...a,
      metadata: a.metadata ? { ...a.metadata } : undefined,
    })));
    setPaths(snapshot.paths.map((p) => ({ ...p, points: p.points.map((pt) => ({ ...pt })) })));
    setDrawLines(snapshot.drawLines.map((l) => ({ ...l, points: l.points.map((p) => ({ ...p })) })));
    setActiveActorId(snapshot.activeActorId);
    setSelectedRouteActorId(snapshot.activeActorId);
    setActiveTool(snapshot.activeTool);
    setNextAction(snapshot.nextAction);
    setShowCurvedPaths(snapshot.showCurvedPaths);
    setCurveIntensity(snapshot.curveIntensity);
    setCurveModeByActor({ ...snapshot.curveModeByActor });
    setSelectedAnnotationId(snapshot.selectedAnnotationId);
    setSelectedDrawLineId(snapshot.selectedDrawLineId);
    setSelectedPoint(snapshot.selectedPoint ? { ...snapshot.selectedPoint, zoneNames: [...snapshot.selectedPoint.zoneNames] } : null);
    setSelectedNodeIndex(null);
  }

  function setActiveActor(actorId: string | null) {
    setActiveActorId(actorId);
    setSelectedRouteActorId(actorId);
    setSelectedNodeIndex(null);
  }

  function clearCanvasSelection() {
    setSelectedRouteActorId(null);
    setSelectedNodeIndex(null);
    setSelectedAnnotationId(null);
    setSelectedDrawLineId(null);
    setPieMenuOpen(false);
  }

  function commitSnapshot(nextSnapshot: EditorSnapshot) {
    setUndoStack((current) => [...current, createSnapshot()]);
    setRedoStack([]);
    applySnapshot(nextSnapshot);
  }

  function updateWithHistory(updater: (current: EditorSnapshot) => EditorSnapshot) {
    setNotification(null);
    commitSnapshot(updater(createSnapshot()));
  }

  function undoLastChange() {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    const current = createSnapshot();
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, current]);
    applySnapshot(previous);
  }

  function redoLastChange() {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    const current = createSnapshot();
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, current]);
    applySnapshot(next);
  }

  function removeSelectedNode() {
    if (selectedNodeIndex === null) return;

    const actor = actors.find((entry) => entry.id === activeActorId);
    const maxFtPerSec = getEffectiveActorMaxFtPerSec(ageGroup, actor);

    updateWithHistory((current) => ({
      ...current,
      paths: current.paths.map((path) => {
        if (path.actorId !== current.activeActorId) return path;
        if (path.points.length <= 1) return path;

        const nextPoints = path.points.filter((_, index) => index !== selectedNodeIndex);
        return {
          ...path,
          points: retimePathPoints(nextPoints, maxFtPerSec),
        };
      }),
    }));

    setSelectedNodeIndex(null);
    setPieMenuOpen(false);
  }

  function deleteCurrentSelection() {
    if (selectedDrawLineId) {
      removeDrawLine(selectedDrawLineId);
      return;
    }

    if (selectedAnnotationId) {
      removeAnnotation(selectedAnnotationId);
      setPieMenuOpen(false);
      return;
    }

    if (selectedNodeIndex !== null) {
      removeSelectedNode();
      return;
    }

    if (pieMenuOpen && selectedRouteActorId) {
      removeActor(selectedRouteActorId);
      setPieMenuOpen(false);
    }
  }

  // ── Actor management ──────────────────────────────────────────────────────

  function addActor(teamRole: SerializedActor["teamRole"]) {
    const prefix = teamRole ?? "neutral";
    const count = actors.filter((a) => (a.teamRole ?? "neutral") === prefix).length + 1;
    const actorId = `${prefix}-actor-${nextActorIdRef.current++}`;
    const { label: actorName, positionTag } = getNextPositionLabelForTeam(prefix, actors);
    const actor: SerializedActor = { id: actorId, name: actorName, teamRole, metadata: { positionTag } };
    updateWithHistory((current) => ({
      ...current,
      actors: [...current.actors, actor],
      paths: [
        ...current.paths,
        createDefaultPathForActor(actor, count - 1),
      ],
      activeActorId: actorId,
      curveModeByActor: { ...current.curveModeByActor, [actorId]: true },
    }));
  }

  function placeNewPlayerAtPoint(teamRole: SerializedActor["teamRole"], point: { xFt: number; yFt: number }) {
    const prefix = teamRole ?? "neutral";
    const actorId = `${prefix}-actor-${nextActorIdRef.current++}`;
    const { label: actorName, positionTag } = getNextPositionLabelForTeam(prefix, actors);
    const actor: SerializedActor = { id: actorId, name: actorName, teamRole, metadata: { positionTag } };
    updateWithHistory((current) => ({
      ...current,
      actors: [...current.actors, actor],
      paths: [
        ...current.paths,
        {
          id: `${actorId}-path`,
          actorId,
          label: `${actorName} Path`,
          teamRole,
          points: [{ xFt: point.xFt, yFt: point.yFt, timeSec: 0, action: "carry" as RuntimePathAction }],
        },
      ],
      activeActorId: actorId,
      activeTool: "select",
      curveModeByActor: { ...current.curveModeByActor, [actorId]: true },
    }));

    setRouteGestureMode("extend");
  }

  function removeActor(actorId: string | null) {
    if (!actorId) return;

    const remaining = actors.filter((a) => a.id !== actorId);
    updateWithHistory((current) => ({
      ...current,
      actors: current.actors.filter((a) => a.id !== actorId),
      paths: current.paths.filter((p) => p.actorId !== actorId),
      activeActorId: current.activeActorId === actorId ? (remaining[0]?.id ?? null) : current.activeActorId,
      curveModeByActor: Object.fromEntries(
        Object.entries(current.curveModeByActor).filter(([k]) => k !== actorId),
      ),
    }));
  }

  function updateActorName(actorId: string, name: string) {
    updateWithHistory((current) => ({
      ...current,
      actors: current.actors.map((a) => a.id === actorId ? { ...a, name } : a),
      paths: current.paths.map((p) => p.actorId === actorId ? { ...p, label: `${name || actorId} Path` } : p),
    }));
  }

  function updateActorTeamRole(actorId: string, teamRole: SerializedActor["teamRole"]) {
    updateWithHistory((current) => ({
      ...current,
      actors: current.actors.map((a) => a.id === actorId ? { ...a, teamRole } : a),
      paths: current.paths.map((p) => p.actorId === actorId ? { ...p, teamRole } : p),
    }));
  }

  function updateActorEditorState(actorId: string, partial: Partial<ActorEditorState>) {
    updateWithHistory((current) => {
      const nextActors = current.actors.map((actor) => {
        if (actor.id !== actorId) {
          if (partial.hasPuck === true) {
            return { ...actor, metadata: buildActorMetadata(actor.metadata, { hasPuck: false }) };
          }
          return actor;
        }
        return { ...actor, metadata: buildActorMetadata(actor.metadata, partial) };
      });

      let nextPaths = current.paths;
      if ("speedTier" in partial) {
        const nextActor = nextActors.find((a) => a.id === actorId);
        const maxFtPerSec = getEffectiveActorMaxFtPerSec(ageGroup, nextActor);
        nextPaths = current.paths.map((path) => {
          if (path.actorId !== actorId || path.points.length === 0) return path;
          const newPoints = respeedPath(path.points, maxFtPerSec);
          return { ...path, points: newPoints, metrics: buildPathMetrics(newPoints) };
        });
      }

      return { ...current, actors: nextActors, paths: nextPaths };
    });
  }

  function setActorCustomColor(actorId: string, color: string | null) {
    updateWithHistory((current) => ({
      ...current,
      actors: current.actors.map((actor) => {
        if (actor.id !== actorId) return actor;
        const next = isRecord(actor.metadata) ? { ...actor.metadata } : {};
        if (color) {
          next.customColor = color;
        } else {
          delete next.customColor;
        }
        return { ...actor, metadata: Object.keys(next).length > 0 ? next : undefined };
      }),
    }));
  }

  function setPathStartStage(actorId: string, startStage: number) {
    updateWithHistory((current) => ({
      ...current,
      paths: current.paths.map((path) => {
        if (path.actorId !== actorId || path.points.length === 0) return path;
        const base = path.points[0].timeSec ?? 0;
        const nextPoints = path.points.map((pt, index) => ({
          ...pt,
          timeSec: (pt.timeSec ?? index) - base + (startStage - 1),
        }));
        return { ...path, points: nextPoints, metrics: buildPathMetrics(nextPoints) };
      }),
    }));
  }

  // ── Path management ───────────────────────────────────────────────────────

  function updateSelectedPoint(point: { xFt: number; yFt: number }) {
    const zoneNames = getContainingSemanticZones(hockeyCanadaRinkSpec, point).map((z) => z.name);
    setSelectedPoint({ xFt: point.xFt, yFt: point.yFt, zoneNames });
  }

  function commitFreehandDrawLine(drawnPoints: Array<{ xFt: number; yFt: number }>) {
    if (drawnPoints.length < 2) return;
    const fittedPoints = fitFreehandCurveAnchors(drawnPoints);
    if (fittedPoints.length < 2) return;

    const replacingId = editingDrawLineId;
    setEditingDrawLineId(null);

    if (replacingId) {
      // Edit path mode: replace the existing line's points, keep all other props
      const editedLengthFt = measurePolylineDistanceFeet(fittedPoints);
      updateWithHistory((current) => ({
        ...current,
        drawLines: current.drawLines.map((l) =>
          l.id === replacingId ? { ...l, points: fittedPoints, totalLengthFt: editedLengthFt } : l,
        ),
        selectedDrawLineId: replacingId,
      }));
      setActiveTool("select");
    } else {
      // Normal mode: create a new standalone draw line
      const id = `draw-line-${Date.now()}-${nextDrawLineIdRef.current++}`;
      const newLine: SerializedDrawLine = { id, points: fittedPoints, totalLengthFt: measurePolylineDistanceFeet(fittedPoints), attachedActorId: null };
      updateWithHistory((current) => ({
        ...current,
        drawLines: [...current.drawLines, newLine],
        selectedDrawLineId: id,
      }));
    }
    setPieMenuOpen(true);
  }

  function _attachPlayerToDrawLine(drawLineId: string, actorId: string) {
    const drawLine = drawLines.find((l) => l.id === drawLineId);
    if (!drawLine || drawLine.points.length < 2) return;
    const actor = actors.find((a) => a.id === actorId);
    const maxFtPerSec = getEffectiveActorMaxFtPerSec(ageGroup, actor);
    const fittedPoints = fitFreehandCurveAnchors(drawLine.points);
    if (fittedPoints.length < 2) return;
    const startPoint: TimedPathPoint = {
      xFt: fittedPoints[0].xFt,
      yFt: fittedPoints[0].yFt,
      timeSec: 0,
      action: "carry" as RuntimePathAction,
    };
    const newPoints = fitPathPointsToLine([startPoint], fittedPoints.slice(1), "carry", maxFtPerSec);
    updateWithHistory((current) => ({
      ...current,
      drawLines: current.drawLines.map((l) =>
        l.id === drawLineId ? { ...l, attachedActorId: actorId } : l,
      ),
      paths: current.paths.map((path) => {
        if (path.actorId !== actorId) return path;
        return { ...path, points: newPoints };
      }),
      activeActorId: actorId,
      selectedDrawLineId: null,
    }));
    setPieMenuOpen(false);
  }

  function detachPlayerFromDrawLine(drawLineId: string) {
    updateWithHistory((current) => ({
      ...current,
      drawLines: current.drawLines.map((l) =>
        l.id === drawLineId ? { ...l, attachedActorId: null } : l,
      ),
      selectedDrawLineId: drawLineId,
    }));
    setPieMenuOpen(false);
  }

  function removeDrawLine(drawLineId: string) {
    updateWithHistory((current) => ({
      ...current,
      drawLines: current.drawLines.filter((l) => l.id !== drawLineId),
      selectedDrawLineId: current.selectedDrawLineId === drawLineId ? null : current.selectedDrawLineId,
    }));
    setPieMenuOpen(false);
  }

  function updateDrawLineProps(
    drawLineId: string,
    props: Partial<Pick<SerializedDrawLine, "color" | "lineType" | "lineWeight" | "startArrow" | "endArrow">>,
  ) {
    updateWithHistory((current) => ({
      ...current,
      drawLines: current.drawLines.map((l) => l.id === drawLineId ? { ...l, ...props } : l),
    }));
  }

  function translateDrawLineLive(
    drawLineId: string,
    pointerStart: { xFt: number; yFt: number },
    originPoints: Array<{ xFt: number; yFt: number }>,
    currentPoint: { xFt: number; yFt: number },
  ) {
    const dx = currentPoint.xFt - pointerStart.xFt;
    const dy = currentPoint.yFt - pointerStart.yFt;
    setDrawLines((current) =>
      current.map((l) =>
        l.id === drawLineId
          ? { ...l, points: originPoints.map((p) => ({ xFt: p.xFt + dx, yFt: p.yFt + dy })) }
          : l,
      ),
    );
    setBezierNodesByDrawLine((currentBez) => {
      const existing = currentBez[drawLineId];
      if (!existing) return currentBez;
      return {
        ...currentBez,
        [drawLineId]: existing.map((node) => ({
          ...node,
          xFt: node.xFt + dx,
          yFt: node.yFt + dy,
          cp1Ft: node.cp1Ft ? { xFt: node.cp1Ft.xFt + dx, yFt: node.cp1Ft.yFt + dy } : undefined,
          cp2Ft: node.cp2Ft ? { xFt: node.cp2Ft.xFt + dx, yFt: node.cp2Ft.yFt + dy } : undefined,
        })),
      };
    });
  }

  function setDrawLineArrow(drawLineId: string, side: "start" | "end", type: DrawLineArrowType) {
    updateDrawLineProps(drawLineId, side === "start" ? { startArrow: type } : { endArrow: type });
  }

  function handleDrawLinePointerDown(event: React.PointerEvent, drawLineId: string) {
    event.stopPropagation();

    // If already selected in move mode, start a translate drag
    if (selectedDrawLineId === drawLineId && drawLineMode === "move") {
      const point = getRinkPointFromPointer(event.clientX, event.clientY);
      const originLine = drawLines.find((l) => l.id === drawLineId);
      if (point && originLine) {
        dragStartSnapshotRef.current = createSnapshot();
        dragMovedRef.current = false;
        setDragState({
          kind: "draw-line-translate",
          drawLineId,
          pointerStart: point,
          originPoints: originLine.points.map((p) => ({ ...p })),
        });
        overlaySvgRef.current?.setPointerCapture(event.pointerId);
      }
      return;
    }

    setSelectedDrawLineId(drawLineId);
    setSelectedAnnotationId(null);
    setDrawLineMode(null);
    setSelectedDrawLineNodeIndex(null);
    setPieMenuOpen(true);
  }

  function resetActivePath() {
    updateWithHistory((current) => ({
      ...current,
      paths: current.paths.map((p) =>
        p.actorId === current.activeActorId
          ? {
            ...p,
            points: p.points && p.points.length > 0
              ? [ { ...p.points[0] } ]
              : [
                createDefaultAnchorPoint(
                  current.actors.find((actor) => actor.id === p.actorId)?.teamRole,
                  current.actors
                    .filter((actor) => (actor.teamRole ?? "neutral") === (current.actors.find((actor) => actor.id === p.actorId)?.teamRole ?? "neutral"))
                    .findIndex((actor) => actor.id === p.actorId),
                ),
              ],
          }
          : p,
      ),
    }));
  }

  function _updateNodeAction(nodeIndex: number, action: RuntimePathAction) {
    updateWithHistory((snap) => ({
      ...snap,
      paths: snap.paths.map((p) =>
        p.actorId === snap.activeActorId
          ? { ...p, points: p.points.map((pt, i) => i === nodeIndex ? { ...pt, action } : pt) }
          : p,
      ),
    }));
  }

  function _updateNodePassTarget(nodeIndex: number, targetActorId: string | null) {
    updateWithHistory((snap) => ({
      ...snap,
      paths: snap.paths.map((p) => {
        if (p.actorId !== snap.activeActorId) return p;
        return {
          ...p,
          points: p.points.map((pt, i) => {
            if (i !== nodeIndex) return pt;
            const metadata: Record<string, unknown> = { ...(pt.metadata ?? {}) };
            if (targetActorId) {
              metadata.passTargetActorId = targetActorId;
            } else {
              delete metadata.passTargetActorId;
            }
            return { ...pt, metadata: Object.keys(metadata).length > 0 ? metadata : undefined };
          }),
        };
      }),
    }));
  }

  function _updateNodeBreakType(nodeIndex: number, breakType: NodeBreakType | null) {
    updateWithHistory((snap) => ({
      ...snap,
      paths: snap.paths.map((p) => {
        if (p.actorId !== snap.activeActorId) return p;
        return {
          ...p,
          points: p.points.map((pt, i) => {
            if (i !== nodeIndex) return pt;
            const metadata: Record<string, unknown> = { ...(pt.metadata ?? {}) };
            if (breakType) {
              metadata.breakType = breakType;
            } else {
              delete metadata.breakType;
            }
            return { ...pt, metadata: Object.keys(metadata).length > 0 ? metadata : undefined };
          }),
        };
      }),
    }));
  }

  function resetDrill() {
    const freshActors = INITIAL_ACTORS.map((a) => ({ ...a }));
    updateWithHistory(() => ({
      actors: freshActors,
      annotations: [],
      paths: freshActors.map((a, index) => createDefaultPathForActor(a, index)),
      drawLines: [],
      activeActorId: freshActors[0].id,
      activeTool: "select",
      nextAction: "carry",
      showCurvedPaths: true,
      curveIntensity: 0.65,
      curveModeByActor: buildCurveModesForActors(freshActors),
      selectedAnnotationId: null,
      selectedDrawLineId: null,
      selectedPoint: null,
    }));
    setIsPlaying(false);
    playbackTimeRef.current = 0;
    setPlaybackTimeSec(0);
    setDragState(null);
    setRouteGestureMode("extend");
  }

  function updatePathPointPosition(actorId: string, pointIndex: number, point: { xFt: number; yFt: number }) {
    setNotification(null);
    const actor = actors.find((a) => a.id === actorId);
    const maxFtPerSec = getEffectiveActorMaxFtPerSec(ageGroup, actor);
    setPaths((current) => {
      const next = current.map((path) => {
        if (path.actorId !== actorId) return path;
        const moved = path.points.map((entry, i) =>
          i === pointIndex ? { ...entry, xFt: point.xFt, yFt: point.yFt } : entry,
        );
        return { ...path, points: retimePathPoints(moved, maxFtPerSec) };
      });
      const updatedPath = next.find((p) => p.actorId === actorId);
      if (updatedPath) {
        setBezierNodesByPath((currentBez) => {
          const existing = currentBez[updatedPath.id];
          if (!existing) return currentBez;
          return {
            ...currentBez,
            [updatedPath.id]: moveRouteBezierNode(existing, pointIndex, point),
          };
        });
      }
      return next;
    });
  }

  function translateActorPath(
    actorId: string,
    pointerStart: { xFt: number; yFt: number },
    originPoints: Array<{ xFt: number; yFt: number }>,
    point: { xFt: number; yFt: number },
  ) {
    const deltaX = point.xFt - pointerStart.xFt;
    const deltaY = point.yFt - pointerStart.yFt;

    setNotification(null);
    setPaths((current) => {
      const next = current.map((path) => {
        if (path.actorId !== actorId) return path;
        return {
          ...path,
          points: path.points.map((entry, index) => ({
            ...entry,
            xFt: clamp(originPoints[index].xFt + deltaX, 0, hockeyCanadaRinkSpec.surface.lengthFt),
            yFt: clamp(originPoints[index].yFt + deltaY, 0, hockeyCanadaRinkSpec.surface.widthFt),
          })),
        };
      });
      const updatedPath = next.find((p) => p.actorId === actorId);
      if (updatedPath) {
        setBezierNodesByPath((currentBez) => {
          const existing = currentBez[updatedPath.id];
          if (!existing) return currentBez;
          const shifted = existing.map((node) => ({
            ...node,
            xFt: node.xFt + deltaX,
            yFt: node.yFt + deltaY,
            cp1Ft: node.cp1Ft ? { xFt: node.cp1Ft.xFt + deltaX, yFt: node.cp1Ft.yFt + deltaY } : undefined,
            cp2Ft: node.cp2Ft ? { xFt: node.cp2Ft.xFt + deltaX, yFt: node.cp2Ft.yFt + deltaY } : undefined,
          }));
          return { ...currentBez, [updatedPath.id]: shifted };
        });
      }
      return next;
    });
  }

  // ── Annotation management ─────────────────────────────────────────────────

  function addAnnotation(type: SerializedAnnotationType, point: { xFt: number; yFt: number }) {
    updateWithHistory((current) => {
      const annotation = buildAnnotation(type, point, current.annotations.length, activeActor?.teamRole);
      return { ...current, annotations: [...current.annotations, annotation], selectedAnnotationId: annotation.id };
    });
  }

  function removeAnnotation(annotationId: string) {
    updateWithHistory((current) => ({
      ...current,
      annotations: current.annotations.filter((a) => a.id !== annotationId),
      selectedAnnotationId: current.selectedAnnotationId === annotationId ? null : current.selectedAnnotationId,
    }));
  }

  function updateAnnotationPosition(annotationId: string, point: { xFt: number; yFt: number }) {
    setNotification(null);
    setAnnotations((current) => current.map((a) =>
      a.id === annotationId ? { ...a, xFt: point.xFt, yFt: point.yFt } : a,
    ));
  }

  function _updateAnnotationTeamRole(annotationId: string, teamRole: SerializedAnnotation["teamRole"]) {
    updateWithHistory((current) => ({
      ...current,
      annotations: current.annotations.map((a) =>
        a.id === annotationId ? { ...a, teamRole } : a,
      ),
    }));
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  function setPlaybackTime(nextTimeSec: number) {
    const clamped = clamp(nextTimeSec, playbackWindow.startTimeSec, playbackWindow.endTimeSec);
    playbackTimeRef.current = clamped;
    setPlaybackTimeSec(clamped);
  }

  function togglePlayback() {
    if (!paths.some((p) => p.points.length > 0)) {
      setNotification("Add at least one path node before playing.");
      return;
    }
    if (isPlaying) { setIsPlaying(false); return; }
    if (playbackTimeRef.current >= playbackWindow.endTimeSec - 0.05) {
      setPlaybackTime(playbackWindow.startTimeSec);
    }
    setIsPlaying(true);
    setNotification(null);
  }

  function restartPlayback() {
    setIsPlaying(false);
    setPlaybackTime(playbackWindow.startTimeSec);
  }

  // ── Export ────────────────────────────────────────────────────────────────

  function downloadCurrentJson() {
    const preview = JSON.stringify(serializedDrill, null, 2);
    const blob = new Blob([preview], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${serializedDrill.metadata.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotification("Drill saved.");
  }

  // ── Pointer / canvas interaction ──────────────────────────────────────────

  function getRinkPointFromPointer(clientX: number, clientY: number) {
    const svg = overlaySvgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const svgPoint = svg.createSVGPoint();
    svgPoint.x = clientX;
    svgPoint.y = clientY;
    const transformed = svgPoint.matrixTransform(matrix.inverse());
    return {
      xFt: clamp(transformed.x, 0, hockeyCanadaRinkSpec.surface.lengthFt),
      yFt: clamp(transformed.y, 0, hockeyCanadaRinkSpec.surface.widthFt),
    };
  }

  function handleOverlayClick(event: React.MouseEvent<SVGSVGElement>) {
    if (dragState || dragMovedRef.current) { dragMovedRef.current = false; return; }
    const target = event.target as HTMLElement;
    if (target.closest("[data-node-handle='true']")) return;
    if (target.closest("[data-annotation-handle='true']")) return;
    if (target.closest("[data-draw-line-handle='true']")) return;

    const point = getRinkPointFromPointer(event.clientX, event.clientY);
    if (!point) return;
    updateSelectedPoint(point);

    if (activeTool === "select") {
      clearCanvasSelection();
      return;
    }
    if (activeTool === "player") {
      setSelectedAnnotationId(null);
      placeNewPlayerAtPoint(activeActor?.teamRole ?? "home", point);
      return;
    }
    if (activeTool === "lineup" || activeTool === "draw" || activeTool === "zone") {
      return;
    }
    addAnnotation(activeTool as SerializedAnnotationType, point);
  }

  function handleOverlayPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    const isSketchGesture = activeTool === "draw";
    if (dragState || bezierDragRef.current || !isSketchGesture) return;

    const target = event.target as HTMLElement;
    if (target.closest("[data-node-handle='true']")) return;
    if (target.closest("[data-annotation-handle='true']")) return;
    if (target.closest("[data-draw-line-handle='true']")) return;

    const point = getRinkPointFromPointer(event.clientX, event.clientY);
    if (!point) return;

    let actorIdForDraft: string | null;
    let initialPoints: Array<{ xFt: number; yFt: number }>;

    actorIdForDraft = null;
    initialPoints = [point];

    dragMovedRef.current = false;
    setSelectedAnnotationId(null);
    setSelectedDrawLineId(null);
    updateSelectedPoint(point);
    freehandDraftRef.current = { actorId: actorIdForDraft, pointerId: event.pointerId, points: initialPoints };
    setFreehandDraftActorId(actorIdForDraft);
    setFreehandDraftPoints(initialPoints);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleActorTokenPointerDown(event: React.PointerEvent<SVGGElement>, actorId: string) {
    const path = paths.find((entry) => entry.actorId === actorId);
    if (!path?.points.length) return;

    const pointerPoint = getRinkPointFromPointer(event.clientX, event.clientY)
      ?? { xFt: path.points[0].xFt, yFt: path.points[0].yFt };
    const draftStart = path.points.at(-1) ?? path.points[0];

    event.stopPropagation();
    dragMovedRef.current = false;
    dragStartSnapshotRef.current = createSnapshot();
    setActiveActor(actorId);
    setSelectedDrawLineId(null);
    setSelectedAnnotationId(null);
    setSelectedNodeIndex(null);
    setActiveTool("select");
    updateSelectedPoint(pointerPoint);
    setPieMenuOpen(false);
    pendingSelectionGestureRef.current = {
      kind: "actor",
      actorId,
      pointerId: event.pointerId,
      pointerStart: pointerPoint,
      draftStart: { xFt: draftStart.xFt, yFt: draftStart.yFt },
      routeMode: event.shiftKey || routeGestureMode === "move-route" ? "move-route" : "extend",
    };
  }

  function handleNodePointerDown(event: React.PointerEvent, actorId: string, pointIndex: number) {
    if (actorId !== activeActorId) return;
    event.stopPropagation();
    dragMovedRef.current = false;
    dragStartSnapshotRef.current = createSnapshot();
    setSelectedRouteActorId(actorId);
    setSelectedAnnotationId(null);
    setActiveTool("select");
    setDragState({ kind: "path-point", actorId, pointIndex });
  }

  function handleNodeClick(actorId: string, nodeIndex: number) {
    if (dragMovedRef.current) return;
    if (actorId !== activeActorId) return;
    setSelectedRouteActorId(actorId);
    setSelectedNodeIndex((prev) => (prev === nodeIndex && activeActorId === actorId) ? null : nodeIndex);
  }

  function handleBezierGroupPointerDown(
    event: React.PointerEvent,
    pathId: string,
    nodeIndex: number,
    handleType: "cp1Ft" | "cp2Ft",
    cp: { xFt: number; yFt: number },
  ) {
    event.stopPropagation();
    event.preventDefault();
    const path = paths.find((entry) => entry.id === pathId);
    if (path) {
      setActiveActor(path.actorId);
      setSelectedRouteActorId(path.actorId);
    }
    const initialPointer = getRinkPointFromPointer(event.clientX, event.clientY) ?? cp;
    const drag: BezierHandleDrag = { pointerId: event.pointerId, pathId, nodeIndex, handleType, initialPointer, initialCp: cp };
    bezierDragRef.current = drag;
    dragMovedRef.current = false;
    dragStartSnapshotRef.current = createSnapshot();

    function onMove(e: PointerEvent) {
      if (e.pointerId !== drag.pointerId) return;
      const point = getRinkPointFromPointer(e.clientX, e.clientY);
      if (!point) return;
      dragMovedRef.current = true;
      const newCp = {
        xFt: drag.initialCp.xFt + (point.xFt - drag.initialPointer.xFt),
        yFt: drag.initialCp.yFt + (point.yFt - drag.initialPointer.yFt),
      };
      setBezierNodesByPath((current) => {
        const existing = current[drag.pathId];
        if (!existing) return current;
        return { ...current, [drag.pathId]: moveRouteBezierHandle(existing, drag.nodeIndex, drag.handleType, newCp) };
      });
    }

    function onUp(e: PointerEvent) {
      if (e.pointerId !== drag.pointerId) return;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      bezierDragRef.current = null;
      if (dragMovedRef.current && dragStartSnapshotRef.current) {
        setUndoStack((s) => [...s, dragStartSnapshotRef.current!]);
        setRedoStack([]);
      }
      dragStartSnapshotRef.current = null;
    }

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  }

  function handleDrawLineBezierNodePointerDown(
    event: React.PointerEvent,
    drawLineId: string,
    nodeIndex: number,
  ) {
    event.stopPropagation();
    event.preventDefault();
    dragMovedRef.current = false;
    dragStartSnapshotRef.current = createSnapshot();
    setSelectedDrawLineNodeIndex(nodeIndex);
    setDragState({ kind: "draw-line-bezier-node", drawLineId, nodeIndex });
    overlaySvgRef.current?.setPointerCapture(event.pointerId);
  }

  function handleDrawLineBezierHandlePointerDown(
    event: React.PointerEvent,
    drawLineId: string,
    nodeIndex: number,
    handleType: "cp1Ft" | "cp2Ft",
    cp: { xFt: number; yFt: number },
  ) {
    event.stopPropagation();
    event.preventDefault();
    const initialPointer = getRinkPointFromPointer(event.clientX, event.clientY) ?? cp;
    const drag: BezierHandleDrag & { drawLineId: string } = {
      drawLineId,
      pointerId: event.pointerId,
      pathId: drawLineId,
      nodeIndex,
      handleType,
      initialPointer,
      initialCp: cp,
    };
    drawLineBezierDragRef.current = drag;
    dragMovedRef.current = false;
    dragStartSnapshotRef.current = createSnapshot();
    // Capture the synced nodes at drag-start as a fallback; bezierNodesByDrawLine may be
    // empty if the nodes were auto-fitted by syncedBezierNodesByDrawLine but never written
    // back to state (e.g., the first time a handle is dragged on a newly-loaded draw line).
    const dragStartNodes = syncedBezierNodesByDrawLine[drawLineId];

    function onMove(e: PointerEvent) {
      if (e.pointerId !== drag.pointerId) return;
      const point = getRinkPointFromPointer(e.clientX, e.clientY);
      if (!point) return;
      dragMovedRef.current = true;
      const newCp = {
        xFt: drag.initialCp.xFt + (point.xFt - drag.initialPointer.xFt),
        yFt: drag.initialCp.yFt + (point.yFt - drag.initialPointer.yFt),
      };
      setBezierNodesByDrawLine((current) => {
        const existing = current[drag.drawLineId] ?? dragStartNodes;
        if (!existing) return current;
        return { ...current, [drag.drawLineId]: moveRouteBezierHandle(existing, drag.nodeIndex, drag.handleType, newCp) };
      });
    }

    function onUp(e: PointerEvent) {
      if (e.pointerId !== drag.pointerId) return;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      drawLineBezierDragRef.current = null;
      if (dragMovedRef.current && dragStartSnapshotRef.current) {
        setUndoStack((s) => [...s, dragStartSnapshotRef.current!]);
        setRedoStack([]);
      }
      dragStartSnapshotRef.current = null;
    }

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  }

  function handleAnnotationPointerDown(event: React.PointerEvent<SVGGElement>, annotationId: string) {
    const pointerPoint = getRinkPointFromPointer(event.clientX, event.clientY);

    event.stopPropagation();
    dragMovedRef.current = false;
    dragStartSnapshotRef.current = createSnapshot();
    setSelectedAnnotationId(annotationId);
    setSelectedDrawLineId(null);
    setSelectedRouteActorId(null);
    setActiveTool("select");
    setSelectedNodeIndex(null);
    setPieMenuOpen(false);
    if (pointerPoint) {
      updateSelectedPoint(pointerPoint);
      pendingSelectionGestureRef.current = {
        kind: "annotation",
        annotationId,
        pointerId: event.pointerId,
        pointerStart: pointerPoint,
      };
      return;
    }

    pendingSelectionGestureRef.current = null;
    setPieMenuOpen(true);
  }

  function handleOverlayPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (bezierDragRef.current) return;

    const pendingGesture = pendingSelectionGestureRef.current;
    if (pendingGesture && pendingGesture.pointerId === event.pointerId) {
      const point = getRinkPointFromPointer(event.clientX, event.clientY);
      if (!point) return;

      updateSelectedPoint(point);
      if (distanceBetweenPoints(point, pendingGesture.pointerStart) < TAP_DRAG_THRESHOLD_FT) {
        return;
      }

      dragMovedRef.current = true;
      setPieMenuOpen(false);

      if (pendingGesture.kind === "actor") {
        const actorPath = paths.find((entry) => entry.actorId === pendingGesture.actorId);
        if (!actorPath?.points.length) {
          pendingSelectionGestureRef.current = null;
          dragStartSnapshotRef.current = null;
          return;
        }

        if (pendingGesture.routeMode === "move-route") {
          setDragState({
            kind: "route-translate",
            actorId: pendingGesture.actorId,
            pointerStart: pendingGesture.pointerStart,
            originPoints: actorPath.points.map((pathPoint) => ({ xFt: pathPoint.xFt, yFt: pathPoint.yFt })),
          });
          overlaySvgRef.current?.setPointerCapture(event.pointerId);
          translateActorPath(
            pendingGesture.actorId,
            pendingGesture.pointerStart,
            actorPath.points.map((pathPoint) => ({ xFt: pathPoint.xFt, yFt: pathPoint.yFt })),
            point,
          );
        } else {
          // Player route drawing is disabled
        }
      } else {
        setDragState({ kind: "annotation", annotationId: pendingGesture.annotationId });
        overlaySvgRef.current?.setPointerCapture(event.pointerId);
        updateAnnotationPosition(pendingGesture.annotationId, point);
      }

      pendingSelectionGestureRef.current = null;
      return;
    }

    const freehandDraft = freehandDraftRef.current;
    if (freehandDraft && freehandDraft.pointerId === event.pointerId) {
      const point = getRinkPointFromPointer(event.clientX, event.clientY);
      if (!point) return;

      const nextPoints = appendFreehandPoint(freehandDraft.points, point, FREEHAND_POINT_SPACING_FT);
      if (nextPoints !== freehandDraft.points) {
        freehandDraftRef.current = { ...freehandDraft, points: nextPoints };
        setFreehandDraftPoints(nextPoints);
        if (nextPoints.length > 1) {
          dragMovedRef.current = true;
          setPieMenuOpen(false);
        }
      }

      updateSelectedPoint(point);
      return;
    }

    if (!dragState) return;
    const point = getRinkPointFromPointer(event.clientX, event.clientY);
    if (!point) return;
    dragMovedRef.current = true;
    if (dragState.kind === "path-point") {
      updatePathPointPosition(dragState.actorId, dragState.pointIndex, point);
    } else if (dragState.kind === "route-translate") {
      translateActorPath(dragState.actorId, dragState.pointerStart, dragState.originPoints, point);
    } else if (dragState.kind === "draw-line-translate") {
      translateDrawLineLive(dragState.drawLineId, dragState.pointerStart, dragState.originPoints, point);
    } else if (dragState.kind === "draw-line-point") {
      setDrawLines((current) =>
        current.map((l) =>
          l.id === dragState.drawLineId
            ? { ...l, points: l.points.map((p, i) => i === dragState.pointIndex ? { xFt: point.xFt, yFt: point.yFt } : p) }
            : l,
        ),
      );
    } else if (dragState.kind === "draw-line-bezier-node") {
      setBezierNodesByDrawLine((current) => {
        const existing = current[dragState.drawLineId];
        if (!existing) return current;
        return { ...current, [dragState.drawLineId]: moveRouteBezierNode(existing, dragState.nodeIndex, point) };
      });
      setDrawLines((current) =>
        current.map((l) => {
          if (l.id !== dragState.drawLineId) return l;
          const nextPoints = l.points.map((p, i) => i === dragState.nodeIndex ? { xFt: point.xFt, yFt: point.yFt } : p);
          return { ...l, points: nextPoints, totalLengthFt: measurePolylineDistanceFeet(nextPoints) };
        }),
      );
    } else {
      updateAnnotationPosition(dragState.annotationId, point);
      setPieMenuOpen(false);
    }
    updateSelectedPoint(point);
  }

  function handleOverlayPointerUp(event?: React.PointerEvent<SVGSVGElement>) {
    const bezierDrag = bezierDragRef.current;
    if (bezierDrag && (!event || bezierDrag.pointerId === event.pointerId)) {
      bezierDragRef.current = null;
      if (dragMovedRef.current && dragStartSnapshotRef.current) {
        setUndoStack((s) => [...s, dragStartSnapshotRef.current!]);
        setRedoStack([]);
      }
      dragStartSnapshotRef.current = null;
      return;
    }

    const dlBezierDrag = drawLineBezierDragRef.current;
    if (dlBezierDrag && (!event || dlBezierDrag.pointerId === event.pointerId)) {
      drawLineBezierDragRef.current = null;
      if (dragMovedRef.current && dragStartSnapshotRef.current) {
        setUndoStack((s) => [...s, dragStartSnapshotRef.current!]);
        setRedoStack([]);
      }
      dragStartSnapshotRef.current = null;
      return;
    }

    const pendingGesture = pendingSelectionGestureRef.current;
    if (pendingGesture && (!event || pendingGesture.pointerId === event.pointerId)) {
      const point = event ? getRinkPointFromPointer(event.clientX, event.clientY) : null;
      if (point) {
        updateSelectedPoint(point);
      }
      pendingSelectionGestureRef.current = null;
      dragStartSnapshotRef.current = null;

      if (!event || event.type === "pointerup") {
        setPieMenuOpen(true);
      }
      return;
    }

    const freehandDraft = freehandDraftRef.current;
    if (freehandDraft && (!event || freehandDraft.pointerId === event.pointerId)) {
      const point = event ? getRinkPointFromPointer(event.clientX, event.clientY) : null;
      const completedPoints = point
        ? appendFreehandPoint(freehandDraft.points, point, 0)
        : freehandDraft.points;

      if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      freehandDraftRef.current = null;
      setFreehandDraftActorId(null);
      setFreehandDraftPoints([]);

      dragMovedRef.current = true;

      // Clean tap (no drag) → just cancel the freehand, pie already opened in pointer down
      if (completedPoints.length <= 1) {
        return;
      }

      if (point) {
        updateSelectedPoint(point);
      }

      commitFreehandDrawLine(completedPoints);
      return;
    }

    if (dragMovedRef.current && dragStartSnapshotRef.current) {
      const prev = dragStartSnapshotRef.current;
      setUndoStack((s) => [...s, prev]);
      setRedoStack([]);

      if (dragState?.kind === "path-point") {
        const movedActorId = dragState.actorId;
        const movedActor = actors.find((a) => a.id === movedActorId);
        const maxFtPerSec = getEffectiveActorMaxFtPerSec(ageGroup, movedActor);
        setPaths((current) => current.map((path) => {
          if (path.actorId !== movedActorId) return path;
          return { ...path, points: respeedPath(path.points, maxFtPerSec) };
        }));
      }
    }

    dragStartSnapshotRef.current = null;
    const wasDlTranslate = dragState?.kind === "draw-line-translate";
    setDragState(null);
    if (wasDlTranslate) setPieMenuOpen(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="wb-shell">

      {/* ── Drill header ── */}
      <div className="wb-drill-header">
        <a href="#" className="wb-back-link">← DRILL LIBRARY</a>
        <div className="wb-category-strip">
          {DRILL_CATEGORIES.map((cat) => (
            <span key={cat} className="wb-category-chip">{cat}</span>
          ))}
        </div>
        <div className="wb-view-toggle-group">
          <button type="button" className="wb-view-btn">PLAYER VIEW</button>
          <button type="button" className="wb-view-btn wb-view-btn--active">COACH EDIT</button>
        </div>
      </div>

      {/* ── Save row ── */}
      <div className="wb-save-row">
        <button type="button" onClick={downloadCurrentJson} className="wb-btn--save">SAVE</button>
      </div>

      {/* ── Main panel ── */}
      <div className="wb-main-panel">

        {/* Toolbar */}
        <div className="wb-toolbar-row">
          <div className="wb-toolbar-left">
            <select defaultValue="nhl-full-ice" className="wb-select wb-select--auto" aria-label="Rink preset">
              <option value="nhl-full-ice">NHL Full Ice</option>
            </select>
          </div>

          <div className="wb-toolbar-center">
            {EDITOR_TOOL_ITEMS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setActiveTool(item.value);
                }}
                className={`wb-tool-btn${activeTool === item.value ? " wb-tool-btn--active" : ""}`}
              >
                <span className="wb-tool-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          <div className="wb-toolbar-right">
            <div className="wb-toolbar-divider" />
            <button type="button" onClick={undoLastChange} disabled={!canUndo} className="wb-tool-btn">
              <span className="wb-tool-icon">⟳</span> UNDO
            </button>
            <button type="button" onClick={redoLastChange} disabled={!canRedo} className="wb-tool-btn">
              <span className="wb-tool-icon">⟲</span> REDO
            </button>
            <button type="button" onClick={downloadCurrentJson} className="wb-tool-btn wb-tool-btn--png">
              <span className="wb-tool-icon">↓</span> PNG
            </button>
          </div>
        </div>

        {/* Notification */}
        {notification && (
          <div className="wb-status-bar">
            <span>{notification}</span>
            <button type="button" className="wb-status-dismiss" onClick={() => setNotification(null)}>✕</button>
          </div>
        )}

        {/* Rink canvas + floating panel */}
        <div className="wb-rink-canvas-wrap">
          <RinkCanvas
            spec={hockeyCanadaRinkSpec}
            settings={{
              showGrid: false,
              showSemanticZones: showZones,
              showDoors: false,
              lineThicknessScale: 1,
            }}
            height="min(64vh, 680px)"
          />

          {/* Overlay SVG */}
          <svg
            ref={overlaySvgRef}
            viewBox={OVERLAY_VIEW_BOX}
            className="absolute inset-0 h-full w-full wb-overlay-svg"
            preserveAspectRatio="xMidYMid meet"
            data-tool={activeTool}
            aria-hidden="true"
            onClick={handleOverlayClick}
            onDragStart={(e) => e.preventDefault()}
            onPointerDown={handleOverlayPointerDown}
            onPointerMove={handleOverlayPointerMove}
            onPointerUp={handleOverlayPointerUp}
            onPointerCancel={handleOverlayPointerUp}
            onPointerLeave={handleOverlayPointerUp}
          >
            <defs>
              {Object.entries(ACTOR_COLORS).map(([role, c]) => (
                <marker key={role} id={`arrow-${role}`} markerWidth="5" markerHeight="4" refX="4.5" refY="2" orient="auto">
                  <path d="M0,0.5 L4.5,2 L0,3.5" fill="none" stroke={c.stroke} strokeWidth={ROUTE_STROKE_WIDTH.arrow} />
                </marker>
              ))}
              {Object.entries(ACTOR_COLORS).flatMap(([role, c]) => ([
                <marker key={`${role}-goalie-padslide`} id={`goalie-padslide-${role}`} markerWidth="9" markerHeight="8" refX="1.5" refY="4" orient="auto-start-reverse">
                  <path d="M1.5,4 C2.8,1.8 5.3,1.8 6.4,4" fill="none" stroke={c.stroke} strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M6.4,4 C5.3,6.2 2.8,6.2 1.5,4" fill="none" stroke={c.stroke} strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round" />
                </marker>,
                <marker key={`${role}-goalie-butterflyslide`} id={`goalie-butterflyslide-${role}`} markerWidth="9" markerHeight="8" refX="1.5" refY="4" orient="auto-start-reverse">
                  <path d="M1.5,4 C2.6,1.8 4.2,1.3 5.4,2.1 C6.6,1.3 8.1,1.8 9,4" fill="none" stroke={c.stroke} strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round" />
                </marker>,
              ]))}
              <marker id="arrow-pass" markerWidth="5" markerHeight="4" refX="4.5" refY="2" orient="auto">
                <path d="M0,0.5 L4.5,2 L0,3.5" fill="none" stroke="#f59e0b" strokeWidth="0.9" />
              </marker>
              {/* draw-line markers are generated per-line with explicit colors (see drawLines.map below) */}
            </defs>

            {/* Draw lines */}
            {drawLines.map((line) => {
              if (line.attachedActorId != null || line.points.length < 2) return null;
              const isSelected = line.id === selectedDrawLineId;
              const dlBezierNodes = syncedBezierNodesByDrawLine[line.id];
              const pathD = dlBezierNodes
                ? buildActorRoutePathData(line.points, dlBezierNodes, true)
                : buildOverlayPathData(line.points, true, 0.65);
              const lineColor = isSelected ? "#f59e0b" : (line.color ?? "#1e293b");
              const lineType = line.lineType ?? "solid";
              const weight = line.lineWeight ?? "medium";
              const baseStroke = weight === "thin" ? 0.7 : weight === "thick" ? 2.4 : 1.4;
              const endArrow = line.endArrow ?? "arrow";
              const startArrow = line.startArrow ?? "none";
              const dashArray = lineType === "dashed" ? "5 3" : lineType === "dotted" ? "1.5 3" : undefined;
              const safeId = line.id.replace(/[^a-z0-9]/gi, "-");
              const endMarkerId = endArrow !== "none" ? `dl-${safeId}-end-${endArrow}` : null;
              const startMarkerId = startArrow !== "none" ? `dl-${safeId}-start-${startArrow}` : null;
              const markerEnd = endMarkerId ? `url(#${endMarkerId})` : undefined;
              const markerStart = startMarkerId ? `url(#${startMarkerId})` : undefined;
              const showHandles = isSelected && drawLineMode === "edit";
              return (
                <g key={line.id}>
                  <defs>
                    {endMarkerId && endArrow === "arrow"  && <marker id={endMarkerId}  markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto"><polygon points="0,0.3 4.5,2 0,3.7" fill={lineColor} /></marker>}
                    {endMarkerId && endArrow === "open"   && <marker id={endMarkerId}  markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto"><path d="M0,0.5 L4.5,2 L0,3.5" fill="none" stroke={lineColor} strokeWidth="0.9" /></marker>}
                    {endMarkerId && endArrow === "tee"    && <marker id={endMarkerId}  markerWidth="3" markerHeight="5" refX="2" refY="2.5" orient="auto"><line x1="1" y1="0.2" x2="1" y2="4.8" stroke={lineColor} strokeWidth="1" /></marker>}
                    {endMarkerId && endArrow === "circle" && <marker id={endMarkerId}  markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto"><circle cx="2.5" cy="2.5" r="1.8" fill={lineColor} /></marker>}
                    {startMarkerId && startArrow === "arrow"  && <marker id={startMarkerId} markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto-start-reverse"><polygon points="0,0.3 4.5,2 0,3.7" fill={lineColor} /></marker>}
                    {startMarkerId && startArrow === "open"   && <marker id={startMarkerId} markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto-start-reverse"><path d="M0,0.5 L4.5,2 L0,3.5" fill="none" stroke={lineColor} strokeWidth="0.9" /></marker>}
                    {startMarkerId && startArrow === "tee"    && <marker id={startMarkerId} markerWidth="3" markerHeight="5" refX="2" refY="2.5" orient="auto-start-reverse"><line x1="1" y1="0.2" x2="1" y2="4.8" stroke={lineColor} strokeWidth="1" /></marker>}
                    {startMarkerId && startArrow === "circle" && <marker id={startMarkerId} markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto-start-reverse"><circle cx="2.5" cy="2.5" r="1.8" fill={lineColor} /></marker>}
                  </defs>
                  <path
                    d={pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={10}
                    data-draw-line-handle="true"
                    className="cursor-pointer"
                    onPointerDown={(e) => handleDrawLinePointerDown(e, line.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <path
                    d={pathD}
                    fill="none"
                    stroke={lineColor}
                    strokeWidth={isSelected ? baseStroke * 1.3 : baseStroke}
                    strokeDasharray={dashArray}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    markerEnd={markerEnd}
                    markerStart={markerStart}
                    pointerEvents="none"
                  />
                  {/* Bezier node + handle editor */}
                  {showHandles && dlBezierNodes && (() => {
                    const nodeStroke = "#1e293b";
                    return (
                      <g>
                        {/* Handle leader lines and circles — rendered first (behind nodes) */}
                        {dlBezierNodes.map((node, nodeIndex) => {
                          const handles: React.ReactNode[] = [];
                          if (node.cp1Ft) {
                            const disp1 = getBezierHandleDisplayPos(node, node.cp1Ft);
                            handles.push(
                              <g key={`dl-cp1-${nodeIndex}`}>
                                <line x1={node.xFt} y1={node.yFt} x2={disp1.xFt} y2={disp1.yFt}
                                  stroke={nodeStroke} strokeWidth={0.5} strokeDasharray="1.2 0.8" opacity={0.55} pointerEvents="none"
                                />
                                <circle
                                  cx={disp1.xFt} cy={disp1.yFt} r={3.0}
                                  fill="white" stroke={nodeStroke} strokeWidth={1.0}
                                  className="cursor-grab"
                                  onPointerDown={(e) => handleDrawLineBezierHandlePointerDown(e, line.id, nodeIndex, "cp1Ft", node.cp1Ft!)}
                                />
                              </g>,
                            );
                          }
                          if (node.cp2Ft) {
                            const disp2 = getBezierHandleDisplayPos(node, node.cp2Ft);
                            handles.push(
                              <g key={`dl-cp2-${nodeIndex}`}>
                                <line x1={node.xFt} y1={node.yFt} x2={disp2.xFt} y2={disp2.yFt}
                                  stroke={nodeStroke} strokeWidth={0.5} strokeDasharray="1.2 0.8" opacity={0.55} pointerEvents="none"
                                />
                                <circle
                                  cx={disp2.xFt} cy={disp2.yFt} r={3.0}
                                  fill="white" stroke={nodeStroke} strokeWidth={1.0}
                                  className="cursor-grab"
                                  onPointerDown={(e) => handleDrawLineBezierHandlePointerDown(e, line.id, nodeIndex, "cp2Ft", node.cp2Ft!)}
                                />
                              </g>,
                            );
                          }
                          return handles;
                        })}
                        {/* Anchor node circles — rendered on top */}
                        {dlBezierNodes.map((node, nodeIndex) => {
                          const isNodeSelected = nodeIndex === selectedDrawLineNodeIndex;
                          const isCorner = node.nodeType === "hard";
                          return (
                            <g key={`dl-node-${nodeIndex}`}>
                              {isNodeSelected && (
                                <circle cx={node.xFt} cy={node.yFt} r={5.5}
                                  fill="none" stroke="#f59e0b" strokeWidth={1.4} opacity={0.9} pointerEvents="none"
                                />
                              )}
                              {/* Invisible hit circle for easier targeting */}
                              <circle
                                cx={node.xFt} cy={node.yFt} r={5.5}
                                fill="white" fillOpacity={0.001} stroke="none"
                                className="cursor-grab"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (dragMovedRef.current) return;
                                  const next = selectedDrawLineNodeIndex === nodeIndex ? null : nodeIndex;
                                  setSelectedDrawLineNodeIndex(next);
                                  if (next !== null) setPieMenuOpen(true);
                                  else setPieMenuOpen(false);
                                }}
                                onPointerDown={(e) => handleDrawLineBezierNodePointerDown(e, line.id, nodeIndex)}
                              />
                              {/* Visible anchor — diamond for corner, circle for smooth */}
                              {isCorner ? (
                                <rect
                                  x={node.xFt - 2.2} y={node.yFt - 2.2} width={4.4} height={4.4}
                                  fill="#f59e0b" stroke="white" strokeWidth={0.8}
                                  transform={`rotate(45 ${node.xFt} ${node.yFt})`}
                                  pointerEvents="none"
                                />
                              ) : (
                                <circle
                                  cx={node.xFt} cy={node.yFt} r={2.6}
                                  fill="#f59e0b" stroke="white" strokeWidth={0.8}
                                  pointerEvents="none"
                                />
                              )}
                            </g>
                          );
                        })}
                      </g>
                    );
                  })()}
                </g>
              );
            })}

            {/* Actor paths */}
            {paths.map((path) => {
              const actor = actors.find((a) => a.id === path.actorId);
              const teamRole = path.teamRole ?? actor?.teamRole ?? "neutral";
              const color = getActorColor(actor, teamRole);
              const actorEditor = getActorEditorState(actor);
              const routeLineType = getRouteLineType(actorEditor);
              const isActive = path.actorId === selectedRouteActorId;
              const actorCurvesEnabled = curveModeByActor[path.actorId] ?? true;
              const curved = showCurvedPaths && actorCurvesEnabled;
              const bezierNodes = syncedBezierNodesByPath[path.id];
              const isDrawLineAttached = drawLines.some((l) => l.attachedActorId === path.actorId);
              const sampledPoints = curved && bezierNodes
                ? sampleBezierRouteToTimedPoints(path.points, bezierNodes)
                : path.points;
              const pathData = curved && bezierNodes
                ? buildActorRoutePathData(path.points, bezierNodes, true)
                : buildOverlayPathData(path.points, showCurvedPaths, curveIntensity);
              const showHandles = isActive && activeTool === "select" && !isDrawLineAttached && bezierNodes && path.points.length > 1 && curved;

              return (
                <g key={path.id}>
                  {path.points.length > 1 && renderRouteLineVisual({
                    lineType: routeLineType,
                    pathData,
                    sampledPoints,
                    stroke: color.stroke,
                    strokeWidth: isActive ? ROUTE_STROKE_WIDTH.active : ROUTE_STROKE_WIDTH.inactive,
                    opacity: isActive ? 0.9 : 0.62,
                    markerEndId: `arrow-${teamRole}`,
                    markerStartId: routeLineType === "goalie-padslide"
                      ? `goalie-padslide-${teamRole}`
                      : routeLineType === "goalie-butterflyslide"
                        ? `goalie-butterflyslide-${teamRole}`
                        : undefined,
                  })}

                  {path.points.map((point, index) => {
                    const isTokenNode = index === 0;
                    const shortLabel = getActorTokenLabel(actor, path.actorId);
                    const stageLabel = isTokenNode ? shortLabel : String(index);

                    if (isTokenNode) {
                      return (
                        <g
                          key={`${path.id}-token`}
                          data-node-handle="true"
                          className="cursor-grab"
                          onPointerDown={(event) => handleActorTokenPointerDown(event, path.actorId)}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {getActorEditorState(actor).hasPuck && (
                            <g>
                              <circle cx={point.xFt} cy={point.yFt - 6.5} r={2.2} fill="#dc2626" stroke="white" strokeWidth={0.5} />
                              <text x={point.xFt} y={point.yFt - 5.6} textAnchor="middle" fontSize="2.1" fontWeight="700" fill="white">P</text>
                            </g>
                          )}
                          <circle
                            cx={point.xFt}
                            cy={point.yFt}
                            r={isActive ? 4.8 : 3.8}
                            fill={color.token}
                            stroke="white"
                            strokeWidth={isActive ? 1 : 0.7}
                          />
                          <text
                            x={point.xFt}
                            y={point.yFt + 1.6}
                            textAnchor="middle"
                            fontSize={isActive ? "3.6" : "3.0"}
                            fontWeight="800"
                            fill="white"
                          >
                            {getActorTokenLabel(actor, path.actorId)}
                          </text>
                        </g>
                      );
                    }

                    const isSelectedNode = isActive && index === selectedNodeIndex;
                    const showNodeCircles = false;
                    const nodeActionColor: Record<string, string> = { pass: "#f59e0b", receive: "#22c55e", shot: "#ef4444" };
                    const actionIndicator = point.action && point.action !== "carry" ? point.action[0].toUpperCase() : null;
                    const breakType = getNodeBreakType(point);
                    return (
                      <g
                        key={`${path.id}-node-${index}`}
                        data-node-handle={isActive && showNodeCircles ? "true" : undefined}
                        className={isActive && showNodeCircles ? "cursor-grab" : undefined}
                        pointerEvents={isActive && showNodeCircles ? undefined : "none"}
                        onClick={isActive && showNodeCircles ? (event) => {
                          event.stopPropagation();
                          handleNodeClick(path.actorId, index);
                        } : undefined}
                      >
                        {showNodeCircles && (
                          <>
                            {isSelectedNode && (
                              <circle cx={point.xFt} cy={point.yFt} r={5.5} fill="none" stroke="#f59e0b" strokeWidth={1.4} opacity={0.9} pointerEvents="none" />
                            )}
                            <circle
                              cx={point.xFt}
                              cy={point.yFt}
                              r={ROUTE_NODE_HIT_RADIUS_FT}
                              fill="#ffffff"
                              fillOpacity={0.001}
                              stroke="none"
                              strokeWidth={0}
                              pointerEvents="visibleFill"
                              onPointerDown={isActive ? (event) => handleNodePointerDown(event, path.actorId, index) : undefined}
                            />
                            <circle
                              cx={point.xFt}
                              cy={point.yFt}
                              r={isActive ? 3.0 : 2.2}
                              fill={point.action && point.action !== "carry" ? nodeActionColor[point.action] ?? color.fill : color.fill}
                              stroke={color.stroke}
                              strokeWidth={0.8}
                              pointerEvents="none"
                            />
                            <text
                              x={point.xFt}
                              y={point.yFt + 1.0}
                              textAnchor="middle"
                              fontSize={isActive ? "2.6" : "2.0"}
                              fontWeight="700"
                              fill="white"
                              pointerEvents="none"
                            >
                              {actionIndicator ?? stageLabel}
                            </text>
                          </>
                        )}
                        {breakType && renderBreakSymbolAtNode(path.points, index, breakType, color.stroke)}
                      </g>
                    );
                  })}

                  {/* Bezier control handles — rendered after node points so they paint on top */}
                  {showHandles && bezierNodes.map((node, nodeIndex) => {
                    const handles: React.ReactNode[] = [];
                    if (node.cp1Ft) {
                      const disp1 = getBezierHandleDisplayPos(node, node.cp1Ft);
                      handles.push(
                        <g key={`${path.id}-cp1-${nodeIndex}`} data-node-handle="true">
                          <line x1={node.xFt} y1={node.yFt} x2={disp1.xFt} y2={disp1.yFt}
                            stroke={color.stroke} strokeWidth={0.5} strokeDasharray="1.2 0.8" opacity={0.55}
                          />
                          <circle
                            cx={disp1.xFt} cy={disp1.yFt} r={3.5}
                            fill="white" stroke={color.stroke} strokeWidth={1.2}
                            className="wb-bezier-handle cursor-grab"

                            onPointerDown={(e) => handleBezierGroupPointerDown(e, path.id, nodeIndex, "cp1Ft", node.cp1Ft!)}
                          />
                        </g>,
                      );
                    }
                    if (node.cp2Ft) {
                      const disp2 = getBezierHandleDisplayPos(node, node.cp2Ft);
                      handles.push(
                        <g key={`${path.id}-cp2-${nodeIndex}`} data-node-handle="true">
                          <line x1={node.xFt} y1={node.yFt} x2={disp2.xFt} y2={disp2.yFt}
                            stroke={color.stroke} strokeWidth={0.5} strokeDasharray="1.2 0.8" opacity={0.55}
                          />
                          <circle
                            cx={disp2.xFt} cy={disp2.yFt} r={3.5}
                            fill="white" stroke={color.stroke} strokeWidth={1.2}
                            className="wb-bezier-handle cursor-grab"

                            onPointerDown={(e) => handleBezierGroupPointerDown(e, path.id, nodeIndex, "cp2Ft", node.cp2Ft!)}
                          />
                        </g>,
                      );
                    }
                    return handles;
                  })}
                </g>
              );
            })}

            {/* Pass trajectory arrows */}
            <g pointerEvents="none">
              {passTrajectories.map((traj) => (
                <line
                  key={traj.id}
                  x1={traj.fromXFt}
                  y1={traj.fromYFt}
                  x2={traj.toXFt}
                  y2={traj.toYFt}
                  stroke="#f59e0b"
                  strokeWidth={1.4}
                  strokeDasharray="0.01 2.8"
                  strokeLinecap="round"
                  markerEnd="url(#arrow-pass)"
                  opacity={0.8}
                />
              ))}
            </g>

            {freehandDraftPoints.length > 0 && (() => {
              const isDrawLineDraft = freehandDraftActorId === null && activeTool === "draw";
              const draftActorId = isDrawLineDraft ? null : (freehandDraftActorId ?? activeActorId);
              const actor = isDrawLineDraft ? null : actors.find((entry) => entry.id === draftActorId);
              const teamRole = actor?.teamRole ?? "neutral";
              const color = isDrawLineDraft
                ? { stroke: "#1e293b", fill: "#1e293b", token: "#1e293b" }
                : getActorColor(actor ?? undefined, teamRole);

              return (
                <g pointerEvents="none">
                  {freehandDraftPoints.length > 1 && (
                    <path
                      d={buildOverlayPathData(freehandDraftPoints, showCurvedPaths, curveIntensity)}
                      fill="none"
                      stroke={color.stroke}
                      strokeWidth={ROUTE_STROKE_WIDTH.draft}
                      strokeDasharray={isDrawLineDraft ? undefined : "3 2"}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.85}
                    />
                  )}
                  <circle
                    cx={freehandDraftPoints[freehandDraftPoints.length - 1].xFt}
                    cy={freehandDraftPoints[freehandDraftPoints.length - 1].yFt}
                    r={2.4}
                    fill={color.token}
                    stroke="white"
                    strokeWidth={0.7}
                    opacity={0.95}
                  />
                </g>
              );
            })()}

            {/* Annotations */}
            {annotations.map((annotation) => (
              <AnnotationOverlayItem
                key={annotation.id}
                annotation={annotation}
                isSelected={annotation.id === selectedAnnotationId}
                onPointerDown={(event) => handleAnnotationPointerDown(event, annotation.id)}
              />
            ))}

            {/* Playback actor positions + puck — isolated 60fps component */}
            <PlaybackLayer
              playbackTimeRef={playbackTimeRef}
              bezierSampledPaths={bezierSampledPaths}
              actors={actors}
              derivedEvents={derivedEvents}
            />
          </svg>

          {/* Legend (minimized by default) */}
          <div
            className={`wb-legend ${legendOpen ? "wb-legend--open" : "wb-legend--closed"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="wb-legend-toggle"
              onClick={() => setLegendOpen((v) => !v)}
              aria-label={legendOpen ? "Hide legend" : "Show legend"}
            >
              {legendOpen ? "✕" : "ℹ️"}
            </button>

            <div className="wb-legend-body" aria-hidden={!legendOpen}>
              {routeLegendItems.map((item) => (
                <div key={item.label} className="wb-legend-row">
                  <div style={{ width: 120, height: 16, flexShrink: 0 }}>
                    <RouteLegendGlyph lineType={item.lineType} />
                  </div>
                  <span className="wb-legend-label">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Actor pie menu */}
          {pieMenuOpen && !activeAnnotation && !selectedDrawLineId && actorPieMenuPosition && activeActor && (() => {
            if (!activeActorId) return null;
            const trashIcon = (
              <g>
                <rect x="-6" y="-2" width="12" height="10" rx="2" fill="currentColor" />
                <rect x="-8" y="-4" width="16" height="2" rx="1" fill="currentColor" />
                <rect x="-3" y="-7" width="6" height="2" rx="1" fill="currentColor" />
              </g>
            );
            const skateIcon = (
              <g>
                <polygon points="-10,6 0,-6 10,6" fill="currentColor" />
                <rect x="-1" y="-6" width="2" height="14" fill="currentColor" />
              </g>
            );
            const puckIcon = (
              <g style={{ color: "#ffffff" }}>
                <circle cx="0" cy="0" r="6" fill="currentColor" />
                <ellipse cx="0" cy="2" rx="5" ry="2" fill="rgba(0, 0, 0, 0.25)" />
              </g>
            );
            const pathIcon = (
              <g transform="translate(0,0) scale(0.3168)" style={{ fill: "#ffffff", stroke: "none" }}>
                {/* Approximated S made from overlapping rounded rects (solid fill) */}
                <rect x="-14" y="-10" width="26" height="7" rx="3.5" transform="rotate(-18)" style={{ fill: "#ffffff", stroke: "none" }} />
                <rect x="-10" y="-2.5" width="22" height="7" rx="3.5" transform="rotate(14)" style={{ fill: "#ffffff", stroke: "none" }} />
                <rect x="-14" y="6" width="26" height="7" rx="3.5" transform="rotate(-18)" style={{ fill: "#ffffff", stroke: "none" }} />
                {/* Connector + larger arrowhead attached to the end of the S */}
                <rect x="20" y="1" width="8" height="6" rx="1" style={{ fill: "#ffffff", stroke: "none" }} />
                <polygon style={{ fill: "#ffffff", stroke: "none" }} points="30,4 40,0 30,-4" />
              </g>
            );
            const moveIcon = (
              <g style={{ color: "#ffffff" }}>
                <rect x="-8" y="-1" width="16" height="2" fill="currentColor" />
                <polygon points="-10,0 -5,-4 -5,4" fill="currentColor" />
                <polygon points="10,0 5,-4 5,4" fill="currentColor" />
              </g>
            );
            const teamIcon = (
              <g>
                <circle cx="-4" cy="-2" r="2.5" fill="currentColor" />
                <circle cx="4" cy="-2" r="2.5" fill="currentColor" opacity="0.6" />
                <rect x="-8" y="2" width="16" height="4" rx="2" fill="currentColor" opacity="0.6" />
              </g>
            );
            const positionIcon = (
              <g>
                <circle cx="0" cy="-2" r="3" fill="currentColor" />
                <rect x="-6" y="2" width="12" height="4" rx="2" fill="currentColor" opacity="0.7" />
              </g>
            );
            const colorIcon = (
              <g>
                <circle cx="-4" cy="0" r="4" fill="currentColor" />
                <circle cx="4" cy="0" r="4" fill="currentColor" opacity="0.5" />
              </g>
            );
            const stageIcon = (
              <g>
                <circle cx="0" cy="0" r="7" fill="currentColor" opacity="0.22" />
                <circle cx="0" cy="0" r="5.4" fill="currentColor" />
                <rect x="-0.6" y="-4" width="1.2" height="6" fill="#0d0f12" />
                <rect x="0" y="0" width="4" height="1.2" fill="#0d0f12" />
              </g>
            );
            const confirmIcon = (
              <g stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <polyline points="-6,0 -1,5 7,-5" />
              </g>
            );
            const cancelIcon = (
              <g stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                <line x1="-6" y1="-6" x2="6" y2="6" />
                <line x1="6" y1="-6" x2="-6" y2="6" />
              </g>
            );

            const totalStages = Math.max(1, ...paths.map((path) => path.points.length));
            const lineStages = activePath?.points.length ?? 1;
            const maxStartStage = Math.max(1, totalStages - lineStages + 1);
            const stageOptions = Array.from({ length: maxStartStage }, (_, i) => i + 1);

            const actorItems: PieMenuItem[] = [
              {
                id: "skate",
                label: "SKATE",
                icon: skateIcon,
                subItems: [
                  {
                    id: "skate-forward",
                    label: "Forward",
                    icon: SPEED_OPTIONS[activeActorEditor.speedTier]?.icon,
                    active: !activeActorEditor.skateBackward && !activeActorEditor.skateLateral,
                    action: () => updateActorEditorState(activeActorId, { skateBackward: false, skateLateral: false }),
                  },
                  {
                    id: "skate-backward",
                    label: "Backward",
                    icon: SPEED_OPTIONS[activeActorEditor.speedTier]?.icon,
                    active: activeActorEditor.skateBackward,
                    action: () => updateActorEditorState(activeActorId, { skateBackward: true, skateLateral: false }),
                  },
                  {
                    id: "skate-lateral",
                    label: "Lateral",
                    icon: SPEED_OPTIONS[activeActorEditor.speedTier]?.icon,
                    active: activeActorEditor.skateLateral,
                    action: () => updateActorEditorState(activeActorId, { skateBackward: false, skateLateral: true }),
                  },
                  // Speed tiers mirrored from PLAYER SPEED panel (exclude Pause)
                  ...SPEED_OPTIONS.slice(1).map((opt, j) => {
                    const i = j + 1; // original index in SPEED_OPTIONS
                    return {
                      id: `skate-speed-${i}`,
                      label: opt.title,
                      icon: opt.icon,
                      active: activeActorEditor.speedTier === i,
                      action: () => updateActorEditorState(activeActorId, { speedTier: i }),
                    } as PieMenuItem;
                  }),
                ],
              },
              {
                id: "possession",
                label: "STICK",
                icon: puckIcon,
                active: activeActorEditor.hasPuck,
                action: () => updateActorEditorState(activeActorId, { hasPuck: !activeActorEditor.hasPuck }),
              },
              {
                id: "move",
                label: "MOVE",
                icon: moveIcon,
                iconColor: "#ffffff",
                active: routeGestureMode === "move-route",
                action: () => {
                  setRouteGestureMode("move-route");
                },
              },
              {
                id: "team",
                label: "TEAM",
                icon: teamIcon,
                subItems: [
                  {
                    id: "team-home",
                    label: "Home",
                    active: activeActor?.teamRole === "home",
                    action: () => updateActorTeamRole(activeActorId, "home"),
                  },
                  {
                    id: "team-away",
                    label: "Away",
                    active: activeActor?.teamRole === "away",
                    action: () => updateActorTeamRole(activeActorId, "away"),
                  },
                  {
                    id: "team-neutral",
                    label: "Neutral",
                    active: activeActor?.teamRole === "neutral",
                    action: () => updateActorTeamRole(activeActorId, "neutral"),
                  },
                  {
                    id: "team-coach",
                    label: "Coach",
                    action: () => {
                      updateActorTeamRole(activeActorId, "neutral");
                      updateActorName(activeActorId, "Coach");
                      updateActorEditorState(activeActorId, { positionTag: "C" });
                    },
                  },
                ],
              },
              {
                id: "position",
                label: "POSITION",
                icon: positionIcon,
                subItems: [
                  {
                    id: "pos-forward",
                    label: "Forward",
                    active: activeActorEditor.positionTag === "F",
                    action: () => updateActorEditorState(activeActorId, { positionTag: "F" }),
                  },
                  {
                    id: "pos-wing",
                    label: "Wing",
                    active: activeActorEditor.positionTag === "W",
                    action: () => updateActorEditorState(activeActorId, { positionTag: "W" }),
                  },
                  {
                    id: "pos-center",
                    label: "Center",
                    active: activeActorEditor.positionTag === "C",
                    action: () => updateActorEditorState(activeActorId, { positionTag: "C" }),
                  },
                  {
                    id: "pos-defence",
                    label: "Defence",
                    active: activeActorEditor.positionTag === "D",
                    action: () => updateActorEditorState(activeActorId, { positionTag: "D" }),
                  },
                  {
                    id: "pos-goalie",
                    label: "Goalie",
                    active: activeActorEditor.positionTag === "G",
                    action: () => updateActorEditorState(activeActorId, { positionTag: "G" }),
                  },
                ],
              },
              {
                id: "color",
                label: "COLOR",
                icon: colorIcon,
                subItems: COLOR_SWATCHES.map((hex) => ({
                  id: `color-${hex}`,
                  label: "",
                  icon: <circle cx="0" cy="0" r="6" fill={hex} />,
                  active: activeActorEditor.customColor === hex,
                  action: () => setActorCustomColor(activeActorId, hex),
                })),
              },
              {
                id: "stage",
                label: "STAGE",
                icon: stageIcon,
                subItems: stageOptions.map((stage) => ({
                  id: `stage-${stage}`,
                  label: String(stage),
                  action: () => setPathStartStage(activeActorId, stage),
                })),
              },
              {
                id: "delete",
                label: "DELETE",
                icon: trashIcon,
                danger: true,
                subItems: [
                  {
                    id: "delete-confirm",
                    label: "CONFIRM",
                    icon: confirmIcon,
                    danger: true,
                    action: () => { removeActor(activeActorId); setPieMenuOpen(false); },
                  },
                  {
                    id: "delete-cancel",
                    label: "CANCEL",
                    icon: cancelIcon,
                    action: () => { setPieMenuOpen(false); },
                  },
                ],
              },
            ];
            return (
              <PieMenu
                leftPx={actorPieMenuPosition.leftPx}
                topPx={actorPieMenuPosition.topPx}
                items={actorItems}
                centerLabel={getActorTokenLabel(activeActor, activeActor?.id ?? "")}
                onClose={() => setPieMenuOpen(false)}
              />
            );
          })()}

          {/* Annotation pie menu */}
          {pieMenuOpen && activeAnnotation && annotationPieMenuPosition && (() => {
            const trashIcon = (
              <g>
                <rect x="-6" y="-2" width="12" height="10" rx="2" fill="currentColor" />
                <rect x="-8" y="-4" width="16" height="2" rx="1" fill="currentColor" />
                <rect x="-3" y="-7" width="6" height="2" rx="1" fill="currentColor" />
              </g>
            );
            const annotationItems: PieMenuItem[] = [
              {
                id: "delete",
                label: "DELETE",
                icon: trashIcon,
                danger: true,
                action: () => { removeAnnotation(selectedAnnotationId!); setPieMenuOpen(false); },
              },
            ];
            return (
              <PieMenu
                leftPx={annotationPieMenuPosition.leftPx}
                topPx={annotationPieMenuPosition.topPx}
                items={annotationItems}
                centerLabel={activeAnnotation.type.toUpperCase().slice(0, 3)}
                onClose={() => { setPieMenuOpen(false); setSelectedAnnotationId(null); }}
              />
            );
          })()}

          {/* Draw line pie menu */}
          {pieMenuOpen && selectedDrawLineId != null && drawLinePieMenuPosition && !activeAnnotation && (() => {
            const selectedDrawLine = drawLines.find((l) => l.id === selectedDrawLineId);
            if (!selectedDrawLine) return null;
            const dlStartArrow: DrawLineArrowType = selectedDrawLine.startArrow ?? "none";
            const dlEndArrow: DrawLineArrowType = selectedDrawLine.endArrow ?? "arrow";
            const dlColor = selectedDrawLine.color ?? "#1e293b";
            const dlWeight = selectedDrawLine.lineWeight ?? "medium";

            // Icons (white SVG, same style as actor menu)
            const startArrowIcon = (
              <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                <line x1="7" y1="0" x2="-3" y2="0" />
                <polyline points="-1,-3 -5,0 -1,3" />
              </g>
            );
            const endArrowIcon = (
              <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                <line x1="-7" y1="0" x2="3" y2="0" />
                <polyline points="1,-3 5,0 1,3" />
              </g>
            );
            const colorDot = (hex: string) => (
              <circle cx="0" cy="0" r="6" fill={hex} stroke="white" strokeWidth="1.5" />
            );
            const weightIcon = (
              <g fill="currentColor">
                <rect x="-7" y="-4" width="14" height="1.2" rx="0.6" />
                <rect x="-7" y="-1" width="14" height="2" rx="1" />
                <rect x="-7" y="3" width="14" height="3.2" rx="1.6" />
              </g>
            );
            const moveIcon = (
              <g fill="currentColor">
                <rect x="-8" y="-1" width="16" height="2" />
                <polygon points="-10,0 -5,-4 -5,4" />
                <polygon points="10,0 5,-4 5,4" />
              </g>
            );
            const editPathIcon = (
              <g fill="currentColor">
                <rect x="-6" y="-1.5" width="10" height="3" rx="1" transform="rotate(-38)" />
                <polygon points="4,2 8,0 4,-2" transform="rotate(-38)" />
                <circle cx="-5" cy="4" r="1.8" />
              </g>
            );
            const doneIcon = (
              <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                <polyline points="-6,0 -1,5 7,-5" />
              </g>
            );
            const trashDlIcon = (
              <g fill="currentColor">
                <rect x="-6" y="-2" width="12" height="10" rx="2" />
                <rect x="-8" y="-4" width="16" height="2" rx="1" />
                <rect x="-3" y="-7" width="6" height="2" rx="1" />
              </g>
            );
            const dlCancelIcon = (
              <g stroke="currentColor" strokeWidth={2} strokeLinecap="round" fill="none">
                <line x1="-6" y1="-6" x2="6" y2="6" />
                <line x1="6" y1="-6" x2="-6" y2="6" />
              </g>
            );

            let menuItems: PieMenuItem[];

            if (drawLineMode === "move") {
              menuItems = [
                {
                  id: "dl-move-done",
                  label: "DONE",
                  icon: doneIcon,
                  action: () => { setDrawLineMode(null); },
                  keepOpen: true,
                },
                {
                  id: "dl-delete",
                  label: "DELETE",
                  icon: trashDlIcon,
                  subItems: [
                    {
                      id: "dl-delete-confirm",
                      label: "CONFIRM",
                      icon: trashDlIcon,
                      danger: true,
                      action: () => { setDrawLineMode(null); removeDrawLine(selectedDrawLineId); },
                    },
                    {
                      id: "dl-delete-cancel",
                      label: "CANCEL",
                      icon: dlCancelIcon,
                      keepOpen: true,
                    },
                  ],
                },
              ];
            } else if (drawLineMode === "edit") {
              const editSelectedNode = selectedDrawLineNodeIndex !== null && selectedDrawLineId
                ? syncedBezierNodesByDrawLine[selectedDrawLineId]?.[selectedDrawLineNodeIndex]
                : null;
              menuItems = [
                {
                  id: "dl-edit-done",
                  label: "DONE",
                  icon: doneIcon,
                  action: () => { setDrawLineMode(null); setSelectedDrawLineNodeIndex(null); },
                  keepOpen: true,
                },
                ...(editSelectedNode ? [
                  {
                    id: "dl-node-smooth",
                    label: "SMOOTH",
                    active: editSelectedNode.nodeType !== "hard",
                    action: () => {
                      if (!selectedDrawLineId || selectedDrawLineNodeIndex === null) return;
                      setBezierNodesByDrawLine((current) => {
                        const existing = current[selectedDrawLineId];
                        if (!existing) return current;
                        return {
                          ...current,
                          [selectedDrawLineId]: existing.map((n, i) =>
                            i === selectedDrawLineNodeIndex ? { ...n, nodeType: "smooth" as const } : n,
                          ),
                        };
                      });
                    },
                    keepOpen: true,
                  },
                  {
                    id: "dl-node-corner",
                    label: "CORNER",
                    active: editSelectedNode.nodeType === "hard",
                    action: () => {
                      if (!selectedDrawLineId || selectedDrawLineNodeIndex === null) return;
                      setBezierNodesByDrawLine((current) => {
                        const existing = current[selectedDrawLineId];
                        if (!existing) return current;
                        return {
                          ...current,
                          [selectedDrawLineId]: existing.map((n, i) =>
                            i === selectedDrawLineNodeIndex ? { ...n, nodeType: "hard" as const } : n,
                          ),
                        };
                      });
                    },
                    keepOpen: true,
                  },
                ] : []),
                {
                  id: "dl-delete",
                  label: "DELETE",
                  icon: trashDlIcon,
                  subItems: [
                    {
                      id: "dl-delete-confirm",
                      label: "CONFIRM",
                      icon: trashDlIcon,
                      danger: true,
                      action: () => { setDrawLineMode(null); setSelectedDrawLineNodeIndex(null); removeDrawLine(selectedDrawLineId); },
                    },
                    {
                      id: "dl-delete-cancel",
                      label: "CANCEL",
                      icon: dlCancelIcon,
                      keepOpen: true,
                    },
                  ],
                },
              ];
            } else {
              // Regular mode
              menuItems = [
                {
                  id: "dl-start-arrow",
                  label: "START",
                  icon: startArrowIcon,
                  subItems: (["none", "arrow", "open", "tee", "circle"] as DrawLineArrowType[]).map((style) => ({
                    id: `dl-start-${style}`,
                    label: style === "none" ? "NONE" : style === "arrow" ? "SOLID" : style === "open" ? "OPEN" : style === "tee" ? "TEE" : "DOT",
                    active: dlStartArrow === style,
                    action: () => setDrawLineArrow(selectedDrawLineId, "start", style),
                    keepOpen: true,
                  })),
                },
                {
                  id: "dl-end-arrow",
                  label: "END",
                  icon: endArrowIcon,
                  subItems: (["none", "arrow", "open", "tee", "circle"] as DrawLineArrowType[]).map((style) => ({
                    id: `dl-end-${style}`,
                    label: style === "none" ? "NONE" : style === "arrow" ? "SOLID" : style === "open" ? "OPEN" : style === "tee" ? "TEE" : "DOT",
                    active: dlEndArrow === style,
                    action: () => setDrawLineArrow(selectedDrawLineId, "end", style),
                    keepOpen: true,
                  })),
                },
                {
                  id: "dl-color",
                  label: "COLOR",
                  icon: colorDot(dlColor),
                  subItems: [
                    { id: "dl-color-default", label: "", icon: colorDot("#1e293b"), active: dlColor === "#1e293b", action: () => updateDrawLineProps(selectedDrawLineId, { color: "#1e293b" }), keepOpen: true },
                    ...COLOR_SWATCHES.map((hex) => ({
                      id: `dl-color-${hex}`,
                      label: "",
                      icon: colorDot(hex),
                      active: dlColor === hex,
                      action: () => updateDrawLineProps(selectedDrawLineId, { color: hex }),
                      keepOpen: true,
                    })),
                  ],
                },
                {
                  id: "dl-weight",
                  label: "WEIGHT",
                  icon: weightIcon,
                  subItems: [
                    { id: "dl-weight-thin",   label: "THIN",   active: dlWeight === "thin",   action: () => updateDrawLineProps(selectedDrawLineId, { lineWeight: "thin" }),   keepOpen: true },
                    { id: "dl-weight-medium", label: "MEDIUM", active: dlWeight === "medium", action: () => updateDrawLineProps(selectedDrawLineId, { lineWeight: "medium" }), keepOpen: true },
                    { id: "dl-weight-thick",  label: "THICK",  active: dlWeight === "thick",  action: () => updateDrawLineProps(selectedDrawLineId, { lineWeight: "thick" }),  keepOpen: true },
                  ],
                },
                {
                  id: "dl-move",
                  label: "MOVE",
                  icon: moveIcon,
                  action: () => { setDrawLineMode("move"); setPieMenuOpen(false); },
                  keepOpen: true,
                },
                {
                  id: "dl-edit-path",
                  label: "EDIT",
                  icon: editPathIcon,
                  action: () => { setDrawLineMode("edit"); setPieMenuOpen(false); },
                  keepOpen: true,
                },
                {
                  id: "dl-delete",
                  label: "DELETE",
                  icon: trashDlIcon,
                  subItems: [
                    {
                      id: "dl-delete-confirm",
                      label: "CONFIRM",
                      icon: trashDlIcon,
                      danger: true,
                      action: () => removeDrawLine(selectedDrawLineId),
                    },
                    {
                      id: "dl-delete-cancel",
                      label: "CANCEL",
                      icon: dlCancelIcon,
                      keepOpen: true,
                    },
                  ],
                },
              ];
            }

            return (
              <PieMenu
                leftPx={drawLinePieMenuPosition.leftPx}
                topPx={drawLinePieMenuPosition.topPx}
                items={menuItems}
                centerLabel="LINE"
                onClose={() => { setPieMenuOpen(false); setSelectedDrawLineId(null); setDrawLineMode(null); setSelectedDrawLineNodeIndex(null); }}
              />
            );
          })()}

          
        </div>

        {/* Timeline */}
        <div className="wb-timeline-section">
          <div className="wb-timeline-controls">
            <div className="wb-action-row">
              <button type="button" onClick={togglePlayback} className="wb-btn wb-btn--primary">{isPlaying ? "Pause" : "Play"}</button>
              <button type="button" onClick={restartPlayback} className="wb-btn wb-btn--ghost">Restart</button>
            </div>
            <div className="wb-timeline-meta">
              <span className="wb-badge">{playbackTimeSec.toFixed(1)}s / {playbackWindow.endTimeSec.toFixed(1)}s</span>
              <span>{playbackStates.length} active</span>
              <span>{activePlaybackEventIds.size} events</span>
            </div>
          </div>

          <input
            type="range"
            min={playbackWindow.startTimeSec}
            max={playbackWindow.endTimeSec || 1}
            step="0.05"
            value={playbackTimeSec}
            onChange={(e) => { setIsPlaying(false); setPlaybackTime(Number(e.target.value)); }}
            aria-label="Playback timeline"
          />

          <div className="wb-timeline-lanes">
            {paths.map((path) => {
              const actor = actors.find((a) => a.id === path.actorId);
              const teamRole = path.teamRole ?? actor?.teamRole ?? "neutral";
              const color = getActorColor(actor, teamRole);
              const startTime = path.points[0]?.timeSec ?? 0;
              const endTime = path.points[path.points.length - 1]?.timeSec ?? startTime;
              const startPercent = (startTime / timelineMaxTime) * 100;
              const widthPercent = Math.max(
                ((Math.max(endTime - startTime, 0.4)) / timelineMaxTime) * 100,
                path.points.length > 0 ? 4 : 0,
              );

              return (
                <div key={`${path.id}-lane`} className="wb-timeline-lane">
                      <div className="wb-timeline-lane__label">
                    <span className={`dashboard-chip dashboard-chip--${teamRole}`}>
                      {getActorTokenLabel(actor, path.actorId)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveActor(path.actorId)}
                    className="wb-timeline-lane__track"
                    aria-label={`Focus ${actor?.name ?? path.actorId} path`}
                  >
                    <svg viewBox="0 0 100 24" preserveAspectRatio="none">
                      {Array.from({ length: 6 }, (_, i) => {
                        const x = ((i + 1) / 6) * 100;
                        return <line key={i} x1={x} y1="0" x2={x} y2="24" stroke="rgba(71,85,105,0.4)" strokeWidth="0.4" />;
                      })}
                      {path.points.length > 0 && (
                        <rect x={startPercent} y="3" width={widthPercent} height="18" rx="2" fill={color.fill} stroke={color.stroke} strokeWidth="0.5" />
                      )}
                      <line
                        x1={(clamp(playbackTimeSec, 0, timelineMaxTime) / timelineMaxTime) * 100}
                        y1="1"
                        x2={(clamp(playbackTimeSec, 0, timelineMaxTime) / timelineMaxTime) * 100}
                        y2="23"
                        stroke="rgba(245,245,242,0.85)"
                        strokeWidth="0.8"
                      />
                    </svg>
                    {path.points.map((point, i) => {
                      const px = ((point.timeSec ?? i) / timelineMaxTime) * 100;
                      return (
                        <span
                          key={i}
                          className="wb-stage-indicator"
                          style={{ left: `${px}%`, backgroundColor: color.stroke }}
                        >
                          {i === 0 ? getActorTokenLabel(actor, path.actorId) : i}
                        </span>
                      );
                    })}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Roster bar ── */}
      <div className="wb-roster-bar">
        <button type="button" onClick={() => addActor("home")} className="wb-btn wb-btn--ghost wb-btn--home">+ Home</button>
        <button type="button" onClick={() => addActor("away")} className="wb-btn wb-btn--ghost wb-btn--away">+ Away</button>
        <button type="button" onClick={() => addActor("neutral")} className="wb-btn wb-btn--ghost">+ Neutral</button>
        <button type="button" onClick={resetActivePath} className="wb-btn wb-btn--ghost">Clear Path</button>
        <button type="button" onClick={resetDrill} className="wb-btn wb-btn--danger">Reset</button>
        <div className="wb-roster-right">
          <select value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} className="wb-select wb-select--auto" title="Age group for this drill">
            {AGE_GROUP_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <label className="wb-roster-option">
            <input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} />
            Zones
          </label>
          <label className="wb-roster-option">
            <input type="checkbox" checked={showCurvedPaths} onChange={(e) => setShowCurvedPaths(e.target.checked)} />
            Curves
          </label>
        </div>
      </div>

    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getActorShortLabel(value: string): string {
  const parts = value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts.slice(0, 2).map((s) => s.charAt(0).toUpperCase()).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Decide next position label for a team using sequence F1,F2,F3,D1,D2
function getNextPositionLabelForTeam(teamRole: SerializedActor["teamRole"], currentActors: SerializedActor[]) {
  const team = teamRole ?? "neutral";
  const teamActors = currentActors.filter((a) => (a.teamRole ?? "neutral") === team);
  const counts: Record<string, number> = {};
  for (const a of teamActors) {
    const metaPos = isRecord(a.metadata) && typeof a.metadata["positionTag"] === "string" ? a.metadata["positionTag"] : undefined;
    const namePos = typeof a.name === "string" && /^[FDC]\d+/.test(a.name) ? a.name[0] : undefined;
    const pos = (metaPos as string) ?? (namePos as string) ?? undefined;
    if (pos) counts[pos] = (counts[pos] ?? 0) + 1;
  }

  let posToUse = "F";
  if ((counts["F"] ?? 0) < 3) posToUse = "F";
  else if ((counts["D"] ?? 0) < 2) posToUse = "D";
  else posToUse = "F";

  const number = (counts[posToUse] ?? 0) + 1;
  return { label: `${posToUse}${number}`, positionTag: posToUse };
}

function getActorEditorState(actor?: SerializedActor | null): ActorEditorState {
  const metadata = isRecord(actor?.metadata) ? actor.metadata : {};

  return {
    positionTag: typeof metadata.positionTag === "string" ? metadata.positionTag : "F",
    speedTier: typeof metadata.speedTier === "number" ? clamp(Math.round(metadata.speedTier), 0, SPEED_OPTIONS.length - 1) : 4,
    hasPuck: metadata.hasPuck === true,
    skateBackward: metadata.skateBackward === true,
    skateLateral: metadata.skateLateral === true,
    goalieMovement: metadata.goalieMovement === "padslide" || metadata.goalieMovement === "butterflyslide"
      ? metadata.goalieMovement
      : "none",
    customColor: typeof metadata.customColor === "string" ? metadata.customColor : undefined,
  };
}

function buildActorMetadata(
  existingMetadata: SerializedActor["metadata"],
  partial: Partial<ActorEditorState>,
): Record<string, unknown> | undefined {
  const current = isRecord(existingMetadata) ? { ...existingMetadata } : {};
  const next = {
    ...current,
    ...partial,
  };

  if (!next.positionTag) delete next.positionTag;
  if (typeof next.speedTier !== "number") delete next.speedTier;
  if (next.hasPuck !== true) delete next.hasPuck;
  if (next.skateBackward !== true) delete next.skateBackward;
  if (next.skateLateral !== true) delete next.skateLateral;
  if (next.goalieMovement !== "padslide" && next.goalieMovement !== "butterflyslide") delete next.goalieMovement;
  if (typeof next.customColor !== "string") delete next.customColor;

  return Object.keys(next).length > 0 ? next : undefined;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return `rgba(255, 255, 255, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getActorColor(actor: SerializedActor | undefined, teamRole: SerializedActor["teamRole"]): { stroke: string; fill: string; token: string } {
  const base = ACTOR_COLORS[teamRole ?? "neutral"];
  const custom = isRecord(actor?.metadata) && typeof actor?.metadata?.customColor === "string"
    ? actor.metadata.customColor
    : null;
  if (!custom) return base;
  return {
    stroke: custom,
    fill: hexToRgba(custom, 0.18),
    token: custom,
  };
}

function getRouteLineType(editor: ActorEditorState): RouteLineType {
  if (editor.positionTag === "G") {
    if (editor.goalieMovement === "padslide") return "goalie-padslide";
    if (editor.goalieMovement === "butterflyslide") return "goalie-butterflyslide";
  }
  if (editor.skateLateral) return editor.hasPuck ? "lateral-with-puck" : "lateral";
  if (editor.skateBackward) return editor.hasPuck ? "backward-with-puck" : "backward";
  return editor.hasPuck ? "skate-with-puck" : "skate";
}

function getNodeBreakType(point: TimedPathPoint): NodeBreakType | null {
  const breakType = isRecord(point.metadata) ? point.metadata.breakType : undefined;
  return breakType === "stop" || breakType === "pivot" ? breakType : null;
}

function RouteLegendGlyph({ lineType }: { lineType: RouteLegendItem["lineType"] }) {
  const stroke = "#2b2b2b";

  return (
    <svg viewBox="0 0 120 16" className="wb-route-legend__svg" aria-hidden="true">
      {lineType === "skate" && (
        <>
          <line x1="10" y1="8" x2="92" y2="8" stroke={stroke} strokeWidth="1.65" strokeLinecap="round" />
        </>
      )}
      {lineType === "skate" && (
        <path d="M4 5.2 L10 8 L4 10.8" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {lineType === "skate-with-puck" && (
        <>
          <path d={buildWavyPathData([
            { xFt: 10, yFt: 8 },
            { xFt: 92, yFt: 8 },
          ], false)} fill="none" stroke={stroke} strokeWidth="1.575" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {lineType === "pass" && (
        <>
          <circle cx="18" cy="8" r="1.8" fill={stroke} />
          <circle cx="31" cy="8" r="1.8" fill={stroke} />
          <circle cx="44" cy="8" r="1.8" fill={stroke} />
          <circle cx="57" cy="8" r="1.8" fill={stroke} />
          <circle cx="70" cy="8" r="1.8" fill={stroke} />
          <circle cx="83" cy="8" r="1.8" fill={stroke} />
        </>
      )}
      {lineType === "shot" && (
        <>
          <path d="M7 4.8 L13 8 L7 11.2" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 4.8 L20 8 L14 11.2" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {lineType === "stop" && (
        <>
          <line x1="18" y1="4" x2="18" y2="12" stroke={stroke} strokeWidth="1.65" strokeLinecap="round" />
          <line x1="26" y1="4" x2="26" y2="12" stroke={stroke} strokeWidth="1.65" strokeLinecap="round" />
        </>
      )}
      {lineType === "pivot" && (
        <>
          <path d="M12 11.5 C15 11.5, 16.5 9.8, 16.5 8 C16.5 6.2, 15 4.5, 12 4.5" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M18.5 11.5 C21.5 11.5, 23 9.8, 23 8 C23 6.2, 21.5 4.5, 18.5 4.5" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
      {lineType === "backward" && (
        <>
          {renderBackwardPossessionGlyphs(
            [{ xFt: 10, yFt: 8 }, { xFt: 92, yFt: 8 }],
            "legend-backward",
            stroke,
            1.3875,
            1,
            false,
          )}
        </>
      )}
      {lineType === "backward-with-puck" && (
        <>
          {renderBackwardPossessionGlyphs(
            [{ xFt: 10, yFt: 8 }, { xFt: 92, yFt: 8 }],
            "legend-backward-puck",
            stroke,
            1.3875,
          )}
        </>
      )}
      {lineType === "lateral" && (
        <>
          {renderLateralPossessionGlyphs(
            [{ xFt: 10, yFt: 8 }, { xFt: 92, yFt: 8 }],
            "legend-lateral",
            stroke,
            1.35,
            1,
            false,
          )}
        </>
      )}
      {lineType === "lateral-with-puck" && (
        <>
          {renderLateralPossessionGlyphs(
            [{ xFt: 10, yFt: 8 }, { xFt: 92, yFt: 8 }],
            "legend-lateral-puck",
            stroke,
            1.35,
            1,
            true,
          )}
        </>
      )}
      {lineType === "goalie-padslide" && (
        <>
          <path d={buildPadSlidePathData([{ xFt: 10, yFt: 8 }, { xFt: 92, yFt: 8 }])} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {lineType === "goalie-butterflyslide" && (
        <>
          <path d="M10 8 C10 5.4, 12.1 4.3, 14.1 5.8 C16 4.3, 18.1 5.4, 18.1 8" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="18.1" y1="8" x2="92" y2="8" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function renderRouteLineVisual({
  lineType,
  pathData,
  sampledPoints,
  stroke,
  strokeWidth,
  opacity,
  markerEndId,
  markerStartId,
}: {
  lineType: RouteLineType;
  pathData: string;
  sampledPoints: Array<{ xFt: number; yFt: number }>;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  markerEndId: string;
  markerStartId?: string;
}): React.ReactNode {
  if (sampledPoints.length < 2) return null;

  if (lineType === "skate" || lineType === "goalie-padslide" || lineType === "goalie-butterflyslide") {
    return (
      <path
        d={pathData}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
        markerStart={markerStartId ? `url(#${markerStartId})` : undefined}
        markerEnd={`url(#${markerEndId})`}
      />
    );
  }

  if (lineType === "skate-with-puck") {
    return (
      <path
        d={buildWavyPathData(sampledPoints, true)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
        markerEnd={`url(#${markerEndId})`}
      />
    );
  }

  if (lineType === "backward" || lineType === "backward-with-puck") {
    const includeDot = lineType === "backward-with-puck";
    return (
      <>
        {renderBackwardPossessionGlyphs(sampledPoints, `${markerEndId}-backward`, stroke, strokeWidth, opacity, includeDot)}
        <path d={buildArrowOnlyPathData(sampledPoints)} fill="none" stroke="none" markerEnd={`url(#${markerEndId})`} />
      </>
    );
  }

  if (lineType === "lateral" || lineType === "lateral-with-puck") {
    const includeDots = lineType === "lateral-with-puck";
    return (
      <>
        {renderLateralPossessionGlyphs(sampledPoints, `${markerEndId}-lateral`, stroke, strokeWidth, opacity, includeDots)}
        <path d={buildArrowOnlyPathData(sampledPoints)} fill="none" stroke="none" markerEnd={`url(#${markerEndId})`} />
      </>
    );
  }

  return (
    <>
      <path
        d={pathData}
        fill="none"
        stroke={stroke}
        strokeWidth={Math.max(0.4875, strokeWidth * 0.16)}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity * 0.24}
        markerEnd={`url(#${markerEndId})`}
      />
      <path
        d={buildLateralSkatingTicksData(sampledPoints)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        opacity={opacity}
      />
    </>
  );
}

function buildWavyPathData(
  points: Array<{ xFt: number; yFt: number }>,
  hasArrow: boolean,
): string {
  const HALF_WAVE = 1.5;
  const AMP = 0.9;
  const step = 0.8;
  const totalLen = getTotalRouteLength(points);
  if (totalLen < 0.001) return buildPolylinePathData(points);

  let count = Math.max(2, Math.round(totalLen / HALF_WAVE));
  if (count % 2 !== 0) count += 1;
  const halfLen = totalLen / count;

  const samples: Array<{ xFt: number; yFt: number }> = [];
  const numSamples = Math.ceil(totalLen / step) + 1;

  for (let sampleIndex = 0; sampleIndex < numSamples; sampleIndex += 1) {
    const dist = Math.min(sampleIndex * step, totalLen);
    const point = pointAtRouteDistance(points, dist);
    const phase = (Math.PI * dist) / halfLen;
    const offset = AMP * Math.sin(phase);
    const taper = hasArrow ? Math.min(1, (totalLen - dist) / 8) : 1;
    samples.push({
      xFt: point.xFt + point.normalX * offset * taper,
      yFt: point.yFt + point.normalY * offset * taper,
    });
  }

  if (samples.length === 0) return buildPolylinePathData(points);

  let d = `M ${samples[0].xFt.toFixed(2)} ${samples[0].yFt.toFixed(2)}`;
  for (let index = 1; index < samples.length; index += 1) {
    const prev = samples[index - 1];
    const curr = samples[index];
    const midX = (prev.xFt + curr.xFt) / 2;
    const midY = (prev.yFt + curr.yFt) / 2;
    d += ` Q ${prev.xFt.toFixed(2)} ${prev.yFt.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
  }
  const last = samples[samples.length - 1];
  d += ` L ${last.xFt.toFixed(2)} ${last.yFt.toFixed(2)}`;
  return d;
}

function buildLateralSkatingTicksData(points: Array<{ xFt: number; yFt: number }>): string {
  const spacing = 2.8;
  const halfLen = 1.8;
  const totalLen = getTotalRouteLength(points);
  if (totalLen < 0.001) return "";

  const numTicks = Math.max(2, Math.round(totalLen / spacing));
  let d = "";
  for (let index = 0; index <= numTicks; index += 1) {
    const point = pointAtRouteDistance(points, (index / numTicks) * totalLen);
    d += `M ${(point.xFt - point.normalX * halfLen).toFixed(2)} ${(point.yFt - point.normalY * halfLen).toFixed(2)} `;
    d += `L ${(point.xFt + point.normalX * halfLen).toFixed(2)} ${(point.yFt + point.normalY * halfLen).toFixed(2)} `;
  }
  return d.trim();
}

function buildPadSlidePathData(points: Array<{ xFt: number; yFt: number }>): string {
  if (points.length < 2) return buildPolylinePathData(points);

  const loopRadius = 2.8;
  const start = points[0];
  const point = pointAtRouteDistance(points, 0.001);
  const farX = start.xFt + 2 * point.normalX * loopRadius;
  const farY = start.yFt + 2 * point.normalY * loopRadius;

  let d = `M ${start.xFt.toFixed(2)} ${start.yFt.toFixed(2)} `;
  d += `A ${loopRadius.toFixed(2)} ${loopRadius.toFixed(2)} 0 0 0 ${farX.toFixed(2)} ${farY.toFixed(2)} `;
  d += `A ${loopRadius.toFixed(2)} ${loopRadius.toFixed(2)} 0 0 0 ${start.xFt.toFixed(2)} ${start.yFt.toFixed(2)} `;
  for (let index = 1; index < points.length; index += 1) {
    d += `L ${points[index].xFt.toFixed(2)} ${points[index].yFt.toFixed(2)} `;
  }
  return d.trim();
}

function buildPolylinePathData(points: Array<{ xFt: number; yFt: number }>): string {
  if (points.length === 0) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.xFt.toFixed(2)} ${point.yFt.toFixed(2)}`).join(" ");
}

function buildArrowOnlyPathData(points: Array<{ xFt: number; yFt: number }>): string {
  if (points.length === 0) return "";
  const last = points[points.length - 1];
  const prev = points[points.length - 2] ?? last;
  const t = 0.0001;
  return `M ${prev.xFt.toFixed(2)} ${prev.yFt.toFixed(2)} L ${(last.xFt + t).toFixed(2)} ${(last.yFt + t).toFixed(2)}`;
}

function renderBackwardPossessionGlyphs(
  points: Array<{ xFt: number; yFt: number }>,
  keyPrefix: string,
  stroke: string,
  strokeWidth: number,
  opacity = 1,
  includeDot = true,
): React.ReactNode {
  const arcWidth = 5.1;
  const totalLen = getTotalRouteLength(points);
  if (totalLen < 0.001) return null;

  const glyphs: React.ReactNode[] = [];
  let numGlyphs = Math.max(2, Math.round(totalLen / arcWidth));
  if (numGlyphs % 2 !== 0) numGlyphs += 1;
  const spacing = totalLen / numGlyphs;
  const halfWidth = Math.max(1.05, strokeWidth * 1.15);
  const archHeight = Math.max(1.42, strokeWidth * 1.55);
  const baseYOffset = -Math.max(0.08, strokeWidth * 0.08);
  const dotOffset = Math.max(1.15, strokeWidth * 1.15);
  const dotRadius = Math.max(0.5, strokeWidth * 0.52);

  const toWorld = (
    center: { xFt: number; yFt: number; tangentX: number; tangentY: number; normalX: number; normalY: number },
    side: number,
    localX: number,
    localY: number,
  ) => ({
    xFt: center.xFt + center.tangentX * localX + center.normalX * localY * side,
    yFt: center.yFt + center.tangentY * localX + center.normalY * localY * side,
  });

  for (let index = 0; index < numGlyphs; index += 1) {
    const sign = index % 2 === 0 ? 1 : -1;
    const mid = pointAtRouteDistance(points, index * spacing + spacing * 0.5);
    const start = toWorld(mid, sign, -halfWidth, baseYOffset);
    const controlLeft = toWorld(mid, sign, -halfWidth * 1.08, archHeight * 0.72);
    const apex = toWorld(mid, sign, 0, archHeight);
    const controlRight = toWorld(mid, sign, halfWidth * 1.08, archHeight * 0.72);
    const end = toWorld(mid, sign, halfWidth, baseYOffset);
    const dot = toWorld(mid, sign, 0, -dotOffset);

    glyphs.push(
      <g key={`${keyPrefix}-${index}`} opacity={opacity} pointerEvents="none">
        <path
          d={`M ${start.xFt.toFixed(2)} ${start.yFt.toFixed(2)} C ${controlLeft.xFt.toFixed(2)} ${controlLeft.yFt.toFixed(2)} ${apex.xFt.toFixed(2)} ${apex.yFt.toFixed(2)} ${apex.xFt.toFixed(2)} ${apex.yFt.toFixed(2)} C ${apex.xFt.toFixed(2)} ${apex.yFt.toFixed(2)} ${controlRight.xFt.toFixed(2)} ${controlRight.yFt.toFixed(2)} ${end.xFt.toFixed(2)} ${end.yFt.toFixed(2)}`}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {includeDot && (
          <circle
            cx={dot.xFt}
            cy={dot.yFt}
            r={dotRadius}
            fill={stroke}
          />
        )}
      </g>,
    );
  }

  return glyphs;
}

function renderLateralPossessionGlyphs(
  points: Array<{ xFt: number; yFt: number }>,
  keyPrefix: string,
  stroke: string,
  strokeWidth: number,
  opacity = 1,
  includeDots = true,
): React.ReactNode {
  const spacing = 2.8;
  const halfStem = 0.62;
  const dotGap = 1.15;
  const dotRadius = Math.max(0.48, strokeWidth * 0.56);
  const stemCapRadius = strokeWidth * 0.5;
  const totalLen = getTotalRouteLength(points);
  if (totalLen < 0.001) return null;

  const glyphs: React.ReactNode[] = [];
  const count = Math.max(2, Math.round(totalLen / spacing));

  for (let index = 0; index <= count; index += 1) {
    const point = pointAtRouteDistance(points, (index / count) * totalLen);
    const side = index % 2 === 0 ? 1 : -1;
    const stemCenterOffset = -(dotGap * 0.5 + dotRadius) * side;
    const stemCenterX = point.xFt + point.normalX * stemCenterOffset;
    const stemCenterY = point.yFt + point.normalY * stemCenterOffset;
    const stemStartX = stemCenterX - point.normalX * halfStem * side;
    const stemStartY = stemCenterY - point.normalY * halfStem * side;
    const stemEndX = stemCenterX + point.normalX * halfStem * side;
    const stemEndY = stemCenterY + point.normalY * halfStem * side;
    const dotX = point.xFt + point.normalX * (halfStem + stemCapRadius + dotGap * 0.5) * side;
    const dotY = point.yFt + point.normalY * (halfStem + stemCapRadius + dotGap * 0.5) * side;

    glyphs.push(
      <g key={`${keyPrefix}-${index}`} opacity={opacity} pointerEvents="none">
        <line
          x1={stemStartX}
          y1={stemStartY}
          x2={stemEndX}
          y2={stemEndY}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {includeDots && (
          <circle
            cx={dotX}
            cy={dotY}
            r={dotRadius}
            fill={stroke}
          />
        )}
      </g>,
    );
  }

  return glyphs;
}

function getTotalRouteLength(points: Array<{ xFt: number; yFt: number }>): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    total += Math.hypot(points[index + 1].xFt - points[index].xFt, points[index + 1].yFt - points[index].yFt);
  }
  return total;
}

function pointAtRouteDistance(points: Array<{ xFt: number; yFt: number }>, targetDistance: number) {
  if (points.length < 2) {
    return {
      xFt: points[0]?.xFt ?? 0,
      yFt: points[0]?.yFt ?? 0,
      tangentX: 1,
      tangentY: 0,
      normalX: 0,
      normalY: 1,
    };
  }

  const totalLen = getTotalRouteLength(points);
  const clamped = Math.max(0, Math.min(totalLen, targetDistance));
  let traversed = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.xFt - start.xFt;
    const dy = end.yFt - start.yFt;
    const len = Math.hypot(dx, dy);
    const nextTraversed = traversed + len;
    if (nextTraversed >= clamped - 0.0001) {
      const t = len < 0.0001 ? 0 : (clamped - traversed) / len;
      const tangentX = len < 0.0001 ? 1 : dx / len;
      const tangentY = len < 0.0001 ? 0 : dy / len;
      return {
        xFt: start.xFt + dx * t,
        yFt: start.yFt + dy * t,
        tangentX,
        tangentY,
        normalX: -tangentY,
        normalY: tangentX,
      };
    }
    traversed = nextTraversed;
  }

  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dx = last.xFt - prev.xFt;
  const dy = last.yFt - prev.yFt;
  const len = Math.hypot(dx, dy) || 1;
  return {
    xFt: last.xFt,
    yFt: last.yFt,
    tangentX: dx / len,
    tangentY: dy / len,
    normalX: -dy / len,
    normalY: dx / len,
  };
}

function renderBreakSymbolAtNode(
  points: TimedPathPoint[],
  nodeIndex: number,
  breakType: NodeBreakType,
  stroke: string,
): React.ReactNode {
  const node = points[nodeIndex];
  if (!node) return null;

  const tangent = getNodeTangent(points, nodeIndex);
  const radius = 1.8;
  const strokeWidth = 0.7125;

  const vArmLen = radius * 1.35;
  const vSpread = radius * 0.95;
  const vOffset = radius * 1.6;
  const vCenterX = node.xFt + tangent.normalX * vOffset;
  const vCenterY = node.yFt + tangent.normalY * vOffset;
  const vDirX = -tangent.tangentX;
  const vDirY = -tangent.tangentY;
  const vLeftX = vCenterX + vDirX * vArmLen + tangent.normalX * vSpread;
  const vLeftY = vCenterY + vDirY * vArmLen + tangent.normalY * vSpread;
  const vRightX = vCenterX + vDirX * vArmLen - tangent.normalX * vSpread;
  const vRightY = vCenterY + vDirY * vArmLen - tangent.normalY * vSpread;
  const vGlyph = (
    <path
      d={`M ${vLeftX.toFixed(2)} ${vLeftY.toFixed(2)} L ${vCenterX.toFixed(2)} ${vCenterY.toFixed(2)} L ${vRightX.toFixed(2)} ${vRightY.toFixed(2)}`}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      pointerEvents="none"
    />
  );

  if (breakType === "pivot") {
    const x1 = node.xFt + tangent.tangentX * radius;
    const y1 = node.yFt + tangent.tangentY * radius;
    const x2 = node.xFt - tangent.tangentX * radius;
    const y2 = node.yFt - tangent.tangentY * radius;
    return (
      <g pointerEvents="none">
        {vGlyph}
        <path
          d={`M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 0 ${x2.toFixed(2)} ${y2.toFixed(2)}`}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      </g>
    );
  }

  const tickLen = radius * 0.75;
  const offset = radius;
  const gap = radius * 0.3;
  return (
    <g pointerEvents="none">
      {vGlyph}
      {([-1, 1] as const).map((side) => {
        const cx = node.xFt - tangent.normalX * (offset + gap * side);
        const cy = node.yFt - tangent.normalY * (offset + gap * side);
        return (
          <line
            key={`${nodeIndex}-${side}`}
            x1={cx + tangent.tangentX * tickLen}
            y1={cy + tangent.tangentY * tickLen}
            x2={cx - tangent.tangentX * tickLen}
            y2={cy - tangent.tangentY * tickLen}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        );
      })}
    </g>
  );
}

function getNodeTangent(points: TimedPathPoint[], nodeIndex: number) {
  const prev = points[nodeIndex - 1] ?? points[nodeIndex];
  const next = points[nodeIndex + 1] ?? points[nodeIndex];
  const dx = next.xFt - prev.xFt;
  const dy = next.yFt - prev.yFt;
  const len = Math.hypot(dx, dy) || 1;
  const tangentX = dx / len;
  const tangentY = dy / len;
  return {
    tangentX,
    tangentY,
    normalX: -tangentY,
    normalY: tangentX,
  };
}

function getActorTokenLabel(actor: SerializedActor | undefined, fallbackId: string): string {
  const editor = getActorEditorState(actor);
  if (editor.positionTag) {
    return editor.positionTag;
  }
  const name = actor?.name ?? fallbackId;
  // Normalize legacy names like "Home 1" or "Home Forward 1" -> "F1"
  const m = typeof name === "string" && name.match(/^\s*(Home|Away)\s*(?:Forward\s*)?(\d+)\s*$/i);
  if (m) {
    return `F${m[2]}`;
  }
  return getActorShortLabel(name);
}

function getActorSpeedModifier(speedTier: number): number {
  const clampedTier = clamp(Math.round(speedTier), 0, SPEED_OPTIONS.length - 1);
  if (clampedTier === 0) {
    return 0;
  }
  return [-1, -0.5, 0, 0.5, 0.75, 1][clampedTier - 1];
}

function getEffectiveActorMaxFtPerSec(ageGroup: string, actor?: SerializedActor | null): number {
  const speedTier = getActorEditorState(actor).speedTier;
  if (speedTier === 0) {
    return 0;
  }
  const baseSpeed = getSkatingFtPerSec(ageGroup, getActorSpeedModifier(speedTier)) ?? Infinity;
  if (!Number.isFinite(baseSpeed)) return Infinity;
  return baseSpeed;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function buildCurveModesForActors(actors: SerializedActor[], defaultEnabled = true): Record<string, boolean> {
  return Object.fromEntries(actors.map((a) => [a.id, defaultEnabled]));
}

function distanceBetweenPoints(
  left: { xFt: number; yFt: number },
  right: { xFt: number; yFt: number },
): number {
  return Math.hypot(right.xFt - left.xFt, right.yFt - left.yFt);
}

function appendFreehandPoint(
  points: Array<{ xFt: number; yFt: number }>,
  nextPoint: { xFt: number; yFt: number },
  minSpacingFt: number,
): Array<{ xFt: number; yFt: number }> {
  const lastPoint = points.at(-1);
  if (lastPoint && distanceBetweenPoints(lastPoint, nextPoint) <= minSpacingFt) {
    return points;
  }

  return [...points, nextPoint];
}

function fitFreehandCurveAnchors(
  points: Array<{ xFt: number; yFt: number }>,
): Array<{ xFt: number; yFt: number }> {
  const dedupedPoints = dedupeSequentialPoints(points.map((point) => ({
    xFt: point.xFt,
    yFt: point.yFt,
  })));

  if (dedupedPoints.length <= 2) {
    return dedupedPoints.map((point) => ({ xFt: point.xFt, yFt: point.yFt }));
  }

  const smoothedPoints = smoothFreehandPoints(dedupedPoints.map((point) => ({
    xFt: point.xFt,
    yFt: point.yFt,
  })));

  const anchors = [smoothedPoints[0]];
  let lastAnchor = smoothedPoints[0];

  for (let index = 1; index < smoothedPoints.length - 1; index += 1) {
    const previous = smoothedPoints[index - 1];
    const current = smoothedPoints[index];
    const next = smoothedPoints[index + 1];
    const turnDegrees = getTurnAngleDegrees(previous, current, next);
    const distanceSinceAnchor = distanceBetweenPoints(lastAnchor, current);

    if (turnDegrees >= FREEHAND_TURN_THRESHOLD_DEG || distanceSinceAnchor >= FREEHAND_ANCHOR_SPACING_FT) {
      anchors.push(current);
      lastAnchor = current;
    }
  }

  const finalPoint = smoothedPoints[smoothedPoints.length - 1];
  if (distanceBetweenPoints(lastAnchor, finalPoint) > 0.1) {
    anchors.push(finalPoint);
  }

  return dedupeSequentialPoints(anchors).map((point) => ({ xFt: point.xFt, yFt: point.yFt }));
}

function smoothFreehandPoints(
  points: Array<{ xFt: number; yFt: number }>,
): Array<{ xFt: number; yFt: number }> {
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) {
      return point;
    }

    const previous = points[index - 1];
    const next = points[index + 1];
    return {
      xFt: (previous.xFt + point.xFt * 2 + next.xFt) / 4,
      yFt: (previous.yFt + point.yFt * 2 + next.yFt) / 4,
    };
  });
}

function getTurnAngleDegrees(
  previous: { xFt: number; yFt: number },
  current: { xFt: number; yFt: number },
  next: { xFt: number; yFt: number },
): number {
  const incomingX = current.xFt - previous.xFt;
  const incomingY = current.yFt - previous.yFt;
  const outgoingX = next.xFt - current.xFt;
  const outgoingY = next.yFt - current.yFt;
  const incomingLength = Math.hypot(incomingX, incomingY);
  const outgoingLength = Math.hypot(outgoingX, outgoingY);

  if (incomingLength < 0.001 || outgoingLength < 0.001) {
    return 0;
  }

  const cosine = clamp(
    (incomingX * outgoingX + incomingY * outgoingY) / (incomingLength * outgoingLength),
    -1,
    1,
  );

  return Math.acos(cosine) * (180 / Math.PI);
}

function fitPathPointsToLine(
  existingPoints: TimedPathPoint[],
  drawnPoints: Array<{ xFt: number; yFt: number }>,
  finalAction: RuntimePathAction,
  maxFtPerSec: number,
): TimedPathPoint[] {
  const normalizedExistingPoints = dedupeSequentialPoints(existingPoints.map((point) => ({
    xFt: point.xFt,
    yFt: point.yFt,
    action: point.action,
    metadata: point.metadata,
  })));
  const normalizedDrawnPoints = dedupeSequentialPoints(drawnPoints.map((point) => ({ xFt: point.xFt, yFt: point.yFt })));

  const existingPrefix = normalizedExistingPoints.slice(0, -1);
  const tailSeed = normalizedExistingPoints.at(-1);
  const extensionPoints = dedupeSequentialPoints([
    ...(tailSeed ? [tailSeed] : []),
    ...normalizedDrawnPoints,
  ]);

  const combinedPoints = dedupeSequentialPoints([
    ...existingPrefix,
    ...resampleFreehandExtension(extensionPoints, maxFtPerSec, finalAction),
  ]);

  if (combinedPoints.length === 0) {
    return [];
  }

  if (combinedPoints.length === 1) {
    return [{ ...combinedPoints[0], timeSec: 0, action: finalAction }];
  }

  return retimePathPoints(combinedPoints, maxFtPerSec).map((point, index, arr) => ({
    ...point,
    action: index === arr.length - 1 ? finalAction : point.action ?? "carry",
  }));
}

function resampleFreehandExtension(
  points: Array<Pick<TimedPathPoint, "xFt" | "yFt" | "action" | "metadata">>,
  maxFtPerSec: number,
  finalAction: RuntimePathAction,
): Array<Pick<TimedPathPoint, "xFt" | "yFt" | "action" | "metadata">> {
  if (points.length === 0) {
    return [];
  }

  if (points.length === 1 || !Number.isFinite(maxFtPerSec) || maxFtPerSec <= 0) {
    return points.map((point, index) => ({
      xFt: point.xFt,
      yFt: point.yFt,
      action: index === points.length - 1 ? finalAction : point.action ?? "carry",
      metadata: point.metadata,
    }));
  }

  const metrics = buildPathMetrics(points);
  if (metrics.totalFootLength <= 0) {
    return points.map((point, index) => ({
      ...point,
      action: index === points.length - 1 ? finalAction : point.action ?? "carry",
    }));
  }

  const maxNodeSpacingFt = maxFtPerSec * MAX_SEGMENT_DURATION_SEC;
  const result: Array<Pick<TimedPathPoint, "xFt" | "yFt" | "action" | "metadata">> = [{
    ...points[0],
    action: points[0].action ?? "carry",
  }];

  for (let distanceFt = maxNodeSpacingFt; distanceFt < metrics.totalFootLength; distanceFt += maxNodeSpacingFt) {
    result.push({
      ...samplePointAlongPolyline(points, distanceFt),
      action: "carry",
      metadata: { autoInserted: true, preserveOnRespeed: true },
    });
  }

  const lastPoint = points[points.length - 1];
  result.push({
    ...lastPoint,
    action: finalAction,
    metadata: lastPoint.metadata,
  });

  return dedupeSequentialPoints(result);
}

function samplePointAlongPolyline(
  points: Array<Pick<TimedPathPoint, "xFt" | "yFt" | "action" | "metadata">>,
  distanceFt: number,
): Pick<TimedPathPoint, "xFt" | "yFt"> {
  if (points.length === 0) {
    return { xFt: 0, yFt: 0 };
  }

  if (distanceFt <= 0) {
    return { xFt: points[0].xFt, yFt: points[0].yFt };
  }

  let traversedFt = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentFt = distanceBetweenPoints(start, end);
    if (segmentFt <= 0.001) {
      continue;
    }

    if (distanceFt <= traversedFt + segmentFt || index === points.length - 1) {
      const frac = clamp((distanceFt - traversedFt) / segmentFt, 0, 1);
      return {
        xFt: start.xFt + (end.xFt - start.xFt) * frac,
        yFt: start.yFt + (end.yFt - start.yFt) * frac,
      };
    }

    traversedFt += segmentFt;
  }

  const lastPoint = points[points.length - 1];
  return { xFt: lastPoint.xFt, yFt: lastPoint.yFt };
}

function respeedPath(points: TimedPathPoint[], maxFtPerSec: number): TimedPathPoint[] {
  if (points.length === 0) return points;

  // Remove previously auto-inserted intermediate nodes to get the anchor set.
  const anchors = points.filter((pt, i) => (
    i === 0
    || pt.metadata?.autoInserted !== true
    || pt.metadata?.preserveOnRespeed === true
  ));

  if (!Number.isFinite(maxFtPerSec) || maxFtPerSec <= 0 || anchors.length < 2) {
    return retimePathPoints(anchors, maxFtPerSec);
  }

  let totalFt = 0;
  for (let i = 1; i < anchors.length; i++) {
    totalFt += distanceBetweenPoints(anchors[i - 1], anchors[i]);
  }
  const totalDurationSec = Math.max(totalFt / maxFtPerSec, 0.25);

  const result: TimedPathPoint[] = [{ ...anchors[0], timeSec: 0 }];
  let traversedFt = 0;

  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const curr = anchors[i];
    const segDist = distanceBetweenPoints(prev, curr);
    const segSteps = Math.max(1, Math.ceil(segDist / (maxFtPerSec * MAX_SEGMENT_DURATION_SEC)));

    for (let step = 1; step <= segSteps; step++) {
      const frac = step / segSteps;
      const stepFt = traversedFt + segDist * frac;
      const timeSec = totalFt > 0 ? (stepFt / totalFt) * totalDurationSec : 0;
      const isAnchor = step === segSteps;
      const anchorMeta = curr.metadata?.autoInserted ? undefined : curr.metadata;
      result.push({
        xFt: prev.xFt + (curr.xFt - prev.xFt) * frac,
        yFt: prev.yFt + (curr.yFt - prev.yFt) * frac,
        timeSec,
        action: isAnchor ? curr.action : "carry",
        metadata: isAnchor ? anchorMeta : { autoInserted: true },
      });
    }
    traversedFt += segDist;
  }

  return result;
}

function retimePathPoints(points: TimedPathPoint[], maxFtPerSec: number): TimedPathPoint[] {
  if (points.length === 0) return points;
  if (points.length === 1) return [{ ...points[0], timeSec: 0 }];

  const metrics = buildPathMetrics(points);
  const totalDurationSec = metrics.totalFootLength > 0 && maxFtPerSec > 0
    ? Math.max(metrics.totalFootLength / maxFtPerSec, 0.25)
    : points.length - 1;

  let traversedFeet = 0;
  return points.map((point, index) => {
    if (index > 0) traversedFeet += distanceBetweenPoints(points[index - 1], point);
    const progress = metrics.totalFootLength > 0 ? traversedFeet / metrics.totalFootLength : index / (points.length - 1);
    return { ...point, timeSec: progress * totalDurationSec };
  });
}

function dedupeSequentialPoints(
  points: Array<Pick<TimedPathPoint, "xFt" | "yFt" | "action" | "metadata">>,
): Array<Pick<TimedPathPoint, "xFt" | "yFt" | "action" | "metadata">> {
  return points.reduce<Array<Pick<TimedPathPoint, "xFt" | "yFt" | "action" | "metadata">>>((acc, point) => {
    const previous = acc.at(-1);
    if (previous && distanceBetweenPoints(previous, point) <= 0.1) {
      return acc;
    }

    acc.push(point);
    return acc;
  }, []);
}

function buildOverlayPathData(
  points: Array<{ xFt: number; yFt: number }>,
  showCurvedPaths: boolean,
  curveIntensity: number,
): string {
  if (points.length === 0) return "";
  if (!showCurvedPaths || points.length < 3 || curveIntensity <= 0) {
    return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.xFt} ${p.yFt}`).join(" ");
  }

  let pathData = `M ${points[0].xFt} ${points[0].yFt}`;
  const tension = clamp(curveIntensity, 0, 1) / 6;

  for (let i = 0; i < points.length - 1; i++) {
    const prev = points[i - 1] ?? points[i];
    const curr = points[i];
    const next = points[i + 1];
    const following = points[i + 2] ?? next;
    const cp1x = curr.xFt + (next.xFt - prev.xFt) * tension;
    const cp1y = curr.yFt + (next.yFt - prev.yFt) * tension;
    const cp2x = next.xFt - (following.xFt - curr.xFt) * tension;
    const cp2y = next.yFt - (following.yFt - curr.yFt) * tension;
    pathData += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${next.xFt} ${next.yFt}`;
  }

  return pathData;
}

function buildAnnotation(
  type: SerializedAnnotationType,
  point: { xFt: number; yFt: number },
  index: number,
  teamRole?: SerializedAnnotation["teamRole"],
): SerializedAnnotation {
  const id = `${type}-${index + 1}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    type,
    xFt: point.xFt,
    yFt: point.yFt,
    teamRole: teamRole ?? "neutral",
    label: type === "text" ? `Text ${index + 1}` : undefined,
    rotationDeg: type === "net" ? 0 : undefined,
  };
}

const PlaybackLayer = memo(function PlaybackLayer({
  playbackTimeRef,
  bezierSampledPaths,
  actors,
  derivedEvents,
}: {
  playbackTimeRef: React.RefObject<number>;
  bezierSampledPaths: SerializedPath[];
  actors: SerializedActor[];
  derivedEvents: ReturnType<typeof deriveEventsForDrill>;
}) {
  const [playbackStates, setPlaybackStates] = useState<ReturnType<typeof getDrillPlaybackStates>>([]);
  const [puckState, setPuckState] = useState<ReturnType<typeof getPuckStateAtTime>>(null);
  const prevTimeRef = useRef(-1);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    prevTimeRef.current = -1;
    function tick() {
      const t = playbackTimeRef.current;
      if (t !== prevTimeRef.current) {
        prevTimeRef.current = t;
        setPlaybackStates(getDrillPlaybackStates(bezierSampledPaths, t).filter((s) => s.isVisible));
        setPuckState(getPuckStateAtTime(bezierSampledPaths, actors, derivedEvents, t));
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playbackTimeRef, bezierSampledPaths, actors, derivedEvents]);

  return (
    <>
      {playbackStates.map((state) => {
        const actor = actors.find((a) => a.id === state.actorId);
        const teamRole = state.teamRole ?? actor?.teamRole ?? "neutral";
        const color = getActorColor(actor, teamRole);
        return (
          <g key={`${state.pathId}-playback`} pointerEvents="none">
            <circle cx={state.position.xFt} cy={state.position.yFt} r={4.2} fill={color.token} stroke="white" strokeWidth={0.9} opacity={0.95} />
            <text x={state.position.xFt} y={state.position.yFt + 1.5} textAnchor="middle" fontSize="3.2" fontWeight="800" fill="white">
              {getActorTokenLabel(actor, state.actorId)}
            </text>
          </g>
        );
      })}
      {puckState && (
        <g pointerEvents="none">
          <circle
            cx={puckState.xFt}
            cy={puckState.yFt}
            r={1.8}
            fill={puckState.inFlight ? "#f59e0b" : "#020617"}
            stroke="white"
            strokeWidth={0.6}
            opacity={0.95}
          />
          {puckState.inFlight && (
            <circle cx={puckState.xFt} cy={puckState.yFt} r={3.2} fill="none" stroke="#f59e0b" strokeWidth={0.5} opacity={0.4} />
          )}
        </g>
      )}
    </>
  );
});

const ANNOTATION_COLORS: Record<string, { stroke: string; fill: string; text: string }> = {
  home: { stroke: "#0ea5e9", fill: "rgba(14,165,233,0.18)", text: "#e2e8f0" },
  away: { stroke: "#ef4444", fill: "rgba(239,68,68,0.18)", text: "#e2e8f0" },
  neutral: { stroke: "#a78bfa", fill: "rgba(167,139,250,0.18)", text: "#e2e8f0" },
};

function getAnnotationColors(teamRole?: SerializedAnnotation["teamRole"]) {
  return ANNOTATION_COLORS[teamRole ?? "neutral"];
}

function AnnotationOverlayItem(
  props: {
    annotation: SerializedAnnotation;
    isSelected: boolean;
    onPointerDown: (event: React.PointerEvent<SVGGElement>) => void;
  },
) {
  const { annotation, isSelected, onPointerDown } = props;
  const colors = getAnnotationColors(annotation.teamRole);
  const sw = isSelected ? 1.2 : 0.8;
  const stopAnnotationClick: React.MouseEventHandler<SVGGElement> = (event) => {
    event.stopPropagation();
  };

  switch (annotation.type) {
    case "cone":
      return (
        <g data-annotation-handle="true" className="cursor-grab" onPointerDown={onPointerDown} onClick={stopAnnotationClick}>
          <path
            d={`M ${annotation.xFt} ${annotation.yFt - 2.8} L ${annotation.xFt - 2.2} ${annotation.yFt + 2.2} L ${annotation.xFt + 2.2} ${annotation.yFt + 2.2} Z`}
            fill={colors.fill}
            stroke={colors.stroke}
            strokeWidth={sw}
          />
        </g>
      );
    case "net":
      return (
        <g data-annotation-handle="true" className="cursor-grab" onPointerDown={onPointerDown} onClick={stopAnnotationClick}>
          <rect x={annotation.xFt - 3} y={annotation.yFt - 1.7} width={6} height={3.4} rx={0.6} fill="rgba(255,255,255,0.04)" stroke={colors.stroke} strokeWidth={sw} />
          <path d={`M ${annotation.xFt - 2.6} ${annotation.yFt + 1.4} L ${annotation.xFt} ${annotation.yFt - 0.2} L ${annotation.xFt + 2.6} ${annotation.yFt + 1.4}`} fill="none" stroke={colors.stroke} strokeWidth={0.7} />
        </g>
      );
    case "puck":
      return (
        <g data-annotation-handle="true" className="cursor-grab" onPointerDown={onPointerDown} onClick={stopAnnotationClick}>
          <circle cx={annotation.xFt} cy={annotation.yFt} r={1.6} fill="#020617" stroke={isSelected ? "#f8fafc" : colors.stroke} strokeWidth={sw} />
        </g>
      );
    case "text":
      return (
        <g data-annotation-handle="true" className="cursor-grab" onPointerDown={onPointerDown} onClick={stopAnnotationClick}>
          <rect x={annotation.xFt - 5.6} y={annotation.yFt - 2.5} width={11.2} height={4.5} rx={1.1} fill="rgba(2,6,23,0.85)" stroke={colors.stroke} strokeWidth={sw} />
          <text x={annotation.xFt} y={annotation.yFt + 0.55} textAnchor="middle" fontSize="2" fontWeight="700" fill={colors.text}>
            {annotation.label?.trim() || "Text"}
          </text>
        </g>
      );
    default:
      return (
        <g data-annotation-handle="true" className="cursor-grab" onPointerDown={onPointerDown} onClick={stopAnnotationClick}>
          <circle cx={annotation.xFt} cy={annotation.yFt} r={2} fill={colors.fill} stroke={colors.stroke} strokeWidth={sw} />
        </g>
      );
  }
}
