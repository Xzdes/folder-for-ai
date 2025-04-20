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
const dropZone = document.getElementById('drop-zone'); // Область для D&D
const dragOverlay = document.getElementById('drag-overlay'); // Оверлей для D&D
const scanIndicator = document.getElementById('scan-indicator'); // Индикатор сканирования
const contentLoadingControls = document.getElementById('content-loading-controls'); // Контейнер индикатора и кнопки отмены
const contentLoadIndicator = document.getElementById('content-load-indicator'); // Индикатор загрузки контента
const cancelContentLoadBtn = document.getElementById('cancel-content-load-btn'); // Кнопка отмены загрузки
const searchInput = document.getElementById('search-input'); // Поле поиска
const expandAllBtn = document.getElementById('expand-all-btn'); // Кнопка "Развернуть"
const collapseAllBtn = document.getElementById('collapse-all-btn'); // Кнопка "Свернуть"
const selectedFilesCountSpan = document.getElementById('selected-files-count'); // Счетчик выбранных файлов
const lastFolderInfoSpan = document.getElementById('last-folder-info'); // Место для инфо о последней папке

// --- Глобальные переменные состояния ---
let currentRootPath = null; // Храним путь к выбранной корневой папке
let currentTreeData = null; // Храним полное дерево данных
const LAST_FOLDER_KEY = 'lastSelectedFolderPath'; // Ключ для localStorage
let contentAbortController = null; // Контроллер для отмены загрузки контента

// --- Инициализация при загрузке ---
document.addEventListener('DOMContentLoaded', () => {
    displayLastFolderPath(); // Показать последнюю папку при запуске
    resetUI(); // Сбросить UI в начальное состояние
});


// --- Обработчики событий ---

// 1. Нажатие кнопки "Выбрать папку"
selectFolderBtn.addEventListener('click', async () => {
    statusBar.textContent = 'Выбор папки...';
    setScanIndicator(true);
    try {
        // Используем существующий API для вызова диалога
        const result = await window.electronAPI.selectFolder();
        if (result.success) {
            // Обработка происходит внутри handleFolderSelected
            await handleFolderSelected(result.path, result.tree);
        } else {
            statusBar.textContent = `Ошибка: ${result.error || 'Не удалось выбрать папку'}`;
            resetUI(); // Сброс UI при ошибке или отмене
        }
    } catch (error) {
        console.error("Error during folder selection via dialog:", error);
        statusBar.textContent = `Критическая ошибка выбора папки: ${error.message}`;
        resetUI();
    } finally {
        setScanIndicator(false);
    }
});

// 2. Drag and Drop для папки
dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragOverlay.style.display = 'flex';
});

dropZone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!dropZone.contains(event.relatedTarget)) {
        dragOverlay.style.display = 'none';
    }
});

dropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragOverlay.style.display = 'none';

    const files = event.dataTransfer.files;
    if (files.length === 1 && files[0].path) {
        const droppedPath = files[0].path;
        console.log(`Folder dropped: ${droppedPath}`);

        // Проверяем, что это действительно папка (лучше делать в main, но можно и тут)
        // Эта проверка не 100% надежна в рендерере, полагаемся на main.js
        // Для надежности сразу вызываем API Electron для сканирования
        statusBar.textContent = `Сканирование папки: ${droppedPath}...`;
        setScanIndicator(true);
        resetUI(false); // Сбрасываем UI, но не статус

        try {
            // Используем НОВЫЙ API для сканирования переданного пути
            const result = await window.electronAPI.scanFolderPath(droppedPath);
            if (result.success) {
                await handleFolderSelected(result.path, result.tree);
            } else {
                statusBar.textContent = `Ошибка сканирования: ${result.error || 'Неизвестная ошибка'}`;
                resetUI();
            }
        } catch (error) {
            console.error("Error processing dropped folder:", error);
            statusBar.textContent = `Критическая ошибка обработки папки: ${error.message}`;
            resetUI();
        } finally {
            setScanIndicator(false);
        }

    } else if (files.length > 1) {
        statusBar.textContent = 'Пожалуйста, перетащите только одну папку.';
    } else {
        statusBar.textContent = 'Перетащенный элемент не является папкой или файл недоступен.';
    }
});

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

// 7. Нажатие кнопки "Отмена" загрузки содержимого
cancelContentLoadBtn.addEventListener('click', () => {
    if (contentAbortController) {
        console.log('User requested content load cancellation.');
        contentAbortController.abort(); // Отправляем сигнал отмены
        // UI обновится в блоке catch или finally функции updateContentOutput
    }
});


// --- Основные функции ---

