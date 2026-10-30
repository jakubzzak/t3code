// @effect-diagnostics globalTimers:off - Owns a bounded browser idle timer, not polling.
/** Keeps asynchronous page updates running between tools without retaining idle tabs forever. */
export class AutomationActivity {
  private users = 0;
  private holds = 0;
  private epoch = 0;
  private closed = false;
  private active: boolean | undefined = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tail: Promise<void> = Promise.resolve();

  private readonly apply: (active: boolean) => Promise<void>;
  private readonly onError: (error: unknown) => void;
  private readonly idleMs: number;

  constructor(
    apply: (active: boolean) => Promise<void>,
    onError: (error: unknown) => void,
    idleMs = 5_000,
  ) {
    this.apply = apply;
    this.onError = onError;
    this.idleMs = idleMs;
  }

  private cancelTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private setActive(active: boolean) {
    const pending = this.tail.then(async () => {
      if (this.active === active) return;
      try {
        await this.apply(active);
      } catch (cause) {
        // A lost acknowledgement does not prove the desktop ignored the command.
        this.active = undefined;
        throw cause;
      }
      this.active = active;
    });
    this.tail = pending.catch(this.onError);
    return pending;
  }

  /** Invalidate outstanding leases on takeover or teardown; late completions cannot rearm them. */
  reset() {
    this.cancelTimer();
    this.epoch++;
    this.users = 0;
    return this.setActive(this.holds > 0);
  }

  close() {
    this.closed = true;
    this.holds = 0;
    return this.reset();
  }

  /** A recording holds demand until explicitly stopped; ordinary tools release with a short grace. */
  async acquire(persistent = false) {
    if (this.closed) throw new Error("The browser activity is closed.");
    this.cancelTimer();
    const epoch = this.epoch;
    if (persistent) this.holds++;
    else this.users++;
    let released = false;
    const release = async (success = false) => {
      if (released || this.closed || (!persistent && epoch !== this.epoch)) return;
      released = true;
      if (persistent) this.holds--;
      else this.users--;
      if (this.users !== 0 || this.holds !== 0) return;
      if (success) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.setActive(false).catch(this.onError);
        }, this.idleMs);
        this.timer.unref?.();
      } else {
        await this.setActive(false);
      }
    };
    try {
      await this.setActive(true);
      if (this.closed || (!persistent && epoch !== this.epoch))
        throw new Error("Browser control changed.");
      return release;
    } catch (cause) {
      await release().catch(this.onError);
      throw cause;
    }
  }

  async run<A>(work: () => Promise<A>, signal?: AbortSignal): Promise<A> {
    signal?.throwIfAborted();
    const release = await this.acquire();
    const abort = () => {
      void release().catch(this.onError);
    };
    signal?.addEventListener("abort", abort, { once: true });
    let success = false;
    try {
      signal?.throwIfAborted();
      const result = await work();
      success = true;
      return result;
    } finally {
      signal?.removeEventListener("abort", abort);
      await release(success).catch(this.onError);
    }
  }
}
