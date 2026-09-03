#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>
#import <unistd.h>

static BOOL IsSupportedApplication(NSRunningApplication *application) {
  NSString *bundleId = application.bundleIdentifier ?: @"";
  return [bundleId isEqualToString:@"com.openai.codex"]
    || [bundleId isEqualToString:@"DOVE.tauri"]
    || [bundleId isEqualToString:@"com.tencent.workbuddy.mac"];
}

static NSDictionary *FirstWindowForProcess(NSArray<NSDictionary *> *windows, pid_t processId) {
  for (NSDictionary *candidate in windows) {
    NSNumber *ownerPid = candidate[(id)kCGWindowOwnerPID];
    NSNumber *layer = candidate[(id)kCGWindowLayer];
    if (ownerPid.intValue == processId && layer.intValue == 0) return candidate;
  }
  return nil;
}

int main(void) {
  @autoreleasepool {
    NSRunningApplication *application = [[NSWorkspace sharedWorkspace] frontmostApplication];
    NSArray<NSDictionary *> *windows = CFBridgingRelease(
      CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID)
    );

    // Helper 由 Worket 主进程直接启动。面板位于前台时，向后选择最近的受支持工作窗口；
    // 其他不受支持的前台应用仍按原样返回，避免把后台聊天误判为当前工作。
    if (application.processIdentifier == getppid()) {
      for (NSDictionary *candidate in windows) {
        NSNumber *ownerPid = candidate[(id)kCGWindowOwnerPID];
        NSNumber *layer = candidate[(id)kCGWindowLayer];
        if (ownerPid.intValue == getppid() || layer.intValue != 0) continue;
        NSRunningApplication *candidateApplication =
          [NSRunningApplication runningApplicationWithProcessIdentifier:ownerPid.intValue];
        if (candidateApplication && IsSupportedApplication(candidateApplication)) {
          application = candidateApplication;
          break;
        }
      }
    }

    NSDictionary *window = FirstWindowForProcess(windows, application.processIdentifier);
    NSString *title = window[(id)kCGWindowName] ?: @"";
    NSDictionary *payload = @{
      @"bundleId": application.bundleIdentifier ?: @"",
      @"name": application.localizedName ?: @"",
      @"windowTitle": title
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\n', stdout);
  }
  return 0;
}
