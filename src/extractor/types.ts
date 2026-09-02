import type { SourceEvent, WorkState, WorkStatePatch } from "../core/types.js";

export interface WorkStateExtractionInput {
  previousState: WorkState | null;
  events: Array<Pick<SourceEvent, "externalId" | "kind" | "content" | "metadata"> & Partial<SourceEvent>>;
}

export interface WorkStateExtractor {
  extract(input: WorkStateExtractionInput): Promise<WorkStatePatch>;
}
