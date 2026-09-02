export const WORK_STATE_FIELDS = [
  "objective",
  "successCriteria",
  "constraints",
  "facts",
  "decisions",
  "completedActions",
  "pendingActions",
  "artifacts",
] as const;

export type WorkStateField = (typeof WORK_STATE_FIELDS)[number];
export type WorkStatus = "OPEN" | "COMPLETED" | "ARCHIVED";
export type EpisodeStatus = "ACTIVE" | "ENDED";
export type BindingStatus = "ACTIVE" | "INACTIVE";
export type WorkStateOrigin =
  | "USER_STATED"
  | "AGENT_PROPOSED"
  | "SYSTEM_INFERRED"
  | "USER_EDITED";

export interface WorkStateItem {
  id: string;
  text: string;
  origin: WorkStateOrigin;
  sourceMessageIds: string[];
  editedAt?: string;
  originalText?: string;
}

export type ExtractedWorkStateItem = Omit<WorkStateItem, "origin" | "editedAt" | "originalText"> & {
  origin: Exclude<WorkStateOrigin, "USER_EDITED">;
};

export type WorkStatePatch = Partial<
  Record<WorkStateField, ExtractedWorkStateItem[]>
>;

export type WorkState = Record<WorkStateField, WorkStateItem[]>;

export interface Executor {
  type: "HUMAN" | "AGENT" | "TOOL" | "SAAS";
  name: string;
}

export interface ExecutionEnvironment {
  type: string;
  name: string;
}

export interface WorkDefinition {
  id: string;
  key: string;
  name: string;
  version: number;
}

export interface WorkInstance {
  id: string;
  definitionId: string;
  status: WorkStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorkRecord {
  id: string;
  workInstanceId: string;
}

export interface ExecutionEpisode {
  id: string;
  workInstanceId: string;
  executor: Executor;
  environment: ExecutionEnvironment;
  status: EpisodeStatus;
  startedAt: string;
  endedAt: string | null;
}

export interface CaptureBinding {
  id: string;
  workInstanceId: string;
  episodeId: string;
  adapter: string;
  conversationId: string;
  status: BindingStatus;
}

export interface ArtifactRef {
  id: string;
  workInstanceId: string;
  episodeId: string | null;
  path: string;
  role: string;
  filename: string;
  mimeType: string | null;
  size: number;
  sha256: string;
  lastModifiedAt: string;
  availability: "AVAILABLE" | "CHANGED" | "MISSING";
}

export type ArtifactRefInput = Omit<
  ArtifactRef,
  "id" | "workInstanceId" | "episodeId"
> & { episodeId?: string | null };

export type SourceEventKind =
  | "user.prompt"
  | "agent.response"
  | "tool.call"
  | "tool.result"
  | "reasoning.summary"
  | "artifact.added"
  | "artifact.changed";

export interface SourceEvent {
  id: string;
  workInstanceId: string;
  externalId: string;
  sequence: number;
  kind: SourceEventKind;
  content: string | null;
  timestamp: string;
  executorType: Executor["type"];
  environmentType: string;
  metadata: Record<string, unknown>;
  artifactRefs: string[];
  episodeId: string | null;
}

export type SourceEventInput = Omit<
  SourceEvent,
  "id" | "workInstanceId" | "episodeId"
> & { episodeId?: string };

export interface WorkSnapshot {
  definition: WorkDefinition;
  instance: WorkInstance;
  record: WorkRecord;
  episodes: ExecutionEpisode[];
  bindings: CaptureBinding[];
  activeEpisode: ExecutionEpisode | null;
  activeBinding: CaptureBinding | null;
  state: WorkState;
  sourceArchive: SourceEvent[];
  artifactRefs: ArtifactRef[];
  handoffPackages: HandoffPackage[];
}

export interface HandoffPackage {
  id: string;
  workInstanceId: string;
  workDefinition: { key: string; version: number };
  generatedAt: string;
  currentTask: string | null;
  nextStep: string | null;
  state: WorkState;
  neededArtifacts: ArtifactRef[];
  sourceArchiveSummary: {
    eventCount: number;
    artifactCount: number;
  };
}

export interface CreateWorkInput {
  definition: Pick<WorkDefinition, "key" | "name" | "version">;
  objective?: string;
  objectiveSourceMessageIds?: string[];
  executor: Executor;
  environment: ExecutionEnvironment;
  source: Pick<CaptureBinding, "adapter" | "conversationId">;
}

export interface ResumeWorkInput {
  executor: Executor;
  environment: ExecutionEnvironment;
  source: Pick<CaptureBinding, "adapter" | "conversationId">;
}

export interface StartExecutionEpisodeInput extends ResumeWorkInput {
  endCurrentEpisode?: boolean;
}

export interface WorkCoreOptions {
  databasePath: string;
  now?: () => string;
  id?: () => string;
}

export interface WorkCore {
  createWork(input: CreateWorkInput): WorkSnapshot;
  getWork(workInstanceId: string): WorkSnapshot | null;
  listWorks(status?: WorkStatus): WorkSnapshot[];
  findWorkByBinding(adapter: string, conversationId: string): WorkSnapshot | null;
  appendSourceEvents(
    workInstanceId: string,
    events: SourceEventInput[],
  ): { appendedCount: number; duplicateCount: number; work: WorkSnapshot };
  applyExtractorPatch(workInstanceId: string, patch: WorkStatePatch): WorkSnapshot;
  editWorkStateItem(
    workInstanceId: string,
    field: WorkStateField,
    itemId: string,
    text: string,
  ): WorkSnapshot;
  deleteWorkStateItem(
    workInstanceId: string,
    field: WorkStateField,
    itemId: string,
  ): WorkSnapshot;
  completeWork(workInstanceId: string): WorkSnapshot;
  archiveWork(workInstanceId: string): WorkSnapshot;
  stopCapture(workInstanceId: string): WorkSnapshot;
  resumeWork(workInstanceId: string, input: ResumeWorkInput): WorkSnapshot;
  startExecutionEpisode(
    workInstanceId: string,
    input: StartExecutionEpisodeInput,
  ): WorkSnapshot;
  bindConversation(
    workInstanceId: string,
    adapter: string,
    previousConversationId: string,
    conversationId: string,
  ): WorkSnapshot;
  createHandoffPackage(workInstanceId: string): HandoffPackage;
  getLatestHandoffPackage(workInstanceId: string): HandoffPackage | null;
  addArtifactRef(workInstanceId: string, artifact: ArtifactRefInput): WorkSnapshot;
  deleteWorkPermanently(
    workInstanceId: string,
    input: { confirmation: string },
  ): void;
  close(): void;
}
