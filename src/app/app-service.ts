import { basename, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { conversationProjectLabel } from "../executors/project-label.js";
import { createHash, randomUUID } from "node:crypto";
import { ArtifactTracker } from "../artifacts/tracker.js";
import {
  MacForegroundApplicationDetector,
  type CurrentApplicationContext,
  type ForegroundApplicationDetector,
} from "../adapters/foreground/context.js";
import type {
  NormalizedSourceEvent,
  NormalizedThread,
} from "../adapters/types.js";
import {
  createWorkCore,
  type SourceEvent,
  type SourceEventInput,
  type WorkCore,
  type WorkSnapshot,
} from "../core/index.js";
import { LocalRuleExtractor } from "../extractor/local-rule-extractor.js";
import { OpenAICompatibleExtractor } from "../extractor/openai-compatible-extractor.js";
import type { WorkStateExtractor } from "../extractor/types.js";
import { ExecutorRegistry, conversationPage } from "../executors/registry.js";
import type {
  ExecutorAdapter,
  ConversationSummary,
} from "../executors/types.js";
import { buildWorkPackage } from "../definitions/work-package.js";
import type {
  ConversationPreview,
  ConversationPageView,
  ConversationView,
  SplitPointView,
  CreateWorkFromMessageRequest,
  CreateWorkRequest,
  DashboardView,
  PetView,
  WorkDetailView,
  WorkSummaryView,
  CaptureStatus,
  ExecutorView,
} from "../ui-contract.js";

function artifactFile(text: string) {
  const path = text.trim();
  if (!isAbsolute(path) || /[\r\n\0]/.test(path)) return undefined;
  return { name: basename(path), path, url: pathToFileURL(path).href };
}

function captureStatus(work: WorkSnapshot): CaptureStatus {
  const binding = work.activeBinding;
  if (work.instance.status !== "OPEN" || !binding) return "stopped";
  if (binding.conversationId.startsWith("pending:")) return "waiting";
  if (binding.conversationId.startsWith("waiting:"))
    return Number(binding.conversationId.split(":")[1]) > Date.now()
      ? "waiting"
      : "stopped";
  if (
    work.definition.kind === "REUSABLE" &&
    !work.packageReadAt &&
    !work.sourceArchive.some(
      (event) =>
        event.kind === "tool.result" &&
        event.metadata.toolName === "get_work_context",
    )
  )
    return "waiting";
  return "recording";
}
export interface AppServiceOptions {
  databasePath: string;
  executors: ExecutorAdapter[];
  foreground?: ForegroundApplicationDetector;
  onRecordingStarted?: (workId: string) => void;
  onRecordingStopped?: (workId: string) => void;
}
export class AppService {
  readonly #core: WorkCore;
  readonly #executors: ExecutorRegistry;
  readonly #foreground: ForegroundApplicationDetector;
  readonly #artifacts: ArtifactTracker;
  #selectedWorkId: string | null = null;
  #petState: DashboardView["petState"] = "sleeping";
  #notice: string | null = null;
  #sourceSelection: string | undefined;
  readonly #cloudExtractionWorkIds = new Set<string>();
  readonly #handoffs = new Set<string>();
  constructor(readonly options: AppServiceOptions) {
    this.#core = createWorkCore({ databasePath: options.databasePath });
    this.#executors = new ExecutorRegistry(options.executors);
    this.#foreground =
      options.foreground ??
      new MacForegroundApplicationDetector(
        undefined,
        options.executors.flatMap((adapter) => [...adapter.bundleIds]),
      );
    this.#artifacts = new ArtifactTracker(this.#core);
  }
  async listExecutors(): Promise<ExecutorView[]> {
    return Promise.all(
      this.#executors.all().map(async (adapter) => {
        try {
          await adapter.inspect();
          return {
            id: adapter.id,
            name: adapter.name,
            mark: adapter.mark,
            available: true,
            canDeliver: !!adapter.deliver,
          };
        } catch (error) {
          return {
            id: adapter.id,
            name: adapter.name,
            mark: adapter.mark,
            available: false,
            canDeliver: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
  }
  async listConversations(executorId: string): Promise<ConversationView[]> {
    return (await this.listConversationHistory(executorId)).threads;
  }
  async listRecentConversations(): Promise<{
    threads: ConversationView[];
    errors: string[];
  }> {
    const results = await Promise.allSettled(
      this.#executors
        .all()
        .map((adapter) => this.listConversations(adapter.id)),
    );
    return {
      threads: results
        .flatMap((result) =>
          result.status === "fulfilled" ? result.value : [],
        )
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
      errors: results.flatMap((result) =>
        result.status === "rejected" ? [String(result.reason)] : [],
      ),
    };
  }
  async listConversationHistory(
    executorId: string,
    cursor?: string,
  ): Promise<ConversationPageView> {
    const adapter = this.#executors.get(executorId);
    const page = await conversationPage(adapter, cursor);
    return {
      ...page,
      threads: page.threads.map((thread) =>
        this.#recordingSource(adapter, thread),
      ),
    };
  }
  #recordingSource(
    adapter: ExecutorAdapter,
    thread: ConversationSummary,
  ): ConversationView {
    const work = this.#core.findWorkByBinding(adapter.id, thread.id);
    return {
      ...thread,
      executorId: adapter.id,
      agentName: adapter.name,
      projectLabel: conversationProjectLabel(adapter.id, thread.cwd),
      ...(work ? { workId: work.instance.id } : {}),
    };
  }
  async #resolveForegroundContext(): Promise<CurrentApplicationContext | null> {
    const application = await this.#foreground.detect();
    const adapter = application
      ? this.#executors.forApplication(application.bundleId)
      : null;
    if (!application || !adapter) return null;
    const thread = await adapter.resolveCurrent(application).catch(() => null);
    return {
      adapter: adapter.id,
      environmentName: adapter.environment.name,
      applicationName: adapter.name,
      windowTitle: application.windowTitle,
      ...(thread
        ? {
            conversationId: thread.id,
            ...(thread.title ? { applicationTitle: thread.title } : {}),
          }
        : {}),
    };
  }
  async captureForegroundContext(): Promise<CurrentApplicationContext | null> {
    const context = await this.#resolveForegroundContext();
    this.#notice = context
      ? context.conversationId
        ? `已识别当前 ${context.applicationName} 任务：${context.applicationTitle ?? "未命名工作"}`
        : `请选择要记录的 ${context.applicationName} 聊天。`
      : "未识别到已接入的前台应用。";
    return context;
  }
  async getPetView(): Promise<PetView> {
    const context = await this.#resolveForegroundContext();
    const petState = this.#globalPetState();
    if (!context) return { petState, currentConversation: null };
    const adapter = this.#executors.get(context.adapter);
    const work = context.conversationId
      ? this.#core.findWorkByBinding(adapter.id, context.conversationId)
      : null;
    return {
      petState,
      currentConversation: {
        adapter: adapter.id,
        applicationName: adapter.name,
        mark: adapter.mark,
        title: context.applicationTitle ?? `选择 ${adapter.name} 聊天`,
        needsSelection: !context.conversationId,
        workId: work?.instance.id ?? null,
        workStatus: work?.instance.status ?? null,
        isRecording: work ? captureStatus(work) === "recording" : false,
        ...(work ? { captureStatus: captureStatus(work) } : {}),
      },
    };
  }
  async recordCurrentContext(): Promise<DashboardView> {
    const context = await this.captureForegroundContext();
    if (!context) return this.dashboard();
    return this.createWorkFromCurrentContext(context);
  }
  async createWorkFromCurrentContext(
    context: CurrentApplicationContext,
  ): Promise<DashboardView> {
    if (!context.conversationId) {
      this.#sourceSelection = context.adapter;
      return this.dashboard();
    }
    return this.createWorkFromConversation({
      executorId: context.adapter,
      threadId: context.conversationId,
    });
  }
  consumeSourceSelection(): string | undefined {
    const id = this.#sourceSelection;
    this.#sourceSelection = undefined;
    return id;
  }
  async previewConversation(
    executorId: string,
    threadId: string,
  ): Promise<ConversationPreview> {
    const adapter = this.#executors.get(executorId),
      thread = await adapter.source.readThread(threadId);
    const userPromptCount = thread.events.filter(
      (e) => e.kind === "user.prompt",
    ).length;
    const agentResponseCount = thread.events.filter(
      (e) => e.kind === "agent.response",
    ).length;
    return {
      id: threadId,
      executorId,
      agentName: adapter.name,
      title: thread.title,
      preview: "",
      cwd: thread.cwd,
      updatedAt: thread.updatedAt,
      status: "available",
      messageCount: userPromptCount + agentResponseCount,
      userPromptCount,
      agentResponseCount,
      artifactCount: new Set(
        thread.events
          .filter((e) => e.kind === "artifact.added")
          .map((e) => e.content),
      ).size,
      toolEventCount: thread.events.filter(
        (e) => e.kind === "tool.call" || e.kind === "tool.result",
      ).length,
    };
  }
  async createWorkFromConversation(
    request: CreateWorkRequest,
  ): Promise<DashboardView> {
    const adapter = this.#executors.get(request.executorId);
    let existing = this.#core.findWorkByBinding(adapter.id, request.threadId);
    if (existing) {
      this.#notice = "这个聊天已经属于一份 WorkRecord。";
      return this.dashboard(existing.instance.id);
    }
    const thread = await adapter.source.readThread(request.threadId);
    if (thread.threadId !== request.threadId)
      throw new Error("来源会话身份不一致，未开始记录。");
    existing = this.#core.findWorkByBinding(adapter.id, request.threadId);
    if (existing) return this.dashboard(existing.instance.id);
    const title = thread.applicationTitle?.trim();
    let work = this.#core.createWork({
      definition: { key: "general-work", name: "通用工作", version: 1 },
      executor: { type: "AGENT", name: adapter.name },
      environment: adapter.environment,
      source: { adapter: adapter.id, conversationId: thread.threadId },
    });
    const titleEvent = title
      ? this.#titleEvent(adapter.id, thread.threadId, title, thread.updatedAt)
      : null;
    work = this.#core.appendSourceEvents(work.instance.id, [
      ...(titleEvent ? [titleEvent] : []),
      ...this.#sourceInputs(thread.events),
    ]).work;
    if (titleEvent) work = this.#applyObjective(work, titleEvent);
    work = await this.#artifacts.attach(work, thread.events);
    const allowCloud =
      request.allowCloudExtraction ?? this.#cloudExtractionIsEnabled();
    if (allowCloud) this.#cloudExtractionWorkIds.add(work.instance.id);
    const patch = await this.#extractor(allowCloud).extract({
      previousState: work.state,
      events: work.sourceArchive,
    });
    if (titleEvent) patch.objective = [];
    if (
      this.#core.getWork(work.instance.id)?.activeBinding?.id ===
      work.activeBinding?.id
    )
      this.#core.applyExtractorPatch(work.instance.id, patch);
    this.options.onRecordingStarted?.(work.instance.id);
    this.#notice = `已记录 ${adapter.name} 聊天，导入 ${work.sourceArchive.length} 条可见事件。`;
    return this.dashboard(work.instance.id);
  }
  async listSplitPoints(workId: string): Promise<SplitPointView[]> {
    const work = this.#requireWork(workId);
    // Archived evidence is enough to choose a split point; no need to contact the old application.
    const binding = work.activeBinding ?? work.bindings.at(-1);
    if (!binding) throw new Error("没有可分割的来源对话");
    return work.sourceArchive
      .filter(
        (event) =>
          event.episodeId === binding.episodeId &&
          event.kind === "user.prompt" &&
          event.content?.trim(),
      )
      .map((event) => ({
        externalId: event.externalId,
        label: event.content!.replace(/\s+/gu, " ").slice(0, 100),
        timestamp: event.timestamp,
      }))
      .reverse();
  }
  async createWorkFromMessage(
    request: CreateWorkFromMessageRequest,
  ): Promise<DashboardView> {
    const sourceWork = this.#requireWork(request.sourceWorkId);
    const binding = sourceWork.activeBinding ?? sourceWork.bindings.at(-1);
    if (!binding) throw new Error("没有可分割的来源对话");
    const adapter = this.#executors.get(binding.adapter),
      thread = await adapter.source.readThread(binding.conversationId);
    const start = thread.events.findIndex(
      (event) =>
        event.externalId === request.startExternalId &&
        event.kind === "user.prompt",
    );
    if (start < 0) throw new Error("未找到指定的用户消息");
    if (
      this.#requireWork(request.sourceWorkId).activeBinding?.id !==
      sourceWork.activeBinding?.id
    )
      throw new Error("记录来源已改变，请重新选择");
    const events = thread.events.slice(start);
    if (sourceWork.activeBinding)
      this.#core.stopCapture(sourceWork.instance.id);
    let createdId: string | undefined;
    try {
      let work = this.#core.createWork({
        definition: { key: "general-work", name: "通用工作", version: 1 },
        executor: { type: "AGENT", name: adapter.name },
        environment: adapter.environment,
        source: { adapter: adapter.id, conversationId: binding.conversationId },
      });
      createdId = work.instance.id;
      work = this.#core.appendSourceEvents(
        work.instance.id,
        this.#sourceInputs(events),
      ).work;
      work = await this.#artifacts.attach(work, events);
      const allowCloud = this.#cloudExtractionEnabledFor(
        sourceWork.instance.id,
      );
      const patch = await this.#extractor(allowCloud).extract({
        previousState: work.state,
        events: work.sourceArchive,
      });
      this.#core.applyExtractorPatch(work.instance.id, patch);
      if (allowCloud) this.#cloudExtractionWorkIds.add(work.instance.id);
      this.options.onRecordingStopped?.(sourceWork.instance.id);
      this.options.onRecordingStarted?.(work.instance.id);
      this.#notice = "已从指定消息创建新的工作记录。";
      return this.dashboard(work.instance.id);
    } catch (error) {
      if (createdId)
        this.#core.deleteWorkPermanently(createdId, {
          confirmation: createdId,
        });
      this.#restoreBinding(sourceWork);
      throw error;
    }
  }
  async #readBoundWork(workId: string): Promise<{
    work: WorkSnapshot;
    newEvents: NormalizedSourceEvent[];
  } | null> {
    const current = this.#requireWork(workId),
      binding = current.activeBinding;
    if (
      current.instance.status !== "OPEN" ||
      !binding ||
      /^(pending|waiting):/.test(binding.conversationId)
    )
      return null;
    const thread = await this.#executors
      .get(binding.adapter)
      .source.readThread(binding.conversationId);
    const latest = this.#core.getWork(workId);
    if (
      !latest ||
      latest.instance.status !== "OPEN" ||
      latest.activeBinding?.id !== binding.id
    )
      return null;
    if (thread.threadId !== binding.conversationId)
      throw new Error("来源会话身份不一致，已拒绝同步");
    const adapter = this.#executors.get(binding.adapter);
    return this.#ingestDelta(
      latest,
      adapter.reconcileHistory?.(thread, latest.sourceArchive) ?? thread,
    );
  }
  async refreshWork(workId: string): Promise<DashboardView> {
    await this.#artifacts.verify(this.#requireWork(workId));
    const result = await this.#readBoundWork(workId);
    if (!result) {
      this.#notice = "当前没有可同步的活动来源。";
      return this.dashboard(workId);
    }
    const { work, newEvents } = result;
    if (newEvents.length) {
      const patch = await this.#extractor(
        this.#cloudExtractionEnabledFor(workId),
      ).extract({
        previousState: work.state,
        events: this.#sourceInputs(newEvents),
      });
      const current = this.#core.getWork(workId);
      if (
        current?.instance.status === "OPEN" &&
        current.activeBinding?.id === work.activeBinding?.id
      )
        this.#core.applyExtractorPatch(workId, patch);
    }
    this.#notice = newEvents.length
      ? `新增 ${newEvents.length} 条记录。`
      : "没有发现新内容。";
    return this.dashboard(workId);
  }
  async syncHook(
    executorId: string,
    payload: Record<string, unknown>,
  ): Promise<{
    accepted: boolean;
    appendedCount: number;
    workInstanceId?: string;
  }> {
    this.#executors.get(executorId);
    const id =
      typeof payload.session_id === "string" ? payload.session_id : null;
    if (!id) return { accepted: false, appendedCount: 0 };
    let work = this.#core.findWorkByBinding(executorId, id);
    if (
      !work &&
      payload.hook_event_name === "UserPromptSubmit" &&
      typeof payload.prompt === "string"
    ) {
      const marker = payload.prompt.match(/\[WORKPET:([a-zA-Z0-9-]+)\]/u)?.[1];
      const deliveryId = payload.prompt.match(
        /\[DELIVERY:([a-zA-Z0-9-]+)\]/u,
      )?.[1];
      const candidate = marker ? this.#core.getWork(marker) : null;
      const binding = candidate?.activeBinding;
      if (
        candidate?.instance.status === "OPEN" &&
        binding?.adapter === executorId &&
        binding.conversationId === `pending:${deliveryId}`
      ) {
        work = this.#core.bindConversation(
          candidate.instance.id,
          executorId,
          binding.conversationId,
          id,
        );
        this.#core.definitions.db
          .prepare(
            "UPDATE pending_dispatches SET status='BOUND' WHERE work_id=?",
          )
          .run(work.instance.id);
      }
    }
    if (
      !work ||
      work.instance.status !== "OPEN" ||
      work.activeBinding?.adapter !== executorId ||
      work.activeBinding.conversationId !== id
    )
      return { accepted: false, appendedCount: 0 };
    const result = await this.#readBoundWork(work.instance.id);
    return {
      accepted: !!result,
      appendedCount: result?.newEvents.length ?? 0,
      workInstanceId: work.instance.id,
    };
  }
  async syncRecordedWorks(): Promise<void> {
    const works = this.#core
      .listWorks("OPEN")
      .filter(
        (work) =>
          work.activeBinding &&
          !/^(pending|waiting):/.test(work.activeBinding.conversationId),
      );
    await Promise.all(
      works.map(async (work) => {
        try {
          await this.#readBoundWork(work.instance.id);
        } catch (error) {
          this.#notice = `部分记录暂未同步，将自动重试：${String(error)}`;
        }
      }),
    );
  }
  artifactPath(workId: string, itemId: string): string {
    const item = this.#requireWork(workId).state.artifacts.find((item) => item.id === itemId);
    const file = item && artifactFile(item.text);
    if (!file) throw new Error("找不到这份资料");
    return file.path;
  }

  dashboard(workId?: string): DashboardView {
    if (workId) this.#selectedWorkId = workId;
    const works = this.#core.listWorks();
    if (
      this.#selectedWorkId &&
      !works.some((work) => work.instance.id === this.#selectedWorkId)
    )
      this.#selectedWorkId = works[0]?.instance.id ?? null;
    const selected = this.#selectedWorkId
      ? this.#core.getWork(this.#selectedWorkId)
      : null;
    return {
      petState: this.#globalPetState(),
      selectedWorkId: this.#selectedWorkId,
      works: works.map((work) => this.#summary(work)),
      selectedWork: selected ? this.#detail(selected) : null,
      notice: this.#notice,
      ...(this.#sourceSelection
        ? { sourceSelection: this.#sourceSelection }
        : {}),
    };
  }
  async dashboardWithVerification(workId?: string): Promise<DashboardView> {
    if (workId) this.#selectedWorkId = workId;
    const context = await this.#resolveForegroundContext().catch(() => null);
    if (context?.conversationId && context.applicationTitle) {
      const work = this.#core.findWorkByBinding(
        context.adapter,
        context.conversationId,
      );
      if (work)
        this.#synchronizeObjective(
          work.instance.id,
          context.adapter,
          context.conversationId,
          context.applicationTitle,
        );
    }
    if (this.#selectedWorkId) {
      const selected = this.#core.getWork(this.#selectedWorkId);
      if (selected?.artifactRefs.length) await this.#artifacts.verify(selected);
    }
    return this.dashboard();
  }
  completeWork(workId: string): DashboardView {
    this.#core.completeWork(workId);
    this.options.onRecordingStopped?.(workId);
    this.#notice = "工作已完成，自动写入已停止。";
    return this.dashboard(workId);
  }
  archiveWork(workId: string): DashboardView {
    this.#core.archiveWork(workId);
    this.options.onRecordingStopped?.(workId);
    this.#notice = "工作已归档。";
    return this.dashboard(workId);
  }
  resumeWork(workId: string): DashboardView {
    const work = this.#requireWork(workId),
      binding = work.bindings.findLast(
        (binding) => !/^(pending|waiting):/.test(binding.conversationId),
      );
    if (!binding || /^(pending|waiting):/.test(binding.conversationId))
      throw new Error("没有已确认的来源，请选择执行者交接。");
    const adapter = this.#executors.get(binding.adapter);
    this.#core.resumeWork(workId, {
      executor: { type: "AGENT", name: adapter.name },
      environment: adapter.environment,
      source: { adapter: adapter.id, conversationId: binding.conversationId },
    });
    this.options.onRecordingStarted?.(workId);
    this.#notice = "已继续原工作，并恢复原执行者的记录。";
    return this.dashboard(workId);
  }
  async handoff(workId: string, executorId: string): Promise<DashboardView> {
    if (this.#handoffs.has(workId))
      throw new Error("这项工作正在交接，请等待本次结果。");
    const adapter = this.#executors.get(executorId);
    if (!adapter.deliver) throw new Error("该执行者尚不支持接收工作。");
    const initial = this.#requireWork(workId);
    if (initial.instance.status !== "OPEN") throw new Error("请先继续原工作。");
    if (initial.activeBinding?.conversationId.startsWith("pending:"))
      throw new Error("上次交付尚未确认，请先检查目标执行者。");
    this.#handoffs.add(workId);
    try {
      await adapter.inspect();
      if (initial.activeBinding && captureStatus(initial) === "recording")
        await this.refreshWork(workId);
      let current = await this.#artifacts.verify(this.#requireWork(workId));
      if (
        current.instance.status !== "OPEN" ||
        current.activeBinding?.id !== initial.activeBinding?.id
      )
        throw new Error("工作状态已改变，未进行交接。");
      const handoff = this.#core.createHandoffPackage(workId);
      const pkg = buildWorkPackage(current, this.#core.definitions);
      const pending = `pending:${handoff.id}`;
      this.#core.startExecutionEpisode(workId, {
        executor: { type: "AGENT", name: adapter.name },
        environment: adapter.environment,
        source: { adapter: adapter.id, conversationId: pending },
        endCurrentEpisode: true,
      });
      try {
        const prompt = `[WORKPET:${workId}]\n[DELIVERY:${handoff.id}]\n${pkg.purpose === "START" ? "请开展这项新工作" : "请接手同一项工作"}。以下是用户交付的工作包和当前状态，请按要求继续，完成后等待用户验收。\n${JSON.stringify({ workPackage: pkg, handoff })}`;
        const receipt = await adapter.deliver({
          workId,
          deliveryId: handoff.id,
          purpose: pkg.purpose,
          title: handoff.currentTask ?? current.definition.name,
          prompt,
        });
        const latest = this.#requireWork(workId);
        if (
          receipt.conversationId &&
          latest.activeBinding?.conversationId === pending
        )
          this.#core.bindConversation(
            workId,
            executorId,
            pending,
            receipt.conversationId,
          );
        this.#notice = receipt.conversationId
          ? `已交给 ${adapter.name}，后续继续记录在同一项工作中。`
          : `已打开 ${adapter.name}，等待确认目标会话。${receipt.guidance ?? ""}`;
      } catch (error) {
        this.#core.stopCapture(workId);
        this.#restoreBinding(current);
        this.#notice = `${adapter.name} 未能启动，${current.activeBinding ? "已恢复原来源记录" : "未保留活动的待确认绑定"}。${String(error)}`;
        throw error;
      }
      return this.dashboard(workId);
    } finally {
      this.#handoffs.delete(workId);
    }
  }
  cancelHandoff(workId: string, confirmation: string): DashboardView {
    if (confirmation !== "已确认未接手")
      throw new Error("请先确认目标执行者尚未接手。");
    if (this.#handoffs.has(workId))
      throw new Error("交接仍在打开目标应用，请稍后重试。");
    const work = this.#requireWork(workId);
    const legacyPending =
      !work.activeBinding &&
      this.#core.definitions.db
        .prepare(
          "SELECT work_id FROM pending_dispatches WHERE work_id=? AND status IN ('STARTING','WAITING')",
        )
        .get(workId);
    if (
      !work.activeBinding?.conversationId.startsWith("pending:") &&
      !legacyPending
    )
      throw new Error("交接已确认或已取消，请刷新记录。");
    this.#core.stopCapture(workId);
    const previous = work.bindings.findLast(
      (binding) => !/^(pending|waiting):/.test(binding.conversationId),
    );
    const episode = work.episodes.find(
      (episode) => episode.id === previous?.episodeId,
    );
    if (previous && episode && work.instance.status === "OPEN")
      this.#core.startExecutionEpisode(workId, {
        executor: episode.executor,
        environment: episode.environment,
        source: {
          adapter: previous.adapter,
          conversationId: previous.conversationId,
        },
        endCurrentEpisode: true,
      });
    this.#core.definitions.db
      .prepare(
        "UPDATE pending_dispatches SET status='FAILED',read_at=NULL WHERE work_id=?",
      )
      .run(workId);
    this.#notice =
      "已取消未确认的交接。原来源存在时已恢复记录；目标应用中的草稿请自行关闭。";
    return this.dashboard(workId);
  }
  #restoreBinding(work: WorkSnapshot): void {
    if (work.activeBinding && work.activeEpisode)
      this.#core.startExecutionEpisode(work.instance.id, {
        executor: work.activeEpisode.executor,
        environment: work.activeEpisode.environment,
        source: {
          adapter: work.activeBinding.adapter,
          conversationId: work.activeBinding.conversationId,
          ...(work.activeBinding.sourceLocator
            ? { sourceLocator: work.activeBinding.sourceLocator }
            : {}),
        },
        endCurrentEpisode: true,
      });
  }
  cancelRecording(workId: string, confirmation: string): DashboardView {
    if (confirmation !== "取消记录")
      throw new Error("请输入“取消记录”进行二次确认");
    this.#core.deleteWorkPermanently(workId, { confirmation: workId });
    this.options.onRecordingStopped?.(workId);
    this.#cloudExtractionWorkIds.delete(workId);
    this.#selectedWorkId = null;
    this.#petState = "sleeping";
    this.#notice = "已取消记录，后续不再同步；Worket 本地副本已清除，原对话和原文件保持不变。";
    return this.dashboard();
  }

  core(): WorkCore {
    return this.#core;
  }

  close(): void {
    this.#executors.close();
    this.#core.close();
  }

  #extractor(allowCloud: boolean): WorkStateExtractor {
    const key = process.env.WORKPET_LLM_API_KEY;
    if (allowCloud && key) {
      return new OpenAICompatibleExtractor({
        apiKey: key,
        baseUrl:
          process.env.WORKPET_LLM_BASE_URL ?? "https://api.openai.com/v1",
        model: process.env.WORKPET_LLM_MODEL ?? "gpt-5.4-mini",
      });
    }
    return new LocalRuleExtractor();
  }

  #cloudExtractionIsEnabled(): boolean {
    return process.env.WORKPET_CLOUD_EXTRACTION === "true";
  }

  #cloudExtractionEnabledFor(workId: string): boolean {
    return (
      this.#cloudExtractionWorkIds.has(workId) ||
      this.#cloudExtractionIsEnabled()
    );
  }

  #synchronizeObjective(
    workId: string,
    executorId: string,
    threadId: string,
    applicationTitle: string,
  ): void {
    let work = this.#requireWork(workId);
    if (
      work.definition.kind === "REUSABLE" ||
      work.episodes[0]?.id !== work.activeEpisode?.id
    )
      return;
    const existingTitleEvent = work.sourceArchive.findLast(
      (event) => event.kind === "conversation.title",
    );
    const firstPromptSequence = work.sourceArchive
      .filter((event) => event.kind === "user.prompt")
      .reduce<number | null>(
        (first, event) =>
          first === null ? event.sequence : Math.min(first, event.sequence),
        null,
      );
    if (!existingTitleEvent && firstPromptSequence !== 1) return;
    const titleEvent = this.#titleEvent(
      executorId,
      threadId,
      applicationTitle,
      new Date().toISOString(),
    );
    if (
      work.sourceArchive.some(
        (event) => event.externalId === titleEvent.externalId,
      )
    ) {
      this.#applyObjective(work, titleEvent);
      return;
    }
    if (
      work.instance.status !== "OPEN" ||
      work.activeBinding?.adapter !== executorId ||
      work.activeBinding.conversationId !== threadId
    )
      return;
    work = this.#core.appendSourceEvents(workId, [titleEvent]).work;
    this.#applyObjective(work, titleEvent);
  }

  #titleEvent(
    executorId: string,
    threadId: string,
    title: string,
    timestamp: string,
  ): SourceEventInput {
    const normalizedTitle = title.trim();
    const titleHash = createHash("sha256")
      .update(normalizedTitle)
      .digest("hex")
      .slice(0, 16);
    return {
      externalId: `${executorId}-conversation-title:${threadId}:${titleHash}`,
      sequence: 0,
      kind: "conversation.title",
      content: normalizedTitle,
      timestamp,
      executorType: "AGENT",
      environmentType: this.#executors.get(executorId).environment.type,
      metadata: { source: `${executorId}.thread.name` },
      artifactRefs: [],
    };
  }

  #applyObjective(
    work: WorkSnapshot,
    titleEvent: SourceEventInput,
  ): WorkSnapshot {
    const existingObjective = work.state.objective[0];
    if (
      existingObjective?.origin === "USER_EDITED" ||
      !titleEvent.content?.trim()
    )
      return work;
    if (
      existingObjective?.text === titleEvent.content &&
      existingObjective.origin === "SYSTEM_INFERRED" &&
      existingObjective.sourceMessageIds.length === 1 &&
      existingObjective.sourceMessageIds[0] === titleEvent.externalId
    ) {
      return work;
    }
    return this.#core.applyExtractorPatch(work.instance.id, {
      objective: [
        {
          id: existingObjective?.id ?? `work-objective:${work.instance.id}`,
          text: titleEvent.content,
          origin: "SYSTEM_INFERRED",
          sourceMessageIds: [titleEvent.externalId],
        },
      ],
    });
  }

  #sourceInputs(
    events: Array<NormalizedSourceEvent | SourceEventInput | SourceEvent>,
  ): SourceEventInput[] {
    return events.map((event) => ({
      externalId: event.externalId,
      sequence: event.sequence,
      kind: event.kind,
      content: event.content,
      timestamp: event.timestamp,
      executorType: event.executorType,
      environmentType: event.environmentType,
      metadata: event.metadata ?? {},
      artifactRefs: "artifactRefs" in event ? event.artifactRefs : [],
    }));
  }

  async #ingestDelta(
    current: WorkSnapshot,
    thread: NormalizedThread,
  ): Promise<{ work: WorkSnapshot; newEvents: NormalizedSourceEvent[] }> {
    const known = new Set(
      current.sourceArchive.map((event) => event.externalId),
    );
    const captureStart = thread.events.findIndex((event) =>
      known.has(event.externalId),
    );
    const captureScope =
      captureStart === -1 ? thread.events : thread.events.slice(captureStart);
    const maxSequence = Math.max(
      0,
      ...current.sourceArchive.map((event) => event.sequence),
    );
    const newEvents = captureScope
      .filter((event) => !known.has(event.externalId))
      .map((event, index) => ({
        ...event,
        sequence: maxSequence + index + 1,
        metadata: { ...event.metadata, sourceSequence: event.sequence },
      }));
    let work = this.#core.appendSourceEvents(
      current.instance.id,
      this.#sourceInputs(newEvents),
    ).work;
    work = await this.#artifacts.attach(work, newEvents);
    return { work, newEvents };
  }

  #requireWork(workId: string): WorkSnapshot {
    const work = this.#core.getWork(workId);
    if (!work) throw new Error("WORK_NOT_FOUND");
    return work;
  }

  #globalPetState(): DashboardView["petState"] {
    if (this.#petState === "carrying" || this.#petState === "alert")
      return this.#petState;
    const statuses = this.#core.listWorks("OPEN").map(captureStatus);
    if (statuses.includes("recording")) return "awake";
    if (statuses.includes("waiting")) return "waiting";
    return "sleeping";
  }

  #summary(work: WorkSnapshot): WorkSummaryView {
    return {
      id: work.instance.id,
      agentName:
        (work.activeEpisode ?? work.episodes.at(-1))?.executor.name ??
        (work.definition.kind === "REUSABLE" ? "尚未交给执行者" : "未知 Agent"),
      title: work.state.objective[0]?.text ?? "未命名工作",
      status: work.instance.status,
      captureStatus: captureStatus(work),
      updatedAt: work.instance.updatedAt,
      eventCount: work.sourceArchive.length,
      artifactCount: work.artifactRefs.length,
      episodeCount: work.episodes.length,
    };
  }

  #detail(work: WorkSnapshot): WorkDetailView {
    const dispatch = this.#core.definitions.db
      .prepare("SELECT status,read_at FROM pending_dispatches WHERE work_id=?")
      .get(work.instance.id);
    return {
      ...(work.definition.kind === "REUSABLE"
        ? {
            reusableDefinitionId: work.definition.id,
            dispatchStatus: String(dispatch?.status ?? "NOT_DISPATCHED"),
            dispatchReadAt: (dispatch?.read_at as string | null) ?? null,
          }
        : {}),
      ...this.#summary(work),
      state: {
        ...work.state,
        artifacts: work.state.artifacts.map((item) => {
          const file = artifactFile(item.text);
          return file ? { ...item, file } : item;
        }),
      },
      episodes: work.episodes.map((episode) => ({
        id: episode.id,
        executor: episode.executor.name,
        environment: episode.environment.name,
        status: episode.status,
        startedAt: episode.startedAt,
        endedAt: episode.endedAt,
      })),
      bindings: work.bindings.map((binding) => ({
        id: binding.id,
        episodeId: binding.episodeId,
        adapter: binding.adapter,
        conversationId: binding.conversationId,
        status: binding.status,
      })),
    };
  }
}
