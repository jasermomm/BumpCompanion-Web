import { registerSW } from 'virtual:pwa-register';

export function registerServiceWorker(): void {
  registerSW({
    immediate: true,
    onRegisterError: () => {
      // Offline support is progressive enhancement; failures never block local drive detection.
    }
  });
}
