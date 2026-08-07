/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface DeviceMotionEventConstructor {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

interface DeviceOrientationEventConstructor {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

interface Window {
  DeviceMotionEvent: typeof DeviceMotionEvent & DeviceMotionEventConstructor;
  DeviceOrientationEvent: typeof DeviceOrientationEvent & DeviceOrientationEventConstructor;
}