// Обработка успешно выбранной/сканированной папки
async function handleFolderSelected(folderPath, treeData) {
    currentRootPath = folderPath;
    currentTreeData = treeData;
    statusBar.textContent = `Корневая папка: ${currentRootPath}`;
    saveLastFolderPath(currentRootPath);
    displayLastFolderPath(); // Обновляем кнопку загрузки последней папки

    resetUI(false); // Сброс без очистки статус-бара

    renderFileTreeIterative(currentTreeData, fileTreeContainer);

    const structureText = generateStructureTextIterative(currentTreeData);
    structureOutput.value = structureText;
    copyStructureBtn.disabled = !structureText;

    contentOutput.value = '';
    contentOutput.placeholder = 'Выберите файлы в дереве слева...';
    copyContentBtn.disabled = true;
    contentStatusBar.textContent = '';
    updateSelectedFilesCount();
}


// Сброс интерфейса в начальное состояние
function resetUI(clearStatus = true) {
    if (clearStatus) {
        statusBar.textContent = 'Папка не выбрана';
    }
    // Отменяем любую текущую загрузку контента при сбросе
    if (contentAbortController) {
        contentAbortController.abort();
        contentAbortController = null;
    }
    fileTreeContainer.innerHTML = '<p>Нажмите "Выбрать корневую папку..." или перетащите папку сюда.</p>';
    structureOutput.value = '';
    contentOutput.value = '';
    copyStructureBtn.disabled = true;
    copyContentBtn.disabled = true;
    contentStatusBar.textContent = '';
    searchInput.value = '';
    filterTree('');
    updateSelectedFilesCount(0);
    setScanIndicator(false);
    setContentLoadingControls(false); // Скрыть индикатор и кнопку отмены
    // Не сбрасываем currentRootPath и currentTreeData здесь
}

// Управление индикатором сканирования папки
function setScanIndicator(isLoading) {
    scanIndicator.style.display = isLoading ? 'inline-flex' : 'none';
    selectFolderBtn.disabled = isLoading;
    // Также блокируем кнопку загрузки последней папки, если она есть
    const loadLastBtn = lastFolderInfoSpan.querySelector('button');
    if (loadLastBtn) {
        loadLastBtn.disabled = isLoading;
    }
}

// Управление видимостью контейнера загрузки контента (индикатор + кнопка отмены)
function setContentLoadingControls(isLoading) {
    contentLoadingControls.style.display = isLoading ? 'inline-flex' : 'none';
}

// ИТЕРАТИВНАЯ функция для отрисовки дерева файлов (без изменений)
function renderFileTreeIterative(rootNode, containerElement) {
    containerElement.innerHTML = ''; // Очищаем контейнер

    if (!rootNode || !rootNode.name) {
        containerElement.innerHTML = '<p>Не удалось загрузить структуру папки.</p>';
        console.error("Invalid root node provided:", rootNode);
        return;
    }

    const stack = [];
    const initialUl = document.createElement('ul');
    containerElement.appendChild(initialUl);

    if (rootNode.children && rootNode.children.length > 0) {
        for (let i = rootNode.children.length - 1; i >= 0; i--) {
            stack.push({ node: rootNode.children[i], parentElement: initialUl, level: 0 });
        }
    } else {
        containerElement.innerHTML = '<p>Папка пуста или недоступна.</p>';
        return;
    }

    while (stack.length > 0) {
        const { node, parentElement, level } = stack.pop();

        const li = document.createElement('li');
        li.dataset.path = node.path;

        const label = document.createElement('label');
        label.classList.add('item-label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.path = node.path;
        checkbox.dataset.isDirectory = node.isDirectory;
        checkbox.checked = false;
        checkbox.disabled = node.ignored || !!node.error;

        if (node.isDirectory) label.classList.add('is-directory');
        if (node.ignored) label.classList.add('is-ignored');
        if (node.error) label.classList.add('has-error');

        if (node.error) {
            label.title = `Ошибка доступа: ${node.error}`;
        } else if (node.ignored) {
            label.title = `Игнорируется по умолчанию`;
        } else {
            label.title = node.relativePath || node.name;
        }

        label.appendChild(checkbox);

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('node-name');
        nameSpan.textContent = ` ${node.name}`;
        label.appendChild(nameSpan);

        li.appendChild(label);
        parentElement.appendChild(li);

        if (node.isDirectory && node.children && node.children.length > 0 && !node.ignored && !node.error) {
            const childUl = document.createElement('ul');
            li.appendChild(childUl);
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push({ node: node.children[i], parentElement: childUl, level: level + 1 });
            }
        }
    }
     if (searchInput.value) {
        filterTree(searchInput.value);
     }
}

