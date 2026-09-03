import { shell } from "electron";

export interface WorkBuddyLauncher {
  openNewConversation(deepLink: string): Promise<"opened">;
}

export class ElectronWorkBuddyLauncher implements WorkBuddyLauncher {
  async openNewConversation(deepLink: string): Promise<"opened"> {
    await shell.openExternal(deepLink);
    return "opened";
  }
}
