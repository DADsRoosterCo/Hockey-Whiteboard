import type { TimedPathPoint } from "./runtime/eventDerivation";
import type { SerializedActorRouteBezierNode, SerializedActorRouteNode } from "./runtime/routeProjection";

// Lightweight bezier editor helpers operating in feet coordinates used by the UI.
function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function fitRouteBezierNodes(
  points: SerializedActorRouteNode[],
  curveIntensity = 0.65,
): SerializedActorRouteBezierNode[] {
  if (!points || points.length === 0) return [];
  if (points.length === 1) return [{ xFt: points[0].xFt, yFt: points[0].yFt, nodeType: points[0].nodeType }];

  const tension = clamp(curveIntensity, 0, 1) * 0.45;

  return points.map((curr, i) => {
    const prev = points[i - 1] ?? curr;
    const next = points[i + 1] ?? curr;
    const tx = (next.xFt - prev.xFt) * tension;
    const ty = (next.yFt - prev.yFt) * tension;
    const node: SerializedActorRouteBezierNode = {
      xFt: curr.xFt,
      yFt: curr.yFt,
      nodeType: curr.nodeType ?? "smooth",
    };
    if (i > 0) node.cp1Ft = { xFt: curr.xFt - tx / 3, yFt: curr.yFt - ty / 3 };
    if (i < points.length - 1) node.cp2Ft = { xFt: curr.xFt + tx / 3, yFt: curr.yFt + ty / 3 };
    return node;
  });
}

export function buildActorRoutePathData(
  anchors: Array<{ xFt: number; yFt: number }>,
  bezierNodes: SerializedActorRouteBezierNode[] | undefined,
  curved: boolean,
): string {
  if (!anchors || anchors.length === 0) return "";
  if (!curved || !bezierNodes || bezierNodes.length < 2) {
    return anchors.map((p, i) => `${i === 0 ? "M" : "L"} ${p.xFt} ${p.yFt}`).join(" ");
  }
  let d = `M ${bezierNodes[0].xFt} ${bezierNodes[0].yFt}`;
  for (let i = 1; i < bezierNodes.length; i += 1) {
    const prev = bezierNodes[i - 1];
    const cur = bezierNodes[i];
    const cp1 = prev.cp2Ft ?? { xFt: prev.xFt, yFt: prev.yFt };
    const cp2 = cur.cp1Ft ?? { xFt: cur.xFt, yFt: cur.yFt };
    d += ` C ${cp1.xFt} ${cp1.yFt} ${cp2.xFt} ${cp2.yFt} ${cur.xFt} ${cur.yFt}`;
  }
  return d;
}

export function moveRouteBezierNode(
  bezierNodes: SerializedActorRouteBezierNode[],
  nodeIndex: number,
  point: { xFt: number; yFt: number },
): SerializedActorRouteBezierNode[] {
  // eslint-disable-next-line no-console
  console.log("moveRouteBezierNode called", { nodeIndex, point, count: bezierNodes?.length });
  return bezierNodes.map((node, i) => {
    if (i !== nodeIndex) return { ...node, cp1Ft: node.cp1Ft ? { ...node.cp1Ft } : undefined, cp2Ft: node.cp2Ft ? { ...node.cp2Ft } : undefined };
    const dx = point.xFt - node.xFt;
    const dy = point.yFt - node.yFt;
    return {
      ...node,
      xFt: point.xFt,
      yFt: point.yFt,
      cp1Ft: node.cp1Ft ? { xFt: node.cp1Ft.xFt + dx, yFt: node.cp1Ft.yFt + dy } : undefined,
      cp2Ft: node.cp2Ft ? { xFt: node.cp2Ft.xFt + dx, yFt: node.cp2Ft.yFt + dy } : undefined,
    };
  });
}

export function moveRouteBezierHandle(
  bezierNodes: SerializedActorRouteBezierNode[],
  nodeIndex: number,
  handleType: "cp1Ft" | "cp2Ft",
  point: { xFt: number; yFt: number },
): SerializedActorRouteBezierNode[] {
  // eslint-disable-next-line no-console
  console.log("moveRouteBezierHandle called", { nodeIndex, handleType, point, count: bezierNodes?.length });
  return bezierNodes.map((node, i) => {
    if (i !== nodeIndex) return { ...node, cp1Ft: node.cp1Ft ? { ...node.cp1Ft } : undefined, cp2Ft: node.cp2Ft ? { ...node.cp2Ft } : undefined };
    const nextNode: SerializedActorRouteBezierNode = {
      ...node,
      nodeType: node.nodeType ?? "smooth",
      cp1Ft: handleType === "cp1Ft" ? { xFt: point.xFt, yFt: point.yFt } : (node.cp1Ft ? { ...node.cp1Ft } : undefined),
      cp2Ft: handleType === "cp2Ft" ? { xFt: point.xFt, yFt: point.yFt } : (node.cp2Ft ? { ...node.cp2Ft } : undefined),
    };

    if (nextNode.nodeType !== "hard") {
      if (handleType === "cp1Ft") {
        nextNode.cp2Ft = { xFt: nextNode.xFt + (nextNode.xFt - point.xFt), yFt: nextNode.yFt + (nextNode.yFt - point.yFt) };
      } else {
        nextNode.cp1Ft = { xFt: nextNode.xFt + (nextNode.xFt - point.xFt), yFt: nextNode.yFt + (nextNode.yFt - point.yFt) };
      }
    }
    return nextNode;
  });
}
