const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workpet", {
  distillation: (action, input) => ipcRenderer.invoke("distillation:command", action, input),
  chooseDefinitionFile: () => ipcRenderer.invoke("distillation:choose-file"),
  exportWorkPackage: (workId) => ipcRenderer.invoke("distillation:export", workId),
  copyWorkPackage: (workId) => ipcRenderer.invoke("distillation:copy", workId),
  configureWorketService: (input) => ipcRenderer.invoke("distillation:configure", input),
  recordCurrentContextFromPet: () => ipcRenderer.invoke("panel:record-current-context"),
  getPetView: () => ipcRenderer.invoke("pet:get-view"),
  togglePanelFromPet: () => ipcRenderer.invoke("panel:toggle"),
  setPetMousePassthrough: (ignored) => ipcRenderer.send("pet:mouse-passthrough", ignored),
  dragPet: (phase, cursor) => ipcRenderer.send("pet:drag", phase, cursor),
  getDashboard: (workId) => ipcRenderer.invoke("dashboard:get", workId),
  listCodexThreads: () => ipcRenderer.invoke("codex:list"),
  listCodexHistory: (cursor) => ipcRenderer.invoke("codex:history", cursor),
  previewCodexThread: (threadId) => ipcRenderer.invoke("codex:preview", threadId),
  createWorkFromCodex: (request) => ipcRenderer.invoke("work:create-from-codex", request),
  listCodexSplitPoints: (workId) => ipcRenderer.invoke("work:split-points", workId),
  createWorkFromCodexMessage: (request) => ipcRenderer.invoke("work:create-from-codex-message", request),
  refreshWork: (workId) => ipcRenderer.invoke("work:refresh", workId),
  completeWork: (workId) => ipcRenderer.invoke("work:complete", workId),
  archiveWork: (workId) => ipcRenderer.invoke("work:archive", workId),
  resumeWork: (workId) => ipcRenderer.invoke("work:resume", workId),
  handoffToWorkBuddy: (workId) => ipcRenderer.invoke("work:handoff", workId),
  deleteWork: (workId, confirmation) => ipcRenderer.invoke("work:delete", workId, confirmation),
  onPanelShown: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("panel:shown", listener);
    return () => ipcRenderer.removeListener("panel:shown", listener);
  },
  closePanel: () => ipcRenderer.invoke("panel:close")
});
