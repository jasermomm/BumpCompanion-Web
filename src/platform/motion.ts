import type { MotionSample } from '../core/detector/types';

export type MotionPermissionStatus = 'granted' | 'denied' | 'unavailable';

export interface MotionFrame {
  sample: MotionSample;
  stabilityScore: number;
}

export interface MotionListener {
  onMotion(frame: MotionFrame): void;
  onError(message: string): void;
}

interface Vector3 {
  x: number;
  y: number;
  z: number;
}

const STANDARD_GRAVITY = 9.80665;
const DEGREES_TO_RADIANS = Math.PI / 180;

function finite(value: number | null | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function matrixMultiplyVector(matrix: readonly number[], vector: Vector3): Vector3 {
  return {
    x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z,
    y: matrix[3] * vector.x + matrix[4] * vector.y + matrix[5] * vector.z,
    z: matrix[6] * vector.x + matrix[7] * vector.y + matrix[8] * vector.z
  };
}

function deviceRotationMatrix(alpha: number, beta: number, gamma: number, screenAngle: number): number[] {
  const z = alpha * DEGREES_TO_RADIANS;
  const x = beta * DEGREES_TO_RADIANS;
  const y = gamma * DEGREES_TO_RADIANS;
  const cZ = Math.cos(z);
  const sZ = Math.sin(z);
  const cX = Math.cos(x);
  const sX = Math.sin(x);
  const cY = Math.cos(y);
  const sY = Math.sin(y);

  const orientation = [
    cZ * cY - sZ * sX * sY,
    -cX * sZ,
    cY * sZ * sX + cZ * sY,
    cY * sZ + cZ * sX * sY,
    cZ * cX,
    sZ * sY - cZ * cY * sX,
    -cX * sY,
    sX,
    cX * cY
  ];

  if (screenAngle === 0) return orientation;
  const angle = -screenAngle * DEGREES_TO_RADIANS;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const screen = [c, -s, 0, s, c, 0, 0, 0, 1];
  return multiplyMatrices(orientation, screen);
}

function multiplyMatrices(a: readonly number[], b: readonly number[]): number[] {
  const result = Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let index = 0; index < 3; index += 1) {
        result[row * 3 + column] += a[row * 3 + index] * b[index * 3 + column];
      }
    }
  }
  return result;
}

function rotationStep(current: readonly number[], previous: readonly number[] | null): number {
  if (previous === null) return 0;
  let trace = 0;
  for (let row = 0; row < 3; row += 1) {
    let dot = 0;
    for (let column = 0; column < 3; column += 1) {
      dot += current[row * 3 + column] * previous[row * 3 + column];
    }
    trace += dot;
  }
  return Math.acos(Math.min(1, Math.max(-1, (trace - 1) * 0.5)));
}

function eventMonotonicMillis(event: Event): number {
  const now = performance.now();
  return Number.isFinite(event.timeStamp) && event.timeStamp > 0 && Math.abs(event.timeStamp - now) < 60_000
    ? event.timeStamp
    : now;
}

/** Normalizes DOM motion into the Android detector's timestamped, vehicle-agnostic sample. */
export class MotionNormalizer {
  private gravity: Vector3 = { x: 0, y: 0, z: STANDARD_GRAVITY };
  private orientationMatrix: number[] | null = null;
  private orientationChange = 0;
  private stability = 1;
  private lastMotionMillis = 0;

  updateOrientation(event: DeviceOrientationEvent): void {
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
    const screenAngle = screen.orientation?.angle ?? finite(window.orientation, 0);
    const matrix = deviceRotationMatrix(event.alpha, event.beta, event.gamma, screenAngle);
    this.orientationChange = rotationStep(matrix, this.orientationMatrix);
    this.orientationMatrix = matrix;
  }

