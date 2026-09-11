import { readFileSync, writeFileSync } from "node:fs";
import { screen, type BrowserWindow } from "electron";
import { constrainPet, dockPet, floatingPet, nearestPetEdge, PET_DOCK_SIZE, PET_SIZE, validPetEdge, type PetEdge, type Point, type Rectangle } from "./pet-layout.js";

export class PetPosition {
  edge: PetEdge = null;
  private drag: { origin: Point; bounds: Rectangle; latest: Point; moved: boolean } | null = null;
  constructor(readonly window: BrowserWindow, readonly path: string) {}
  get dragging(): boolean { return this.drag !== null; }
  private apply(bounds: Rectangle, edge: PetEdge): void {
    this.edge = edge;
    this.window.setBounds(bounds);
    this.window.webContents.send("pet:placement", edge);
  }
  restore(): void {
    const area = screen.getPrimaryDisplay().workArea;
    let position = { x: area.x + area.width - PET_SIZE.width, y: area.y + area.height - PET_SIZE.height };
    try {
      const saved = JSON.parse(readFileSync(this.path, "utf8"));
      if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        position = { x: saved.x, y: saved.y };
        this.edge = validPetEdge(saved.edge);
      }
    } catch { /* New or invalid preferences use the primary display. */ }
    const size = this.edge === "top" ? PET_DOCK_SIZE : this.edge ? { width: PET_DOCK_SIZE.height, height: PET_DOCK_SIZE.width } : PET_SIZE;
    this.apply({ ...position, ...size }, this.edge);
    this.recover();
  }
  recover(): void {
    const bounds = this.window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    this.apply(this.edge ? dockPet(this.edge, center, area) : constrainPet(bounds, area), this.edge);
    this.save();
  }
  start(cursor: Point): void {
    this.drag = { origin: cursor, latest: cursor, bounds: this.window.getBounds(), moved: false };
    this.window.setIgnoreMouseEvents(false);
  }
  move(cursor: Point): void {
    const drag = this.drag;
    if (!drag || Math.hypot(cursor.x - drag.origin.x, cursor.y - drag.origin.y) < 5 && !drag.moved) return;
    drag.moved = true;
    drag.latest = cursor;
    if (this.edge) {
      const bounds = floatingPet(cursor);
      this.apply(bounds, null);
      drag.origin = cursor;
      drag.bounds = bounds;
    } else {
      this.window.setPosition(Math.round(drag.bounds.x + cursor.x - drag.origin.x), Math.round(drag.bounds.y + cursor.y - drag.origin.y));
    }
  }
  end(): void {
    const drag = this.drag;
    this.drag = null;
    if (drag?.moved) {
      const area = screen.getDisplayNearestPoint(drag.latest).workArea;
      const edge = nearestPetEdge(drag.latest, area);
      if (edge) this.apply(dockPet(edge, drag.latest, area), edge);
      else this.apply(constrainPet(this.window.getBounds(), area), null);
      this.save();
    }
    this.window.setIgnoreMouseEvents(true, { forward: true });
  }
  private save(): void {
    const { x, y } = this.window.getBounds();
    try { writeFileSync(this.path, JSON.stringify({ x, y, ...(this.edge ? { edge: this.edge } : {}) }), "utf8"); }
    catch (error) { console.warn("无法保存桌宠位置", error); }
  }
}
