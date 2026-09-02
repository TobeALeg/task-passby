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
}

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

export interface SourceEvent {
  id: string;
  type:
    | "USER_MESSAGE"
    | "AGENT_MESSAGE"
    | "TOOL_CALL"
    | "TOOL_RESULT"
    | "REASONING_SUMMARY"
    | "ARTIFACT";
  messageId?: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  episodeId?: string;
}

export interface WorkSnapshot {
  definition: WorkDefinition;
  instance: WorkInstance;
  record: WorkRecord;
  episodes: ExecutionEpisode[];
  bindings: CaptureBinding[];
  activeEpisode: ExecutionEpisode;
  activeBinding: CaptureBinding;
  state: WorkState;
  sourceArchive: SourceEvent[];
  artifactRefs: ArtifactRef[];
}

export interface CreateWorkInput {
  definition: Pick<WorkDefinition, "key" | "name" | "version">;
  objective?: string;
  executor: Executor;
  environment: ExecutionEnvironment;
  source: Pick<CaptureBinding, "adapter" | "conversationId">;
}

export interface WorkCoreOptions {
  databasePath: string;
  now?: () => string;
  id?: () => string;
}

export interface WorkCore {
  createWork(input: CreateWorkInput): WorkSnapshot;
  close(): void;
}