// Обработчик изменения состояния чекбокса
function handleCheckboxChange(event) {
  const checkbox = event.target;
  const isChecked = checkbox.checked;
  const isDirectory = checkbox.dataset.isDirectory === 'true';
  const liElement = checkbox.closest('li');

  if (isDirectory && liElement) {
    const childCheckboxes = liElement.querySelectorAll(':scope > ul input[type="checkbox"]');
    childCheckboxes.forEach(childCb => {
      if (!childCb.disabled) {
        childCb.checked = isChecked;
      }
    });
  }
  // Запускаем обновление содержимого ПОСЛЕ изменения чекбоксов
  updateContentOutput();
}

// Обновление счетчика выбранных файлов
function updateSelectedFilesCount(count) {
    if (count === undefined) {
        const selectedCheckboxes = fileTreeContainer.querySelectorAll('input[type="checkbox"]:checked:not([data-is-directory="true"]):not(:disabled)');
        count = selectedCheckboxes.length;
    }
    selectedFilesCountSpan.textContent = count;
}

// Обновление текстового поля с содержимым выбранных файлов + Отмена
async function updateContentOutput() {
  // 1. Отменяем предыдущую операцию, если она еще идет
  if (contentAbortController) {
    contentAbortController.abort();
  }

  // 2. Создаем новый AbortController для этой операции
  contentAbortController = new AbortController();
  const signal = contentAbortController.signal;

  // 3. Собираем список выбранных файлов
  const selectedFiles = [];
  const allCheckedCheckboxes = fileTreeContainer.querySelectorAll('input[type="checkbox"]:checked');
  allCheckedCheckboxes.forEach(cb => {
    if (cb.dataset.isDirectory === 'false' && !cb.disabled) {
      selectedFiles.push(cb.dataset.path);
    }
  });

  // 4. Обновляем UI перед началом загрузки
  updateSelectedFilesCount(selectedFiles.length);
  contentOutput.value = '';
  contentStatusBar.textContent = '';
  copyContentBtn.disabled = true; // Блокируем кнопку копирования

  if (selectedFiles.length > 0) {
    setContentLoadingControls(true); // Показать индикатор и кнопку отмены
    contentOutput.placeholder = 'Загрузка содержимого выбранных файлов...';

    try {
      console.log(`Requesting content for ${selectedFiles.length} files...`);
      // **** ПРЕДПОЛОЖЕНИЕ: getFileContent будет доработан для приема signal ****
      // Передаем signal в API. Если API не поддерживает, он просто будет проигнорирован в main.js
      const result = await window.electronAPI.getFileContent(selectedFiles /*, signal */); // Передача signal закомментирована, т.к. требует доработки API

      // --- Важно: Проверяем, не была ли операция отменена ПОКА мы ждали результат ---
      if (signal.aborted) {
          console.log('Content loading was aborted before processing results.');
          contentOutput.value = '';
          contentOutput.placeholder = 'Загрузка содержимого отменена.';
          contentStatusBar.textContent = 'Загрузка отменена пользователем.';
          // Не разблокируем кнопку копирования
          return; // Выход из функции
      }
      // --- Конец проверки на отмену ---

      console.log(`Received content. Length: ${result.content?.length ?? 0}. Errors: ${result.errors?.length ?? 0}`);
      contentOutput.value = result.content;
      copyContentBtn.disabled = !result.content; // Активируем, если есть контент

      if (result.errors && result.errors.length > 0) {
           const errorMessages = result.errors.map(e => `${e.path}: ${e.message}`).join('; ');
           contentStatusBar.textContent = `Обнаружены ошибки при чтении ${result.errors.length} файлов. Детали: ${errorMessages}`;
           contentStatusBar.style.color = '#cc0000'; // Красный для ошибок
      } else {
           contentStatusBar.textContent = `Содержимое ${selectedFiles.length} файлов загружено.`;
           contentStatusBar.style.color = '#555'; // Стандартный цвет для успеха
      }

    } catch (error) {
        // Проверяем, была ли ошибка вызвана отменой
        if (error.name === 'AbortError') {
            console.log('Content loading aborted by AbortController.');
            contentOutput.value = '';
            contentOutput.placeholder = 'Загрузка содержимого отменена.';
            contentStatusBar.textContent = 'Загрузка отменена пользователем.';
            contentStatusBar.style.color = '#555'; // Не ошибка, а действие пользователя
        } else {
            // Другие ошибки (IPC, ошибки в main.js)
            console.error("Error getting file content:", error);
            contentOutput.value = `Ошибка загрузки содержимого: ${error.message}`;
            contentStatusBar.textContent = `Критическая ошибка загрузки содержимого.`;
            contentStatusBar.style.color = '#cc0000';
            copyContentBtn.disabled = true;
        }
    } finally {
        // В любом случае убираем индикатор и кнопку отмены по завершении
        setContentLoadingControls(false);
        // Очищаем контроллер, т.к. операция завершена (успешно, с ошибкой или отменена)
        contentAbortController = null;
        // Восстанавливаем плейсхолдер, если поле пустое и не было отмены
        if (!contentOutput.value && !signal?.aborted) { // Проверяем signal на случай, если finally вызвался до return в блоке if(signal.aborted)
             contentOutput.placeholder = 'Содержимое выбранных файлов появится здесь...';
        } else if (!contentOutput.value && signal?.aborted) {
             contentOutput.placeholder = 'Загрузка содержимого отменена.';
        }
    }

  } else {
    // Если ни один файл не выбран
    contentOutput.placeholder = 'Выберите файлы в дереве слева, чтобы увидеть их содержимое.';
    copyContentBtn.disabled = true;
    setContentLoadingControls(false); // Убедимся, что контролы скрыты
    contentStatusBar.textContent = '';
    contentAbortController = null; // Сбрасываем контроллер на всякий случай
  }
}


