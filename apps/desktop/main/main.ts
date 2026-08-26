import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

function createWindow() {
 const win = new BrowserWindow({
   width: 1280,
   height: 900,
   webPreferences: { preload: join(__dirname, 'preload.js') },
 });
 const isDev = !app.isPackaged;
 if (isDev) {
   win.loadURL('http://localhost:5173');
 } else {
   win.loadFile(join(__dirname, '../../dist/index.html'));
 }
}

app.whenReady().then(createWindow);
