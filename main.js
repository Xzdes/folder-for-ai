// main.js
const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');

// --- Константы ---
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const IGNORED_ITEMS = new Set([
  '.git', 'node_modules', '.vscode', '.idea', '.DS_Store',
  'Thumbs.db', 'bower_components', '__pycache__',
]);

// Убираем константы для TitleBarOverlay, т.к. он больше не используется
// const TITLE_BAR_COLOR = '#1c1f26';
// const TITLE_BAR_SYMBOL_COLOR = '#e8eaf0';


let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 900,
    autoHideMenuBar: true,
    // --- Изменения для кастомной шапки ---
    frame: false, // Оставляем frame: false, т.к. рисуем свои кнопки
    // titleBarStyle: 'hidden', // Эта опция теперь не нужна, т.к. frame: false
    // --- Конец изменений ---
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // --- Убираем вызов setTitleBarOverlay ---
  // if (process.platform === 'win32') { ... }

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- Обработчики IPC ---

// 1. Выбор папки через диалог
ipcMain.handle('select-folder', async () => {
  // ... (без изменений) ...
  if (!mainWindow) return { success: false, error: 'Главное окно не найдено.' };
  console.log('IPC: [select-folder] Received request.');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Выберите корневую папку проекта'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    console.log(`IPC: [select-folder] Folder selected: ${folderPath}`);
    return await performScan(folderPath);
  } else {
    console.log('IPC: [select-folder] Selection cancelled.');
    return { success: false, error: 'Папка не выбрана' };
  }
});

// 2. Сканирование переданного пути
ipcMain.handle('scan-folder-path', async (event, folderPath) => {
    // ... (без изменений) ...
    console.log(`IPC: [scan-folder-path] Received request for: ${folderPath}`);
    if (!folderPath || typeof folderPath !== 'string') {
        console.error('IPC: [scan-folder-path] Invalid folderPath received.');
        return { success: false, error: 'Некорректный путь к папке.' };
    }
    try {
        const stats = await fs.stat(folderPath);
        if (!stats.isDirectory()) {
             console.error(`IPC: [scan-folder-path] Path is not a directory: ${folderPath}`);
             return { success: false, error: `Указанный путь не является папкой.` };
        }
    } catch (err) {
         console.error(`IPC: [scan-folder-path] Error accessing path ${folderPath}:`, err);
         return { success: false, error: `Ошибка доступа к пути: ${err.message}` };
    }
    return await performScan(folderPath);
});


// 4. Обработчик для инициации перетаскивания файлов
ipcMain.on('start-drag', (event, filePaths) => {
    // ... (без изменений, используем createFromPath с fallback на DataURL) ...
    console.log(`IPC: [start-drag] Event received. File count: ${filePaths?.length ?? 0}`);
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
        console.warn('IPC: [start-drag] Ignored: Received invalid or empty filePaths array.'); return;
    }
    const validFilePaths = filePaths.filter(p => typeof p === 'string' && p.length > 0);
    if (validFilePaths.length === 0) {
        console.warn('IPC: [start-drag] Ignored: No valid string paths found in the array.'); return;
    }
    let fileIcon;
    try {
        const iconPath = path.join(__dirname, 'assets', 'drag-icon.png');
        try {
            console.log(`IPC: [start-drag] Attempting to create NativeImage from path: ${iconPath}`);
            fileIcon = nativeImage.createFromPath(iconPath);
            if (!fileIcon || fileIcon.isEmpty()) {
                 console.error(`IPC: [start-drag] Failed to create valid NativeImage from path: ${iconPath}. Result is empty.`);
                 console.log('IPC: [start-drag] Using fallback minimal icon from Data URL.');
                 const minimalIconDataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
                 fileIcon = nativeImage.createFromDataURL(minimalIconDataURL);
                 if (fileIcon.isEmpty()) { console.error("IPC: [start-drag] CRITICAL: Failed even to create icon from Data URL! Aborting drag."); return; }
            } else {
                console.log(`IPC: [start-drag] Successfully created NativeImage from path. Size: ${fileIcon.getSize().width}x${fileIcon.getSize().height}, Empty: ${fileIcon.isEmpty()}`);
            }
        } catch (createPathError) {
             console.error(`IPC: [start-drag] Error during nativeImage.createFromPath("${iconPath}"):`, createPathError);
             console.log('IPC: [start-drag] Using fallback minimal icon from Data URL due to createFromPath error.');
             const minimalIconDataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
             fileIcon = nativeImage.createFromDataURL(minimalIconDataURL);
             if (fileIcon.isEmpty()) { console.error("IPC: [start-drag] CRITICAL: Failed even to create icon from Data URL! Aborting drag."); return; }
        }
        console.log(`IPC: [start-drag] ===> Attempting to call event.sender.startDrag with:`);
        console.log(`     Files (${validFilePaths.length}): [${validFilePaths.join(', ')}]`);
        console.log(`     Icon object created. Size: ${fileIcon.getSize().width}x${fileIcon.getSize().height}, Empty: ${fileIcon.isEmpty()}`);
        event.sender.startDrag({ files: validFilePaths, icon: fileIcon });
        console.log(`IPC: [start-drag] <=== System drag initiated successfully (call returned).`);
    } catch (error) {
         console.error('IPC: [start-drag] Failed to initiate system drag:', error);
    }
});

