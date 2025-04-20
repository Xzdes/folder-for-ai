// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises'); // Используем асинхронный fs API
// const fsSync = require('node:fs'); // fsSync больше не используется явно, можно убрать или оставить

// --- Константы ---
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB Ограничение на размер файла для чтения
const IGNORED_ITEMS = new Set([ // Имена папок/файлов для игнорирования по умолчанию
  '.git',
  'node_modules',
  '.vscode',
  '.idea',
  '.DS_Store',
  'Thumbs.db',
  'bower_components', // Добавим еще одно распространенное
  '__pycache__',      // Для Python
  // Добавьте сюда другие, если нужно
]);

let mainWindow; // Ссылка на главное окно

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000, // Сделаем окно пошире
    height: 850,
    autoHideMenuBar: true, //скрыть меню верхнее
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false, // Безопасность: оставляем false
      // nodeIntegrationInWorker: false, // Если бы использовали Worker Threads
      // sandbox: true, // Можно включить для доп. безопасности, но может потребовать доработки preload
    },
  });

  mainWindow.loadFile('index.html');

  // Открыть DevTools для отладки (раскомментируйте, если нужно)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null; // Освободить память
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // На macOS принято создавать окно при клике на иконку в доке, если нет открытых окон
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Выход из приложения, если это не macOS
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- Обработчики IPC ---

// 1. Обработчик запроса на ВЫБОР папки через диалог и сканирование
ipcMain.handle('select-folder', async () => {
  if (!mainWindow) {
      return { success: false, error: 'Главное окно не найдено.' };
  }
  console.log('IPC: Received select-folder request.');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Выберите корневую папку проекта' // Уточним заголовок
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    console.log(`IPC: Folder selected via dialog: ${folderPath}`);
    // Используем новую общую функцию для сканирования
    return await performScan(folderPath);
  } else {
     console.log('IPC: Folder selection cancelled or no path received.');
     return { success: false, error: 'Папка не выбрана' };
  }
});

// 2. НОВЫЙ Обработчик для сканирования ПЕРЕДАННОГО пути (для D&D и "Загрузить последнюю")
ipcMain.handle('scan-folder-path', async (event, folderPath) => {
    console.log(`IPC: Received scan-folder-path request for: ${folderPath}`);
    if (!folderPath || typeof folderPath !== 'string') {
        console.error('IPC: Invalid folderPath received.');
        return { success: false, error: 'Некорректный путь к папке.' };
    }
    // Используем новую общую функцию для сканирования
    return await performScan(folderPath);
});


// 3. Обработчик запроса на получение содержимого выбранных файлов (без изменений логики)
ipcMain.handle('get-file-content', async (event, filePaths) => {
  console.log(`IPC: Received get-file-content request for ${filePaths?.length ?? 0} files.`);
  if (!Array.isArray(filePaths)) {
      console.error('IPC: Invalid filePaths received for get-file-content.');
      return { success: false, content: '', errors: [{ path: 'N/A', message: 'Invalid input' }] };
  }

  let combinedContent = '';
  const errors = [];
  // Определение базового пути для относительных путей (как и раньше)
  const basePathForRelative = filePaths.length > 0 ? path.dirname(filePaths[0]) : __dirname;

  for (const filePath of filePaths) {
    // Проверка, что путь к файлу валиден перед попыткой чтения
    if (!filePath || typeof filePath !== 'string') {
        console.warn(`IPC: Skipping invalid file path entry: ${filePath}`);
        errors.push({ path: String(filePath), message: 'Invalid path entry' });
        continue;
    }

    const relativePath = path.relative(basePathForRelative, filePath);
    try {
      const stats = await fs.stat(filePath);

      if (!stats.isFile()) {
          combinedContent += `--- File: ${relativePath} ---\n`;
          combinedContent += `[Not a File]\n`;
          combinedContent += `--- End: ${relativePath} ---\n\n`;
          console.warn(`IPC: Skipping non-file item: ${filePath}`);
          errors.push({ path: relativePath, message: 'Not a file' });
          continue;
      }

      if (stats.size > MAX_FILE_SIZE_BYTES) {
        console.warn(`IPC: File too large: ${filePath} (${stats.size} bytes)`);
        combinedContent += `--- File: ${relativePath} ---\n`;
        combinedContent += `[File Too Large To Include Content (> ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)]\n`;
        combinedContent += `--- End: ${relativePath} ---\n\n`;
        errors.push({ path: relativePath, message: 'File too large' });
        continue;
      }

      const content = await fs.readFile(filePath, 'utf-8');
      combinedContent += `--- File: ${relativePath} ---\n`;
      combinedContent += "```text\n";
      combinedContent += content;
      combinedContent += "\n```\n";
      combinedContent += `--- End: ${relativePath} ---\n\n`;

    } catch (error) {
      console.error(`IPC: Error reading file ${filePath}:`, error);
      combinedContent += `--- File: ${relativePath} ---\n`;
      combinedContent += `[Error Reading File: ${error.code || error.message}]\n`;
      combinedContent += `--- End: ${relativePath} ---\n\n`;
      errors.push({ path: relativePath, message: `Read Error: ${error.code || error.message}` });
    }
  }

  console.log(`IPC: Content prepared. Length: ${combinedContent.length}. Errors: ${errors.length}`);
  // Возвращаем success: true даже при наличии ошибок чтения, но передаем ошибки
  return { success: true, content: combinedContent, errors: errors };
});


