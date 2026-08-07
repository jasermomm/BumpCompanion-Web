// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('service worker registration', () => {
  it('uses the generated register module and keeps failure non-fatal', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pwa.ts'), 'utf8');

    expect(source).toContain("from 'virtual:pwa-register'");
    expect(source).toContain('registerSW({');
    expect(source).toContain('immediate: true');
    expect(source).toMatch(/onRegisterError:\s*\(\)\s*=>\s*\{/);
    expect(source).not.toContain('console.');
  });
});
