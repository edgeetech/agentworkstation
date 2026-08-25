import { app, BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 900, webPreferences: { preload: join(__dirname, 'preload.js') } });
  win.loadURL('http://localhost:5173');
}

app.whenReady().then(createWindow);
