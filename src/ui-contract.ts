export const WORK_STATE_LABELS = {
  objective: "目标",
  successCriteria: "完成标准",
  constraints: "约束",
  facts: "事实",
  decisions: "决定",
  completedActions: "已完成",
  pendingActions: "下一步",
  artifacts: "资料与产物"
} as const;

export type WorkStateField = keyof typeof WORK_STATE_LABELS;
export type WorkStatus = "OPEN" | "COMPLETED" | "ARCHIVED";
export type PetState = "sleeping" | "awake" | "carrying" | "alert";

export interface StateItemView {
  id: string;
  text: string;
  origin: "USER_STATED" | "AGENT_PROPOSED" | "SYSTEM_INFERRED" | "USER_EDITED";
  sourceMessageIds: string[];
}

export type WorkStateView = Record<WorkStateField, StateItemView[]>;

export interface WorkSummaryView {
  id: string;
  title: string;
  status: WorkStatus;
  updatedAt: string;
  eventCount: number;
  artifactCount: number;
  episodeCount: number;
}

export interface WorkDetailView extends WorkSummaryView {
  state: WorkStateView;
  episodes: Array<{
    id: string;
    executor: string;
    environment: string;
    status: "ACTIVE" | "ENDED";
    startedAt: string;
    endedAt: string | null;
  }>;
  bindings: Array<{
    id: string;
    adapter: string;
    conversationId: string;
    status: "ACTIVE" | "INACTIVE";
  }>;
}

export interface DashboardView {
  petState: PetState;
  selectedWorkId: string | null;
  works: WorkSummaryView[];
  selectedWork: WorkDetailView | null;
  notice: string | null;
}

export interface CodexThreadView {
  id: string;
  title: string;
  preview: string;
  cwd: string;
  updatedAt: string;
  status: unknown;
}

export interface CodexImportPreview extends CodexThreadView {
  messageCount: number;
  artifactCount: number;
  toolEventCount: number;
}

export interface CreateWorkRequest {
  threadId: string;
  allowCloudExtraction: boolean;
}

export interface CodexSplitPointView {
  externalId: string;
  label: string;
  timestamp: string;
}

export interface CreateWorkFromCodexMessageRequest {
  sourceWorkId: string;
  startExternalId: string;
}

export interface WorkPetApi {
  togglePanel(): Promise<void>;
  getDashboard(workId?: string): Promise<DashboardView>;
  listCodexThreads(): Promise<CodexThreadView[]>;
  previewCodexThread(threadId: string): Promise<CodexImportPreview>;
  createWorkFromCodex(request: CreateWorkRequest): Promise<DashboardView>;
  listCodexSplitPoints(workId: string): Promise<CodexSplitPointView[]>;
  createWorkFromCodexMessage(request: CreateWorkFromCodexMessageRequest): Promise<DashboardView>;
  refreshWork(workId: string): Promise<DashboardView>;
  editStateItem(workId: string, field: WorkStateField, itemId: string, text: string): Promise<DashboardView>;
  deleteStateItem(workId: string, field: WorkStateField, itemId: string): Promise<DashboardView>;
  completeWork(workId: string): Promise<DashboardView>;
  archiveWork(workId: string): Promise<DashboardView>;
  resumeWork(workId: string): Promise<DashboardView>;
  handoffToWorkBuddy(workId: string): Promise<DashboardView>;
  deleteWork(workId: string, confirmation: string): Promise<DashboardView>;
  installIntegrations(): Promise<unknown>;
  onPanelShown(callback: () => void): () => void;
  closePanel(): Promise<void>;
}

declare global {
  interface Window {
    workpet: WorkPetApi;
  }
}
