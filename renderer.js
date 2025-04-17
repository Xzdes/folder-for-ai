// renderer.js

// Получаем ссылки на элементы DOM
const selectFolderBtn = document.getElementById('select-folder-btn');
const statusBar = document.getElementById('status-bar');
const fileTreeContainer = document.getElementById('file-tree-container');
const structureOutput = document.getElementById('structure-output');
const contentOutput = document.getElementById('content-output');
const copyStructureBtn = document.getElementById('copy-structure-btn');
const copyContentBtn = document.getElementById('copy-content-btn');
const contentStatusBar = document.getElementById('content-status-bar');

let currentRootPath = null; // Храним путь к выбранной корневой папке
let currentTreeData = null; // Храним полное дерево данных

// --- Обработчики событий ---

// Нажатие кнопки "Выбрать папку"
selectFolderBtn.addEventListener('click', async () => {
  statusBar.textContent = 'Выбор папки...';
  resetUI();

  try {
    const result = await window.electronAPI.selectFolder();

    if (result.success) {
      currentRootPath = result.path;
      currentTreeData = result.tree;
      statusBar.textContent = `Корневая папка: ${currentRootPath}`;

      // 1. Отобразить дерево (итеративно)
      renderFileTreeIterative(currentTreeData, fileTreeContainer);

      // 2. Сгенерировать и показать структуру (итеративно)
      const structureText = generateStructureTextIterative(currentTreeData);
      structureOutput.value = structureText;
      copyStructureBtn.disabled = false;

      contentOutput.value = '';
      copyContentBtn.disabled = true;
      contentStatusBar.textContent = '';

    } else {
      statusBar.textContent = `Ошибка: ${result.error || 'Не удалось выбрать папку'}`;
      resetUI();
    }
  } catch (error) {
      console.error("Error during folder selection or processing:", error);
      statusBar.textContent = `Критическая ошибка: ${error.message}`;
      resetUI();
  }
});

// Нажатие кнопки "Копировать структуру"
copyStructureBtn.addEventListener('click', async () => {
  await copyToClipboard(structureOutput.value, copyStructureBtn, 'Скопировано!');
});

// Нажатие кнопки "Копировать содержимое"
copyContentBtn.addEventListener('click', async () => {
    await copyToClipboard(contentOutput.value, copyContentBtn, 'Скопировано!');
});


// --- Функции ---

function resetUI() {
    fileTreeContainer.innerHTML = '<p>Нажмите "Выбрать корневую папку...", чтобы начать.</p>';
    structureOutput.value = '';
    contentOutput.value = '';
    copyStructureBtn.disabled = true;
    copyContentBtn.disabled = true;
    contentStatusBar.textContent = '';
    currentRootPath = null;
    currentTreeData = null;
}

