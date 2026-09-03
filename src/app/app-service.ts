import { randomUUID } from "node:crypto";

import { ArtifactTracker } from "../artifacts/tracker.js";
import { CodexAppServerClient, type CodexThreadSummary } from "../adapters/codex/app-server-client.js";
import {
  MacForegroundApplicationDetector,
  classifyForegroundApplication,
  resolveCodexThreadFromRecentActivity,
  resolveCodexThreadFromWindowTitle,
  type CurrentApplicationContext,
  type ForegroundApplicationDetector
} from "../adapters/foreground/context.js";
import type { NormalizedSourceEvent, NormalizedThread } from "../adapters/types.js";
import { buildWorkBuddyBootstrap, buildWorkBuddyDeepLink } from "../adapters/workbuddy/deep-link.js";
import {
  createPendingWorkBuddyConversationId,
  isPendingWorkBuddyConversationId,
  matchesPendingWorkBuddyWindow
} from "../adapters/workbuddy/pending-capture.js";
import { WorkBuddyHookIngestor, type HookIngestResult } from "../adapters/workbuddy/hook-ingestor.js";
import type { WorkBuddyLauncher } from "../adapters/workbuddy/launcher.js";
import {
  createWorkCore,
  type SourceEvent,
  type SourceEventInput,
  type WorkCore,
  type WorkSnapshot
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
  PetView,
  WorkDetailView,
  WorkSummaryView
} from "../ui-contract.js";

export interface AppServiceOptions {
  databasePath: string;
  codex?: CodexSource;
  launcher: WorkBuddyLauncher;
  foreground?: ForegroundApplicationDetector;
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
  readonly #foreground: ForegroundApplicationDetector;
  readonly #artifacts: ArtifactTracker;
  readonly #workBuddyHooks: WorkBuddyHookIngestor;
  #selectedWorkId: string | null = null;
  #petState: DashboardView["petState"] = "sleeping";
  #notice: string | null = null;
  readonly #cloudExtractionWorkIds = new Set<string>();
  readonly #workBuddyWindowWorkIds = new Map<string, string>();

  constructor(options: AppServiceOptions) {
    this.#core = createWorkCore({ databasePath: options.databasePath });
    this.#codex = options.codex ?? new CodexAppServerClient();
    this.#launcher = options.launcher;
    this.#foreground = options.foreground ?? new MacForegroundApplicationDetector();
    this.#artifacts = new ArtifactTracker(this.#core);
    this.#workBuddyHooks = new WorkBuddyHookIngestor(this.#core);
  }

  async listCodexThreads(): Promise<CodexThreadSummary[]> {
    return this.#codex.listRecentThreads(30);
  }

  async captureForegroundContext(): Promise<CurrentApplicationContext | null> {
    return this.#resolveForegroundContext(true);
  }

  async getPetView(): Promise<PetView> {
    const context = await this.#resolveForegroundContext(false);
    if (!context?.windowTitle?.trim()) {
      return { petState: this.#petState, currentConversation: null };
    }
    const workId = this.#workIdForContext(context);
    return {
      petState: this.#petState,
      currentConversation: {
        adapter: context.adapter,
        applicationName: context.adapter === "codex" ? "Codex" : "WorkBuddy",
        title: context.windowTitle,
        workId
      }
    };
  }

  async #resolveForegroundContext(updateNotice: boolean): Promise<CurrentApplicationContext | null> {
    const application = await this.#foreground.detect();
    const context = application ? classifyForegroundApplication(application) : null;
    if (!context) {
      if (updateNotice) this.#notice = "未识别到受支持的前台应用。请先聚焦 Codex 或 WorkBuddy。";
      return null;
    }
    if (context.adapter === "codex") {
      const threads = await this.listCodexThreads();
      const thread = resolveCodexThreadFromWindowTitle(context.windowTitle, threads)
        ?? resolveCodexThreadFromRecentActivity(threads);
      if (!thread) {
        if (updateNotice) this.#notice = "已识别 Codex，但当前没有唯一的近期任务可安全绑定。请在目标聊天继续一次后重试。";
        return null;
      }
      if (updateNotice) this.#notice = `已识别当前 Codex 任务：${thread.title}`;
      return { ...context, windowTitle: thread.title, conversationId: thread.id };
    }
    if (updateNotice) this.#notice = "已识别 WorkBuddy。点击记录后，下一次在当前聊天提交消息时会自动确认会话身份。";
    return context;
  }

  async recordCurrentContext(): Promise<DashboardView> {
    const context = await this.captureForegroundContext();
    if (!context) return this.dashboard();
    const existingWorkId = this.#workIdForContext(context);
    if (existingWorkId) {
      this.#notice = "已打开当前对话对应的工作记录。";
      return this.dashboard(existingWorkId);
    }
    return this.createWorkFromCurrentContext(context);
  }

