// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Канал для отправки сигнала отмены загрузки контента
const CANCEL_CONTENT_LOAD_CHANNEL = 'cancel-file-content';

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

            // 3. Запросить содержимое выбранных файлов
            // Сигнал отмены (AbortSignal) не передается через invoke напрямую.
            // Вместо этого используем отдельный канал 'cancel-file-content'.
            getFileContent: (filePaths) => {
                console.log(`Preload: Calling ipcRenderer.invoke("get-file-content") for ${filePaths?.length ?? 0} paths.`);
                if (Array.isArray(filePaths)) {
                     // Просто передаем пути файлов
                     return ipcRenderer.invoke('get-file-content', filePaths);
                } else {
                    console.error('Preload: Invalid filePaths passed to getFileContent.');
                    return Promise.reject(new Error('Invalid file paths array provided'));
                }
            },

            // 4. НОВАЯ функция для отправки сигнала отмены в main.js
            cancelFileContentLoad: () => {
                console.log(`Preload: Sending cancellation signal on channel "${CANCEL_CONTENT_LOAD_CHANNEL}"`);
                // Используем ipcRenderer.send, так как нам не нужен ответ
                ipcRenderer.send(CANCEL_CONTENT_LOAD_CHANNEL);
            },

            // 5. Копирование в буфер обмена (оставлено для примера, но используется navigator в renderer)
             copyToClipboard: (text) => {
                 console.log('Preload: Calling navigator.clipboard.writeText');
                 if (typeof text === 'string') {
                    return navigator.clipboard.writeText(text);
                 } else {
                    console.error('Preload: Invalid text passed to copyToClipboard.');
                    return Promise.reject(new Error('Invalid text provided for clipboard'));
                 }
             },
        });
        console.log('Preload: electronAPI exposed successfully.');
    } catch (error) {
         console.error('Preload: Error exposing electronAPI:', error);
    }
} else {
     console.error('Preload: contextIsolation is disabled! electronAPI was not exposed.');
}