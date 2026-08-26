export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' http://localhost:* http://127.0.0.1:*",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

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
