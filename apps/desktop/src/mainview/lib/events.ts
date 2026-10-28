import { api } from "./api";
import type { Results, RunEvent } from "../../shared/contracts";
const listeners = new Set<(events: RunEvent[]) => void>();
let running = false,
  cursor: number | undefined;
async function loop() {
  if (running) return;
  running = true;
  try {
    while (listeners.size) {
      try {
        if (cursor === undefined) {
          cursor = (await api("get_runner_snapshot")).cursor;
          for (const listener of listeners) listener([]);
        }
        const page: Results["read_events"] = await api("read_events", {
          cursor,
          limit: 500,
          waitMs: 10000,
        });
        cursor = page.nextCursor;
        if (page.events.length)
          for (const listener of listeners) {
            try {
              listener(page.events);
            } catch {}
          }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  } finally {
    running = false;
    if (listeners.size) void loop();
  }
}
/** One connection for the whole webview. Subscribers never control execution lifetime. */
export function subscribeEvents(listener: (events: RunEvent[]) => void) {
  listeners.add(listener);
  void loop();
  return () => {
    listeners.delete(listener);
  };
}
