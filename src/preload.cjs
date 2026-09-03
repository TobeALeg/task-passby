const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workpet", {
  recordCurrentContextFromPet: () => ipcRenderer.invoke("panel:record-current-context"),
  getDashboard: (workId) => ipcRenderer.invoke("dashboard:get", workId),
  listCodexThreads: () => ipcRenderer.invoke("codex:list"),
  previewCodexThread: (threadId) => ipcRenderer.invoke("codex:preview", threadId),
  createWorkFromCodex: (request) => ipcRenderer.invoke("work:create-from-codex", request),
  listCodexSplitPoints: (workId) => ipcRenderer.invoke("work:split-points", workId),
  createWorkFromCodexMessage: (request) => ipcRenderer.invoke("work:create-from-codex-message", request),
  refreshWork: (workId) => ipcRenderer.invoke("work:refresh", workId),
  editStateItem: (workId, field, itemId, text) => ipcRenderer.invoke("work:state-edit", workId, field, itemId, text),
  deleteStateItem: (workId, field, itemId) => ipcRenderer.invoke("work:state-delete", workId, field, itemId),
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