// ИТЕРАТИВНАЯ функция для отрисовки дерева файлов
function renderFileTreeIterative(rootNode, containerElement) {
    containerElement.innerHTML = ''; // Очищаем контейнер
    const stack = []; // Используем стек для имитации рекурсии

    // Начинаем с дочерних узлов корневого элемента
    if (rootNode && rootNode.children) {
        // Добавляем детей в стек в обратном порядке, чтобы обработать их в прямом
        // Каждый элемент стека: { node: узел данных, parentElement: DOM-элемент родителя }
        const initialUl = document.createElement('ul');
        containerElement.appendChild(initialUl);
        for (let i = rootNode.children.length - 1; i >= 0; i--) {
            stack.push({ node: rootNode.children[i], parentElement: initialUl });
        }
    }

    while (stack.length > 0) {
        const { node, parentElement } = stack.pop(); // Берем узел из стека

        // Создаем элементы DOM для текущего узла
        const li = document.createElement('li');
        const label = document.createElement('label');
        label.classList.add('item-label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.path = node.path;
        checkbox.dataset.isDirectory = node.isDirectory;
        checkbox.checked = false;
        checkbox.disabled = node.ignored || !!node.error;

        if(node.isDirectory) label.classList.add('is-directory');
        if(node.ignored) label.classList.add('is-ignored');
        if(node.error) label.classList.add('has-error');

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${node.name}`));
        if (node.error) {
            label.title = `Ошибка доступа: ${node.error}`;
        } else if (node.ignored) {
            label.title = `Игнорируется по умолчанию`;
        }

        li.appendChild(label);
        parentElement.appendChild(li); // Добавляем в DOM

        // Добавляем обработчик изменения состояния чекбокса
        checkbox.addEventListener('change', handleCheckboxChange);

        // Если это папка и у нее есть дети (и она не игнорируется/без ошибок)
        if (node.isDirectory && node.children && node.children.length > 0 && !node.ignored && !node.error) {
            // Создаем новый UL для детей внутри текущего LI
            const childUl = document.createElement('ul');
            li.appendChild(childUl);
            // Добавляем детей этой папки в стек для дальнейшей обработки (в обратном порядке)
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push({ node: node.children[i], parentElement: childUl });
            }
        }
    }
}

// Обработчик изменения состояния чекбокса (остается без изменений)
function handleCheckboxChange(event) {
  const checkbox = event.target;
  const isChecked = checkbox.checked;
  const isDirectory = checkbox.dataset.isDirectory === 'true';

  if (isDirectory) {
    const childCheckboxes = checkbox.closest('li').querySelectorAll('input[type="checkbox"]');
    childCheckboxes.forEach(childCb => {
      if (childCb !== checkbox && !childCb.disabled) {
        childCb.checked = isChecked;
      }
    });
  }
  updateContentOutput();
}

// Функция для обновления текстового поля с содержимым (остается без изменений)
async function updateContentOutput() {
  const selectedFiles = [];
  const allCheckboxes = fileTreeContainer.querySelectorAll('input[type="checkbox"]:checked');

  allCheckboxes.forEach(cb => {
    if (cb.dataset.isDirectory === 'false' && !cb.disabled) {
      selectedFiles.push(cb.dataset.path);
    }
  });

  contentOutput.value = '';
  contentStatusBar.textContent = '';

  if (selectedFiles.length > 0) {
    copyContentBtn.disabled = true;
    contentOutput.placeholder = 'Загрузка содержимого выбранных файлов...';
    try {
        const result = await window.electronAPI.getFileContent(selectedFiles);
        contentOutput.value = result.content;
        copyContentBtn.disabled = !result.content;

        if (result.errors && result.errors.length > 0) {
             contentStatusBar.textContent = `Обнаружены ошибки при чтении ${result.errors.length} файлов.`;
        } else {
             contentStatusBar.textContent = `Содержимое ${selectedFiles.length} файлов загружено.`;
        }

    } catch (error) {
        console.error("Error getting file content:", error);
        contentOutput.value = `Ошибка загрузки содержимого: ${error.message}`;
        contentStatusBar.textContent = `Ошибка загрузки содержимого.`;
        copyContentBtn.disabled = true;
    } finally {
         contentOutput.placeholder = 'Содержимое выбранных файлов появится здесь...';
    }

  } else {
    contentOutput.placeholder = 'Выберите файлы в дереве слева, чтобы увидеть их содержимое.';
    copyContentBtn.disabled = true;
    contentStatusBar.textContent = '';
  }
}

// ИТЕРАТИВНАЯ функция для генерации текстовой структуры папки
function generateStructureTextIterative(rootNode) {
    if (!rootNode) return '';

    let output = `${rootNode.name}/\n`; // Начинаем с имени корневой папки
    const stack = []; // Стек для узлов и их префиксов/отступов
    // Элемент стека: { node: узел, indent: отступ, isLast: последний ли элемент в своей группе }

    // Добавляем детей корневого узла в стек (в обратном порядке)
    if (rootNode.children) {
        for (let i = rootNode.children.length - 1; i >= 0; i--) {
            stack.push({
                node: rootNode.children[i],
                indent: '', // Начальный отступ пуст
                isLast: i === rootNode.children.length - 1,
            });
        }
    }

    while (stack.length > 0) {
        const { node, indent, isLast } = stack.pop();

        const prefix = isLast ? '└── ' : '├── ';
        const childIndentBase = indent + (isLast ? '    ' : '│   '); // Базовый отступ для детей

        // Формируем строку для текущего узла
        output += `${indent}${prefix}${node.name}`;
        if (node.isDirectory) output += '/';
        if (node.ignored) output += ' (ignored)';
        if (node.error) output += ` (Error: ${node.error})`;
        output += '\n';

        // Если это папка и у нее есть дети, добавляем их в стек
        if (node.isDirectory && node.children && node.children.length > 0) {
            // Добавляем детей в стек (в обратном порядке для правильной обработки)
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push({
                    node: node.children[i],
                    indent: childIndentBase, // Используем рассчитанный отступ
                    isLast: i === node.children.length - 1,
                });
            }
        }
    }

    return output;
}

// Вспомогательная функция для копирования в буфер обмена (остается без изменений)
async function copyToClipboard(text, buttonElement, successMessage) {
    if (!text) return;

    const originalText = buttonElement.textContent;
    try {
        await window.electronAPI.copyToClipboard(text);
        buttonElement.textContent = successMessage;
        buttonElement.disabled = true;
        setTimeout(() => {
            buttonElement.textContent = originalText;
            buttonElement.disabled = false;
        }, 1500);
    } catch (err) {
        console.error('Ошибка копирования: ', err);
        statusBar.textContent = 'Ошибка при копировании в буфер обмена.';
        buttonElement.textContent = 'Ошибка!';
         setTimeout(() => {
            buttonElement.textContent = originalText;
            buttonElement.disabled = false;
        }, 2000);
    }
}