import { homedir } from "node:os";
import { join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, Menu, screen } from "electron";

import { ElectronWorkBuddyLauncher } from "./adapters/workbuddy/launcher.js";
import { AppService } from "./app/app-service.js";
import { WorkPetHttpBridge } from "./bridge/http-bridge.js";
import { WorkPetMcpHandler } from "./bridge/mcp-handler.js";
import { IntegrationInstaller } from "./integrations/installer.js";
import { keepPetVisible, restorePetPosition, savePetPosition } from "./desktop/pet-position.js";

let quitting = false;
let petDrag: { cursor: { x: number; y: number }; x: number; y: number } | null = null;
const petPositionPath = () => join(process.env.WORKPET_DATA_DIR ?? app.getPath("userData"), "pet-position.json");
let petWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;
let service: AppService | null = null;
let bridge: WorkPetHttpBridge | null = null;
let captureTimer: ReturnType<typeof setTimeout> | null = null;

async function syncRecordedWorks(): Promise<void> {
  try {
    await service?.syncRecordedCodexWorks();
  } finally {
    if (service) captureTimer = setTimeout(() => void syncRecordedWorks(), 5_000);
  }
}
const PET_WINDOW_WIDTH = 304;
const PET_WINDOW_HEIGHT = 206;

const hasExplicitUserDataDirectory = process.argv.some(
  (argument) => argument === "--user-data-dir" || argument.startsWith("--user-data-dir=")
);

// 展示名称可以更新，但日常启动沿用原目录，避免一次品牌调整让现有本地记录看似消失。
app.setName("Worket");
if (!hasExplicitUserDataDirectory) {
  app.setPath("userData", join(app.getPath("appData"), "WorkPet"));
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => revealApp());
}

function requireService(): AppService {
  if (!service) throw new Error("Worket 尚未准备完成");
  return service;
}

function applicationResourceRoot(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

function integrationResourceRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "app.asar.unpacked")
    : app.getAppPath();
}

async function configureDock(): Promise<void> {
  if (process.platform !== "darwin" || !app.dock) return;
  const iconPath = app.isPackaged
    ? join(applicationResourceRoot(), "WorkPet.png")
    : join(applicationResourceRoot(), "assets", "WorkPet.png");
  app.dock.setIcon(iconPath);
  await app.dock.show();
}