// 5. НОВЫЕ Обработчики для кнопок управления окном
ipcMain.on('window-close', () => {
    console.log('IPC: Received window-close request.');
    if (mainWindow) {
        mainWindow.close();
    }
});

// Обработчик для сворачивания окна
ipcMain.on('window-minimize', () => {
    console.log('IPC: Received window-minimize request.');
    if (mainWindow) {
        mainWindow.minimize();
    }
});

// Обработчик для разворачивания/восстановления окна
ipcMain.on('window-maximize', () => {
    console.log('IPC: Received window-maximize request.');
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
            console.log('IPC: Window unmaximized.');
        } else {
            mainWindow.maximize();
            console.log('IPC: Window maximized.');
        }
    }
});

console.log("<<<<< Main Process: Window control listeners are set up. >>>>>");


// --- Вспомогательные функции ---
// ... (scanDirectory и performScan без изменений) ...
async function performScan(folderPath) {
    console.log(`SCAN: Scanning folder: ${folderPath}`);
    try {
        const stats = await fs.stat(folderPath);
        if (!stats.isDirectory()) {
            console.error(`SCAN: Path is not a directory: ${folderPath}`);
            return { success: false, error: `Указанный путь не является папкой: ${folderPath}` };
        }
        const treeData = await scanDirectory(folderPath, folderPath);
        console.log(`SCAN: Scan complete for ${folderPath}.`);
        return { success: true, path: folderPath, tree: treeData };
    } catch (error) {
        let errorMessage = `Ошибка сканирования: ${error.message}`;
        if (error.code === 'ENOENT') { console.error(`SCAN: Path not found: ${folderPath}`); errorMessage = `Папка не найдена: ${folderPath}`; }
        else if (error.code === 'EACCES') { console.error(`SCAN: Permission denied: ${folderPath}`); errorMessage = `Нет прав доступа к папке: ${folderPath}`; }
        else { console.error(`SCAN: Unexpected error for ${folderPath}:`, error); }
        return { success: false, error: errorMessage };
    }
}

async function scanDirectory(dirPath, basePath) {
  const name = path.basename(dirPath);
  const isIgnored = IGNORED_ITEMS.has(name);
  const node = { name: name, path: dirPath, relativePath: path.relative(basePath, dirPath) || '.', isDirectory: true, ignored: isIgnored, children: [], error: null };
  if (isIgnored) { node.children = null; return node; }
  let items;
  try {
    await fs.access(dirPath, fs.constants.R_OK);
    items = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    node.error = error.code || error.message; node.children = null; return node;
  }
  const childPromises = [];
  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    const itemName = item.name;
    const itemIsIgnored = IGNORED_ITEMS.has(itemName);
    if (item.isDirectory()) { childPromises.push(scanDirectory(itemPath, basePath)); }
    else if (item.isFile()) {
        childPromises.push(Promise.resolve({
            name: itemName,
            path: itemPath,
            relativePath: path.relative(basePath, itemPath),
            isDirectory: false,
            ignored: itemIsIgnored,
            error: null,
            children: undefined
        }));
    }
  }
  try {
      const childrenResults = await Promise.all(childPromises);
      node.children = childrenResults;
      node.children.sort((a, b) => {
        if (a.error && !b.error) return 1; if (!a.error && b.error) return -1;
        if (a.error && b.error) return a.name.localeCompare(b.name);
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch (childError) { console.error(`SCAN: Error processing children of ${dirPath}:`, childError); node.error = `Error processing children: ${childError.message}`; node.children = []; }
  return node;
}