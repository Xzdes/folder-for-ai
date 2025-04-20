// renderer.js

// --- Получаем ссылки на элементы DOM ---
const selectFolderBtn = document.getElementById('select-folder-btn');
const statusBar = document.getElementById('status-bar');
const fileTreeContainer = document.getElementById('file-tree-container');
const structureOutput = document.getElementById('structure-output');
const contentOutput = document.getElementById('content-output');
const copyStructureBtn = document.getElementById('copy-structure-btn');
const copyContentBtn = document.getElementById('copy-content-btn');
const contentStatusBar = document.getElementById('content-status-bar');
// Удалены ссылки на dropZone и dragOverlay
// const dropZone = document.getElementById('drop-zone');
// const dragOverlay = document.getElementById('drag-overlay');
const scanIndicator = document.getElementById('scan-indicator');
const contentLoadingControls = document.getElementById('content-loading-controls');
const contentLoadIndicator = document.getElementById('content-load-indicator');
const cancelContentLoadBtn = document.getElementById('cancel-content-load-btn');
const searchInput = document.getElementById('search-input');
const expandAllBtn = document.getElementById('expand-all-btn');
const collapseAllBtn = document.getElementById('collapse-all-btn');
const selectedFilesCountSpan = document.getElementById('selected-files-count');
const lastFolderInfoSpan = document.getElementById('last-folder-info');

// --- Глобальные переменные состояния ---
let currentRootPath = null;
let currentTreeData = null;
const LAST_FOLDER_KEY = 'lastSelectedFolderPath';
let contentAbortController = null; // Контроллер для отмены ТЕКУЩЕЙ операции загрузки

// --- Инициализация при загрузке ---
document.addEventListener('DOMContentLoaded', () => {
    displayLastFolderPath();
    resetUI();
});


// --- Обработчики событий ---

// 1. Нажатие кнопки "Выбрать папку"
selectFolderBtn.addEventListener('click', async () => {
    statusBar.textContent = 'Выбор папки...';
    setScanIndicator(true);
    try {
        const result = await window.electronAPI.selectFolder();
        if (result.success) {
            await handleFolderSelected(result.path, result.tree);
        } else {
            statusBar.textContent = `Ошибка: ${result.error || 'Не удалось выбрать папку'}`;
            resetUI(); // Сбрасываем UI при ошибке или отмене
        }
    } catch (error) {
        console.error("Error during folder selection via dialog:", error);
        statusBar.textContent = `Критическая ошибка выбора папки: ${error.message}`;
        resetUI();
    } finally {
        setScanIndicator(false);
    }
});

// 2. Drag and Drop УДАЛЕНЫ обработчики 'dragover', 'dragleave', 'drop'

// 3. Копирование структуры и содержимого
copyStructureBtn.addEventListener('click', async () => {
  await copyToClipboard(structureOutput.value, copyStructureBtn, 'Структура скопирована!');
});

copyContentBtn.addEventListener('click', async () => {
    await copyToClipboard(contentOutput.value, copyContentBtn, 'Содержимое скопировано!');
});

// 4. Изменение чекбокса в дереве
fileTreeContainer.addEventListener('change', (event) => {
    if (event.target.type === 'checkbox') {
        handleCheckboxChange(event);
    }
});

// 5. Поиск/Фильтрация в дереве
let searchTimeout;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        filterTree(searchInput.value);
    }, 300);
});

// 6. Развернуть/Свернуть все
expandAllBtn.addEventListener('click', () => toggleAllNodes(true));
collapseAllBtn.addEventListener('click', () => toggleAllNodes(false));

