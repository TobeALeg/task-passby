import type { AutoUpdater, MessageBoxOptions, MessageBoxReturnValue } from "electron";

const CHECK_INTERVAL = 60 * 60 * 1000;
export const UPDATE_REPOSITORY = "TobeALeg/worket";
export function updateFeed(version: string, arch: string): string {
  return `https://update.electronjs.org/${UPDATE_REPOSITORY}/darwin-${arch}/${encodeURIComponent(version)}`;
}

type UpdateOptions = {
  updater: Pick<AutoUpdater, "on" | "setFeedURL" | "checkForUpdates" | "quitAndInstall">;
  showDialog: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
  beforeInstall: () => Promise<void>;
  enabled: boolean;
  version: string;
  arch: string;
};

/** Native updater owns download/signature verification; this module owns user consent. */
export class AppUpdates {
  private busy = false;
  private downloaded = false;
  private manual = false;
  private prompting = false;
  private installing = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  private readonly options: UpdateOptions;

  constructor(options: UpdateOptions) {
    this.options = options;
    if (!options.enabled) return;
    options.updater.on("error", (error: Error) => {
      this.busy = false;
      console.error("Worket update failed", error.message);
      if (this.manual) void this.notice("更新失败", "请检查网络连接后重试。现有版本仍可继续使用。");
      this.manual = false;
    });
    options.updater.on("update-not-available", () => {
      this.busy = false;
      if (this.manual) void this.notice("已是最新版本", `当前版本：${options.version}`);
      this.manual = false;
    });
    options.updater.on("update-downloaded", () => {
      this.busy = false;
      this.manual = false;
      this.downloaded = true;
      void this.promptInstall();
    });
    options.updater.setFeedURL({ url: updateFeed(options.version, options.arch) });
  }

  start(): void {
    if (!this.options.enabled || this.timer) return;
    this.check();
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL);
    this.timer.unref();
  }

  check(manual = false): void {
    if (!this.options.enabled) {
      if (manual) void this.notice("当前构建不支持自动更新", "请安装经过签名、公证的正式发布版。开发版不会自动替换应用。");
      return;
    }
    if (this.downloaded) {
      if (manual) void this.promptInstall();
      return;
    }
    this.manual ||= manual;
    if (this.busy) {
      if (manual) void this.notice("正在检查或下载更新", "下载完成后会提示重启，您可以继续工作。");
      return;
    }
    this.busy = true;
    try {
      this.options.updater.checkForUpdates();
    } catch (error) {
      this.busy = false;
      this.manual = false;
      console.error("Worket update check failed", error);
      if (manual) void this.notice("更新失败", "暂时无法检查更新，请稍后重试。");
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async notice(message: string, detail: string): Promise<void> {
    await this.options.showDialog({ type: "info", title: "Worket 更新", message, detail });
  }

  private async promptInstall(): Promise<void> {
    if (this.prompting || this.installing) return;
    this.prompting = true;
    try {
      const result = await this.options.showDialog({
        type: "info", title: "Worket 更新", message: "新版 Worket 已下载完成",
        detail: "重启会短暂停止记录。请先保存面板中尚未提交的编辑；已保存的工作和设置会保留。选择稍后，将在正常退出后安装。",
        buttons: ["稍后", "重启更新"], defaultId: 0, cancelId: 0,
      });
      if (result.response !== 1) return;
      this.installing = true;
      await this.options.beforeInstall();
      this.options.updater.quitAndInstall();
    } catch (error) {
      this.installing = false;
      console.error("Worket update installation failed", error);
      await this.notice("暂时无法重启更新", "请保存工作后正常退出并重新打开 Worket。");
    } finally {
      this.prompting = false;
    }
  }
}
