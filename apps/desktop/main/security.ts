const COMMON_CSP_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
];

export const CONTENT_SECURITY_POLICY = [
  "script-src 'self'",
  ...COMMON_CSP_DIRECTIVES,
].join('; ');

export const DEVELOPMENT_CONTENT_SECURITY_POLICY = [
  "script-src 'self' 'unsafe-inline'",
  ...COMMON_CSP_DIRECTIVES,
].join('; ');

export function getContentSecurityPolicy(isDevelopment: boolean): string {
  return isDevelopment ? DEVELOPMENT_CONTENT_SECURITY_POLICY : CONTENT_SECURITY_POLICY;
}

export function isAllowedNavigation(navigationUrl: string, isDevelopment: boolean): boolean {
  let url: URL;
  try {
    url = new URL(navigationUrl);
  } catch {
    return false;
  }

  if (!isDevelopment) return url.protocol === 'file:';
  return url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}
