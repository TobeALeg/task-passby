import { randomUUID } from "node:crypto";

import { ArtifactTracker } from "../artifacts/tracker.js";
import { CodexAppServerClient, type CodexThreadSummary } from "../adapters/codex/app-server-client.js";
import type { NormalizedSourceEvent, NormalizedThread } from "../adapters/types.js";
import { buildWorkBuddyBootstrap, buildWorkBuddyDeepLink } from "../adapters/workbuddy/deep-link.js";
import type { WorkBuddyLauncher } from "../adapters/workbuddy/launcher.js";
import {
  createWorkCore,
  type SourceEventInput,
  type WorkCore,
  type WorkSnapshot,
  type WorkStateField
} from "../core/index.js";
import { LocalRuleExtractor } from "../extractor/local-rule-extractor.js";
import { OpenAICompatibleExtractor } from "../extractor/openai-compatible-extractor.js";
import type { WorkStateExtractor } from "../extractor/types.js";
import type {
  CodexImportPreview,
  CodexSplitPointView,
  CreateWorkFromCodexMessageRequest,
  CreateWorkRequest,
  DashboardView,
  WorkDetailView,
  WorkSummaryView
} from "../ui-contract.js";

export interface AppServiceOptions {
  databasePath: string;
  codex?: CodexSource;
  launcher: WorkBuddyLauncher;
}

export interface CodexSource {
  listRecentThreads(limit?: number): Promise<CodexThreadSummary[]>;
  readThread(threadId: string): Promise<NormalizedThread>;
  close(): void;
}

export class AppService {
  readonly #core: WorkCore;
  readonly #codex: CodexSource;
  readonly #launcher: WorkBuddyLauncher;
  readonly #artifacts: ArtifactTracker;
  #selectedWorkId: string | null = null;
  #petState: DashboardView["petState"] = "sleeping";
  #notice: string | null = null;
  readonly #cloudConsent = new Set<string>();

  constructor(options: AppServiceOptions) {
    this.#core = createWorkCore({ databasePath: options.databasePath });
    this.#codex = options.codex ?? new CodexAppServerClient();
    this.#launcher = options.launcher;
    this.#artifacts = new ArtifactTracker(this.#core);
  }

  async listCodexThreads(): Promise<CodexThreadSummary[]> {
    return this.#codex.listRecentThreads(30);
  }

  async previewCodexThread(threadId: string): Promise<CodexImportPreview> {
    const thread = await this.#codex.readThread(threadId);
    const userPromptCount = thread.events.filter((event) => event.kind === "user.prompt").length;
    const agentResponseCount = thread.events.filter((event) => event.kind === "agent.response").length;
    const messageCount = userPromptCount + agentResponseCount;
    return {
      id: thread.threadId,
      title: thread.title,
      preview: thread.events.find((event) => event.kind === "user.prompt")?.content ?? "",
      cwd: thread.cwd,
      updatedAt: thread.updatedAt,
      status: "available",
      messageCount,
      userPromptCount,
      agentResponseCount,
      artifactCount: new Set(
        thread.events
          .filter((event) => event.kind === "artifact.added")
          .map((event) => typeof event.metadata?.path === "string" ? event.metadata.path : event.content)
          .filter((path): path is string => Boolean(path))
      ).size,
      toolEventCount: thread.events.filter((event) => event.kind === "tool.call" || event.kind === "tool.result").length
    };
  }

