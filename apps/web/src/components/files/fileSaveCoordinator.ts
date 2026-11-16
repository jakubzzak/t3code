import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";

export interface FileSaveCoordinatorOptions<A, E> {
  readonly debounceMs: number;
  readonly canPersist?: () => boolean;
  readonly persist: (contents: string) => Promise<AtomCommandResult<A, E>>;
  readonly onPendingChange: (pending: boolean) => void;
  /** Return false when another editor has newer unsaved contents. */
  readonly onConfirmed: (contents: string) => boolean | void;
  /** Called when a write pass ends with nothing further scheduled. */
  readonly onSettled?: () => void;
}

export class FileSaveCoordinator<A = unknown, E = unknown> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private latestContents = "";
  private latestRevision = 0;
  private confirmedRevision = 0;
  private discardedRevision = 0;
  private lastChangeAt = 0;
  private saving = false;
  private disposed = false;
  private flushing = false;
  private waiters: Array<{ revision: number; resolve: (saved: boolean) => void }> = [];

  constructor(private readonly options: FileSaveCoordinatorOptions<A, E>) {}

  change(contents: string): void {
    if (this.disposed) return;
    this.latestContents = contents;
    this.latestRevision += 1;
    this.lastChangeAt = Date.now();
    this.options.onPendingChange(true);
    this.schedule(this.options.debounceMs);
  }

  /** Resolves once this edit is written (true) or rejected (false). */
  changeAndWait(contents: string): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    const promise = new Promise<boolean>((resolve) => {
      this.waiters.push({ revision: this.latestRevision + 1, resolve });
    });
    this.change(contents);
    return promise;
  }

  /** The newest contents not yet written, which is the last write this coordinator will make. */
  get unconfirmedContents(): string | null {
    return this.latestRevision === this.confirmedRevision ||
      this.latestRevision === this.discardedRevision
      ? null
      : this.latestContents;
  }

  /** Writes the newest draft now instead of after the debounce, then any draft queued behind it. */
  flush(): void {
    this.clearTimer();
    this.flushing = true;
    void this.persistLatest();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.latestRevision > 0) void this.persistLatest();
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persistLatest();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async persistLatest(): Promise<void> {
    if (this.saving) return;
    if (
      this.latestRevision === this.confirmedRevision ||
      this.latestRevision === this.discardedRevision
    ) {
      this.settle();
      return;
    }
    if (this.options.canPersist?.() === false) {
      if (this.waiters.some((waiter) => waiter.revision === this.latestRevision)) {
        this.discardedRevision = this.latestRevision;
        this.options.onPendingChange(false);
      }
      for (const waiter of this.waiters) waiter.resolve(false);
      this.waiters = [];
      this.settle();
      return;
    }

    this.saving = true;
    const contents = this.latestContents;
    const revision = this.latestRevision;
    const result = await this.options.persist(contents);
    const succeeded = result._tag === "Success";
    let confirmed = false;
    if (succeeded) {
      this.confirmedRevision = revision;
      confirmed = this.options.onConfirmed(contents) !== false;
    } else if (this.waiters.some((waiter) => waiter.revision === revision)) {
      // Awaited picker edits retain the saved UI on failure. Do not later flush
      // their rejected contents on close as if they were unsaved editor text.
      this.discardedRevision = revision;
    }

    this.waiters = this.waiters.filter((waiter) => {
      if (waiter.revision > revision) return true;
      waiter.resolve(succeeded);
      return false;
    });
    this.saving = false;
    if (revision === this.latestRevision) {
      if (confirmed || this.discardedRevision === revision) this.options.onPendingChange(false);
      this.settle();
      return;
    }

    const remainingDebounce = Math.max(
      0,
      this.options.debounceMs - (Date.now() - this.lastChangeAt),
    );
    if (this.disposed || this.flushing) {
      void this.persistLatest();
    } else {
      this.schedule(remainingDebounce);
    }
  }

  private settle(): void {
    this.flushing = false;
    this.options.onSettled?.();
  }
}
