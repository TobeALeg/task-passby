export const WORK_STATE_LABELS = {
  objective: "目标",
  successCriteria: "完成标准",
  constraints: "约束",
  facts: "事实",
  decisions: "决定",
  completedActions: "已完成",
  pendingActions: "下一步",
  artifacts: "资料与产物",
} as const;

export type WorkStateField = keyof typeof WORK_STATE_LABELS;
export type WorkStatus = "OPEN" | "COMPLETED" | "ARCHIVED";
export type PetState = "sleeping" | "awake" | "waiting" | "carrying" | "alert";
export type CaptureStatus = "recording" | "waiting" | "stopped";
export const CAPTURE_STATUS_LABELS = {
  recording: "正在记录",
  waiting: "等待确认",
  stopped: "已停止记录",
} as const;
export const CAPTURE_WAITING_GUIDANCE =
  "目标执行者尚未确认接手，请检查对应应用中的交付状态。";

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
  reusableDefinitionId?: string;
  dispatchStatus?: string;
  dispatchReadAt?: string | null;
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

export interface ExecutorView {
  id: string;
  name: string;
  mark: string;
  available: boolean;
  canDeliver: boolean;
  error?: string;
}

export interface DashboardView {
  sourceSelection?: string;
  petState: PetState;
  selectedWorkId: string | null;
  works: WorkSummaryView[];
  selectedWork: WorkDetailView | null;
  notice: string | null;
}

export interface CurrentConversationView {
  adapter: string;
  applicationName: string;
  mark?: string;
  needsSelection?: boolean;
  title: string;
  workId: string | null;
  workStatus: WorkStatus | null;
  isRecording: boolean;
  captureStatus?: CaptureStatus;
}

export const RECORDING_UPLOAD_NOTICE = "参与改进开启时，点击记录会上传所选聊天已有及后续的用户消息和 AI 回复，供 Worket 管理员改进产品，保存 90 天。不额外读取附件、工具输出或推理摘要；可在“Worket 服务 → 改进数据”关闭或删除。";

export interface PetView {
  recordingUploadNoticeRequired?: boolean;
  petState: PetState;
  currentConversation: CurrentConversationView | null;
}

export interface ConversationView {
  executorId: string;
  id: string;
  agentName: string;
  title: string | null;
  preview: string;
  cwd: string;
  updatedAt: string;
  status: unknown;
  workId?: string;
}

export interface ConversationPageView {
  threads: ConversationView[];
  nextCursor: string | null;
}

export interface ConversationPreview extends ConversationView {
  messageCount: number;
  userPromptCount: number;
  agentResponseCount: number;
  artifactCount: number;
  toolEventCount: number;
}

export interface CreateWorkRequest {
  executorId: string;
  threadId: string;
  allowCloudExtraction?: boolean;
}

export interface SplitPointView {
  externalId: string;
  label: string;
  timestamp: string;
}

export interface CreateWorkFromMessageRequest {
  sourceWorkId: string;
  startExternalId: string;
}

export interface WorkPetApi {
  distillation(action: string, input?: unknown): Promise<any>;
  chooseDefinitionFile(): Promise<string | null>;
  exportWorkPackage(workId: string): Promise<string | null>;
  copyWorkPackage(workId: string): Promise<void>;
  configureWorketService(input: { url: string; token: string }): Promise<void>;
  getWorketServiceStatus(): Promise<{ url: string; automatic: boolean; hasCredential: boolean; expiresAt: string | null }>;
  recordCurrentContextFromPet(): Promise<DashboardView>;
  getPetView(): Promise<PetView>;
  togglePanelFromPet(): Promise<void>;
  setPetMousePassthrough(ignored: boolean): void;
  dragPet(
    phase: "start" | "move" | "end",
    cursor?: { x: number; y: number },
  ): void;
  getDashboard(workId?: string): Promise<DashboardView>;
  listExecutors(): Promise<ExecutorView[]>;
  listConversations(executorId: string): Promise<ConversationView[]>;
  listRecentConversations(): Promise<{
    threads: ConversationView[];
    errors: string[];
  }>;
  listConversationHistory(
    executorId: string,
    cursor?: string,
  ): Promise<ConversationPageView>;
  previewConversation(
    executorId: string,
    threadId: string,
  ): Promise<ConversationPreview>;
  createWorkFromConversation(
    request: CreateWorkRequest,
  ): Promise<DashboardView>;
  listSplitPoints(workId: string): Promise<SplitPointView[]>;
  createWorkFromMessage(
    request: CreateWorkFromMessageRequest,
  ): Promise<DashboardView>;
  consumeSourceSelection(): Promise<string | undefined>;
  refreshWork(workId: string): Promise<DashboardView>;
  completeWork(workId: string): Promise<DashboardView>;
  archiveWork(workId: string): Promise<DashboardView>;
  resumeWork(workId: string): Promise<DashboardView>;
  cancelHandoff(workId: string, confirmation: string): Promise<DashboardView>;
  handoff(workId: string, executorId: string): Promise<DashboardView>;
  cancelRecording(workId: string, confirmation: string): Promise<DashboardView>;
  onPanelShown(callback: () => void): () => void;
  closePanel(): Promise<void>;
}

declare global {
  interface Window {
    workpet: WorkPetApi;
  }
}
