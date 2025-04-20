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
const contentLoadIndicator = document.getElementById('content-load-indicator'); // Индикатор загрузки контента
const searchInput = document.getElementById('search-input'); // Поле поиска
const expandAllBtn = document.getElementById('expand-all-btn'); // Кнопка "Развернуть"
const collapseAllBtn = document.getElementById('collapse-all-btn'); // Кнопка "Свернуть"
const selectedFilesCountSpan = document.getElementById('selected-files-count'); // Счетчик выбранных файлов
const lastFolderInfoSpan = document.getElementById('last-folder-info'); // Место для инфо о последней папке

// --- Глобальные переменные состояния ---
let currentRootPath = null; // Храним путь к выбранной корневой папке
let currentTreeData = null; // Храним полное дерево данных
const LAST_FOLDER_KEY = 'lastSelectedFolderPath'; // Ключ для localStorage

// --- Инициализация при загрузке ---
document.addEventListener('DOMContentLoaded', () => {
    displayLastFolderPath(); // Показать последнюю папку при запуске
    resetUI(); // Сбросить UI в начальное состояние
});


// --- Обработчики событий ---

// 1. Нажатие кнопки "Выбрать папку"
selectFolderBtn.addEventListener('click', async () => {
    statusBar.textContent = 'Выбор папки...';
    setScanIndicator(true); // Показать индикатор сканирования
    try {
        const result = await window.electronAPI.selectFolder();
        if (result.success) {
            await handleFolderSelected(result.path, result.tree);
        } else {
            statusBar.textContent = `Ошибка: ${result.error || 'Не удалось выбрать папку'}`;
            resetUI(); // Сброс UI при ошибке или отмене
        }
    } catch (error) {
        console.error("Error during folder selection:", error);
        statusBar.textContent = `Критическая ошибка выбора папки: ${error.message}`;
        resetUI();
    } finally {
        setScanIndicator(false); // Скрыть индикатор сканирования
    }
});

// 2. Drag and Drop для папки
dropZone.addEventListener('dragover', (event) => {
    event.preventDefault(); // Необходимо для срабатывания 'drop'
    event.stopPropagation();
    dragOverlay.style.display = 'flex'; // Показать оверлей
});

dropZone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Скрываем оверлей, только если уходим из окна приложения совсем
    if (event.relatedTarget === null || !dropZone.contains(event.relatedTarget)) {
        dragOverlay.style.display = 'none';
    }
});

dropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragOverlay.style.display = 'none'; // Скрыть оверлей

    const files = event.dataTransfer.files;
    if (files.length === 1 && files[0].path) {
        // Пытаемся получить путь к перетащенному элементу
        // В Electron путь доступен через file.path
        const droppedPath = files[0].path;

        // Проверка, что это папка (хотя Electron API сделает это надежнее)
        // Для надежности сразу вызываем API Electron для сканирования
        statusBar.textContent = 'Сканирование перетащенной папки...';
        setScanIndicator(true);
        resetUI(false); // Сбрасываем UI, но не статус

        try {
            // Используем тот же API, что и при выборе кнопкой, но передаем путь
            // Предположение: нужен новый IPC хендлер или доработка старого для обработки переданного пути
            // Пока что симулируем вызов selectFolder, но это не сработает напрямую.
            // **** НЕОБХОДИМА ДОРАБОТКА В MAIN.JS ****
            // **** ВРЕМЕННОЕ РЕШЕНИЕ: Вызываем стандартный selectFolder, что не идеально ****
            // **** Правильно было бы: const result = await window.electronAPI.scanDroppedFolder(droppedPath); ****
             console.warn("Drag-and-drop: Используется selectFolder API, что не оптимально. Нужен scanDroppedFolder в main.js");
             // Инициируем стандартный процесс выбора папки, как будто нажали кнопку
             // Это временная мера, пока нет отдельного API для D&D
             // statusBar.textContent = `Перетащена папка: ${droppedPath}. Запуск сканирования...`;
             // Инициируем процесс выбора (хотя папка уже известна)
             const result = await window.electronAPI.selectFolder(); // Это не то, что нужно
            if (result.success) {
                // Мы не можем быть уверены, что выбранная папка та же, что и перетащенная
                // Пока что просто обрабатываем результат, как обычно
                await handleFolderSelected(result.path, result.tree);
            } else {
                 statusBar.textContent = `Не удалось обработать перетащенную папку: ${result.error || 'Ошибка'}`;
                 resetUI();
            }
             // Правильная логика после доработки main.js:
             // const result = await window.electronAPI.scanDroppedFolder(droppedPath);
             // if (result.success) {
             //     await handleFolderSelected(result.path, result.tree);
             // } else {
             //     statusBar.textContent = `Ошибка сканирования перетащенной папки: ${result.error || 'Неизвестная ошибка'}`;
             //     resetUI();
             // }

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
        statusBar.textContent = 'Перетащенный элемент не является папкой или файл не доступен.';
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
// Используем делегирование событий на контейнер дерева
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
    }, 300); // Небольшая задержка для оптимизации
});

