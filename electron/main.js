const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

let mainWindow;
let tray;
let backendProcess;

const isDev = !app.isPackaged;

function getDataDir() {
  if (isDev) {
    return path.join(__dirname, '..');
  }
  // 打包后：数据放在 exe 同级目录下
  return path.dirname(app.getPath('exe'));
}

function getBackendPath() {
  if (isDev) {
    return path.join(__dirname, '../backend/src/index.js');
  }
  // In production, backend is inside asar (or unpacked)
  const asarUnpacked = path.join(process.resourcesPath, 'app.asar.unpacked/backend/src/index.js');
  const asarPath = path.join(process.resourcesPath, 'app.asar/backend/src/index.js');
  return require('fs').existsSync(asarUnpacked) ? asarUnpacked : asarPath;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 920,
    minHeight: 600,
    title: 'FastMinecraft',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#00000000',
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    hasShadow: true,
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  const indexPath = isDev
    ? path.join(__dirname, '../frontend/dist/index.html')
    : path.join(__dirname, 'frontend/dist/index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        mainWindow.show();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        stopBackend();
        app.quit();
      }
    }
  ]);

  tray.setToolTip('FastMinecraft');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.show();
  });
}

function startBackend() {
  const backendPath = getBackendPath();
  const dataDir = getDataDir();

  console.log('Starting backend:', backendPath);
  console.log('Data directory:', dataDir);

  backendProcess = fork(backendPath, [dataDir], {
    cwd: dataDir,
    env: {
      ...process.env,
      PORT: '3001',
      FM_DATA_DIR: dataDir
    },
    stdio: 'pipe'
  });

  // Write backend logs to file so user can view them
  const logFile = path.join(dataDir, 'fm-backend.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  function writeLog(level, data) {
    const timestamp = new Date().toISOString();
    const text = `[${timestamp}] [${level}] ${data.toString().trim()}\n`;
    logStream.write(text);
    console.log(`Backend ${level}: ${data}`);
  }

  backendProcess.stdout?.on('data', (data) => { writeLog('INFO', data); });
  backendProcess.stderr?.on('data', (data) => { writeLog('ERR', data); });

  backendProcess.on('exit', (code) => {
    writeLog('INFO', `Backend exited with code ${code}`);
    logStream.end();
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function waitForBackend(retries = 30, interval = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const http = require('http');
      const req = http.get('http://localhost:3001/api/servers', (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (attempts >= retries) {
          reject(new Error('Backend failed to start after ' + retries + ' attempts'));
        } else {
          setTimeout(check, interval);
        }
      });
      req.setTimeout(1000, () => {
        req.destroy();
        if (attempts >= retries) {
          reject(new Error('Backend failed to start after ' + retries + ' attempts'));
        } else {
          setTimeout(check, interval);
        }
      });
    };
    check();
  });
}

app.whenReady().then(async () => {
  app.setName('FastMinecraft');
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    app.dock.setIcon(dockIcon);
  }
  startBackend();

  try {
    await waitForBackend();
    console.log('Backend is ready');
  } catch (err) {
    console.error(err.message);
  }

  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.isQuitting = true;
    stopBackend();
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopBackend();
});