function createWindows(): void {
  const preload = join(app.getAppPath(), "dist", "preload.cjs");
  petWindow = new BrowserWindow({
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  petWindow.on("closed", () => { petWindow = null; petDrag = null; });
  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  petWindow.loadFile(join(app.getAppPath(), "dist", "renderer", "pet.html"));
  restorePetPosition(petWindow, petPositionPath());
  const recoverPosition = () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    keepPetVisible(petWindow);
    savePetPosition(petWindow, petPositionPath());
  };
  screen.on("display-removed", recoverPosition);
  screen.on("display-metrics-changed", recoverPosition);

  panelWindow = new BrowserWindow({
    width: 448,
    height: 760,
    show: false,
    frame: false,
    transparent: false,
    resizable: true,
    alwaysOnTop: true,
    backgroundColor: "#f6f2e9",
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  panelWindow.on("closed", () => { panelWindow = null; });
  panelWindow.setAlwaysOnTop(true, "floating");
  panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panelWindow.loadFile(join(app.getAppPath(), "dist", "renderer", "panel.html"));

  const menu = Menu.buildFromTemplate([
    { label: "打开 Worket", click: () => togglePanel() },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]);
  petWindow.webContents.on("context-menu", () => menu.popup());
}

function togglePanel(): void {
  if (quitting || !petWindow || petWindow.isDestroyed() || !panelWindow || panelWindow.isDestroyed()) return;
  if (panelWindow.isVisible()) { panelWindow.hide(); return; }
  showPanel();
}

function showPanel(): void {
  if (quitting || !petWindow || petWindow.isDestroyed() || !panelWindow || panelWindow.isDestroyed()) return;
  const petBounds = petWindow.getBounds();
  const panelBounds = panelWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: petBounds.x, y: petBounds.y });
  const rightX = petBounds.x + petBounds.width + 8;
  const x = rightX + panelBounds.width <= display.workArea.x + display.workArea.width
    ? rightX
    : petBounds.x - panelBounds.width - 8;
  const y = Math.min(
    Math.max(display.workArea.y + 8, petBounds.y - panelBounds.height + petBounds.height),
    display.workArea.y + display.workArea.height - panelBounds.height - 8
  );
  panelWindow.setPosition(
    Math.max(display.workArea.x, Math.min(x, display.workArea.x + Math.max(0, display.workArea.width - panelBounds.width))),
    Math.max(display.workArea.y, y)
  );
  panelWindow.show();
  panelWindow.focus();
  panelWindow.webContents.send("panel:shown");
}

function revealApp(): void {
  if (quitting || !petWindow || petWindow.isDestroyed() || !panelWindow || panelWindow.isDestroyed()) return;
  petWindow.show();
  if (panelWindow?.isVisible()) {
    panelWindow.focus();
  } else {
    showPanel();
  }
}

function registerIpc(): void {
  ipcMain.handle("panel:toggle", () => togglePanel());
  ipcMain.handle("pet:get-view", () => requireService().getPetView());
  ipcMain.handle("panel:record-current-context", async () => {
    const dashboard = await requireService().recordCurrentContext();
    showPanel();
    return dashboard;
  });
  ipcMain.on("pet:mouse-passthrough", (event, ignored: boolean) => {
    if (event.sender !== petWindow?.webContents) return;
    petWindow.setIgnoreMouseEvents(petDrag ? false : Boolean(ignored), { forward: true });
  });
  ipcMain.on("pet:drag", (event, phase: string, cursor?: { x: number; y: number }) => {
    if (event.sender !== petWindow?.webContents) return;
    if ((phase === "start" || phase === "move") && (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y))) return;
    if (phase === "start" && cursor) {
      const { x, y } = petWindow.getBounds();
      petDrag = { cursor, x, y };
      petWindow.setIgnoreMouseEvents(false);
    } else if (phase === "move" && petDrag && cursor) {
      petWindow.setPosition(Math.round(petDrag.x + cursor.x - petDrag.cursor.x), Math.round(petDrag.y + cursor.y - petDrag.cursor.y));
    } else if (phase === "end" && petDrag) {
      petDrag = null;
      keepPetVisible(petWindow);
      savePetPosition(petWindow, petPositionPath());
      petWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });
  ipcMain.handle("panel:close", () => panelWindow?.hide());
  ipcMain.handle("dashboard:get", (_event, workId?: string) => requireService().dashboardWithVerification(workId));
  ipcMain.handle("codex:list", () => requireService().listCodexThreads());
  ipcMain.handle("codex:history", (_event, cursor?: string) => requireService().listCodexHistory(cursor));
  ipcMain.handle("codex:preview", (_event, threadId: string) => requireService().previewCodexThread(threadId));
  ipcMain.handle("work:create-from-codex", (_event, request) => requireService().createWorkFromCodex(request));
  ipcMain.handle("work:split-points", (_event, workId: string) => requireService().listCodexSplitPoints(workId));
  ipcMain.handle("work:create-from-codex-message", (_event, request) => requireService().createWorkFromCodexMessage(request));
  ipcMain.handle("work:refresh", (_event, workId: string) => requireService().refreshWork(workId));
  ipcMain.handle("work:complete", (_event, workId: string) => requireService().completeWork(workId));
  ipcMain.handle("work:archive", (_event, workId: string) => requireService().archiveWork(workId));
  ipcMain.handle("work:resume", (_event, workId: string) => requireService().resumeWork(workId));
  ipcMain.handle("work:handoff", (_event, workId: string) => requireService().handoffToWorkBuddy(workId));
  ipcMain.handle("work:delete", (_event, workId: string, confirmation: string) => requireService().deleteWork(workId, confirmation));
}

app.whenReady().then(async () => {
  await configureDock();
  Menu.setApplicationMenu(null);
  const dataDirectory = process.env.WORKPET_DATA_DIR ?? app.getPath("userData");
  service = new AppService({
    databasePath: join(dataDirectory, "workpet.sqlite"),
    launcher: new ElectronWorkBuddyLauncher()
  });
  bridge = new WorkPetHttpBridge({
    configPath: process.env.WORKPET_BRIDGE_CONFIG ?? join(homedir(), ".workpet", "bridge.json"),
    mcp: new WorkPetMcpHandler(
      service.core(),
      process.env.WORKPET_QA_PROOF_TOKEN
        ? { proofToken: process.env.WORKPET_QA_PROOF_TOKEN }
        : {}
    ),
    onWorkBuddyHook: (payload) => requireService().syncWorkBuddyHook(payload),
    onCodexHook: (payload) => requireService().syncCodexHook(payload)
  });
  await bridge.start();
  try {
    await new IntegrationInstaller(integrationResourceRoot()).install();
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      buttons: ["退出"],
      defaultId: 0,
      title: "Worket 未能启动",
      message: "本机接入安装失败，Worket 不会在未接入状态下运行。",
      detail: error instanceof Error ? error.message : String(error)
    });
    await bridge.close();
    service.close();
    service = null;
    app.quit();
    return;
  }
  createWindows();
  registerIpc();
  void syncRecordedWorks();
});

app.on("activate", () => revealApp());

app.on("before-quit", () => {
  quitting = true;
  if (captureTimer) clearTimeout(captureTimer);
  void bridge?.close();
  service?.close();
  service = null;
});