// 6. Развернуть/Свернуть все
expandAllBtn.addEventListener('click', () => toggleAllNodes(true));
collapseAllBtn.addEventListener('click', () => toggleAllNodes(false));


// --- Основные функции ---

// Обработка успешно выбранной/сканированной папки
async function handleFolderSelected(folderPath, treeData) {
    currentRootPath = folderPath;
    currentTreeData = treeData;
    statusBar.textContent = `Корневая папка: ${currentRootPath}`;
    saveLastFolderPath(currentRootPath); // Сохраняем путь
    displayLastFolderPath(); // Обновляем инфо о последней папке

    // 1. Очищаем предыдущие результаты и сбрасываем поиск
    resetUI(false); // Сброс без очистки статус-бара

    // 2. Отобразить дерево
    renderFileTreeIterative(currentTreeData, fileTreeContainer);

    // 3. Сгенерировать и показать структуру
    const structureText = generateStructureTextIterative(currentTreeData);
    structureOutput.value = structureText;
    copyStructureBtn.disabled = !structureText;

    // 4. Сбросить вывод содержимого
    contentOutput.value = '';
    contentOutput.placeholder = 'Выберите файлы в дереве слева...';
    copyContentBtn.disabled = true;
    contentStatusBar.textContent = '';
    updateSelectedFilesCount(); // Сбросить счетчик
}


// Сброс интерфейса в начальное состояние
function resetUI(clearStatus = true) {
    if (clearStatus) {
        statusBar.textContent = 'Папка не выбрана';
    }
    fileTreeContainer.innerHTML = '<p>Нажмите "Выбрать корневую папку..." или перетащите папку сюда.</p>';
    structureOutput.value = '';
    contentOutput.value = '';
    copyStructureBtn.disabled = true;
    copyContentBtn.disabled = true;
    contentStatusBar.textContent = '';
    searchInput.value = ''; // Очистить поиск
    filterTree(''); // Сбросить фильтр
    updateSelectedFilesCount(0); // Обнулить счетчик
    setScanIndicator(false);
    setContentLoadIndicator(false);
    // Не сбрасываем currentRootPath и currentTreeData здесь,
    // они сбрасываются при начале нового выбора или ошибке
}

// Управление индикатором сканирования папки
function setScanIndicator(isLoading) {
    scanIndicator.style.display = isLoading ? 'inline-flex' : 'none';
    selectFolderBtn.disabled = isLoading; // Блокируем кнопку во время сканирования
}

// Управление индикатором загрузки содержимого
function setContentLoadIndicator(isLoading) {
    contentLoadIndicator.style.display = isLoading ? 'inline-flex' : 'none';
    // Не блокируем кнопку копирования здесь, это делается в updateContentOutput
}

// ИТЕРАТИВНАЯ функция для отрисовки дерева файлов (с span.node-name)
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
        li.dataset.path = node.path; // Сохраняем путь для фильтрации/других нужд

        const label = document.createElement('label');
        label.classList.add('item-label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.path = node.path;
        checkbox.dataset.isDirectory = node.isDirectory;
        checkbox.checked = false;
        checkbox.disabled = node.ignored || !!node.error;

        // Добавляем классы для стилизации
        if (node.isDirectory) label.classList.add('is-directory');
        if (node.ignored) label.classList.add('is-ignored');
        if (node.error) label.classList.add('has-error');

        // Устанавливаем title для всплывающих подсказок
        if (node.error) {
            label.title = `Ошибка доступа: ${node.error}`;
        } else if (node.ignored) {
            label.title = `Игнорируется по умолчанию`;
        } else {
            label.title = node.relativePath || node.name; // Показываем относительный путь или имя
        }

        label.appendChild(checkbox);

        // Оборачиваем имя в span для text-overflow
        const nameSpan = document.createElement('span');
        nameSpan.classList.add('node-name');
        nameSpan.textContent = ` ${node.name}`; // Пробел для отступа от иконки
        label.appendChild(nameSpan);

        li.appendChild(label);
        parentElement.appendChild(li);

        // Если это папка и у нее есть дети (и она не игнорируется/без ошибок)
        if (node.isDirectory && node.children && node.children.length > 0 && !node.ignored && !node.error) {
            const childUl = document.createElement('ul');
             // По умолчанию все папки свернуты (добавляем класс collapsed)
             // childUl.classList.add('collapsed'); // Убрал старт свернутым, можно вернуть если нужно
            li.appendChild(childUl);
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push({ node: node.children[i], parentElement: childUl, level: level + 1 });
            }
        }
    }
    // После рендеринга можно применить фильтр, если он был введен ранее
     if (searchInput.value) {
        filterTree(searchInput.value);
     }
}

