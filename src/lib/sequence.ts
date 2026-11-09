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
    const visited = new Set<number>();
    let first = true,
      replenished = false,
      last: Track | undefined;
    try {
      while (token === this.generation) {
        const q = this.context.queue();
        if (index < 0 || index >= q.length) {
          if (!replenished) {
            replenished = true;
            const end = q.length;
            await this.context.replenish();
            if (token !== this.generation) return;
            index = end;
            if (index < this.context.queue().length) continue;
          }
          this.context.exhausted(last, attempted.size);
          return;
        }
        const id = q[index],
          track = this.context.track(id);
        if (visited.has(index)) {
          this.context.exhausted(last, attempted.size);
          return;
        }
        visited.add(index);
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
        if (index >= currentQueue.length && this.context.wrap()) index = 0;
        // A finite pass visits each video at most once, including repeat-all/one failures.
        if (index < currentQueue.length && visited.has(index)) {
          this.context.exhausted(last, attempted.size);
          return;
        }
      }
    } finally {
      if (token === this.generation) this.running = false;
    }
  }
}
