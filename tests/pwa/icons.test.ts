// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readPngDimensions(relativePath: string): { width: number; height: number } {
  const bytes = readFileSync(resolve(process.cwd(), relativePath));
  expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('published PWA artwork', () => {
  it.each([
    ['public/favicon-32.png', 32],
    ['public/icons/apple-touch-icon.png', 180],
    ['public/icons/icon-192.png', 192],
    ['public/icons/icon-512.png', 512],
    ['public/icons/icon-maskable-512.png', 512]
  ])('%s is a valid square PNG at the declared size', (relativePath, size) => {
    expect(readPngDimensions(relativePath)).toEqual({ width: size, height: size });
  });
});