// Обработчик изменения состояния чекбокса
function handleCheckboxChange(event) {
  const checkbox = event.target;
  const isChecked = checkbox.checked;
  const isDirectory = checkbox.dataset.isDirectory === 'true';
  const liElement = checkbox.closest('li'); // Находим родительский LI

  if (isDirectory && liElement) {
    // Каскадный выбор для дочерних элементов ТОЛЬКО этой папки
    const childCheckboxes = liElement.querySelectorAll(':scope > ul input[type="checkbox"]'); // :scope для выбора только прямых детей
    childCheckboxes.forEach(childCb => {
      if (!childCb.disabled) {
        childCb.checked = isChecked;
      }
    });
  }

  // Обновление счетчика и содержимого выбранных файлов
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

// Обновление текстового поля с содержимым выбранных файлов
async function updateContentOutput() {
  const selectedFiles = [];
  const allCheckedCheckboxes = fileTreeContainer.querySelectorAll('input[type="checkbox"]:checked');

  allCheckedCheckboxes.forEach(cb => {
    if (cb.dataset.isDirectory === 'false' && !cb.disabled) {
      selectedFiles.push(cb.dataset.path);
    }
  });

  updateSelectedFilesCount(selectedFiles.length); // Обновляем счетчик
  contentOutput.value = '';
  contentStatusBar.textContent = '';

  if (selectedFiles.length > 0) {
    copyContentBtn.disabled = true;
    setContentLoadIndicator(true); // Показать индикатор загрузки
    contentOutput.placeholder = 'Загрузка содержимого выбранных файлов...';

    try {
      const result = await window.electronAPI.getFileContent(selectedFiles);
      contentOutput.value = result.content;
      copyContentBtn.disabled = !result.content;

      if (result.errors && result.errors.length > 0) {
           const errorMessages = result.errors.map(e => `${e.path}: ${e.message}`).join('; ');
           contentStatusBar.textContent = `Обнаружены ошибки при чтении ${result.errors.length} файлов. Детали: ${errorMessages}`;
      } else {
           contentStatusBar.textContent = `Содержимое ${selectedFiles.length} файлов загружено.`;
      }

    } catch (error) {
      console.error("Error getting file content:", error);
      contentOutput.value = `Ошибка загрузки содержимого: ${error.message}`;
      contentStatusBar.textContent = `Критическая ошибка загрузки содержимого.`;
      copyContentBtn.disabled = true;
    } finally {
      setContentLoadIndicator(false); // Скрыть индикатор загрузки
      contentOutput.placeholder = 'Содержимое выбранных файлов появится здесь...';
    }

  } else {
    contentOutput.placeholder = 'Выберите файлы в дереве слева, чтобы увидеть их содержимое.';
    copyContentBtn.disabled = true;
    setContentLoadIndicator(false);
    contentStatusBar.textContent = '';
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
            stack.push({
                node: children[i],
                indent: '',
                isLast: i === children.length - 1,
            });
        }
    } else {
        return output;
    }
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
                stack.push({
                    node: children[i],
                    indent: childIndentBase,
                    isLast: i === children.length - 1,
                });
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
        await window.electronAPI.copyToClipboard(text);
        buttonElement.textContent = successMessage;
        setTimeout(() => {
            if (buttonElement) {
                 buttonElement.textContent = originalText;
                 if (buttonElement === copyStructureBtn && structureOutput.value) {
                     buttonElement.disabled = false;
                 } else if (buttonElement === copyContentBtn && contentOutput.value) {
                     buttonElement.disabled = false;
                 } else {
                     buttonElement.disabled = true;
                 }
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
                 } else {
                    buttonElement.disabled = true;
                 }
            }
        }, 2000);
    }
}

// --- Функции для новых фич ---