// ИТЕРАТИВНАЯ функция для генерации текстовой структуры папки (без изменений)
function generateStructureTextIterative(rootNode) {
    if (!rootNode || !rootNode.name) {
        console.error("Invalid root node provided to generateStructureTextIterative:", rootNode);
        return 'Ошибка: Невалидный корневой узел.';
    }
    let output = `${rootNode.name}/\n`;
    const stack = [];
    if (rootNode.children && rootNode.children.length > 0) {
        const children = rootNode.children;
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push({ node: children[i], indent: '', isLast: i === children.length - 1 });
        }
    } else { return output; }
    while (stack.length > 0) {
        const { node, indent, isLast } = stack.pop();
        const prefix = isLast ? '└── ' : '├── ';
        const childIndentBase = indent + (isLast ? '    ' : '│   ');
        output += `${indent}${prefix}${node.name}`;
        if (node.isDirectory) output += '/';
        if (node.ignored) output += ' (ignored)';
        if (node.error) output += ` (Error: ${node.error})`;
        output += '\n';
        if (node.isDirectory && node.children && node.children.length > 0 && !node.ignored && !node.error) {
            const children = node.children;
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push({ node: children[i], indent: childIndentBase, isLast: i === children.length - 1 });
            }
        }
    }
    return output;
}

// Вспомогательная функция для копирования в буфер обмена (без изменений)
async function copyToClipboard(text, buttonElement, successMessage) {
    if (!text || !buttonElement) return;
    const originalText = buttonElement.textContent;
    buttonElement.disabled = true;
    try {
        await navigator.clipboard.writeText(text); // Используем navigator напрямую
        buttonElement.textContent = successMessage;
        setTimeout(() => {
            if (buttonElement) {
                 buttonElement.textContent = originalText;
                 // Проверяем актуальное значение перед активацией
                 if (buttonElement === copyStructureBtn && structureOutput.value) {
                     buttonElement.disabled = false;
                 } else if (buttonElement === copyContentBtn && contentOutput.value) {
                     buttonElement.disabled = false;
                 } else { buttonElement.disabled = true; }
            }
        }, 1500);
    } catch (err) {
        console.error('Ошибка копирования: ', err);
        statusBar.textContent = 'Ошибка при копировании в буфер обмена.';
        buttonElement.textContent = 'Ошибка!';
         setTimeout(() => {
            if (buttonElement) {
                buttonElement.textContent = originalText;
                 if (buttonElement === copyStructureBtn && structureOutput.value) {
                     buttonElement.disabled = false;
                 } else if (buttonElement === copyContentBtn && contentOutput.value) {
                     buttonElement.disabled = false;
                 } else { buttonElement.disabled = true; }
            }
        }, 2000);
    }
}

// --- Функции для новых фич ---

