// renderer.js
// --- Получаем ссылки на элементы DOM ---
const selectFolderBtn = document.getElementById('select-folder-btn');
const statusBar = document.getElementById('status-bar');
const fileTreeContainer = document.getElementById('file-tree-container');
const searchInput = document.getElementById('search-input');
const typeFilterInput = document.getElementById('type-filter-input'); // Новая ссылка
const expandAllBtn = document.getElementById('expand-all-btn');
const collapseAllBtn = document.getElementById('collapse-all-btn');
const scanIndicator = document.getElementById('scan-indicator');
const lastFolderInfoSpan = document.getElementById('last-folder-info');
const structureOutput = document.getElementById('structure-output');
const copyStructureBtn = document.getElementById('copy-structure-btn');
const draggableFilesContainer = document.getElementById('draggable-files-container');
const selectedFilesCountSpan = document.getElementById('selected-files-count');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
// НОВАЯ ССЫЛКА на кнопку закрытия
const windowCloseBtn = document.getElementById('window-close-btn');
const windowMinBtn = document.getElementById('window-min-btn'); // НОВАЯ ССЫЛКА
const windowMaxBtn = document.getElementById('window-max-btn'); // НОВАЯ ССЫЛКА

// --- Глобальные переменные состояния ---
let currentRootPath = null;
let currentTreeData = null;
const LAST_FOLDER_KEY = 'lastSelectedFolderPath';

// --- Инициализация при загрузке ---
document.addEventListener('DOMContentLoaded', () => {
    displayLastFolderPath();
    resetUI();
    initializeTheme(); // Инициализация темы
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
            resetUI();
        }
    } catch (error) {
        console.error("Error during folder selection via dialog:", error);
        statusBar.textContent = `Критическая ошибка выбора папки: ${error.message}`;
        resetUI();
    } finally {
        setScanIndicator(false);
    }
});

// 2. Копирование структуры
copyStructureBtn.addEventListener('click', async () => {
  await copyToClipboard(structureOutput.value, copyStructureBtn, 'Структура скопирована!');
});

// 3. Изменение чекбокса в дереве
fileTreeContainer.addEventListener('change', (event) => {
    if (event.target.type === 'checkbox') {
        handleCheckboxChange(event);
    }
});

// 4. Поиск/Фильтрация в дереве
let searchTimeout;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        filterTree(searchInput.value, typeFilterInput.value); // Обновляем вызов filterTree
    }, 300);
});

// Новый обработчик для фильтра по типу
let typeFilterTimeout;
typeFilterInput.addEventListener('input', () => {
    clearTimeout(typeFilterTimeout);
    typeFilterTimeout = setTimeout(() => {
        filterTree(searchInput.value, typeFilterInput.value); // Обновляем вызов filterTree
    }, 300);
});

// 5. Развернуть/Свернуть все
expandAllBtn.addEventListener('click', () => toggleAllNodes(true));
collapseAllBtn.addEventListener('click', () => toggleAllNodes(false));

// 6. Обработчик начала перетаскивания из области файлов (без изменений)
draggableFilesContainer.addEventListener('dragstart', (event) => {
    const targetItem = event.target.closest('.draggable-file-item');
    if (targetItem) {
        console.log('Renderer: Drag started for item:', targetItem.dataset.filePath);
        const fileItems = draggableFilesContainer.querySelectorAll('.draggable-file-item');
        const filePaths = Array.from(fileItems).map(item => item.dataset.filePath).filter(path => !!path);

        if (filePaths.length > 0) {
            console.log(`Renderer: Initiating drag for ${filePaths.length} files.`);
            event.dataTransfer.effectAllowed = 'copy';
            window.electronAPI.startDrag(filePaths);
        } else {
            console.warn('Renderer: No valid file paths found in draggable container to start drag.');
            event.preventDefault();
        }
    } else {
        console.log('Renderer: Drag start ignored, not on a draggable item.');
         event.preventDefault();
    }
});

// 7. НОВЫЙ Обработчик клика по кнопке Закрыть окно
if (windowCloseBtn) {
    windowCloseBtn.addEventListener('click', () => {
        console.log('Renderer: Close button clicked.');
        window.electronAPI.windowClose(); // Вызываем API для закрытия
    });
}

// НОВЫЕ Обработчики для кнопок Свернуть и Развернуть/Восстановить
if (windowMinBtn) {
    windowMinBtn.addEventListener('click', () => {
        console.log('Renderer: Minimize button clicked.');
        window.electronAPI.windowMinimize();
    });
}