  normalize(event: DeviceMotionEvent): MotionFrame | null {
    const including = event.accelerationIncludingGravity;
    const linearEvent = event.acceleration;
    if (including === null && linearEvent === null) return null;

    const timestampMillis = eventMonotonicMillis(event);
    const dt = this.lastMotionMillis === 0 ? 0 : (timestampMillis - this.lastMotionMillis) / 1000;
    const includingVector: Vector3 = {
      x: finite(including?.x, finite(linearEvent?.x)),
      y: finite(including?.y, finite(linearEvent?.y)),
      z: finite(including?.z, finite(linearEvent?.z))
    };
    let linear: Vector3;
    const linearAccelerationAvailable =
      linearEvent !== null &&
      [linearEvent.x, linearEvent.y, linearEvent.z].some(
        (value) => typeof value === 'number' && Number.isFinite(value)
      );
    if (linearAccelerationAvailable && linearEvent !== null) {
      linear = { x: finite(linearEvent.x), y: finite(linearEvent.y), z: finite(linearEvent.z) };
      if (including !== null) {
        const observedGravity = {
          x: includingVector.x - linear.x,
          y: includingVector.y - linear.y,
          z: includingVector.z - linear.z
        };
        this.gravity = this.lowPassGravity(observedGravity, dt);
      }
    } else {
      this.gravity = this.lowPassGravity(includingVector, dt);
      linear = {
        x: includingVector.x - this.gravity.x,
        y: includingVector.y - this.gravity.y,
        z: includingVector.z - this.gravity.z
      };
    }

    const rate = event.rotationRate;
    const gyro = {
      x: finite(rate?.beta) * DEGREES_TO_RADIANS,
      y: finite(rate?.gamma) * DEGREES_TO_RADIANS,
      z: finite(rate?.alpha) * DEGREES_TO_RADIANS
    };
    const angularSpeed = Math.hypot(gyro.x, gyro.y, gyro.z);
    this.stability = Math.min(1, Math.max(0, this.stability * 0.96 + (1 - Math.min(1, angularSpeed / 3.5)) * 0.04));
    if (this.lastMotionMillis > 0 && timestampMillis - this.lastMotionMillis > 100) {
      this.stability = Math.max(0, this.stability - 0.05);
    }
    this.lastMotionMillis = timestampMillis;

    const gravityMagnitude = Math.max(0.001, Math.hypot(this.gravity.x, this.gravity.y, this.gravity.z));
    const gravityUnit = {
      x: this.gravity.x / gravityMagnitude,
      y: this.gravity.y / gravityMagnitude,
      z: this.gravity.z / gravityMagnitude
    };
    const fallbackVertical = linear.x * gravityUnit.x + linear.y * gravityUnit.y + linear.z * gravityUnit.z;
    const fallbackHorizontal = Math.sqrt(Math.max(0, linear.x ** 2 + linear.y ** 2 + linear.z ** 2 - fallbackVertical ** 2));
    const world = this.orientationMatrix === null ? null : matrixMultiplyVector(this.orientationMatrix, linear);

    // An orientation update describes a transition, not a permanent condition. Consume
    // it once so a single rotation callback cannot make every later motion sample look
    // like continued phone movement.
    const orientationChangeRadians = this.orientationChange;
    this.orientationChange = 0;

    const sample: MotionSample = {
      elapsedRealtimeNanos: Math.round(timestampMillis * 1_000_000),
      epochMillis: Math.round(Date.now() - (performance.now() - timestampMillis)),
      accelerationX: includingVector.x,
      accelerationY: includingVector.y,
      accelerationZ: includingVector.z,
      gyroscopeX: gyro.x,
      gyroscopeY: gyro.y,
      gyroscopeZ: gyro.z,
      verticalAcceleration: world?.z ?? fallbackVertical,
      longitudinalAcceleration: 0,
      lateralAcceleration: world === null ? fallbackHorizontal : Math.hypot(world.x, world.y),
      orientationChangeRadians,
      orientationReliable: world !== null,
      worldAccelerationEast: world?.x ?? Number.NaN,
      worldAccelerationNorth: world?.y ?? Number.NaN,
      linearAccelerationAvailable,
      linearAccelerationX: linear.x,
      linearAccelerationY: linear.y,
      linearAccelerationZ: linear.z,
      gravityX: this.gravity.x,
      gravityY: this.gravity.y,
      gravityZ: this.gravity.z,
      rotationVectorX: Number.NaN,
      rotationVectorY: Number.NaN,
      rotationVectorZ: Number.NaN,
      rotationVectorW: Number.NaN
    };
    return { sample, stabilityScore: this.stability };
  }

  reset(): void {
    this.gravity = { x: 0, y: 0, z: STANDARD_GRAVITY };
    this.orientationMatrix = null;
    this.orientationChange = 0;
    this.stability = 1;
    this.lastMotionMillis = 0;
  }

  private lowPassGravity(observed: Vector3, dt: number): Vector3 {
    const alpha = dt > 0 && dt < 0.5 ? Math.min(0.08, dt / 1.2) : 0.02;
    return {
      x: this.gravity.x + alpha * (observed.x - this.gravity.x),
      y: this.gravity.y + alpha * (observed.y - this.gravity.y),
      z: this.gravity.z + alpha * (observed.z - this.gravity.z)
    };
  }
}

export class BrowserMotionProvider {
  private readonly normalizer = new MotionNormalizer();
  private listener: MotionListener | null = null;

  readonly available = typeof window !== 'undefined' && 'DeviceMotionEvent' in window;

  async requestPermission(): Promise<MotionPermissionStatus> {
    if (!this.available) return 'unavailable';
    try {
      const motionConstructor = window.DeviceMotionEvent;
      if (typeof motionConstructor.requestPermission === 'function') {
        const result = await motionConstructor.requestPermission();
        if (result !== 'granted') return 'denied';
      }
      const orientationConstructor = window.DeviceOrientationEvent;
      if (typeof orientationConstructor?.requestPermission === 'function') {
        // Orientation improves axes but motion remains usable if this optional request is denied.
        try {
          await orientationConstructor.requestPermission();
        } catch {
          // DeviceMotion is the required input. Safari may independently reject the
          // optional orientation prompt, in which case gravity-axis projection remains
          // available and the detector reports reduced quality.
        }
      }
      return 'granted';
    } catch {
      return 'denied';
    }
  }

  start(listener: MotionListener): boolean {
    if (!this.available) return false;
    this.stop();
    this.listener = listener;
    window.addEventListener('deviceorientation', this.onOrientation, { passive: true });
    window.addEventListener('devicemotion', this.onMotion, { passive: true });
    return true;
  }

  stop(): void {
    window.removeEventListener('deviceorientation', this.onOrientation);
    window.removeEventListener('devicemotion', this.onMotion);
    this.listener = null;
    this.normalizer.reset();
  }

  private readonly onOrientation = (event: DeviceOrientationEvent): void => {
    this.normalizer.updateOrientation(event);
  };

  private readonly onMotion = (event: DeviceMotionEvent): void => {
    const frame = this.normalizer.normalize(event);
    if (frame !== null) this.listener?.onMotion(frame);
  };
}

export const motionMath = { deviceRotationMatrix, rotationStep };
