import { createId, type CalibrationProfile } from '../core/models';
import { BrowserMotionProvider, type MotionFrame } from './motion';

function rms(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

export class BrowserCalibrationService {
  constructor(private readonly provider = new BrowserMotionProvider()) {}

  async calibrate(durationMillis = 5_000): Promise<CalibrationProfile> {
    const permission = await this.provider.requestPermission();
    if (permission !== 'granted') {
      throw new Error(permission === 'denied' ? 'Motion access was denied.' : 'Motion sensors are unavailable.');
    }

    const frames: MotionFrame[] = [];
    const started = this.provider.start({
      onMotion: (frame) => frames.push(frame),
      onError: () => undefined
    });
    if (!started) throw new Error('Motion sensors are unavailable.');

    await new Promise<void>((resolve) => window.setTimeout(resolve, Math.min(15_000, Math.max(2_000, durationMillis))));
    this.provider.stop();
    if (frames.length < 80) throw new Error('Calibration could not collect enough stable samples.');

    const gravityX = frames.reduce((sum, frame) => sum + frame.sample.gravityX, 0) / frames.length;
    const gravityY = frames.reduce((sum, frame) => sum + frame.sample.gravityY, 0) / frames.length;
    const gravityZ = frames.reduce((sum, frame) => sum + frame.sample.gravityZ, 0) / frames.length;
    const accelerationNoise = rms(frames.map(({ sample }) => Math.hypot(
      sample.accelerationX - gravityX,
      sample.accelerationY - gravityY,
      sample.accelerationZ - gravityZ
    )));
    const gyroNoise = rms(frames.map(({ sample }) => Math.hypot(
      sample.gyroscopeX,
      sample.gyroscopeY,
      sample.gyroscopeZ
    )));
    const intervals = frames.slice(1).map((frame, index) =>
      (frame.sample.elapsedRealtimeNanos - frames[index].sample.elapsedRealtimeNanos) / 1_000_000
    ).filter((interval) => interval > 0);
    const intervalMean = intervals.length === 0
      ? 20
      : intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const intervalDeviation = rms(intervals.map((interval) => interval - intervalMean));

    return {
      id: createId(),
      createdAt: Date.now(),
      accelerometerNoiseRms: accelerationNoise,
      gyroscopeNoiseRms: gyroNoise,
      gravityX,
      gravityY,
      gravityZ,
      samplingConsistency: Math.min(1, Math.max(0, 1 - intervalDeviation / Math.max(0.001, intervalMean))),
      engineVibrationRms: accelerationNoise,
      sampleCount: frames.length,
      algorithmVersion: 2
    };
  }

  stop(): void {
    this.provider.stop();
  }
}
