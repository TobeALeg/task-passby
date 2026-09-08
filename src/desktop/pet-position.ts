import { readFileSync, writeFileSync } from "node:fs";
import { screen, type BrowserWindow } from "electron";

export function keepPetVisible(window: BrowserWindow): void {
  const bounds = window.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  window.setPosition(
    Math.round(Math.max(area.x, Math.min(bounds.x, area.x + Math.max(0, area.width - bounds.width)))),
    Math.round(Math.max(area.y, Math.min(bounds.y, area.y + Math.max(0, area.height - bounds.height))))
  );
}

export function restorePetPosition(window: BrowserWindow, path: string): void {
  const area = screen.getPrimaryDisplay().workArea;
  const bounds = window.getBounds();
  let position = { x: area.x + area.width - bounds.width, y: area.y + area.height - bounds.height };
  try {
    const saved = JSON.parse(readFileSync(path, "utf8"));
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) position = saved;
  } catch { /* First launch or invalid preferences: use the primary display. */ }
  window.setPosition(Math.round(position.x), Math.round(position.y));
  keepPetVisible(window);
}

export function savePetPosition(window: BrowserWindow, path: string): void {
  const { x, y } = window.getBounds();
  try {
    writeFileSync(path, JSON.stringify({ x, y }), "utf8");
  } catch (error) {
    console.warn("无法保存桌宠位置", error);
  }
}
