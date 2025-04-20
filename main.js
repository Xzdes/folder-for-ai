// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

// --- Константы ---
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const IGNORED_ITEMS = new Set([
  '.git', 'node_modules', '.vscode', '.idea', '.DS_Store',
  'Thumbs.db', 'bower_components', '__pycache__',
]);
// Канал для получения сигнала отмены от preload.js
const CANCEL_CONTENT_LOAD_CHANNEL = 'cancel-file-content';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 850,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: true, // Можно включить для доп. безопасности
    },
  });

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
  if (!mainWindow) return { success: false, error: 'Главное окно не найдено.' };
  console.log('IPC: Received select-folder request.');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Выберите корневую папку проекта'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    console.log(`IPC: Folder selected via dialog: ${folderPath}`);
    return await performScan(folderPath);
  } else {
    console.log('IPC: Folder selection cancelled.');
    return { success: false, error: 'Папка не выбрана' };
  }
});

// 2. Сканирование переданного пути
ipcMain.handle('scan-folder-path', async (event, folderPath) => {
    console.log(`IPC: Received scan-folder-path request for: ${folderPath}`);
    if (!folderPath || typeof folderPath !== 'string') {
        console.error('IPC: Invalid folderPath received.');
        return { success: false, error: 'Некорректный путь к папке.' };
    }
    return await performScan(folderPath);
});

// 3. Получение содержимого файлов с поддержкой ОТМЕНЫ
ipcMain.handle('get-file-content', async (event, filePaths) => {
  console.log(`IPC: Received get-file-content request for ${filePaths?.length ?? 0} files.`);
  if (!Array.isArray(filePaths)) {
      console.error('IPC: Invalid filePaths received for get-file-content.');
      return { success: false, content: '', errors: [{ path: 'N/A', message: 'Invalid input' }] };
  }

  let combinedContent = '';
  const errors = [];
  const basePathForRelative = filePaths.length > 0 ? path.dirname(filePaths[0]) : __dirname;

  // --- Логика отмены ---
  let isCancelled = false; // Флаг отмены для текущего запроса
  const cancellationListener = () => {
      console.log(`IPC: Received cancellation signal on channel "${CANCEL_CONTENT_LOAD_CHANNEL}" during file read.`);
      isCancelled = true;
      // Удаляем слушатель СРАЗУ после срабатывания, чтобы он не повлиял на следующие запросы
      ipcMain.removeListener(CANCEL_CONTENT_LOAD_CHANNEL, cancellationListener);
  };
  // Добавляем слушатель ТОЛЬКО на время выполнения этого запроса
  ipcMain.once(CANCEL_CONTENT_LOAD_CHANNEL, cancellationListener);
  // --------------------

  try {
      for (const filePath of filePaths) {
          // --- Проверка флага отмены перед обработкой каждого файла ---
          if (isCancelled) {
              console.log('IPC: File reading loop cancelled.');
              // Добавляем информацию об отмене в ошибки, если нужно информировать пользователя
              errors.push({ path: 'N/A', message: 'Operation cancelled by user' });
              break; // Выход из цикла for...of
          }
          // -----------------------------------------------------------

          if (!filePath || typeof filePath !== 'string') {
              console.warn(`IPC: Skipping invalid file path entry: ${filePath}`);
              errors.push({ path: String(filePath), message: 'Invalid path entry' });
              continue;
          }

          const relativePath = path.relative(basePathForRelative, filePath);
          try {
              // --- Проверка флага отмены перед fs.stat ---
              if (isCancelled) {
                 console.log('IPC: File reading loop cancelled before stat.');
                 errors.push({ path: 'N/A', message: 'Operation cancelled by user' });
                 break;
              }
              const stats = await fs.stat(filePath);

              if (!stats.isFile()) {
                  combinedContent += `--- File: ${relativePath} ---\n[Not a File]\n--- End: ${relativePath} ---\n\n`;
                  errors.push({ path: relativePath, message: 'Not a file' });
                  continue;
              }

              if (stats.size > MAX_FILE_SIZE_BYTES) {
                  combinedContent += `--- File: ${relativePath} ---\n[File Too Large To Include Content (> ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)]\n--- End: ${relativePath} ---\n\n`;
                  errors.push({ path: relativePath, message: 'File too large' });
                  continue;
              }

              // --- Проверка флага отмены перед fs.readFile ---
              // Особенно важно перед долгими операциями
              if (isCancelled) {
                 console.log('IPC: File reading loop cancelled before readFile.');
                 errors.push({ path: 'N/A', message: 'Operation cancelled by user' });
                 break;
              }
              const content = await fs.readFile(filePath, 'utf-8');

              // Собираем контент только если не отменено
              combinedContent += `--- File: ${relativePath} ---\n\`\`\`text\n${content}\n\`\`\`\n--- End: ${relativePath} ---\n\n`;

          } catch (error) {
              // Проверяем, не отменена ли операция, прежде чем записывать ошибку чтения
               if (isCancelled) {
                   console.log('IPC: File reading loop cancelled during error handling.');
                   // Если отмена произошла во время ошибки, можно не добавлять ошибку чтения
                   if (!errors.some(e => e.message === 'Operation cancelled by user')) {
                       errors.push({ path: 'N/A', message: 'Operation cancelled by user' });
                   }
                   break; // Выходим из цикла
               }
              // Если не отменено, записываем ошибку чтения
              console.error(`IPC: Error reading file ${filePath}:`, error);
              combinedContent += `--- File: ${relativePath} ---\n[Error Reading File: ${error.code || error.message}]\n--- End: ${relativePath} ---\n\n`;
              errors.push({ path: relativePath, message: `Read Error: ${error.code || error.message}` });
          }
      } // Конец цикла for...of
  } finally {
      // --- Важно: Удаляем слушатель отмены в любом случае ---
      // Это предотвратит утечки памяти и ложные срабатывания для будущих запросов,
      // если сигнал отмены не пришел или был обработан ранее.
      ipcMain.removeListener(CANCEL_CONTENT_LOAD_CHANNEL, cancellationListener);
      console.log('IPC: Cancellation listener removed.');
      // ------------------------------------------------------
  }

  console.log(`IPC: Content preparation finished. Cancelled: ${isCancelled}. Length: ${combinedContent.length}. Errors: ${errors.length}`);
  // Возвращаем результат. Если была отмена, combinedContent будет неполным.
  // Флаг isCancelled сам по себе не возвращается, но renderer его уже знает.
  return { success: true, content: combinedContent, errors: errors };
});

