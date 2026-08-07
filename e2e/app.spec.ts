import { expect, test, type Page } from '@playwright/test';

async function finishOnboarding(page: Page): Promise<void> {
  await page.goto('/');
  const skip = page.getByRole('button', { name: 'Skip' });
  const startDrive = page.getByRole('button', { name: 'Start Drive' });
  await expect(skip.or(startDrive)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(startDrive).toBeVisible();
}

test('renders the production navigation and persists onboarding', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await finishOnboarding(page);

  await expect(page.getByRole('button', { name: 'Start Drive' })).toBeVisible();
  await expect(page.getByText('Your bump and drive data stays on this device unless you export it.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByText('Install on iPhone').click();
  await expect(page.getByRole('heading', { name: 'Install on iPhone' })).toBeVisible();
  await expect(page.getByText('Add to Home Screen')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Start Drive' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip' })).toHaveCount(0);
  await expect(page.getByText(/accelerometer|confidence score|sampling frequency/i)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('exposes a valid install manifest and an offline app shell', async ({ page, context, browserName }) => {
  await finishOnboarding(page);

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifestResponse = await page.request.get(manifestHref as string);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json() as {
    display: string;
    start_url: string;
    scope: string;
    icons: Array<{ sizes: string; purpose?: string }>;
  };
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  expect(manifest.scope).toBe('/');
  expect(manifest.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      });
    }
  });
  if (browserName === 'webkit') {
    // Playwright's Windows WebKit port can terminate an offline top-level reload.
    // Inspect the actual precache instead; Chromium exercises the offline navigation below.
    const cachedShell = await page.evaluate(async () => {
      const urls = (await Promise.all((await caches.keys()).map(async (name) =>
        (await caches.open(name)).keys()))).flat().map((request) => request.url);
      return urls.some((url) => url.includes('index.html')) &&
        urls.some((url) => /\/assets\/.*\.js(?:\?|$)/.test(url)) &&
        urls.some((url) => /\/assets\/.*\.css(?:\?|$)/.test(url));
    });
    expect(cachedShell).toBe(true);
  } else {
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Start Drive' })).toBeVisible();
  }
});

test('runs the user-triggered permission flow and cleanly ends a drive', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeDeviceMotionEvent extends Event {
      static requestPermission(): Promise<'granted'> {
        return Promise.resolve('granted');
      }
    }
    class FakeDeviceOrientationEvent extends Event {
      static requestPermission(): Promise<'granted'> {
        return Promise.resolve('granted');
      }
    }
    Object.defineProperty(window, 'DeviceMotionEvent', { configurable: true, value: FakeDeviceMotionEvent });
    Object.defineProperty(window, 'DeviceOrientationEvent', { configurable: true, value: FakeDeviceOrientationEvent });

    const position = (): GeolocationPosition => ({
      coords: {
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: 90,
        latitude: 24.7136,
        longitude: 46.6753,
        speed: 8,
        toJSON: () => ({})
      },
      timestamp: Date.now(),
      toJSON: () => ({})
    });
    let watchId = 0;
    const timers = new Map<number, number>();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback): void {
          success(position());
        },
        watchPosition(success: PositionCallback): number {
          watchId += 1;
          const id = watchId;
          const timer = window.setTimeout(() => success(position()), 20);
          timers.set(id, timer);
          return id;
        },
        clearWatch(id: number): void {
          const timer = timers.get(id);
          if (timer !== undefined) window.clearTimeout(timer);
          timers.delete(id);
        }
      }
    });

    class FakePermissionStatus extends EventTarget {
      state: PermissionState = 'granted';
    }
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: () => Promise.resolve(new FakePermissionStatus()) }
    });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: () => Promise.resolve({
          released: false,
          addEventListener: () => undefined,
          release: () => Promise.resolve()
        })
      }
    });

    class FakeAudioContext {
      state: AudioContextState = 'running';
      currentTime = 0;
      destination = {};

      createOscillator() {
        return {
          type: 'sine',
          frequency: {
            setValueAtTime: () => undefined,
            exponentialRampToValueAtTime: () => undefined
          },
          connect: () => undefined,
          start: () => undefined,
          stop: () => undefined
        };
      }

      createGain() {
        return {
          gain: {
            value: 0,
            setValueAtTime: () => undefined,
            exponentialRampToValueAtTime: () => undefined
          },
          connect: () => undefined
        };
      }

      resume(): Promise<void> {
        this.state = 'running';
        return Promise.resolve();
      }

      close(): Promise<void> {
        this.state = 'closed';
        return Promise.resolve();
      }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  });

  await finishOnboarding(page);
  await page.getByRole('button', { name: 'Start Drive' }).click();
  await expect(page.getByRole('heading', { name: 'Ready to drive?' })).toBeVisible();
  await page.getByRole('button', { name: 'Phone is mounted' }).click();
  await expect(page.getByText('Drive active')).toBeVisible();
  await expect(page.getByText('29 km/h')).toBeVisible();

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Drive paused')).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('Drive active')).toBeVisible();
  await page.getByRole('button', { name: 'End Drive' }).click();
  await expect(page.getByRole('button', { name: 'Start Drive' })).toBeVisible();

  await page.getByRole('button', { name: 'Drives' }).click();
  await expect(page.getByText('1 bumps found')).toHaveCount(0);
  await expect(page.getByText('0 bumps found')).toBeVisible();
});
