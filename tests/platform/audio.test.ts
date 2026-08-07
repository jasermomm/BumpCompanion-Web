import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/core/models';
import { WarningAudio } from '../../src/platform/audio';

interface FakeOscillator {
  type: OscillatorType;
  frequency: {
    setValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

interface FakeGain {
  gain: {
    value: number;
    setValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 2;
  destination = {};
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });
  readonly close = vi.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createOscillator(): FakeOscillator {
    const oscillator = {
      type: 'sine' as OscillatorType,
      frequency: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn()
      },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn()
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain(): FakeGain {
    const gain = {
      gain: {
        value: 1,
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn()
      },
      connect: vi.fn()
    };
    this.gains.push(gain);
    return gain;
  }
}

class FakeUtterance {
  lang = '';
  constructor(readonly text: string) {}
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function installAudio(): void {
  FakeAudioContext.instances = [];
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    value: FakeAudioContext
  });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: FakeUtterance
  });
}

interface SpeechHarness {
  speech: SpeechSynthesis;
  speakMock: ReturnType<typeof vi.fn>;
  cancelMock: ReturnType<typeof vi.fn>;
}

function installSpeech(speakMock = vi.fn()): SpeechHarness {
  const cancelMock = vi.fn();
  const speech = {
    cancel: cancelMock,
    speak: speakMock,
    getVoices: vi.fn(() => [])
  } as unknown as SpeechSynthesis;
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: speech
  });
  return { speech, speakMock, cancelMock };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'AudioContext');
  Reflect.deleteProperty(window, 'webkitAudioContext');
  Reflect.deleteProperty(window, 'speechSynthesis');
  Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance');
  Reflect.deleteProperty(navigator, 'vibrate');
  FakeAudioContext.instances = [];
});

describe('WarningAudio', () => {
  it('primes once from the user gesture and unlocks after permission prompts', async () => {
    installAudio();
    installSpeech();
    const audio = new WarningAudio();

    expect(audio.prime()).toBe(true);
    expect(audio.prime()).toBe(true);
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(1);
    await expect(audio.unlock()).resolves.toBe(true);
    expect(FakeAudioContext.instances[0].resume).toHaveBeenCalledOnce();
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(1);
  });

  it('prefers speech over tone and formats the main warning distance', async () => {
    installAudio();
    const { speakMock } = installSpeech();
    const audio = new WarningAudio();
    audio.prime();
    await audio.unlock();
    const context = FakeAudioContext.instances[0];
    const oscillatorCount = context.oscillators.length;

    audio.warnSpeedBump(123, 'MAIN', settings());

    expect(speakMock).toHaveBeenCalledOnce();
    expect(speakMock).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Speed bump in 120 metres.'
    }));
    expect(context.oscillators).toHaveLength(oscillatorCount);
  });

  it('falls back to the 350 ms tone when speech delivery fails', async () => {
    installAudio();
    installSpeech(vi.fn(() => { throw new Error('speech unavailable'); }));
    const audio = new WarningAudio();
    audio.prime();
    await audio.unlock();
    const context = FakeAudioContext.instances[0];
    const oscillatorCount = context.oscillators.length;

    expect(() => audio.warnSpeedBump(20, 'IMMEDIATE', settings())).not.toThrow();
    expect(context.oscillators).toHaveLength(oscillatorCount + 1);
    const warningOscillator = context.oscillators.at(-1)!;
    expect(warningOscillator.stop).toHaveBeenCalledWith(context.currentTime + 0.36);
    expect(warningOscillator.frequency.exponentialRampToValueAtTime)
      .toHaveBeenCalledWith(620, context.currentTime + 0.35);
  });

  it('keeps vibration optional and never lets it break an alert', async () => {
    installAudio();
    installSpeech();
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: vi.fn(() => { throw new Error('not supported'); })
    });
    const audio = new WarningAudio();
    audio.prime();
    await audio.unlock();

    expect(() => audio.announce('Ready.', settings())).not.toThrow();
  });

  it('does nothing when warnings are disabled and tolerates absent Web Audio', async () => {
    const { speakMock } = installSpeech();
    const audio = new WarningAudio();
    expect(audio.prime()).toBe(false);
    await expect(audio.unlock()).resolves.toBe(false);
    expect(() => audio.announce('Hidden', settings({ warningsEnabled: false }))).not.toThrow();
    expect(speakMock).not.toHaveBeenCalled();
  });

  it('releases speech and the audio context for a clean session end', async () => {
    installAudio();
    const { cancelMock } = installSpeech();
    const audio = new WarningAudio();
    audio.prime();
    await audio.unlock();
    const context = FakeAudioContext.instances[0];

    audio.release();
    await Promise.resolve();
    expect(cancelMock).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
  });
});
