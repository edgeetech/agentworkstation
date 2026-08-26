import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';
import { CONTENT_SECURITY_POLICY, isAllowedNavigation } from './security';

function createWindow(): void {
  const isDev = !app.isPackaged;
  const preloadPath = join(__dirname, '../preload/preload.js');
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Restrict navigation to local origins only
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedNavigation(navigationUrl, isDev)) {
      event.preventDefault();
    }
  });

  // Block new windows from renderer
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (isDev) {
    void win.loadURL('http://localhost:5173');
  } else {
    void win.loadFile(join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