  async createWorkFromCurrentContext(context: CurrentApplicationContext): Promise<DashboardView> {
    if (context.adapter === "codex") {
      if (!context.conversationId) throw new Error("当前 Codex 聊天尚未确认，不能用最近任务代替。");
      const dashboard = await this.createWorkFromCodex({ threadId: context.conversationId });
      this.#notice = "已从当前 Codex 对话开始记录，并默认提炼 Work State。";
      return this.dashboard(dashboard.selectedWorkId ?? undefined);
    }
    if (!context.windowTitle?.trim()) {
      throw new Error("未取得当前 WorkBuddy 窗口标题。请在 macOS“隐私与安全性 → 辅助功能”中允许 WorkPet 后重试。");
    }
    for (const openWork of this.#core.listWorks("OPEN")) {
      const conversationId = openWork.activeBinding?.adapter === "workbuddy" ? openWork.activeBinding.conversationId : "";
      if (isPendingWorkBuddyConversationId(conversationId)) this.#core.stopCapture(openWork.instance.id);
    }
    const waitingConversationId = createPendingWorkBuddyConversationId(context.windowTitle);
    const work = this.#core.createWork({
      definition: { key: "general-work", name: "通用工作", version: 1 },
      executor: { type: "AGENT", name: "WorkBuddy" },
      environment: { type: "WORKBUDDY_DESKTOP", name: "WorkBuddy Desktop" },
      source: { adapter: "workbuddy", conversationId: waitingConversationId }
    });
    this.#selectedWorkId = work.instance.id;
    this.#workBuddyWindowWorkIds.set(this.#windowTitleKey(context.windowTitle), work.instance.id);
    if (this.#cloudExtractionIsEnabled()) this.#cloudExtractionWorkIds.add(work.instance.id);
    this.#petState = "awake";
    this.#notice = "已准备记录当前 WorkBuddy 聊天；请在该聊天提交下一条消息，WorkPet 会用真实 session ID 自动绑定并归档完整可见 transcript。";
    return this.dashboard(work.instance.id);
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
    const allowCloudExtraction = request.allowCloudExtraction ?? this.#cloudExtractionIsEnabled();
    const extractor = this.#extractor(allowCloudExtraction);
    if (allowCloudExtraction) this.#cloudExtractionWorkIds.add(work.instance.id);
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
      const allowCloud = this.#cloudExtractionEnabledFor(sourceWork.instance.id);
      const patch = await this.#extractor(allowCloud).extract({ previousState: work.state, events: work.sourceArchive });
      work = this.#core.applyExtractorPatch(work.instance.id, patch);
      if (allowCloud) this.#cloudExtractionWorkIds.add(work.instance.id);
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
      const patch = await this.#extractor(this.#cloudExtractionEnabledFor(workId)).extract({ previousState: current.state, events: this.#sourceInputs(newEvents) });
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

  async syncWorkBuddyHook(payload: Record<string, unknown>): Promise<HookIngestResult> {
    const knownEventIds = new Map(
      this.#core.listWorks().map((work) => [work.instance.id, new Set(work.sourceArchive.map((event) => event.externalId))])
    );
    const result = await this.#workBuddyHooks.ingest(payload);
    const windowTitle = typeof payload.workpet_window_title === "string" ? payload.workpet_window_title : null;
    if (result.workInstanceId && windowTitle?.trim()) {
      this.#workBuddyWindowWorkIds.set(this.#windowTitleKey(windowTitle), result.workInstanceId);
    }
    if (!result.accepted || !result.workInstanceId || !result.appendedCount) return result;
    const work = this.#core.getWork(result.workInstanceId);
    if (!work) return result;
    const known = knownEventIds.get(result.workInstanceId) ?? new Set<string>();
    const newEvents = work.sourceArchive.filter((event) => !known.has(event.externalId));
    if (!newEvents.length) return result;
    const patch = await this.#extractor(this.#cloudExtractionEnabledFor(result.workInstanceId)).extract({
      previousState: work.state,
      events: this.#sourceInputs(newEvents)
    });
    this.#core.applyExtractorPatch(result.workInstanceId, patch);
    return result;
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
    try {
      await this.#launcher.openNewConversation(buildWorkBuddyDeepLink(prompt));
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
    this.#notice = "已唤起 WorkBuddy 接力任务；正在等待 MCP/Hook 确认真实会话。";
    return this.dashboard(workId);
  }

  deleteWork(workId: string, confirmation: string): DashboardView {
    if (confirmation !== "永久删除") throw new Error("请输入“永久删除”进行二次确认");
    this.#core.deleteWorkPermanently(workId, { confirmation: workId });
    this.#cloudExtractionWorkIds.delete(workId);
    this.#selectedWorkId = null;
    this.#petState = "sleeping";
    this.#notice = "WorkPet 本地记录已永久删除；原文件和外部对话未改动。";
    for (const [windowTitle, mappedWorkId] of this.#workBuddyWindowWorkIds) {
      if (mappedWorkId === workId) this.#workBuddyWindowWorkIds.delete(windowTitle);
    }
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

  #cloudExtractionIsEnabled(): boolean {
    return process.env.WORKPET_CLOUD_EXTRACTION === "true";
  }

  #cloudExtractionEnabledFor(workId: string): boolean {
    return this.#cloudExtractionWorkIds.has(workId) || this.#cloudExtractionIsEnabled();
  }

  #workIdForContext(context: CurrentApplicationContext): string | null {
    if (context.adapter === "codex" && context.conversationId) {
      return this.#core.findWorkByBinding("codex", context.conversationId)?.instance.id ?? null;
    }
    if (context.adapter !== "workbuddy" || !context.windowTitle?.trim()) return null;
    const pending = this.#core.listWorks("OPEN").find((work) => {
      const conversationId = work.activeBinding?.adapter === "workbuddy" ? work.activeBinding.conversationId : "";
      return matchesPendingWorkBuddyWindow(conversationId, context.windowTitle);
    });
    if (pending) return pending.instance.id;
    const mapped = this.#workBuddyWindowWorkIds.get(this.#windowTitleKey(context.windowTitle));
    return mapped && this.#core.getWork(mapped) ? mapped : null;
  }

  #windowTitleKey(windowTitle: string): string {
    return windowTitle.trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-CN");
  }

  #sourceInputs(events: Array<NormalizedSourceEvent | SourceEventInput | SourceEvent>): SourceEventInput[] {
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
