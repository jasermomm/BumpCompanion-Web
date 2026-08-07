export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function normalized(value: number, low: number, high: number): number {
  if (high <= low) return value >= high ? 1 : 0;
  return clamp((value - low) / (high - low), 0, 1);
}

export function gaussianScore(value: number, centre: number, spread: number): number {
  if (spread <= 0) return 0;
  const z = (value - centre) / spread;
  return clamp(Math.exp(-0.5 * z * z), 0, 1);
}

export function square(value: number): number {
  return value * value;
}
