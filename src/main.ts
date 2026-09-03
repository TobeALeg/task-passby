import { homedir } from "node:os";
import { join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, Menu, screen } from "electron";

import { ElectronWorkBuddyLauncher } from "./adapters/workbuddy/launcher.js";
import { AppService } from "./app/app-service.js";
import { WorkPetHttpBridge } from "./bridge/http-bridge.js";
import { WorkPetMcpHandler } from "./bridge/mcp-handler.js";
import { IntegrationInstaller } from "./integrations/installer.js";
let petWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;
let service: AppService | null = null;
let bridge: WorkPetHttpBridge | null = null;

app.setName("WorkPet");
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => revealApp());
}

function requireService(): AppService {
  if (!service) throw new Error("WorkPet 尚未准备完成");
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
    width: 286,
    height: 182,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  petWindow.loadFile(join(app.getAppPath(), "dist", "renderer", "pet.html"));
  const workArea = screen.getPrimaryDisplay().workArea;
  petWindow.setPosition(workArea.x + workArea.width - 304, workArea.y + workArea.height - 206);

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
  panelWindow.setAlwaysOnTop(true, "floating");
  panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panelWindow.loadFile(join(app.getAppPath(), "dist", "renderer", "panel.html"));

  const menu = Menu.buildFromTemplate([
    { label: "打开 WorkPet", click: () => togglePanel() },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]);
  petWindow.webContents.on("context-menu", () => menu.popup());
}

function togglePanel(): void {
  if (!petWindow || !panelWindow) return;
  if (panelWindow.isVisible()) { panelWindow.hide(); return; }
  showPanel();
}

function showPanel(): void {
  if (!petWindow || !panelWindow) return;
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
  panelWindow.setPosition(x, y);
  panelWindow.show();
  panelWindow.focus();
  panelWindow.webContents.send("panel:shown");
}

function revealApp(): void {
  petWindow?.show();
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
    petWindow.setIgnoreMouseEvents(Boolean(ignored), { forward: true });
  });
  ipcMain.handle("panel:close", () => panelWindow?.hide());
  ipcMain.handle("dashboard:get", (_event, workId?: string) => requireService().dashboardWithVerification(workId));
  ipcMain.handle("codex:list", () => requireService().listCodexThreads());
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
      title: "WorkPet 未能启动",
      message: "本机接入安装失败，WorkPet 不会在未接入状态下运行。",
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
});

app.on("activate", () => revealApp());

app.on("before-quit", () => {
  void bridge?.close();
  service?.close();
  service = null;
});
