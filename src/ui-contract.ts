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
export type PetState = "sleeping" | "awake" | "waiting" | "carrying" | "alert";
export type CaptureStatus = "recording" | "waiting" | "stopped";
export const CAPTURE_STATUS_LABELS = { recording: "正在记录", waiting: "等待发送消息", stopped: "已停止记录" } as const;
export const CAPTURE_WAITING_GUIDANCE = "尚未开始记录。请在对应的 WorkBuddy 聊天中发送一条消息，识别到该聊天后会自动开始记录。";

export interface StateItemView {
  id: string;
  text: string;
  origin: "USER_STATED" | "AGENT_PROPOSED" | "SYSTEM_INFERRED" | "USER_EDITED";
  sourceMessageIds: string[];
}

export type WorkStateView = Record<WorkStateField, StateItemView[]>;

export interface WorkSummaryView {
  id: string;
  agentName: string;
  title: string;
  status: WorkStatus;
  captureStatus: CaptureStatus;
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
    episodeId: string;
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

export interface CurrentConversationView {
  adapter: "codex" | "workbuddy";
  applicationName: "Codex" | "WorkBuddy";
  title: string;
  workId: string | null;
  workStatus: WorkStatus | null;
  isRecording: boolean;
  captureStatus?: CaptureStatus;
}

export interface PetView {
  petState: PetState;
  currentConversation: CurrentConversationView | null;
}

export interface CodexThreadView {
  id: string;
  agentName: string;
  title: string | null;
  preview: string;
  cwd: string;
  updatedAt: string;
  status: unknown;
  workId?: string;
}

export interface CodexThreadPage {
  threads: CodexThreadView[];
  nextCursor: string | null;
}

export interface CodexImportPreview extends CodexThreadView {
  messageCount: number;
  userPromptCount: number;
  agentResponseCount: number;
  artifactCount: number;
  toolEventCount: number;
}

export interface CreateWorkRequest {
  threadId: string;
  allowCloudExtraction?: boolean;
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
  recordCurrentContextFromPet(): Promise<DashboardView>;
  getPetView(): Promise<PetView>;
  togglePanelFromPet(): Promise<void>;
  setPetMousePassthrough(ignored: boolean): void;
  dragPet(phase: "start" | "move" | "end", cursor?: { x: number; y: number }): void;
  getDashboard(workId?: string): Promise<DashboardView>;
  listCodexThreads(): Promise<CodexThreadView[]>;
  listCodexHistory(cursor?: string): Promise<CodexThreadPage>;
  previewCodexThread(threadId: string): Promise<CodexImportPreview>;
  createWorkFromCodex(request: CreateWorkRequest): Promise<DashboardView>;
  listCodexSplitPoints(workId: string): Promise<CodexSplitPointView[]>;
  createWorkFromCodexMessage(request: CreateWorkFromCodexMessageRequest): Promise<DashboardView>;
  refreshWork(workId: string): Promise<DashboardView>;
  completeWork(workId: string): Promise<DashboardView>;
  archiveWork(workId: string): Promise<DashboardView>;
  resumeWork(workId: string): Promise<DashboardView>;
  handoffToWorkBuddy(workId: string): Promise<DashboardView>;
  deleteWork(workId: string, confirmation: string): Promise<DashboardView>;
  onPanelShown(callback: () => void): () => void;
  closePanel(): Promise<void>;
}

declare global {
  interface Window {
    workpet: WorkPetApi;
  }
}