// --- Вспомогательные функции ---

// Общая функция сканирования (без изменений)
async function performScan(folderPath) {
    console.log(`Scanning folder: ${folderPath}`);
    try {
        const stats = await fs.stat(folderPath);
        if (!stats.isDirectory()) {
            console.error(`Scan Error: Path is not a directory: ${folderPath}`);
            return { success: false, error: `Указанный путь не является папкой: ${folderPath}` };
        }
        const treeData = await scanDirectory(folderPath, folderPath);
        console.log('Scan complete.');
        return { success: true, path: folderPath, tree: treeData };
    } catch (error) {
        if (error.code === 'ENOENT') {
             console.error(`Scan Error: Path not found: ${folderPath}`);
             return { success: false, error: `Папка не найдена: ${folderPath}` };
        } else if (error.code === 'EACCES') {
             console.error(`Scan Error: Permission denied: ${folderPath}`);
             return { success: false, error: `Нет прав доступа к папке: ${folderPath}` };
        } else {
             console.error('Scan Error: Unexpected error:', error);
             return { success: false, error: `Ошибка сканирования: ${error.message}` };
        }
    }
}

// Рекурсивное сканирование директории (без изменений)
async function scanDirectory(dirPath, basePath) {
  const name = path.basename(dirPath);
  const isIgnored = IGNORED_ITEMS.has(name);
  const node = {
    name: name, path: dirPath, relativePath: path.relative(basePath, dirPath) || '.',
    isDirectory: true, ignored: isIgnored, children: [], error: null,
  };

  if (isIgnored) { node.children = null; return node; }

  let items;
  try {
    await fs.access(dirPath, fs.constants.R_OK);
    items = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    console.warn(`Cannot read directory ${dirPath}: ${error.message}`);
    node.error = error.code || error.message;
    node.children = null;
    return node;
  }

  const childPromises = [];
  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    const itemName = item.name;
    const itemIsIgnored = IGNORED_ITEMS.has(itemName);
    if (item.isDirectory()) {
      childPromises.push(scanDirectory(itemPath, basePath));
    } else if (item.isFile()) {
      childPromises.push(Promise.resolve({
        name: itemName, path: itemPath, relativePath: path.relative(basePath, itemPath),
        isDirectory: false, ignored: itemIsIgnored, error: null, children: undefined
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
  } catch (childError) {
      console.error(`Error processing children of ${dirPath}:`, childError);
      node.error = `Error processing children: ${childError.message}`;
      node.children = [];
  }
  return node;
}