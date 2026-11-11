import type { LoadResult } from "./player";
import type { Track } from "../types";
export interface QueueContext {
  queue: () => string[];
  current: () => number;
  track: (id: string) => Track | undefined;
  excluded: (id: string) => boolean;
  wrap: () => boolean;
  select: (index: number) => void;
  load: (track: Track, position: number) => Promise<LoadResult>;
  skip: (id: string, detail: string) => void;
  replenish: () => Promise<void>;
  exhausted: (track: Track | undefined, count: number) => void;
}
export class QueueTraversal {
  private generation = 0;
  running = false;
  constructor(private context: QueueContext) {}
  cancel() {
    this.generation++;
    this.running = false;
  }
  async run(index: number, position = 0, forceFirst = true) {
    const token = ++this.generation;
    this.running = true;
    const attempted = new Set<string>();
    let first = true,
      replenished = false,
      last: Track | undefined;
    try {
      while (token === this.generation) {
        const q = this.context.queue();
        if (index < 0 || index >= q.length) {
          if (!replenished) {
            replenished = true;
            await this.context.replenish();
            if (token !== this.generation) return;
            const current = this.context.current();
            index = this.context.queue().findIndex((id, i) => i > current && !attempted.has(id));
            if (index !== -1) continue;
          }
          this.context.exhausted(last, attempted.size);
          return;
        }
        const id = q[index],
          track = this.context.track(id);
        const duplicate = attempted.has(id);
        attempted.add(id);
        last = track;
        let selected = false;
        if (
          !track ||
          duplicate ||
          ((!first || !forceFirst) && this.context.excluded(id))
        ) {
          this.context.skip(id, "一時除外中のため自動スキップ");
        } else {
          selected = true;
          this.context.select(index);
          const result = await this.context.load(track, first ? position : 0);
          if (token !== this.generation) return;
          if (
            result.status === "playing" ||
            result.status === "blocked" ||
            result.status === "cancelled"
          )
            return;
          if (result.error.kind === "internal") return;
          this.context.skip(id, result.error.message);
        }
        first = false;
        const currentQueue = this.context.queue();
        const currentId = currentQueue[this.context.current()];
        const base =
          selected && currentId === id ? this.context.current() : index;
        index = base + 1;
        if (index >= currentQueue.length && this.context.wrap()) {
          const remaining = currentQueue.findIndex((id) => !attempted.has(id));
          if (remaining !== -1) index = remaining;
        }
      }
    } finally {
      if (token === this.generation) this.running = false;
    }
  }
}
