import { AppService } from "../../dist/app/app-service.js";
import { createDefaultExecutors } from "../../dist/executors/defaults.js";
export function makeService(options: any): AppService {
  const workbuddy = options.workbuddy ?? {
    async listThreadPage() {
      return { threads: [], nextCursor: null };
    },
    async readThread(id: string) {
      return {
        threadId: id,
        title: "WorkBuddy 工作",
        applicationTitle: "WorkBuddy 工作",
        cwd: "/tmp",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        events: [],
      };
    },
    close() {},
  };
  return new AppService({
    databasePath: options.databasePath,
    foreground: options.foreground,
    executors: createDefaultExecutors({ ...options, workbuddy }),
  });
}
