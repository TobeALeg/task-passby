export type PetEdge = "left" | "right" | "top" | "bottom" | null;
export type Point = { x: number; y: number };
export type Rectangle = Point & { width: number; height: number };
export const PET_SIZE = { width: 304, height: 270 };
export const PET_DOCK_SIZE = { width: 68, height: 32 };
export const PET_SNAP_DISTANCE = 24;
// The normal character is bottom-right inside the transparent window (75% scale).
export const PET_BODY_SIZE = { width: 78, height: 70.5 };
export const PET_BODY_CENTER = { x: 231, y: 197.75 };
export type PetPlacement = { edge: PetEdge; body?: Point };
const clamp = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(value, Math.max(min, max))));
export function constrainPet(bounds: Rectangle, area: Rectangle): Rectangle {
  return { ...bounds, x: clamp(bounds.x, area.x, area.x + area.width - bounds.width), y: clamp(bounds.y, area.y, area.y + area.height - bounds.height) };
}
export function nearestPetEdge(point: Point, area: Rectangle): PetEdge {
  const distances: [Exclude<PetEdge, null>, number][] = [
    ["left", Math.max(0, point.x - area.x)],
    ["right", Math.max(0, area.x + area.width - point.x)],
    ["top", Math.max(0, point.y - area.y)],
  ];
  const nearest = distances.sort((a, b) => a[1] - b[1])[0]!;
  return nearest[1] <= PET_SNAP_DISTANCE ? nearest[0] : null;
}
export function dockPet(edge: Exclude<PetEdge, null>, point: Point, area: Rectangle): Rectangle {
  const { width: long, height: short } = PET_DOCK_SIZE;
  return edge === "top" || edge === "bottom"
    ? { x: clamp(point.x - long / 2, area.x, area.x + area.width - long), y: edge === "top" ? area.y : area.y + area.height - short, width: long, height: short }
    : { x: edge === "left" ? area.x : area.x + area.width - short, y: clamp(point.y - long / 2, area.y, area.y + area.height - long), width: short, height: long };
}
export function floatingPet(point: Point): Rectangle {
  return { x: Math.round(point.x - PET_BODY_CENTER.x), y: Math.round(point.y - PET_BODY_CENTER.y), ...PET_SIZE };
}
export function validPetEdge(value: unknown): PetEdge {
  return value === "left" || value === "right" || value === "top" || value === "bottom" ? value : null;
}

// Clamp the visible character, not the transparent space reserved for its bubble.
export function placeFloatingPet(center: Point, area: Rectangle): { bounds: Rectangle; body: Point; center: Point } {
  const x = clamp(center.x, area.x + PET_BODY_SIZE.width / 2, area.x + area.width - PET_BODY_SIZE.width / 2);
  const y = clamp(center.y, area.y + PET_BODY_SIZE.height / 2, area.y + area.height - PET_BODY_SIZE.height / 2);
  const bounds = constrainPet(floatingPet({ x, y }), area);
  return { bounds, body: { x: x - bounds.x - PET_BODY_SIZE.width / 2, y: y - bounds.y - PET_BODY_SIZE.height / 2 }, center: { x, y } };
}

export function bottomPetDock(point: Point, display: Rectangle, protectedWidth: number): Rectangle | null {
  if (point.y < display.y + display.height - PET_SNAP_DISTANCE) return null;
  const bounds = dockPet("bottom", point, display);
  const middle = display.x + display.width / 2;
  const gap = Math.max(0, protectedWidth) / 2 + 12;
  return bounds.x + bounds.width <= middle - gap || bounds.x >= middle + gap ? bounds : null;
}

// The same empty lane must be available while dragging and after docking.
export function petMovementArea(center: Point, display: Rectangle, workArea: Rectangle, protectedWidth: number): Rectangle {
  const bottom = display.y + display.height;
  const lane = bottomPetDock({ x: center.x, y: bottom }, display,
    protectedWidth + PET_BODY_SIZE.width - PET_DOCK_SIZE.width);
  return lane ? { ...workArea, height: bottom - workArea.y } : workArea;
}
