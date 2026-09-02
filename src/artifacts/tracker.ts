import type { SourceEventKind, WorkCore, WorkSnapshot } from "../core/index.js";
import { resolveArtifact, verifyArtifact } from "./resolver.js";

export interface ArtifactEvent {
  kind: SourceEventKind;
  content: string | null;
  metadata?: Record<string, unknown>;
}

export class ArtifactTracker {
  readonly #core: WorkCore;

  constructor(core: WorkCore) {
    this.#core = core;
  }

  async attach(work: WorkSnapshot, events: ArtifactEvent[]): Promise<WorkSnapshot> {
    const known = new Set(work.artifactRefs.map((artifact) => `${artifact.path}:${artifact.sha256}`));
    let current = work;
    for (const event of events) {
      if (event.kind !== "artifact.added" && event.kind !== "artifact.changed") continue;
      const path = typeof event.metadata?.path === "string" ? event.metadata.path : event.content;
      if (!path) continue;
      const artifact = await resolveArtifact(path, typeof event.metadata?.role === "string" ? event.metadata.role : "INPUT");
      if (known.has(`${artifact.path}:${artifact.sha256}`)) continue;
      current = this.#core.addArtifactRef(work.instance.id, artifact);
      known.add(`${artifact.path}:${artifact.sha256}`);
    }
    return current;
  }

  async verify(work: WorkSnapshot): Promise<WorkSnapshot> {
    const latestByPath = new Map<string, WorkSnapshot["artifactRefs"][number]>();
    for (const reference of work.artifactRefs) latestByPath.set(reference.path, reference);
    let current = work;
    for (const reference of latestByPath.values()) {
      const verified = await verifyArtifact(reference);
      if (
        verified.sha256 === reference.sha256
        && verified.availability === reference.availability
        && verified.lastModifiedAt === reference.lastModifiedAt
      ) continue;
      current = this.#core.addArtifactRef(work.instance.id, verified);
      const sequence = Math.max(0, ...current.sourceArchive.map((event) => event.sequence)) + 1;
      current = this.#core.appendSourceEvents(work.instance.id, [{
        externalId: `artifact:${reference.id}:${verified.availability}:${verified.sha256 || "missing"}`,
        sequence,
        kind: "artifact.changed",
        content: reference.path,
        timestamp: new Date().toISOString(),
        executorType: "TOOL",
        environmentType: current.activeEpisode?.environment.type ?? "WORKPET_LOCAL",
        metadata: {
          path: reference.path,
          role: reference.role,
          previousSha256: reference.sha256,
          currentSha256: verified.sha256,
          availability: verified.availability
        },
        artifactRefs: []
      }]).work;
    }
    return current;
  }
}
