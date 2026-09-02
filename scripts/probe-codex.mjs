import { CodexAppServerClient } from "../dist/adapters/codex/app-server-client.js";

const client = new CodexAppServerClient();
try {
  const threads = await client.listRecentThreads(3);
  console.log(JSON.stringify(threads, null, 2));
  if (threads[0]) {
    const thread = await client.readThread(threads[0].id);
    console.log(JSON.stringify({
      id: thread.threadId,
      title: thread.title,
      eventCount: thread.events.length,
      eventKinds: [...new Set(thread.events.map((event) => event.kind))]
    }, null, 2));
  }
} finally {
  client.close();
}
