#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>

int main(void) {
  @autoreleasepool {
    NSRunningApplication *application = [[NSWorkspace sharedWorkspace] frontmostApplication];
    pid_t processId = application.processIdentifier;
    NSArray<NSDictionary *> *windows = CFBridgingRelease(
      CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID)
    );
    NSDictionary *window = nil;
    for (NSDictionary *candidate in windows) {
      NSNumber *ownerPid = candidate[(id)kCGWindowOwnerPID];
      NSNumber *layer = candidate[(id)kCGWindowLayer];
      if (ownerPid.intValue == processId && layer.intValue == 0) {
        window = candidate;
        break;
      }
    }
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
