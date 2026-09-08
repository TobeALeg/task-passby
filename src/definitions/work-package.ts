import type { WorkSnapshot, WorkState } from "../core/types.js";
import type { Definition, DefinitionRepository, Inputs } from "./repository.js";
import type { Material } from "./storage.js";
export type WorkPackage = {
  packageVersion: 1;
  purpose: "START" | "CONTINUE";
  workId: string;
  generatedAt: string;
  definition: Definition | null;
  inputs: Inputs;
  fixedMaterials: Material[];
  referenceExamples: unknown[];
  state: WorkState;
  nextStep: string | null;
  acceptanceRequired: boolean;
  fileAccess: string;
};
export function buildWorkPackage(
  work: WorkSnapshot,
  repository: DefinitionRepository,
): WorkPackage {
  const definition =
    work.definition.kind === "REUSABLE"
      ? repository.get(work.definition.id)
      : null;
  if (definition) {
    const strip = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(strip);
      else if (value && typeof value === "object") {
        delete (value as Record<string, unknown>).excerpt;
        Object.values(value).forEach(strip);
      }
    };
    strip(definition);
  }
  if (definition)
    definition.materials.forEach((m) => repository.materials.verify(m));
  const binding = repository.inputs(work.instance.id);
  for (const spec of definition?.content.inputs ?? [])
    if (spec.valueType === "FILE" && binding.inputs[spec.key])
      repository.materials.read(String(binding.inputs[spec.key]));
  return {
    packageVersion: 1,
    purpose:
      definition &&
      !work.sourceArchive.some((e) => e.environmentType !== "WORKPET_LOCAL")
        ? "START"
        : "CONTINUE",
    workId: work.instance.id,
    generatedAt: new Date().toISOString(),
    definition,
    ...binding,
    fixedMaterials: definition?.materials ?? [],
    state: work.state,
    nextStep: work.state.pendingActions[0]?.text ?? null,
    acceptanceRequired: !!definition,
    fileAccess:
      "资料为本机引用；另一台电脑需要另行传递文件。完成须由用户关联本次交付物并逐项验收。",
  };
}
const escapeMarkdown = (value: string) =>
  value.replace(/[\\`*_{}\[\]<>()#!|]/g, "\\$&");
export function packageMarkdown(value: WorkPackage): string {
  const lines = [
    `# ${escapeMarkdown(value.definition?.content.name ?? value.state.objective[0]?.text ?? "工作")}`,
    `意图：${value.purpose} · 工作 ID：${value.workId}`,
    value.fileAccess,
  ];
  const content = value.definition?.content;
  if (content) {
    lines.push(`\n## 目的\n${escapeMarkdown(content.purpose.text)}`);
    for (const [label, items] of [
      ["交付", content.deliverables],
      ["约束", content.constraints],
      ["验收", content.acceptanceCriteria],
      ["方法", content.methods],
    ] as const)
      lines.push(
        `\n## ${label}\n${items.map((i) => `- ${escapeMarkdown(i.text)}${"obligation" in i ? ` (${i.obligation})` : ""}`).join("\n")}`,
      );
  }
  lines.push(
    `\n## 本次输入\n${Object.entries(value.inputs)
      .map(([k, v]) => `- ${escapeMarkdown(k)}: ${escapeMarkdown(String(v))}`)
      .join("\n")}`,
  );
  lines.push(
    `\n## 固定资料\n${value.fixedMaterials.map((m) => `- ${escapeMarkdown(m.role)}: ${escapeMarkdown(m.path)} (SHA256 ${m.hash})`).join("\n")}`,
  );
  lines.push(
    `\n## 当前状态\n${Object.entries(value.state)
      .map(
        ([k, items]) =>
          `### ${k}\n${items.map((i) => `- ${escapeMarkdown(i.text)}`).join("\n")}`,
      )
      .join("\n")}`,
  );
  if (value.referenceExamples.length)
    lines.push(
      `\n## 用户选择的旧参考案例\n${escapeMarkdown(JSON.stringify(value.referenceExamples))}`,
    );
  return lines.join("\n");
}
