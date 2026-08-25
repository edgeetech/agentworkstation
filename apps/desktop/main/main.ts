import { app, BrowserWindow } from 'electron';

function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 900, webPreferences: { preload: __dirname + '/preload.js' } });
  win.loadURL('http://localhost:5173');
}

app.whenReady().then(createWindow);