if (windowMaxBtn) {
    windowMaxBtn.addEventListener('click', () => {
        console.log('Renderer: Maximize/Restore button clicked.');
        window.electronAPI.windowMaximize();
    });
}


// 8. НОВЫЙ Обработчик клика по кнопке Сменить тему
if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
        toggleTheme();
    });
}

// --- Функции для управления темой ---
const THEME_KEY = 'selectedTheme';

function initializeTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme) {
        applyTheme(savedTheme);
    } else {
        // Если тема не сохранена, проверяем системные предпочтения
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(prefersDark ? 'dark' : 'light');
    }
}

function applyTheme(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem(THEME_KEY, themeName);
    console.log(`Renderer: Theme applied: ${themeName}`);
    if (themeToggleBtn) {
        themeToggleBtn.textContent = themeName === 'dark' ? 'Светлая тема' : 'Темная тема';
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
}

// --- Основные функции ---

// Обработка успешно выбранной/сканированной папки
async function handleFolderSelected(folderPath, treeData) {
    console.log(`Renderer: Handling selected/scanned folder: ${folderPath}`);

    currentRootPath = folderPath;
    currentTreeData = treeData;
    statusBar.textContent = `Корневая папка: ${currentRootPath}`;
    saveLastFolderPath(currentRootPath);
    displayLastFolderPath();

    resetUI(false);

    renderFileTreeIterative(currentTreeData, fileTreeContainer);

    const structureText = generateStructureTextIterative(currentTreeData);
    structureOutput.value = structureText;
    copyStructureBtn.disabled = !structureText;

    updateDraggableFilesArea();
    filterTree(searchInput.value, typeFilterInput.value); // Применяем фильтры после рендеринга
}


// Сброс интерфейса в начальное состояние
function resetUI(clearStatus = true) {
    console.log(`Renderer: Resetting UI. clearStatus=${clearStatus}`);
    if (clearStatus) {
        statusBar.textContent = 'Папка не выбрана';
        currentRootPath = null;
        currentTreeData = null;
    }

    fileTreeContainer.innerHTML = '<p>Нажмите "Выбрать корневую папку...", чтобы начать.</p>';
    searchInput.value = '';
    typeFilterInput.value = ''; // Сбрасываем фильтр по типу

    structureOutput.value = '';
    structureOutput.placeholder = 'Структура папки появится здесь...';
    copyStructureBtn.disabled = true;

    draggableFilesContainer.innerHTML = '<p class="placeholder-text">Выберите файлы в дереве слева. Они появятся здесь для перетаскивания.</p>';
    updateSelectedFilesCount(0);

    setScanIndicator(false);
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

// ИТЕРАТИВНАЯ функция для отрисовки дерева файлов (без изменений)
function renderFileTreeIterative(rootNode, containerElement) {
    containerElement.innerHTML = ''; if (!rootNode || !rootNode.name) { containerElement.innerHTML = '<p>Не удалось загрузить структуру папки.</p>'; console.error("Invalid root node provided:", rootNode); return; } const stack = []; const initialUl = document.createElement('ul'); containerElement.appendChild(initialUl); if (rootNode.children && rootNode.children.length > 0) { for (let i = rootNode.children.length - 1; i >= 0; i--) { stack.push({ node: rootNode.children[i], parentElement: initialUl, level: 0 }); } } else { containerElement.innerHTML = '<p>Папка пуста или недоступна.</p>'; return; } while (stack.length > 0) { const { node, parentElement, level } = stack.pop(); const li = document.createElement('li'); li.dataset.path = node.path; const label = document.createElement('label'); label.classList.add('item-label'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.path = node.path; checkbox.dataset.isDirectory = node.isDirectory; checkbox.checked = false; checkbox.disabled = node.ignored || !!node.error; if (node.isDirectory) label.classList.add('is-directory'); if (node.ignored) label.classList.add('is-ignored'); if (node.error) label.classList.add('has-error'); if (node.error) { label.title = `Ошибка доступа: ${node.error}`; } else if (node.ignored) { label.title = `Игнорируется по умолчанию`; } else { label.title = node.relativePath || node.name; } label.appendChild(checkbox); const nameSpan = document.createElement('span'); nameSpan.classList.add('node-name'); nameSpan.textContent = ` ${node.name}`; label.appendChild(nameSpan); li.appendChild(label); parentElement.appendChild(li); if (node.isDirectory && node.children && node.children.length > 0 && !node.ignored && !node.error) { const childUl = document.createElement('ul'); li.appendChild(childUl); for (let i = node.children.length - 1; i >= 0; i--) { stack.push({ node: node.children[i], parentElement: childUl, level: level + 1 }); } } } 
    // Применяем фильтры после первоначального рендеринга, если они есть
    if (searchInput.value || typeFilterInput.value) {
        filterTree(searchInput.value, typeFilterInput.value);
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
    childCheckboxes.forEach(childCb => { if (!childCb.disabled) { childCb.checked = isChecked; } });
  }

  setTimeout(updateDraggableFilesArea, 0);
}

// Обновление счетчика выбранных файлов
function updateSelectedFilesCount(count) {
    if (count === undefined) {
        const selectedCheckboxes = fileTreeContainer.querySelectorAll('input[type="checkbox"]:checked:not([data-is-directory="true"]):not(:disabled)');
        count = selectedCheckboxes.length;
    }
    if (selectedFilesCountSpan) {
        selectedFilesCountSpan.textContent = count;
    }
}


// Функция для обновления области перетаскиваемых файлов (без изменений)
function updateDraggableFilesArea() {
    console.log("Renderer: Updating draggable files area.");
    const selectedFiles = [];
    const allCheckedCheckboxes = fileTreeContainer.querySelectorAll('input[type="checkbox"]:checked');
    allCheckedCheckboxes.forEach(cb => {
        if (cb.dataset.isDirectory === 'false' && !cb.disabled) {
            selectedFiles.push({
                path: cb.dataset.path,
                name: cb.closest('label')?.querySelector('.node-name')?.textContent.trim() || cb.dataset.path.split(/[\\/]/).pop()
            });
        }
    });
    updateSelectedFilesCount(selectedFiles.length);
    draggableFilesContainer.innerHTML = '';
    if (selectedFiles.length > 0) {
        selectedFiles.forEach(fileInfo => {
            const fileElement = document.createElement('div');
            fileElement.classList.add('draggable-file-item');
            fileElement.draggable = true;
            fileElement.dataset.filePath = fileInfo.path;
            fileElement.textContent = fileInfo.name;
            fileElement.title = fileInfo.path;
            draggableFilesContainer.appendChild(fileElement);
        });
        console.log(`Renderer: Added ${selectedFiles.length} items to draggable area.`);
    } else {
        draggableFilesContainer.innerHTML = '<p class="placeholder-text">Выберите файлы в дереве слева. Они появятся здесь для перетаскивания.</p>';
        console.log("Renderer: Draggable area is empty, showing placeholder.");
    }
}

// Функция генерации структуры (без изменений)
function generateStructureTextIterative(rootNode) {
    if (!rootNode || !rootNode.name) {
        console.error("Invalid root node provided for structure generation:", rootNode);
        return 'Ошибка: Невалидный корневой узел.';
    }
    let output = `${rootNode.name}/\n`;
    const stack = [];
    if (rootNode.children && rootNode.children.length > 0) {
        const children = rootNode.children;
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push({ node: children[i], indent: '', isLast: i === children.length - 1 });
        }
    } else {
        return output.trim() + (rootNode.error ? ` (Error: ${rootNode.error})` : '');
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
                stack.push({ node: children[i], indent: childIndentBase, isLast: i === children.length - 1 });
            }
        }
    }
    return output;
}


