import { readDockSpace } from "./dock-space.js";
import { readFileSync, writeFileSync } from "node:fs";
import { screen, type BrowserWindow } from "electron";
import { bottomPetDock, dockPet, nearestPetEdge, PET_SIZE, PET_BODY_SIZE, PET_DOCK_SIZE, PET_BODY_CENTER, PET_ABSORB_DURATION, placeFloatingPet, petMovementArea, validPetEdge, type PetPlacement, type Point, type Rectangle } from "./pet-layout.js";

export class PetPosition {
  placement: PetPlacement = { edge: null };
  private center: Point = { x: 0, y: 0 };
  private settling: { timer: ReturnType<typeof setTimeout>; bounds: Rectangle; edge: Exclude<PetPlacement["edge"], null> } | null = null;
  private motionId = 0;
  private drag: { origin: Point; center: Point; latest: Point; moved: boolean } | null = null;
  get edge() { return this.placement.edge; }
  private dockSpace: { width: number; bottom: boolean } | null = null;
  constructor(readonly window: BrowserWindow, readonly path: string) {
    void this.refreshDockSpace();
  }
  private async refreshDockSpace(): Promise<void> { this.dockSpace = await readDockSpace(); }
  private protectedDockWidth(display: Rectangle): number {
    return this.dockSpace ? this.dockSpace.bottom ? this.dockSpace.width : 0 : display.width * 0.8;
  }
  get dragging(): boolean { return this.drag !== null; }
  private apply(bounds: Rectangle, placement: PetPlacement): void {
    this.placement = placement;
    const current = this.window.getBounds();
    if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height)
      this.window.setBounds(bounds);
    this.window.webContents.send("pet:placement", placement);
  }
  private float(center: Point, emerge?: PetPlacement["emerge"]): void {
    const display = screen.getDisplayNearestPoint(center);
    const area = petMovementArea(center, display.bounds, display.workArea, this.protectedDockWidth(display.bounds));
    const layout = placeFloatingPet(center, area);
    this.center = layout.center;
    this.apply(layout.bounds, { edge: null, body: layout.body, ...(emerge ? { emerge } : {}) });
  }
  private finishSettling(): void {
    const settling = this.settling;
    if (!settling) return;
    clearTimeout(settling.timer);
    this.settling = null;
    if (!this.window.isDestroyed()) this.apply(settling.bounds, { edge: settling.edge });
  }
  private absorb(bounds: Rectangle, edge: Exclude<PetPlacement["edge"], null>): void {
    const current = this.window.getBounds();
    const body = this.placement.body!;
    const x = Math.min(current.x, bounds.x), y = Math.min(current.y, bounds.y);
    const stage = { x, y, width: Math.max(current.x + current.width, bounds.x + bounds.width) - x,
      height: Math.max(current.y + current.height, bounds.y + bounds.height) - y };
    const to = { x: bounds.x + bounds.width / 2 - x, y: bounds.y + bounds.height / 2 - y };
    if (edge === "left") to.x = bounds.x - x - 10;
    if (edge === "right") to.x = bounds.x + bounds.width - x + 10;
    if (edge === "top") to.y = bounds.y - y - 10;
    if (edge === "bottom") to.y = bounds.y + bounds.height - y + 10;
    this.settling = { bounds, edge, timer: setTimeout(() => this.finishSettling(), PET_ABSORB_DURATION + 60) };
    this.apply(stage, { edge, dock: { x: bounds.x - x, y: bounds.y - y }, motion: {
      id: ++this.motionId, duration: PET_ABSORB_DURATION,
      from: { x: current.x + body.x - x, y: current.y + body.y - y }, to,
    } });
  }
  restore(): void {
    const area = screen.getPrimaryDisplay().workArea;
    let center = { x: area.x + area.width - PET_SIZE.width + PET_BODY_CENTER.x, y: area.y + area.height - PET_SIZE.height + PET_BODY_CENTER.y };
    let edge = null;
    try {
      const saved = JSON.parse(readFileSync(this.path, "utf8"));
      if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        edge = validPetEdge(saved.edge);
        center = saved.center && Number.isFinite(saved.center.x) && Number.isFinite(saved.center.y)
          ? saved.center : { x: saved.x + (edge ? (edge === "top" || edge === "bottom" ? PET_DOCK_SIZE.width : PET_DOCK_SIZE.height) / 2 : PET_BODY_CENTER.x), y: saved.y + (edge ? (edge === "top" || edge === "bottom" ? PET_DOCK_SIZE.height : PET_DOCK_SIZE.width) / 2 : PET_BODY_CENTER.y) };
      }
    } catch { /* New or invalid preferences use the primary display. */ }
    this.center = center;
    this.placement = { edge };
    this.recover();
  }
  recover(): void {
    this.finishSettling();
    const display = screen.getDisplayNearestPoint(this.center);
    if (this.edge) {
      const bounds = this.edge === "bottom"
        ? bottomPetDock({ ...this.center, y: display.bounds.y + display.bounds.height }, display.bounds, this.protectedDockWidth(display.bounds))
        : dockPet(this.edge, this.center, display.workArea);
      if (!bounds) { this.float(this.center); this.save(); return; }
      this.center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      this.apply(bounds, { edge: this.edge });
    } else this.float(this.center);
    this.save();
  }
  start(cursor: Point): void {
    this.finishSettling();
    void this.refreshDockSpace();
    const bounds = this.window.getBounds();
    const body = this.placement.body;
    this.center = !this.edge && body
      ? { x: bounds.x + body.x + PET_BODY_SIZE.width / 2, y: bounds.y + body.y + PET_BODY_SIZE.height / 2 }
      : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    this.drag = { origin: cursor, latest: cursor, center: this.center, moved: false };
    this.window.setIgnoreMouseEvents(false);
  }
  move(cursor: Point): void {
    const drag = this.drag;
    if (!drag || Math.hypot(cursor.x - drag.origin.x, cursor.y - drag.origin.y) < 5 && !drag.moved) return;
    drag.moved = true;
    drag.latest = cursor;
    const emerge = this.edge ?? undefined;
    if (this.edge) {
      // Keep the visible head under the pointer when detaching the compact window.
      drag.origin = cursor;
      drag.center = cursor;
    }
    this.float({ x: drag.center.x + cursor.x - drag.origin.x, y: drag.center.y + cursor.y - drag.origin.y }, emerge);
  }
  end(): void {
    const drag = this.drag;
    this.drag = null;
    if (drag?.moved) {
      const display = screen.getDisplayNearestPoint(drag.latest);
      const bottom = bottomPetDock(drag.latest, display.bounds, this.protectedDockWidth(display.bounds));
      const edge = bottom ? "bottom" : nearestPetEdge(drag.latest, display.workArea);
      if (edge) {
        const bounds = bottom ?? dockPet(edge, drag.latest, display.workArea);
        this.center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        this.absorb(bounds, edge);
      } else this.float(this.center);
      this.save();
    }
    this.window.setIgnoreMouseEvents(true, { forward: true });
  }
  private save(): void {
    const { x, y } = this.settling?.bounds ?? this.window.getBounds();
    try { writeFileSync(this.path, JSON.stringify({ x, y, center: this.center, ...(this.edge ? { edge: this.edge } : {}) }), "utf8"); }
    catch (error) { console.warn("无法保存桌宠位置", error); }
  }
}