// 7. Нажатие кнопки "Отмена" загрузки содержимого (Переработано)
cancelContentLoadBtn.addEventListener('click', () => {
    console.log('Renderer: Cancel button clicked.');
    // Проверяем, есть ли активный контроллер, СВЯЗАННЫЙ С ТЕКУЩЕЙ ВИДИМОЙ ОПЕРАЦИЕЙ
    if (contentAbortController) {
        const associatedController = contentAbortController; // Сохраняем ссылку

        // 1. Немедленно обновляем UI, чтобы показать отмену
        console.log('Renderer: [Cancel Click] Updating UI to "Cancelled" state.');
        contentStatusBar.textContent = 'Отмена операции...';
        contentStatusBar.style.color = '#555';
        setContentLoadingControls(false); // Скрываем индикатор и кнопку
        contentOutput.placeholder = 'Загрузка содержимого отменена.';
        contentOutput.value = '';
        copyContentBtn.disabled = true;

        // 2. Вызываем abort() на контроллере, связанном с операцией
        console.log('Renderer: [Cancel Click] Aborting local AbortController.');
        associatedController.abort();

        // 3. Отправляем сигнал отмены в main процесс
        console.log('Renderer: [Cancel Click] Calling electronAPI.cancelFileContentLoad().');
        window.electronAPI.cancelFileContentLoad();

        // 4. Сбрасываем ГЛОБАЛЬНЫЙ контроллер, чтобы новые операции не использовали старый
        // Если глобальный контроллер все еще указывает на тот, что мы только что отменили,
        // то сбрасываем его. Это предотвращает проблемы, если пользователь быстро кликает.
        if (contentAbortController === associatedController) {
             contentAbortController = null;
             console.log('Renderer: [Cancel Click] Global AbortController reset.');
        } else {
            console.warn('Renderer: [Cancel Click] Global AbortController was already different or null.');
        }

    } else {
        console.warn('Renderer: [Cancel Click] No active AbortController found. Hiding controls anyway.');
        // На всякий случай скрываем контролы, если они почему-то остались видимы
         setContentLoadingControls(false);
    }
});


// --- Основные функции ---

// Обработка успешно выбранной/сканированной папки
async function handleFolderSelected(folderPath, treeData) {
    console.log(`Renderer: Handling selected/scanned folder: ${folderPath}`);
    // Отменяем предыдущую загрузку контента, если она была
    if (contentAbortController && !contentAbortController.signal.aborted) {
        console.log('Renderer: [handleFolderSelected] Aborting previous content load.');
        contentAbortController.abort();
        window.electronAPI.cancelFileContentLoad();
        contentAbortController = null; // Сбрасываем сразу
    }

    currentRootPath = folderPath;
    currentTreeData = treeData;
    statusBar.textContent = `Корневая папка: ${currentRootPath}`;
    saveLastFolderPath(currentRootPath);
    displayLastFolderPath();

    resetUI(false); // Сбрасываем UI, но не статус бар

    renderFileTreeIterative(currentTreeData, fileTreeContainer);

    const structureText = generateStructureTextIterative(currentTreeData);
    structureOutput.value = structureText;
    copyStructureBtn.disabled = !structureText;

    // Сбрасываем вывод контента явно
    contentOutput.value = '';
    contentOutput.placeholder = 'Выберите файлы в дереве слева...';
    copyContentBtn.disabled = true;
    contentStatusBar.textContent = '';
    updateSelectedFilesCount(0);
    setContentLoadingControls(false); // Убедимся, что контролы скрыты
}


// Сброс интерфейса в начальное состояние (Упрощено)
function resetUI(clearStatus = true) {
    console.log(`Renderer: Resetting UI. clearStatus=${clearStatus}`);
    if (clearStatus) {
        statusBar.textContent = 'Папка не выбрана';
    }
    // Отменяем активную операцию, если она есть
    if (contentAbortController && !contentAbortController.signal.aborted) {
        console.log('Renderer: [Resetting UI] Aborting ongoing content load.');
        contentAbortController.abort();
        window.electronAPI.cancelFileContentLoad();
    }
    contentAbortController = null; // Всегда обнуляем

    fileTreeContainer.innerHTML = '<p>Нажмите "Выбрать корневую папку...", чтобы начать.</p>';
    structureOutput.value = '';
    contentOutput.value = '';
    copyStructureBtn.disabled = true;
    copyContentBtn.disabled = true;
    contentStatusBar.textContent = '';
    searchInput.value = '';
    // filterTree(''); // Нет смысла вызывать на пустом DOM
    updateSelectedFilesCount(0);
    setScanIndicator(false);
    setContentLoadingControls(false);
}

// Управление индикатором сканирования папки
function setScanIndicator(isLoading) {
    scanIndicator.style.display = isLoading ? 'inline-flex' : 'none';
    selectFolderBtn.disabled = isLoading;
    const loadLastBtn = lastFolderInfoSpan.querySelector('button');
    if (loadLastBtn) {
        loadLastBtn.disabled = isLoading;
    }
}

