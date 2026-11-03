import { createWindow } from 'electrobun/main';

createWindow({
  width: 1200,
  height: 800,
  title: 'Act Dock',
  webPreferences: {
    nodeIntegration: true,
  },
});
