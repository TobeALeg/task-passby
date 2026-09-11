const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workpet", {
  openArtifact: (workId, itemId) => ipcRenderer.invoke("work:open-artifact", workId, itemId),
  distillation: (action, input) => ipcRenderer.invoke("distillation:command", action, input),
  chooseDefinitionFile: () => ipcRenderer.invoke("distillation:choose-file"),
  exportWorkPackage: (workId) => ipcRenderer.invoke("distillation:export", workId),
  copyWorkPackage: (workId) => ipcRenderer.invoke("distillation:copy", workId),
  configureWorketService: (input) => ipcRenderer.invoke("distillation:configure", input),
  getWorketServiceStatus: () => ipcRenderer.invoke("distillation:connection"),
  recordCurrentContextFromPet: () => ipcRenderer.invoke("panel:record-current-context"),
  onPetPlacement: (callback) => {
    const listener = (_event, edge) => callback(edge);
    ipcRenderer.on("pet:placement", listener);
    return () => ipcRenderer.removeListener("pet:placement", listener);
  },
  getPetView: () => ipcRenderer.invoke("pet:get-view"),
  togglePanelFromPet: () => ipcRenderer.invoke("panel:toggle"),
  setPetMousePassthrough: (ignored) => ipcRenderer.send("pet:mouse-passthrough", ignored),
  dragPet: (phase, cursor) => ipcRenderer.send("pet:drag", phase, cursor),
  getDashboard: (workId) => ipcRenderer.invoke("dashboard:get", workId),
  listExecutors: () => ipcRenderer.invoke("executors:list"),
  listConversations: (executorId) => ipcRenderer.invoke("conversations:list", executorId),
  listRecentConversations: () => ipcRenderer.invoke("conversations:recent"),
  listConversationHistory: (executorId, cursor) => ipcRenderer.invoke("conversations:history", executorId, cursor),
  previewConversation: (executorId, threadId) => ipcRenderer.invoke("conversations:preview", executorId, threadId),
  createWorkFromConversation: (request) => ipcRenderer.invoke("work:create-from-conversation", request),
  listSplitPoints: (workId) => ipcRenderer.invoke("work:split-points", workId),
  createWorkFromMessage: (request) => ipcRenderer.invoke("work:create-from-message", request),
  consumeSourceSelection: () => ipcRenderer.invoke("conversations:selection"),
  refreshWork: (workId) => ipcRenderer.invoke("work:refresh", workId),
  completeWork: (workId) => ipcRenderer.invoke("work:complete", workId),
  archiveWork: (workId) => ipcRenderer.invoke("work:archive", workId),
  resumeWork: (workId) => ipcRenderer.invoke("work:resume", workId),
  cancelHandoff: (workId, confirmation) => ipcRenderer.invoke("work:cancel-handoff", workId, confirmation),
  handoff: (workId, executorId) => ipcRenderer.invoke("work:handoff", workId, executorId),
  cancelRecording: (workId, confirmation) => ipcRenderer.invoke("work:cancel-recording", workId, confirmation),
  onPanelShown: (callback) => {
    const listener = (_event, workId) => callback(workId);
    ipcRenderer.on("panel:shown", listener);
    return () => ipcRenderer.removeListener("panel:shown", listener);
  },
  closePanel: () => ipcRenderer.invoke("panel:close")
});