// Управление видимостью контейнера загрузки контента
function setContentLoadingControls(isLoading) {
    // Добавим проверку, не был ли контроллер уже сброшен (например, кнопкой отмены)
    if (isLoading && !contentAbortController) {
        console.warn("Renderer: Trying to show loading controls, but AbortController is null. Operation might have been cancelled.");
        return; // Не показываем контролы, если операция уже отменена
    }
     contentLoadingControls.style.display = isLoading ? 'inline-flex' : 'none';
}

// ИТЕРАТИВНАЯ функция для отрисовки дерева файлов (без изменений)
function renderFileTreeIterative(rootNode, containerElement) {
    // ... (код без изменений) ...
    containerElement.innerHTML = ''; if (!rootNode || !rootNode.name) { containerElement.innerHTML = '<p>Не удалось загрузить структуру папки.</p>'; console.error("Invalid root node provided:", rootNode); return; } const stack = []; const initialUl = document.createElement('ul'); containerElement.appendChild(initialUl); if (rootNode.children && rootNode.children.length > 0) { for (let i = rootNode.children.length - 1; i >= 0; i--) { stack.push({ node: rootNode.children[i], parentElement: initialUl, level: 0 }); } } else { containerElement.innerHTML = '<p>Папка пуста или недоступна.</p>'; return; } while (stack.length > 0) { const { node, parentElement, level } = stack.pop(); const li = document.createElement('li'); li.dataset.path = node.path; const label = document.createElement('label'); label.classList.add('item-label'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.path = node.path; checkbox.dataset.isDirectory = node.isDirectory; checkbox.checked = false; checkbox.disabled = node.ignored || !!node.error; if (node.isDirectory) label.classList.add('is-directory'); if (node.ignored) label.classList.add('is-ignored'); if (node.error) label.classList.add('has-error'); if (node.error) { label.title = `Ошибка доступа: ${node.error}`; } else if (node.ignored) { label.title = `Игнорируется по умолчанию`; } else { label.title = node.relativePath || node.name; } label.appendChild(checkbox); const nameSpan = document.createElement('span'); nameSpan.classList.add('node-name'); nameSpan.textContent = ` ${node.name}`; label.appendChild(nameSpan); li.appendChild(label); parentElement.appendChild(li); if (node.isDirectory && node.children && node.children.length > 0 && !node.ignored && !node.error) { const childUl = document.createElement('ul'); li.appendChild(childUl); for (let i = node.children.length - 1; i >= 0; i--) { stack.push({ node: node.children[i], parentElement: childUl, level: level + 1 }); } } } if (searchInput.value) { filterTree(searchInput.value); }
}

// Обработчик изменения состояния чекбокса
function handleCheckboxChange(event) {
  const checkbox = event.target;
  const isChecked = checkbox.checked;
  const isDirectory = checkbox.dataset.isDirectory === 'true';
  const liElement = checkbox.closest('li');
  if (isDirectory && liElement) {
    const childCheckboxes = liElement.querySelectorAll(':scope > ul input[type="checkbox"]');
    childCheckboxes.forEach(childCb => { if (!childCb.disabled) { childCb.checked = isChecked; } });
  }
  // Запускаем обновление ПОСЛЕ изменения чекбоксов с нулевой задержкой
  // Это позволяет браузеру сначала обработать все изменения DOM от каскадного выбора
  setTimeout(updateContentOutput, 0);
}

// Обновление счетчика выбранных файлов
function updateSelectedFilesCount(count) {
    if (count === undefined) { const selectedCheckboxes = fileTreeContainer.querySelectorAll('input[type="checkbox"]:checked:not([data-is-directory="true"]):not(:disabled)'); count = selectedCheckboxes.length; }
    selectedFilesCountSpan.textContent = count;
}

// Обновление текстового поля с содержимым выбранных файлов + Отмена (Переработано)
async function updateContentOutput() {
  console.log("Renderer: updateContentOutput called.");
  // 1. Отменяем предыдущую операцию, если она активна
  if (contentAbortController && !contentAbortController.signal.aborted) {
      console.log('Renderer: [updateContentOutput] Aborting previous content load operation.');
      contentAbortController.abort();
      window.electronAPI.cancelFileContentLoad();
  }
  // Сбрасываем старый контроллер перед созданием нового
  contentAbortController = null;

  // 2. Создаем НОВЫЙ контроллер для ТЕКУЩЕЙ операции
  const currentController = new AbortController();
  contentAbortController = currentController; // Сохраняем его глобально
  const currentSignal = currentController.signal;
  console.log("Renderer: [updateContentOutput] New AbortController created and assigned.");

  // 3. Собираем файлы
  const selectedFiles = [];
  const allCheckedCheckboxes = fileTreeContainer.querySelectorAll('input[type="checkbox"]:checked');
  allCheckedCheckboxes.forEach(cb => { if (cb.dataset.isDirectory === 'false' && !cb.disabled) { selectedFiles.push(cb.dataset.path); } });

  // 4. Обновляем UI перед запросом
  updateSelectedFilesCount(selectedFiles.length);
  contentOutput.value = '';
  contentStatusBar.textContent = '';
  copyContentBtn.disabled = true;

  if (selectedFiles.length > 0) {
    // Показываем контролы загрузки ТОЛЬКО если операция не была отменена СРАЗУ ЖЕ
    // (хотя это маловероятно, но для полноты)
    if (!currentSignal.aborted) {
        setContentLoadingControls(true);
        contentOutput.placeholder = 'Загрузка содержимого выбранных файлов...';
    } else {
         console.log("Renderer: [updateContentOutput] Operation aborted before showing loading controls.");
         contentOutput.placeholder = 'Загрузка содержимого отменена.'; // Устанавливаем правильный плейсхолдер
         return; // Выходим, если отмена произошла до начала
    }

    try {
      console.log(`Renderer: [updateContentOutput] Requesting content for ${selectedFiles.length} files...`);
      const result = await window.electronAPI.getFileContent(selectedFiles);

      // --- ГЛАВНАЯ ПРОВЕРКА НА ОТМЕНУ ---
      // Проверяем, не была ли ТЕКУЩАЯ операция отменена (сигналом от кнопки)
      // ПОКА мы ждали ответа от main процесса.
      if (currentSignal.aborted) {
          console.log('Renderer: [updateContentOutput] Operation was aborted locally while waiting for result. Ignoring received data.');
          // UI уже должен быть в состоянии "Отменено" из обработчика кнопки.
          return; // Ничего больше не делаем с результатом
      }
      // -----------------------------------

      console.log(`Renderer: [updateContentOutput] Received content. Length: ${result.content?.length ?? 0}. Errors: ${result.errors?.length ?? 0}`);

      // Скрываем контролы загрузки, так как операция завершена (успешно или с ошибками от сервера)
      setContentLoadingControls(false);

      // Обновляем UI СИНХРОННО, так как await завершился
      contentOutput.value = result.content;
      copyContentBtn.disabled = !result.content;

      // Анализируем ошибки из main процесса
      const errorsFromServer = result.errors || [];
      const isCancelledFromServer = errorsFromServer.some(e => e.message === 'Operation cancelled by user');

      if (isCancelledFromServer) {
          contentStatusBar.textContent = `Загрузка отменена сервером. ${errorsFromServer.length > 1 ? `Обнаружено ${errorsFromServer.length - 1} других ошибок.` : ''}`;
          contentStatusBar.style.color = '#555';
          contentOutput.placeholder = 'Загрузка содержимого отменена.'; // Обновляем плейсхолдер на случай пустого value
      } else if (errorsFromServer.length > 0) {
           const errorMessages = errorsFromServer.map(e => `${e.path}: ${e.message}`).join('; ');
           contentStatusBar.textContent = `Обнаружены ошибки при чтении ${errorsFromServer.length} файлов. Детали: ${errorMessages}`;
           contentStatusBar.style.color = '#cc0000';
      } else {
           contentStatusBar.textContent = `Содержимое ${selectedFiles.length} файлов загружено.`;
           contentStatusBar.style.color = '#555';
      }

    } catch (error) {
      // Обрабатываем ошибки промиса (например, если main процесс упал или вернул reject)
      // Исключаем AbortError, так как он обрабатывается проверкой currentSignal.aborted
      if (error.name !== 'AbortError' && !currentSignal.aborted) {
          console.error("Renderer: [updateContentOutput] Unexpected error getting file content:", error);
          // Проверяем, не был ли контроллер уже сброшен (например, кнопкой Отмена)
          if (contentAbortController === currentController) {
              setContentLoadingControls(false); // Скрываем контролы при ошибке
              contentOutput.value = `Ошибка загрузки содержимого: ${error.message}`;
              contentStatusBar.textContent = `Критическая ошибка загрузки содержимого.`;
              contentStatusBar.style.color = '#cc0000';
              copyContentBtn.disabled = true;
          } else {
               console.log("Renderer: [updateContentOutput] Caught error, but controller was already nullified, likely due to cancellation.");
          }
      } else {
           console.log(`Renderer: [updateContentOutput] Caught expected ${error.name || 'AbortSignal'}. Operation cancelled.`);
           // UI уже должен быть в состоянии отмены
      }
    } finally {
        console.log("Renderer: [updateContentOutput] Finally block executing.");
        // Сбрасываем глобальный контроллер ТОЛЬКО если он все еще ссылается на контроллер ТЕКУЩЕЙ операции
        // и операция не была отменена (т.к. кнопка отмены уже сбросила его)
        if (contentAbortController === currentController && !currentSignal.aborted) {
             contentAbortController = null;
             console.log("Renderer: [updateContentOutput] Global AbortController reset in finally because operation completed normally.");
        } else if (contentAbortController === currentController && currentSignal.aborted){
             console.log("Renderer: [updateContentOutput] Global AbortController was already aborted, likely reset by cancel button.");
             // Он уже должен быть null из обработчика кнопки, но на всякий случай
             contentAbortController = null;
        } else {
             console.log("Renderer: [updateContentOutput] Global AbortController in finally was already different or null.");
        }
    }

  } else {
    // Если ни один файл не выбран
    console.log("Renderer: [updateContentOutput] No files selected, clearing content area.");
    contentOutput.placeholder = 'Выберите файлы в дереве слева...';
    copyContentBtn.disabled = true;
    setContentLoadingControls(false);
    contentStatusBar.textContent = '';
    contentAbortController = null; // Сбрасываем контроллер
  }
}

// ... (остальные функции без изменений: generateStructureTextIterative, copyToClipboard, filterTree, toggleAllNodes, saveLastFolderPath, displayLastFolderPath, truncatePath) ...
// ИТЕРАТИВНАЯ функция для генерации текстовой структуры папки (без изменений)
function generateStructureTextIterative(rootNode) { if (!rootNode || !rootNode.name) { console.error("Invalid root node provided:", rootNode); return 'Ошибка: Невалидный корневой узел.'; } let output = `${rootNode.name}/\n`; const stack = []; if (rootNode.children && rootNode.children.length > 0) { const children = rootNode.children; for (let i = children.length - 1; i >= 0; i--) { stack.push({ node: children[i], indent: '', isLast: i === children.length - 1 }); } } else { return output; } while (stack.length > 0) { const { node, indent, isLast } = stack.pop(); const prefix = isLast ? '└── ' : '├── '; const childIndentBase = indent + (isLast ? '    ' : '│   '); output += `${indent}${prefix}${node.name}`; if (node.isDirectory) output += '/'; if (node.ignored) output += ' (ignored)'; if (node.error) output += ` (Error: ${node.error})`; output += '\n'; if (node.isDirectory && node.children && node.children.length > 0 && !node.ignored && !node.error) { const children = node.children; for (let i = children.length - 1; i >= 0; i--) { stack.push({ node: children[i], indent: childIndentBase, isLast: i === children.length - 1 }); } } } return output; }
// Вспомогательная функция для копирования в буфер обмена (без изменений)
async function copyToClipboard(text, buttonElement, successMessage) { if (!text || !buttonElement) return; const originalText = buttonElement.textContent; buttonElement.disabled = true; try { await navigator.clipboard.writeText(text); buttonElement.textContent = successMessage; setTimeout(() => { if (buttonElement) { buttonElement.textContent = originalText; if (buttonElement === copyStructureBtn && structureOutput.value) { buttonElement.disabled = false; } else if (buttonElement === copyContentBtn && contentOutput.value) { buttonElement.disabled = false; } else { buttonElement.disabled = true; } } }, 1500); } catch (err) { console.error('Ошибка копирования: ', err); statusBar.textContent = 'Ошибка при копировании в буфер обмена.'; buttonElement.textContent = 'Ошибка!'; setTimeout(() => { if (buttonElement) { buttonElement.textContent = originalText; if (buttonElement === copyStructureBtn && structureOutput.value) { buttonElement.disabled = false; } else if (buttonElement === copyContentBtn && contentOutput.value) { buttonElement.disabled = false; } else { buttonElement.disabled = true; } } }, 2000); } }
// --- Функции для новых фич ---
// Фильтрация дерева файлов (без изменений)
function filterTree(searchTerm) { const term = searchTerm.toLowerCase().trim(); const allNodes = fileTreeContainer.querySelectorAll('li'); if (!term) { allNodes.forEach(li => { li.classList.remove('hidden-node'); const label = li.querySelector(':scope > label'); if (label) label.classList.remove('search-match'); }); toggleAllNodes(true); return; } allNodes.forEach(li => { const label = li.querySelector(':scope > label'); const nameSpan = label ? label.querySelector('.node-name') : null; const nodeName = nameSpan ? nameSpan.textContent.toLowerCase().trim() : ''; const isMatch = nodeName.includes(term); li.classList.add('hidden-node'); if (label) label.classList.remove('search-match'); if (isMatch) { li.classList.remove('hidden-node'); if (label) label.classList.add('search-match'); let parentLi = li.parentElement.closest('li'); while (parentLi) { parentLi.classList.remove('hidden-node'); const parentUl = parentLi.querySelector(':scope > ul'); if (parentUl) parentUl.classList.remove('collapsed'); parentLi = parentLi.parentElement.closest('li'); } const ownUl = li.querySelector(':scope > ul'); if (ownUl) ownUl.classList.remove('collapsed'); } }); }
// Развернуть или свернуть все узлы дерева (без изменений)
function toggleAllNodes(expand) { const allUls = fileTreeContainer.querySelectorAll('ul > li > ul'); allUls.forEach(ul => { if (expand) { ul.classList.remove('collapsed'); } else { ul.classList.add('collapsed'); } }); }
// --- Функции для работы с localStorage ---
// Сохранить путь последней папки (без изменений)
function saveLastFolderPath(path) { if (path) { try { localStorage.setItem(LAST_FOLDER_KEY, path); } catch (e) { console.warn("Не удалось сохранить путь в localStorage:", e); } } }
// Загрузить и отобразить путь последней папки (без изменений)
function displayLastFolderPath() { try { const lastPath = localStorage.getItem(LAST_FOLDER_KEY); lastFolderInfoSpan.innerHTML = ''; if (lastPath) { const textSpan = document.createElement('span'); textSpan.textContent = `Последняя папка: `; lastFolderInfoSpan.appendChild(textSpan); const pathSpan = document.createElement('span'); pathSpan.title = lastPath; pathSpan.textContent = truncatePath(lastPath); lastFolderInfoSpan.appendChild(pathSpan); const loadBtn = document.createElement('button'); loadBtn.textContent = 'Загрузить'; loadBtn.title = `Загрузить ${lastPath}`; loadBtn.style.marginLeft = '5px'; loadBtn.onclick = async () => { statusBar.textContent = `Загрузка папки: ${lastPath}...`; setScanIndicator(true); resetUI(false); try { const result = await window.electronAPI.scanFolderPath(lastPath); if (result.success) { await handleFolderSelected(result.path, result.tree); } else { statusBar.textContent = `Ошибка загрузки папки: ${result.error || 'Неизвестная ошибка'}`; const removeInvalid = confirm(`Папку "${lastPath}" не удалось загрузить. Удалить её из истории последних папок?`); if (removeInvalid) { localStorage.removeItem(LAST_FOLDER_KEY); displayLastFolderPath(); } resetUI(); } } catch(error) { console.error("Error loading last folder:", error); statusBar.textContent = `Критическая ошибка загрузки папки: ${error.message}`; resetUI(); } finally { setScanIndicator(false); } }; lastFolderInfoSpan.appendChild(loadBtn); } } catch (e) { console.warn("Не удалось получить путь из localStorage:", e); lastFolderInfoSpan.innerHTML = ''; } }
// Утилита для сокращения длинного пути (без изменений)
function truncatePath(path, maxLength = 50) { if (!path) return ''; if (path.length <= maxLength) { return path; } const separator = path.includes('\\') ? '\\' : '/'; const parts = path.split(separator); if (parts.length > 2) { let truncated = parts[0] + separator + '...' + separator + parts[parts.length - 1]; if (truncated.length > maxLength) { truncated = '...' + path.substring(path.length - maxLength + 3); } return truncated; } else { return '...' + path.substring(path.length - maxLength + 3); } }