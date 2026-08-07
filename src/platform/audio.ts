import type { AppSettings } from '../core/models';

type AudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  const candidate = window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  return candidate ?? null;
}

/** Foreground warning output. It is deliberately unlocked only from the Start Drive gesture. */
export class WarningAudio {
  private context: AudioContext | null = null;
  private primed = false;
  private unlocked = false;

  /** Creates the media graph synchronously so a later permission prompt does not consume iOS user activation. */
  prime(): boolean {
    const Constructor = getAudioContextConstructor();
    if (Constructor === null) return false;
    try {
      this.context ??= new Constructor();
      if (!this.primed) {
        // A zero-gain pulse enters Safari's media playback state without producing a sound.
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(this.context.destination);
        oscillator.start();
        oscillator.stop(this.context.currentTime + 0.01);
        this.primed = true;
      }
      return true;
    } catch {
      return false;
    }
  }

  async unlock(): Promise<boolean> {
    if (!this.prime() || this.context === null) return false;
    try {
      await this.context.resume();
      this.unlocked = this.context.state === 'running';
      window.speechSynthesis?.getVoices();
      return this.unlocked;
    } catch {
      this.unlocked = false;
      return false;
    }
  }

  async resume(): Promise<void> {
    if (this.context?.state === 'suspended') {
      try {
        await this.context.resume();
        this.unlocked = this.contextIsRunning();
      } catch {
        this.unlocked = false;
      }
    }
  }

  warnSpeedBump(distanceMetres: number, phase: 'EARLY' | 'MAIN' | 'IMMEDIATE', settings: AppSettings): void {
    if (!settings.warningsEnabled) return;
    const text = this.warningText(distanceMetres, phase, settings.metricUnits);
    this.deliver(text, settings);
  }

  announce(text: string, settings: AppSettings): void {
    if (!settings.warningsEnabled) return;
    this.deliver(text, settings);
  }

  release(): void {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // Speech output is best-effort and must not block shutdown.
    }
    if (this.context !== null) void this.context.close().catch(() => undefined);
    this.context = null;
    this.primed = false;
    this.unlocked = false;
  }

  private warningText(distanceMetres: number, phase: 'EARLY' | 'MAIN' | 'IMMEDIATE', metric: boolean): string {
    if (phase === 'MAIN' && distanceMetres >= 55 && distanceMetres <= 220) {
      if (metric) {
        const rounded = Math.max(10, Math.floor(distanceMetres / 10) * 10);
        return `Speed bump in ${rounded} metres.`;
      }
      const feet = distanceMetres * 3.2808399;
      const rounded = Math.max(25, Math.floor(feet / 25) * 25);
      return `Speed bump in ${rounded} feet.`;
    }
    return 'Speed bump ahead.';
  }

  private deliver(text: string, settings: AppSettings): void {
    let voiceDelivered = false;
    if (
      settings.voiceEnabled &&
      'speechSynthesis' in window &&
      typeof SpeechSynthesisUtterance !== 'undefined'
    ) {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = document.documentElement.lang || navigator.language || 'en-GB';
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        voiceDelivered = true;
      } catch {
        voiceDelivered = false;
      }
    }
    if (!voiceDelivered && settings.toneEnabled) {
      this.beep();
    }

    if (settings.vibrationEnabled && 'vibrate' in navigator) {
      try {
        navigator.vibrate([120, 80, 180]);
      } catch {
        // Vibration is unsupported on iPhone Safari and remains optional elsewhere.
      }
    }
  }

  private beep(): void {
    if (!this.unlocked || this.context === null || this.context.state === 'closed') return;
    try {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const now = this.context.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(760, now);
      oscillator.frequency.exponentialRampToValueAtTime(620, now + 0.35);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.36);
    } catch {
      // A transient Web Audio failure must not interrupt detection or persistence.
    }
  }

  private contextIsRunning(): boolean {
    return this.context?.state === 'running';
  }
}