// Фильтрация дерева файлов
function filterTree(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    const allNodes = fileTreeContainer.querySelectorAll('li'); // Получаем все LI элементы

    if (!term) {
        // Если поиск пуст, показываем все узлы и убираем подсветку
        allNodes.forEach(li => {
            li.classList.remove('hidden-node', 'search-match');
            const label = li.querySelector(':scope > label');
            if (label) label.classList.remove('search-match'); // Убираем подсветку с label тоже
        });
        return;
    }

    allNodes.forEach(li => {
        const label = li.querySelector(':scope > label'); // Ищем label только прямого потомка
        const nameSpan = label ? label.querySelector('.node-name') : null;
        const nodeName = nameSpan ? nameSpan.textContent.toLowerCase().trim() : '';
        const isMatch = nodeName.includes(term);

        // Сначала скрываем все узлы
        li.classList.add('hidden-node');
        li.classList.remove('search-match'); // Убираем подсветку с LI
         if (label) label.classList.remove('search-match'); // Убираем подсветку с label

        // Если узел соответствует поиску
        if (isMatch) {
            li.classList.remove('hidden-node'); // Показываем сам узел
             if (label) label.classList.add('search-match'); // Подсвечиваем label найденного элемента

            // Показываем всех его родительских LI
            let parentLi = li.parentElement.closest('li');
            while (parentLi) {
                parentLi.classList.remove('hidden-node');
                // Также раскрываем родительские UL, если они были свернуты
                const parentUl = parentLi.querySelector(':scope > ul');
                if (parentUl) parentUl.classList.remove('collapsed');

                parentLi = parentLi.parentElement.closest('li');
            }
             // Раскрываем UL самого найденного элемента, если это папка
             const ownUl = li.querySelector(':scope > ul');
             if (ownUl) ownUl.classList.remove('collapsed');
        }
    });
}


// Развернуть или свернуть все узлы дерева
function toggleAllNodes(expand) {
    // Находим все UL внутри контейнера, КРОМЕ самого корневого UL
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

// Сохранить путь последней папки
function saveLastFolderPath(path) {
    if (path) {
        try {
            localStorage.setItem(LAST_FOLDER_KEY, path);
        } catch (e) {
            console.warn("Не удалось сохранить путь в localStorage:", e);
        }
    }
}

// Загрузить и отобразить путь последней папки
function displayLastFolderPath() {
    try {
        const lastPath = localStorage.getItem(LAST_FOLDER_KEY);
        if (lastPath) {
            lastFolderInfoSpan.innerHTML = `Последняя папка: <span title="${lastPath}">${truncatePath(lastPath)}</span> `;
            const loadBtn = document.createElement('button');
            loadBtn.textContent = 'Загрузить';
            loadBtn.title = `Загрузить ${lastPath}`;
            loadBtn.onclick = async () => {
                 statusBar.textContent = `Загрузка последней папки: ${lastPath}...`;
                 setScanIndicator(true);
                 resetUI(false);
                 try {
                    // **** НУЖНА ДОРАБОТКА В MAIN.JS ****
                    // Нужен API для сканирования по заданному пути
                    console.warn("Загрузка последней папки: Нужен API scanDroppedFolder или аналогичный в main.js");
                    statusBar.textContent = `Ошибка: Функция загрузки последней папки не реализована в main.js. Выберите папку вручную.`;
                     // const result = await window.electronAPI.scanDroppedFolder(lastPath);
                     // if (result.success) {
                     //    await handleFolderSelected(result.path, result.tree);
                     // } else {
                     //     statusBar.textContent = `Ошибка загрузки последней папки: ${result.error || 'Неизвестная ошибка'}`;
                     //     localStorage.removeItem(LAST_FOLDER_KEY); // Удаляем невалидный путь
                     //     displayLastFolderPath(); // Обновляем отображение
                     //     resetUI();
                     // }
                 } catch(error) {
                    console.error("Error loading last folder:", error);
                    statusBar.textContent = `Критическая ошибка загрузки последней папки: ${error.message}`;
                    resetUI();
                 } finally {
                    setScanIndicator(false);
                 }
            };
            lastFolderInfoSpan.appendChild(loadBtn);
        } else {
            lastFolderInfoSpan.innerHTML = '';
        }
    } catch (e) {
        console.warn("Не удалось получить путь из localStorage:", e);
        lastFolderInfoSpan.innerHTML = '';
    }
}

// Утилита для сокращения длинного пути
function truncatePath(path, maxLength = 50) {
    if (!path) return '';
    if (path.length <= maxLength) {
        return path;
    }
    // Пытаемся сократить середину пути
    const separator = path.includes('\\') ? '\\' : '/'; // Определяем разделитель
    const parts = path.split(separator);
    if (parts.length > 2) {
        let truncated = parts[0] + separator + '...' + separator + parts[parts.length - 1];
        // Если все еще слишком длинно, просто обрезаем конец
        if (truncated.length > maxLength) {
             truncated = '...' + path.substring(path.length - maxLength + 3);
        }
        return truncated;
    } else {
        // Если всего 1-2 части, обрезаем конец
        return '...' + path.substring(path.length - maxLength + 3);
    }
}