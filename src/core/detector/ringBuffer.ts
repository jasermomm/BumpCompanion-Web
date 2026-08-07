export class BoundedRingBuffer<T> {
  readonly capacity: number;
  private readonly values: T[] = [];

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError('capacity must be a positive integer');
    this.capacity = capacity;
  }

  get size(): number {
    return this.values.length;
  }

  isEmpty(): boolean {
    return this.values.length === 0;
  }

  add(item: T): void {
    if (this.values.length === this.capacity) this.values.shift();
    this.values.push(item);
  }

  clear(): void {
    this.values.length = 0;
  }

  toArray(): T[] {
    return [...this.values];
  }

  lastOrUndefined(): T | undefined {
    return this.values.at(-1);
  }

  firstOrUndefined(): T | undefined {
    return this.values[0];
  }

  filter(predicate: (item: T) => boolean): T[] {
    return this.values.filter(predicate);
  }
}
