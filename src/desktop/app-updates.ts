import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import { existsSync } from "node:fs";
import type { Release } from "./github-release.js";

type UpdateOptions = {
  showDialog: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
  latest: () => Promise<Release | null>;
  download: (release: Release) => Promise<string>;
  reveal: (path: string) => void;
  enabled: boolean;
  version: string;
};

export class AppUpdates {
  private readonly options: UpdateOptions;
  private busy = false;
  private manual = false;
  private stopped = false;
  private dismissedVersion = "";
  private downloaded: { version: string; path: string } | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(options: UpdateOptions) { this.options = options; }

  start(): void {
    if (!this.options.enabled || this.timer) return;
    this.stopped = false;
    void this.check();
    this.timer = setInterval(() => void this.check(), 60 * 60 * 1000);
    this.timer.unref();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  async check(manual = false): Promise<void> {
    if (this.stopped) return;
    if (!this.options.enabled) {
      if (manual) await this.notice("开发模式不检查更新", "请使用正常启动的 Worket 应用检查新版。");
      return;
    }
    this.manual ||= manual;
    if (this.busy) {
      if (manual) await this.notice("正在检查或下载更新", "下载完成后会打开文件位置，您可以继续工作。");
      return;
    }
    this.busy = true;
    try {
      const release = await this.options.latest();
      if (this.stopped) return;
      if (!release) {
        if (this.manual) await this.notice("暂无可用更新", `当前版本：${this.options.version}`);
        return;
      }
      if (!this.manual && release.version === this.dismissedVersion) return;
      if (this.downloaded?.version === release.version && existsSync(this.downloaded.path)) {
        if (this.manual) this.options.reveal(this.downloaded.path);
        return;
      }
      const result = await this.options.showDialog({
        type: "info", title: "Worket 更新", message: `发现新版 Worket ${release.version}`,
        detail: `安装包约 ${(release.archive.size / 1024 ** 2).toFixed(1)} MB。下载后请退出 Worket，解压并将新版拖到“应用程序”中替换。已保存的工作和设置会保留。`,
        buttons: ["稍后", "下载新版"], defaultId: 1, cancelId: 0,
      });
      this.dismissedVersion = release.version;
      if (result.response !== 1 || this.stopped) return;
      // Explicit consent makes download failures visible even after a background check.
      this.manual = true;
      const path = await this.options.download(release);
      this.downloaded = { version: release.version, path };
      if (this.stopped) return;
      this.options.reveal(path);
      await this.notice("新版已下载", "已打开安装包所在位置。请先保存编辑并退出 Worket，再解压 ZIP，将 Worket.app 拖到“应用程序”中替换并重新打开。");
    } catch (error) {
      console.error("Worket update failed", error);
      if (this.manual && !this.stopped)
        await this.notice("更新失败", `${error instanceof Error ? error.message : "无法获取更新"}。当前应用仍可继续使用。`);
    } finally {
      this.busy = false;
      this.manual = false;
    }
  }
  private async notice(message: string, detail: string): Promise<void> {
    await this.options.showDialog({ type: "info", title: "Worket 更新", message, detail });
  }
}