// Функция копирования (без изменений)
async function copyToClipboard(text, buttonElement, successMessage) {
    if (!text || !buttonElement) return;
    const originalText = buttonElement.textContent;
    buttonElement.disabled = true;
    try {
        await navigator.clipboard.writeText(text);
        buttonElement.textContent = successMessage;
        console.log('Renderer: Text copied to clipboard.');
        setTimeout(() => {
            if (buttonElement) {
                buttonElement.textContent = originalText;
                if (buttonElement === copyStructureBtn && structureOutput.value) {
                    buttonElement.disabled = false;
                }
                 else {
                    buttonElement.disabled = !text;
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
                } else {
                     buttonElement.disabled = true;
                }
            }
        }, 2000);
    }
}


// --- Функции для работы с деревом и localStorage (без изменений) ---
function filterTree(searchTerm, typeTerm) { 
    const term = searchTerm.toLowerCase().trim();
    const type = typeTerm.toLowerCase().trim();
    const allNodes = fileTreeContainer.querySelectorAll('li'); 

    if (!term && !type) { 
        allNodes.forEach(li => { 
            li.classList.remove('hidden-node'); 
            const label = li.querySelector(':scope > label'); 
            if (label) label.classList.remove('search-match'); 
        }); 
        toggleAllNodes(true); 
        return; 
    } 

    allNodes.forEach(li => { 
        const label = li.querySelector(':scope > label'); 
        const nameSpan = label ? label.querySelector('.node-name') : null; 
        const nodeName = nameSpan ? nameSpan.textContent.toLowerCase().trim() : ''; 
        const isDirectory = li.querySelector('input[type="checkbox"]')?.dataset.isDirectory === 'true';

        let nameMatch = true;
        if (term) {
            nameMatch = nodeName.includes(term);
        }

        let typeMatch = true;
        if (type && !isDirectory) { // Фильтр по типу применяется только к файлам
            // Убедимся, что тип начинается с точки, если пользователь ее не ввел
            const normalizedType = type.startsWith('.') ? type : '.' + type;
            typeMatch = nodeName.endsWith(normalizedType);
        } else if (type && isDirectory) {
            typeMatch = true; // Для директорий фильтр по типу не скрывает их, если имя совпадает
        }

        const isMatch = nameMatch && typeMatch;

        li.classList.add('hidden-node'); 
        if (label) label.classList.remove('search-match'); 

        if (isMatch) { 
            li.classList.remove('hidden-node'); 
            if (label && term) label.classList.add('search-match'); // Подсветка только для совпадения по имени
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
function toggleAllNodes(expand) { const allUls = fileTreeContainer.querySelectorAll('ul > li > ul'); allUls.forEach(ul => { if (expand) { ul.classList.remove('collapsed'); } else { ul.classList.add('collapsed'); } }); }
function saveLastFolderPath(path) { if (path) { try { localStorage.setItem(LAST_FOLDER_KEY, path); } catch (e) { console.warn("Не удалось сохранить путь в localStorage:", e); } } }
function displayLastFolderPath() { try { const lastPath = localStorage.getItem(LAST_FOLDER_KEY); lastFolderInfoSpan.innerHTML = ''; if (lastPath) { const textSpan = document.createElement('span'); textSpan.textContent = `Последняя папка: `; lastFolderInfoSpan.appendChild(textSpan); const pathSpan = document.createElement('span'); pathSpan.title = lastPath; pathSpan.textContent = truncatePath(lastPath); lastFolderInfoSpan.appendChild(pathSpan); const loadBtn = document.createElement('button'); loadBtn.textContent = 'Загрузить'; loadBtn.title = `Загрузить ${lastPath}`; loadBtn.style.marginLeft = '5px'; loadBtn.onclick = async () => { statusBar.textContent = `Загрузка папки: ${lastPath}...`; setScanIndicator(true); resetUI(false); try { const result = await window.electronAPI.scanFolderPath(lastPath); if (result.success) { await handleFolderSelected(result.path, result.tree); } else { statusBar.textContent = `Ошибка загрузки папки: ${result.error || 'Неизвестная ошибка'}`; const removeInvalid = confirm(`Папку "${lastPath}" не удалось загрузить. Удалить её из истории последних папок?`); if (removeInvalid) { localStorage.removeItem(LAST_FOLDER_KEY); displayLastFolderPath(); } resetUI(); } } catch(error) { console.error("Error loading last folder:", error); statusBar.textContent = `Критическая ошибка загрузки папки: ${error.message}`; resetUI(); } finally { setScanIndicator(false); } }; lastFolderInfoSpan.appendChild(loadBtn); } } catch (e) { console.warn("Не удалось получить путь из localStorage:", e); lastFolderInfoSpan.innerHTML = ''; } }
function truncatePath(path, maxLength = 50) { if (!path) return ''; if (path.length <= maxLength) { return path; } const separator = path.includes('\\') ? '\\' : '/'; const parts = path.split(separator); if (parts.length > 2) { let truncated = parts[0] + separator + '...' + separator + parts[parts.length - 1]; if (truncated.length > maxLength) { truncated = '...' + path.substring(path.length - maxLength + 3); } return truncated; } else { return '...' + path.substring(path.length - maxLength + 3); } }