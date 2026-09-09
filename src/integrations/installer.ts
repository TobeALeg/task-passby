import type { ExecutorAdapter } from "../executors/types.js";

export class IntegrationInstaller {
  constructor(
    readonly appPath: string,
    readonly executors: ExecutorAdapter[],
  ) {}
  async install(): Promise<Record<string, string>> {
    const entries = await Promise.all(
      this.executors.map(async (adapter) => {
        try {
          return [
            adapter.id,
            (await adapter.install?.(this.appPath)) ?? "not-required",
          ] as const;
        } catch (error) {
          return [adapter.id, `unavailable: ${String(error)}`] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  }
}