// Фильтрация дерева файлов (без изменений)
function filterTree(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    const allNodes = fileTreeContainer.querySelectorAll('li');

    if (!term) {
        allNodes.forEach(li => {
            li.classList.remove('hidden-node');
             const label = li.querySelector(':scope > label');
             if (label) label.classList.remove('search-match');
        });
        // Убедимся, что все UL раскрыты после сброса фильтра
        toggleAllNodes(true);
        return;
    }

    allNodes.forEach(li => {
        const label = li.querySelector(':scope > label');
        const nameSpan = label ? label.querySelector('.node-name') : null;
        const nodeName = nameSpan ? nameSpan.textContent.toLowerCase().trim() : '';
        const isMatch = nodeName.includes(term);

        li.classList.add('hidden-node');
        if (label) label.classList.remove('search-match');

        if (isMatch) {
            li.classList.remove('hidden-node');
             if (label) label.classList.add('search-match');

            let parentLi = li.parentElement.closest('li');
            while (parentLi) {
                parentLi.classList.remove('hidden-node');
                const parentUl = parentLi.querySelector(':scope > ul');
                if (parentUl) parentUl.classList.remove('collapsed');
                parentLi = parentLi.parentElement.closest('li');
            }
             const ownUl = li.querySelector(':scope > ul');
             if (ownUl) ownUl.classList.remove('collapsed');
        }
    });
}


// Развернуть или свернуть все узлы дерева (без изменений)
function toggleAllNodes(expand) {
    const allUls = fileTreeContainer.querySelectorAll('ul > li > ul');
    allUls.forEach(ul => {
        if (expand) {
            ul.classList.remove('collapsed');
        } else {
            ul.classList.add('collapsed');
        }
    });
}

// --- Функции для работы с localStorage ---

// Сохранить путь последней папки (без изменений)
function saveLastFolderPath(path) {
    if (path) {
        try { localStorage.setItem(LAST_FOLDER_KEY, path); }
        catch (e) { console.warn("Не удалось сохранить путь в localStorage:", e); }
    }
}

// Загрузить и отобразить путь последней папки (исправлена кнопка)
function displayLastFolderPath() {
    try {
        const lastPath = localStorage.getItem(LAST_FOLDER_KEY);
        lastFolderInfoSpan.innerHTML = ''; // Очищаем предыдущее содержимое

        if (lastPath) {
            const textSpan = document.createElement('span');
            textSpan.textContent = `Последняя папка: `;
            lastFolderInfoSpan.appendChild(textSpan);

            const pathSpan = document.createElement('span');
            pathSpan.title = lastPath;
            pathSpan.textContent = truncatePath(lastPath);
            lastFolderInfoSpan.appendChild(pathSpan);

            const loadBtn = document.createElement('button');
            loadBtn.textContent = 'Загрузить';
            loadBtn.title = `Загрузить ${lastPath}`;
            loadBtn.style.marginLeft = '5px'; // Добавляем отступ кнопке
            loadBtn.onclick = async () => { // Исправлено: используем scanFolderPath
                 statusBar.textContent = `Загрузка папки: ${lastPath}...`;
                 setScanIndicator(true); // Блокируем кнопки
                 resetUI(false);
                 try {
                     // Используем API для сканирования переданного пути
                     const result = await window.electronAPI.scanFolderPath(lastPath);
                     if (result.success) {
                        await handleFolderSelected(result.path, result.tree);
                     } else {
                         statusBar.textContent = `Ошибка загрузки папки: ${result.error || 'Неизвестная ошибка'}`;
                         // Предлагаем удалить невалидный путь из памяти
                         const removeInvalid = confirm(`Папку "${lastPath}" не удалось загрузить. Удалить её из истории последних папок?`);
                         if (removeInvalid) {
                             localStorage.removeItem(LAST_FOLDER_KEY);
                             displayLastFolderPath(); // Обновляем отображение (уберет инфо)
                         }
                         resetUI();
                     }
                 } catch(error) {
                    console.error("Error loading last folder:", error);
                    statusBar.textContent = `Критическая ошибка загрузки папки: ${error.message}`;
                    resetUI();
                 } finally {
                    setScanIndicator(false); // Разблокируем кнопки
                 }
            };
            lastFolderInfoSpan.appendChild(loadBtn);
        }
    } catch (e) {
        console.warn("Не удалось получить путь из localStorage:", e);
        lastFolderInfoSpan.innerHTML = '';
    }
}

// Утилита для сокращения длинного пути (без изменений)
function truncatePath(path, maxLength = 50) {
    if (!path) return '';
    if (path.length <= maxLength) { return path; }
    const separator = path.includes('\\') ? '\\' : '/';
    const parts = path.split(separator);
    if (parts.length > 2) {
        let truncated = parts[0] + separator + '...' + separator + parts[parts.length - 1];
        if (truncated.length > maxLength) {
             truncated = '...' + path.substring(path.length - maxLength + 3);
        }
        return truncated;
    } else {
        return '...' + path.substring(path.length - maxLength + 3);
    }
}