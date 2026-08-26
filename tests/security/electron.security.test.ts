import { describe, expect, it } from 'vitest';
import {
  CONTENT_SECURITY_POLICY,
  DEVELOPMENT_CONTENT_SECURITY_POLICY,
  isAllowedNavigation,
} from '../../apps/desktop/main/security';

describe('Electron security policy', () => {
  it('allows only the local Vite origin during development', () => {
    expect(isAllowedNavigation('http://localhost:5173/settings', true)).toBe(true);
    expect(isAllowedNavigation('http://127.0.0.1:5173/', true)).toBe(true);
    expect(isAllowedNavigation('https://example.com/', true)).toBe(false);
    expect(isAllowedNavigation('file:///tmp/index.html', true)).toBe(false);
  });

  it('allows packaged file navigation and blocks network navigation', () => {
    expect(isAllowedNavigation('file:///application/dist/index.html', false)).toBe(true);
    expect(isAllowedNavigation('https://example.com/', false)).toBe(false);
  });

  it('disables object embedding in the CSP', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain('ws://localhost:*');
    expect(CONTENT_SECURITY_POLICY).toContain('ws://127.0.0.1:*');
  });

  it('allows Vite React preamble scripts in development only', () => {
    expect(DEVELOPMENT_CONTENT_SECURITY_POLICY).toContain("script-src 'self' 'unsafe-inline'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
  });
});