// --- Вспомогательные функции ---

// НОВАЯ общая функция для выполнения сканирования папки по заданному пути
async function performScan(folderPath) {
    console.log(`Scanning folder: ${folderPath}`);
    try {
        // 1. Проверка существования пути и является ли он директорией
        const stats = await fs.stat(folderPath);
        if (!stats.isDirectory()) {
            console.error(`Scan Error: Path is not a directory: ${folderPath}`);
            return { success: false, error: `Указанный путь не является папкой: ${folderPath}` };
        }

        // 2. Выполняем рекурсивное сканирование
        const treeData = await scanDirectory(folderPath, folderPath); // Используем путь как базу для относительных путей
        console.log('Scan complete.');
        return { success: true, path: folderPath, tree: treeData };

    } catch (error) {
        // Обработка ошибок доступа или если путь не найден
        if (error.code === 'ENOENT') {
             console.error(`Scan Error: Path not found: ${folderPath}`);
             return { success: false, error: `Папка не найдена: ${folderPath}` };
        } else if (error.code === 'EACCES') {
             console.error(`Scan Error: Permission denied: ${folderPath}`);
             return { success: false, error: `Нет прав доступа к папке: ${folderPath}` };
        } else {
             console.error('Scan Error: Unexpected error during scan:', error);
             return { success: false, error: `Ошибка сканирования: ${error.message}` };
        }
    }
}


// Рекурсивная асинхронная функция сканирования директории (логика без изменений)
// Предположение: Глубина рекурсии файловой системы не достигнет лимитов Node.js в типичных случаях.
async function scanDirectory(dirPath, basePath) {
  const name = path.basename(dirPath);
  const isIgnored = IGNORED_ITEMS.has(name);
  const node = {
    name: name,
    path: dirPath,
    relativePath: path.relative(basePath, dirPath) || '.', // Относительный путь от корня
    isDirectory: true,
    ignored: isIgnored,
    children: [],
    error: null,
  };

  if (isIgnored) {
    node.children = null; // Явно указываем, что детей нет (не сканировали)
    return node;
  }

  let items;
  try {
    // Проверяем права доступа перед чтением директории
    await fs.access(dirPath, fs.constants.R_OK);
    items = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    console.warn(`Cannot read directory ${dirPath}: ${error.message}`);
    node.error = error.code || error.message; // Записываем код или сообщение ошибки
    node.children = null; // Указываем, что детей нет из-за ошибки
    return node;
  }

  const childPromises = [];
  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    const itemName = item.name;
    const itemIsIgnored = IGNORED_ITEMS.has(itemName);

    // Пропускаем скрытые файлы/папки, если не разрешено иное (пока всегда пропускаем)
    // Можно добавить опцию для включения скрытых
    // if (itemName.startsWith('.') && !allowHidden) continue;

    if (item.isDirectory()) {
      childPromises.push(scanDirectory(itemPath, basePath)); // Рекурсивный вызов (промис)
    } else if (item.isFile()) {
      childPromises.push(Promise.resolve({ // Создаем готовый промис для файла
        name: itemName,
        path: itemPath,
        relativePath: path.relative(basePath, itemPath),
        isDirectory: false,
        ignored: itemIsIgnored,
        error: null,
        children: undefined // У файлов нет детей
      }));
    }
    // Игнорируем симлинки и другие типы для простоты
  }

  // Дожидаемся завершения всех операций с дочерними элементами
  try {
      const childrenResults = await Promise.all(childPromises);
      node.children = childrenResults;

       // Сортировка: сначала папки, потом файлы, всё по алфавиту + ошибки в конец
       node.children.sort((a, b) => {
        if (a.error && !b.error) return 1;
        if (!a.error && b.error) return -1;
        if (a.error && b.error) return a.name.localeCompare(b.name); // Ошибки по имени
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1; // Папки первее
        return a.name.localeCompare(b.name); // По имени
      });

  } catch (childError) {
      // Эта ошибка маловероятна с Promise.all, но на всякий случай
      console.error(`Error processing children of ${dirPath}:`, childError);
      node.error = `Error processing children: ${childError.message}`;
      node.children = []; // Оставляем пустым списком детей в случае ошибки Promise.all
  }

  return node;
}