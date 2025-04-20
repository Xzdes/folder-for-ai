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
    },
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools(); // Раскомментируйте для отладки
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
    console.log(`IPC: [scan-folder-path] Received request for: ${folderPath}`);
    if (!folderPath || typeof folderPath !== 'string') {
        console.error('IPC: [scan-folder-path] Invalid folderPath received.');
        return { success: false, error: 'Некорректный путь к папке.' };
    }
    // Дополнительная проверка, что путь существует и это папка (дублирует performScan, но для уверенности)
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

// 3. Получение содержимого файлов с поддержкой ОТМЕНЫ
ipcMain.handle('get-file-content', async (event, filePaths) => {
  const requestStartTime = Date.now(); // Замеряем время начала
  console.log(`IPC: [get-file-content] Received request for ${filePaths?.length ?? 0} files. Start time: ${requestStartTime}`);
  if (!Array.isArray(filePaths)) {
      console.error('IPC: [get-file-content] Invalid filePaths received.');
      return { success: false, content: '', errors: [{ path: 'N/A', message: 'Invalid input' }] };
  }

  let combinedContent = '';
  const errors = [];
  const basePathForRelative = filePaths.length > 0 ? path.dirname(filePaths[0]) : __dirname;

  // --- Логика отмены ---
  let isCancelled = false;
  let cancelSignalReceivedTime = null; // Время получения сигнала
  const cancellationListener = () => {
      // Этот код выполнится, когда придет сигнал по каналу
      cancelSignalReceivedTime = Date.now();
      console.log(`IPC: [get-file-content] <<< Cancellation signal received on "${CANCEL_CONTENT_LOAD_CHANNEL}" at ${cancelSignalReceivedTime} >>> Request start time: ${requestStartTime}`);
      isCancelled = true;
      // Слушатель будет удален в finally
  };
  // Добавляем слушатель ТОЛЬКО на время выполнения этого запроса
  ipcMain.once(CANCEL_CONTENT_LOAD_CHANNEL, cancellationListener);
  console.log(`IPC: [get-file-content] Cancellation listener attached for request ${requestStartTime}.`);
  // --------------------

  try {
      console.log(`IPC: [get-file-content] Starting file processing loop for request ${requestStartTime}...`);
      for (let i = 0; i < filePaths.length; i++) {
          const filePath = filePaths[i];
          const loopIterationStartTime = Date.now();

          // --- ПРОВЕРКА ОТМЕНЫ В НАЧАЛЕ КАЖДОЙ ИТЕРАЦИИ ---
          if (isCancelled) {
              const cancelCheckTime = Date.now();
              console.log(`IPC: [get-file-content] Loop cancelled at index ${i} (Check time: ${cancelCheckTime}). Request start: ${requestStartTime}, Signal received: ${cancelSignalReceivedTime}`);
              if (!errors.some(e => e.message === 'Operation cancelled by user')) {
                   errors.push({ path: 'N/A', message: 'Operation cancelled by user' });
              }
              break; // Выход из цикла for
          }
          // -----------------------------------------------

          console.log(`IPC: [get-file-content] [Req ${requestStartTime}] Processing file ${i + 1}/${filePaths.length}: ${filePath} (Iteration start: ${loopIterationStartTime})`);

          if (!filePath || typeof filePath !== 'string') {
              console.warn(`IPC: [get-file-content] [Req ${requestStartTime}] Skipping invalid file path entry: ${filePath}`);
              errors.push({ path: String(filePath), message: 'Invalid path entry' });
              continue; // Переход к следующей итерации
          }

          const relativePath = path.relative(basePathForRelative, filePath);
          try {
               // Проверка перед fs.stat
               if (isCancelled) {
                   console.log(`IPC: [get-file-content] [Req ${requestStartTime}] Cancelled before stat for ${relativePath}`);
                   if (!errors.some(e => e.message === 'Operation cancelled by user')) { errors.push({ path: 'N/A', message: 'Operation cancelled by user' }); }
                   break;
               }
              const stats = await fs.stat(filePath);

              if (!stats.isFile()) {
                  console.warn(`IPC: [get-file-content] [Req ${requestStartTime}] ${relativePath} is not a file. Skipping.`);
                  combinedContent += `--- File: ${relativePath} ---\n[Not a File]\n--- End: ${relativePath} ---\n\n`;
                  errors.push({ path: relativePath, message: 'Not a file' });
                  continue;
              }

              if (stats.size > MAX_FILE_SIZE_BYTES) {
                   console.warn(`IPC: [get-file-content] [Req ${requestStartTime}] File too large ${relativePath} (${stats.size} bytes). Skipping content.`);
                  combinedContent += `--- File: ${relativePath} ---\n[File Too Large To Include Content (> ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)]\n--- End: ${relativePath} ---\n\n`;
                  errors.push({ path: relativePath, message: 'File too large' });
                  continue;
              }

               // Проверка перед fs.readFile
               if (isCancelled) {
                   console.log(`IPC: [get-file-content] [Req ${requestStartTime}] Cancelled before readFile for ${relativePath}`);
                   if (!errors.some(e => e.message === 'Operation cancelled by user')) { errors.push({ path: 'N/A', message: 'Operation cancelled by user' }); }
                   break;
               }
              console.log(`IPC: [get-file-content] [Req ${requestStartTime}] Reading file content for ${relativePath}...`);
              const readStartTime = Date.now();
              const content = await fs.readFile(filePath, 'utf-8'); // <--- ПОТЕНЦИАЛЬНО ДОЛГАЯ ОПЕРАЦИЯ
              const readEndTime = Date.now();
              console.log(`IPC: [get-file-content] [Req ${requestStartTime}] Finished reading ${relativePath}. Length: ${content.length}. Time: ${readEndTime - readStartTime}ms`);

              // Дополнительная проверка ПОСЛЕ чтения (на случай если сигнал пришел во время чтения)
              if (isCancelled) {
                    console.log(`IPC: [get-file-content] [Req ${requestStartTime}] Cancelled after readFile for ${relativePath}, content not appended.`);
                   if (!errors.some(e => e.message === 'Operation cancelled by user')) { errors.push({ path: 'N/A', message: 'Operation cancelled by user' }); }
                   break;
              }
              // Собираем контент только если не отменено
              combinedContent += `--- File: ${relativePath} ---\n\`\`\`text\n${content}\n\`\`\`\n--- End: ${relativePath} ---\n\n`;

          } catch (error) {
               if (isCancelled) {
                   console.log(`IPC: [get-file-content] [Req ${requestStartTime}] Cancelled during error handling for ${relativePath}.`);
                   if (!errors.some(e => e.message === 'Operation cancelled by user')) { errors.push({ path: 'N/A', message: 'Operation cancelled by user' }); }
                   break; // Выходим из цикла
               }
              console.error(`IPC: [get-file-content] [Req ${requestStartTime}] Error processing file ${relativePath}:`, error);
              combinedContent += `--- File: ${relativePath} ---\n[Error Reading File: ${error.code || error.message}]\n--- End: ${relativePath} ---\n\n`;
              errors.push({ path: relativePath, message: `Read Error: ${error.code || error.message}` });
          }
           const loopIterationEndTime = Date.now();
           console.log(`IPC: [get-file-content] [Req ${requestStartTime}] Finished iteration ${i} for ${relativePath}. Duration: ${loopIterationEndTime - loopIterationStartTime}ms`);

      } // Конец цикла for
      console.log(`IPC: [get-file-content] File processing loop finished for request ${requestStartTime}.`);
  } finally {
      // --- Гарантированное удаление слушателя отмены ---
      const listenerRemoved = ipcMain.removeListener(CANCEL_CONTENT_LOAD_CHANNEL, cancellationListener);
      console.log(`IPC: [get-file-content] Cancellation listener removed for request ${requestStartTime}. Removed: ${listenerRemoved}. Final isCancelled state: ${isCancelled}`);
      // ------------------------------------------------------
  }

  const requestEndTime = Date.now();
  console.log(`IPC: [get-file-content] Content preparation finished for request ${requestStartTime}. Cancelled: ${isCancelled}. Length: ${combinedContent.length}. Errors: ${errors.length}. Total time: ${requestEndTime - requestStartTime}ms`);
  return { success: true, content: combinedContent, errors: errors };
});

// --- Вспомогательные функции ---

// Общая функция сканирования (без изменений)
async function performScan(folderPath) {
    console.log(`SCAN: Scanning folder: ${folderPath}`); // Добавим префикс SCAN
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

// Рекурсивное сканирование директории (без изменений)
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
    // console.warn(`SCAN: Cannot read directory ${dirPath}: ${error.message}`); // Можно раскомментировать для детальной отладки прав
    node.error = error.code || error.message; node.children = null; return node;
  }
  const childPromises = [];
  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    const itemName = item.name;
    const itemIsIgnored = IGNORED_ITEMS.has(itemName);
    if (item.isDirectory()) { childPromises.push(scanDirectory(itemPath, basePath)); }
    else if (item.isFile()) { childPromises.push(Promise.resolve({ name: itemName, path: itemPath, relativePath: path.relative(basePath, itemPath), isDirectory: false, ignored: itemIsIgnored, error: null, children: undefined })); }
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