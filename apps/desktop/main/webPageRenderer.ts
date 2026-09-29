import { BrowserWindow, session, type Session } from 'electron';
import { isBlockedHostname, type PageRenderer } from '../../../src/infrastructure/network/webReadTool';

const RENDER_TIMEOUT_MS = 25_000;
const SETTLE_POLL_MS = 500;
const MIN_TEXT_CHARACTERS = 400;
const CHALLENGE_TITLE = /just a moment|attention required|checking your browser/i;

let isolatedSession: Session | undefined;

// A throwaway, in-memory browser profile: no cookies from the app, no permissions,
// no downloads, and no requests to local or private hosts.
function readerSession(): Session {
  if (isolatedSession) return isolatedSession;
  const ses = session.fromPartition('aw-web-read');
  ses.setUserAgent(ses.getUserAgent().replace(/\s*(Electron|agentworkstation)\/\S+/gi, ''));
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
  ses.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url);
      const allowedScheme = url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'data:' || url.protocol === 'blob:';
      callback({ cancel: !allowedScheme || ((url.protocol === 'https:' || url.protocol === 'http:') && isBlockedHostname(url.hostname)) });
    } catch {
      callback({ cancel: true });
    }
  });
  isolatedSession = ses;
  return ses;
}

const EXTRACT_SCRIPT = `(() => {
  const root = document.querySelector('article') || document.querySelector('main') || document.body;
  return { title: document.title, text: root ? root.innerText : '' };
})()`;

export const renderPublicPage: PageRenderer = async (url, signal) => {
  signal.throwIfAborted();
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      session: readerSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      images: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.setAudioMuted(true);
  const abort = (): void => { if (!win.isDestroyed()) win.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      win.loadURL(url.toString()),
      new Promise((_, reject) => { loadTimer = setTimeout(() => reject(new Error('web.read page render timed out')), RENDER_TIMEOUT_MS); }),
    ]).catch((error: unknown) => {
      // Pages that keep loading subresources can reject loadURL after the document is usable.
      if (win.isDestroyed() || win.webContents.getURL() === '') throw error;
    });
    clearTimeout(loadTimer);
    let page = { title: '', text: '' };
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      page = await win.webContents.executeJavaScript(EXTRACT_SCRIPT) as { title: string; text: string };
      if (page.text.trim().length >= MIN_TEXT_CHARACTERS && !CHALLENGE_TITLE.test(page.title)) break;
      await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
    }
    if (CHALLENGE_TITLE.test(page.title)) throw new Error('web.read was blocked by the site\'s bot check');
    return { url: win.webContents.getURL(), ...(page.title ? { title: page.title } : {}), text: page.text };
  } finally {
    clearTimeout(loadTimer);
    signal.removeEventListener('abort', abort);
    abort();
  }
};
