export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private acquisition: Promise<boolean> | null = null;

  get active(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  get supported(): boolean {
    return 'wakeLock' in navigator;
  }

  async acquire(): Promise<boolean> {
    if (!this.supported || document.visibilityState !== 'visible') return false;
    if (this.active) return true;
    this.acquisition ??= this.requestWakeLock();
    try {
      return await this.acquisition;
    } finally {
      this.acquisition = null;
    }
  }

  async release(): Promise<void> {
    const current = this.sentinel;
    this.sentinel = null;
    if (current !== null && !current.released) {
      try {
        await current.release();
      } catch {
        // Wake Lock is a best-effort enhancement and must never prevent clean shutdown.
      }
    }
  }

  private async requestWakeLock(): Promise<boolean> {
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      this.sentinel = sentinel;
      sentinel.addEventListener(
        'release',
        () => {
          if (this.sentinel === sentinel) this.sentinel = null;
        },
        { once: true }
      );
      return true;
    } catch {
      this.sentinel = null;
      return false;
    }
  }
}
