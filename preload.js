// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// --- Канал для отмены удален ---
// const CANCEL_CONTENT_LOAD_CHANNEL = 'cancel-file-content';

// Проверяем, что код выполняется в изолированном контексте
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electronAPI', {
            // --- Функции, которые сможет вызвать renderer.js ---

            // 1. Вызвать диалог выбора папки и начать сканирование
            selectFolder: () => {
                console.log('Preload: Calling ipcRenderer.invoke("select-folder")');
                return ipcRenderer.invoke('select-folder');
            },

            // 2. Запросить сканирование папки по заданному пути
            scanFolderPath: (folderPath) => {
                 console.log(`Preload: Calling ipcRenderer.invoke("scan-folder-path", "${folderPath}")`);
                 if (typeof folderPath === 'string' && folderPath.length > 0) {
                     return ipcRenderer.invoke('scan-folder-path', folderPath);
                 } else {
                     console.error('Preload: Invalid folderPath passed to scanFolderPath.');
                     return Promise.reject(new Error('Invalid folder path provided'));
                 }
            },

            // 3. Запросить содержимое выбранных файлов (УДАЛЕНО)
            // getFileContent: (filePaths) => { ... },

            // 4. Отправить сигнал отмены в main.js (УДАЛЕНО)
            // cancelFileContentLoad: () => { ... },

            // 5. НОВАЯ функция для инициации перетаскивания файлов
            startDrag: (filePaths) => {
                 if (Array.isArray(filePaths) && filePaths.length > 0) {
                     console.log(`Preload: Sending "start-drag" event for ${filePaths.length} files.`);
                     // Используем ipcRenderer.send, так как нам не нужен ответ,
                     // а нужно просто инициировать действие в main процессе.
                     ipcRenderer.send('start-drag', filePaths);
                 } else {
                     console.warn('Preload: Invalid or empty filePaths passed to startDrag.');
                 }
            },

            // 6. Копирование в буфер обмена (оставлено для примера, но НЕ ИСПОЛЬЗУЕТСЯ в новой логике)
            // УДАЛЕНО, так как не используется и не относится к текущей задаче.
            // copyToClipboard: (text) => { ... },
        });
        console.log('Preload: electronAPI exposed successfully.');
    } catch (error) {
         console.error('Preload: Error exposing electronAPI:', error);
    }
} else {
     console.error('Preload: contextIsolation is disabled! electronAPI was not exposed.');
}