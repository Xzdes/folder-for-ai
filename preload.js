// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Проверяем, что код выполняется в основном процессе или доверенном контексте
// (Хотя contextBridge сам по себе обеспечивает изоляцию)
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
                 // Проверяем, что передается строка, перед отправкой в main
                 if (typeof folderPath === 'string' && folderPath.length > 0) {
                     return ipcRenderer.invoke('scan-folder-path', folderPath);
                 } else {
                     console.error('Preload: Invalid folderPath passed to scanFolderPath.');
                     // Возвращаем промис с ошибкой, чтобы .catch() в renderer сработал
                     return Promise.reject(new Error('Invalid folder path provided'));
                 }
            },

            // 3. Запросить содержимое выбранных файлов
            getFileContent: (filePaths) => {
                console.log(`Preload: Calling ipcRenderer.invoke("get-file-content") for ${filePaths?.length ?? 0} paths.`);
                // Проверяем, что передается массив строк
                if (Array.isArray(filePaths)) {
                     return ipcRenderer.invoke('get-file-content', filePaths);
                } else {
                    console.error('Preload: Invalid filePaths passed to getFileContent.');
                    return Promise.reject(new Error('Invalid file paths array provided'));
                }
            },

            // 4. Использовать встроенный API для буфера обмена (navigator.clipboard)
            // Он доступен в renderer благодаря contextIsolation, но безопаснее вызывать его из preload
            // Однако, для простоты и учитывая, что это не критически опасная операция,
            // можно оставить вызов navigator.clipboard.writeText прямо в renderer.js,
            // так как Content-Security-Policy это разрешает для 'self'.
            // Оставим этот метод здесь как пример, но в renderer.js используется прямой вызов navigator.
             copyToClipboard: (text) => {
                 console.log('Preload: Calling navigator.clipboard.writeText');
                 if (typeof text === 'string') {
                    return navigator.clipboard.writeText(text);
                 } else {
                    console.error('Preload: Invalid text passed to copyToClipboard.');
                    return Promise.reject(new Error('Invalid text provided for clipboard'));
                 }
             },

             // Можно добавить другие полезные функции, например:
             // - Получение информации о платформе (process.platform)
             // - Открытие URL в браузере (shell.openExternal)
             // Для этого нужно будет импортировать { shell } из 'electron'
        });
        console.log('Preload: electronAPI exposed successfully.');
    } catch (error) {
         console.error('Preload: Error exposing electronAPI:', error);
    }
} else {
     console.error('Preload: contextIsolation is disabled! electronAPI was not exposed.');
}