import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenWakeLock } from '../../src/platform/wakeLock';

class FakeWakeLockSentinel extends EventTarget {
  released = false;
  readonly type = 'screen';
  readonly release = vi.fn(() => {
    this.released = true;
    this.dispatchEvent(new Event('release'));
    return Promise.resolve();
  });
  onrelease: ((this: WakeLockSentinel, event: Event) => unknown) | null = null;
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

function installWakeLock(request: () => Promise<FakeWakeLockSentinel>): ReturnType<typeof vi.fn> {
  const requestMock = vi.fn(request);
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request: requestMock }
  });
  return requestMock;
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'wakeLock');
  setVisibility('visible');
});

describe('ScreenWakeLock', () => {
  it('acquires once, reports active state, and releases cleanly', async () => {
    setVisibility('visible');
    const sentinel = new FakeWakeLockSentinel();
    const request = installWakeLock(() => Promise.resolve(sentinel));
    const lock = new ScreenWakeLock();

    await expect(lock.acquire()).resolves.toBe(true);
    await expect(lock.acquire()).resolves.toBe(true);
    expect(request).toHaveBeenCalledOnce();
    expect(lock.active).toBe(true);

    await lock.release();
    expect(sentinel.release).toHaveBeenCalledOnce();
    expect(lock.active).toBe(false);
  });

  it('deduplicates concurrent acquisition requests', async () => {
    setVisibility('visible');
    const sentinel = new FakeWakeLockSentinel();
    let resolveRequest: ((value: FakeWakeLockSentinel) => void) | null = null;
    const request = installWakeLock(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const lock = new ScreenWakeLock();

    const first = lock.acquire();
    const second = lock.acquire();
    expect(request).toHaveBeenCalledOnce();
    resolveRequest!(sentinel);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it('tracks browser-initiated loss and can reacquire a new sentinel', async () => {
    setVisibility('visible');
    const first = new FakeWakeLockSentinel();
    const second = new FakeWakeLockSentinel();
    const request = installWakeLock(
      vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    );
    const lock = new ScreenWakeLock();
    await lock.acquire();
    first.released = true;
    first.dispatchEvent(new Event('release'));
    expect(lock.active).toBe(false);

    await expect(lock.acquire()).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(lock.active).toBe(true);
  });

  it('continues without crashing when hidden, unsupported, denied, or release fails', async () => {
    const unsupported = new ScreenWakeLock();
    expect(unsupported.supported).toBe(false);
    await expect(unsupported.acquire()).resolves.toBe(false);

    installWakeLock(() => Promise.reject(new DOMException('denied')));
    const denied = new ScreenWakeLock();
    await expect(denied.acquire()).resolves.toBe(false);

    setVisibility('hidden');
    await expect(denied.acquire()).resolves.toBe(false);

    setVisibility('visible');
    const brokenSentinel = new FakeWakeLockSentinel();
    brokenSentinel.release.mockRejectedValueOnce(new DOMException('already gone'));
    installWakeLock(() => Promise.resolve(brokenSentinel));
    const brokenRelease = new ScreenWakeLock();
    await brokenRelease.acquire();
    await expect(brokenRelease.release()).resolves.toBeUndefined();
  });
});
