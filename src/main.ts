import { latestRelease, downloadRelease } from "./desktop/github-release.js";
import { AppUpdates } from "./desktop/app-updates.js";
import { createDefaultExecutors } from "./executors/defaults.js";
import { writeFileSync } from "node:fs";
import { DistillationDesktop } from "./distillation/desktop.js";
import { WorketAIClient } from "./ai-service/client.js";
import { ServiceCredentials } from "./ai-service/credentials.js";
import { AutomaticConnection, DEFAULT_SERVICE_URL } from "./ai-service/connection.js";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  app,
  net,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  clipboard,
  shell,
} from "electron";

import { ElectronWorkBuddyLauncher } from "./adapters/workbuddy/launcher.js";
import { AppService } from "./app/app-service.js";
import { WorkPetHttpBridge } from "./bridge/http-bridge.js";
import { WorkPetMcpHandler } from "./bridge/mcp-handler.js";
import { IntegrationInstaller } from "./integrations/installer.js";
import { PetPosition } from "./desktop/pet-position.js";
import { PET_SIZE } from "./desktop/pet-layout.js";

let quitting = false;
let updates: AppUpdates;
let petPosition: PetPosition | null = null;
const petPositionPath = () =>
  join(
    process.env.WORKPET_DATA_DIR ?? app.getPath("userData"),
    "pet-position.json",
  );
let petWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;
let service: AppService | null = null;
let bridge: WorkPetHttpBridge | null = null;
let distillation: DistillationDesktop;
let credentials: ServiceCredentials;
let distillationTimer: ReturnType<typeof setTimeout> | null = null;
async function syncDistillations(): Promise<void> {
  await distillation.service.tick();
  if (!quitting)
    distillationTimer = setTimeout(() => void syncDistillations(), 2000);
}
let captureTimer: ReturnType<typeof setTimeout> | null = null;

async function syncRecordedWorks(): Promise<void> {
  try {
    await service?.syncRecordedWorks();
  } finally {
    if (service && !quitting)
      captureTimer = setTimeout(() => void syncRecordedWorks(), 5_000);
  }
}

const hasExplicitUserDataDirectory = process.argv.some(
  (argument) =>
    argument === "--user-data-dir" || argument.startsWith("--user-data-dir="),
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
    ...PET_SIZE,
    transparent: true,
    frame: false,
    // Position is constrained by PetPosition; allow the empty strip beside the Dock.
    enableLargerThanScreen: true,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  petWindow.on("closed", () => {
    petWindow = null;
    petPosition = null;
  });
  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  petWindow.loadFile(join(app.getAppPath(), "dist", "renderer", "pet.html"));
  petPosition = new PetPosition(petWindow, petPositionPath());
  petPosition.restore();
  const recoverPosition = () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    petPosition?.recover();
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
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  panelWindow.on("closed", () => {
    panelWindow = null;
  });
  panelWindow.setAlwaysOnTop(true, "floating");
  panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panelWindow.loadFile(
    join(app.getAppPath(), "dist", "renderer", "panel.html"),
  );

  const menu = Menu.buildFromTemplate([
    { label: "打开 Worket", click: () => togglePanel() },
    { label: "检查更新…", click: () => updates.check(true) },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]);
  petWindow.webContents.on("context-menu", () => menu.popup());
}

function togglePanel(): void {
  if (
    quitting ||
    !petWindow ||
    petWindow.isDestroyed() ||
    !panelWindow ||
    panelWindow.isDestroyed()
  )
    return;
  if (panelWindow.isVisible()) {
    panelWindow.hide();
    return;
  }
  showPanel();
}

function showPanel(): void {
  if (
    quitting ||
    !petWindow ||
    petWindow.isDestroyed() ||
    !panelWindow ||
    panelWindow.isDestroyed()
  )
    return;
  const petBounds = petWindow.getBounds();
  const panelBounds = panelWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: petBounds.x,
    y: petBounds.y,
  });
  const rightX = petBounds.x + petBounds.width + 8;
  const x =
    rightX + panelBounds.width <= display.workArea.x + display.workArea.width
      ? rightX
      : petBounds.x - panelBounds.width - 8;
  const y = Math.min(
    Math.max(
      display.workArea.y + 8,
      petBounds.y - panelBounds.height + petBounds.height,
    ),
    display.workArea.y + display.workArea.height - panelBounds.height - 8,
  );
  panelWindow.setPosition(
    Math.max(
      display.workArea.x,
      Math.min(
        x,
        display.workArea.x +
          Math.max(0, display.workArea.width - panelBounds.width),
      ),
    ),
    Math.max(display.workArea.y, y),
  );
  panelWindow.show();
  panelWindow.focus();
  panelWindow.webContents.send("panel:shown");
}