  async createWorkFromCodex(request: CreateWorkRequest): Promise<DashboardView> {
    const existing = this.#core.findWorkByBinding("codex", request.threadId);
    if (existing) {
      this.#selectedWorkId = existing.instance.id;
      this.#notice = "这个 Codex 任务已经属于一份 WorkRecord。";
      return this.dashboard(existing.instance.id);
    }
    this.#petState = "carrying";
    const thread = await this.#codex.readThread(request.threadId);
    let work = this.#core.createWork({
      definition: { key: "general-work", name: "通用工作", version: 1 },
      executor: { type: "AGENT", name: "Codex" },
      environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
      source: { adapter: "codex", conversationId: thread.threadId }
    });
    const inputs = this.#sourceInputs(thread.events);
    work = this.#core.appendSourceEvents(work.instance.id, inputs).work;
    work = await this.#artifacts.attach(work, thread.events);
    const extractor = this.#extractor(request.allowCloudExtraction);
    if (request.allowCloudExtraction) this.#cloudConsent.add(work.instance.id);
    const patch = await extractor.extract({ previousState: work.state, events: work.sourceArchive });
    work = this.#core.applyExtractorPatch(work.instance.id, patch);
    this.#selectedWorkId = work.instance.id;
    this.#petState = "awake";
    this.#notice = `已从第一轮开始归档 ${work.sourceArchive.length} 条可见记录。`;
    return this.dashboard(work.instance.id);
  }

  async listCodexSplitPoints(workId: string): Promise<CodexSplitPointView[]> {
    const work = this.#requireWork(workId);
    const codexBinding = [...work.bindings].reverse().find((binding) => binding.adapter === "codex");
    if (!codexBinding) throw new Error("没有可分割的 Codex 来源对话");
    const thread = await this.#codex.readThread(codexBinding.conversationId);
    return thread.events
      .filter((event) => event.kind === "user.prompt" && event.content.trim())
      .map((event) => ({
        externalId: event.externalId,
        label: event.content.replace(/\s+/gu, " ").slice(0, 100),
        timestamp: event.timestamp
      }))
      .reverse();
  }

  async createWorkFromCodexMessage(request: CreateWorkFromCodexMessageRequest): Promise<DashboardView> {
    const sourceWork = this.#requireWork(request.sourceWorkId);
    const codexBinding = [...sourceWork.bindings].reverse().find((binding) => binding.adapter === "codex");
    if (!codexBinding) throw new Error("没有可分割的 Codex 来源对话");
    if (sourceWork.activeBinding && sourceWork.activeBinding.adapter !== "codex") {
      throw new Error("当前工作正在其他执行环境中，请先完成或切回 Codex");
    }
    const thread = await this.#codex.readThread(codexBinding.conversationId);
    const startIndex = thread.events.findIndex(
      (event) => event.externalId === request.startExternalId && event.kind === "user.prompt"
    );
    if (startIndex === -1) throw new Error("未找到指定的用户消息");
    const selectedEvents = thread.events.slice(startIndex);
    const stoppedCapture = sourceWork.activeBinding?.adapter === "codex";
    if (stoppedCapture) this.#core.stopCapture(sourceWork.instance.id);
    let createdWorkId: string | null = null;

    try {
      let work = this.#core.createWork({
        definition: { key: "general-work", name: "通用工作", version: 1 },
        executor: { type: "AGENT", name: "Codex" },
        environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
        source: { adapter: "codex", conversationId: codexBinding.conversationId }
      });
      createdWorkId = work.instance.id;
      work = this.#core.appendSourceEvents(work.instance.id, this.#sourceInputs(selectedEvents)).work;
      work = await this.#artifacts.attach(work, selectedEvents);
      const allowCloud = this.#cloudConsent.has(sourceWork.instance.id);
      const patch = await this.#extractor(allowCloud).extract({ previousState: work.state, events: work.sourceArchive });
      work = this.#core.applyExtractorPatch(work.instance.id, patch);
      if (allowCloud) this.#cloudConsent.add(work.instance.id);
      this.#selectedWorkId = work.instance.id;
      this.#petState = "awake";
      this.#notice = `已从指定消息创建新的 WorkInstance，并归档后续 ${work.sourceArchive.length} 条记录。`;
      return this.dashboard(work.instance.id);
    } catch (error) {
      if (createdWorkId) this.#core.deleteWorkPermanently(createdWorkId, { confirmation: createdWorkId });
      if (stoppedCapture && sourceWork.activeEpisode && sourceWork.activeBinding) {
        this.#core.startExecutionEpisode(sourceWork.instance.id, {
          executor: sourceWork.activeEpisode.executor,
          environment: sourceWork.activeEpisode.environment,
          source: {
            adapter: sourceWork.activeBinding.adapter,
            conversationId: sourceWork.activeBinding.conversationId
          }
        });
      }
      throw error;
    }
  }

  async refreshWork(workId: string): Promise<DashboardView> {
    let current = this.#requireWork(workId);
    if (current.instance.status !== "OPEN") {
      this.#notice = "已完成或归档的工作不会自动写入；请先明确继续原工作。";
      return this.dashboard(workId);
    }
    current = await this.#artifacts.verify(current);
    const codexBinding = [...current.bindings].reverse().find((binding) => binding.adapter === "codex");
    if (!codexBinding || current.activeBinding?.adapter !== "codex") {
      this.#notice = "当前执行片段不在 Codex；WorkBuddy 的增量由插件 Hook 写回。";
      return this.dashboard(workId);
    }
    this.#petState = "carrying";
    const thread = await this.#codex.readThread(codexBinding.conversationId);
    let { work, newEvents } = await this.#ingestCodexDelta(current, thread);
    if (newEvents.length) {
      const patch = await this.#extractor(this.#cloudConsent.has(workId)).extract({ previousState: current.state, events: this.#sourceInputs(newEvents) });
      work = this.#core.applyExtractorPatch(workId, patch);
    }
    this.#petState = "awake";
    this.#notice = newEvents.length ? `新增 ${newEvents.length} 条记录。` : "没有发现新内容。";
    return this.dashboard(work.instance.id);
  }

  async syncCodexHook(payload: Record<string, unknown>): Promise<{ accepted: boolean; appendedCount: number }> {
    const threadId = typeof payload.session_id === "string" ? payload.session_id : null;
    if (!threadId) return { accepted: false, appendedCount: 0 };
    const current = this.#core.findWorkByBinding("codex", threadId);
    if (!current || current.instance.status !== "OPEN" || current.activeBinding?.adapter !== "codex") {
      return { accepted: false, appendedCount: 0 };
    }
    const thread = await this.#codex.readThread(threadId);
    const { work, newEvents } = await this.#ingestCodexDelta(current, thread);
    if (!newEvents.length) return { accepted: true, appendedCount: 0 };
    this.#notice = `Codex 已增量归档 ${newEvents.length} 条记录；Work State 将在查看、刷新或交接时更新。`;
    return { accepted: true, appendedCount: newEvents.length };
  }

  dashboard(workId?: string): DashboardView {
    if (workId) this.#selectedWorkId = workId;
    const works = this.#core.listWorks();
    if (this.#selectedWorkId && !works.some((work) => work.instance.id === this.#selectedWorkId)) {
      this.#selectedWorkId = works[0]?.instance.id ?? null;
    }
    const selected = this.#selectedWorkId ? this.#core.getWork(this.#selectedWorkId) : null;
    if (selected && this.#petState !== "carrying" && this.#petState !== "alert") {
      this.#petState = selected.instance.status === "OPEN" ? "awake" : "sleeping";
    }
    return {
      petState: this.#petState,
      selectedWorkId: this.#selectedWorkId,
      works: works.map((work) => this.#summary(work)),
      selectedWork: selected ? this.#detail(selected) : null,
      notice: this.#notice
    };
  }

  async dashboardWithVerification(workId?: string): Promise<DashboardView> {
    if (workId) this.#selectedWorkId = workId;
    if (this.#selectedWorkId) {
      const selected = this.#core.getWork(this.#selectedWorkId);
      if (selected?.artifactRefs.length) await this.#artifacts.verify(selected);
    }
    return this.dashboard();
  }

  editStateItem(workId: string, field: WorkStateField, itemId: string, text: string): DashboardView {
    this.#core.editWorkStateItem(workId, field, itemId, text);
    this.#notice = "人工修改已保护，后续提炼不会覆盖。";
    return this.dashboard(workId);
  }

  deleteStateItem(workId: string, field: WorkStateField, itemId: string): DashboardView {
    this.#core.deleteWorkStateItem(workId, field, itemId);
    this.#notice = "该条目已删除并留下 tombstone，不会被自动重新提取。";
    return this.dashboard(workId);
  }

  completeWork(workId: string): DashboardView {
    this.#core.completeWork(workId);
    this.#petState = "sleeping";
    this.#notice = "工作已完成，自动写入已停止。";
    return this.dashboard(workId);
  }

  archiveWork(workId: string): DashboardView {
    this.#core.archiveWork(workId);
    this.#petState = "sleeping";
    this.#notice = "工作已归档。";
    return this.dashboard(workId);
  }

  resumeWork(workId: string): DashboardView {
    const work = this.#requireWork(workId);
    const codex = [...work.bindings].reverse().find((binding) => binding.adapter === "codex");
    if (!codex) throw new Error("没有可继续的 Codex 来源对话");
    this.#core.resumeWork(workId, {
      executor: { type: "AGENT", name: "Codex" },
      environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
      source: { adapter: "codex", conversationId: codex.conversationId }
    });
    this.#petState = "awake";
    this.#notice = "已继续原 WorkInstance，并创建新的 Codex ExecutionEpisode。";
    return this.dashboard(workId);
  }

  async handoffToWorkBuddy(workId: string): Promise<DashboardView> {
    let current = await this.#artifacts.verify(this.#requireWork(workId));
    if (current.activeBinding?.adapter === "codex") await this.refreshWork(workId);
    current = this.#requireWork(workId);
    const sourceEpisode = current.activeEpisode;
    const sourceBinding = current.activeBinding;
    const handoff = this.#core.createHandoffPackage(workId);
    const pendingConversationId = `pending:${handoff.id}`;
    this.#core.startExecutionEpisode(workId, {
      executor: { type: "AGENT", name: "WorkBuddy" },
      environment: { type: "WORKBUDDY_DESKTOP", name: "WorkBuddy Desktop" },
      source: { adapter: "workbuddy", conversationId: pendingConversationId },
      endCurrentEpisode: true
    });
    let prompt = buildWorkBuddyBootstrap({
      workId,
      title: handoff.currentTask ?? "未命名工作",
      currentTask: handoff.currentTask ?? "",
      nextStep: handoff.nextStep ?? "",
      artifactPaths: handoff.neededArtifacts.filter((artifact) => artifact.availability !== "MISSING").map((artifact) => artifact.path)
    });
    if (process.env.WORKPET_QA_PROOF_TOKEN) {
      prompt += "\n\n本次为桌面闭环验收：请在成功调用 get_work_context 后，把返回字段 qaProofToken 的值原样放进可见回复；不要猜测该值。";
    }
    this.#petState = "carrying";
    let launchResult: "sent" | "draft";
    try {
      launchResult = await this.#launcher.openNewConversation(buildWorkBuddyDeepLink(prompt));
    } catch (error) {
      this.#core.stopCapture(workId);
      if (sourceEpisode && sourceBinding) {
        this.#core.startExecutionEpisode(workId, {
          executor: sourceEpisode.executor,
          environment: sourceEpisode.environment,
          source: { adapter: sourceBinding.adapter, conversationId: sourceBinding.conversationId },
          endCurrentEpisode: true
        });
      }
      this.#petState = "alert";
      this.#notice = sourceEpisode && sourceBinding
        ? `WorkBuddy 未能启动，已恢复原来源记录。${error instanceof Error ? ` ${error.message}` : ""}`
        : `WorkBuddy 未能启动，未保留虚假的执行片段。${error instanceof Error ? ` ${error.message}` : ""}`;
      return this.dashboard(workId);
    }
    this.#petState = "awake";
    this.#notice = launchResult === "sent"
      ? "已在 WorkBuddy 新建并发送接力任务；Hook 会绑定真实会话并继续记录。"
      : "已在 WorkBuddy 预填接力任务。首次使用请授予 WorkPet“辅助功能”权限，或手动按回车发送。";
    return this.dashboard(workId);
  }

  deleteWork(workId: string, confirmation: string): DashboardView {
    if (confirmation !== "永久删除") throw new Error("请输入“永久删除”进行二次确认");
    this.#core.deleteWorkPermanently(workId, { confirmation: workId });
    this.#cloudConsent.delete(workId);
    this.#selectedWorkId = null;
    this.#petState = "sleeping";
    this.#notice = "WorkPet 本地记录已永久删除；原文件和外部对话未改动。";
    return this.dashboard();
  }

  core(): WorkCore {
    return this.#core;
  }

  close(): void {
    this.#codex.close();
    this.#core.close();
  }

  #extractor(allowCloud: boolean): WorkStateExtractor {
    const key = process.env.WORKPET_LLM_API_KEY;
    if (allowCloud && key) {
      return new OpenAICompatibleExtractor({
        apiKey: key,
        baseUrl: process.env.WORKPET_LLM_BASE_URL ?? "https://api.openai.com/v1",
        model: process.env.WORKPET_LLM_MODEL ?? "gpt-5.4-mini"
      });
    }
    return new LocalRuleExtractor();
  }

  #sourceInputs(events: Array<NormalizedSourceEvent | SourceEventInput>): SourceEventInput[] {
    return events.map((event) => ({
      externalId: event.externalId,
      sequence: event.sequence,
      kind: event.kind,
      content: event.content,
      timestamp: event.timestamp,
      executorType: event.executorType,
      environmentType: event.environmentType,
      metadata: event.metadata ?? {},
      artifactRefs: "artifactRefs" in event ? event.artifactRefs : []
    }));
  }

  async #ingestCodexDelta(current: WorkSnapshot, thread: NormalizedThread): Promise<{ work: WorkSnapshot; newEvents: NormalizedSourceEvent[] }> {
    const known = new Set(current.sourceArchive.map((event) => event.externalId));
    const captureStart = thread.events.findIndex((event) => known.has(event.externalId));
    const captureScope = captureStart === -1 ? thread.events : thread.events.slice(captureStart);
    const newEvents = captureScope.filter((event) => !known.has(event.externalId));
    let work = this.#core.appendSourceEvents(current.instance.id, this.#sourceInputs(newEvents)).work;
    work = await this.#artifacts.attach(work, newEvents);
    return { work, newEvents };
  }

  #requireWork(workId: string): WorkSnapshot {
    const work = this.#core.getWork(workId);
    if (!work) throw new Error("WORK_NOT_FOUND");
    return work;
  }

  #summary(work: WorkSnapshot): WorkSummaryView {
    return {
      id: work.instance.id,
      title: work.state.objective[0]?.text ?? "未命名工作",
      status: work.instance.status,
      updatedAt: work.instance.updatedAt,
      eventCount: work.sourceArchive.length,
      artifactCount: work.artifactRefs.length,
      episodeCount: work.episodes.length
    };
  }

  #detail(work: WorkSnapshot): WorkDetailView {
    return {
      ...this.#summary(work),
      state: work.state,
      episodes: work.episodes.map((episode) => ({
        id: episode.id,
        executor: episode.executor.name,
        environment: episode.environment.name,
        status: episode.status,
        startedAt: episode.startedAt,
        endedAt: episode.endedAt
      })),
      bindings: work.bindings.map((binding) => ({
        id: binding.id,
        episodeId: binding.episodeId,
        adapter: binding.adapter,
        conversationId: binding.conversationId,
        status: binding.status
      }))
    };
  }
}
