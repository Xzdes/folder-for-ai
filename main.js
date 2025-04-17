// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises'); // Используем асинхронный fs API
const fsSync = require('node:fs'); // Для быстрой проверки существования/типа

// --- Константы ---
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB Ограничение на размер файла для чтения
const IGNORED_ITEMS = new Set([ // Имена папок/файлов для игнорирования по умолчанию
  '.git',
  'node_modules',
  '.vscode',
  '.idea',
  '.DS_Store',
  'Thumbs.db',
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
      nodeIntegration: false,
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
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- Обработчики IPC ---

// Обработчик запроса на выбор папки и сканирование
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    try {
      console.log(`Scanning folder: ${folderPath}`);
      const treeData = await scanDirectory(folderPath, folderPath); // Начинаем сканирование
      console.log('Scanning complete.');
      return { success: true, path: folderPath, tree: treeData };
    } catch (error) {
      console.error('Error scanning directory:', error);
      return { success: false, error: `Ошибка сканирования: ${error.message}` };
    }
  }
  return { success: false, error: 'Папка не выбрана' };
});

// Обработчик запроса на получение содержимого выбранных файлов
ipcMain.handle('get-file-content', async (event, filePaths) => {
  console.log(`Requesting content for ${filePaths.length} files.`);
  let combinedContent = '';
  const errors = [];

  for (const filePath of filePaths) {
    try {
      // Проверка существования и типа файла перед чтением
      const stats = await fs.stat(filePath);

      if (!stats.isFile()) {
          combinedContent += `--- File: ${path.relative(path.dirname(filePaths[0] || __dirname), filePath)} ---\n`; // Относительный путь
          combinedContent += `[Not a File]\n`;
          combinedContent += `--- End: ${path.relative(path.dirname(filePaths[0] || __dirname), filePath)} ---\n\n`;
          continue;
      }

      if (stats.size > MAX_FILE_SIZE_BYTES) {
        console.warn(`File too large: ${filePath} (${stats.size} bytes)`);
        combinedContent += `--- File: ${path.relative(path.dirname(filePath), filePath)} ---\n`; // Относительный путь
        combinedContent += `[File Too Large To Include Content (> ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)]\n`;
        combinedContent += `--- End: ${path.relative(path.dirname(filePath), filePath)} ---\n\n`;
        continue;
      }

      // Используем относительный путь для вывода
      const relativePath = path.relative(path.dirname(filePaths[0] || __dirname), filePath); // Пытаемся получить корень из первого файла
      const content = await fs.readFile(filePath, 'utf-8');

      combinedContent += `--- File: ${relativePath} ---\n`;
      combinedContent += "```text\n"; // Используем text, т.к. отказались от определения языка
      combinedContent += content;
      combinedContent += "\n```\n"; // Закрывающий блок
      combinedContent += `--- End: ${relativePath} ---\n\n`; // Конечный разделитель

    } catch (error) {
      const relativePath = path.relative(path.dirname(filePaths[0] || __dirname), filePath);
      console.error(`Error reading file ${filePath}:`, error);
      combinedContent += `--- File: ${relativePath} ---\n`;
      combinedContent += `[Error Reading File: ${error.code || error.message}]\n`;
      combinedContent += `--- End: ${relativePath} ---\n\n`;
      errors.push({ path: relativePath, message: error.message });
    }
  }

  console.log(`Content prepared. Total length: ${combinedContent.length}`);
  return { success: errors.length === 0, content: combinedContent, errors: errors };
});


// --- Вспомогательные функции ---

// Рекурсивная асинхронная функция сканирования директории
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
    error: null, // Поле для ошибок доступа
  };

  if (isIgnored) {
    // Не сканируем дальше игнорируемые папки
    return node;
  }

  let items;
  try {
    items = await fs.readdir(dirPath, { withFileTypes: true }); // Сразу получаем тип
  } catch (error) {
    console.warn(`Cannot read directory ${dirPath}: ${error.message}`);
    node.error = error.message; // Записываем ошибку в узел
    return node; // Возвращаем узел с ошибкой
  }

  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    const itemName = item.name;
    const itemIsIgnored = IGNORED_ITEMS.has(itemName);

    if (item.isDirectory()) {
      // Рекурсивно сканируем подпапку
      node.children.push(await scanDirectory(itemPath, basePath));
    } else if (item.isFile()) {
      node.children.push({
        name: itemName,
        path: itemPath,
        relativePath: path.relative(basePath, itemPath),
        isDirectory: false,
        ignored: itemIsIgnored,
        error: null,
      });
    }
    // Игнорируем симлинки и другие типы для простоты
  }

   // Сортировка: сначала папки, потом файлы, всё по алфавиту
   node.children.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1; // Папки первее
    }
    return a.name.localeCompare(b.name); // Сортировка по имени
  });

  return node;
}