// preload.js
const { contextBridge, ipcRenderer } = require('electron');

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

            // 3. Инициировать перетаскивание файлов
            startDrag: (filePaths) => {
                 if (Array.isArray(filePaths) && filePaths.length > 0) {
                     console.log(`Preload: Sending "start-drag" event for ${filePaths.length} files.`);
                     ipcRenderer.send('start-drag', filePaths);
                 } else {
                     console.warn('Preload: Invalid or empty filePaths passed to startDrag.');
                 }
            },

            // 4. НОВАЯ функция для закрытия окна
            windowClose: () => {
                console.log('Preload: Sending "window-close" event.');
                ipcRenderer.send('window-close');
            },

            // Сюда можно будет добавить windowMinimize, windowMaximize
            windowMinimize: () => { 
                console.log('Preload: Sending "window-minimize" event.');
                ipcRenderer.send('window-minimize'); 
            },
            windowMaximize: () => { 
                console.log('Preload: Sending "window-maximize" event.');
                ipcRenderer.send('window-maximize'); 
            },

        });
        console.log('Preload: electronAPI exposed successfully.');
    } catch (error) {
         console.error('Preload: Error exposing electronAPI:', error);
    }
} else {
     console.error('Preload: contextIsolation is disabled! electronAPI was not exposed.');
}