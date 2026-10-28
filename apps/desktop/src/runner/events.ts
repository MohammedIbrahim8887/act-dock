import type { Store } from "./store";
import type { RunEvent } from "../shared/contracts";

export async function readEvents(
  store: Store,
  query: { cursor: number; runIds?: string[]; limit: number; waitMs: number },
) {
  const read = () => {
    if (store.closed)
      return { events: [], nextCursor: query.cursor, hasMore: false };
    const ids = query.runIds;
    const filter = ids?.length
      ? ` AND run_id IN (${ids.map(() => "?").join(",")})`
      : "";
    const rows = store.db
      .query(`SELECT * FROM events WHERE seq>?${filter} ORDER BY seq LIMIT ?`)
      .all(query.cursor, ...(ids || []), query.limit + 1) as {
      seq: number;
      run_id: string | null;
      kind: RunEvent["kind"];
      time: string;
      data: string;
    }[];
    return {
      events: rows.slice(0, query.limit).map((r) => ({
        seq: r.seq,
        runId: r.run_id,
        kind: r.kind,
        time: r.time,
        data: JSON.parse(r.data),
      })),
      nextCursor: rows.slice(0, query.limit).at(-1)?.seq ?? query.cursor,
      hasMore: rows.length > query.limit,
    };
  };
  const initial = read();
  if (initial.events.length || !query.waitMs) return initial;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      store.listeners.delete(check);
      resolve();
    };
    const check = () => {
      if (store.closed || read().events.length) done();
    };
    const timer = setTimeout(done, query.waitMs);
    store.listeners.add(check);
    check(); // Closes the read/subscribe race.
  });
  return read();
}
