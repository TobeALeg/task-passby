export type PetEdge = "left" | "right" | "top" | null;
export type Point = { x: number; y: number };
export type Rectangle = Point & { width: number; height: number };
export const PET_SIZE = { width: 304, height: 270 };
export const PET_DOCK_SIZE = { width: 68, height: 32 };
export const PET_SNAP_DISTANCE = 24;
// The normal character is bottom-right inside the transparent window (75% scale).
export const PET_BODY_CENTER = { x: 231, y: 198 };
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
  return edge === "top"
    ? { x: clamp(point.x - long / 2, area.x, area.x + area.width - long), y: area.y, width: long, height: short }
    : { x: edge === "left" ? area.x : area.x + area.width - short, y: clamp(point.y - long / 2, area.y, area.y + area.height - long), width: short, height: long };
}
export function floatingPet(point: Point): Rectangle {
  return { x: Math.round(point.x - PET_BODY_CENTER.x), y: Math.round(point.y - PET_BODY_CENTER.y), ...PET_SIZE };
}
export function validPetEdge(value: unknown): PetEdge {
  return value === "left" || value === "right" || value === "top" ? value : null;
}
