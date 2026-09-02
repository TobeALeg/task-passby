import { homedir } from "node:os";
import { join } from "node:path";

import { app, BrowserWindow, ipcMain, Menu, dialog, screen, type MessageBoxOptions } from "electron";

import { WorkBuddyHookIngestor } from "./adapters/workbuddy/hook-ingestor.js";
import { ElectronWorkBuddyLauncher } from "./adapters/workbuddy/launcher.js";
import { AppService } from "./app/app-service.js";
import { WorkPetHttpBridge } from "./bridge/http-bridge.js";
import { WorkPetMcpHandler } from "./bridge/mcp-handler.js";
import { IntegrationInstaller } from "./integrations/installer.js";
import type { WorkStateField } from "./ui-contract.js";

let petWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;
let service: AppService | null = null;
let bridge: WorkPetHttpBridge | null = null;

app.setName("WorkPet");
if (!app.requestSingleInstanceLock()) app.quit();

function requireService(): AppService {
  if (!service) throw new Error("WorkPet 尚未准备完成");
  return service;
}

function createWindows(): void {
  const preload = join(app.getAppPath(), "dist", "preload.cjs");
  petWindow = new BrowserWindow({
    width: 112,
    height: 116,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.loadFile(join(app.getAppPath(), "dist", "renderer", "pet.html"));
  const workArea = screen.getPrimaryDisplay().workArea;
  petWindow.setPosition(workArea.x + workArea.width - 135, workArea.y + workArea.height - 150);

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

function registerIpc(): void {
  ipcMain.handle("panel:toggle", () => togglePanel());
  ipcMain.handle("panel:close", () => panelWindow?.hide());
  ipcMain.handle("dashboard:get", (_event, workId?: string) => requireService().dashboardWithVerification(workId));
  ipcMain.handle("codex:list", () => requireService().listCodexThreads());
  ipcMain.handle("codex:preview", (_event, threadId: string) => requireService().previewCodexThread(threadId));
  ipcMain.handle("work:create-from-codex", (_event, request) => requireService().createWorkFromCodex(request));
  ipcMain.handle("work:split-points", (_event, workId: string) => requireService().listCodexSplitPoints(workId));
  ipcMain.handle("work:create-from-codex-message", (_event, request) => requireService().createWorkFromCodexMessage(request));
  ipcMain.handle("work:refresh", (_event, workId: string) => requireService().refreshWork(workId));
  ipcMain.handle("work:state-edit", (_event, workId: string, field: WorkStateField, itemId: string, text: string) => requireService().editStateItem(workId, field, itemId, text));
  ipcMain.handle("work:state-delete", (_event, workId: string, field: WorkStateField, itemId: string) => requireService().deleteStateItem(workId, field, itemId));
  ipcMain.handle("work:complete", (_event, workId: string) => requireService().completeWork(workId));
  ipcMain.handle("work:archive", (_event, workId: string) => requireService().archiveWork(workId));
  ipcMain.handle("work:resume", (_event, workId: string) => requireService().resumeWork(workId));
  ipcMain.handle("work:handoff", (_event, workId: string) => requireService().handoffToWorkBuddy(workId));
  ipcMain.handle("work:delete", (_event, workId: string, confirmation: string) => requireService().deleteWork(workId, confirmation));
  ipcMain.handle("integrations:install", async () => {
    const options: MessageBoxOptions = {
      type: "question",
      buttons: ["安装", "取消"],
      defaultId: 0,
      cancelId: 1,
      title: "启用 Codex 与 WorkBuddy 接入",
      message: "安装两个本地插件？",
      detail: "Codex Hook 只通知已绑定任务变化；WorkBuddy 使用用户级 MCP 与可见对话 Hook。首次一键接力时，macOS 会询问“辅助功能”权限以代你按下发送。所有数据仍留在本机。"
    };
    const answer = panelWindow
      ? await dialog.showMessageBox(panelWindow, options)
      : await dialog.showMessageBox(options);
    if (answer.response !== 0) return { cancelled: true };
    return new IntegrationInstaller(app.getAppPath()).install();
  });
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock?.hide();
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
    hooks: new WorkBuddyHookIngestor(service.core()),
    onCodexHook: (payload) => requireService().syncCodexHook(payload)
  });
  await bridge.start();
  createWindows();
  registerIpc();
});

app.on("before-quit", () => {
  void bridge?.close();
  service?.close();
  service = null;
});