function revealApp(): void {
  if (
    quitting ||
    !petWindow ||
    petWindow.isDestroyed() ||
    !panelWindow ||
    panelWindow.isDestroyed()
  )
    return;
  petWindow.show();
  if (panelWindow?.isVisible()) {
    panelWindow.focus();
  } else {
    showPanel();
  }
}

function registerIpc(): void {
  ipcMain.handle("distillation:command", (event, action, input) => {
    if (event.sender !== panelWindow?.webContents)
      throw new Error("INVALID_SENDER");
    return distillation.call(action, input);
  });
  ipcMain.handle("distillation:configure", (event, input) => {
    if (event.sender !== panelWindow?.webContents)
      throw new Error("INVALID_SENDER");
    credentials.save(input);
  });
  ipcMain.handle("distillation:connection", (event) => {
    if (event.sender !== panelWindow?.webContents) throw new Error("INVALID_SENDER");
    const current = credentials.read();
    return { url: current.url, automatic: !!current.installationSecret,
      hasCredential: !!current.token, expiresAt: current.expiresAt ?? null };
  });
  ipcMain.handle("distillation:choose-file", async (event) => {
    if (event.sender !== panelWindow?.webContents)
      throw new Error("INVALID_SENDER");
    return (
      (await dialog.showOpenDialog({ properties: ["openFile"] }))
        .filePaths[0] ?? null
    );
  });
  ipcMain.handle("distillation:copy", async (event, workId) => {
    if (event.sender !== panelWindow?.webContents)
      throw new Error("INVALID_SENDER");
    const result = (await distillation.call("package", { workId })) as {
      markdown: string;
    };
    clipboard.writeText(result.markdown);
  });
  ipcMain.handle("distillation:export", async (event, workId) => {
    if (event.sender !== panelWindow?.webContents)
      throw new Error("INVALID_SENDER");
    const result = (await distillation.call("package", { workId })) as {
      json: unknown;
      markdown: string;
    };
    const target = await dialog.showSaveDialog({
      defaultPath: "work-package.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (target.canceled || !target.filePath) return null;
    writeFileSync(target.filePath, result.markdown, { mode: 0o600 });
    writeFileSync(
      target.filePath.replace(/\.md$/i, "") + ".json",
      JSON.stringify(result.json, null, 2),
      { mode: 0o600 },
    );
    return target.filePath;
  });
  ipcMain.handle("panel:toggle", () => togglePanel());
  ipcMain.handle("pet:get-view", async () => ({
    ...await requireService().getPetView(),
    recordingUploadNoticeRequired: distillation.service.recordings.noticeRequired(),
    edge: petPosition?.edge ?? null,
    placement: petPosition?.placement,
  }));
  ipcMain.handle("panel:record-current-context", async () => {
    const dashboard = await requireService().recordCurrentContext();
    showPanel();
    return dashboard;
  });
  ipcMain.on("pet:mouse-passthrough", (event, ignored: boolean) => {
    if (event.sender !== petWindow?.webContents) return;
    petWindow.setIgnoreMouseEvents(petPosition?.dragging ? false : Boolean(ignored), {
      forward: true,
    });
  });
  ipcMain.on(
    "pet:drag",
    (event, phase: string, cursor?: { x: number; y: number }) => {
      if (event.sender !== petWindow?.webContents) return;
      if (
        (phase === "start" || phase === "move") &&
        (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y))
      )
        return;
      if (phase === "start" && cursor) petPosition?.start(cursor);
      else if (phase === "move" && cursor) petPosition?.move(cursor);
      else if (phase === "end") petPosition?.end();
    },
  );
  ipcMain.handle("panel:close", () => panelWindow?.hide());
  ipcMain.handle("dashboard:get", (_event, workId?: string) =>
    requireService().dashboardWithVerification(workId),
  );
  ipcMain.handle("executors:list", () => requireService().listExecutors());
  ipcMain.handle("conversations:list", (_event, executorId: string) =>
    requireService().listConversations(executorId),
  );
  ipcMain.handle("conversations:recent", () =>
    requireService().listRecentConversations(),
  );
  ipcMain.handle(
    "conversations:history",
    (_event, executorId: string, cursor?: string) =>
      requireService().listConversationHistory(executorId, cursor),
  );
  ipcMain.handle(
    "conversations:preview",
    (_event, executorId: string, threadId: string) =>
      requireService().previewConversation(executorId, threadId),
  );
  ipcMain.handle("conversations:selection", () =>
    requireService().consumeSourceSelection(),
  );
  ipcMain.handle("work:create-from-conversation", (_event, request) =>
    requireService().createWorkFromConversation(request),
  );
  ipcMain.handle("work:split-points", (_event, workId: string) =>
    requireService().listSplitPoints(workId),
  );
  ipcMain.handle("work:create-from-message", (_event, request) =>
    requireService().createWorkFromMessage(request),
  );
  ipcMain.handle("work:refresh", (_event, workId: string) =>
    requireService().refreshWork(workId),
  );
  ipcMain.handle("work:complete", (_event, workId: string) =>
    requireService().completeWork(workId),
  );
  ipcMain.handle("work:archive", (_event, workId: string) =>
    requireService().archiveWork(workId),
  );
  ipcMain.handle("work:resume", (_event, workId: string) =>
    requireService().resumeWork(workId),
  );
  ipcMain.handle(
    "work:cancel-handoff",
    (_event, workId: string, confirmation: string) =>
      requireService().cancelHandoff(workId, confirmation),
  );
  ipcMain.handle("work:handoff", (_event, workId: string, executorId: string) =>
    requireService().handoff(workId, executorId),
  );
  ipcMain.handle(
    "work:cancel-recording",
    (_event, workId: string, confirmation: string) =>
      requireService().cancelRecording(workId, confirmation),
  );
}

app.whenReady().then(async () => {
  await configureDock();
  updates = new AppUpdates({
    showDialog: (options) => dialog.showMessageBox(options),
    enabled: process.platform === "darwin" && app.isPackaged && !process.argv.includes("--dev"),
    version: app.getVersion(),
    latest: () => latestRelease((url, init) => net.fetch(url, init), app.getVersion(), process.arch),
    download: (release) => downloadRelease((url, init) => net.fetch(url, init), release, app.getPath("downloads")),
    reveal: (path) => shell.showItemInFolder(path),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Worket", submenu: [
      { role: "about" },
      { label: "检查更新…", click: () => updates.check(true) },
      { type: "separator" }, { role: "quit" },
    ] },
    { role: "editMenu" },
  ]));
  const dataDirectory = process.env.WORKPET_DATA_DIR ?? app.getPath("userData");
  const executors = createDefaultExecutors({
    launcher: new ElectronWorkBuddyLauncher(),
    openUrl: (url) => shell.openExternal(url),
  });
  service = new AppService({
    databasePath: join(dataDirectory, "workpet.sqlite"),
    onRecordingStarted: id => distillation.service.recordings.start(id),
    onRecordingStopped: id => distillation.service.recordings.stop(id),
    executors,
  });
  credentials = new ServiceCredentials(
    join(dataDirectory, "worket-service.enc"),
    !app.isPackaged || process.argv.includes("--dev"),
  );
  const connection = new AutomaticConnection(credentials,
    !app.isPackaged ? process.env.WORKET_SERVICE_URL ?? DEFAULT_SERVICE_URL : DEFAULT_SERVICE_URL);
  connection.initialize();
  distillation = new DistillationDesktop(
    service,
    new WorketAIClient(() => credentials.read(), () => connection.ready()),
  );
  bridge = new WorkPetHttpBridge({
    configPath:
      process.env.WORKPET_BRIDGE_CONFIG ??
      join(homedir(), ".workpet", "bridge.json"),
    mcp: new WorkPetMcpHandler(
      service.core(),
      process.env.WORKPET_QA_PROOF_TOKEN
        ? { proofToken: process.env.WORKPET_QA_PROOF_TOKEN }
        : {},
    ),
    onHook: (executorId, payload) =>
      requireService().syncHook(executorId, payload),
  });
  await bridge.start();
  createWindows();
  registerIpc();
  if (process.env.WORKPET_SKIP_INTEGRATIONS !== "1") void connection.ready().catch(() => {});
  if (process.env.WORKPET_SKIP_INTEGRATIONS !== "1")
    void new IntegrationInstaller(
      integrationResourceRoot(),
      executors,
    ).install();
  void syncRecordedWorks();
  void syncDistillations();
  updates.start();
});

app.on("activate", () => revealApp());

app.on("before-quit", () => {
  quitting = true;
  updates?.stop();
  if (captureTimer) clearTimeout(captureTimer);
  if (distillationTimer) clearTimeout(distillationTimer);
  distillation?.service.close();
  void bridge?.close();
  service?.close();
  service = null;
});
