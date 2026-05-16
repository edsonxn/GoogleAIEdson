// FunciÃƒÂ³n simple para verificar que el script se carga
console.log('Ã°Å¸Å¡â‚¬ Script.js cargado correctamente - VERSIÃƒâ€œN CON FIX DE KEYWORDS v2');

// Variable global para almacenar la estructura de capÃƒÂ­tulos
let globalChapterStructure = [];

// Variable global para almacenar las keywords de cada imagen para el botÃƒÂ³n de refresh
let currentImageKeywords = [];

const IMAGE_MODEL_DEFAULT = 'gemini3';
const IMAGE_MODEL_LABELS = {
  gemini2: 'Gemini 2.0 Flash',
  gemini25: 'Gemini 2.5 Flash',
  gemini3: 'Gemini 3 Flash Preview (Nuevo)'
};

function normalizeImageModel(model) {
  if (!model) {
    return IMAGE_MODEL_DEFAULT;
  }

  const value = String(model).trim().toLowerCase();

  if (value === 'gemini' || value === 'gemini2' || value === 'gemini-2' || value === 'gemini-2.0-flash' || value === 'gemini-2.0') {
    return 'gemini2';
  }

  if (
    value === 'gemini3' ||
    value === 'gemini-3' ||
    value === 'gemini-3-flash-preview' ||
    value === 'gemini-3-flash-preview-image'
  ) {
    return 'gemini3';
  }

  if (
    value === 'gemini25' ||
    value === 'gemini-2.5' ||
    value === 'gemini-2.5-flash' ||
    value === 'gemini-2.5-flash-image'
  ) {
    return 'gemini25';
  }

  return model;
}

function getSelectedImageModel() {
  const select = document.getElementById('imageModelSelect');
  const selectedValue = select?.value;
  const normalized = normalizeImageModel(selectedValue);

  if (select && normalized && normalized !== selectedValue) {
    const hasOption = Array.from(select.options || []).some(option => option.value === normalized);
    if (hasOption) {
      select.value = normalized;
    }
  }

  return normalized || IMAGE_MODEL_DEFAULT;
}

function getImageModelLabel(model) {
  const normalized = normalizeImageModel(model);
  return IMAGE_MODEL_LABELS[normalized] || normalized || IMAGE_MODEL_DEFAULT;
}

// ================================
// VARIABLES GLOBALES PARA GENERACIÃƒâ€œN DE VIDEO
// ================================
let isGeneratingVideo = false;
let currentVideoSession = null;

const clipProgressUiState = {
  sessionId: null,
  pollTimer: null,
  autoHideTimer: null,
  isActive: false,
  lastStatus: null
};

// ================================
// VARIABLES GLOBALES PARA GENERACIÃƒâ€œN DE IMÃƒÂGENES
// ================================
let isGeneratingImages = false;
let isCancellingImages = false;

const sectionImageProgressState = {
  container: null,
  barsWrapper: null,
  summary: null,
  updateToken: 0,
  activeSection: null,
  lastRenderedStats: []
};

let sectionImageProgressPollInterval = null;
const SECTION_IMAGE_PROGRESS_POLL_MS = 1500;

// ================================
// GESTOR DE PROYECTOS MÃƒÅ¡LTIPLES
// ================================
const multiProjectState = {
  container: null,
  addButton: null,
  counter: 1,
  entries: []
};

const PROJECT_COMPLETION_STORAGE_KEY = 'zia-project-completion-v1';
window.userProjectCompletion = window.userProjectCompletion || loadProjectCompletionFromStorage();

function getAdditionalProjectsContainer() {
  if (!multiProjectState.container) {
    multiProjectState.container = document.getElementById('additionalProjectsContainer');
  }
  return multiProjectState.container;
}

function getAddProjectButton() {
  if (!multiProjectState.addButton) {
    multiProjectState.addButton = document.getElementById('addProjectEntryBtn');
  }
  return multiProjectState.addButton;
}

function createProjectEntryElement({ index, folderName = '', topic = '' }) {
  const entry = document.createElement('div');
  entry.className = 'project-entry';
  entry.dataset.projectIndex = String(index);

  const folderId = `projectFolder_${index}`;
  const topicId = `projectTopic_${index}`;

  entry.innerHTML = `
    <input type="hidden" id="${folderId}" class="field-input project-folder-input" data-project-role="folder" value="" />
    <div class="field-group topic-group">
      <label for="${topicId}" class="field-label">
        <i class="fas fa-edit"></i>
        Tema del GuiÃƒÂ³n:
      </label>
      <textarea id="${topicId}" class="topic-textarea project-topic-input" data-project-role="topic" rows="3" placeholder="Describe el guiÃƒÂ³n para este proyecto"></textarea>
    </div>
    <button type="button" class="project-remove-btn" aria-label="Eliminar proyecto">
      <i class="fas fa-times"></i>
    </button>
  `;

  const folderInput = entry.querySelector('.project-folder-input');
  const topicInput = entry.querySelector('.project-topic-input');
  if (folderInput) {
    folderInput.value = folderName;
  }
  if (topicInput) {
    topicInput.value = topic;
  }

  const removeBtn = entry.querySelector('.project-remove-btn');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => removeAdditionalProjectEntry(index));
  }

  return entry;
}

function addAdditionalProjectEntry(defaults = {}) {
  const container = getAdditionalProjectsContainer();
  if (!container) {
    console.warn('Ã¢Å¡Â Ã¯Â¸Â No se encontrÃƒÂ³ el contenedor para proyectos adicionales');
    return;
  }

  const projectIndex = multiProjectState.counter += 1;
  const entryElement = createProjectEntryElement({
    index: projectIndex,
    folderName: defaults.folderName || '',
    topic: defaults.topic || ''
  });

  container.appendChild(entryElement);
  multiProjectState.entries.push({ index: projectIndex, element: entryElement });

  setTimeout(() => {
    const topicInput = entryElement.querySelector('.project-topic-input');
    if (topicInput) {
      topicInput.focus();
    }
  }, 50);
}

function removeAdditionalProjectEntry(index) {
  const container = getAdditionalProjectsContainer();
  if (!container) {
    return;
  }

  const entryRecordIndex = multiProjectState.entries.findIndex(entry => entry.index === index);
  if (entryRecordIndex === -1) {
    return;
  }

  const [{ element }] = multiProjectState.entries.splice(entryRecordIndex, 1);
  if (element && element.parentElement === container) {
    container.removeChild(element);
  }
}

function collectProjectEntries() {
  const projects = [];

  const baseFolderInput = document.getElementById('folderName');
  const baseTopicInput = document.getElementById('prompt');

  if (baseTopicInput) {
    projects.push({
      folderName: baseFolderInput ? baseFolderInput.value.trim() : '',
      topic: baseTopicInput.value.trim(),
      isPrimary: true
    });
  }

  const container = getAdditionalProjectsContainer();
  if (container) {
    container.querySelectorAll('.project-entry').forEach((entryElement) => {
      const folderInput = entryElement.querySelector('[data-project-role="folder"]');
      const topicInput = entryElement.querySelector('[data-project-role="topic"]');
      const folderName = folderInput ? folderInput.value.trim() : '';
      const topic = topicInput ? topicInput.value.trim() : '';

      if (topic.length > 0) {
        projects.push({
          folderName,
          topic,
          isPrimary: false
        });
      }
    });
  }

  return projects;
}

function createSafeFolderName(topic) {
  if (!topic || typeof topic !== 'string') {
    console.warn('Ã¢Å¡Â Ã¯Â¸Â createSafeFolderName recibiÃƒÂ³ valor invÃƒÂ¡lido:', topic);
    return 'proyecto_sin_nombre';
  }
  
  const safeName = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, '') // Remover caracteres especiales, mantener guiones bajos
    .replace(/\s+/g, '_') // Reemplazar espacios con guiones bajos
    .substring(0, 50); // Limitar longitud
    
  console.log(`Ã°Å¸â€œÂ createSafeFolderName: "${topic}" Ã¢â€ â€™ "${safeName}"`);
  return safeName;
}

function normalizeProjectEntries(rawEntries = []) {
  const seenNames = new Set();
  const normalizedProjects = [];

  rawEntries.forEach((entry, index) => {
    if (!entry || !entry.topic || !entry.topic.trim()) {
      return;
    }

    const originalFolderName = entry.folderName ? entry.folderName.trim() : '';
    const baseNameSource = originalFolderName || entry.topic;
    let safeFolderName = createSafeFolderName(baseNameSource);

    if (!safeFolderName) {
      safeFolderName = `project_${index + 1}`;
    }

    let uniqueName = safeFolderName;
    let counter = 2;
    while (seenNames.has(uniqueName)) {
      uniqueName = `${safeFolderName}_${counter}`;
      counter += 1;
    }

    seenNames.add(uniqueName);

    normalizedProjects.push({
      ...entry,
      topic: entry.topic.trim(),
      folderName: uniqueName,
      safeFolderName: uniqueName,
      originalFolderName,
      index
    });
  });

  return normalizedProjects;
}

function triggerParallelProjectGeneration(projects, sharedConfig) {
  if (!Array.isArray(projects) || !projects.length) {
    return Promise.resolve();
  }

  return (async () => {
    try {
      console.log('Ã°Å¸Å¡â‚¬ Lanzando generaciÃƒÂ³n paralela para proyectos adicionales:', {
        proyectos: projects,
        configuracion: sharedConfig
      });

      showNotification(`Ã°Å¸Å¡â‚¬ Iniciando ${projects.length} proyecto(s) adicional(es) en paralelo...`, 'info');

      const response = await fetch('/generate-batch-automatic/multi', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          projects: projects.map((project, projectIndex) => ({
            topic: project.topic,
            folderName: project.folderName,
            originalFolderName: project.originalFolderName,
            isPrimary: Boolean(project.isPrimary),
            projectKey: project.folderName,
            index: projectIndex,
            voice: project.voice || sharedConfig?.voice || sharedConfig?.selectedVoice || null
          })),
          sharedConfig
        })
      });

      const result = await response.json();

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || 'Error iniciando proyectos adicionales');
      }

      // Actualizar las claves de proyecto con las correctas del backend
      if (result.projects && Array.isArray(result.projects)) {
        result.projects.forEach((backendProject, index) => {
          if (projects[index] && backendProject.projectKey) {
            projects[index].projectKey = backendProject.projectKey;
            console.log(`Ã°Å¸â€â€˜ Actualizada clave de proyecto ${index + 1}: ${projects[index].folderName} Ã¢â€ â€™ ${backendProject.projectKey}`);
          }
        });
      }

      const folderSummary = projects.map(project => {
        const topicSnippet = project.topic.length > 60 ? `${project.topic.slice(0, 57)}...` : project.topic;
        return `${topicSnippet} Ã¢â€ â€™ ${project.folderName}`;
      }).join('; ');
      showNotification(`Ã¢Å“â€¦ Proyectos adicionales en proceso: ${folderSummary}`, 'success');
    } catch (error) {
      console.error('Ã¢ÂÅ’ Error lanzando generaciÃƒÂ³n paralela:', error);
      showError(`No se pudieron iniciar los proyectos adicionales: ${error.message}`);
    }
  })();
}

function getGoogleVoiceOptions() {
  const selectElement = document.getElementById('voiceSelect');
  if (!selectElement || !selectElement.options) {
    return [];
  }

  const values = Array.from(selectElement.options)
    .map(option => option?.value?.trim())
    .filter(value => Boolean(value));

  return Array.from(new Set(values));
}

function createRandomVoicePicker(voices = [], fallbackVoice = 'Orus') {
  const sanitizedVoices = Array.isArray(voices) ? voices.filter(Boolean) : [];

  if (!sanitizedVoices.length) {
    return () => fallbackVoice;
  }

  let pool = Array.from(new Set(sanitizedVoices));

  return () => {
    if (!pool.length) {
      pool = Array.from(new Set(sanitizedVoices));
    }

    const index = Math.floor(Math.random() * pool.length);
    const [selected] = pool.splice(index, 1);
    return selected || fallbackVoice;
  };
}

function initializeMultiProjectManager() {
  const addButton = getAddProjectButton();
  if (addButton) {
    addButton.addEventListener('click', () => addAdditionalProjectEntry());
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initializeProjectCompletionState();
  initializeMultiProjectManager();
  
  // Inicializar funcionalidad de colapso del script
  initializeScriptCollapse();
});

const GOOGLE_IMAGE_API_DEFINITIONS = [
  { id: 'GRATIS', label: 'API Gratis 1', type: 'free', badge: 'Gratis' },
  { id: 'GRATIS2', label: 'API Gratis 2', type: 'free', badge: 'Gratis' },
  { id: 'GRATIS3', label: 'API Gratis 3', type: 'free', badge: 'Gratis' },
  { id: 'GRATIS4', label: 'API Gratis 4', type: 'free', badge: 'Gratis' },
  { id: 'GRATIS5', label: 'API Gratis 5', type: 'free', badge: 'Gratis' },
  { id: 'PRINCIPAL', label: 'API Principal', type: 'primary', badge: 'Principal' }
];

const googleApiSelectorState = {
  isLoaded: false,
  isLoading: false,
  available: [],
  selected: new Set(),
  isTemporarilyLocked: false,
  container: null,
  optionsWrapper: null,
  fetchPromise: null
};

let googleApiSelectorLockCount = 0;

function getGoogleApiSelectorElements() {
  if (!googleApiSelectorState.container || !googleApiSelectorState.optionsWrapper) {
    googleApiSelectorState.container = document.getElementById('googleApiSelector');
    googleApiSelectorState.optionsWrapper = document.getElementById('googleApiOptions');
  }

  if (!googleApiSelectorState.container || !googleApiSelectorState.optionsWrapper) {
    return null;
  }

  return {
    container: googleApiSelectorState.container,
    optionsWrapper: googleApiSelectorState.optionsWrapper
  };
}

function ensureDefaultGoogleApiSelection() {
  const selectableApis = googleApiSelectorState.available.filter(api => api.available);
  const validSelections = new Set();

  googleApiSelectorState.selected.forEach(id => {
    const api = selectableApis.find(item => item.id === id);
    if (api) {
      validSelections.add(api.id);
    }
  });

  if (!validSelections.size && selectableApis.length) {
    const defaultApi = selectableApis.find(api => api.defaultSelected) ||
      selectableApis.find(api => api.type === 'free') ||
      selectableApis[0];
    if (defaultApi) {
      validSelections.add(defaultApi.id);
    }
  }

  googleApiSelectorState.selected = validSelections;
}

function createGoogleApiOptionElement(api, disabled) {
  const label = document.createElement('label');
  label.className = 'google-api-option';

  if (disabled) {
    label.classList.add('is-disabled');
  }

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.value = api.id;
  checkbox.checked = googleApiSelectorState.selected.has(api.id);
  checkbox.disabled = disabled || googleApiSelectorState.isTemporarilyLocked;
  checkbox.dataset.permanentDisabled = disabled ? 'true' : 'false';
  checkbox.addEventListener('change', (event) => handleGoogleApiCheckboxChange(event, api));

  const labelSpan = document.createElement('span');
  labelSpan.className = 'api-label';
  labelSpan.textContent = api.label;

  const tag = document.createElement('span');
  tag.className = 'api-tag';
  if (api.type === 'primary') {
    tag.classList.add('api-tag--primary');
    tag.textContent = 'Principal';
  } else {
    tag.textContent = 'Gratis';
  }

  label.appendChild(checkbox);
  label.appendChild(labelSpan);
  label.appendChild(tag);
  if (checkbox.checked) {
    label.classList.add('is-checked');
  }

  return label;
}

function handleGoogleApiCheckboxChange(event, api) {
  const { checked } = event.target;

  if (checked) {
    googleApiSelectorState.selected.add(api.id);
  } else {
    if (googleApiSelectorState.selected.size <= 1) {
      event.target.checked = true;
      googleApiSelectorState.selected.add(api.id);
      showNotification('Debes mantener al menos una API seleccionada para los intentos.', 'warning');
      refreshGoogleApiOptionStyles();
      return;
    }
    googleApiSelectorState.selected.delete(api.id);
  }

  refreshGoogleApiOptionStyles();
}

function renderGoogleApiSelector(error = null) {
  const elements = getGoogleApiSelectorElements();
  if (!elements) {
    return;
  }

  const { container, optionsWrapper } = elements;
  container.style.display = 'flex';
  optionsWrapper.innerHTML = '';

  if (error) {
    const errorMessage = document.createElement('p');
    errorMessage.className = 'google-api-empty';
    errorMessage.textContent = 'No se pudieron cargar las APIs de Google. Intenta recargar la pÃƒÂ¡gina.';
    optionsWrapper.appendChild(errorMessage);
    updateGenerateImagesButtonState();
    return;
  }

  if (!googleApiSelectorState.available.length) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'google-api-empty';
    emptyMessage.textContent = 'No se detectaron APIs de Google configuradas. Configura tus claves en el servidor.';
    optionsWrapper.appendChild(emptyMessage);
    updateGenerateImagesButtonState();
    return;
  }

  googleApiSelectorState.available.forEach((api) => {
    const disabled = !api.available;
    const optionElement = createGoogleApiOptionElement(api, disabled);
    optionsWrapper.appendChild(optionElement);
  });

  container.classList.toggle('is-locked', googleApiSelectorState.isTemporarilyLocked);
  container.style.pointerEvents = googleApiSelectorState.isTemporarilyLocked ? 'none' : '';
  container.style.opacity = googleApiSelectorState.isTemporarilyLocked ? '0.6' : '';
  refreshGoogleApiOptionStyles();
  updateGenerateImagesButtonState();
}

async function initializeGoogleApiSelector(forceReload = false) {
  const elements = getGoogleApiSelectorElements();
  if (!elements) {
    return;
  }

  if (googleApiSelectorState.isLoaded && !forceReload) {
    renderGoogleApiSelector();
    return;
  }

  if (googleApiSelectorState.isLoading && googleApiSelectorState.fetchPromise) {
    try {
      await googleApiSelectorState.fetchPromise;
    } catch (error) {
      // Error ya manejado en la promesa original
    }
    return;
  }

  googleApiSelectorState.isLoading = true;
  googleApiSelectorState.fetchPromise = fetch('/api/google-image-apis')
    .then(async (response) => {
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Error cargando APIs de Google');
      }
      return response.json();
    })
    .then((data) => {
      const apiEntries = Array.isArray(data.apis) ? data.apis : [];
      const normalizedApis = apiEntries.map((api) => {
        const definition = GOOGLE_IMAGE_API_DEFINITIONS.find((item) => item.id === api.id);
        return {
          id: api.id || definition?.id || 'API',
          label: api.label || definition?.label || api.id || 'API',
          type: api.type || definition?.type || 'free',
          available: Boolean(api.available),
          defaultSelected: Boolean(api.defaultSelected)
        };
      });

      googleApiSelectorState.available = normalizedApis;
      googleApiSelectorState.selected = new Set(
        normalizedApis
          .filter((api) => api.available && api.defaultSelected)
          .map((api) => api.id)
      );

      ensureDefaultGoogleApiSelection();
      googleApiSelectorState.isLoaded = true;
      renderGoogleApiSelector();
    })
    .catch((error) => {
      console.error('Ã¢ÂÅ’ Error cargando APIs de Google:', error);
      googleApiSelectorState.available = [];
      googleApiSelectorState.selected = new Set();
      googleApiSelectorState.isLoaded = false;
      renderGoogleApiSelector(error);
    })
    .finally(() => {
      googleApiSelectorState.isLoading = false;
      googleApiSelectorState.fetchPromise = null;
    });

  try {
    await googleApiSelectorState.fetchPromise;
  } catch (error) {
    // Error ya fue manejado
  }
}

async function ensureGoogleApiSelectionReady() {
  if (googleApiSelectorState.isLoaded) {
    return true;
  }

  await initializeGoogleApiSelector();
  return googleApiSelectorState.isLoaded;
}

function getSelectedGoogleApis() {
  return Array.from(googleApiSelectorState.selected);
}

function setGoogleApiCheckboxesDisabled(disabled) {
  if (disabled) {
    googleApiSelectorLockCount += 1;
  } else if (googleApiSelectorLockCount > 0) {
    googleApiSelectorLockCount -= 1;
  }

  const shouldLock = googleApiSelectorLockCount > 0;
  googleApiSelectorState.isTemporarilyLocked = shouldLock;

  const applyState = (state) => {
    const elements = getGoogleApiSelectorElements();
    if (!elements) {
      return;
    }

    elements.container.classList.toggle('is-locked', state);
    elements.container.style.pointerEvents = state ? 'none' : '';
    elements.container.style.opacity = state ? '0.6' : '';

    const checkboxes = elements.container.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((checkbox) => {
      const permanentlyDisabled = checkbox.dataset.permanentDisabled === 'true';
      const nextDisabled = permanentlyDisabled || state;
      checkbox.disabled = nextDisabled;

      if (!nextDisabled) {
        checkbox.removeAttribute('disabled');
      }
    });

    refreshGoogleApiOptionStyles();
    if (!state) {
      updateGenerateImagesButtonState();
    }
  };

  applyState(shouldLock);

  if (!shouldLock) {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => applyState(false));
    }
    setTimeout(() => applyState(false), 150);
    setTimeout(() => applyState(false), 400);
  }
}

function refreshGoogleApiOptionStyles() {
  const elements = getGoogleApiSelectorElements();
  if (!elements) {
    return;
  }

  const { container } = elements;
  container.querySelectorAll('.google-api-option').forEach((label) => {
    const checkbox = label.querySelector('input[type="checkbox"]');
    if (!checkbox) {
      return;
    }

    const permanentlyDisabled = checkbox.dataset.permanentDisabled === 'true';
    if (permanentlyDisabled) {
      label.classList.add('is-disabled');
    } else {
      label.classList.toggle('is-disabled', checkbox.disabled);
    }

    label.classList.toggle('is-checked', checkbox.checked);
  });
}

function updateGenerateImagesButtonState() {
  const generateBtn = document.getElementById('generateMissingImagesBtn');
  if (!generateBtn || isGeneratingImages) {
    return;
  }

  const hasSelectableApis = googleApiSelectorState.available.some((api) => api.available);
  const comfyOnlyMode = document.getElementById('attemptComfyCheckbox')?.checked || false;

  if (!hasSelectableApis && !comfyOnlyMode) {
    generateBtn.disabled = true;
    generateBtn.dataset.disabledNoApis = 'true';
    generateBtn.title = 'Configura al menos una API de Google disponible para generar imÃƒÂ¡genes.';
  } else {
    if (generateBtn.dataset.disabledNoApis === 'true') {
      generateBtn.disabled = false;
    }
    generateBtn.dataset.disabledNoApis = 'false';
    if (!hasSelectableApis && comfyOnlyMode) {
      generateBtn.title = 'Modo Comfy directo activo: se omiten las APIs de Google.';
    } else if (generateBtn.title === 'Configura al menos una API de Google disponible para generar imÃƒÂ¡genes.' || generateBtn.title === 'Modo Comfy directo activo: se omiten las APIs de Google.') {
      generateBtn.title = '';
    }
  }
}

// ================================
// FUNCIÃƒâ€œN PARA MANEJAR SELECTOR NUMÃƒâ€°RICO DE SECCIONES
// ================================
function changeSectionCount(change) {
  const input = document.getElementById('sectionsNumber');
  if (!input) {
    console.error('Ã¢ÂÅ’ No se encontrÃƒÂ³ el campo sectionsNumber');
    return;
  }
  
  // Si el campo estÃƒÂ¡ vacÃƒÂ­o, usar valor por defecto
  const currentValue = parseInt(input.value) || 3;
  const newValue = currentValue + change;
  
  // Verificar lÃƒÂ­mites
  if (newValue < 1 || newValue > 150) {
    console.log(`Ã¢Å¡Â Ã¯Â¸Â Valor fuera de rango: ${newValue}. Rango permitido: 1-150`);
    return;
  }
  
  // Actualizar valor
  input.value = newValue;
  console.log(`Ã°Å¸â€œÅ  Secciones actualizadas via botones: ${newValue}`);
  
  // Actualizar estado de botones
  updateSectionButtons();
}

function updateSectionButtons() {
  const input = document.getElementById('sectionsNumber');
  const decreaseBtn = document.querySelector('.decrease-btn');
  const increaseBtn = document.querySelector('.increase-btn');
  
  if (!input || !decreaseBtn || !increaseBtn) {
    console.error('Ã¢ÂÅ’ No se encontraron elementos del selector numÃƒÂ©rico');
    return;
  }
  
  const inputValue = input.value.trim();
  const currentValue = parseInt(inputValue) || 3; // Default a 3 si no es vÃƒÂ¡lido
  
  // Si el campo estÃƒÂ¡ vacÃƒÂ­o, permitir ambos botones pero con restricciones lÃƒÂ³gicas
  const isEmpty = inputValue === '';
  
  // Deshabilitar botones segÃƒÂºn lÃƒÂ­mites
  decreaseBtn.disabled = !isEmpty && currentValue <= 1;
  increaseBtn.disabled = !isEmpty && currentValue >= 150;
  
  // Actualizar tÃƒÂ­tulos de botones
  if (isEmpty) {
    decreaseBtn.title = 'Disminuir secciones';
    increaseBtn.title = 'Aumentar secciones';
  } else {
    decreaseBtn.title = currentValue <= 1 ? 'MÃƒÂ­nimo 1 secciÃƒÂ³n' : 'Disminuir secciones';
    increaseBtn.title = currentValue >= 150 ? 'MÃƒÂ¡ximo 150 secciones' : 'Aumentar secciones';
  }
}

// Inicializar estado de botones cuando se carga la pÃƒÂ¡gina
document.addEventListener('DOMContentLoaded', function() {
  console.log('Ã°Å¸Å½Â¯ Inicializando selector numÃƒÂ©rico de secciones...');
  updateSectionButtons();
  initializeGoogleApiSelector();
  
  // TambiÃƒÂ©n agregar listener para cambios manuales en el input
  const input = document.getElementById('sectionsNumber');
  if (input) {
    // Evento para validar mientras el usuario escribe
    input.addEventListener('input', function(e) {
      let value = parseInt(this.value);
      
      // Permitir campo vacÃƒÂ­o temporalmente mientras el usuario escribe
      if (this.value === '') {
        updateSectionButtons();
        return;
      }
      
      // Validar rango y corregir si es necesario
      if (isNaN(value) || value < 1) {
        console.log('Ã¢Å¡Â Ã¯Â¸Â Valor corregido a mÃƒÂ­nimo: 1');
        this.value = 1;
        value = 1;
      } else if (value > 150) {
        console.log('Ã¢Å¡Â Ã¯Â¸Â Valor corregido a mÃƒÂ¡ximo: 150');
        this.value = 150;
        value = 150;
      }
      
      updateSectionButtons();
      console.log(`Ã°Å¸â€œÅ  Secciones actualizadas via input: ${value}`);
    });
    
    // Evento para manejar cuando el usuario sale del campo
    input.addEventListener('blur', function(e) {
      // Si el campo estÃƒÂ¡ vacÃƒÂ­o al salir, establecer valor por defecto
      if (this.value === '' || isNaN(parseInt(this.value))) {
        console.log('Ã¢Å¡Â Ã¯Â¸Â Campo vacÃƒÂ­o, estableciendo valor por defecto: 3');
        this.value = 3;
        updateSectionButtons();
      }
    });
    
    // Evento para manejar Enter
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        this.blur(); // Quitar focus para trigger el evento blur
      }
    });
    
    console.log('Ã¢Å“â€¦ Selector numÃƒÂ©rico de secciones inicializado');
  }
});

// ========================================
// SISTEMA DE BARRA DE PROGRESO
// ========================================

// Declarar todas las variables primero
let progressStartTime = null;
let progressInterval = null;
let progressPollingIntervals = new Map();
let currentProjectKey = null;

const PROGRESS_PHASES = ['script', 'audio', 'images'];

const DEFAULT_PHASE_EXPECTATIONS = {
  script: 60,
  audio: 30,
  images: 18
};

const progressEstimation = {
  currentPhase: null,
  currentStepStart: null,
  currentStepCount: 0,
  config: {
    averageWordsPerSection: 300,
    sections: 0,
    audioEnabled: false,
    imagesEnabled: false,
    estimatedImages: 0
  },
  phases: {
    script: createPhaseTimingState(DEFAULT_PHASE_EXPECTATIONS.script, true),
    audio: createPhaseTimingState(DEFAULT_PHASE_EXPECTATIONS.audio, false),
    images: createPhaseTimingState(DEFAULT_PHASE_EXPECTATIONS.images, false)
  }
};

function createPhaseTimingState(expectedSeconds, enabled) {
  return {
    durations: [],
    expectedSeconds,
    totalSteps: 0,
    completed: 0,
    partialElapsed: 0,
    isEnabled: enabled
  };
}

function resetProgressEstimation() {
  progressEstimation.currentPhase = null;
  progressEstimation.currentStepStart = null;
  progressEstimation.currentStepCount = 0;

  PROGRESS_PHASES.forEach(phaseName => {
    const phaseState = progressEstimation.phases[phaseName];
    if (!phaseState) return;
    phaseState.durations = [];
    phaseState.totalSteps = phaseState.isEnabled ? phaseState.totalSteps : 0;
    phaseState.completed = 0;
    phaseState.partialElapsed = 0;
  });
}

function configureProgressEstimation(config = {}) {
  const {
    averageWordsPerSection = 300,
    sections = 0,
    audioEnabled = false,
    imagesEnabled = false,
    estimatedImages = 0
  } = config;

  progressEstimation.config = {
    averageWordsPerSection,
    sections,
    audioEnabled,
    imagesEnabled,
    estimatedImages
  };

  const scriptSeconds = estimateScriptSeconds(averageWordsPerSection);
  const audioSeconds = estimateAudioSeconds(averageWordsPerSection);
  const imageSeconds = estimateImageSeconds(estimatedImages);

  const scriptState = progressEstimation.phases.script;
  scriptState.expectedSeconds = scriptSeconds;
  scriptState.isEnabled = sections > 0;
  scriptState.totalSteps = sections;

  const audioState = progressEstimation.phases.audio;
  audioState.expectedSeconds = audioEnabled ? audioSeconds : 0;
  audioState.isEnabled = audioEnabled;
  audioState.totalSteps = audioEnabled ? sections : 0;

  const imagesState = progressEstimation.phases.images;
  imagesState.expectedSeconds = imagesEnabled ? imageSeconds : 0;
  imagesState.isEnabled = imagesEnabled;
  imagesState.totalSteps = imagesEnabled ? Math.max(estimatedImages, sections) : 0;

  resetProgressEstimation();
}

function estimateScriptSeconds(wordsPerSection) {
  const safeWords = Math.max(150, Number(wordsPerSection) || 300);
  const slope = 1 / 700; // Ã¢â€°Ë†1 minuto para 300 palabras, Ã¢â€°Ë†2 para 1000, Ã¢â€°Ë†5 para 3000
  const intercept = 0.5714;
  const minutes = Math.max(0.6, intercept + slope * safeWords);
  return minutes * 60;
}

function estimateAudioSeconds(wordsPerSection) {
  if (!wordsPerSection) return DEFAULT_PHASE_EXPECTATIONS.audio;
  const baseWords = 300;
  const perChunk = 30; // segundos por 300 palabras
  const multiplier = Math.max(0.5, wordsPerSection / baseWords);
  return perChunk * multiplier;
}

function estimateImageSeconds(totalImages) {
  if (!totalImages || totalImages <= 0) {
    return DEFAULT_PHASE_EXPECTATIONS.images;
  }
  const capped = Math.min(totalImages, 60);
  return 10 + (capped / 10); // entre ~10s y ~16s segÃƒÂºn cantidad
}

function updatePhaseTiming(phase, currentStep, totalSteps) {
  const phaseState = progressEstimation.phases[phase];
  if (!phaseState) {
    return;
  }

  if (totalSteps && totalSteps > 0) {
    phaseState.totalSteps = totalSteps;
  } else if (!phaseState.totalSteps) {
    if (phase === 'script') {
      phaseState.totalSteps = progressEstimation.config.sections;
    } else if (phase === 'audio' && progressEstimation.config.audioEnabled) {
      phaseState.totalSteps = progressEstimation.config.sections;
    } else if (phase === 'images' && progressEstimation.config.imagesEnabled) {
      phaseState.totalSteps = Math.max(progressEstimation.config.estimatedImages, progressEstimation.config.sections);
    }
  }

  const now = Date.now();

  const previousPhase = progressEstimation.currentPhase;

  if (previousPhase !== phase) {
    if (previousPhase && progressEstimation.phases[previousPhase]) {
      const previousState = progressEstimation.phases[previousPhase];
      if (previousState.totalSteps && previousState.completed < previousState.totalSteps) {
        previousState.completed = previousState.totalSteps;
      }
      previousState.partialElapsed = 0;
    }

    progressEstimation.currentPhase = phase;
    progressEstimation.currentStepStart = now;
    progressEstimation.currentStepCount = Math.max(0, currentStep || 0);
    phaseState.partialElapsed = 0;
  } else {
    const previousCount = progressEstimation.currentStepCount;
    const increment = (currentStep || 0) - previousCount;
    if (increment > 0) {
      const elapsed = (now - (progressEstimation.currentStepStart || now)) / Math.max(increment, 1);
      const elapsedSeconds = Math.max(elapsed / 1000, 0);
      for (let i = 0; i < increment; i += 1) {
        phaseState.durations.push(elapsedSeconds);
      }
      progressEstimation.currentStepStart = now;
      progressEstimation.currentStepCount = currentStep;
      phaseState.partialElapsed = 0;
    } else if (progressEstimation.currentStepStart) {
      phaseState.partialElapsed = (now - progressEstimation.currentStepStart) / 1000;
    }
  }

  phaseState.completed = Math.max(phaseState.completed || 0, currentStep || 0);
  if (progressEstimation.currentPhase === phase && progressEstimation.currentStepStart) {
    phaseState.partialElapsed = (now - progressEstimation.currentStepStart) / 1000;
  }
}

function calculateRemainingSeconds(activePhase) {
  if (activePhase === 'completed') {
    return 0;
  }

  const activeIndex = Math.max(PROGRESS_PHASES.indexOf(activePhase), 0);
  let totalRemaining = 0;

  PROGRESS_PHASES.forEach((phaseName, index) => {
    const phaseState = progressEstimation.phases[phaseName];
    if (!phaseState || (!phaseState.isEnabled && phaseState.durations.length === 0)) {
      return;
    }

    const totalSteps = phaseState.totalSteps || 0;
    if (totalSteps <= 0) {
      return;
    }

    const completed = Math.min(phaseState.completed || 0, totalSteps);
    const average = getAverageDuration(phaseState);
    if (average <= 0) {
      return;
    }

    const remainingSteps = Math.max(totalSteps - completed, 0);

    if (index < activeIndex) {
      if (remainingSteps > 0) {
        totalRemaining += remainingSteps * average;
      }
      return;
    }

    if (index === activeIndex) {
      if (remainingSteps <= 0) {
        return;
      }
      const elapsedCurrent = Math.min(phaseState.partialElapsed || 0, average);
      const remainingCurrent = Math.max(average - elapsedCurrent, 0);
      const remainingFullSteps = Math.max(remainingSteps - 1, 0);
      totalRemaining += remainingCurrent + (remainingFullSteps * average);
      return;
    }

    totalRemaining += remainingSteps * average;
  });

  return totalRemaining;
}

function getAverageDuration(phaseState) {
  if (phaseState.durations.length > 0) {
    const sum = phaseState.durations.reduce((acc, value) => acc + value, 0);
    return sum / phaseState.durations.length;
  }
  return Math.max(phaseState.expectedSeconds || 0, 0);
}

function setCurrentTaskIcon(iconClass, spin = false) {
  const iconElement = document.querySelector('#progressContainer .current-task i');
  if (!iconElement) return;
  iconElement.className = `fas ${iconClass}`;
  if (spin) {
    iconElement.classList.add('fa-spin');
  }
}

function formatDurationLabel(value) {
  if (value === null || value === undefined || value === '') {
    return 'Calculando...';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  return String(value);
}

function normalizeStepValue(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0;
}

function clampPercentage(value) {
  const numeric = Number.parseFloat(value);
  if (Number.isFinite(numeric)) {
    return Math.min(100, Math.max(0, numeric));
  }
  return null;
}

function updatePhaseIndicators(activePhase) {
  const normalizedPhase = PROGRESS_PHASES.includes(activePhase)
    ? activePhase
    : activePhase === 'completed'
      ? 'completed'
      : 'script';
  const activeIndex = PROGRESS_PHASES.indexOf(normalizedPhase);

  PROGRESS_PHASES.forEach((phaseName, index) => {
    const phaseElement = document.querySelector(`.phase-item[data-phase="${phaseName}"]`);
    const statusElement = document.getElementById(`phase${phaseName.charAt(0).toUpperCase()}${phaseName.slice(1)}Status`);
    if (!phaseElement || !statusElement) return;

    phaseElement.classList.remove('is-active', 'is-complete', 'is-pending');

    let statusText = 'Pendiente';

    if (normalizedPhase === 'completed') {
      phaseElement.classList.add('is-complete');
      statusText = 'Completado';
    } else if (activeIndex === -1) {
      if (phaseName === 'script') {
        phaseElement.classList.add('is-active');
        statusText = 'En progreso';
      } else {
        phaseElement.classList.add('is-pending');
      }
    } else if (index < activeIndex) {
      phaseElement.classList.add('is-complete');
      statusText = 'Completado';
    } else if (index === activeIndex) {
      phaseElement.classList.add('is-active');
      statusText = 'En progreso';
    } else {
      phaseElement.classList.add('is-pending');
    }

    statusElement.textContent = statusText;
  });
}

// Inicializar cÃƒÂ¡psulas de progreso
function initializeProgressCapsules(containerId = 'progressCapsules') {
  const progressCapsules = document.getElementById(containerId);
  const sectionsNumberElement = document.getElementById('sectionsNumber');
  
  if (!progressCapsules || !sectionsNumberElement) return;
  
  // Limpiar cÃƒÂ¡psulas existentes
  progressCapsules.innerHTML = '';
  
  const totalSections = parseInt(sectionsNumberElement.value) || 3;
  
  // Crear cÃƒÂ¡psulas para cada secciÃƒÂ³n
  for (let i = 0; i < totalSections; i++) {
    const capsule = document.createElement('div');
    capsule.className = 'capsule';
    capsule.dataset.sectionIndex = i;
    progressCapsules.appendChild(capsule);
  }
}

// Actualizar cÃƒÂ¡psulas de progreso
function updateProgressCapsules(currentStep, totalSteps, containerId = 'progressCapsules') {
  const progressCapsules = document.getElementById(containerId);
  if (!progressCapsules) return;
  
  const capsules = progressCapsules.querySelectorAll('.capsule');
  
  // Marcar cÃƒÂ¡psulas completadas hasta currentStep - 1
  capsules.forEach((capsule, index) => {
    if (index < currentStep) {
      capsule.classList.add('completed');
    } else {
      capsule.classList.remove('completed');
    }
  });
}

// Inicializar cÃƒÂ¡psulas de audio
function initializeAudioCapsules(containerId, totalSections) {
  const audioCapsules = document.getElementById(containerId);
  if (!audioCapsules) return;
  
  // Limpiar cÃƒÂ¡psulas existentes
  audioCapsules.innerHTML = '';
  
  // Crear cÃƒÂ¡psulas para cada secciÃƒÂ³n (una por audio)
  for (let i = 0; i < totalSections; i++) {
    const capsule = document.createElement('div');
    capsule.className = 'capsule audio-capsule';
    capsule.dataset.sectionIndex = i;
    audioCapsules.appendChild(capsule);
  }
}

function initializeImageCapsules(projectKey, totalSections, imagesPerSection) {
  for (let section = 1; section <= totalSections; section++) {
    const containerId = `imageCapsules-${projectKey}-section${section}`;
    const imageCapsules = document.getElementById(containerId);
    if (!imageCapsules) continue;
    
    // Limpiar cÃƒÂ¡psulas existentes
    imageCapsules.innerHTML = '';
    
    // Crear cÃƒÂ¡psulas para cada imagen en la secciÃƒÂ³n
    for (let i = 0; i < imagesPerSection; i++) {
      const capsule = document.createElement('div');
      capsule.className = 'capsule image-capsule';
      capsule.dataset.sectionIndex = section - 1;
      capsule.dataset.imageIndex = i;
      imageCapsules.appendChild(capsule);
    }
  }
}

// Actualizar cÃƒÂ¡psulas de audio
function updateAudioCapsules(currentStep, totalSteps, containerId) {
  const audioCapsules = document.getElementById(containerId);
  if (!audioCapsules) return;
  
  const capsules = audioCapsules.querySelectorAll('.audio-capsule');
  
  // Marcar cÃƒÂ¡psulas completadas hasta currentStep - 1
  capsules.forEach((capsule, index) => {
    capsule.classList.remove('completed', 'active');
    
    if (index < currentStep) {
      capsule.classList.add('completed');
    } else if (index === currentStep) {
      capsule.classList.add('active');
    }
  });
}

// Actualizar cÃƒÂ¡psulas de imÃƒÂ¡genes para una secciÃƒÂ³n especÃƒÂ­fica
function updateImageCapsules(projectKey, sectionIndex, completedImages, totalImages) {
  const containerId = `imageCapsules-${projectKey}-section${sectionIndex + 1}`;
  const imageCapsules = document.getElementById(containerId);
  if (!imageCapsules) return;
  
  const capsules = imageCapsules.querySelectorAll('.image-capsule');
  
  // Marcar cÃƒÂ¡psulas completadas
  capsules.forEach((capsule, index) => {
    if (index < completedImages) {
      capsule.classList.add('completed');
    } else {
      capsule.classList.remove('completed');
    }
  });
}

// Contenedores de progreso por proyecto
let projectProgressContainers = new Map();

// Mapa para almacenar projectData por projectKey
let projectDataMap = new Map();

// Crear contenedor de progreso para un proyecto especÃƒÂ­fico
function createProjectProgressContainer(projectKey, projectName, totalSections, includeAudioProgress = false, includeImagesProgress = false, imagesPerSection = 10, projectData = null) {
  const container = document.createElement('div');
  container.className = 'project-progress-container';
  container.id = `progress-${projectKey}`;
  
  let audioProgressHTML = '';
  if (includeAudioProgress) {
    audioProgressHTML = `
    <div class="audio-progress-wrapper">
      <div class="audio-progress-header">
        <i class="fas fa-volume-up"></i>
        <span>Progreso de Audios</span>
        <span class="audio-percentage">0%</span>
      </div>
      <div class="progress-capsules audio-capsules" id="audioCapsules-${projectKey}">
        <!-- CÃƒÂ¡psulas de audio se generarÃƒÂ¡n dinÃƒÂ¡micamente -->
      </div>
      <div class="audio-progress-info">
        <span class="audio-current-task">Esperando generaciÃƒÂ³n de guiones...</span>
      </div>
    </div>
    `;
  }
  
  let imagesProgressHTML = '';
  if (includeImagesProgress) {
    let imagesBarsHTML = '';
    for (let section = 1; section <= totalSections; section++) {
      imagesBarsHTML += `
        <div class="image-section-bar">
          <div class="image-section-header">
            <i class="fas fa-image"></i>
            <span>SecciÃƒÂ³n ${section}</span>
          </div>
          <div class="progress-capsules image-capsules" id="imageCapsules-${projectKey}-section${section}" data-section="${section}">
            <!-- CÃƒÂ¡psulas de imÃƒÂ¡genes se generarÃƒÂ¡n dinÃƒÂ¡micamente -->
          </div>
        </div>
      `;
    }
    
    imagesProgressHTML = `
    <div class="images-progress-wrapper">
      <div class="images-progress-header">
        <i class="fas fa-images"></i>
        <span>Progreso de ImÃƒÂ¡genes</span>
        <span class="images-percentage">0%</span>
      </div>
      <div class="images-sections-container">
        ${imagesBarsHTML}
      </div>
      <div class="images-progress-info">
        <span class="images-current-task">Esperando generaciÃƒÂ³n de guiones...</span>
      </div>
    </div>
    `;
  }
  
  container.innerHTML = `
    <div class="project-progress-header">
      <div class="project-progress-title">
        <i class="fas fa-project-diagram"></i>
        <span>${projectName}</span>
      </div>
      <div class="project-progress-status">
        <span class="project-phase">Iniciando...</span>
        <span class="project-percentage">0%</span>
      </div>
    </div>
    
    <div class="project-time-stats">
      <div class="time-stat">
        <i class="fas fa-clock"></i>
        <span class="time-label">Tiempo:</span>
        <span class="time-value" id="time-elapsed-${projectKey}">00:00</span>
      </div>
      <div class="time-stat">
        <i class="fas fa-hourglass-half"></i>
        <span class="time-label">Estimado:</span>
        <span class="time-value" id="time-remaining-${projectKey}">--:--</span>
      </div>
    </div>

    <div class="progress-bar-wrapper">
      <div class="progress-capsules" id="progressCapsules-${projectKey}">
        <!-- CÃƒÂ¡psulas se generarÃƒÂ¡n dinÃƒÂ¡micamente -->
      </div>
    </div>
    <div class="project-progress-info">
      <span class="project-current-task">Preparando...</span>
    </div>
    ${audioProgressHTML}
    ${imagesProgressHTML}
    <div class="project-section-images-container" id="sectionImagesContainer-${projectKey}" style="display: none;">
      <div class="section-images-header">
        <i class="fas fa-images"></i>
        <span>Generar imÃƒÂ¡genes por secciÃƒÂ³n</span>
      </div>
      <div id="sectionImagesButtons-${projectKey}" class="section-images-grid">
        <!-- Botones de secciÃƒÂ³n se generarÃƒÂ¡n dinÃƒÂ¡micamente -->
      </div>
    </div>
  `;

  // Agregar al DOM
  const outputElement = document.getElementById('output');
  if (outputElement) {
    outputElement.appendChild(container);
  }

  // Inicializar datos del proyecto con tiempo de inicio si no existe
  if (!projectDataMap.has(projectKey)) {
    projectDataMap.set(projectKey, { 
      startTime: Date.now(),
      ...projectData 
    });
  } else {
    // Si ya existe, asegurarnos de que tenga startTime
    const existingData = projectDataMap.get(projectKey);
    if (!existingData.startTime) {
      existingData.startTime = Date.now();
      projectDataMap.set(projectKey, existingData);
    }
  }

  // Inicializar cÃƒÂ¡psulas
  setTimeout(() => {
    initializeProgressCapsules(`progressCapsules-${projectKey}`);
    if (includeAudioProgress) {
      initializeAudioCapsules(`audioCapsules-${projectKey}`, totalSections);
    }
    if (includeImagesProgress) {
      initializeImageCapsules(projectKey, totalSections, imagesPerSection);
    }
  }, 100);

  projectProgressContainers.set(projectKey, container);
  
  // Actualizar mapa de datos preservando startTime si existe
  if (projectData) {
    const existingData = projectDataMap.get(projectKey) || {};
    projectDataMap.set(projectKey, {
      startTime: existingData.startTime || Date.now(),
      ...projectData
    });
  }
  return container;
}

// Formatear tiempo en MM:SS
function formatTime(ms) {
  if (!ms || ms < 0) return '00:00';
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  
  const formattedSeconds = seconds.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');
  
  if (hours > 0) {
    return `${hours}:${formattedMinutes}:${formattedSeconds}`;
  }
  return `${formattedMinutes}:${formattedSeconds}`;
}

// Actualizar progreso de un proyecto especÃƒÂ­fico
function updateProjectProgress(projectKey, data) {
  console.log(`Ã°Å¸â€â€ž [${projectKey}] Actualizando progreso:`, data);
  const container = projectProgressContainers.get(projectKey);
  if (!container) {
    console.error(`Ã¢ÂÅ’ [${projectKey}] Contenedor de progreso no encontrado!`);
    return;
  }

  const { percentage, phase, currentStep, totalSteps, currentTask, audioProgress, imagesProgress } = data;

  // Actualizar tiempos
  const projectData = projectDataMap.get(projectKey);
  if (projectData && projectData.startTime) {
    const elapsedTime = Date.now() - projectData.startTime;
    const timeElapsedElement = container.querySelector(`#time-elapsed-${projectKey}`);
    if (timeElapsedElement) {
      timeElapsedElement.textContent = formatTime(elapsedTime);
    }

    const timeRemainingElement = container.querySelector(`#time-remaining-${projectKey}`);
    if (timeRemainingElement && percentage > 0 && percentage < 100) {
      const estimatedTotalTime = elapsedTime / (percentage / 100);
      const remainingTime = estimatedTotalTime - elapsedTime;
      timeRemainingElement.textContent = formatTime(remainingTime);
    } else if (percentage >= 100) {
      if (timeRemainingElement) timeRemainingElement.textContent = '00:00';
    }
  }

  // Actualizar porcentaje principal
  const percentageElement = container.querySelector('.project-percentage');
  if (percentageElement) {
    const normalizedPercentage = Math.round(clampPercentage(percentage) || 0);
    percentageElement.textContent = `${normalizedPercentage}%`;
  }

  // Actualizar porcentaje de audio si existe
  if (audioProgress) {
    const audioPercentageElement = container.querySelector('.audio-percentage');
    if (audioPercentageElement) {
      const normalizedAudioPercentage = Math.round(clampPercentage(audioProgress.percentage) || 0);
      audioPercentageElement.textContent = `${normalizedAudioPercentage}%`;
    }

    // Actualizar tarea de audio
    const audioTaskElement = container.querySelector('.audio-current-task');
    if (audioTaskElement) {
      audioTaskElement.textContent = audioProgress.currentTask || 'Generando audio...';
    }
  }

  // Actualizar porcentaje de imÃƒÂ¡genes si existe
  if (imagesProgress) {
    const imagesPercentageElement = container.querySelector('.images-percentage');
    if (imagesPercentageElement) {
      const normalizedImagesPercentage = Math.round(clampPercentage(imagesProgress.percentage) || 0);
      imagesPercentageElement.textContent = `${normalizedImagesPercentage}%`;
    }

    // Actualizar tarea de imÃƒÂ¡genes
    const imagesTaskElement = container.querySelector('.images-current-task');
    if (imagesTaskElement) {
      imagesTaskElement.textContent = imagesProgress.currentTask || 'Generando imÃƒÂ¡genes...';
    }
  }

  // Actualizar fase
  const phaseElement = container.querySelector('.project-phase');
  if (phaseElement) {
    const phaseNames = {
      script: 'Generando guiones',
      audio: 'Generando audios',
      images: 'Generando imÃƒÂ¡genes',
      completed: 'Completado'
    };
    phaseElement.textContent = phaseNames[phase] || 'Procesando...';
  }

  // Mostrar botones de secciÃƒÂ³n cuando el proyecto estÃƒÂ© completado o cuando los audios estÃƒÂ©n terminados
  const sectionImagesContainer = container.querySelector(`#sectionImagesContainer-${projectKey}`);
  const sectionImagesButtons = container.querySelector(`#sectionImagesButtons-${projectKey}`);
  if (sectionImagesContainer && sectionImagesButtons) {
    const shouldShowButtons = phase === 'completed' || (phase === 'audio' && audioProgress && audioProgress.percentage >= 100);
    if (shouldShowButtons) {
      const projectData = projectDataMap.get(projectKey);
      const sectionNumbers = getAvailableSectionNumbers(projectData);
      if (sectionNumbers.length > 0) {
        sectionImagesContainer.style.display = 'block';
        sectionImagesButtons.innerHTML = '';
        sectionNumbers.forEach((sectionNumber) => {
          const button = document.createElement('button');
          button.className = 'section-image-btn';
          button.dataset.sectionNumber = sectionNumber.toString();
          button.innerHTML = `
            <i class="fas fa-images"></i>
            <span>SecciÃƒÂ³n ${sectionNumber}</span>
          `;
          button.disabled = !!isGeneratingImages;
          button.addEventListener('click', (event) => handleProjectSectionImageButtonClick(event, projectKey, sectionNumber));
          sectionImagesButtons.appendChild(button);
        });
      } else {
        sectionImagesContainer.style.display = 'none';
      }
    } else {
      sectionImagesContainer.style.display = 'none';
    }
  }

  // Actualizar tarea actual
  const taskElement = container.querySelector('.project-current-task');
  if (taskElement) {
    taskElement.textContent = currentTask || 'Procesando...';
  }

  // Actualizar cÃƒÂ¡psulas si estamos en fase de script o si el proyecto estÃƒÂ¡ completo
  if (phase === 'script') {
    updateProgressCapsules(currentStep, totalSteps, `progressCapsules-${projectKey}`);
  } else if (phase === 'completed') {
    // Si el proyecto estÃƒÂ¡ completo, marcar todas las cÃƒÂ¡psulas como completadas
    updateProgressCapsules(totalSteps, totalSteps, `progressCapsules-${projectKey}`);
  }

  // Actualizar cÃƒÂ¡psulas de audio si estamos en fase de audio
  if (phase === 'audio') {
    updateAudioCapsules(currentStep, totalSteps, `audioCapsules-${projectKey}`);
  } else if (phase === 'completed') {
    // Si el proyecto estÃƒÂ¡ completo, marcar todas las cÃƒÂ¡psulas de audio como completadas
    updateAudioCapsules(totalSteps, totalSteps, `audioCapsules-${projectKey}`);
  }

  // Actualizar cÃƒÂ¡psulas de audio si tenemos progreso de audio especÃƒÂ­fico
  if (audioProgress && audioProgress.currentStep !== undefined) {
    updateAudioCapsules(audioProgress.currentStep, audioProgress.totalSteps || totalSteps, `audioCapsules-${projectKey}`);
  }

  // Actualizar cÃƒÂ¡psulas de imÃƒÂ¡genes si tenemos progreso de imÃƒÂ¡genes especÃƒÂ­fico
  if (imagesProgress && imagesProgress.sections) {
    imagesProgress.sections.forEach((sectionProgress, sectionIndex) => {
      updateImageCapsules(projectKey, sectionIndex, sectionProgress.completedImages, sectionProgress.totalImages);
    });
  }
}

// Remover contenedor de progreso de un proyecto
function removeProjectProgressContainer(projectKey) {
  const container = projectProgressContainers.get(projectKey);
  if (container) {
    container.remove();
    projectProgressContainers.delete(projectKey);
  }
}

// Limpiar todos los contenedores de progreso
function clearAllProjectProgressContainers() {
  projectProgressContainers.forEach((container, projectKey) => {
    container.remove();
  });
  projectProgressContainers.clear();
}

// Mostrar la barra de progreso
function showProgressBar() {
  const progressContainer = document.getElementById('progressContainer');
  const generateBtn = document.getElementById('generateBtn');
  
  if (progressContainer) {
    progressContainer.style.display = 'block';
    progressStartTime = Date.now();
    updateElapsedTime();
    updatePhaseIndicators('script');
    setCurrentTaskIcon('fa-cog', true);
    const taskContainer = document.querySelector('#progressContainer .current-task');
    if (taskContainer) {
      taskContainer.classList.remove('is-error');
    }
    
    // Inicializar cÃƒÂ¡psulas de progreso
    initializeProgressCapsules();
  }
  
  // Ocultar el botÃƒÂ³n de generaciÃƒÂ³n mientras se muestra el progreso
  if (generateBtn) {
    generateBtn.style.display = 'none';
  }
}

// Ocultar la barra de progreso
function hideProgressBar() {
  const progressContainer = document.getElementById('progressContainer');
  const generateBtn = document.getElementById('generateBtn');
  
  if (progressContainer) {
    progressContainer.style.display = 'none';
    // Limpiar cÃƒÂ¡psulas
    const progressCapsules = document.getElementById('progressCapsules');
    if (progressCapsules) {
      progressCapsules.innerHTML = '';
    }
  }
  
  // Limpiar contenedores de progreso de proyectos
  clearAllProjectProgressContainers();
  
  // Detener polling - solo detener el polling general, no los individuales
  // Los polling individuales se detienen cuando se completan los proyectos especÃƒÂ­ficos
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }

  resetProgressEstimation();
}

// Iniciar polling del progreso desde el servidor
function startProgressPolling(projectKey, onProgressUpdate = null) {
  // Limpiar polling anterior para este proyecto si existe
  if (progressPollingIntervals.has(projectKey)) {
    clearInterval(progressPollingIntervals.get(projectKey));
  }
  
  // Hacer polling cada 2 segundos
  const interval = setInterval(async () => {
    try {
      console.log(`Ã°Å¸â€œÅ  [${projectKey}] Polling progreso...`);
      const response = await fetch(`/progress/${projectKey}`);
      const data = await response.json();
      
      console.log(`Ã°Å¸â€œÅ  [${projectKey}] Respuesta del servidor:`, data);
      
      if (data.success && data.progress) {
        const progressData = data.progress;
        
        console.log(`Ã°Å¸â€œÅ  Datos de progreso recibidos:`, {
          fase: progressData.currentPhase,
          porcentaje: progressData.percentage,
          paso: progressData.currentStep,
          total: progressData.totalSteps
        });
        
        // Calcular tarea actual basada en la fase y progreso
        let currentTask = 'Procesando...';
        const currentPhase = progressData.currentPhase || progressData.phase;
        
        if (currentPhase === 'script') {
          currentTask = `Generando guiÃƒÂ³n ${progressData.currentStep}/${progressData.totalSteps}`;
        } else if (currentPhase === 'audio') {
          currentTask = `Generando audio ${progressData.currentStep}/${progressData.totalSteps}`;
        } else if (currentPhase === 'images') {
          currentTask = `Generando imÃƒÂ¡genes ${progressData.currentStep}/${progressData.totalSteps}`;
        }
        
        const progressInfo = {
          percentage: progressData.percentage,
          phase: currentPhase,
          currentStep: progressData.currentStep,
          totalSteps: progressData.totalSteps,
          estimatedTimeRemaining: progressData.estimatedTimeRemaining,
          currentTask: currentTask,
          phases: progressData.phases
        };
        
        // Usar callback personalizado si se proporciona, sino usar updateProgressBar
        if (onProgressUpdate) {
          onProgressUpdate(progressInfo);
        } else {
          updateProgressBar(progressInfo);
        }
        
        // Detener polling si el proyecto estÃƒÂ¡ completo
        if (currentPhase === 'completed' || progressData.percentage >= 100) {
          console.log(`Ã¢Å“â€¦ [${projectKey}] Proyecto completado, deteniendo polling`);
          stopProgressPolling(projectKey);
        }
      } else {
        console.warn(`Ã¢Å¡Â Ã¯Â¸Â [${projectKey}] No se recibieron datos de progreso vÃƒÂ¡lidos:`, data);
      }
    } catch (error) {
      console.error(`Ã¢ÂÅ’ [${projectKey}] Error obteniendo progreso del servidor:`, error);
    }
  }, 2000);
  
  progressPollingIntervals.set(projectKey, interval);
  return interval;
}

// Detener polling del progreso
function stopProgressPolling(projectKey = null) {
  if (projectKey) {
    // Detener polling para un proyecto especÃƒÂ­fico
    const interval = progressPollingIntervals.get(projectKey);
    if (interval) {
      clearInterval(interval);
      progressPollingIntervals.delete(projectKey);
    }
  } else {
    // Detener todos los polling intervals
    progressPollingIntervals.forEach((interval, key) => {
      clearInterval(interval);
    });
    progressPollingIntervals.clear();
  }
}

// Actualizar progreso detallado (Guiones y Audios)
function updateDetailedProgress(phases) {
    // Update Script Progress
    if (phases.script) {
        const scriptCard = document.getElementById('scriptProgressCard');
        const scriptBar = document.getElementById('scriptProgressBar');
        const scriptCount = document.getElementById('scriptCount');
        const scriptStatus = document.getElementById('scriptStatus');
        
        if (scriptCard && scriptBar && scriptCount && scriptStatus) {
            const total = phases.script.total || 0;
            const completed = phases.script.completed || 0;
            const percent = total > 0 ? (completed / total) * 100 : 0;
            
            scriptBar.style.width = `${percent}%`;
            scriptCount.textContent = `${completed}/${total}`;
            
            if (percent === 100) {
                scriptCard.classList.add('completed');
                scriptCard.classList.remove('active');
                scriptStatus.textContent = 'Completado';
            } else if (percent > 0) {
                scriptCard.classList.add('active');
                scriptStatus.textContent = 'Generando...';
            } else {
                scriptCard.classList.remove('active', 'completed');
                scriptStatus.textContent = 'Pendiente';
            }
        }
    }

    // Update Audio Progress
    if (phases.audio) {
        const audioCard = document.getElementById('audioProgressCard');
        const audioBar = document.getElementById('audioProgressBar');
        const audioCount = document.getElementById('audioCount');
        const audioStatus = document.getElementById('audioStatus');
        
        if (audioCard && audioBar && audioCount && audioStatus) {
            const total = phases.audio.total || 0;
            const completed = phases.audio.completed || 0;
            const percent = total > 0 ? (completed / total) * 100 : 0;
            
            audioBar.style.width = `${percent}%`;
            audioCount.textContent = `${completed}/${total}`;
            
            if (percent === 100) {
                audioCard.classList.add('completed');
                audioCard.classList.remove('active');
                audioStatus.textContent = 'Completado';
            } else if (percent > 0) {
                audioCard.classList.add('active');
                audioStatus.textContent = 'Generando...';
            } else {
                audioCard.classList.remove('active', 'completed');
                audioStatus.textContent = 'Pendiente';
            }
        }
    }
}

// Actualizar la barra de progreso
function updateProgressBar(data) {
  const { percentage, phase, currentStep, totalSteps, estimatedTimeRemaining, currentTask, phases } = data;

  // Actualizar tarjetas de progreso detallado si hay datos de fases
  if (phases) {
    updateDetailedProgress(phases);
  }

  const progressCapsules = document.getElementById('progressCapsules');
  const progressPercentage = document.getElementById('progressPercentage');

  const totalStepsNumber = normalizeStepValue(totalSteps);
  const currentStepNumber = Math.min(normalizeStepValue(currentStep), totalStepsNumber || normalizeStepValue(currentStep));

  const normalizedPhase = PROGRESS_PHASES.includes(phase)
    ? phase
    : phase === 'completed'
      ? 'completed'
      : 'script';

  if (PROGRESS_PHASES.includes(normalizedPhase)) {
    updatePhaseTiming(normalizedPhase, currentStepNumber, totalStepsNumber);
  }

  // Actualizar cÃƒÂ¡psulas si estamos en fase de script (solo para compatibilidad con cÃƒÂ³digo antiguo)
  // Nota: El nuevo sistema usa updateProjectProgress con contenedores especÃƒÂ­ficos
  // if (normalizedPhase === 'script' && progressCapsules) {
  //   updateProgressCapsules(currentStepNumber, totalStepsNumber);
  // }

  if (progressPercentage) {
    let normalizedPercentage = clampPercentage(percentage);
    if (normalizedPercentage === null) {
      if (totalStepsNumber > 0) {
        normalizedPercentage = Math.min(100, Math.max(0, (currentStepNumber / totalStepsNumber) * 100));
      } else {
        normalizedPercentage = 0;
      }
    }

    progressPercentage.textContent = `${Math.round(normalizedPercentage)}%`;
  }

  updatePhaseIndicators(normalizedPhase);

  const currentPhaseElement = document.getElementById('currentPhase');
  if (currentPhaseElement) {
    const phaseNames = {
      script: 'Generando textos',
      audio: 'Generando audios',
      images: 'Generando imÃƒÂ¡genes',
      completed: 'GeneraciÃƒÂ³n finalizada'
    };
    currentPhaseElement.textContent = phaseNames[normalizedPhase] || 'Procesando...';
  }

  const currentProgress = document.getElementById('currentProgress');
  if (currentProgress) {
    if (totalStepsNumber > 0) {
      currentProgress.textContent = `${currentStepNumber} / ${totalStepsNumber}`;
    } else {
      currentProgress.textContent = '-- / --';
    }
  }

  const estimatedTime = document.getElementById('estimatedTime');
  if (estimatedTime) {
    let remainingSeconds = null;
    if (normalizedPhase === 'completed') {
      remainingSeconds = 0;
    } else if (PROGRESS_PHASES.includes(normalizedPhase)) {
      remainingSeconds = calculateRemainingSeconds(normalizedPhase);
    }

    if (Number.isFinite(remainingSeconds) && remainingSeconds >= 0) {
      estimatedTime.textContent = formatDurationLabel(remainingSeconds);
    } else {
      estimatedTime.textContent = formatDurationLabel(estimatedTimeRemaining);
    }
  }

  const currentTaskElement = document.getElementById('currentTask');
  if (currentTaskElement) {
    const safeTask = typeof currentTask === 'string' && currentTask.trim() !== ''
      ? currentTask
      : 'Procesando...';
    currentTaskElement.textContent = safeTask;
  }
}

// Actualizar tiempo transcurrido
function updateElapsedTime() {
  if (!progressStartTime) return;
  
  const elapsedTimeElement = document.getElementById('elapsedTime');
  if (elapsedTimeElement) {
    const elapsed = Date.now() - progressStartTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    elapsedTimeElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

// Inicializar contador de tiempo
function startElapsedTimeCounter() {
  if (progressInterval) {
    clearInterval(progressInterval);
  }
  progressInterval = setInterval(updateElapsedTime, 1000);
}

// Resetear la barra de progreso
function resetProgressBar() {
  setCurrentTaskIcon('fa-cog', true);
  const taskContainer = document.querySelector('#progressContainer .current-task');
  if (taskContainer) {
    taskContainer.classList.remove('is-error');
  }
  resetProgressEstimation();
  updateProgressBar({
    percentage: 0,
    phase: 'script',
    currentStep: 0,
    totalSteps: 0,
    estimatedTimeRemaining: 'Calculando...',
    currentTask: 'Preparando generaciÃƒÂ³n...',
    phases: {
        script: { total: 0, completed: 0 },
        audio: { total: 0, completed: 0 }
    }
  });
  progressStartTime = null;
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

// Completar la barra de progreso
function completeProgressBar(message = 'GeneraciÃƒÂ³n completada') {
  updateProgressBar({
    percentage: 100,
    phase: 'completed',
    currentStep: 1,
    totalSteps: 1,
    estimatedTimeRemaining: 0,
    currentTask: message
  });
  const taskContainer = document.querySelector('#progressContainer .current-task');
  if (taskContainer) {
    taskContainer.classList.remove('is-error');
  }
  setCurrentTaskIcon('fa-check-circle');
  
  // Solo detener polling si no hay mÃƒÂºltiples proyectos (para compatibilidad con sistema antiguo)
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (!hasMultipleProjects) {
    // Detener polling solo para el sistema antiguo de un solo proyecto
    stopProgressPolling();
    
    // Ocultar despuÃƒÂ©s de 3 segundos solo para proyectos ÃƒÂºnicos
    setTimeout(() => {
      hideProgressBar();
    }, 3000);
  }
}

// Mostrar error en la barra de progreso
function showProgressError(error) {
  const taskContainer = document.querySelector('#progressContainer .current-task');
  if (taskContainer) {
    taskContainer.classList.add('is-error');
  }
  const currentTaskElement = document.getElementById('currentTask');
  if (currentTaskElement) {
    currentTaskElement.textContent = `Error: ${error}`;
  }
  setCurrentTaskIcon('fa-exclamation-triangle');
  
  // Solo detener polling si no hay mÃƒÂºltiples proyectos (para compatibilidad con sistema antiguo)
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (!hasMultipleProjects) {
    // Detener polling solo para el sistema antiguo de un solo proyecto
    stopProgressPolling();
    
    // Ocultar despuÃƒÂ©s de 5 segundos solo para proyectos ÃƒÂºnicos
    setTimeout(() => {
      hideProgressBar();
    }, 5000);
  }
}

// ================================
// FUNCIONES PARA MANEJO DE VOCES DE APPLIO
// ================================

// Variable global para almacenar las voces disponibles
let availableApplioVoices = [];

// FunciÃƒÂ³n para cargar las voces disponibles de Applio
async function loadApplioVoices() {
  try {
    console.log('Ã°Å¸Å½Â¤ Cargando voces de Applio...');
    const response = await fetch('/api/applio-voices');
    const data = await response.json();
    
    if (data.success && data.voices) {
      availableApplioVoices = data.voices;
      console.log(`Ã¢Å“â€¦ Cargadas ${data.voices.length} voces de Applio`);
      
      // Actualizar el dropdown
      updateApplioVoicesDropdown();
      
      return true;
    } else {
      console.error('Ã¢ÂÅ’ Error en respuesta de voces:', data);
      return false;
    }
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error cargando voces de Applio:', error);
    return false;
  }
}

// FunciÃƒÂ³n para actualizar el dropdown de voces
function updateApplioVoicesDropdown() {
  const select = document.getElementById('applioVoiceSelect');
  if (!select) {
    console.error('Ã¢ÂÅ’ No se encontrÃƒÂ³ el dropdown de voces de Applio');
    return;
  }
  
  // Limpiar opciones existentes
  select.innerHTML = '';
  
  // Agregar voces disponibles
  if (availableApplioVoices.length > 0) {
    availableApplioVoices.forEach(voice => {
      const option = document.createElement('option');
      option.value = voice.path;
      option.textContent = voice.displayName;
      select.appendChild(option);
    });
    console.log(`Ã°Å¸â€œÂ Dropdown actualizado con ${availableApplioVoices.length} voces`);
  } else {
    // OpciÃƒÂ³n por defecto si no hay voces
    const option = document.createElement('option');
    option.value = 'logs\\VOCES\\RemyOriginal.pth';
    option.textContent = 'RemyOriginal (Default)';
    select.appendChild(option);
    console.log('Ã°Å¸â€œÂ Dropdown con voz por defecto');
  }
}

// FunciÃƒÂ³n para mostrar/ocultar el dropdown de voces segÃƒÂºn la casilla de Applio
function toggleApplioVoiceDropdown() {
  const checkbox = document.getElementById('autoGenerateApplioAudio');
  const voiceGroup = document.getElementById('applioVoiceGroup');
  
  if (!checkbox || !voiceGroup) {
    console.error('Ã¢ÂÅ’ No se encontraron elementos de Applio');
    return;
  }
  
  if (checkbox.checked) {
    console.log('Ã°Å¸Å½Â¤ Activando selector de voces de Applio...');
    voiceGroup.style.display = 'flex';
    
    // Cargar voces si no se han cargado aÃƒÂºn
    if (availableApplioVoices.length === 0) {
      loadApplioVoices();
    }
  } else {
    console.log('Ã°Å¸â€â€¡ Ocultando selector de voces de Applio...');
    voiceGroup.style.display = 'none';
  }
}

function updateRandomVoiceSelectionUI() {
  const voiceSelect = document.getElementById('voiceSelect');
  const randomCheckbox = document.getElementById('randomGoogleVoice');

  if (!voiceSelect || !randomCheckbox) {
    return;
  }

  const isRandomEnabled = Boolean(randomCheckbox.checked);

  if (isRandomEnabled) {
    if (!voiceSelect.dataset.manualVoice) {
      voiceSelect.dataset.manualVoice = voiceSelect.value;
    }
    voiceSelect.disabled = true;
    voiceSelect.classList.add('is-disabled');
    voiceSelect.title = 'La voz se elegirÃƒÂ¡ automÃƒÂ¡ticamente para cada proyecto.';
  } else {
    voiceSelect.disabled = false;
    voiceSelect.classList.remove('is-disabled');
    voiceSelect.title = '';

    if (voiceSelect.dataset.manualVoice) {
      voiceSelect.value = voiceSelect.dataset.manualVoice;
      delete voiceSelect.dataset.manualVoice;
    }
  }
}

// FunciÃƒÂ³n para mostrar/ocultar las configuraciones de voz Google segÃƒÂºn la casilla correspondiente
function toggleGoogleVoiceDropdown() {
  const checkbox = document.getElementById('autoGenerateAudio');
  const voiceGroup = document.getElementById('googleVoiceGroup');
  
  if (!checkbox || !voiceGroup) {
    console.error('Ã¢ÂÅ’ No se encontraron elementos de Google Voice');
    return;
  }
  
  if (checkbox.checked) {
    console.log('Ã°Å¸Å½Âµ Activando configuraciones de voz Google...');
    voiceGroup.style.display = 'block';
  } else {
    console.log('Ã°Å¸â€â€¡ Ocultando configuraciones de voz Google...');
    voiceGroup.style.display = 'none';
  }

  updateRandomVoiceSelectionUI();
}

// Inicializar eventos para Applio cuando se carga la pÃƒÂ¡gina
document.addEventListener('DOMContentLoaded', function() {
  console.log('Ã°Å¸Å½Â¤ Inicializando controles de Applio...');
  
  const applioCheckbox = document.getElementById('autoGenerateApplioAudio');
  if (applioCheckbox) {
    // Agregar evento para mostrar/ocultar dropdown
    applioCheckbox.addEventListener('change', toggleApplioVoiceDropdown);
    
    // Verificar estado inicial
    toggleApplioVoiceDropdown();
    
    console.log('Ã¢Å“â€¦ Controles de Applio inicializados');
  } else {
    console.error('Ã¢ÂÅ’ No se encontrÃƒÂ³ la casilla de Applio');
  }

  // Inicializar control de velocidad
  const speedSlider = document.getElementById('applioSpeed');
  const speedValue = document.getElementById('speedValue');

  if (speedSlider && speedValue) {
    speedValue.textContent = speedSlider.value;
    speedSlider.addEventListener('input', function() {
      speedValue.textContent = this.value;
      console.log(`Ã°Å¸Å¡â‚¬ Velocidad ajustada a: ${this.value}`);
    });

    console.log('Ã¢Å“â€¦ Control de velocidad inicializado');
  } else {
    console.error('Ã¢ÂÅ’ No se encontraron elementos del control de velocidad');
  }

  // Inicializar control de pitch
  const pitchSlider = document.getElementById('applioPitch');
  const pitchValue = document.getElementById('pitchValue');
  
  if (pitchSlider && pitchValue) {
    pitchValue.textContent = pitchSlider.value;
    pitchSlider.addEventListener('input', function() {
      pitchValue.textContent = this.value;
      console.log(`Ã°Å¸Å½Âµ Pitch ajustado a: ${this.value}`);
    });
    
    console.log('Ã¢Å“â€¦ Control de pitch inicializado');
  } else {
    console.error('Ã¢ÂÅ’ No se encontraron elementos del pitch slider');
  }

  // Inicializar controles de Google Voice
  console.log('Ã°Å¸Å½Âµ Inicializando controles de Google Voice...');
  
  const googleCheckbox = document.getElementById('autoGenerateAudio');
  if (googleCheckbox) {
    // Agregar evento para mostrar/ocultar configuraciones de voz Google
    googleCheckbox.addEventListener('change', toggleGoogleVoiceDropdown);
    
    // Verificar estado inicial
    toggleGoogleVoiceDropdown();
    
    console.log('Ã¢Å“â€¦ Controles de Google Voice inicializados');
  } else {
    console.error('Ã¢ÂÅ’ No se encontrÃƒÂ³ la casilla de Google Audio');
  }

  const randomCheckbox = document.getElementById('randomGoogleVoice');
  if (randomCheckbox) {
    randomCheckbox.addEventListener('change', updateRandomVoiceSelectionUI);
    updateRandomVoiceSelectionUI();
  }
});

// ================================
// VARIABLES GLOBALES PARA PROYECTOS - INICIALIZACIÃƒâ€œN INMEDIATA
// ================================
if (typeof window.currentProject === 'undefined') {
  window.currentProject = null;
}
if (typeof window.availableProjects === 'undefined') {
  window.availableProjects = [];
}

// ================================
// VARIABLES GLOBALES PARA PROYECTOS - INICIALIZACIÃƒâ€œN ÃƒÅ¡NICA
// ================================
if (typeof window.currentProject === 'undefined') {
  window.currentProject = null;
}
if (typeof window.availableProjects === 'undefined') {
  window.availableProjects = [];
}

console.log('Ã¢Å“â€¦ Variables globales de proyectos inicializadas:', {
  currentProject: window.currentProject,
  availableProjects: window.availableProjects
});

// DEBUG: Verificar elementos de miniatura al cargar
setTimeout(() => {
  console.log('Ã°Å¸â€Â DEBUG: Verificando elementos de miniatura...');
  const createBtn = document.getElementById('createThumbnailStyleFromSidebar');
  const manageBtn = document.getElementById('manageThumbnailStylesFromSidebar');
  
  console.log('createThumbnailStyleFromSidebar:', createBtn);
  console.log('manageThumbnailStylesFromSidebar:', manageBtn);
  
  if (createBtn) {
    console.log('Ã¢Å“â€¦ BotÃƒÂ³n crear miniatura encontrado, agregando click manual...');
    createBtn.onclick = function() {
      console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Click en crear miniatura detectado');
      openThumbnailStyleModal();
    };
  }
  
  if (manageBtn) {
    console.log('Ã¢Å“â€¦ BotÃƒÂ³n gestionar miniatura encontrado, agregando click manual...');
    manageBtn.onclick = function() {
      console.log('Ã°Å¸â€Â§ Click en gestionar miniatura detectado');
      openManageThumbnailStylesModal();
    };
  }
}, 2000);

// Variables globales para el extractor de texto
let selectedFile = null;
let extractedText = '';

// Inicializar funcionalidad de extracciÃƒÂ³n de texto tan pronto como sea posible
document.addEventListener('DOMContentLoaded', function() {
  console.log('Ã°Å¸Å’Â DOM cargado - iniciando extractor de texto...');
  initializeTextExtractor();
});

// TambiÃƒÂ©n intentar inicializar despuÃƒÂ©s de que todo se cargue
setTimeout(() => {
  console.log('Ã¢ÂÂ° Timeout - verificando si el extractor necesita inicializaciÃƒÂ³n...');
  if (!window.extractorInitialized) {
    console.log('Ã°Å¸â€â€ž Inicializando extractor de texto desde timeout...');
    initializeTextExtractor();
  }
}, 1000);

// Verificar que elementos existen al cargar
window.addEventListener('load', function() {
  console.log('Ã°Å¸Å’Â Ventana cargada completamente');
  
  // Verificar elementos importantes
  const elements = {
    'createStyleBtn': document.getElementById('createStyleFromSidebar'),
    'manageStylesBtn': document.getElementById('manageStylesFromSidebar'),
    'styleSelect': document.getElementById('styleSelect'),
    'styleModal': document.getElementById('styleModal'),
    'manageStylesModal': document.getElementById('manageStylesModal'),
    'extractTextBtn': document.getElementById('extractTextBtn'),
    'extractTextModal': document.getElementById('extractTextModal')
  };
  
  console.log('Ã°Å¸â€Â VerificaciÃƒÂ³n de elementos:', elements);
  
  // Verificar si faltan elementos
  Object.keys(elements).forEach(key => {
    if (!elements[key]) {
      console.error(`Ã¢ÂÅ’ Elemento faltante: ${key}`);
    } else {
      console.log(`Ã¢Å“â€¦ Elemento encontrado: ${key}`);
    }
  });
  
  // Intentar inicializar el extractor de texto nuevamente si no se hizo antes
  if (document.getElementById('extractTextBtn') && !window.extractorInitialized) {
    console.log('Ã°Å¸â€â€ž Inicializando extractor de texto desde window.load...');
    initializeTextExtractor();
  }
});

const generateBtn = document.getElementById("generateBtn");
const generateAudioBtn = document.getElementById("generateAudioBtn");
const promptInput = document.getElementById("prompt");
const output = document.getElementById("output");

// Variables para el carrusel y secciones
let currentSlide = 0;
let totalSlides = 0;
let currentScript = '';
let currentVoice = '';
let currentTopic = '';
let currentSectionNumber = 1;
let totalSections = 3;
let allSections = []; // Almacenar todas las secciones generadas con datos completos (script, tÃƒÂ­tulo, tokens)
let imagePrompts = []; // Almacenar los prompts de las imÃƒÂ¡genes
let isAutoGenerating = false; // Bandera para la generaciÃƒÂ³n automÃƒÂ¡tica
let isLoadingProject = false; // Bandera para evitar validaciones durante la carga de proyectos
let isMetadataShown = false; // Bandera para evitar mostrar metadatos duplicados

// Variables globales para estilos de miniatura
let customThumbnailStyles = [];
let currentEditingThumbnailStyleId = null;

// Estilos predeterminados de miniatura
const defaultThumbnailStyles = {
  'default': {
    name: 'Amarillo y Blanco (Predeterminado)',
    description: 'Estilo clÃƒÂ¡sico con texto amarillo y blanco',
    primaryColor: 'amarillo',
    secondaryColor: 'blanco',
    instructions: 'El texto que se muestre debe de tener 2 colores, letras llamativas y brillosas con efecto luminoso, la frase menos importante de color blanco, la frase importante color amarillo, todo con contorno negro, letras brillosas con resplandor'
  },
  'gaming_red': {
    name: 'Rojo Gaming',
    description: 'Estilo gaming agresivo con rojos brillantes',
    primaryColor: 'rojo brillante',
    secondaryColor: 'blanco',
    instructions: 'El texto debe tener un estilo gaming agresivo con la frase principal en rojo brillante intenso y la secundaria en blanco, ambas con contorno negro grueso y efecto de resplandor rojo'
  },
  'neon_blue': {
    name: 'Azul NeÃƒÂ³n',
    description: 'Estilo futurista con azul neÃƒÂ³n y efectos cyberpunk',
    primaryColor: 'azul neÃƒÂ³n',
    secondaryColor: 'cyan claro',
    instructions: 'El texto debe tener un estilo futurista cyberpunk con la frase principal en azul neÃƒÂ³n brillante y la secundaria en cyan claro, con contorno oscuro y efectos de resplandor azul neÃƒÂ³n'
  },
  'retro_purple': {
    name: 'PÃƒÂºrpura Retro',
    description: 'Estilo retro gaming con pÃƒÂºrpura y rosa',
    primaryColor: 'pÃƒÂºrpura brillante',
    secondaryColor: 'rosa',
    instructions: 'El texto debe tener un estilo retro gaming de los 80s con la frase principal en pÃƒÂºrpura brillante y la secundaria en rosa, con contorno negro y efectos de resplandor pÃƒÂºrpura'
  }
};

// FunciÃƒÂ³n para la generaciÃƒÂ³n automÃƒÂ¡tica completa
async function runAutoGeneration() {
  console.log("Ã°Å¸Â¤â€“ Iniciando generaciÃƒÂ³n automÃƒÂ¡tica completa");
  
  // Verificar que los elementos del DOM estÃƒÂ©n disponibles
  const requiredElements = [
    'maxWords', 'styleSelect', 'imagesSelect', 'aspectRatioSelect', 
    'promptModifier', 'llmModelSelect', 
    'googleImages', 'localAIImages'
  ];
  
  const missingElements = requiredElements.filter(id => !document.getElementById(id));
  if (missingElements.length > 0) {
    console.error("Ã¢ÂÅ’ Elementos del DOM faltantes:", missingElements);
    showError(`Error: No se encontraron los siguientes elementos: ${missingElements.join(', ')}`);
    return;
  }
  
  isAutoGenerating = true;
  
  const normalizedProjects = normalizeProjectEntries(collectProjectEntries());
  if (!normalizedProjects.length) {
    showError('Agrega al menos un tema antes de iniciar la generaciÃƒÂ³n automÃƒÂ¡tica.');
    isAutoGenerating = false;
    return;
  }

  // Generar nombres de carpeta con LLM para proyectos sin nombre explÃ­cito
  for (const project of normalizedProjects) {
    if (!project.originalFolderName && project.topic) {
      try {
        const nameRes = await fetch('/api/generate-folder-name', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: project.topic })
        });
        const nameData = await nameRes.json();
        if (nameData.name) {
          project.folderName = nameData.name;
          project.safeFolderName = nameData.name;
        }
      } catch (e) {
        console.log('âš ï¸ No se pudo generar nombre con LLM, usando fallback:', e.message);
      }
    }
  }

  const primaryIndex = normalizedProjects.findIndex(project => project.isPrimary);
  const resolvedPrimaryIndex = primaryIndex >= 0 ? primaryIndex : 0;
  const primaryProject = normalizedProjects[resolvedPrimaryIndex];
  const parallelProjects = normalizedProjects.filter((project, index) => index !== resolvedPrimaryIndex);

  const folderInputElement = document.getElementById("folderName");
  if (folderInputElement) {
    const displayFolderName = primaryProject.originalFolderName || primaryProject.folderName;
    folderInputElement.value = displayFolderName;
    folderInputElement.dataset.safeFolderName = primaryProject.folderName;
  }

  if (promptInput) {
    promptInput.value = primaryProject.topic;
  }

  const topic = primaryProject.topic;
  const folderName = primaryProject.folderName;
  const voiceSelectElement = document.getElementById("voiceSelect");
  const manualSelectedVoice = voiceSelectElement?.value || 'Orus';
  const narrationStyle = document.getElementById("narrationStyle")?.value?.trim() || '';
  const selectedSections = document.getElementById("sectionsNumber").value;
  const minWords = parseInt(document.getElementById("minWords").value) || 800;
  const maxWords = parseInt(document.getElementById("maxWords")?.value) || 1100;
  const selectedStyle = document.getElementById("styleSelect")?.value || 'default';
  const imageCount = parseInt(document.getElementById("imagesSelect")?.value) || 5;
  const aspectRatio = document.getElementById("aspectRatioSelect")?.value || '16:9';
  const promptModifier = document.getElementById("promptModifier")?.value?.trim() || '';
  const selectedImageModel = getSelectedImageModel();
  const selectedLlmModel = document.getElementById("llmModelSelect")?.value || 'gemini';
  let googleImages = document.getElementById("googleImages")?.checked || false;
  let localAIImages = document.getElementById("localAIImages")?.checked || false;
  const comfyOnlyMode = document.getElementById('attemptComfyCheckbox')?.checked || false;

  if (comfyOnlyMode && !localAIImages) {
    localAIImages = true;
  }
  
  console.log("Ã°Å¸â€“Â¼Ã¯Â¸Â ConfiguraciÃƒÂ³n de imÃƒÂ¡genes:");
  console.log("  - Google Images:", googleImages);
  console.log("  - Local AI Images (ComfyUI):", localAIImages);
  console.log("  - Modelo seleccionado:", getImageModelLabel(selectedImageModel));
  
  // Calcular automÃƒÂ¡ticamente skipImages: true si NO hay opciones de imÃƒÂ¡genes activas
  let skipImages = !googleImages && !localAIImages;
  console.log("  - Skip Images:", skipImages);
  
  const generateAudio = document.getElementById("autoGenerateAudio").checked;
  let generateApplioAudio = document.getElementById("autoGenerateApplioAudio").checked;
  const selectedApplioVoice = document.getElementById("applioVoiceSelect").value;
  const selectedApplioModel = document.getElementById("applioModelSelect").value;
  const applioPitch = parseInt(document.getElementById("applioPitch").value) || 0;
  const applioSpeed = parseInt(document.getElementById("applioSpeed").value) || 0;

  const applioQueueRunId = generateApplioAudio
    ? `applio-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
    : null;

  const randomVoiceCheckbox = document.getElementById("randomGoogleVoice");
  const randomVoiceEnabled = Boolean(generateAudio && randomVoiceCheckbox?.checked);
  const availableGoogleVoices = getGoogleVoiceOptions();
  const useRandomVoices = randomVoiceEnabled && availableGoogleVoices.length > 0;
  const randomVoicePicker = useRandomVoices
    ? createRandomVoicePicker(availableGoogleVoices, manualSelectedVoice)
    : null;
  const voiceAssignmentsMap = new Map();

  if (randomVoiceEnabled && !availableGoogleVoices.length) {
    console.warn('Ã¢Å¡Â Ã¯Â¸Â Se solicitÃƒÂ³ voz aleatoria pero no hay opciones disponibles en el selector. Se usarÃƒÂ¡ la voz seleccionada manualmente.');
  }

  const pickVoiceForProject = () => {
    if (useRandomVoices && randomVoicePicker) {
      return randomVoicePicker();
    }
    return manualSelectedVoice;
  };

  const effectivePrimaryVoice = pickVoiceForProject();
  voiceAssignmentsMap.set(primaryProject.folderName, effectivePrimaryVoice);

  parallelProjects.forEach(project => {
    const assignedVoice = pickVoiceForProject();
    voiceAssignmentsMap.set(project.folderName, assignedVoice);
  });

  const voiceAssignments = Object.fromEntries(voiceAssignmentsMap);

  if (voiceSelectElement) {
    voiceSelectElement.value = effectivePrimaryVoice;
  }
  currentVoice = effectivePrimaryVoice;

  if (useRandomVoices) {
    console.log('Ã°Å¸Å½Â² Voces aleatorias asignadas por proyecto:', voiceAssignments);
  }

  const parallelProjectsWithVoices = parallelProjects.map(project => ({
    ...project,
    voice: voiceAssignmentsMap.get(project.folderName) || effectivePrimaryVoice
  }));
  
  // Ã°Å¸â€Â§ VALIDACIÃƒâ€œN SIMPLIFICADA: Las imÃƒÂ¡genes se pueden generar con cualquier combinaciÃƒÂ³n
  // Prioridad: Si estÃƒÂ¡ activada IA Local, usar ComfyUI; si estÃƒÂ¡ Google Images, usar APIs de Google
  console.log(`Ã°Å¸â€Å  GeneraciÃƒÂ³n de audio Google: ${generateAudio ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`Ã°Å¸Å½Â¤ GeneraciÃƒÂ³n de audio Applio: ${generateApplioAudio ? 'ACTIVADA' : 'DESACTIVADA'}`);
  if (generateApplioAudio) {
    console.log(`Ã°Å¸Å½â„¢Ã¯Â¸Â Voz Applio seleccionada: ${selectedApplioVoice}`);
    console.log(`Ã°Å¸Å½Å¡Ã¯Â¸Â Modelo Applio: ${selectedApplioModel}`);
    console.log(`Ã°Å¸Å¡â‚¬ Velocidad Applio: ${applioSpeed}`);
    console.log(`Ã°Å¸Å½Âµ Pitch Applio: ${applioPitch}`);
  }
  console.log(`Ã°Å¸Å½Â­ Estilo de narraciÃƒÂ³n solicitado: ${narrationStyle || 'Sin estilo personalizado'}`);
  console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â ImÃƒÂ¡genes de Google: ${googleImages ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`Ã°Å¸Â§Â  ImÃƒÂ¡genes IA Local: ${localAIImages ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`Ã°Å¸Å¡Â« Omitir imÃƒÂ¡genes (auto): ${skipImages ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`Ã°Å¸Å½â€ºÃ¯Â¸Â Modo Comfy directo: ${comfyOnlyMode ? 'ACTIVADO' : 'DESACTIVADO'}`);
  if (parallelProjects.length) {
    console.log('Ã°Å¸â€â‚¬ Proyectos adicionales detectados para ejecuciÃƒÂ³n paralela:', parallelProjectsWithVoices);
  }
  
  let selectedGoogleApiIds = [];
  if (!skipImages && googleImages && typeof ensureGoogleApiSelectionReady === 'function') {
    try {
      const selectionReady = await ensureGoogleApiSelectionReady();
      if (selectionReady && typeof getSelectedGoogleApis === 'function') {
        selectedGoogleApiIds = getSelectedGoogleApis();
      }
    } catch (selectionError) {
      console.warn('Ã¢Å¡Â Ã¯Â¸Â No se pudieron preparar las APIs de Google para proyectos paralelos:', selectionError);
    }
  }

  if (!topic) {
    promptInput.focus();
    promptInput.style.border = "2px solid #e53e3e";
    showError("Por favor, describe el tema del video de gaming antes de continuar.");
    setTimeout(() => {
      promptInput.style.border = "2px solid #e2e8f0";
    }, 2000);
    isAutoGenerating = false;
    return;
  }

  // Inicializar variables
  currentTopic = topic;
  totalSections = parseInt(selectedSections);
  currentSectionNumber = 1;
  allSections = [];
  
  // Limpiar el panel de prompts al iniciar una nueva generaciÃƒÂ³n
  clearPromptsPanel();
  
  // Actualizar botones de navegaciÃƒÂ³n
  updateNavigationButtons();

  // Deshabilitar controles durante la generaciÃƒÂ³n automÃƒÂ¡tica
  disableControls(true);
  
  try {
    console.log('\n' + 'Ã°Å¸Å¡â‚¬'.repeat(50));
    console.log('Ã°Å¸Å¡â‚¬ USANDO NUEVO SISTEMA DE GENERACIÃƒâ€œN POR LOTES');
    console.log('Ã°Å¸Å¡â‚¬'.repeat(50));

    const averageWordsPerSection = Math.max(150, Math.round((minWords + maxWords) / 2));
    configureProgressEstimation({
      averageWordsPerSection,
      sections: totalSections,
      audioEnabled: generateAudio || generateApplioAudio,
      imagesEnabled: !skipImages,
      estimatedImages: skipImages ? 0 : Math.max(imageCount, totalSections)
    });
    
  // Ã°Å¸â€œÅ  INICIALIZAR BARRAS DE PROGRESO PARA TODOS LOS PROYECTOS
  clearAllProjectProgressContainers();
  
  // Determinar si incluir barra de progreso de audio
  const includeAudioProgress = generateAudio || generateApplioAudio;
  
  // Determinar si incluir barra de progreso de imÃƒÂ¡genes
  const includeImagesProgress = !skipImages && (googleImages || localAIImages);
  const imagesPerSection = imageCount || 10;
  
  // Crear contenedor para el proyecto principal
  createProjectProgressContainer(primaryProject.folderName, primaryProject.topic.length > 50 ? 
    `${primaryProject.topic.slice(0, 47)}...` : primaryProject.topic, totalSections, includeAudioProgress, includeImagesProgress, imagesPerSection, primaryProject);
  
  // Crear contenedores para proyectos paralelos
  parallelProjectsWithVoices.forEach((project, index) => {
    const projectKey = project.projectKey || createSafeFolderName(project.folderName || project.topic);
    const displayName = project.topic.length > 50 ? 
      `${project.topic.slice(0, 47)}...` : project.topic;
    console.log(`Ã°Å¸â€œÂ¦ Creando contenedor para proyecto paralelo ${index + 1}/${parallelProjectsWithVoices.length}: ${projectKey} (${displayName})`);
    createProjectProgressContainer(projectKey, displayName, totalSections, includeAudioProgress, includeImagesProgress, imagesPerSection, project);
  });
  
  // Mostrar el contenedor de progreso principal (opcional, ya que ahora tenemos individuales)
  // showProgressBar();
    
    // Obtener configuraciÃƒÂ³n de ComfyUI si estÃƒÂ¡ habilitada
    let comfyUISettings = null;
    if (localAIImages) {
      comfyUISettings = getComfyUISettings();
      console.log('Ã°Å¸Å½Â¨ ConfiguraciÃƒÂ³n ComfyUI obtenida del frontend:', comfyUISettings);
    }
    
    const customStyleInstructions = getCustomStyleInstructions(selectedStyle);

    if (parallelProjects.length) {
      const sharedParallelConfig = {
        totalSections,
        minWords,
        maxWords,
        imageCount,
        aspectRatio,
        promptModifier,
  imageModel: selectedImageModel,
        llmModel: selectedLlmModel,
        skipImages,
        googleImages,
        localAIImages,
        comfyOnlyMode,
        allowComfyFallback: comfyOnlyMode,
        selectedGoogleApis: selectedGoogleApiIds,
        comfyUISettings,
        scriptStyle: selectedStyle,
        customStyleInstructions,
        imageInstructions: promptModifier,
        voice: effectivePrimaryVoice,
        selectedVoice: manualSelectedVoice,
        randomGoogleVoice: useRandomVoices,
        randomVoiceRequested: randomVoiceEnabled,
        voiceAssignments,
        availableVoices: availableGoogleVoices,
        narrationStyle,
        generateAudio,
        generateApplioAudio,
        applioVoice: selectedApplioVoice,
        applioModel: selectedApplioModel,
        applioPitch,
        applioSpeed,
        applioQueueRunId,
        applioQueueOffset: generateApplioAudio ? 1 : 0
      };

      // Esperar a que se complete la inicializaciÃƒÂ³n de proyectos paralelos
      await triggerParallelProjectGeneration(parallelProjectsWithVoices, sharedParallelConfig);
    }
    
    // ===============================================================
    // FASE 1: GENERAR TODOS LOS GUIONES Y PROMPTS DE IMÃƒÂGENES
    // ===============================================================
    console.log('\nÃ°Å¸â€œÂ INICIANDO FASE 1: GeneraciÃƒÂ³n de guiones y prompts...');
    
    // Ã°Å¸â€œÅ  INICIAR POLLING DEL PROGRESO PARA TODOS LOS PROYECTOS
    console.log('Ã°Å¸â€œÅ  Iniciando seguimiento de progreso para todos los proyectos...');
    
    // Iniciar polling para el proyecto principal
    const primaryProjectKey = (primaryProject.folderName || '').trim() || createSafeFolderName(primaryProject.topic);
    
    // Actualizar progreso inicial del proyecto principal
    updateProjectProgress(primaryProjectKey, {
      percentage: 5,
      phase: 'script',
      currentStep: 0,
      totalSteps: totalSections,
      estimatedTimeRemaining: 'Calculando...',
      currentTask: 'Generando guiones y prompts de imÃƒÂ¡genes...'
    });
    
    startProgressPolling(primaryProjectKey, (progressData) => {
      updateProjectProgress(primaryProjectKey, progressData);
    });
    
    // Iniciar polling para proyectos paralelos con un pequeÃƒÂ±o delay para dar tiempo a que se guarden los archivos
    parallelProjectsWithVoices.forEach((project, index) => {
      const projectKey = project.projectKey || (project.folderName || '').trim() || createSafeFolderName(project.topic);
      console.log(`Ã°Å¸Å¡â‚¬ Iniciando polling para proyecto paralelo ${index + 1}/${parallelProjectsWithVoices.length}: ${projectKey} (topic: ${project.topic})`);
      
      // Agregar delay progresivo para evitar sobrecargar el servidor
      setTimeout(() => {
        startProgressPolling(projectKey, (progressData) => {
          console.log(`Ã°Å¸â€œÅ  Callback ejecutado para proyecto ${projectKey}:`, progressData);
          updateProjectProgress(projectKey, progressData);
        });
      }, index * 1000); // 1 segundo de delay por proyecto
    });
    
    // Lanzar B-Roll en paralelo (fire-and-forget, no bloqueamos la generación)
    const _brollMaxVids = parseInt(document.getElementById('brollMaxVideos')?.value) || 0;
    const _brollMaxImgs = parseInt(document.getElementById('brollMaxImages')?.value) || 0;
    if (_brollMaxVids > 0 || _brollMaxImgs > 0) {
      console.log('🎬 Lanzando B-Roll en paralelo con la generación...');
      const _brollTopic = document.getElementById('prompt')?.value?.trim();
      const _brollNumSections = parseInt(document.getElementById('sectionsNumber')?.value) || 8;
      const _brollFolder = folderName;
      // Fire and forget - no await
      fetch('/api/broll/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName: _brollFolder, topic: _brollTopic, numSections: _brollNumSections })
      }).then(r => r.json()).then(analyzeData => {
        if (analyzeData.terms) {
          console.log('🎬 B-Roll: ' + analyzeData.terms.length + ' secciones analizadas, buscando videos...');
          return fetch('/api/broll/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ terms: analyzeData.terms, maxResults: _brollMaxVids, maxDuration: parseInt(document.getElementById('brollMaxDuration')?.value) || 20, excludeShorts: document.getElementById('brollExcludeShorts')?.checked ?? true, maxImages: _brollMaxImgs })
          });
        }
      }).then(r => r?.json()).then(searchData => {
        if (searchData?.results) {
          console.log('🎬 B-Roll: Búsqueda completa, iniciando descarga...');
          fetch('/api/broll/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sections: searchData.results, folderName: _brollFolder, resolution: document.getElementById('brollResolution')?.value || '720p' })
          }).then(r => r.json()).then(dlData => {
            if (dlData.jobId) console.log('🎬 B-Roll: Descarga iniciada (job: ' + dlData.jobId + ')');
          }).catch(e => console.warn('⚠️ B-Roll download error:', e.message));
        }
      }).catch(e => console.warn('⚠️ B-Roll error:', e.message));
    }

    const phase1Response = await fetch("/generate-batch-automatic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: topic,
        folderName: folderName,
        voice: effectivePrimaryVoice,
        totalSections: totalSections,
        minWords: minWords,
        maxWords: maxWords,
        imageCount: imageCount,
        aspectRatio: aspectRatio,
        promptModifier: promptModifier,
  imageModel: selectedImageModel,
        llmModel: selectedLlmModel,
        skipImages: skipImages,
        googleImages: googleImages,
        localAIImages: localAIImages,
        comfyUISettings: comfyUISettings,
        scriptStyle: selectedStyle,
        customStyleInstructions: customStyleInstructions,
        applioVoice: selectedApplioVoice,
        applioModel: selectedApplioModel,
        applioPitch: applioPitch,
        applioSpeed: applioSpeed,
        useApplio: generateApplioAudio
      })
    });

    const phase1Data = await phase1Response.json();
    
    if (!phase1Data.success) {
      throw new Error(`Fase 1 fallÃƒÂ³: ${phase1Data.error}`);
    }
    
    console.log('Ã¢Å“â€¦ FASE 1 COMPLETADA:', phase1Data.message);
    const projectData = phase1Data.data;
  const resolvedImageModel = normalizeImageModel(projectData?.imageModel || selectedImageModel);
  projectData.imageModel = resolvedImageModel;
    
    // El polling ya se iniciÃƒÂ³ antes de la generaciÃƒÂ³n
    console.log('Ã°Å¸â€œÅ  Polling ya activo para proyecto:', projectData.projectKey);
    
    // IMPORTANTE: Para el proceso automÃƒÂ¡tico, determinar quÃƒÂ© tipo de audio generar
    const shouldGenerateAudio = generateAudio || generateApplioAudio || (selectedApplioVoice && selectedApplioVoice !== '');
    // No forzar generateApplioAudio=true, respetar la selecciÃƒÂ³n del usuario
    
    // Mostrar los guiones generados en la UI
    allSections = projectData.sections.map(section => {
      const script = section.script;
      // Asegurar que cada script sea un string vÃƒÂ¡lido
      return typeof script === 'string' ? script : String(script || "");
    });
    for (let i = 0; i < projectData.sections.length; i++) {
      const sectionData = {
        script: projectData.sections[i].script,
        imagePrompts: projectData.imagePrompts.find(ip => ip.section === i + 1)?.prompts || []
      };
      await displaySectionContent(sectionData, i + 1);
      
      // Si hay prompts, agregarlos al panel lateral inmediatamente
      if (sectionData.imagePrompts.length > 0) {
        console.log(`Ã°Å¸Å½Â¨ Agregando ${sectionData.imagePrompts.length} prompts al panel lateral para secciÃƒÂ³n ${i + 1}`);
        addPromptsToSidebar(sectionData.imagePrompts, i + 1);
      }
    }

    const completedSections = Array.isArray(projectData.sections) && projectData.sections.length > 0
      ? projectData.sections.map((sectionInfo, index) => {
          const rawSection = sectionInfo.section ?? sectionInfo.sectionNumber ?? sectionInfo.id ?? (index + 1);
          const sectionNumber = Number(rawSection) || (index + 1);

          const promptsEntry = Array.isArray(projectData.imagePrompts)
            ? projectData.imagePrompts.find(entry => {
                const entrySection = entry.section ?? entry.sectionNumber ?? entry.id ?? entry.sectionIndex;
                return Number(entrySection) === sectionNumber;
              })
            : null;

          const promptsList = Array.isArray(promptsEntry?.prompts) ? promptsEntry.prompts : [];
          const imageUrls = Array.isArray(sectionInfo.imageUrls)
            ? sectionInfo.imageUrls
            : Array.isArray(sectionInfo.images)
              ? sectionInfo.images
              : [];

          const hasImages = imageUrls.length > 0 || Boolean(sectionInfo.hasImages);
          const googleImagesMode = Boolean(
            sectionInfo.googleImagesMode ||
            sectionInfo.mode === 'google' ||
            projectData.googleImages
          );

          return {
            section: sectionNumber,
            sectionNumber,
            script: sectionInfo.script || '',
            imagePrompts: promptsList,
            prompts: promptsList,
            googleImagesMode,
            imageUrls,
            imageCount: imageUrls.length,
            hasImages,
            completedAt: sectionInfo.completedAt || null
          };
        })
      : allSections.map((script, index) => ({
          section: index + 1,
          sectionNumber: index + 1,
          script,
          imagePrompts: [],
          prompts: [],
          googleImagesMode: false,
          imageUrls: [],
          imageCount: 0,
          hasImages: false,
          completedAt: null
        }));

    projectData.scriptStyle = projectData.scriptStyle || selectedStyle;
    projectData.customStyleInstructions = projectData.customStyleInstructions || customStyleInstructions;
    projectData.wordsMin = projectData.wordsMin || minWords;
    projectData.wordsMax = projectData.wordsMax || maxWords;

    window.currentProject = {
      ...(window.currentProject || {}),
      ...projectData,
      topic,
      projectKey: projectData.projectKey,
      folderName: projectData.projectKey,
  additionalProjects: parallelProjectsWithVoices,
      completedSections,
      voice: effectivePrimaryVoice,
      narrationStyle: narrationStyle || null,
      useApplio: generateApplioAudio,
      useGoogleAudio: generateAudio,
  voiceAssignments,
  randomGoogleVoice: useRandomVoices,
      applioVoice: selectedApplioVoice,
      applioModel: selectedApplioModel,
    applioPitch: applioPitch,
    applioSpeed: applioSpeed,
      applioQueueRunId,
      googleImages,
      localAIImages,
      skipImages,
      imageCount,
  imageModel: resolvedImageModel,
      totalSections: projectData.totalSections || totalSections,
      minWords,
      maxWords,
      scriptStyle: projectData.scriptStyle,
      customStyleInstructions: projectData.customStyleInstructions
    };

    updateSectionClipButtons(window.currentProject);
    syncSectionImageProgressFromProject(window.currentProject);
    updateSectionImageButtons(window.currentProject);
    startSectionImageProgressPolling(window.currentProject);
    updateYouTubeMetadataButtonState();

    // =============================================================== 
    // VERIFICACIÃƒâ€œN DE GUIONES ANTES DE GENERAR AUDIOS
    // =============================================================== 
    if (generateAudio || generateApplioAudio) {
      console.log('\nÃ°Å¸â€Â VERIFICANDO INTEGRIDAD DE GUIONES PARA TODOS LOS PROYECTOS...');
      
      try {
        // Verificar guiones para el proyecto principal
        await regenerateMissingScripts();
        console.log('Ã¢Å“â€¦ VerificaciÃƒÂ³n de guiones completada para proyecto principal');
        
        // Verificar guiones para proyectos adicionales si existen
        if (window.currentProject && window.currentProject.additionalProjects && window.currentProject.additionalProjects.length > 0) {
          console.log(`Ã°Å¸â€Â Verificando guiones para ${window.currentProject.additionalProjects.length} proyectos adicionales...`);
          
          for (const additionalProject of window.currentProject.additionalProjects) {
            try {
              console.log(`Ã°Å¸â€Â Verificando guiones para proyecto adicional: ${additionalProject.folderName}`);
              await regenerateMissingScriptsForProject(additionalProject.folderName);
              console.log(`Ã¢Å“â€¦ Guiones verificados para proyecto: ${additionalProject.folderName}`);
            } catch (projectError) {
              console.error(`Ã¢ÂÅ’ Error verificando guiones para proyecto ${additionalProject.folderName}:`, projectError);
              // Continuar con otros proyectos
            }
          }
        }
        
        console.log('Ã¢Å“â€¦ VerificaciÃƒÂ³n de guiones completada para todos los proyectos');
      } catch (error) {
        console.error('Ã¢ÂÅ’ Error verificando guiones:', error);
        // No detener el proceso, continuar con la generaciÃƒÂ³n de audios
        console.log('Ã¢Å¡Â Ã¯Â¸Â Continuando con generaciÃƒÂ³n de audios a pesar del error en verificaciÃƒÂ³n de guiones');
      }
    }
    
    // =============================================================== 
    // VERIFICACIÃƒâ€œN Y ESPERA: TODOS LOS PROYECTOS DEBEN ESTAR COMPLETOS
    // =============================================================== 
    async function waitForAllProjectsComplete(projectsToProcess) {
      console.log('\nÃ¢ÂÂ³ ESPERANDO A QUE TODOS LOS PROYECTOS ESTÃƒâ€°N COMPLETOS ANTES DE GENERAR AUDIO...');
      
      return new Promise((resolve) => {
        const checkInterval = setInterval(async () => {
          console.log('\nÃ°Å¸â€Â Verificando completitud de todos los proyectos...');
          
          const allComplete = await verifyAllProjectsComplete(projectsToProcess);
          
          if (allComplete) {
            console.log('Ã°Å¸Å½â€° TODOS LOS PROYECTOS ESTÃƒÂN COMPLETOS - INICIANDO GENERACIÃƒâ€œN DE AUDIO');
            clearInterval(checkInterval);
            resolve(true);
          } else {
            console.log('Ã¢ÂÂ³ Algunos proyectos aÃƒÂºn no estÃƒÂ¡n completos. Esperando 5 segundos para volver a verificar...');
            // Esperar 5 segundos antes de la prÃƒÂ³xima verificaciÃƒÂ³n
          }
        }, 5000); // Verificar cada 5 segundos
      });
    }
    
    // FunciÃƒÂ³n auxiliar para verificar si todos los proyectos estÃƒÂ¡n completos
    async function verifyAllProjectsComplete(projectsToProcess) {
      console.log('\nÃ°Å¸â€Â Verificando completitud de proyectos...');
      
      for (let i = 0; i < projectsToProcess.length; i++) {
        const project = projectsToProcess[i];
        console.log(`Ã°Å¸â€Â [${i + 1}/${projectsToProcess.length}] Verificando proyecto: ${project.projectName} (${project.projectKey})`);
        
        try {
          // Obtener el estado del proyecto desde el backend
          const projectStateResponse = await fetch(`/get-project-state/${project.projectKey}`);
          if (!projectStateResponse.ok) {
            console.error(`Ã¢ÂÅ’ No se pudo obtener estado del proyecto ${project.projectKey}: ${projectStateResponse.status}`);
            return false;
          }
          
          const projectState = await projectStateResponse.json();
          
          // Verificar si el proyecto tiene todas las secciones completas
          const completedSections = projectState.completedSections?.length || 0;
          const totalSections = projectState.totalSections || 0;
          
          console.log(`Ã°Å¸â€œÅ  Proyecto ${project.projectName}: ${completedSections}/${totalSections} secciones completas`);
          
          if (completedSections < totalSections) {
            console.log(`Ã¢ÂÂ³ Proyecto ${project.projectName} aÃƒÂºn no estÃƒÂ¡ completo: ${completedSections}/${totalSections} secciones`);
            return false;
          }
          
          // Verificar que todas las secciones tienen guiones vÃƒÂ¡lidos
          for (let sectionNum = 1; sectionNum <= totalSections; sectionNum++) {
            try {
              const scriptResponse = await fetch(`/read-script-file/${project.projectKey}/${sectionNum}`);
              if (!scriptResponse.ok) {
                console.log(`Ã¢ÂÂ³ No se pudo leer guiÃƒÂ³n de secciÃƒÂ³n ${sectionNum} del proyecto ${project.projectKey}: ${scriptResponse.status}`);
                return false;
              }
              
              const scriptData = await scriptResponse.json();
              if (!scriptData.success || !scriptData.script || scriptData.script.trim().length === 0) {
                console.log(`Ã¢ÂÂ³ GuiÃƒÂ³n vacÃƒÂ­o o invÃƒÂ¡lido en secciÃƒÂ³n ${sectionNum} del proyecto ${project.projectName}`);
                return false;
              }
              
              console.log(`Ã¢Å“â€¦ SecciÃƒÂ³n ${sectionNum} del proyecto ${project.projectName}: guiÃƒÂ³n vÃƒÂ¡lido (${scriptData.script.length} caracteres)`);
            } catch (scriptError) {
              console.log(`Ã¢ÂÂ³ Error verificando guiÃƒÂ³n de secciÃƒÂ³n ${sectionNum} del proyecto ${project.projectKey}:`, scriptError.message);
              return false;
            }
          }
          
          console.log(`Ã¢Å“â€¦ Proyecto ${project.projectName} estÃƒÂ¡ COMPLETO`);
          
        } catch (error) {
          console.log(`Ã¢ÂÂ³ Error verificando proyecto ${project.projectKey}:`, error.message);
          return false;
        }
      }
      
      console.log('Ã¢Å“â€¦ Todos los proyectos verificados - estÃƒÂ¡n completos');
      return true;
    }
    
    // =============================================================== 
    // FASE 2: GENERAR TODOS LOS ARCHIVOS DE AUDIO SECUENCIALMENTE
    // =============================================================== 
    // MODIFICACIÃƒâ€œN: Si ya se generaron audios en Fase 1 (inmediata), no ejecutar Fase 2 para el proyecto principal
    // Pero sÃƒÂ­ ejecutar para proyectos adicionales si los hay
    
    const hasAdditionalProjects = window.currentProject && window.currentProject.additionalProjects && window.currentProject.additionalProjects.length > 0;
    
    // Si hay proyectos adicionales, siempre ejecutar Fase 2 (pero filtrar el principal si ya tiene audio)
    // Si NO hay proyectos adicionales, y ya se generÃƒÂ³ audio en Fase 1, saltar Fase 2
    
    if (generateAudio || generateApplioAudio) {
      console.log('\nÃ°Å¸Å½Âµ INICIANDO FASE 2: GeneraciÃƒÂ³n secuencial de audio...');
      
      // Generar un ID ÃƒÂºnico para esta sesiÃƒÂ³n de generaciÃƒÂ³n de audio
      const audioRunId = `audio_batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let globalAudioOrder = 0;
      
      // Crear lista de proyectos en orden
      const projectsToProcess = [];
      
      // Solo agregar el proyecto principal si NO se generÃ³ audio en Fase 1
      // OJO: Fase 1 ya NO genera audios en el backend (se comentÃ³/eliminÃ³ esa lÃ³gica).
      // Por lo tanto, debemos agregar el proyecto principal explÃ­citamente.
      
      console.log('â„¹ï¸ Agregando proyecto principal a la cola de generaciÃ³n de audio (Fase 2 manual).');
      
      projectsToProcess.push({
        projectKey: window.currentProject.projectKey, // Usar datos actualizados
        projectName: window.currentProject.topic,
        voice: effectivePrimaryVoice,
        isApplio: generateApplioAudio,
        applioVoice: selectedApplioVoice,
        applioModel: selectedApplioModel,
        applioPitch: applioPitch,
        applioSpeed: applioSpeed,
        narrationStyle: narrationStyle,
        scriptStyle: window.currentProject.scriptStyle,
        customStyleInstructions: window.currentProject.customStyleInstructions,
        wordsMin: window.currentProject.wordsMin,
        wordsMax: window.currentProject.wordsMax
      });

      // Agregar proyectos adicionales
      if (hasAdditionalProjects) {
        console.log(`Ã°Å¸â€œâ€¹ PROYECTOS ADICIONALES ENCONTRADOS:`, window.currentProject.additionalProjects.length);
        window.currentProject.additionalProjects.forEach((proj, index) => {
          console.log(`Ã°Å¸â€œâ€¹ Proyecto adicional ${index + 1}: ${proj.topic} (${proj.folderName})`);
        });
        
        for (const additionalProject of window.currentProject.additionalProjects) {
          const projectVoice = voiceAssignments[additionalProject.folderName] || effectivePrimaryVoice;
          
          projectsToProcess.push({
            projectKey: additionalProject.folderName,
            projectName: additionalProject.topic,
            voice: projectVoice,
            isApplio: generateApplioAudio,
            applioVoice: selectedApplioVoice,
            applioModel: selectedApplioModel,
            applioPitch: applioPitch,
            applioSpeed: applioSpeed,
            narrationStyle: narrationStyle,
            scriptStyle: projectData.scriptStyle,
            customStyleInstructions: projectData.customStyleInstructions,
            wordsMin: projectData.wordsMin,
            wordsMax: projectData.wordsMax
          });
        }
      } else {
        console.log(`Ã°Å¸â€œâ€¹ No hay proyectos adicionales`);
      }

      // Esperar a que todos los proyectos estÃƒÂ©n completos antes de continuar
      // Esto es crucial porque la Fase 1 puede haber terminado de enviar solicitudes,
      // pero el backend aÃƒÂºn puede estar procesando guiones/audios en segundo plano.
      await waitForAllProjectsComplete(hasAdditionalProjects ? projectsToProcess : [{
        projectKey: window.currentProject.projectKey,
        projectName: window.currentProject.topic
      }]);
      
      if (projectsToProcess.length === 0) {
        console.log('Ã¢Å“â€¦ No hay proyectos pendientes de audio (el principal ya se generÃƒÂ³ en Fase 1).');
        // NO HACER RETURN AQUÃƒÂ, para permitir que continÃƒÂºe a la Fase 2.5
      } else {
        console.log(`Ã°Å¸Å½Âµ Proyectos ADICIONALES a procesar en orden:`, projectsToProcess.map(p => `${p.projectName} (${p.projectKey})`));
        
        // Ã¢ÂÂ³ ESPERAR HASTA QUE TODOS LOS PROYECTOS ESTÃƒâ€°N COMPLETOS ANTES DE GENERAR AUDIO
        console.log('\nÃ¢ÂÂ³ ESPERANDO A QUE TODOS LOS PROYECTOS TENGAN TODOS SUS GUIONES COMPLETOS...');
        await waitForAllProjectsComplete(projectsToProcess);
        
        console.log('Ã¢Å“â€¦ TODOS LOS PROYECTOS ESTÃƒÂN LISTOS. Iniciando generaciÃƒÂ³n de audio secuencial...');
        
        // Procesar cada proyecto completamente antes de pasar al siguiente
        for (let projectIndex = 0; projectIndex < projectsToProcess.length; projectIndex++) {
          const project = projectsToProcess[projectIndex];
          console.log(`\nÃ°Å¸Å½Âµ [${projectIndex + 1}/${projectsToProcess.length}] INICIANDO PROCESAMIENTO DE PROYECTO: ${project.projectName} (${project.projectKey})`);
          console.log(`Ã°Å¸Å½Âµ [${projectIndex + 1}/${projectsToProcess.length}] Detalles del proyecto:`, {
            projectKey: project.projectKey,
            projectName: project.projectName,
            isApplio: project.isApplio,
            voice: project.voice,
            isMainProject: project.projectKey === projectData.projectKey
          });
          
          if (projectIndex === 0) {
            console.log(`Ã°Å¸Å½Â¯ PRIMER PROYECTO A PROCESAR: ${project.projectName} (${project.projectKey})`);
            console.log(`Ã°Å¸Å½Â¯ Este deberÃƒÂ­a ser el TEMA 1`);
          }
          
// FunciÃ³n helper para procesar una secciÃ³n individual
          const processSingleSectionAudio = async (sectionNum) => {
            console.log(`ðŸŽ¶ [${project.projectKey}] Generando audio: ${project.projectName} - SecciÃ³n ${sectionNum}/${totalSections}`);
            
            try {
              // Inicializar progreso de audio al comenzar el proyecto (solo para la primera secciÃ³n)
              if (sectionNum === 1) {
                updateProjectProgress(project.projectKey, {
                  percentage: 0,
                  phase: 'audio',
                  currentStep: 0,
                  totalSteps: totalSections,
                  currentTask: `Iniciando generaciÃ³n de audio...`,
                  audioProgress: {
                    percentage: 0,
                    currentStep: 0,
                    totalSteps: totalSections,
                    currentTask: `Iniciando generaciÃ³n de audio...`
                  }
                });
              }
              
              // (Progreso inicial eliminado para evitar saltos en batch)
              // const projectProgressPercentage = Math.round(((sectionNum - 1) / totalSections) * 100);
              
              // Obtener el script para esta secciÃ³n
              let scriptContent = "";
              if (project.projectKey === projectData.projectKey) {
                // Proyecto principal
                scriptContent = allSections[sectionNum - 1]?.script || "";
                if (typeof scriptContent !== 'string') {
                  scriptContent = String(scriptContent || "");
                }
              } else {
                // Proyecto adicional - leer desde archivo
                try {
                  const scriptResponse = await fetch(`/read-script-file/${project.projectKey}/${sectionNum}`);
                  if (scriptResponse.ok) {
                    const scriptData = await scriptResponse.json();
                    scriptContent = scriptData.script || "";
                    if (typeof scriptContent !== 'string') {
                      scriptContent = String(scriptContent || "");
                    }
                  } else {
                    scriptContent = `Script para ${project.projectName} - SecciÃ³n ${sectionNum}`;
                  }
                } catch (scriptError) {
                  scriptContent = `Script para ${project.projectName} - SecciÃ³n ${sectionNum}`;
                }
              }
              
              if (scriptContent.trim() === "" || scriptContent.startsWith("Script para")) {
                scriptContent = `Contenido detallado de la secciÃ³n ${sectionNum} del tema ${project.projectName}. Esta secciÃ³n contiene informaciÃ³n importante sobre el tema principal.`;
              }
              
              // Generar el audio
              const endpoint = project.isApplio ? "/generate-section-audio" : "/generate-audio";
              const requestBody = project.isApplio ? {
                script: scriptContent,
                topic: project.projectName,
                folderName: project.projectKey,
                currentSection: sectionNum,
                applioVoice: project.applioVoice,
                applioModel: project.applioModel,
                applioPitch: project.applioPitch,
                applioSpeed: project.applioSpeed
              } : {
                script: scriptContent,
                voice: project.voice,
                topic: project.projectName,
                folderName: project.projectKey,
                currentSection: sectionNum,
                narrationStyle: project.narrationStyle,
                runId: audioRunId,
                order: globalAudioOrder++
              };
              
              const audioResponse = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody)
              });
              
              if (!audioResponse.ok) {
                const errorText = await audioResponse.text();
                throw new Error(`Error HTTP ${audioResponse.status}: ${errorText}`);
              }
              
              const audioData = await audioResponse.json();
              
              if (!audioData.success) {
                console.error(`âŒ [${project.projectKey}] Error generando audio para ${project.projectName} - SecciÃ³n ${sectionNum}: ${audioData.error}`);
              } else {
                console.log(`âœ… [${project.projectKey}] Audio generado exitosamente: ${project.projectName} - SecciÃ³n ${sectionNum}`);
              }
              
              // Actualizar progreso final para esta secciÃ³n
              completedAudioSections++;
              const finalProgressPercentage = Math.round((completedAudioSections / totalSections) * 100);
              
              updateProjectProgress(project.projectKey, {
                percentage: finalProgressPercentage,
                phase: completedAudioSections === totalSections ? 'completed' : 'audio',
                currentStep: completedAudioSections,
                totalSteps: totalSections,
                currentTask: completedAudioSections === totalSections ? 'Completado' : `Generando audio: SecciÃ³n ${sectionNum} OK (${completedAudioSections}/${totalSections})`,
                audioProgress: {
                  percentage: finalProgressPercentage,
                  currentStep: completedAudioSections,
                  totalSteps: totalSections,
                  currentTask: completedAudioSections === totalSections ? 'Completado' : `Generando audio: SecciÃ³n ${sectionNum} OK (${completedAudioSections}/${totalSections})`
                }
              });

            } catch (error) {
              console.error(`âŒ [${project.projectKey}] Error procesando audio ${project.projectName} - SecciÃ³n ${sectionNum}:`, error);
            }
          };

          // Procesar en lotes de 3
          const batchSize = 3;
          let completedAudioSections = 0;
          
          for (let startSection = 1; startSection <= totalSections; startSection += batchSize) {
            const promises = [];
            for (let i = 0; i < batchSize; i++) {
              const currentSection = startSection + i;
              if (currentSection <= totalSections) {
                promises.push(processSingleSectionAudio(currentSection));
              }
            }
            
            console.log(`ðŸš€ [${project.projectKey}] Procesando lote de audios: Secciones ${startSection} a ${Math.min(startSection + batchSize - 1, totalSections)}`);
            await Promise.all(promises);
            
            // PequeÃ±a pausa entre lotes
            if (startSection + batchSize <= totalSections) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        
        console.log(`Ã¢Å“â€¦ [${projectIndex + 1}/${projectsToProcess.length}] PROYECTO COMPLETADO: ${project.projectName} (${project.projectKey})`);
        
        // Pausa entre proyectos para asegurar secuencialidad
        if (projectIndex < projectsToProcess.length - 1) {
          console.log(`Ã¢ÂÂ³ Esperando 2 segundos antes de pasar al siguiente proyecto...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      console.log('Ã¢Å“â€¦ FASE 2 COMPLETADA: Todos los audios generados secuencialmente');
    }
    } else {
      console.log('Ã¢ÂÂ­Ã¯Â¸Â FASE 2 OMITIDA: No se solicitÃƒÂ³ generaciÃƒÂ³n de audio');
    }

    // ===============================================================
    // FASE 2.5: GENERACIÃƒâ€œN DE TRADUCCIONES (SI SE SOLICITÃƒâ€œ)
    // ===============================================================
    const includeTranslations = document.getElementById('includeTranslations')?.checked || false;
    const silencePadding = document.getElementById('audioSilencePadding')?.value || 20;

    if (includeTranslations) {
      console.log('\nÃ°Å¸Å’Â INICIANDO FASE 2.5: GeneraciÃƒÂ³n de traducciones...');
      
      // Lista de todos los proyectos a procesar (principal + adicionales)
      const allProjectsToTranslate = [window.currentProject];
      if (window.currentProject.additionalProjects) {
        allProjectsToTranslate.push(...window.currentProject.additionalProjects);
      }

      for (const project of allProjectsToTranslate) {
        console.log(`Ã°Å¸Å’Â Procesando traducciones para: ${project.folderName}`);
        
        try {
          // 1. Generar textos traducidos
          console.log(`Ã°Å¸â€œÂ Generando guiones traducidos para ${project.folderName}...`);
          await fetch('/translate-project-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              folderName: project.folderName,
              totalSections: project.totalSections
            })
          });

          // 2. Generar audios traducidos y unirlos
          console.log(`Ã°Å¸Å½Â¤ Generando audios traducidos para ${project.folderName}...`);
          
          await new Promise((resolve, reject) => {
            fetch('/generate-translated-audios', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    folderName: project.folderName,
                    totalSections: project.totalSections,
                    applioVoice: project.applioVoice,
                    applioModel: project.applioModel,
                    applioPitch: project.applioPitch,
                    applioSpeed: project.applioSpeed,
                    silencePadding: silencePadding
                })
            }).then(async (response) => {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.substring(6));
                                if (data.progress) {
                                    console.log(`Ã°Å¸Å’Â [${project.folderName}] Progreso: ${data.message || (data.current ? data.current + '/' + data.totalTasks : '')}`);
                                }
                                if (data.complete) {
                                    resolve();
                                }
                                if (data.error) {
                                    console.error(`Ã¢ÂÅ’ Error en traducciÃƒÂ³n: ${data.error}`);
                                    resolve(); 
                                }
                            } catch (e) {
                                // Ignorar errores de parseo en chunks parciales
                            }
                        }
                    }
                }
                resolve();
            }).catch(reject);
          });
          
          console.log(`Ã¢Å“â€¦ Traducciones completadas para: ${project.folderName}`);

        } catch (error) {
          console.error(`Ã¢ÂÅ’ Error procesando traducciones para ${project.folderName}:`, error);
        }
      }
    }

    // ===============================================================
    // FASE 3: GENERAR TODAS LAS IMÃƒÂGENES (usando la misma funciÃƒÂ³n que el botÃƒÂ³n)
    // ===============================================================
    if (!skipImages) {
      console.log('\nÃ°Å¸Å½Â¨ INICIANDO FASE 3: GeneraciÃƒÂ³n de imÃƒÂ¡genes usando generateMissingImages()...');
      
      try {
        // Ejecutar la misma funciÃƒÂ³n que el botÃƒÂ³n "generateMissingImagesBtn"
        await generateMissingImages();
        console.log('Ã¢Å“â€¦ FASE 3 COMPLETADA: ImÃƒÂ¡genes generadas correctamente');
      } catch (error) {
        console.error('Ã¢ÂÅ’ Error en FASE 3:', error);
        throw new Error(`Fase 3 fallÃƒÂ³: ${error.message}`);
      }
    } else {
      console.log('Ã¢ÂÂ­Ã¯Â¸Â FASE 3 OMITIDA: Se solicitÃƒÂ³ omitir imÃƒÂ¡genes');
    }
    
    // =============================================================== 
    // VERIFICACIÃ“N FINAL: ASEGURAR QUE TODOS LOS AUDIOS ESTÃ‰N COMPLETOS
    // =============================================================== 
    
    if (generateAudio || generateApplioAudio) {
      console.log('\nðŸ” REALIZANDO VERIFICACIÃ“N FINAL DE AUDIOS...');
      
      // Esperar un momento para asegurar que el sistema de archivos se actualice
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      try {
        // Verificar audios para el proyecto principal
        await regenerateAllAudios();
        console.log('âœ… VerificaciÃ³n final de audios completada para proyecto principal');
        
        // Verificar audios para proyectos adicionales
        if (window.currentProject && window.currentProject.additionalProjects && window.currentProject.additionalProjects.length > 0) {
          console.log(`ðŸ” Verificando audios finales para ${window.currentProject.additionalProjects.length} proyectos adicionales...`);
          
          for (const additionalProject of window.currentProject.additionalProjects) {
            try {
              console.log(`ðŸ” Verificando audios finales para proyecto: ${additionalProject.folderName}`);
              // Usar la funciÃ³n de regenerar audios faltantes para el proyecto especÃ­fico
              await regenerateAllAudiosForProject(additionalProject.folderName);
              console.log(`âœ… Audios finales verificados para proyecto: ${additionalProject.folderName}`);
            } catch (projectError) {
              console.error(`âŒ Error verificando audios finales para proyecto ${additionalProject.folderName}:`, projectError);
              // No detener el proceso por errores en proyectos adicionales
            }
          }
        }
        
        console.log('âœ… VerificaciÃ³n final de audios completada para todos los proyectos');
      } catch (error) {
        console.error('âŒ Error en verificaciÃ³n final de audios:', error);
        // No detener el proceso completo por errores en la verificaciÃ³n
        console.log('âš ï¸ GeneraciÃ³n completada pero con posibles audios faltantes');
      }
    }
    
    console.log('\n' + 'Ã°Å¸Å½â€°'.repeat(50));
    console.log('Ã°Å¸Å½â€° GENERACIÃƒâ€œN AUTOMÃƒÂTICA POR LOTES COMPLETADA');
    console.log('Ã°Å¸Å½â€°'.repeat(50));
    
    // Ã°Å¸â€œÅ  COMPLETAR BARRA DE PROGRESO (solo para proyectos ÃƒÂºnicos)
    const hasMultipleProjects = projectProgressContainers.size > 1;
    if (!hasMultipleProjects) {
      completeProgressBar('Ã‚Â¡GeneraciÃƒÂ³n automÃƒÂ¡tica completada exitosamente!');
    }
    
    showAutoGenerationComplete();
    
  } catch (error) {
    console.error("Ã¢ÂÅ’ Error durante generaciÃƒÂ³n automÃƒÂ¡tica:", error);
    const hasMultipleProjects = projectProgressContainers.size > 1;
    if (!hasMultipleProjects) {
      showProgressError(error.message);
    }
    showError(`Error durante la generaciÃƒÂ³n automÃƒÂ¡tica: ${error.message}`);
  } finally {
    isAutoGenerating = false;
    disableControls(false);
    restoreGenerateButton();
  }
}

// FunciÃƒÂ³n para restaurar el botÃƒÂ³n de generar a su estado original
function restoreGenerateButton() {
  // Remover cualquier clase de loading
  generateBtn.classList.remove('loading');
  
  // Restaurar contenido original
  generateBtn.innerHTML = `
    <i class="fas fa-video"></i>
    <span>Generar SecciÃƒÂ³n 1</span>
  `;
  
  // Asegurar que estÃƒÂ© habilitado y visible
  generateBtn.disabled = false;
  generateBtn.style.display = 'inline-flex';
  
  // Limpiar cualquier etapa de loading residual
  const loadingStages = output.querySelector('.loading-stages');
  if (loadingStages) {
    loadingStages.remove();
    console.log("Ã°Å¸Â§Â¹ Etapas de loading residuales limpiadas");
  }
  
  console.log("Ã°Å¸â€â€ž BotÃƒÂ³n de generar restaurado a su estado original");
}

// FunciÃƒÂ³n para obtener las instrucciones del estilo personalizado
function getCustomStyleInstructions(styleId) {
  console.log(`Ã°Å¸Å½Â¨ DEBUG - getCustomStyleInstructions llamada con styleId: "${styleId}"`);
  console.log(`Ã°Å¸Å½Â¨ DEBUG - customStyles array:`, customStyles);
  
  if (!styleId || !styleId.startsWith('custom_')) {
    console.log(`Ã°Å¸Å½Â¨ DEBUG - No es un estilo personalizado: ${styleId}`);
    return null;
  }
  
  const customStyle = customStyles.find(style => style.id === styleId);
  console.log(`Ã°Å¸Å½Â¨ DEBUG - Estilo encontrado:`, customStyle);
  
  if (customStyle) {
    console.log(`Ã°Å¸Å½Â¨ DEBUG - Instrucciones del estilo: ${customStyle.instructions}`);
    return customStyle.instructions;
  }
  
  console.log(`Ã°Å¸Å½Â¨ DEBUG - No se encontrÃƒÂ³ el estilo personalizado`);
  return null;
}

// FunciÃƒÂ³n para generar contenido de una secciÃƒÂ³n
async function generateSectionContent(section, params) {
  try {
    const customStyleInstructions = getCustomStyleInstructions(params.selectedStyle);
    
    // Obtener configuraciÃƒÂ³n de ComfyUI si estÃƒÂ¡ habilitada
    let comfyUISettings = null;
    if (params.localAIImages && document.getElementById('localAIImages').checked) {
      comfyUISettings = getComfyUISettings();
      console.log('Ã°Å¸Å½Â¨ ConfiguraciÃƒÂ³n ComfyUI obtenida del frontend:', comfyUISettings);
      
      // Debug extra para verificar valores especÃƒÂ­ficos
      console.log('Ã°Å¸â€Â Valores especÃƒÂ­ficos:', {
        steps: document.getElementById('comfyUISteps')?.value,
        guidance: document.getElementById('comfyUIGuidance')?.value,
        width: document.getElementById('comfyUIWidth')?.value,
        height: document.getElementById('comfyUIHeight')?.value
      });
    }
    
    const response = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: params.topic,
        folderName: params.folderName,
        voice: params.selectedVoice,
        totalSections: totalSections,
        currentSection: section,
        scriptStyle: params.selectedStyle,
        customStyleInstructions: customStyleInstructions,
        imageCount: params.imageCount,
        promptModifier: params.promptModifier,
        imageModel: params.selectedImageModel,
        llmModel: params.selectedLlmModel,
        skipImages: params.skipImages,
        googleImages: params.googleImages,
        localAIImages: params.localAIImages,
        comfyUISettings: comfyUISettings, // Agregar configuraciÃƒÂ³n ComfyUI
        applioVoice: params.selectedApplioVoice,
        applioModel: params.selectedApplioModel,
        applioPitch: params.applioPitch,
        applioSpeed: params.applioSpeed,
        allSections: allSections
      })
    });

    const data = await response.json();
    
    if (data.script) {
      // Preparar datos completos de la secciÃƒÂ³n
      let chapterTitle = null;
      if (globalChapterStructure && globalChapterStructure.length > 0 && section <= globalChapterStructure.length) {
        chapterTitle = globalChapterStructure[section - 1];
      }
      
      // Guardar la secciÃƒÂ³n completa en el historial
      allSections.push({
        script: data.script,
        chapterTitle: chapterTitle,
        tokenUsage: data.tokenUsage,
        voiceUsed: null,
        scriptFileInfo: null,
        images: null,
        imagePrompts: null,
        imageKeywords: null,
        imageMode: null
      });
      updateSectionClipButtons();
      updateSectionImageButtons();
      currentSectionNumber = section;
      return { success: true, data };
    } else {
      return { success: false, error: data.error || "No se pudo generar el contenido" };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// FunciÃƒÂ³n para generar audio de una secciÃƒÂ³n con Applio
async function generateSectionApplioAudio(section) {
  try {
    console.log(`Ã°Å¸Å½Â¤ Iniciando generaciÃƒÂ³n de audio con Applio para secciÃƒÂ³n ${section}...`);
    
    if (!allSections[section - 1]) {
      throw new Error(`No hay guiÃƒÂ³n disponible para la secciÃƒÂ³n ${section}`);
    }
    
    // Obtener el script de la secciÃƒÂ³n (compatible con formato nuevo y antiguo)
    const sectionData = allSections[section - 1];
    const script = typeof sectionData === 'string' ? sectionData : sectionData.script;
    
    const selectedApplioVoice = document.getElementById("applioVoiceSelect").value;
    const selectedApplioModel = document.getElementById("applioModelSelect").value;
    const applioPitch = parseInt(document.getElementById("applioPitch").value) || 0;
    const applioSpeed = parseInt(document.getElementById("applioSpeed").value) || 0;
    console.log(`Ã°Å¸Å½Â¤ Usando voz de Applio: ${selectedApplioVoice}`);
    console.log(`Ã°Å¸Å½â€ºÃ¯Â¸Â Usando modelo de Applio: ${selectedApplioModel}`);
    console.log(`Ã°Å¸Å½Âµ Usando pitch: ${applioPitch}`);
    console.log(`Ã°Å¸Å¡â‚¬ Usando velocidad: ${applioSpeed}`);
    
    const response = await fetch("/generate-section-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: script, // Usar el guiÃƒÂ³n de la secciÃƒÂ³n actual
        topic: currentTopic,
        folderName: document.getElementById("folderName").value.trim(),
        currentSection: section,
        voice: "fr-FR-RemyMultilingualNeural", // Voz de TTS (se mantiene)
        applioVoice: selectedApplioVoice, // Voz del modelo de Applio
        applioModel: selectedApplioModel, // Modelo TTS de Applio
        applioPitch: applioPitch, // Pitch para Applio
        applioSpeed: applioSpeed
      })
    });

    const data = await response.json();
    
    if (data.success && data.audioFile) {
      console.log(`Ã¢Å“â€¦ Audio Applio generado exitosamente para secciÃƒÂ³n ${section}: ${data.audioFile}`);
      console.log(`Ã°Å¸â€œÅ  TamaÃƒÂ±o: ${(data.size / 1024).toFixed(1)} KB con ${data.method}`);
      
      // Esperar un momento adicional para asegurar que el archivo se escribiÃƒÂ³ completamente
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      return { 
        success: true, 
        audioFile: data.audioFile,
        method: data.method,
        section: section
      };
    } else {
      throw new Error(data.error || 'Error desconocido generando audio con Applio');
    }
    
  } catch (error) {
    console.error(`Ã¢ÂÅ’ Error generando audio Applio para secciÃƒÂ³n ${section}:`, error);
    return { 
      success: false, 
      error: error.message,
      section: section
    };
  }
}

// FunciÃƒÂ³n para generar audio de una secciÃƒÂ³n
async function generateSectionAudio(section, voice) {
  try {
    console.log(`Ã°Å¸Å½Âµ Iniciando generaciÃƒÂ³n de audio para secciÃƒÂ³n ${section}...`);
    
    const narrationStyle = document.getElementById("narrationStyle").value.trim();
    
    // Obtener el script de la secciÃƒÂ³n (compatible con formato nuevo y antiguo)
    const sectionData = allSections[section - 1];
    const script = typeof sectionData === 'string' ? sectionData : sectionData.script;
    
    const response = await fetch("/generate-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voice: voice,
        currentSection: section,
        topic: currentTopic,
        folderName: document.getElementById("folderName").value.trim(),
        script: script, // Usar el guiÃƒÂ³n de la secciÃƒÂ³n actual
        narrationStyle: narrationStyle
      })
    });

    const data = await response.json();
    
    if (data.success && data.audio) {
      console.log(`Ã¢Å“â€¦ Audio generado exitosamente para secciÃƒÂ³n ${section}: ${data.audio}`);
      
      // Esperar un momento adicional para asegurar que el archivo se escribiÃƒÂ³ completamente
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      console.log(`Ã°Å¸Å½Âµ Audio completamente procesado para secciÃƒÂ³n ${section}`);
      return { success: true, data };
    } else {
      return { success: false, error: data.error || "Error generando audio" };
    }
  } catch (error) {
    console.error(`Ã¢ÂÅ’ Error generando audio para secciÃƒÂ³n ${section}:`, error);
    return { success: false, error: error.message };
  }
}

// FunciÃƒÂ³n para mostrar contenido de una secciÃƒÂ³n
async function displaySectionContent(data, section) {
  return new Promise((resolve) => {
    // Almacenar estructura de capÃƒÂ­tulos si estÃƒÂ¡ disponible
    if (data.chapterStructure) {
      storeChapterStructure(data.chapterStructure);
    }
    
    // Mostrar guiÃƒÂ³n
    showScript(data.script, section, totalSections, data.voice, data.scriptFile, data.tokenUsage);
    
    setTimeout(() => {
      // Usar los datos del servidor en lugar de leer los checkboxes
      const skipImages = data.imagesSkipped || false;
      const bingImages = data.bingImagesMode || false;
      const localAIImages = data.localAIMode || false;
      const downloadedImages = data.downloadedImages || [];
      const localAIImagesData = data.localAIImages || [];
      
      console.log(`Ã°Å¸â€Â DEBUG displaySectionContent - skipImages: ${skipImages}`);
      console.log(`Ã°Å¸â€Â DEBUG displaySectionContent - bingImages: ${bingImages}`);
      console.log(`Ã°Å¸â€Â DEBUG displaySectionContent - localAIImages: ${localAIImages}`);
      console.log(`Ã°Å¸â€Â DEBUG displaySectionContent - downloadedImages.length: ${downloadedImages.length}`);
      console.log(`Ã°Å¸â€Â DEBUG displaySectionContent - localAIImagesData.length: ${localAIImagesData.length}`);
      console.log(`Ã°Å¸â€Â DEBUG displaySectionContent - data.imagesSkipped: ${data.imagesSkipped}`);
      console.log(`Ã°Å¸â€Â DEBUG displaySectionContent - data.bingImagesMode: ${data.bingImagesMode}`);
      console.log(`Ã°Å¸â€Â DEBUG displaySectionContent - data.localAIMode: ${data.localAIMode}`);
      console.log(`Ã°Å¸â€Â DEBUG displaySectionContent - data.images: ${data.images ? data.images.length : 'null'}`);
      console.log(`Ã°Å¸â€Â DEBUG displaySectionContent - data.imagePrompts: ${data.imagePrompts ? data.imagePrompts.length : 'null'}`);
      
      console.log(`Ã°Å¸â€Â DEBUG displaySectionContent - EVALUANDO CONDICIONES:`);
      console.log(`Ã°Å¸â€Â DEBUG - CondiciÃƒÂ³n 1 (IA Local): localAIImages=${localAIImages} && localAIImagesData.length=${localAIImagesData.length} > 0 = ${localAIImages && localAIImagesData.length > 0}`);
      console.log(`Ã°Å¸â€Â DEBUG - CondiciÃƒÂ³n 2 (Bing): bingImages=${bingImages} && downloadedImages.length=${downloadedImages.length} > 0 = ${bingImages && downloadedImages.length > 0}`);
      console.log(`Ã°Å¸â€Â DEBUG - CondiciÃƒÂ³n 3 (Normal): !skipImages=${!skipImages} && !bingImages=${!bingImages} && !localAIImages=${!localAIImages} && data.images=${data.images ? 'exists' : 'null'} = ${!skipImages && !bingImages && !localAIImages && data.images && data.images.length > 0}`);
      
      if (localAIImages && localAIImagesData.length > 0) {
        // Mostrar carrusel con imÃƒÂ¡genes generadas por IA Local
        console.log(`Ã°Å¸Â¤â€“ Mostrando carrusel con ${localAIImagesData.length} imÃƒÂ¡genes de IA Local`);
        console.log(`Ã°Å¸Â¤â€“ DEBUG - Datos de la primera imagen IA Local:`, localAIImagesData[0]);
        
        createCarousel(localAIImagesData, section, []);
        
        // Almacenar imÃƒÂ¡genes de IA Local en allSections
        if (allSections[section - 1]) {
          allSections[section - 1].images = localAIImagesData;
          allSections[section - 1].localAIMode = true;
          console.log(`Ã°Å¸â€œâ€š ImÃƒÂ¡genes de IA Local almacenadas en allSections[${section - 1}]`);
        }
        
      } else if (bingImages && downloadedImages.length > 0) {
        // Mostrar carrusel con imÃƒÂ¡genes descargadas de Bing
        console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â Mostrando carrusel con ${downloadedImages.length} imÃƒÂ¡genes de Bing`);
        console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â DEBUG - Datos de la primera imagen:`, downloadedImages[0]);
        console.log(`Ã°Å¸â€Â DEBUG - data.imageKeywords:`, data.imageKeywords);
        console.log(`Ã°Å¸â€Â DEBUG - data completa:`, data);
        
        // Almacenar las keywords para el botÃƒÂ³n de refresh
        if (data.imageKeywords && data.imageKeywords.length > 0) {
          currentImageKeywords = data.imageKeywords;
          console.log(`Ã°Å¸Å½Â¯ Keywords almacenadas para refresh (bloque principal):`, currentImageKeywords);
        } else {
          console.warn(`Ã¢Å¡Â Ã¯Â¸Â No se recibieron keywords para refresh (bloque principal)`);
          console.warn(`Ã¢Å¡Â Ã¯Â¸Â DEBUG - data.imageKeywords:`, data.imageKeywords);
          currentImageKeywords = [];
        }
        
        console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â DEBUG - Llamando a createCarousel...`);
        createCarousel(downloadedImages, section, []);
        console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â DEBUG - createCarousel ejecutado`);
        
        // Guardar datos de imÃƒÂ¡genes en la secciÃƒÂ³n para navegaciÃƒÂ³n
        if (allSections[section - 1]) {
          allSections[section - 1].images = downloadedImages;
          allSections[section - 1].imageKeywords = data.imageKeywords || [];
          allSections[section - 1].imageMode = 'bing';
          console.log(`Ã°Å¸â€™Â¾ Datos de imÃƒÂ¡genes Bing guardados para secciÃƒÂ³n ${section}`);
        }
      } else if (!skipImages && !bingImages && !localAIImages && data.images && data.images.length > 0) {
        // Mostrar carrusel de imÃƒÂ¡genes normales
        console.log(`Ã°Å¸â€œÂ· Mostrando carrusel de imÃƒÂ¡genes normales`);
        createCarousel(data.images, section, data.imagePrompts);
        
        // Guardar datos de imÃƒÂ¡genes en la secciÃƒÂ³n para navegaciÃƒÂ³n
        if (allSections[section - 1]) {
          allSections[section - 1].images = data.images;
          allSections[section - 1].imagePrompts = data.imagePrompts || [];
          allSections[section - 1].imageMode = 'ai';
          console.log(`Ã°Å¸â€™Â¾ Datos de imÃƒÂ¡genes AI guardados para secciÃƒÂ³n ${section}`);
        }
      } else if (bingImages && data.imagePrompts && data.imagePrompts.length > 0) {
        // Fallback: mostrar prompts si fallÃƒÂ³ la descarga de Bing
        console.log(`Ã¢Å¡Â Ã¯Â¸Â Descarga de Bing fallÃƒÂ³, mostrando prompts como fallback`);
        addPromptsToSidebar(data.imagePrompts, section);
        
        // Guardar datos de prompts en la secciÃƒÂ³n para navegaciÃƒÂ³n
        if (allSections[section - 1]) {
          allSections[section - 1].imagePrompts = data.imagePrompts;
          allSections[section - 1].imageMode = 'prompts';
          console.log(`Ã°Å¸â€™Â¾ Datos de prompts guardados para secciÃƒÂ³n ${section}`);
        }
      } else if (data.imagePrompts && data.imagePrompts.length > 0) {
        // Mostrar prompts de imÃƒÂ¡genes en el panel lateral
        console.log(`Ã°Å¸â€œâ€¹ Mostrando prompts en el panel lateral`);
        addPromptsToSidebar(data.imagePrompts, section);
        
        // Guardar datos de prompts en la secciÃƒÂ³n para navegaciÃƒÂ³n
        if (allSections[section - 1]) {
          allSections[section - 1].imagePrompts = data.imagePrompts;
          allSections[section - 1].imageMode = 'prompts';
          console.log(`Ã°Å¸â€™Â¾ Datos de prompts guardados para secciÃƒÂ³n ${section}`);
        }
      }

      const sectionNumber = Number(section);
      if (Number.isInteger(sectionNumber) && sectionNumber > 0) {
        const primaryPrompts = Array.isArray(data.imagePrompts) ? data.imagePrompts : [];
        const secondaryPrompts = !primaryPrompts.length && Array.isArray(data.prompts) ? data.prompts : [];
        const keywordPrompts = !primaryPrompts.length && !secondaryPrompts.length && Array.isArray(data.imageKeywords)
          ? data.imageKeywords
          : [];

        const normalizedPrompts = (primaryPrompts.length ? primaryPrompts : secondaryPrompts.length ? secondaryPrompts : keywordPrompts)
          .filter((item) => typeof item === 'string' && item.trim().length > 0);

        const candidateImageSets = [
          Array.isArray(localAIImagesData) ? localAIImagesData : null,
          Array.isArray(downloadedImages) ? downloadedImages : null,
          Array.isArray(data.images) ? data.images : null,
          Array.isArray(data.imageUrls) ? data.imageUrls : null,
          Array.isArray(data.localAIImages) ? data.localAIImages : null,
          Array.isArray(data.generatedImages) ? data.generatedImages : null
        ];

        let imageCount = 0;
        candidateImageSets.forEach((collection) => {
          if (Array.isArray(collection) && collection.length > imageCount) {
            imageCount = collection.length;
          }
        });

        updateProjectSectionImageData(sectionNumber, {
          prompts: normalizedPrompts,
          imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : undefined,
          imageCount,
          googleImagesMode: Boolean(bingImages || data.googleImagesMode)
        });

        updateSectionImageProgressStat(sectionNumber, {
          promptCount: normalizedPrompts.length,
          imageCount
        });
      }
      resolve();
    }, 500);
  });
}

// FunciÃƒÂ³n para actualizar el progreso de generaciÃƒÂ³n automÃƒÂ¡tica
function updateGenerationProgress(section, total, phase, customMessage = null) {
  const phaseText = customMessage || (phase === 'script' ? 'Generando guiÃƒÂ³n e imÃƒÂ¡genes' : phase === 'audio' ? 'Generando audio' : phase === 'images' ? 'Generando imÃƒÂ¡genes' : 'Procesando...');
  
  generateBtn.innerHTML = `
    <i class="fas fa-magic"></i>
    <span>Auto: Fase ${section}/${total} - ${phaseText}...</span>
  `;
  
  // Actualizar etapas de carga
  if (phase === 'script') {
    showLoadingStages(section, parseInt(document.getElementById("imagesSelect").value), document.getElementById("skipImages").checked, document.getElementById("googleImages").checked, document.getElementById("localAIImages").checked);
  } else if (phase === 'audio') {
    showAudioGenerationStage(section);
  } else if (phase === 'images') {
    showImageGenerationStage(section);
  }
}

// FunciÃƒÂ³n para mostrar etapa de generaciÃƒÂ³n de audio
function showAudioGenerationStage(section) {
  output.innerHTML = `
    <div class="loading-stages">
      <div class="stage completed" id="stage-script">
        <div class="stage-icon"><i class="fas fa-check-circle"></i></div>
        <div class="stage-text">GuiÃƒÂ³n generado - SecciÃƒÂ³n ${section}</div>
      </div>
      <div class="stage completed" id="stage-images">
        <div class="stage-icon"><i class="fas fa-check-circle"></i></div>
        <div class="stage-text">ImÃƒÂ¡genes procesadas</div>
      </div>
      <div class="stage active" id="stage-audio">
        <div class="stage-icon"><i class="fas fa-spinner loading"></i></div>
        <div class="stage-text">Generando audio narraciÃƒÂ³n...</div>
      </div>
    </div>
  `;
}

// FunciÃƒÂ³n para mostrar etapa de generaciÃƒÂ³n de imÃƒÂ¡genes
function showImageGenerationStage(section) {
  output.innerHTML = `
    <div class="loading-stages">
      <div class="stage completed" id="stage-script">
        <div class="stage-icon"><i class="fas fa-check-circle"></i></div>
        <div class="stage-text">Todos los guiones generados</div>
      </div>
      <div class="stage completed" id="stage-audio">
        <div class="stage-icon"><i class="fas fa-check-circle"></i></div>
        <div class="stage-text">Todos los audios generados</div>
      </div>
      <div class="stage active" id="stage-images">
        <div class="stage-icon"><i class="fas fa-spinner loading"></i></div>
        <div class="stage-text">Generando todas las imÃƒÂ¡genes...</div>
      </div>
    </div>
  `;
}

// FunciÃƒÂ³n para mostrar completaciÃƒÂ³n de generaciÃƒÂ³n automÃƒÂ¡tica
async function showAutoGenerationComplete() {
  // No mostrar mensaje de ÃƒÂ©xito si hay mÃƒÂºltiples proyectos en progreso
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (hasMultipleProjects) {
    console.log('Ã°Å¸â€â€ž MÃƒÂºltiples proyectos en progreso - omitiendo mensaje de ÃƒÂ©xito individual');
    return;
  }
  
  generateBtn.innerHTML = `
    <i class="fas fa-check-circle"></i>
    <span>GeneraciÃƒÂ³n AutomÃƒÂ¡tica Completada</span>
  `;
  
  // Limpiar las etapas de loading
  const loadingStages = output.querySelector('.loading-stages');
  if (loadingStages) {
    loadingStages.remove();
    console.log("Ã°Å¸Â§Â¹ Etapas de loading limpiadas");
  }
  
  // Mostrar mensaje de ÃƒÂ©xito
  const successMessage = document.createElement('div');
  successMessage.className = 'auto-completion-message';
  successMessage.innerHTML = `
    <div class="success-content">
      <i class="fas fa-trophy"></i>
      <h3>Ã‚Â¡GeneraciÃƒÂ³n AutomÃƒÂ¡tica Completada!</h3>
      <p>Se han generado exitosamente ${totalSections} secciones con guiÃƒÂ³n, imÃƒÂ¡genes y audio.</p>
      <p>Puedes generar los metadatos de YouTube cuando lo necesites desde el botÃƒÂ³n "Generar Metadatos".</p>
    </div>
  `;
  
  output.insertBefore(successMessage, output.firstChild);
  
  const autoVideoEnabled = shouldGenerateVideoAutomatically();
  const folderInput = document.getElementById('folderName');
  const effectiveFolderName = (window.currentProject && window.currentProject.folderName) || (folderInput ? folderInput.value.trim() : '');
  const shouldAnnounceAutoVideo = autoVideoEnabled && !!effectiveFolderName && !isGeneratingVideo;

  if (shouldAnnounceAutoVideo) {
    const successContent = successMessage.querySelector('.success-content');
    if (successContent) {
      successContent.insertAdjacentHTML('beforeend', '<p><strong>Ã°Å¸Å½Â¬ Iniciando generaciÃƒÂ³n automÃƒÂ¡tica de video...</strong></p>');
    }
  }

  let projectButtonsUpdated = false;

  if (window.currentProject && Array.isArray(window.currentProject.completedSections)) {
    try {
      updateProjectButtons(window.currentProject);
      projectButtonsUpdated = true;
    } catch (projectButtonsError) {
      console.error('Ã¢ÂÅ’ Error actualizando los botones del proyecto tras la generaciÃƒÂ³n automÃƒÂ¡tica:', projectButtonsError);
    }
  }

  if (!projectButtonsUpdated) {
    showVideoGenerationButton();
    updateYouTubeMetadataButtonState();

    if (shouldAnnounceAutoVideo) {
      console.log('Ã°Å¸Å½Â¬ GeneraciÃƒÂ³n completa - iniciando video automÃƒÂ¡tico (fallback)...');
      setTimeout(() => {
        generateVideoAutomatically();
      }, 2000);
    }
  }
  
  setTimeout(() => {
    generateBtn.innerHTML = `
      <i class="fas fa-video"></i>
      <span>Generar SecciÃƒÂ³n 1</span>
    `;
  }, 3000);
}

// FunciÃƒÂ³n para habilitar/deshabilitar controles
function disableControls(disable) {
  const controls = [
    'prompt', 'folderName', 'voiceSelect', 'sectionsNumber', 
    'styleSelect', 'imagesSelect', 'aspectRatioSelect', 'promptModifier', 'imageModelSelect', 'llmModelSelect',
    'autoGenerateAudio', 'autoGenerateApplioAudio', 'googleImages', 'localAIImages'
  ];
  
  controls.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.disabled = disable;
    }
  });
  
  generateBtn.disabled = disable;
  generateAudioBtn.disabled = disable;
  
  // TambiÃƒÂ©n deshabilitar los botones de video
  const generateSimpleVideoBtn = document.getElementById("generateSimpleVideoBtn");
  if (generateSimpleVideoBtn) {
    generateSimpleVideoBtn.disabled = disable;
  }
  
  const generateSeparateVideosBtn = document.getElementById("generateSeparateVideosBtn");
  if (generateSeparateVideosBtn) {
    generateSeparateVideosBtn.disabled = disable;
  }

  const generateMetadataBtn = document.getElementById('generateYouTubeMetadataBtn');
  if (generateMetadataBtn) {
    generateMetadataBtn.disabled = disable;
  }

  if (!disable) {
    setGoogleApiCheckboxesDisabled(false);

    const attemptComfyCheckbox = document.getElementById('attemptComfyCheckbox');
    if (attemptComfyCheckbox) {
      attemptComfyCheckbox.disabled = false;
      const attemptComfyToggle = attemptComfyCheckbox.closest('.attempt-comfy-toggle');
      if (attemptComfyToggle) {
        attemptComfyToggle.classList.remove('is-disabled');
      }
    }
  }
}

// FunciÃƒÂ³n para mostrar mensaje de carga con etapas
function showLoadingStages(sectionNum, imageCount = 5, skipImages = false, googleImages = false, localAIImages = false) {
  let imageStagesHTML = '';
  
  if (!skipImages && !googleImages && !localAIImages) {
    // Modo normal: generar imÃƒÂ¡genes
    imageStagesHTML = `
      <div class="stage" id="stage-prompt">
        <div class="stage-icon"><i class="fas fa-brain"></i></div>
        <div class="stage-text">Creando secuencia visual...</div>
      </div>
      <div class="stage" id="stage-image">
        <div class="stage-icon"><i class="fas fa-images"></i></div>
        <div class="stage-text">Generando ${imageCount} imÃƒÂ¡genes gaming...</div>
      </div>
    `;
  } else if (googleImages) {
    // Modo Google Images: crear enlaces
    imageStagesHTML = `
      <div class="stage" id="stage-prompt">
        <div class="stage-icon"><i class="fab fa-google"></i></div>
        <div class="stage-text">Preparando enlaces de Google Images...</div>
      </div>
    `;
  } else if (localAIImages) {
    // Modo IA Local: generar con Fooocus
    imageStagesHTML = `
      <div class="stage" id="stage-prompt">
        <div class="stage-icon"><i class="fas fa-brain"></i></div>
        <div class="stage-text">Preparando prompts para IA local...</div>
      </div>
      <div class="stage" id="stage-image">
        <div class="stage-icon"><i class="fas fa-robot"></i></div>
        <div class="stage-text">Generando ${imageCount} imÃƒÂ¡genes con Fooocus...</div>
      </div>
    `;
  }
  
  output.innerHTML = `
    <div class="loading-stages">
      <div class="stage active" id="stage-script">
        <div class="stage-icon"><i class="fas fa-spinner loading"></i></div>
        <div class="stage-text">Generando guiÃƒÂ³n - SecciÃƒÂ³n ${sectionNum}...</div>
      </div>
      ${imageStagesHTML}
    </div>
  `;
}

// FunciÃƒÂ³n para actualizar etapa
function updateStage(stageId, status) {
  const stage = document.getElementById(stageId);
  
  // Validar que el elemento existe antes de continuar
  if (!stage) {
    console.warn(`Ã¢Å¡Â Ã¯Â¸Â updateStage: Elemento con ID '${stageId}' no encontrado`);
    return;
  }
  
  const icon = stage.querySelector('.stage-icon i');
  
  // Validar que el icono existe
  if (!icon) {
    console.warn(`Ã¢Å¡Â Ã¯Â¸Â updateStage: Icono no encontrado en elemento '${stageId}'`);
    return;
  }
  
  if (status === 'active') {
    stage.className = 'stage active';
    icon.className = 'fas fa-spinner loading';
  } else if (status === 'completed') {
    stage.className = 'stage completed';
    if (stageId === 'stage-script') {
      icon.className = 'fas fa-check-circle';
    } else if (stageId === 'stage-prompt') {
      icon.className = 'fas fa-check-circle';
    } else if (stageId === 'stage-image') {
      icon.className = 'fas fa-check-circle';
    }
  }
}

// FunciÃƒÂ³n para crear el carrusel de imÃƒÂ¡genes cronolÃƒÂ³gicas
function createCarousel(images, sectionNum, receivedPrompts = []) {
  console.log(`Ã°Å¸Å½Â  DEBUG - createCarousel llamada con ${images.length} imÃƒÂ¡genes para secciÃƒÂ³n ${sectionNum}`);
  
  const carouselContainer = document.getElementById("carousel-container");
  const carouselTrack = document.getElementById("carouselTrack");
  const carouselIndicators = document.getElementById("carouselIndicators");
  const currentImageSpan = document.getElementById("current-image");
  const totalImagesSpan = document.getElementById("total-images");
  const carouselSectionTitle = document.getElementById("carousel-section-title");
  
  console.log(`Ã°Å¸Å½Â  DEBUG - Elementos encontrados:`, {
    carouselContainer: !!carouselContainer,
    carouselTrack: !!carouselTrack,
    carouselIndicators: !!carouselIndicators,
    currentImageSpan: !!currentImageSpan,
    totalImagesSpan: !!totalImagesSpan,
    carouselSectionTitle: !!carouselSectionTitle
  });
  
  // Limpiar contenido anterior
  carouselTrack.innerHTML = '';
  carouselIndicators.innerHTML = '';
  
  totalSlides = images.length;
  currentSlide = 0;
  
  // Guardar los prompts de las imÃƒÂ¡genes - manejar mÃƒÂºltiples variaciones
  imagePrompts = images.map((img, index) => {
    if (img.prompt) {
      return img.prompt;
    } else if (img.caption) {
      // Para imÃƒÂ¡genes de Bing, usar el caption como prompt
      return img.caption;
    } else if (img.originalPromptIndex !== undefined && receivedPrompts && receivedPrompts[img.originalPromptIndex]) {
      // Si la imagen tiene un ÃƒÂ­ndice de prompt original, usar ese prompt
      return receivedPrompts[img.originalPromptIndex];
    } else if (receivedPrompts && receivedPrompts[Math.floor(index / 3)]) {
      // Fallback: dividir el ÃƒÂ­ndice por 3 para obtener el prompt original
      return receivedPrompts[Math.floor(index / 3)];
    }
    return '';
  });
  
  console.log('Prompts guardados:', imagePrompts.length);
  
  // Actualizar tÃƒÂ­tulos
  carouselSectionTitle.textContent = `SecciÃƒÂ³n ${sectionNum}`;
  currentImageSpan.textContent = currentSlide + 1;
  totalImagesSpan.textContent = totalSlides;
  
  // Crear slides
  images.forEach((imageData, index) => {
    const slide = document.createElement('div');
    slide.className = 'carousel-slide';
    
    // Contenedor de imagen
    const imageContainer = document.createElement('div');
    imageContainer.className = 'slide-content';
    
    const img = document.createElement('img');
    
    // Verificar si la imagen es local (descargada) o una URL externa
    if (imageData.path) {
      // Imagen almacenada localmente (IA o descargada). Convertir la ruta absoluta a relativa.
      let relativePath = imageData.path.replace(/\\/g, '/');

      const publicIndex = relativePath.indexOf('/public/');
      if (publicIndex !== -1) {
        relativePath = relativePath.substring(publicIndex + 7);
      } else {
        const outputsIndex = relativePath.indexOf('outputs/');
        if (outputsIndex !== -1) {
          relativePath = '/' + relativePath.substring(outputsIndex);
        }
      }

      if (!relativePath.startsWith('/')) {
        relativePath = '/' + relativePath;
      }

      img.src = relativePath;
      img.alt = imageData.caption || `Imagen ${index + 1} de la SecciÃƒÂ³n ${sectionNum}`;
      console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â Cargando imagen local: ${relativePath} (original: ${imageData.path})`);
    } else if (imageData.url) {
      // Imagen con URL pÃƒÂºblica (por ejemplo, Bing sin descarga local)
      img.src = imageData.url;
      img.alt = imageData.caption || `Imagen ${index + 1} de la SecciÃƒÂ³n ${sectionNum}`;
      console.log(`Ã°Å¸Å’Â Cargando imagen externa: ${imageData.url}`);
    } else if (imageData.image) {
      // Imagen generada con IA (base64)
      img.src = "data:image/png;base64," + imageData.image;
      img.alt = `Imagen ${index + 1} de la SecciÃƒÂ³n ${sectionNum}`;
      console.log(`Ã°Å¸Â¤â€“ Cargando imagen IA (base64)`);
    } else {
      // Fallback para formato no reconocido
      console.warn('Formato de imagen no reconocido:', imageData);
      img.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNiIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlbiBubyBkaXNwb25pYmxlPC90ZXh0Pjwvc3ZnPg==";
      img.alt = `Error cargando imagen ${index + 1}`;
    }
    
    img.style.opacity = "0";
    img.style.transition = "opacity 0.5s ease";
    
    // Agregar manejo de errores para imÃƒÂ¡genes de Bing
    img.onerror = function() {
      this.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNiIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkVycm9yIGNhcmdhbmRvIGltYWdlbjwvdGV4dD48L3N2Zz4=";
      this.alt = "Error cargando imagen";
    };
    
    imageContainer.appendChild(img);
    
    // Agregar botones de acciÃƒÂ³n para imÃƒÂ¡genes de Bing
    if (imageData.url) {
      // Obtener keyword para esta imagen
      const imageKeyword = (currentImageKeywords && currentImageKeywords[index]) ? currentImageKeywords[index] : '';
      console.log(`Ã°Å¸â€â€˜ [createCarousel] Imagen ${index}: keyword="${imageKeyword}"`);
      
      const actionButtons = document.createElement('div');
      actionButtons.className = 'bing-image-actions';
      actionButtons.innerHTML = `
        <div class="keyword-editor">
          <label for="keyword-${index}-${sectionNum}">TÃƒÂ©rmino de bÃƒÂºsqueda:</label>
          <input type="text" id="keyword-${index}-${sectionNum}" class="keyword-input" value="${imageKeyword}" placeholder="Ingresa tÃƒÂ©rminos de bÃƒÂºsqueda...">
        </div>
        <div class="action-buttons">
          <button class="btn-bing-download" onclick="downloadBingImage('${imageData.url}', '${imageData.filename || 'bing_image.jpg'}')" title="Descargar imagen">
            <i class="fas fa-download"></i>
          </button>
          <button class="btn-bing-fullscreen" onclick="showBingImageFullscreen('${imageData.url}', '${imageData.caption || 'Imagen de Bing'}')" title="Ver en tamaÃƒÂ±o completo">
            <i class="fas fa-expand"></i>
          </button>
          <button class="btn-bing-refresh" onclick="refreshBingImageWithCustomKeyword(${index}, ${sectionNum})" title="Renovar imagen">
            <i class="fas fa-sync-alt"></i>
          </button>
        </div>
      `;
      imageContainer.appendChild(actionButtons);
    }
    
    slide.appendChild(imageContainer);
    carouselTrack.appendChild(slide);
    
    // Crear indicador
    const indicator = document.createElement('div');
    indicator.className = 'carousel-indicator';
    if (index === 0) indicator.classList.add('active');
    indicator.addEventListener('click', () => goToSlide(index));
    
    // AÃƒÂ±adir nÃƒÂºmero al indicador
    const indicatorNumber = document.createElement('span');
    indicatorNumber.textContent = index + 1;
    indicator.appendChild(indicatorNumber);
    
    carouselIndicators.appendChild(indicator);
    
    // AnimaciÃƒÂ³n de carga de imagen
    setTimeout(() => {
      img.style.opacity = "1";
    }, index * 200);
  });
  
  // Mostrar carrusel
  console.log(`Ã°Å¸Å½Â  DEBUG - Mostrando carrusel: ${carouselContainer ? 'elemento encontrado' : 'elemento NO encontrado'}`);
  console.log(`Ã°Å¸Å½Â  DEBUG - Display antes:`, carouselContainer ? carouselContainer.style.display : 'N/A');
  
  carouselContainer.style.display = "block";
  
  console.log(`Ã°Å¸Å½Â  DEBUG - Display despuÃƒÂ©s:`, carouselContainer ? carouselContainer.style.display : 'N/A');
  console.log(`Ã°Å¸Å½Â  DEBUG - Computed display:`, carouselContainer ? getComputedStyle(carouselContainer).display : 'N/A');
  console.log(`Ã°Å¸Å½Â  DEBUG - Visibility:`, carouselContainer ? getComputedStyle(carouselContainer).visibility : 'N/A');
  console.log(`Ã°Å¸Å½Â  DEBUG - OffsetHeight:`, carouselContainer ? carouselContainer.offsetHeight : 'N/A');
  
  // Configurar controles del carrusel
  setupCarouselControls();
  
  // Agregar prompts al panel lateral
  if (receivedPrompts && receivedPrompts.length > 0) {
    addPromptsToSidebar(receivedPrompts, sectionNum);
  }
  
  // Mostrar panel de prompts
  // setupImagePromptPanel(); // Comentado: Panel eliminado, ahora se usa el panel lateral
}

// FunciÃƒÂ³n para configurar controles del carrusel
function setupCarouselControls() {
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  
  prevBtn.addEventListener("click", () => {
    goToSlide(currentSlide - 1);
  });
  
  nextBtn.addEventListener("click", () => {
    goToSlide(currentSlide + 1);
  });
  
  updateCarouselButtons();
}

// FunciÃƒÂ³n para ir a un slide especÃƒÂ­fico
function goToSlide(slideIndex) {
  if (slideIndex < 0 || slideIndex >= totalSlides) return;
  
  currentSlide = slideIndex;
  const carouselTrack = document.getElementById("carouselTrack");
  const transform = `translateX(-${currentSlide * 100}%)`;
  carouselTrack.style.transform = transform;
  
  // Actualizar indicadores
  const indicators = document.querySelectorAll('.carousel-indicator');
  indicators.forEach((indicator, index) => {
    indicator.classList.toggle('active', index === currentSlide);
  });
  
  // Actualizar contador
  document.getElementById("current-image").textContent = currentSlide + 1;
  
  // Actualizar prompt panel
  // updateImagePromptPanel(); // Comentado: Panel eliminado, ahora se usa el panel lateral
  
  updateCarouselButtons();
}

// FunciÃƒÂ³n para actualizar estado de botones del carrusel
function updateCarouselButtons() {
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  
  prevBtn.disabled = currentSlide === 0;
  nextBtn.disabled = currentSlide === totalSlides - 1;
}

// FunciÃƒÂ³n para configurar el panel de prompts de imÃƒÂ¡genes
function setupImagePromptPanel() {
  const promptPanel = document.getElementById("imagePromptPanel");
  const promptToggleBtn = document.getElementById("promptToggleBtn");
  const promptContent = document.getElementById("promptContent");
  const editPromptBtn = document.getElementById("editPromptBtn");
  const promptEdit = document.getElementById("promptEdit");
  const promptView = document.getElementById("promptView");
  const savePromptBtn = document.getElementById("savePromptBtn");
  const cancelPromptBtn = document.getElementById("cancelPromptBtn");
  const promptTextarea = document.getElementById("promptTextarea");
  
  // Mostrar el panel
  promptPanel.style.display = "block";
  
  // Limpiar eventos anteriores
  promptToggleBtn.replaceWith(promptToggleBtn.cloneNode(true));
  editPromptBtn.replaceWith(editPromptBtn.cloneNode(true));
  savePromptBtn.replaceWith(savePromptBtn.cloneNode(true));
  cancelPromptBtn.replaceWith(cancelPromptBtn.cloneNode(true));
  
  const regenerateImageBtn = document.getElementById("regenerateImageBtn");
  if (regenerateImageBtn) {
    regenerateImageBtn.replaceWith(regenerateImageBtn.cloneNode(true));
  }
  
  // Re-obtener referencias despuÃƒÂ©s del clonado
  const newPromptToggleBtn = document.getElementById("promptToggleBtn");
  const newEditPromptBtn = document.getElementById("editPromptBtn");
  const newSavePromptBtn = document.getElementById("savePromptBtn");
  const newCancelPromptBtn = document.getElementById("cancelPromptBtn");
  const newRegenerateImageBtn = document.getElementById("regenerateImageBtn");
  
  // Configurar el toggle del prompt
  newPromptToggleBtn.addEventListener("click", () => {
    const isVisible = promptContent.style.display !== "none";
    promptContent.style.display = isVisible ? "none" : "block";
    
    const icon = newPromptToggleBtn.querySelector("i");
    const text = newPromptToggleBtn.querySelector("span");
    
    if (isVisible) {
      icon.className = "fas fa-eye";
      text.textContent = "Mostrar Prompt";
    } else {
      icon.className = "fas fa-eye-slash";
      text.textContent = "Ocultar Prompt";
      // updateImagePromptPanel(); // Comentado: Panel eliminado
    }
  });
  
  // Configurar botÃƒÂ³n de editar
  newEditPromptBtn.addEventListener("click", () => {
    promptView.style.display = "none";
    promptEdit.style.display = "block";
    
    // Llenar el textarea con el prompt actual
    promptTextarea.value = imagePrompts[currentSlide] || '';
    promptTextarea.focus();
  });
  
  // Configurar botÃƒÂ³n de cancelar
  newCancelPromptBtn.addEventListener("click", () => {
    promptEdit.style.display = "none";
    promptView.style.display = "block";
  });
  
  // Configurar botÃƒÂ³n de guardar y regenerar
  newSavePromptBtn.addEventListener("click", async () => {
    const newPrompt = promptTextarea.value.trim();
    if (!newPrompt) {
      alert("El prompt no puede estar vacÃƒÂ­o");
      return;
    }
    
    await regenerateImage(currentSlide, newPrompt);
  });
  
  // Configurar botÃƒÂ³n de regenerar imagen (sin editar prompt)
  if (newRegenerateImageBtn) {
    newRegenerateImageBtn.addEventListener("click", async () => {
      const currentPrompt = imagePrompts[currentSlide];
      if (!currentPrompt) {
        alert("No hay prompt disponible para regenerar esta imagen");
        return;
      }
      
      // Mostrar estado de carga en el botÃƒÂ³n
      const originalContent = newRegenerateImageBtn.innerHTML;
      newRegenerateImageBtn.disabled = true;
      newRegenerateImageBtn.classList.add('loading');
      newRegenerateImageBtn.innerHTML = `
        <i class="fas fa-sync-alt"></i>
        <span>Regenerando...</span>
      `;
      
      try {
        await regenerateImage(currentSlide, currentPrompt);
      } catch (error) {
        console.error('Error al regenerar imagen:', error);
        alert('Error al regenerar la imagen. Por favor, intÃƒÂ©ntalo de nuevo.');
      } finally {
        // Restaurar estado del botÃƒÂ³n
        newRegenerateImageBtn.disabled = false;
        newRegenerateImageBtn.classList.remove('loading');
        newRegenerateImageBtn.innerHTML = originalContent;
      }
    });
  }
  
  // Configurar primer prompt
  // updateImagePromptPanel(); // Comentado: Panel eliminado
}

// FunciÃƒÂ³n para actualizar el panel de prompt de la imagen actual
function updateImagePromptPanel() {
  const currentImageNumber = document.getElementById("currentImageNumber");
  const promptText = document.getElementById("promptText");
  
  if (currentImageNumber) {
    currentImageNumber.textContent = currentSlide + 1;
  }
  
  if (promptText && imagePrompts[currentSlide]) {
    // Limpiar el prompt del estilo adicional para mostrar solo el prompt original
    const cleanPrompt = imagePrompts[currentSlide]
      .replace(/\n\nESTILO REQUERIDO:.*$/s, '')
      .trim();
    promptText.textContent = cleanPrompt;
  }
}

// FunciÃƒÂ³n para regenerar una imagen
async function regenerateImage(imageIndex, newPrompt) {
  const savePromptBtn = document.getElementById("savePromptBtn");
  const regenerationStatus = document.getElementById("regenerationStatus");
  const promptEdit = document.getElementById("promptEdit");
  const promptView = document.getElementById("promptView");
  const folderName = document.getElementById("folderName").value.trim();
  
  // Mostrar estado de carga
  savePromptBtn.disabled = true;
  savePromptBtn.innerHTML = `
    <i class="fas fa-spinner loading"></i>
    Regenerando...
  `;
  
  promptEdit.style.display = "none";
  regenerationStatus.style.display = "block";
  
  try {
  const selectedImageModel = getSelectedImageModel();
    const response = await fetch("/regenerate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: newPrompt,
        imageIndex: imageIndex,
        topic: currentTopic,
        folderName: folderName,
        currentSection: currentSectionNumber,
        imageModel: selectedImageModel
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Ahora el backend devuelve mÃƒÂºltiples imÃƒÂ¡genes, usar la primera como reemplazo principal
      const primaryImage = data.images[0];
      
      // Actualizar la imagen en el carrusel con la primera variaciÃƒÂ³n
      const slides = document.querySelectorAll('.carousel-slide');
      const img = slides[imageIndex].querySelector('img');
      img.src = "data:image/png;base64," + primaryImage.image;
      
      // Actualizar el prompt guardado
      imagePrompts[imageIndex] = data.prompt;
      
      // Actualizar el prompt mostrado
      // updateImagePromptPanel(); // Comentado: Panel eliminado
      
      // Mostrar mensaje de ÃƒÂ©xito con informaciÃƒÂ³n sobre las variaciones
      regenerationStatus.innerHTML = `
        <div class="regeneration-loading" style="color: #00ff7f;">
          <i class="fas fa-check-circle"></i>
          <span>Ã‚Â¡${data.images.length} variaciones regeneradas! Se muestra la primera.</span>
        </div>
      `;
      
      setTimeout(() => {
        regenerationStatus.style.display = "none";
        promptView.style.display = "block";
      }, 2000);
      
    } else {
      throw new Error(data.error || 'Error regenerando imagen');
    }
    
  } catch (error) {
    console.error('Error regenerando imagen:', error);
    
    // Mostrar error
    regenerationStatus.innerHTML = `
      <div class="regeneration-loading" style="color: #e53e3e;">
        <i class="fas fa-exclamation-triangle"></i>
        <span>Error regenerando imagen: ${error.message}</span>
      </div>
    `;
    
    setTimeout(() => {
      regenerationStatus.style.display = "none";
      promptEdit.style.display = "block";
    }, 3000);
    
  } finally {
    // Restaurar botÃƒÂ³n
    savePromptBtn.disabled = false;
    savePromptBtn.innerHTML = `
      <i class="fas fa-save"></i>
      Guardar y Regenerar
    `;
  }
}

// FunciÃƒÂ³n para mostrar guiÃƒÂ³n (sin audio inicialmente)
function showScript(script, sectionNum, totalSections, voiceUsed = null, scriptFileInfo = null, tokenUsage = null) {
  const scriptSection = document.getElementById("script-section");
  const scriptContent = document.getElementById("script-content");
  const audioControls = document.getElementById("audio-controls");
  const sectionTitle = document.getElementById("section-title");
  const currentSectionSpan = document.getElementById("current-section");
  const totalSectionsSpan = document.getElementById("total-sections");
  
  currentScript = script;
  currentVoice = voiceUsed || document.getElementById("voiceSelect").value;
  currentSectionNumber = sectionNum;
  
  // Obtener el tÃƒÂ­tulo del capÃƒÂ­tulo actual
  let chapterTitle = null;
  if (globalChapterStructure && globalChapterStructure.length > 0 && sectionNum <= globalChapterStructure.length) {
    chapterTitle = globalChapterStructure[sectionNum - 1];
  }
  
  // Guardar la secciÃƒÂ³n completa en el array de secciones
  allSections[sectionNum - 1] = {
    script: script,
    chapterTitle: chapterTitle,
    tokenUsage: tokenUsage,
    voiceUsed: voiceUsed,
    scriptFileInfo: scriptFileInfo,
    images: null,
    imagePrompts: null,
    imageKeywords: null,
    imageMode: null
  };
  
  console.log(`Guardando secciÃƒÂ³n ${sectionNum} completa:`, {
    script: script.substring(0, 100) + '...',
    chapterTitle: chapterTitle,
    tokenUsage: tokenUsage
  });
  
  // Actualizar tÃƒÂ­tulos y contadores
  sectionTitle.textContent = `SecciÃƒÂ³n ${sectionNum}`;
  currentSectionSpan.textContent = sectionNum;
  totalSectionsSpan.textContent = totalSections;
  
  // Actualizar tÃƒÂ­tulo del capÃƒÂ­tulo si estÃƒÂ¡ disponible
  updateChapterTitle(sectionNum);
  
  // Actualizar informaciÃƒÂ³n de tokens si estÃƒÂ¡ disponible
  updateTokenUsage(tokenUsage);
  
  // Crear contenido del script con informaciÃƒÂ³n del archivo guardado
  let scriptHTML = `
    <div class="script-container">
      <div class="script-actions">
        <button class="copy-script-btn" onclick="copyScriptText()" title="Copiar texto del guiÃƒÂ³n">
          <i class="fas fa-copy"></i>
        </button>
        <button class="audio-script-btn" onclick="generateSectionAudioButton()" title="Generar audio del guiÃƒÂ³n">
          <i class="fas fa-microphone"></i>
        </button>
      </div>
      <div class="script-text">${script.replace(/\n/g, '<br><br>')}</div>
    </div>`;
  
  // Agregar informaciÃƒÂ³n sobre el archivo guardado si estÃƒÂ¡ disponible
  if (scriptFileInfo && scriptFileInfo.saved) {
    scriptHTML += `
      <div class="script-file-info">
        <div class="file-saved-notification">
          <i class="fas fa-save"></i>
          <span>GuiÃƒÂ³n guardado automÃƒÂ¡ticamente como: <strong>${scriptFileInfo.filename}</strong></span>
        </div>
      </div>
    `;
  }
  
  scriptContent.innerHTML = scriptHTML;
  scriptSection.style.display = "block";
  
  // Inicializar el contenedor colapsado
  const scriptContainer = scriptSection.querySelector('.script-container');
  if (scriptContainer) {
    scriptContainer.classList.add('collapsed');
  }
  
  // Ocultar controles de audio inicialmente
  audioControls.style.display = "none";
  
  // Mostrar botÃƒÂ³n de generar audio
  generateAudioBtn.style.display = "inline-flex";
  
  // Actualizar estado de los botones de navegaciÃƒÂ³n
  updateNavigationButtons();
  
  // Reinicializar navegaciÃƒÂ³n para asegurar que los eventos funcionen
  initializeSectionNavigation();
  
  // AnimaciÃƒÂ³n de escritura
  scriptContent.style.opacity = "0";
  setTimeout(() => {
    scriptContent.style.transition = "opacity 1s ease";
    scriptContent.style.opacity = "1";
  }, 100);
}

// FunciÃƒÂ³n para mostrar audio cuando se genere
function showAudio(audioFileName, voiceUsed) {
  const audioControls = document.getElementById("audio-controls");
  const scriptAudio = document.getElementById("scriptAudio");
  const playBtn = document.getElementById("playBtn");
  
  scriptAudio.src = audioFileName;
  audioControls.style.display = "flex";
  
  // Actualizar el texto del botÃƒÂ³n para mostrar la voz usada
  const voiceInfo = voiceUsed ? ` (${voiceUsed})` : '';
  playBtn.innerHTML = `
    <i class="fas fa-play"></i>
    <span>Escuchar NarraciÃƒÂ³n${voiceInfo}</span>
  `;
  
  // Ocultar botÃƒÂ³n de generar audio y campo de estilo de narraciÃƒÂ³n
  generateAudioBtn.style.display = "none";
  
  setupAudioControls();
}

// FunciÃƒÂ³n para copiar el texto del guiÃƒÂ³n al portapapeles
function copyScriptText() {
  // Obtener el script de la secciÃƒÂ³n actual que se estÃƒÂ¡ mostrando (compatible con formato nuevo y antiguo)
  const sectionData = allSections[currentSectionNumber - 1];
  const scriptText = typeof sectionData === 'string' ? sectionData : (sectionData ? sectionData.script : null);
  
  if (!scriptText) {
    console.log(`Ã¢ÂÅ’ No hay texto del guiÃƒÂ³n para la secciÃƒÂ³n ${currentSectionNumber}`);
    return;
  }
  
  // Usar la API moderna del portapapeles si estÃƒÂ¡ disponible
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(scriptText).then(() => {
      console.log(`Ã¢Å“â€¦ Texto del guiÃƒÂ³n de la secciÃƒÂ³n ${currentSectionNumber} copiado al portapapeles`);
      showCopyNotification();
    }).catch(err => {
      console.error('Ã¢ÂÅ’ Error copiando al portapapeles:', err);
      fallbackCopyTextToClipboard(scriptText);
    });
  } else {
    // Fallback para navegadores mÃƒÂ¡s antiguos
    fallbackCopyTextToClipboard(scriptText);
  }
}

// FunciÃƒÂ³n fallback para copiar texto (navegadores mÃƒÂ¡s antiguos)
function fallbackCopyTextToClipboard(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    const successful = document.execCommand('copy');
    if (successful) {
      console.log('Ã¢Å“â€¦ Texto del guiÃƒÂ³n copiado al portapapeles (fallback)');
      showCopyNotification();
    } else {
      console.error('Ã¢ÂÅ’ Error copiando al portapapeles (fallback)');
    }
  } catch (err) {
    console.error('Ã¢ÂÅ’ Error ejecutando comando de copia:', err);
  }
  
  document.body.removeChild(textArea);
}

// FunciÃƒÂ³n para mostrar notificaciÃƒÂ³n de copiado
function showCopyNotification() {
  const button = document.querySelector('.copy-script-btn');
  if (button) {
    const originalHTML = button.innerHTML;
    button.innerHTML = `<i class="fas fa-check"></i> SecciÃƒÂ³n ${currentSectionNumber}`;
    button.style.background = 'linear-gradient(135deg, #00ff7f, #00bf63)';
    
    setTimeout(() => {
      button.innerHTML = originalHTML;
      button.style.background = '';
    }, 2000);
  }
}

// FunciÃƒÂ³n para generar audio de la secciÃƒÂ³n actual usando Applio (botÃƒÂ³n micrÃƒÂ³fono)
async function generateSectionAudioButton() {
  const audioButton = document.querySelector('.audio-script-btn');
  if (!audioButton) {
    console.error('Ã¢ÂÅ’ BotÃƒÂ³n de audio no encontrado');
    return;
  }

  // Verificar que tenemos los datos necesarios
  if (!currentScript || !currentTopic || !currentSectionNumber) {
    showError('No hay suficientes datos para generar el audio. AsegÃƒÂºrate de haber generado una secciÃƒÂ³n primero.');
    return;
  }

  const originalHTML = audioButton.innerHTML;
  const originalBackground = audioButton.style.background;
  
  try {
    // Mostrar estado de carga
    audioButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    audioButton.style.background = 'linear-gradient(135deg, #ff9500, #ff7b00)';
    audioButton.disabled = true;

    console.log(`Ã°Å¸Å½Âµ Generando audio con Applio para secciÃƒÂ³n ${currentSectionNumber}...`);

    const folderName = document.getElementById("folderName")?.value?.trim() || '';

    const response = await fetch('/generate-section-audio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        script: currentScript,
        topic: currentTopic,
        folderName: folderName,
        currentSection: currentSectionNumber
      }),
    });

    const result = await response.json();

    if (result.success) {
      // Mostrar ÃƒÂ©xito
      audioButton.innerHTML = '<i class="fas fa-check"></i>';
      audioButton.style.background = 'linear-gradient(135deg, #00ff7f, #00bf63)';
      
      showSuccess(`Audio generado con ${result.method || 'Applio'} para la secciÃƒÂ³n ${currentSectionNumber}`);
      
      console.log(`Ã¢Å“â€¦ Audio generado: ${result.audioFile}`);
      
    } else {
      throw new Error(result.error || 'Error generando audio');
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error generando audio:', error);
    
    // Mostrar error
    audioButton.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
    audioButton.style.background = 'linear-gradient(135deg, #e53e3e, #c53030)';
    
    // Mensajes de error mÃƒÂ¡s especÃƒÂ­ficos
    let errorMessage = `Error generando audio: ${error.message}`;
    
    if (error.message.includes('servidor Applio no disponible') || error.message.includes('503')) {
      errorMessage = 'Servidor Applio no disponible. Ejecuta: python applio_server.py en el puerto 5004';
    } else if (error.message.includes('ECONNREFUSED')) {
      errorMessage = 'No se puede conectar al servidor Applio. Verifica que estÃƒÂ© corriendo.';
    }
    
    showError(errorMessage);
  } finally {
    // Restaurar botÃƒÂ³n despuÃƒÂ©s de 3 segundos
    setTimeout(() => {
      audioButton.innerHTML = originalHTML;
      audioButton.style.background = originalBackground;
      audioButton.disabled = false;
    }, 3000);
  }
}

// FunciÃƒÂ³n para configurar controles de audio
function setupAudioControls() {
  const playBtn = document.getElementById("playBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const scriptAudio = document.getElementById("scriptAudio");
  const progressBar = document.getElementById("progressBar");
  const progressFill = document.getElementById("progressFill");
  const progressHandle = document.getElementById("progressHandle");
  const currentTimeEl = document.getElementById("currentTime");
  const totalTimeEl = document.getElementById("totalTime");
  const volumeSlider = document.getElementById("volumeSlider");
  
  let isDragging = false;
  
  // FunciÃƒÂ³n para formatear tiempo
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  
  // FunciÃƒÂ³n para actualizar posiciÃƒÂ³n de la barra de progreso
  function updateProgress() {
    if (!isDragging && scriptAudio.duration) {
      const progress = (scriptAudio.currentTime / scriptAudio.duration) * 100;
      progressFill.style.width = progress + '%';
      progressHandle.style.left = progress + '%';
      currentTimeEl.textContent = formatTime(scriptAudio.currentTime);
    }
  }
  
  // FunciÃƒÂ³n para establecer posiciÃƒÂ³n del audio
  function setAudioPosition(percentage) {
    if (scriptAudio.duration) {
      scriptAudio.currentTime = (percentage / 100) * scriptAudio.duration;
      progressFill.style.width = percentage + '%';
      progressHandle.style.left = percentage + '%';
      currentTimeEl.textContent = formatTime(scriptAudio.currentTime);
    }
  }
  
  // Eventos de los botones de reproducciÃƒÂ³n
  playBtn.addEventListener("click", () => {
    scriptAudio.play();
    playBtn.style.display = "none";
    pauseBtn.style.display = "flex";
    playBtn.classList.add("playing");
  });
  
  pauseBtn.addEventListener("click", () => {
    scriptAudio.pause();
    pauseBtn.style.display = "none";
    playBtn.style.display = "flex";
    playBtn.classList.remove("playing");
  });
  
  // Control de volumen
  volumeSlider.addEventListener("input", (e) => {
    scriptAudio.volume = e.target.value / 100;
  });
  
  // Establecer volumen inicial
  scriptAudio.volume = 0.8;
  
  // Eventos del audio
  scriptAudio.addEventListener("loadedmetadata", () => {
    totalTimeEl.textContent = formatTime(scriptAudio.duration);
    progressFill.style.width = "0%";
    progressHandle.style.left = "0%";
  });
  
  scriptAudio.addEventListener("timeupdate", updateProgress);
  
  scriptAudio.addEventListener("ended", () => {
    pauseBtn.style.display = "none";
    playBtn.style.display = "flex";
    playBtn.classList.remove("playing");
    progressFill.style.width = "0%";
    progressHandle.style.left = "0%";
    currentTimeEl.textContent = "0:00";
  });
  
  scriptAudio.addEventListener("error", (e) => {
    console.error("Error loading audio:", e);
    document.getElementById("audio-controls").style.display = "none";
  });
  
  // Eventos de la barra de progreso - Click
  progressBar.addEventListener("click", (e) => {
    if (!isDragging) {
      const rect = progressBar.getBoundingClientRect();
      const percentage = ((e.clientX - rect.left) / rect.width) * 100;
      setAudioPosition(Math.max(0, Math.min(100, percentage)));
    }
  });
  
  // Eventos de arrastre del handle
  progressHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    isDragging = true;
    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", handleDragEnd);
  });
  
  function handleDrag(e) {
    if (isDragging) {
      const rect = progressBar.getBoundingClientRect();
      const percentage = ((e.clientX - rect.left) / rect.width) * 100;
      const clampedPercentage = Math.max(0, Math.min(100, percentage));
      
      progressFill.style.width = clampedPercentage + '%';
      progressHandle.style.left = clampedPercentage + '%';
      
      if (scriptAudio.duration) {
        const newTime = (clampedPercentage / 100) * scriptAudio.duration;
        currentTimeEl.textContent = formatTime(newTime);
      }
    }
  }
  
  function handleDragEnd(e) {
    if (isDragging) {
      const rect = progressBar.getBoundingClientRect();
      const percentage = ((e.clientX - rect.left) / rect.width) * 100;
      const clampedPercentage = Math.max(0, Math.min(100, percentage));
      
      setAudioPosition(clampedPercentage);
      isDragging = false;
      
      document.removeEventListener("mousemove", handleDrag);
      document.removeEventListener("mouseup", handleDragEnd);
    }
  }
  
  // Soporte para dispositivos tÃƒÂ¡ctiles
  progressHandle.addEventListener("touchstart", (e) => {
    e.preventDefault();
    isDragging = true;
    document.addEventListener("touchmove", handleTouchDrag, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
  });
  
  function handleTouchDrag(e) {
    e.preventDefault();
    if (isDragging && e.touches.length > 0) {
      const rect = progressBar.getBoundingClientRect();
      const percentage = ((e.touches[0].clientX - rect.left) / rect.width) * 100;
      const clampedPercentage = Math.max(0, Math.min(100, percentage));
      
      progressFill.style.width = clampedPercentage + '%';
      progressHandle.style.left = clampedPercentage + '%';
      
      if (scriptAudio.duration) {
        const newTime = (clampedPercentage / 100) * scriptAudio.duration;
        currentTimeEl.textContent = formatTime(newTime);
      }
    }
  }
  
  function handleTouchEnd(e) {
    if (isDragging) {
      const rect = progressBar.getBoundingClientRect();
      const lastTouch = e.changedTouches[0];
      const percentage = ((lastTouch.clientX - rect.left) / rect.width) * 100;
      const clampedPercentage = Math.max(0, Math.min(100, percentage));
      
      setAudioPosition(clampedPercentage);
      isDragging = false;
      
      document.removeEventListener("touchmove", handleTouchDrag);
      document.removeEventListener("touchend", handleTouchEnd);
    }
  }
}

// FunciÃƒÂ³n para mostrar error
function showError(message) {
  output.innerHTML = `
    <div class="error-message">
      <i class="fas fa-exclamation-triangle"></i>
      <strong>Ã‚Â¡Oops!</strong> ${message}
    </div>
  `;
}

// FunciÃƒÂ³n para mostrar ÃƒÂ©xito
function showSuccess(message) {
  output.innerHTML = `
    <div class="success-message">
      <i class="fas fa-check-circle"></i>
      <strong>Ã‚Â¡Ãƒâ€°xito!</strong> ${message}
    </div>
  `;
}

// FunciÃƒÂ³n para mostrar mensaje de finalizaciÃƒÂ³n
function showCompletionMessage(sectionNum, totalSections, isComplete) {
  if (isComplete) {
    output.innerHTML = `
      <div class="completion-message">
        <div class="completion-icon">
          <i class="fas fa-trophy"></i>
        </div>
        <h3>Ã‚Â¡GuiÃƒÂ³n Completo de "CrÃƒÂ³nicas del Gaming"!</h3>
        <p>Has generado todas las ${totalSections} secciones del guiÃƒÂ³n. Cada secciÃƒÂ³n incluye su secuencia visual cronolÃƒÂ³gica. Ahora puedes generar el audio de narraciÃƒÂ³n.</p>
        <p style="color: #00ff7f; margin-top: 15px;"><i class="fas fa-youtube"></i> Usa el botÃƒÂ³n "Generar Metadatos" cuando quieras preparar la metadata de YouTube.</p>
      </div>
    `;
      updateYouTubeMetadataButtonState();
  } else {
    output.innerHTML = `
      <div class="completion-message">
        <div class="completion-icon">
          <i class="fas fa-check-circle"></i>
        </div>
        <h3>Ã‚Â¡SecciÃƒÂ³n ${sectionNum} Completada!</h3>
        <p>GuiÃƒÂ³n y secuencia visual de la SecciÃƒÂ³n ${sectionNum} listos. Puedes generar el audio o continuar con la SecciÃƒÂ³n ${sectionNum + 1}.</p>
      </div>
    `;
  }
}

// Event listener para el botÃƒÂ³n principal
generateBtn.addEventListener("click", async () => {
  console.log("Ã°Å¸â€Â DEBUG: BotÃƒÂ³n clickeado");
  
  // GeneraciÃƒÂ³n automÃƒÂ¡tica estÃƒÂ¡ siempre activada
  const autoGenerate = true;
  console.log(`Ã°Å¸â€Â DEBUG: autoGenerate = ${autoGenerate}`);
  
  if (autoGenerate) {
    console.log("Ã°Å¸Â¤â€“ DETECTADO: GeneraciÃƒÂ³n automÃƒÂ¡tica ACTIVADA - usando sistema de lotes");
    // PequeÃƒÂ±o delay para asegurar que el DOM estÃƒÂ© completamente listo
    setTimeout(async () => {
      await runAutoGeneration();
    }, 100);
    return;
  }
  
  console.log("Ã°Å¸â€œÂ DETECTADO: GeneraciÃƒÂ³n automÃƒÂ¡tica DESACTIVADA - usando sistema tradicional");
  
  // Continuar con la generaciÃƒÂ³n normal
  const topic = promptInput.value.trim();
  const folderName = document.getElementById("folderName").value.trim();
  const selectedVoice = document.getElementById("voiceSelect").value;
  const selectedSections = document.getElementById("sectionsNumber").value;
  const minWords = parseInt(document.getElementById("minWords").value) || 800;
  const maxWords = parseInt(document.getElementById("maxWords").value) || 1100;
  const selectedStyle = document.getElementById("styleSelect").value;
  const imageCount = parseInt(document.getElementById("imagesSelect").value);
  const aspectRatio = document.getElementById("aspectRatioSelect").value;
  const promptModifier = document.getElementById("promptModifier").value.trim();
  const selectedImageModel = getSelectedImageModel();
  const selectedLlmModel = document.getElementById("llmModelSelect").value;
  const skipImages = document.getElementById("skipImages").checked;
  const googleImages = document.getElementById("googleImages").checked;
  const localAIImages = document.getElementById("localAIImages").checked;
  const selectedApplioVoice = document.getElementById("applioVoiceSelect").value;
  const selectedApplioModel = document.getElementById("applioModelSelect").value;
  const applioPitch = parseInt(document.getElementById("applioPitch").value) || 0;
  const applioSpeed = parseInt(document.getElementById("applioSpeed").value) || 0;
  
  console.log("Topic:", topic);
  console.log("Folder Name:", folderName);
  console.log("Voice:", selectedVoice);
  console.log("Sections:", selectedSections);
  console.log("Style:", selectedStyle);
  console.log("Images:", imageCount);
  console.log("Prompt Modifier:", promptModifier);
  console.log("Image Model:", selectedImageModel);
  console.log("Skip Images:", skipImages);
  console.log("Google Images:", googleImages);
  console.log("Applio Voice:", selectedApplioVoice);
  console.log("Applio Model:", selectedApplioModel);
  console.log("Applio Pitch:", applioPitch);
  console.log("Applio Speed:", applioSpeed);
  
  if (!topic) {
    console.log("Tema vacÃƒÂ­o, mostrando error");
    promptInput.focus();
    promptInput.style.border = "2px solid #e53e3e";
    showError("Por favor, describe el tema del video de gaming antes de continuar.");
    setTimeout(() => {
      promptInput.style.border = "2px solid #e2e8f0";
    }, 2000);
    return;
  }

  // Inicializar variables
  currentTopic = topic;
  totalSections = parseInt(selectedSections);
  currentSectionNumber = 1;
  allSections = [];
  
  // Limpiar el panel de prompts al iniciar una nueva generaciÃƒÂ³n
  clearPromptsPanel();
  
  // Actualizar botones de navegaciÃƒÂ³n
  updateNavigationButtons();

  // Deshabilitar botÃƒÂ³n y mostrar estado de carga
  generateBtn.disabled = true;
  generateBtn.style.display = 'none';
  generateBtn.innerHTML = `
    <i class="fas fa-spinner loading"></i>
    <span>Generando SecciÃƒÂ³n 1...</span>
  `;
  
  // Ocultar contenido anterior
  document.getElementById("script-section").style.display = "none";
  document.getElementById("carousel-container").style.display = "none";
  // document.getElementById("imagePromptPanel").style.display = "none"; // Comentado: Panel eliminado
  generateAudioBtn.style.display = "none";
  
  // Ocultar contenedor de video completo
  const videoContainer = document.getElementById("videoGenerationContainer");
  if (videoContainer) {
    videoContainer.style.display = "none";
  }
  
  showLoadingStages(1, imageCount, skipImages, googleImages, localAIImages);

  try {
    console.log('Enviando primera llamada API sin historial previo');
    const customStyleInstructions = getCustomStyleInstructions(selectedStyle);
    
    const response = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        topic: topic, 
        folderName: folderName,
        voice: selectedVoice, 
        totalSections: totalSections,
        currentSection: 1,
        minWords: minWords,
        maxWords: maxWords,
        scriptStyle: selectedStyle,
        customStyleInstructions: customStyleInstructions,
        imageCount: imageCount,
        aspectRatio: aspectRatio,
        promptModifier: promptModifier,
        imageModel: selectedImageModel,
        llmModel: selectedLlmModel,
        skipImages: skipImages,
        googleImages: googleImages,
        localAIImages: localAIImages,
        applioVoice: selectedApplioVoice,
        applioModel: selectedApplioModel,
        applioPitch: applioPitch,
        applioSpeed: applioSpeed
      })
    });

    const data = await response.json();

    // Almacenar estructura de capÃƒÂ­tulos si estÃƒÂ¡ disponible (funciÃƒÂ³n principal)
    if (data.chapterStructure) {
      storeChapterStructure(data.chapterStructure);
      console.log('Ã°Å¸â€œÅ¡ Estructura de capÃƒÂ­tulos recibida:', data.chapterStructure.length, 'capÃƒÂ­tulos');
    }

    if (data.script) {
      // Actualizar etapas completadas (con pequeÃƒÂ±o delay para asegurar que los elementos existen)
      setTimeout(() => {
        updateStage('stage-script', 'completed');
      }, 100);
      
      if (!skipImages && ((data.images && data.images.length > 0) || (data.downloadedImages && data.downloadedImages.length > 0) || (data.localAIImages && data.localAIImages.length > 0))) {
        // Con imÃƒÂ¡genes (IA generadas o descargadas de Bing)
        setTimeout(() => {
          updateStage('stage-prompt', 'completed');
          updateStage('stage-image', 'completed');
        }, 200);
        
        // Mostrar guiÃƒÂ³n primero
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile, data.tokenUsage);
        }, 500);
        
        // Mostrar carrusel de imÃƒÂ¡genes
        setTimeout(() => {
          if (data.localAIImages && data.localAIImages.length > 0) {
            // ImÃƒÂ¡genes generadas con IA Local
            console.log(`Ã°Å¸Â¤â€“ Mostrando carrusel con ${data.localAIImages.length} imÃƒÂ¡genes de IA Local`);
            
            createCarousel(data.localAIImages, data.currentSection, data.imagePrompts || []);
            
            // Guardar datos de imÃƒÂ¡genes en la secciÃƒÂ³n para navegaciÃƒÂ³n
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.localAIImages;
              allSections[data.currentSection - 1].imagePrompts = data.imagePrompts || [];
              allSections[data.currentSection - 1].imageMode = 'local_ai';
              allSections[data.currentSection - 1].localAIMode = true;
              console.log(`Ã°Å¸â€™Â¾ Datos de imÃƒÂ¡genes IA Local guardados para secciÃƒÂ³n ${data.currentSection}`);
            }
            
          } else if (data.downloadedImages && data.downloadedImages.length > 0) {
            // ImÃƒÂ¡genes de Bing descargadas
            console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â Mostrando carrusel con ${data.downloadedImages.length} imÃƒÂ¡genes de Bing`);
            
            // Ã¢Å“â€¦ IMPORTANTE: Almacenar las keywords ANTES de crear el carrusel
            if (data.imageKeywords && data.imageKeywords.length > 0) {
              currentImageKeywords = data.imageKeywords;
              console.log(`Ã°Å¸Å½Â¯ Keywords almacenadas para refresh (funciÃƒÂ³n principal):`, currentImageKeywords);
            } else {
              console.warn(`Ã¢Å¡Â Ã¯Â¸Â No se recibieron keywords para refresh (funciÃƒÂ³n principal)`);
              console.warn(`Ã¢Å¡Â Ã¯Â¸Â DEBUG - data.imageKeywords:`, data.imageKeywords);
              console.warn(`Ã¢Å¡Â Ã¯Â¸Â DEBUG - data completa:`, data);
              currentImageKeywords = [];
            }
            
            // Ã¢Å“â€¦ Crear carrusel despuÃƒÂ©s de asignar keywords
            createCarousel(data.downloadedImages, data.currentSection, []);
            
            // Guardar datos de imÃƒÂ¡genes en la secciÃƒÂ³n para navegaciÃƒÂ³n (funciÃƒÂ³n principal)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.downloadedImages;
              allSections[data.currentSection - 1].imageKeywords = data.imageKeywords || [];
              allSections[data.currentSection - 1].imageMode = 'bing';
              console.log(`Ã°Å¸â€™Â¾ Datos de imÃƒÂ¡genes Bing guardados para secciÃƒÂ³n ${data.currentSection} (funciÃƒÂ³n principal)`);
            }
          } else if (data.images && data.images.length > 0) {
            // ImÃƒÂ¡genes generadas con IA
            console.log(`Ã°Å¸â€œÂ· Mostrando carrusel de imÃƒÂ¡genes IA`);
            createCarousel(data.images, data.currentSection, data.imagePrompts);
            
            // Guardar datos de imÃƒÂ¡genes en la secciÃƒÂ³n para navegaciÃƒÂ³n (funciÃƒÂ³n principal)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.images;
              allSections[data.currentSection - 1].imagePrompts = data.imagePrompts || [];
              allSections[data.currentSection - 1].imageMode = 'ai';
              console.log(`Ã°Å¸â€™Â¾ Datos de imÃƒÂ¡genes AI guardados para secciÃƒÂ³n ${data.currentSection} (funciÃƒÂ³n principal)`);
            }
          }
        }, 1000);
      } else {
        // Sin imÃƒÂ¡genes generadas o descargadas
        // Mostrar solo el guiÃƒÂ³n
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile, data.tokenUsage);
          
          // Solo ocultar el carrusel si NO hay imÃƒÂ¡genes de Bing
          if (!data.downloadedImages || data.downloadedImages.length === 0) {
            document.getElementById("carousel-container").style.display = "none";
          }
          
          // Verificar si hay imÃƒÂ¡genes descargadas de Bing o prompts tradicionales
          console.log(`Ã°Å¸â€Â DEBUG FRONTEND - Verificando imÃƒÂ¡genes/prompts...`);
          console.log(`Ã°Å¸â€Â DEBUG FRONTEND - data.downloadedImages:`, data.downloadedImages);
          console.log(`Ã°Å¸â€Â DEBUG FRONTEND - data.bingImagesMode:`, data.bingImagesMode);
          console.log(`Ã°Å¸â€Â DEBUG FRONTEND - data.imagePrompts:`, data.imagePrompts);
          console.log(`Ã°Å¸â€Â DEBUG FRONTEND - data.googleImagesMode:`, data.googleImagesMode);
          console.log(`Ã°Å¸â€Â DEBUG FRONTEND - data.mode:`, data.mode);
          
          // Mostrar imÃƒÂ¡genes de Bing en carrusel si estÃƒÂ¡n disponibles
          if (data.downloadedImages && data.downloadedImages.length > 0 && data.bingImagesMode) {
            console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â Mostrando carrusel tardÃƒÂ­o con ${data.downloadedImages.length} imÃƒÂ¡genes de Bing`);
            
            // Almacenar las keywords para el botÃƒÂ³n de refresh
            if (data.imageKeywords && data.imageKeywords.length > 0) {
              currentImageKeywords = data.imageKeywords;
              console.log(`Ã°Å¸Å½Â¯ Keywords almacenadas para refresh:`, currentImageKeywords);
            } else {
              console.warn(`Ã¢Å¡Â Ã¯Â¸Â No se recibieron keywords para refresh`);
              currentImageKeywords = [];
            }
            
            createCarousel(data.downloadedImages, data.currentSection, []);
          }
          // Solo mostrar en panel lateral si NO se omiten imÃƒÂ¡genes, NO hay imÃƒÂ¡genes de Bing y SÃƒÂ hay prompts tradicionales
          else if (!skipImages && data.imagePrompts && data.imagePrompts.length > 0 && !data.bingImagesMode) {
            if (data.googleImagesMode) {
              console.log(`Ã°Å¸â€â€” DEBUG FRONTEND - Ejecutando createGoogleImageLinks con ${data.imagePrompts.length} keywords`);
              createGoogleImageLinks(data.imagePrompts, data.currentSection);
            } else {
              console.log(`Ã°Å¸â€œâ€¹ DEBUG FRONTEND - Ejecutando addPromptsToSidebar con ${data.imagePrompts.length} prompts`);
              addPromptsToSidebar(data.imagePrompts, data.currentSection);
            }
          } else {
            if (skipImages) {
              console.log(`Ã¢ÂÂ­Ã¯Â¸Â DEBUG FRONTEND - Omitiendo prompts de imagen porque skipImages estÃƒÂ¡ activado`);
            } else {
              console.log(`Ã¢ÂÅ’ DEBUG FRONTEND - No se encontraron imÃƒÂ¡genes ni prompts vÃƒÂ¡lidos`);
            }
          }
        }, 500);
      }
      
      // Mostrar mensaje de finalizaciÃƒÂ³n y botones
      setTimeout(() => {
        showCompletionMessage(data.currentSection, data.totalSections, data.isComplete);
        
        // Mostrar botÃƒÂ³n correspondiente
        if (!data.isComplete) {
          continueBtn.style.display = "inline-flex";
          continueBtn.querySelector('span').textContent = `Continuar con SecciÃƒÂ³n ${data.currentSection + 1}`;
        }
      }, 1500);
      
    } else {
      showError(data.error || "No se pudo generar el contenido. Intenta con un tema diferente.");
    }
  } catch (error) {
    showError("Error de conexiÃƒÂ³n. Verifica tu conexiÃƒÂ³n a internet e intenta nuevamente.");
    console.error("Error:", error);
  } finally {
    // Restaurar botÃƒÂ³n
    generateBtn.disabled = false;
    generateBtn.style.display = 'inline-flex';
    generateBtn.innerHTML = `
      <i class="fas fa-video"></i>
      <span>Generar SecciÃƒÂ³n 1</span>
    `;
  }
});

// Event listener para el botÃƒÂ³n de generar audio
/* COMENTADO: FunciÃƒÂ³n del botÃƒÂ³n continueBtn eliminado
  console.log('Ã°Å¸â€œÅ  Variables de estado actual:', {
    currentTopic,
    currentSectionNumber,
    totalSections,
    'window.currentProject?.completedSections?.length': window.currentProject?.completedSections?.length
  });

  if (!currentTopic || currentSectionNumber >= totalSections) {
    showError("No se puede continuar. Genera primero una secciÃƒÂ³n o ya has completado todas las secciones.");
    return;
  }

  const nextSection = currentSectionNumber + 1;
  console.log('Ã°Å¸Å½Â¯ SecciÃƒÂ³n que se va a generar:', nextSection);
  
  const imageCount = parseInt(document.getElementById("imagesSelect").value);
  const aspectRatio = document.getElementById("aspectRatioSelect").value;
  // Ã°Å¸â€Â§ FIX: Usar el folderName del proyecto cargado si existe, sino el del input
  const folderName = window.currentProject ? window.currentProject.folderName : document.getElementById("folderName").value.trim();
  console.log('Ã°Å¸â€œÂ Usando folderName:', folderName, 'desde proyecto cargado:', !!window.currentProject);
  const selectedStyle = document.getElementById("styleSelect").value;
  const promptModifier = document.getElementById("promptModifier").value.trim();
  const selectedImageModel = getSelectedImageModel();
  const selectedLlmModel = document.getElementById("llmModelSelect").value;
  let skipImages = document.getElementById("skipImages").checked;
  let googleImages = document.getElementById("googleImages").checked;
  
  // Ã°Å¸â€Â§ VALIDACIÃƒâ€œN: No se puede omitir imÃƒÂ¡genes Y usar Google Images al mismo tiempo
  // PERO solo aplicar esta validaciÃƒÂ³n si NO estamos cargando un proyecto
  if (skipImages && googleImages && !isLoadingProject) {
    console.warn('Ã¢Å¡Â Ã¯Â¸Â ConfiguraciÃƒÂ³n contradictoria detectada en CONTINUAR: skipImages=true y googleImages=true');
    console.warn('Ã°Å¸â€Â§ Corrigiendo: Desactivando skipImages porque googleImages tiene prioridad');
    skipImages = false;
    document.getElementById("skipImages").checked = false;
    showNotification('Ã¢Å¡Â Ã¯Â¸Â CorrecciÃƒÂ³n automÃƒÂ¡tica: No puedes omitir imÃƒÂ¡genes si usas Google Images', 'warning');
  } else if (skipImages && googleImages && isLoadingProject) {
    console.log('Ã°Å¸â€œâ€š Continuando proyecto: Permitiendo skipImages=true y googleImages=true (solo guiÃƒÂ³n + keywords)');
  }
  
  // Deshabilitar botÃƒÂ³n y mostrar estado de carga
  continueBtn.disabled = true;
  continueBtn.innerHTML = `
    <i class="fas fa-spinner loading"></i>
    <span>Generando SecciÃƒÂ³n ${nextSection}...</span>
  `;
  
  generateAudioBtn.style.display = "none";
  
  showLoadingStages(nextSection, imageCount, skipImages, googleImages, localAIImages);

  try {
    console.log(`Enviando llamada API para secciÃƒÂ³n ${nextSection}`);
    const skipImages = document.getElementById("skipImages").checked;
    const googleImages = document.getElementById("googleImages").checked;
    const localAIImages = document.getElementById("localAIImages").checked;
    const currentApplioVoice = document.getElementById("applioVoiceSelect").value;
    console.log(`Omitir imÃƒÂ¡genes: ${skipImages}`);
    const customStyleInstructions = getCustomStyleInstructions(selectedStyle);
    
    const response = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        topic: currentTopic, 
        folderName: folderName,
        voice: currentVoice,
        totalSections: totalSections,
        currentSection: nextSection,
        scriptStyle: selectedStyle,
        customStyleInstructions: customStyleInstructions,
        imageCount: imageCount,
        aspectRatio: aspectRatio,
        promptModifier: promptModifier,
        imageModel: selectedImageModel,
        llmModel: selectedLlmModel,
        skipImages: skipImages,
        googleImages: googleImages,
        localAIImages: localAIImages,
        applioVoice: currentApplioVoice
      })
    });

    const data = await response.json();

    if (data.script) {
      // Actualizar etapas completadas (con pequeÃƒÂ±o delay para asegurar que los elementos existen)
      setTimeout(() => {
        updateStage('stage-script', 'completed');
      }, 100);
      
      // Usar los datos del servidor en lugar de leer los checkboxes
      const serverSkipImages = data.imagesSkipped || false;
      const serverGoogleImages = data.googleImagesMode || false;
      
      console.log(`Ã°Å¸â€Â DEBUG continueGeneration - skipImages: ${skipImages}`);
      console.log(`Ã°Å¸â€Â DEBUG continueGeneration - googleImages: ${googleImages}`);
      console.log(`Ã°Å¸â€Â DEBUG continueGeneration - serverSkipImages: ${serverSkipImages}`);
      console.log(`Ã°Å¸â€Â DEBUG continueGeneration - serverGoogleImages: ${serverGoogleImages}`);
      console.log(`Ã°Å¸â€Â DEBUG continueGeneration - data.imagesSkipped: ${data.imagesSkipped}`);
      console.log(`Ã°Å¸â€Â DEBUG continueGeneration - data.googleImagesMode: ${data.googleImagesMode}`);
      console.log(`Ã°Å¸â€Â DEBUG continueGeneration - data.images: ${data.images ? data.images.length : 'null'}`);
      console.log(`Ã°Å¸â€Â DEBUG continueGeneration - data.imagePrompts: ${data.imagePrompts ? data.imagePrompts.length : 'null'}`);
      console.log(`Ã°Å¸â€Â DEBUG continueGeneration - data.downloadedImages: ${data.downloadedImages ? data.downloadedImages.length : 'null'}`);
      
      if (!serverSkipImages && !serverGoogleImages && ((data.images && data.images.length > 0) || (data.downloadedImages && data.downloadedImages.length > 0))) {
        // Con imÃƒÂ¡genes (IA generadas o descargadas de Bing)
        console.log(`Ã°Å¸â€œÂ· continueGeneration - Mostrando carrusel de imÃƒÂ¡genes ${data.downloadedImages ? 'Bing' : 'IA'}`);
        setTimeout(() => {
          updateStage('stage-prompt', 'completed');
          updateStage('stage-image', 'completed');
        }, 200);
        
        // Actualizar nÃƒÂºmero de secciÃƒÂ³n actual
        currentSectionNumber = data.currentSection;
        
        // Mostrar guiÃƒÂ³n de la nueva secciÃƒÂ³n
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile);
        }, 500);
        
        // Mostrar carrusel de imÃƒÂ¡genes
        setTimeout(() => {
          if (data.downloadedImages && data.downloadedImages.length > 0) {
            // ImÃƒÂ¡genes de Bing descargadas
            console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â continueGeneration - Creando carrusel con ${data.downloadedImages.length} imÃƒÂ¡genes de Bing`);
            
            // Almacenar las keywords para el botÃƒÂ³n de refresh
            if (data.imageKeywords && data.imageKeywords.length > 0) {
              currentImageKeywords = data.imageKeywords;
              console.log(`Ã°Å¸Å½Â¯ Keywords almacenadas para refresh (continueGeneration):`, currentImageKeywords);
            } else {
              console.warn(`Ã¢Å¡Â Ã¯Â¸Â No se recibieron keywords para refresh (continueGeneration)`);
              currentImageKeywords = [];
            }
            
            createCarousel(data.downloadedImages, data.currentSection, []);
            
            // Guardar datos de imÃƒÂ¡genes en la secciÃƒÂ³n para navegaciÃƒÂ³n (continueGeneration)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.downloadedImages;
              allSections[data.currentSection - 1].imageKeywords = data.imageKeywords || [];
              allSections[data.currentSection - 1].imageMode = 'bing';
              console.log(`Ã°Å¸â€™Â¾ Datos de imÃƒÂ¡genes Bing guardados para secciÃƒÂ³n ${data.currentSection} (continueGeneration)`);
            }
          } else if (data.images && data.images.length > 0) {
            // ImÃƒÂ¡genes generadas con IA
            console.log(`Ã°Å¸â€œÂ· continueGeneration - Creando carrusel con ${data.images.length} imÃƒÂ¡genes IA`);
            createCarousel(data.images, data.currentSection, data.imagePrompts);
            
            // Guardar datos de imÃƒÂ¡genes en la secciÃƒÂ³n para navegaciÃƒÂ³n (continueGeneration)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.images;
              allSections[data.currentSection - 1].imagePrompts = data.imagePrompts || [];
              allSections[data.currentSection - 1].imageMode = 'ai';
              console.log(`Ã°Å¸â€™Â¾ Datos de imÃƒÂ¡genes AI guardados para secciÃƒÂ³n ${data.currentSection} (continueGeneration)`);
            }
          }
        }, 1000);
      } else if (!skipImages && serverGoogleImages && data.imagePrompts && data.imagePrompts.length > 0) {
        // Modo Google Images (solo si no se omiten imÃƒÂ¡genes)
        console.log(`Ã°Å¸â€â€”Ã°Å¸â€â€”Ã°Å¸â€â€” continueGeneration - EJECUTANDO createGoogleImageLinks Ã°Å¸â€â€”Ã°Å¸â€â€”Ã°Å¸â€â€”`);
        setTimeout(() => {
          updateStage('stage-prompt', 'completed');
        }, 200);
        
        // Actualizar nÃƒÂºmero de secciÃƒÂ³n actual
        currentSectionNumber = data.currentSection;
        
        // Mostrar guiÃƒÂ³n
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile);
          // Ocultar el carrusel de imÃƒÂ¡genes
          document.getElementById("carousel-container").style.display = "none";
          
          // Crear enlaces de Google Images
          createGoogleImageLinks(data.imagePrompts, data.currentSection);
        }, 500);
      } else {
        // Sin imÃƒÂ¡genes (omitidas)
        console.log(`Ã°Å¸â€œâ€¹ continueGeneration - Mostrando prompts en panel lateral (modo skipImages)`);
        // Actualizar nÃƒÂºmero de secciÃƒÂ³n actual
        currentSectionNumber = data.currentSection;
        
        // Mostrar solo el guiÃƒÂ³n
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile);
          // Ocultar el carrusel de imÃƒÂ¡genes
          document.getElementById("carousel-container").style.display = "none";
          
          // Mostrar prompts de imÃƒÂ¡genes en el panel lateral solo si no se omiten imÃƒÂ¡genes
          if (!skipImages && data.imagePrompts && data.imagePrompts.length > 0) {
            addPromptsToSidebar(data.imagePrompts, data.currentSection);
          } else if (skipImages) {
            console.log(`Ã¢ÂÂ­Ã¯Â¸Â DEBUG FRONTEND (continuar) - Omitiendo prompts de imagen porque skipImages estÃƒÂ¡ activado`);
          }
        }, 500);
      }
      
      // Mostrar mensaje de finalizaciÃƒÂ³n
      setTimeout(() => {
        showCompletionMessage(data.currentSection, data.totalSections, data.isComplete);
        
        // Mostrar u ocultar botÃƒÂ³n de continuar
        if (data.isComplete) {
          continueBtn.style.display = "none";
        } else {
          continueBtn.style.display = "inline-flex";
          continueBtn.querySelector('span').textContent = `Continuar con SecciÃƒÂ³n ${data.currentSection + 1}`;
        }
      }, 1500);
      
    } else {
      showError(data.error || "No se pudo generar la siguiente secciÃƒÂ³n. Intenta nuevamente.");
    }
  } catch (error) {
    showError("Error generando la siguiente secciÃƒÂ³n. Verifica tu conexiÃƒÂ³n e intenta nuevamente.");
    console.error("Error:", error);
// Event listener para el botÃƒÂ³n de generar audio
*/ 
// Event listener para el botÃƒÂ³n de generar audio
generateAudioBtn.addEventListener("click", async () => {
  if (!currentScript) {
    showError("Primero genera un guiÃƒÂ³n antes de crear el audio.");
    return;
  }

  const folderName = document.getElementById("folderName").value.trim();
  const narrationStyle = document.getElementById("narrationStyle").value.trim();

  // Deshabilitar botÃƒÂ³n y mostrar estado de carga
  generateAudioBtn.disabled = true;
  generateAudioBtn.innerHTML = `
    <i class="fas fa-spinner loading"></i>
    <span>Generando Audio...</span>
  `;

  try {
    const response = await fetch("/generate-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        script: currentScript, 
        voice: currentVoice,
        topic: currentTopic,
        folderName: folderName,
        currentSection: currentSectionNumber,
        narrationStyle: narrationStyle
      })
    });

    const data = await response.json();

    if (data.audio) {
      showAudio(data.audio, data.voice);
    } else {
      showError(data.error || "No se pudo generar el audio. Intenta nuevamente.");
    }
  } catch (error) {
    showError("Error generando audio. Verifica tu conexiÃƒÂ³n e intenta nuevamente.");
    console.error("Error:", error);
  } finally {
    // Restaurar botÃƒÂ³n
    generateAudioBtn.disabled = false;
    generateAudioBtn.innerHTML = `
      <i class="fas fa-microphone"></i>
      <span>Generar Audio</span>
    `;
  }
});

// Event listener para el botÃƒÂ³n de generar video simple (sin animaciones)
document.getElementById("generateSimpleVideoBtn").addEventListener("click", async () => {
  // Ã¢Å“â€¦ CORREGIDO: Usar folderName del proyecto actual, no del input original
  let folderName;
  
  if (window.currentProject && window.currentProject.folderName) {
    // Si hay proyecto cargado, usar su folderName normalizado
    folderName = window.currentProject.folderName;
    console.log(`Ã°Å¸Å½Â¯ Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    // Fallback: usar el input y normalizarlo
    const inputFolderName = document.getElementById("folderName").value.trim();
    if (!inputFolderName) {
      showError("Por favor, especifica el nombre de la carpeta del proyecto");
      return;
    }
    // Normalizar el nombre como lo hace el backend
    folderName = inputFolderName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    console.log(`Ã°Å¸â€Â§ Normalizando folderName: "${inputFolderName}" Ã¢â€ â€™ "${folderName}"`);
  }
  
  if (!allSections || allSections.length === 0) {
    showError("No hay secciones generadas para crear el video");
    return;
  }
  
  console.log(`Ã°Å¸Å½Â¬ Iniciando generaciÃƒÂ³n de video simple para proyecto: ${folderName}`);
  
  try {
    await generateSimpleProjectVideo(folderName);
  } catch (error) {
    console.error("Ã¢ÂÅ’ Error generando video simple:", error);
    showError(`Error generando video simple: ${error.message}`);
  }
});

// Event listener para el botÃƒÂ³n de generar/metadatos de YouTube
const generateYouTubeMetadataBtn = document.getElementById('generateYouTubeMetadataBtn');
if (generateYouTubeMetadataBtn) {
  generateYouTubeMetadataBtn.addEventListener('click', async () => {
    if (generateYouTubeMetadataBtn.disabled) {
      return;
    }

    const metadataExists = generateYouTubeMetadataBtn.dataset.metadataExists === 'true';

    if (metadataExists) {
      const promptField = typeof promptInput !== 'undefined' && promptInput ? promptInput : document.getElementById('prompt');
      const metadataContent = window.currentProject?.youtubeMetadata?.content || window.lastGeneratedYouTubeMetadata?.content;
      const metadataTopic = window.currentProject?.topic || window.lastGeneratedYouTubeMetadata?.topic || promptField?.value?.trim() || '';

      if (metadataContent) {
        const existingContainer = document.querySelector('.youtube-metadata-container');
        if (existingContainer) {
          existingContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          showYouTubeMetadataResults(metadataContent, metadataTopic);
        }
      }

      showNotification('Ã¢â€žÂ¹Ã¯Â¸Â Ya existen metadatos de YouTube para este proyecto.', 'info');
      return;
    }

    if ((!Array.isArray(allSections) || allSections.length === 0) && !(window.currentProject?.completedSections?.length)) {
      showNotification('Ã¢Å¡Â Ã¯Â¸Â Genera al menos una secciÃƒÂ³n antes de crear metadatos.', 'warning');
      return;
    }

    const originalHtml = generateYouTubeMetadataBtn.innerHTML;
    generateYouTubeMetadataBtn.disabled = true;
    generateYouTubeMetadataBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando Metadatos...</span>';

    try {
      const metadata = await generateYouTubeMetadata();
      if (metadata) {
        showNotification('Ã¢Å“â€¦ Metadatos de YouTube generados exitosamente.', 'success');
      }
    } catch (error) {
      console.error('Ã¢ÂÅ’ Error generando metadatos desde el botÃƒÂ³n principal:', error);
      showNotification(`Ã¢ÂÅ’ Error generando metadatos: ${error.message || error}`, 'error');
    } finally {
      generateYouTubeMetadataBtn.disabled = false;
      generateYouTubeMetadataBtn.innerHTML = originalHtml;
      updateYouTubeMetadataButtonState();
    }
  });
}

// Event listener para el botÃƒÂ³n de generar clips separados por secciÃƒÂ³n
document.getElementById("generateSeparateVideosBtn").addEventListener("click", async (event) => {
  // Ã¢Å“â€¦ CORREGIDO: Usar folderName del proyecto actual, no del input original
  let folderName;
  
  if (window.currentProject && window.currentProject.folderName) {
    // Si hay proyecto cargado, usar su folderName normalizado
    folderName = window.currentProject.folderName;
    console.log(`Ã°Å¸Å½Â¯ Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    // Fallback: usar el input y normalizarlo
    const inputFolderName = document.getElementById("folderName").value.trim();
    if (!inputFolderName) {
      showError("Por favor, especifica el nombre de la carpeta del proyecto");
      return;
    }
    // Normalizar el nombre como lo hace el backend
    folderName = inputFolderName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    console.log(`Ã°Å¸â€Â§ Normalizando folderName: "${inputFolderName}" Ã¢â€ â€™ "${folderName}"`);
  }
  
  if (!allSections || allSections.length === 0) {
    showError("No hay secciones generadas para crear los clips");
    return;
  }
  
  console.log(`Ã°Å¸Å½Â¬ Iniciando generaciÃƒÂ³n de clips separados para proyecto: ${folderName}`);
  
  try {
    await generateSeparateVideos(folderName, {
      buttonElement: event.currentTarget
    });
  } catch (error) {
    console.error("Ã¢ÂÅ’ Error generando clips separados:", error);
    showError(`Error generando clips separados: ${error.message}`);
  }
});

// Event listener para el botÃƒÂ³n de regenerar audios faltantes
document.getElementById("regenerateApplioAudiosBtn").addEventListener("click", async () => {
  console.log('Ã°Å¸Å½Â¤ Click en botÃƒÂ³n de regenerar audios faltantes');
  
  try {
    await regenerateAllAudios();
  } catch (error) {
    console.error("Ã¢ÂÅ’ Error regenerando audios:", error);
    showError(`Error regenerando audios: ${error.message}`);
  }
});

// Event listener para el botÃƒÂ³n de regenerar guiones faltantes
document.getElementById("regenerateMissingScriptsBtn").addEventListener("click", async () => {
  console.log('Ã°Å¸â€œÂ Click en botÃƒÂ³n de regenerar guiones faltantes');
  
  try {
    await regenerateMissingScripts();
  } catch (error) {
    console.error("Ã¢ÂÅ’ Error regenerando guiones:", error);
    showError(`Error regenerando guiones: ${error.message}`);
  }
});

// Event listener para el botÃƒÂ³n de generar imÃƒÂ¡genes faltantes
document.getElementById("generateMissingImagesBtn").addEventListener("click", async () => {
  const btn = document.getElementById("generateMissingImagesBtn");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando ImÃƒÂ¡genes...</span>';
  
  console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Click en botÃƒÂ³n de generar imÃƒÂ¡genes faltantes');
  
  try {
    await generateMissingImages();
  } catch (error) {
    console.error("Ã¢ÂÅ’ Error generando imÃƒÂ¡genes:", error);
    showError(`Error generando imÃƒÂ¡genes: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});

document.getElementById("cancelMissingImagesBtn").addEventListener("click", async () => {
  console.log('Ã°Å¸â€ºâ€˜ Click en botÃƒÂ³n de cancelar generaciÃƒÂ³n de imÃƒÂ¡genes');
  try {
    await cancelMissingImagesGeneration();
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error cancelando la generaciÃƒÂ³n de imÃƒÂ¡genes:', error);
    showError(`Error cancelando la generaciÃƒÂ³n de imÃƒÂ¡genes: ${error.message}`);
  }
});

const attemptComfyCheckboxElement = document.getElementById('attemptComfyCheckbox');
if (attemptComfyCheckboxElement) {
  attemptComfyCheckboxElement.addEventListener('change', () => {
    updateGenerateImagesButtonState();
  });
}

// Event listener para el botÃƒÂ³n de generar solo prompts de imÃƒÂ¡genes
document.getElementById("generateMissingPromptsBtn").addEventListener("click", async () => {
  console.log('Ã°Å¸â€œÂ Click en botÃƒÂ³n de generar solo prompts de imÃƒÂ¡genes');
  
  try {
    await generateMissingPrompts();
  } catch (error) {
    console.error("Ã¢ÂÅ’ Error generando prompts:", error);
    showError(`Error generando prompts: ${error.message}`);
  }
});

// Permitir generar con Enter (Ctrl+Enter)
promptInput.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "Enter") {
    generateBtn.click();
  }
});

// Auto-resize del textarea
promptInput.addEventListener("input", function() {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 300) + "px";
});

// Ã¢Å¡Â¡ Configurar eventos para los checkboxes de imÃƒÂ¡genes (manejo automÃƒÂ¡tico)
function setupImageCheckboxEvents() {
  const googleImagesCheckbox = document.getElementById("googleImages");
  const localAIImagesCheckbox = document.getElementById("localAIImages");
  
  // Event listeners simplificados - ahora se pueden activar ambas opciones
  if (googleImagesCheckbox) {
    googleImagesCheckbox.addEventListener("change", function() {
      console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Google Images:', this.checked);
    });
  }
  
  if (localAIImagesCheckbox) {
    localAIImagesCheckbox.addEventListener("change", function() {
      console.log('Ã°Å¸Â§Â  Local AI Images:', this.checked);
    });
  }
}

// Inicializar eventos de checkboxes
document.addEventListener('DOMContentLoaded', function() {
  setupImageCheckboxEvents();
});

// FunciÃƒÂ³n para mostrar prompts de imÃƒÂ¡genes cuando se omiten las imÃƒÂ¡genes
function showImagePrompts(prompts, sectionNumber, promptsFileInfo) {
  console.log(`Ã°Å¸Å½Â¨ DEBUG showImagePrompts - Iniciando funciÃƒÂ³n...`);
  console.log(`Ã°Å¸Å½Â¨ DEBUG showImagePrompts - prompts recibidos:`, prompts);
  console.log(`Ã°Å¸Å½Â¨ DEBUG showImagePrompts - prompts.length:`, prompts ? prompts.length : 'undefined');
  console.log(`Ã°Å¸Å½Â¨ DEBUG showImagePrompts - sectionNumber:`, sectionNumber);
  console.log(`Ã°Å¸Å½Â¨ DEBUG showImagePrompts - promptsFileInfo:`, promptsFileInfo);
  
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    console.log(`Ã¢ÂÅ’ DEBUG showImagePrompts - Prompts invÃƒÂ¡lidos o vacÃƒÂ­os`);
    return;
  }
  
  console.log(`Ã°Å¸Å½Â¨ Mostrando ${prompts.length} prompts de imÃƒÂ¡genes para la secciÃƒÂ³n ${sectionNumber}`);
  
  // Buscar si ya existe un contenedor de prompts y eliminarlo
  const existingContainer = document.getElementById('image-prompts-display');
  if (existingContainer) {
    console.log(`Ã°Å¸â€â€ž DEBUG showImagePrompts - Eliminando contenedor existente`);
    existingContainer.remove();
  }
  
  // Crear el contenedor principal
  const container = document.createElement('div');
  container.id = 'image-prompts-display';
  container.className = 'image-prompts-container';
  console.log(`Ã°Å¸â€œÂ¦ DEBUG showImagePrompts - Contenedor creado`);
  
  // Crear el header
  const header = document.createElement('div');
  header.className = 'image-prompts-header';
  header.innerHTML = `
    <i class="fas fa-palette"></i>
    <span>Prompts Visuales - SecciÃƒÂ³n ${sectionNumber}</span>
  `;
  
  // Agregar informaciÃƒÂ³n sobre el archivo guardado si estÃƒÂ¡ disponible
  if (promptsFileInfo && promptsFileInfo.saved) {
    const fileInfo = document.createElement('div');
    fileInfo.className = 'prompts-file-info';
    fileInfo.innerHTML = `
      <div class="file-saved-notification">
        <i class="fas fa-save"></i>
        <span>Prompts guardados automÃƒÂ¡ticamente como: <strong>${promptsFileInfo.filename}</strong></span>
      </div>
    `;
    header.appendChild(fileInfo);
  }
  
  // Crear la lista de prompts
  const list = document.createElement('div');
  list.className = 'image-prompts-list';
  
  prompts.forEach((prompt, index) => {
    console.log(`Ã°Å¸â€Â DEBUG showImagePrompts - Procesando prompt ${index + 1}: ${prompt.substring(0, 50)}...`);
    const item = document.createElement('div');
    item.className = 'image-prompt-item';
    
    const number = document.createElement('div');
    number.className = 'image-prompt-number';
    number.textContent = `Imagen ${index + 1}:`;
    
    const text = document.createElement('p');
    text.className = 'image-prompt-text';
    text.textContent = prompt.trim();
    
    item.appendChild(number);
    item.appendChild(text);
    list.appendChild(item);
  });
  
  // Crear nota informativa
  const note = document.createElement('div');
  note.className = 'image-prompts-note';
  
  // Verificar si hay instrucciones adicionales aplicadas
  const additionalInstructions = document.getElementById("promptModifier").value.trim();
  let noteText = "Estos prompts describen las imÃƒÂ¡genes que se habrÃƒÂ­an generado para acompaÃƒÂ±ar visualmente el guiÃƒÂ³n.";
  
  if (additionalInstructions) {
    noteText += ` Las instrucciones adicionales ("${additionalInstructions}") han sido aplicadas a estos prompts.`;
    console.log(`Ã°Å¸â€œÂ DEBUG showImagePrompts - Instrucciones adicionales aplicadas: "${additionalInstructions}"`);
  }
  
  note.innerHTML = `
    <i class="fas fa-info-circle"></i>
    ${noteText}
  `;
  
  // Ensamblar el contenedor
  container.appendChild(header);
  container.appendChild(list);
  container.appendChild(note);
  
  // Insertar despuÃƒÂ©s del output del script
  const output = document.getElementById('output');
  console.log(`Ã°Å¸â€Â DEBUG showImagePrompts - Element output encontrado:`, !!output);
  
  if (output && output.nextSibling) {
    output.parentNode.insertBefore(container, output.nextSibling);
    console.log(`Ã°Å¸â€œÂ DEBUG showImagePrompts - Insertado despuÃƒÂ©s del output (con nextSibling)`);
  } else if (output) {
    output.parentNode.appendChild(container);
    console.log(`Ã°Å¸â€œÂ DEBUG showImagePrompts - Insertado despuÃƒÂ©s del output (appendChild)`);
  } else {
    document.body.appendChild(container);
    console.log(`Ã°Å¸â€œÂ DEBUG showImagePrompts - Insertado en body (fallback)`);
  }
  
  // AnimaciÃƒÂ³n de apariciÃƒÂ³n
  container.style.opacity = '0';
  container.style.transform = 'translateY(20px)';
  
  setTimeout(() => {
    container.style.transition = 'all 0.5s ease';
    container.style.opacity = '1';
    container.style.transform = 'translateY(0)';
    console.log(`Ã¢Å“Â¨ DEBUG showImagePrompts - AnimaciÃƒÂ³n aplicada`);
  }, 100);
  
  console.log(`Ã¢Å“â€¦ DEBUG showImagePrompts - FunciÃƒÂ³n completada exitosamente`);
}

// Event listener para controlar la casilla de audio segÃƒÂºn la generaciÃƒÂ³n automÃƒÂ¡tica
document.addEventListener('DOMContentLoaded', function() {
  console.log('Ã°Å¸Å¡â‚¬ DOM completamente cargado');
  
  // Limpiar cualquier contenedor de prompts visuales residual
  const existingPromptsContainer = document.getElementById('image-prompts-display');
  if (existingPromptsContainer) {
    existingPromptsContainer.remove();
    console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Contenedor de prompts visuales residual eliminado');
  }
  
  // Verificar localStorage inmediatamente
  const savedStyles = localStorage.getItem('customScriptStyles');
  console.log('Ã°Å¸â€Â VERIFICACIÃƒâ€œN DIRECTA localStorage:', savedStyles);
  
  const autoGenerateAudioCheckbox = document.getElementById('autoGenerateAudio');
  const autoAudioContainer = document.querySelector('.auto-audio-container');
  
  // Verificar si los elementos de audio existen y habilitarlos ya que la generaciÃƒÂ³n automÃƒÂ¡tica estÃƒÂ¡ siempre activa
  if (autoGenerateAudioCheckbox && autoAudioContainer) {
    // Habilitar la casilla de audio ya que la generaciÃƒÂ³n automÃƒÂ¡tica estÃƒÂ¡ siempre activa
    autoGenerateAudioCheckbox.disabled = false;
    autoAudioContainer.style.opacity = '1';
    console.log('Ã°Å¸â€Å  Casilla de audio habilitada (generaciÃƒÂ³n automÃƒÂ¡tica siempre activa)');
  } else {
    console.log('Ã¢Å¡Â Ã¯Â¸Â Algunos elementos de audio no encontrados (diseÃƒÂ±o compacto)');
  }
  
  // Inicializar sistema de estilos personalizados
  console.log('Ã°Å¸Å½Â¨ A punto de inicializar estilos...');
  initCustomStyles();
  
  // Inicializar sistema de estilos de miniatura
  console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â A punto de inicializar estilos de miniatura...');
  initThumbnailStyles();
  
  // Configurar eventos de botones manualmente como backup
  setTimeout(() => {
    console.log('Ã°Å¸â€Â§ Configurando eventos de botones manualmente...');
    
    const createBtn = document.getElementById('createStyleBtn');
    const manageBtn = document.getElementById('manageStylesBtn');
    
    if (createBtn) {
      createBtn.addEventListener('click', function() {
        console.log('Ã°Å¸Å½Â¨ BotÃƒÂ³n crear estilo clickeado');
        openStyleModal();
      });
      console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n crear configurado');
    } else {
      console.error('Ã¢ÂÅ’ BotÃƒÂ³n crear estilo no encontrado');
    }
    
    if (manageBtn) {
      manageBtn.addEventListener('click', function() {
        console.log('Ã°Å¸â€Â§ BotÃƒÂ³n gestionar estilos clickeado');
        openManageStylesModal();
      });
      console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n gestionar configurado');
    } else {
      console.error('Ã¢ÂÅ’ BotÃƒÂ³n gestionar estilos no encontrado');
    }
    
    // Configurar eventos de botones de miniatura
    const createThumbnailBtn = document.getElementById('createThumbnailStyleFromSidebar');
    const manageThumbnailBtn = document.getElementById('manageThumbnailStylesFromSidebar');
    
    if (createThumbnailBtn) {
      createThumbnailBtn.addEventListener('click', function() {
        console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â BotÃƒÂ³n crear estilo de miniatura clickeado');
        openThumbnailStyleModal();
      });
      console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n crear miniatura configurado');
    } else {
      console.error('Ã¢ÂÅ’ BotÃƒÂ³n crear estilo de miniatura no encontrado');
    }
    
    if (manageThumbnailBtn) {
      manageThumbnailBtn.addEventListener('click', function() {
        console.log('Ã°Å¸â€Â§ BotÃƒÂ³n gestionar estilos de miniatura clickeado desde backup manual');
        try {
          openManageThumbnailStylesModal();
        } catch (error) {
          console.error('Ã¢ÂÅ’ Error ejecutando openManageThumbnailStylesModal:', error);
        }
      });
      console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n gestionar miniatura configurado (backup manual)');
      
      // TambiÃƒÂ©n agregar onclick como backup adicional
      manageThumbnailBtn.onclick = function() {
        console.log('Ã°Å¸â€â€ž Onclick backup del botÃƒÂ³n gestionar activado');
        try {
          openManageThumbnailStylesModal();
        } catch (error) {
          console.error('Ã¢ÂÅ’ Error en onclick backup:', error);
        }
      };
    } else {
      console.error('Ã¢ÂÅ’ BotÃƒÂ³n gestionar estilos de miniatura no encontrado');
    }
    
    // Configurar eventos de botones de modal como backup
    setTimeout(() => {
      console.log('Ã°Å¸â€â€ž Configurando eventos de modal como backup...');
      const saveBtn = document.getElementById('saveThumbnailStyleBtn');
      if (saveBtn && !saveBtn.onclick) {
        saveBtn.onclick = function() {
          console.log('Ã°Å¸â€â€ž Backup directo del botÃƒÂ³n guardar activado');
          saveThumbnailStyle();
        };
        console.log('Ã¢Å“â€¦ Backup de botÃƒÂ³n guardar configurado');
      }
    }, 1000);
  }, 500);
  
  // Verificar el selector despuÃƒÂ©s de la inicializaciÃƒÂ³n
  setTimeout(() => {
    const styleSelect = document.getElementById('styleSelect');
    console.log('Ã°Å¸â€Â Opciones en el selector despuÃƒÂ©s de inicializar:', styleSelect?.innerHTML);
    console.log('Ã°Å¸â€Â NÃƒÂºmero de opciones:', styleSelect?.options?.length);
  }, 1000);
});

// Sistema de Estilos Personalizados
let customStyles = [];

// Cargar estilos personalizados del servidor
async function loadCustomStyles() {
  console.log('ðŸ” Iniciando carga de estilos personalizados desde servidor...');
  try {
    const response = await fetch('/api/custom-styles');
    if (!response.ok) throw new Error('Error al obtener estilos');
    
    const data = await response.json();
    if (data.scriptStyles) {
        customStyles = data.scriptStyles;
        console.log(`ðŸ“ Cargados ${customStyles.length} estilos personalizados:`, customStyles);
    } else {
        customStyles = [];
    }
  } catch (error) {
    console.error('âŒ Error cargando estilos:', error);
    customStyles = [];
  }
  updateStyleSelector();
}

// Guardar estilos en servidor
async function saveCustomStyles() {
  try {
      const response = await fetch('/api/custom-styles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scriptStyles: customStyles })
      });
      if (!response.ok) throw new Error('Error al guardar');
      console.log(`ðŸ’¾ Guardados ${customStyles.length} estilos personalizados`);
  } catch (error) {
       console.error('âŒ Error guardando estilos:', error);
       alert('Error al guardar estilos en el servidor');
  }
}

// Inicializar sistema de estilos
function initCustomStyles() {
  console.log('ðŸŽ¨ Inicializando sistema de estilos personalizados...');
  loadCustomStyles();
  // updateStyleSelector(); // Se llama dentro de loadCustomStyles

  
  // Configurar eventos con un retraso para asegurar que el DOM estÃƒÂ© listo
  setTimeout(() => {
    setupStyleModalEvents();
    setupManageStylesEvents();
    setupEditStyleEvents();
    
    // Configurar especÃƒÂ­ficamente los botones del sidebar
    setupSidebarStyleButtons();
    
    console.log('Ã¢Å“â€¦ Sistema de estilos inicializado correctamente');
  }, 100);
}

// Configurar botones del sidebar para estilos
function setupSidebarStyleButtons() {
  console.log('Ã°Å¸â€Â§ Configurando botones del sidebar para estilos...');
  
  const createFromSidebarBtn = document.getElementById('createStyleFromSidebar');
  if (createFromSidebarBtn) {
    // Remover event listeners previos
    const newBtn = createFromSidebarBtn.cloneNode(true);
    createFromSidebarBtn.parentNode.replaceChild(newBtn, createFromSidebarBtn);
    
    newBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('Ã°Å¸Å½Â¨ BotÃƒÂ³n crear estilo clickeado desde sidebar');
      openCreateStyleFromSidebar();
    });
    console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n crear desde barra lateral configurado');
  } else {
    console.error('Ã¢ÂÅ’ No se encontrÃƒÂ³ createStyleFromSidebar');
  }
  
  const manageFromSidebarBtn = document.getElementById('manageStylesFromSidebar');
  if (manageFromSidebarBtn) {
    // Remover event listeners previos
    const newBtn = manageFromSidebarBtn.cloneNode(true);
    manageFromSidebarBtn.parentNode.replaceChild(newBtn, manageFromSidebarBtn);
    
    newBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('Ã°Å¸â€Â§ BotÃƒÂ³n gestionar estilos clickeado desde sidebar');
      openManageStylesFromSidebar();
    });
    console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n gestionar desde barra lateral configurado');
  } else {
    console.error('Ã¢ÂÅ’ No se encontrÃƒÂ³ manageStylesFromSidebar');
  }
}

// FunciÃƒÂ³n para abrir modal de crear estilo
function openStyleModal() {
  console.log('Ã°Å¸Å½Â¨ Abriendo modal de crear estilo...');
  const styleModal = document.getElementById('styleModal');
  if (styleModal) {
    styleModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    console.log('Ã¢Å“â€¦ Modal de crear estilo abierto');
  } else {
    console.error('Ã¢ÂÅ’ Modal de crear estilo no encontrado');
  }
}

// FunciÃƒÂ³n para cerrar modal de crear estilo
function closeStyleModal() {
  console.log('Ã°Å¸Å½Â¨ Cerrando modal de crear estilo...');
  const styleModal = document.getElementById('styleModal');
  if (styleModal) {
    styleModal.style.display = 'none';
    document.body.style.overflow = 'auto';
    clearModalForm();
    console.log('Ã¢Å“â€¦ Modal de crear estilo cerrado');
  }
}

// Configurar eventos del modal
function setupStyleModalEvents() {
  console.log('Ã°Å¸â€Â§ Configurando eventos del modal de crear estilo...');
  
  const styleModal = document.getElementById('styleModal');
  const closeModalBtn = document.getElementById('closeStyleModal');
  const cancelBtn = document.getElementById('cancelStyleBtn');
  const saveBtn = document.getElementById('saveStyleBtn');
  
  console.log('Ã°Å¸â€Â Elementos encontrados:', {
    styleModal: !!styleModal,
    closeModalBtn: !!closeModalBtn,
    cancelBtn: !!cancelBtn,
    saveBtn: !!saveBtn
  });
  
  if (!styleModal || !closeModalBtn || !cancelBtn || !saveBtn) {
    console.error('Ã¢ÂÅ’ Algunos elementos del modal no fueron encontrados');
    return;
  }
  
  // FunciÃƒÂ³n para cerrar modal
  function closeModal() {
    console.log('Ã°Å¸Å½Â¨ Cerrando modal de crear estilo...');
    styleModal.style.display = 'none';
    document.body.style.overflow = 'auto';
    clearModalForm();
  }
  
  // Configurar event listeners
  closeModalBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('Ã°Å¸â€Ëœ BotÃƒÂ³n cerrar clickeado');
    closeModal();
  });
  
  cancelBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('Ã°Å¸â€Ëœ BotÃƒÂ³n cancelar clickeado');
    closeModal();
  });
  
  // Cerrar modal al hacer clic fuera
  styleModal.addEventListener('click', (e) => {
    if (e.target === styleModal) {
      console.log('Ã°Å¸â€Ëœ Click fuera del modal');
      closeModal();
    }
  });
  
  // Guardar nuevo estilo
  saveBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('Ã°Å¸â€Ëœ BotÃƒÂ³n guardar clickeado');
    saveNewStyle();
  });
  
  console.log('Ã¢Å“â€¦ Eventos del modal configurados correctamente');
}

// Limpiar formulario del modal
function clearModalForm() {
  document.getElementById('styleName').value = '';
  document.getElementById('styleDescription').value = '';
  document.getElementById('styleInstructions').value = '';
}

// Guardar nuevo estilo
function saveNewStyle() {
  const name = document.getElementById('styleName').value.trim();
  const description = document.getElementById('styleDescription').value.trim();
  const instructions = document.getElementById('styleInstructions').value.trim();
  
  // Validaciones
  if (!name) {
    alert('Ã¢ÂÅ’ El nombre del estilo es requerido');
    return;
  }
  
  if (!instructions) {
    alert('Ã¢ÂÅ’ Las instrucciones para la IA son requeridas');
    return;
  }
  
  // Verificar que no exista un estilo con el mismo nombre
  if (customStyles.find(style => style.name.toLowerCase() === name.toLowerCase())) {
    alert('Ã¢ÂÅ’ Ya existe un estilo con ese nombre');
    return;
  }
  
  // Crear nuevo estilo
  const newStyle = {
    id: `custom_${Date.now()}`,
    name: name,
    description: description || 'Estilo personalizado',
    instructions: instructions,
    createdAt: new Date().toISOString()
  };
  
  // Agregar al array
  customStyles.push(newStyle);
  
  // Guardar en localStorage
  saveCustomStyles();
  
  // Actualizar selector
  updateStyleSelector();
  
  // Cerrar modal
  document.getElementById('styleModal').style.display = 'none';
  document.body.style.overflow = 'auto';
  clearModalForm();
  
  // Mostrar confirmaciÃƒÂ³n
  alert(`Ã¢Å“â€¦ Estilo "${name}" creado exitosamente!`);
  
  console.log(`Ã°Å¸Å½Â¨ Nuevo estilo creado: ${name}`);
}

// Actualizar el selector de estilos
function updateStyleSelector() {
  console.log('Ã°Å¸â€â€ž Iniciando actualizaciÃƒÂ³n del selector...');
  
  const styleSelect = document.getElementById('styleSelect');
  if (!styleSelect) {
    console.error('Ã¢ÂÅ’ No se encontrÃƒÂ³ el elemento styleSelect');
    return;
  }
  
  // Guardar el valor actualmente seleccionado
  const currentValue = styleSelect.value;
  console.log('Ã°Å¸â€™Â¾ Valor actual seleccionado:', currentValue);
  
  // Limpiar y recrear todas las opciones
  styleSelect.innerHTML = '';
  console.log('Ã°Å¸Â§Â¹ Selector limpiado');
  
  // Agregar opciones predeterminadas
  const professionalOption = document.createElement('option');
  professionalOption.value = 'professional';
  professionalOption.textContent = 'Profesional';
  styleSelect.appendChild(professionalOption);
  
  const comedyOption = document.createElement('option');
  comedyOption.value = 'comedy';
  comedyOption.textContent = 'CÃƒÂ³mico';
  styleSelect.appendChild(comedyOption);
  
  console.log('Ã¢Å“â€¦ Opciones predeterminadas agregadas');
  
  // Verificar customStyles
  console.log('Ã°Å¸Å½Â¨ customStyles disponibles:', customStyles);
  console.log('Ã°Å¸â€œÅ  NÃƒÂºmero de estilos personalizados:', customStyles.length);
  
  // Agregar estilos personalizados
  customStyles.forEach((style, index) => {
    console.log(`Ã°Å¸Å½Â¨ Procesando estilo ${index + 1}:`, style);
    
    const option = document.createElement('option');
    option.value = style.id;
    option.textContent = `${style.name} (Personalizado)`;
    option.title = style.description || '';
    styleSelect.appendChild(option);
    
    console.log(`Ã¢Å“â€¦ Estilo agregado: ${style.name}`);
  });
  
  // Restaurar selecciÃƒÂ³n anterior si existe
  if (currentValue && styleSelect.querySelector(`option[value="${currentValue}"]`)) {
    styleSelect.value = currentValue;
    console.log(`Ã°Å¸â€â€ž SelecciÃƒÂ³n restaurada: ${currentValue}`);
  } else {
    styleSelect.value = 'professional'; // Default
    console.log('Ã°Å¸â€â€ž SelecciÃƒÂ³n por defecto: professional');
  }
  
  console.log(`Ã°Å¸Å½Â¯ Selector actualizado - Total opciones: ${styleSelect.options.length}`);
  console.log('Ã°Å¸â€Â HTML del selector:', styleSelect.innerHTML);
}

// Variables para gestiÃƒÂ³n de estilos
let currentEditingStyle = null;

// Configurar eventos del modal de gestiÃƒÂ³n de estilos
function setupManageStylesEvents() {
  console.log('Ã°Å¸â€Â§ Configurando eventos del modal de gestionar estilos...');
  
  const manageModal = document.getElementById('manageStylesModal');
  const closeManageBtn = document.getElementById('closeManageStylesModal');
  const closeManageBtnFooter = document.getElementById('closeManageStylesBtn');
  
  console.log('Ã°Å¸â€Â Elementos encontrados:', {
    manageModal: !!manageModal,
    closeManageBtn: !!closeManageBtn,
    closeManageBtnFooter: !!closeManageBtnFooter
  });
  
  if (!manageModal || !closeManageBtn || !closeManageBtnFooter) {
    console.error('Ã¢ÂÅ’ Algunos elementos del modal de gestionar no fueron encontrados');
    return;
  }
  
  // FunciÃƒÂ³n para cerrar modal
  function closeModal() {
    console.log('Ã°Å¸â€Â§ Cerrando modal de gestionar estilos...');
    manageModal.style.display = 'none';
    document.body.style.overflow = 'auto';
  }
  
  // Configurar event listeners
  closeManageBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('Ã°Å¸â€Ëœ BotÃƒÂ³n cerrar (X) clickeado');
    closeModal();
  });
  
  closeManageBtnFooter.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('Ã°Å¸â€Ëœ BotÃƒÂ³n cerrar footer clickeado');
    closeModal();
  });
  
  // Cerrar modal al hacer clic fuera
  manageModal.addEventListener('click', (e) => {
    if (e.target === manageModal) {
      console.log('Ã°Å¸â€Ëœ Click fuera del modal de gestionar');
      closeModal();
    }
  });
  
  console.log('Ã¢Å“â€¦ Eventos del modal de gestionar configurados correctamente');
}

// Configurar eventos del modal de ediciÃƒÂ³n de estilos
function setupEditStyleEvents() {
  const editModal = document.getElementById('editStyleModal');
  const closeEditBtn = document.getElementById('closeEditStyleModal');
  const cancelEditBtn = document.getElementById('cancelEditStyleBtn');
  const saveEditBtn = document.getElementById('saveEditStyleBtn');
  
  closeEditBtn.addEventListener('click', closeEditStyleModal);
  cancelEditBtn.addEventListener('click', closeEditStyleModal);
  saveEditBtn.addEventListener('click', saveEditedStyle);
  
  // Cerrar modal al hacer clic fuera
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) {
      closeEditStyleModal();
    }
  });
}

// Abrir modal de gestiÃƒÂ³n de estilos
function openManageStylesModal() {
  const manageModal = document.getElementById('manageStylesModal');
  manageModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  renderStylesList();
}

// Cerrar modal de gestiÃƒÂ³n de estilos
function closeManageStylesModal() {
  const manageModal = document.getElementById('manageStylesModal');
  manageModal.style.display = 'none';
  document.body.style.overflow = 'auto';
}

// Renderizar lista de estilos
function renderStylesList() {
  const stylesList = document.getElementById('stylesList');
  const noStylesMessage = document.getElementById('noStylesMessage');
  
  if (customStyles.length === 0) {
    stylesList.style.display = 'none';
    noStylesMessage.style.display = 'block';
    return;
  }
  
  stylesList.style.display = 'block';
  noStylesMessage.style.display = 'none';
  
  stylesList.innerHTML = '';
  
  customStyles.forEach(style => {
    const styleItem = document.createElement('div');
    styleItem.className = 'style-item';
    styleItem.innerHTML = `
      <div class="style-item-header">
        <div class="style-item-info">
          <div class="style-item-name">${escapeHtml(style.name)}</div>
          <div class="style-item-description">${escapeHtml(style.description || 'Sin descripciÃƒÂ³n')}</div>
          <div class="style-item-instructions">"${escapeHtml(style.instructions)}"</div>
        </div>
        <div class="style-item-actions">
          <button class="edit-style-btn" onclick="editStyle('${style.id}')">
            <i class="fas fa-edit"></i>
            Editar
          </button>
          <button class="delete-style-btn" onclick="deleteStyle('${style.id}')">
            <i class="fas fa-trash"></i>
            Eliminar
          </button>
        </div>
      </div>
    `;
    stylesList.appendChild(styleItem);
  });
}

// FunciÃƒÂ³n para escapar HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Editar estilo
function editStyle(styleId) {
  const style = customStyles.find(s => s.id === styleId);
  if (!style) {
    alert('Ã¢ÂÅ’ Estilo no encontrado');
    return;
  }
  
  currentEditingStyle = style;
  
  // Llenar formulario de ediciÃƒÂ³n
  document.getElementById('editStyleName').value = style.name;
  document.getElementById('editStyleDescription').value = style.description || '';
  document.getElementById('editStyleInstructions').value = style.instructions;
  
  // Cerrar modal de gestiÃƒÂ³n y abrir modal de ediciÃƒÂ³n
  closeManageStylesModal();
  
  const editModal = document.getElementById('editStyleModal');
  editModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

// Cerrar modal de ediciÃƒÂ³n
function closeEditStyleModal() {
  const editModal = document.getElementById('editStyleModal');
  editModal.style.display = 'none';
  document.body.style.overflow = 'auto';
  currentEditingStyle = null;
  clearEditModalForm();
}

// Limpiar formulario de ediciÃƒÂ³n
function clearEditModalForm() {
  document.getElementById('editStyleName').value = '';
  document.getElementById('editStyleDescription').value = '';
  document.getElementById('editStyleInstructions').value = '';
}

// Guardar estilo editado
function saveEditedStyle() {
  if (!currentEditingStyle) {
    alert('Ã¢ÂÅ’ Error: No hay estilo seleccionado para editar');
    return;
  }
  
  const name = document.getElementById('editStyleName').value.trim();
  const description = document.getElementById('editStyleDescription').value.trim();
  const instructions = document.getElementById('editStyleInstructions').value.trim();
  
  // Validaciones
  if (!name) {
    alert('Ã¢ÂÅ’ El nombre del estilo es requerido');
    return;
  }
  
  if (!instructions) {
    alert('Ã¢ÂÅ’ Las instrucciones para la IA son requeridas');
    return;
  }
  
  // Verificar que no exista otro estilo con el mismo nombre
  const existingStyle = customStyles.find(style => 
    style.name.toLowerCase() === name.toLowerCase() && style.id !== currentEditingStyle.id
  );
  
  if (existingStyle) {
    alert('Ã¢ÂÅ’ Ya existe un estilo con ese nombre');
    return;
  }
  
  // Actualizar estilo
  const styleIndex = customStyles.findIndex(s => s.id === currentEditingStyle.id);
  if (styleIndex !== -1) {
    customStyles[styleIndex] = {
      ...currentEditingStyle,
      name: name,
      description: description,
      instructions: instructions
    };
    
    // Guardar en localStorage
    saveCustomStyles();
    
    // Actualizar selector
    updateStyleSelector();
    
    // Cerrar modal
    closeEditStyleModal();
    
    // Mostrar confirmaciÃƒÂ³n
    alert(`Ã¢Å“â€¦ Estilo "${name}" actualizado exitosamente!`);
    
    console.log(`Ã°Å¸Å½Â¨ Estilo editado: ${name}`);
  }
}

// Eliminar estilo
function deleteStyle(styleId) {
  const style = customStyles.find(s => s.id === styleId);
  if (!style) {
    alert('Ã¢ÂÅ’ Estilo no encontrado');
    return;
  }
  
  // Confirmar eliminaciÃƒÂ³n
  if (!confirm(`Ã‚Â¿EstÃƒÂ¡s seguro de que quieres eliminar el estilo "${style.name}"?\n\nEsta acciÃƒÂ³n no se puede deshacer.`)) {
    return;
  }
  
  // Eliminar del array
  customStyles = customStyles.filter(s => s.id !== styleId);
  
  // Guardar en localStorage
  saveCustomStyles();
  
  // Actualizar selector
  updateStyleSelector();
  
  // Actualizar lista de estilos si el modal estÃƒÂ¡ abierto
  const manageModal = document.getElementById('manageStylesModal');
  if (manageModal.style.display === 'flex') {
    renderStylesList();
  }
  
  // Mostrar confirmaciÃƒÂ³n
  alert(`Ã¢Å“â€¦ Estilo "${style.name}" eliminado exitosamente!`);
  
  console.log(`Ã°Å¸â€”â€˜Ã¯Â¸Â Estilo eliminado: ${style.name}`);
}

// FunciÃƒÂ³n de prueba para crear un estilo desde la consola
function createTestStyle() {
  const testStyle = {
    id: `custom_${Date.now()}`,
    name: 'Estilo de Prueba',
    description: 'Un estilo creado para probar',
    instructions: 'Usa un tono casual y amigable'
  };
  
  customStyles.push(testStyle);
  saveCustomStyles();
  updateStyleSelector();
  
  console.log('Ã¢Å“â€¦ Estilo de prueba creado:', testStyle);
  return testStyle;
}

// FunciÃƒÂ³n de debug para mostrar estado actual
function debugStyles() {
  console.log('Ã°Å¸â€Â Estado actual de estilos:');
  console.log('Ã°Å¸â€œÂ¦ customStyles array:', customStyles);
  console.log('Ã°Å¸â€™Â¾ localStorage:', localStorage.getItem('customScriptStyles'));
  
  const styleSelect = document.getElementById('styleSelect');
  console.log('Ã°Å¸Å½Â¯ Selector HTML:', styleSelect.innerHTML);
  console.log('Ã°Å¸â€œÅ  NÃƒÂºmero de opciones:', styleSelect.options.length);
  
  return {
    customStyles,
    localStorage: localStorage.getItem('customScriptStyles'),
    selectorHTML: styleSelect.innerHTML,
    optionsCount: styleSelect.options.length
  };
}

// Funciones para la barra lateral colapsable
function toggleSidebar() {
  console.log('Ã°Å¸â€â€ž toggleSidebar() ejecutada');
  
  const sidebar = document.getElementById('sidebar');
  const body = document.body;
  
  console.log('Ã°Å¸â€Â sidebar element:', sidebar);
  console.log('Ã°Å¸â€Â body element:', body);
  
  if (sidebar && body) {
    const wasExpanded = sidebar.classList.contains('expanded');
    
    sidebar.classList.toggle('expanded');
    body.classList.toggle('sidebar-expanded');
    
    const isExpanded = sidebar.classList.contains('expanded');
    console.log(`Ã°Å¸Å½Â¯ Barra lateral cambiÃƒÂ³ de ${wasExpanded ? 'expandida' : 'colapsada'} a ${isExpanded ? 'expandida' : 'colapsada'}`);
    console.log('Ã°Å¸â€Â Clases del sidebar:', sidebar.className);
    console.log('Ã°Å¸â€Â Clases del body:', body.className);
  } else {
    console.error('Ã¢ÂÅ’ No se encontrÃƒÂ³ el sidebar o el body');
    console.error('sidebar:', sidebar);
    console.error('body:', body);
  }
}

// Hacer la funciÃƒÂ³n disponible globalmente
window.toggleSidebar = toggleSidebar;

function collapseSidebar() {
  const sidebar = document.getElementById('sidebar');
  const body = document.body;
  
  if (sidebar && body) {
    sidebar.classList.remove('expanded');
    body.classList.remove('sidebar-expanded');
    console.log('Ã°Å¸Å½Â¯ Barra lateral colapsada');
  }
}

// Funciones para abrir modales desde la barra lateral
function openCreateStyleFromSidebar() {
  openStyleModal(); // Esta funciÃƒÂ³n abre el modal de CREAR estilo
  collapseSidebar();
  console.log('Ã°Å¸Å½Â¨ Abriendo modal de crear estilo desde barra lateral');
}

function openManageStylesFromSidebar() {
  openManageStylesModal(); // Esta funciÃƒÂ³n abre el modal de GESTIONAR estilos
  collapseSidebar();
  console.log('Ã°Å¸â€Â§ Abriendo modal de gestionar estilos desde barra lateral');
}

// Event listeners para la barra lateral
document.addEventListener('DOMContentLoaded', function() {
  // BotÃƒÂ³n de menÃƒÂº para expandir/colapsar barra lateral
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.getElementById('sidebar');
  
  console.log('Ã°Å¸â€Â Debug sidebar - menuToggleBtn:', menuToggleBtn);
  console.log('Ã°Å¸â€Â Debug sidebar - sidebar:', sidebar);
  
  if (menuToggleBtn) {
    console.log('Ã¢Å“â€¦ BotÃƒÂ³n de menÃƒÂº encontrado - onclick configurado en HTML');
  } else {
    console.error('Ã¢ÂÅ’ No se encontrÃƒÂ³ el botÃƒÂ³n menuToggleBtn');
  }
  
  if (!sidebar) {
    console.error('Ã¢ÂÅ’ No se encontrÃƒÂ³ el elemento sidebar');
  }
  
  // Botones de la barra lateral
  const createFromSidebarBtn = document.getElementById('createStyleFromSidebar');
  if (createFromSidebarBtn) {
    createFromSidebarBtn.addEventListener('click', openCreateStyleFromSidebar);
    console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n crear desde barra lateral configurado');
  }
  
  const manageFromSidebarBtn = document.getElementById('manageStylesFromSidebar');
  if (manageFromSidebarBtn) {
    manageFromSidebarBtn.addEventListener('click', openManageStylesFromSidebar);
    console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n gestionar desde barra lateral configurado');
  }
  
  // Cerrar barra lateral al hacer clic fuera de ella
  document.addEventListener('click', function(event) {
    const sidebar = document.getElementById('sidebar');
    const isClickInsideSidebar = sidebar && sidebar.contains(event.target);
    
    if (!isClickInsideSidebar && sidebar && sidebar.classList.contains('expanded')) {
      collapseSidebar();
    }
  });
  
  // ConfiguraciÃƒÂ³n adicional de eventos del modal como backup
  setTimeout(() => {
    console.log('Ã°Å¸â€Â§ ConfiguraciÃƒÂ³n adicional de eventos del modal...');
    
    const closeModalBtn = document.getElementById('closeStyleModal');
    const cancelBtn = document.getElementById('cancelStyleBtn');
    const saveBtn = document.getElementById('saveStyleBtn');
    const styleModal = document.getElementById('styleModal');
    
    if (closeModalBtn && !closeModalBtn.hasEventListener) {
      closeModalBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('Ã°Å¸â€Ëœ [BACKUP] BotÃƒÂ³n cerrar clickeado');
        const modal = document.getElementById('styleModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
          clearModalForm();
        }
      });
      closeModalBtn.hasEventListener = true;
      console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n cerrar configurado (backup)');
    }
    
    if (cancelBtn && !cancelBtn.hasEventListener) {
      cancelBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('Ã°Å¸â€Ëœ [BACKUP] BotÃƒÂ³n cancelar clickeado');
        const modal = document.getElementById('styleModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
          clearModalForm();
        }
      });
      cancelBtn.hasEventListener = true;
      console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n cancelar configurado (backup)');
    }
    
    if (saveBtn && !saveBtn.hasEventListener) {
      saveBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('Ã°Å¸â€Ëœ [BACKUP] BotÃƒÂ³n guardar clickeado');
        saveNewStyle();
      });
      saveBtn.hasEventListener = true;
      console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n guardar configurado (backup)');
    }
    
    // ConfiguraciÃƒÂ³n backup para modal de gestionar estilos
    const closeManageBtn = document.getElementById('closeManageStylesModal');
    const closeManageBtnFooter = document.getElementById('closeManageStylesBtn');
    const manageModal = document.getElementById('manageStylesModal');
    
    if (closeManageBtn && !closeManageBtn.hasEventListener) {
      closeManageBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('Ã°Å¸â€Ëœ [BACKUP] BotÃƒÂ³n cerrar (X) gestionar clickeado');
        const modal = document.getElementById('manageStylesModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
        }
      });
      closeManageBtn.hasEventListener = true;
      console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n cerrar (X) gestionar configurado (backup)');
    }
    
    if (closeManageBtnFooter && !closeManageBtnFooter.hasEventListener) {
      closeManageBtnFooter.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('Ã°Å¸â€Ëœ [BACKUP] BotÃƒÂ³n cerrar footer gestionar clickeado');
        const modal = document.getElementById('manageStylesModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
        }
      });
      closeManageBtnFooter.hasEventListener = true;
      console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n cerrar footer gestionar configurado (backup)');
    }
  }, 1000);
});

// ================================
// FUNCIONALIDADES DEL PANEL LATERAL DE PROMPTS
// ================================

// Variable global para almacenar todos los prompts
let allAccumulatedPrompts = [];

// FunciÃƒÂ³n para inicializar el panel lateral de prompts
function initializePromptsPanel() {
  console.log('Ã°Å¸â€Â Iniciando inicializaciÃƒÂ³n del panel de prompts...');
  
  const promptsSidebar = document.getElementById('promptsSidebar');
  const toggleBtn = document.getElementById('promptsSidebarToggle');
  const headerBtn = document.getElementById('showPromptsPanel');
  
  console.log('promptsSidebar:', !!promptsSidebar);
  console.log('toggleBtn:', !!toggleBtn);
  console.log('headerBtn:', !!headerBtn);
  
  if (!promptsSidebar || !toggleBtn) {
    console.log('Ã¢ÂÅ’ Panel de prompts no encontrado en el DOM');
    return;
  }
  
  // Verificar si ya estÃƒÂ¡ inicializado
  if (toggleBtn.hasEventListener) {
    console.log('Ã¢Å¡Â Ã¯Â¸Â Panel ya inicializado, saltando...');
    return;
  }
  
  // Configurar estado inicial
  const isInitiallyActive = promptsSidebar.classList.contains('active');
  console.log('Estado inicial del panel:', isInitiallyActive ? 'activo' : 'inactivo');
  
  if (!isInitiallyActive) {
    // Panel inicialmente oculto
    toggleBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
    toggleBtn.title = 'Mostrar panel de prompts';
    if (headerBtn) {
      headerBtn.classList.remove('active');
      headerBtn.innerHTML = '<i class="fas fa-images"></i><span>Prompts</span>';
    }
  } else {
    // Panel inicialmente visible
    toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
    toggleBtn.title = 'Ocultar panel de prompts';
    if (headerBtn) {
      headerBtn.classList.add('active');
      headerBtn.innerHTML = '<i class="fas fa-eye-slash"></i><span>Ocultar</span>';
    }
  }
  
  // Event listener para el botÃƒÂ³n toggle del panel
  const toggleHandler = function() {
    console.log('Ã°Å¸â€Ëœ BotÃƒÂ³n toggle del panel clickeado');
    const isActive = promptsSidebar.classList.contains('active');
    console.log('Estado actual antes del toggle:', isActive ? 'activo' : 'inactivo');
    
    if (isActive) {
      // Cerrar panel
      promptsSidebar.classList.remove('active');
      document.body.classList.remove('prompts-panel-active');
      toggleBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
      toggleBtn.title = 'Mostrar panel de prompts';
      
      // Actualizar botÃƒÂ³n del header
      if (headerBtn) {
        headerBtn.classList.remove('active');
        headerBtn.innerHTML = '<i class="fas fa-images"></i><span>Prompts</span>';
      }
      console.log('Ã¢Å“â€¦ Panel cerrado');
    } else {
      // Abrir panel
      promptsSidebar.classList.add('active');
      document.body.classList.add('prompts-panel-active');
      toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
      toggleBtn.title = 'Ocultar panel de prompts';
      
      // Actualizar botÃƒÂ³n del header
      if (headerBtn) {
        headerBtn.classList.add('active');
        headerBtn.innerHTML = '<i class="fas fa-eye-slash"></i><span>Ocultar</span>';
      }
      console.log('Ã¢Å“â€¦ Panel abierto');
    }
  };
  
  toggleBtn.addEventListener('click', toggleHandler);
  toggleBtn.hasEventListener = true;
  
  // Event listener para el botÃƒÂ³n del header
  if (headerBtn && !headerBtn.hasEventListener) {
    const headerHandler = function() {
      console.log('Ã°Å¸â€Ëœ BotÃƒÂ³n header clickeado');
      const isActive = promptsSidebar.classList.contains('active');
      console.log('Estado actual antes del toggle (header):', isActive ? 'activo' : 'inactivo');
      
      if (isActive) {
        // Cerrar panel
        promptsSidebar.classList.remove('active');
        document.body.classList.remove('prompts-panel-active');
        toggleBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
        toggleBtn.title = 'Mostrar panel de prompts';
        headerBtn.classList.remove('active');
        headerBtn.innerHTML = '<i class="fas fa-images"></i><span>Prompts</span>';
        console.log('Ã¢Å“â€¦ Panel cerrado desde header');
      } else {
        // Abrir panel
        promptsSidebar.classList.add('active');
        document.body.classList.add('prompts-panel-active');
        toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
        toggleBtn.title = 'Ocultar panel de prompts';
        headerBtn.classList.add('active');
        headerBtn.innerHTML = '<i class="fas fa-eye-slash"></i><span>Ocultar</span>';
        console.log('Ã¢Å“â€¦ Panel abierto desde header');
      }
    };
    
    headerBtn.addEventListener('click', headerHandler);
    headerBtn.hasEventListener = true;
  }
  
  console.log('Ã¢Å“â€¦ Panel lateral de prompts inicializado correctamente');
}

// FunciÃƒÂ³n para limpiar el panel lateral de prompts
function clearPromptsSidebar() {
  console.log('Ã°Å¸Â§Â¹ Limpiando panel lateral de prompts...');
  
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  
  if (promptsList) {
    // Limpiar todos los prompts existentes
    promptsList.innerHTML = '';
  }
  
  if (emptyState) {
    // Mostrar estado vacÃƒÂ­o
    emptyState.style.display = 'block';
  }
  
  // Limpiar array global
  allAccumulatedPrompts = [];
  
  console.log('Ã¢Å“â€¦ Panel lateral limpiado');
}

// FunciÃƒÂ³n para aÃƒÂ±adir prompts al panel lateral
function addPromptsToSidebar(prompts, sectionNumber) {
  console.log('Ã°Å¸â€œâ€¹Ã°Å¸â€œâ€¹Ã°Å¸â€œâ€¹ INICIO addPromptsToSidebar - ESTA FUNCIÃƒâ€œN SE ESTÃƒÂ EJECUTANDO Ã°Å¸â€œâ€¹Ã°Å¸â€œâ€¹Ã°Å¸â€œâ€¹');
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    console.log('Ã¢ÂÅ’ No hay prompts vÃƒÂ¡lidos para aÃƒÂ±adir al panel lateral');
    return;
  }
  
  console.log(`Ã°Å¸â€œâ€¹ AÃƒÂ±adiendo ${prompts.length} prompts de la secciÃƒÂ³n ${sectionNumber} al panel lateral`);
  
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  const promptsSidebar = document.getElementById('promptsSidebar');
  
  if (!promptsList || !emptyState || !promptsSidebar) {
    console.log('Ã¢ÂÅ’ Elementos del panel lateral no encontrados');
    return;
  }
  
  // Ocultar el estado vacÃƒÂ­o si existe
  if (emptyState.style.display !== 'none') {
    emptyState.style.display = 'none';
  }
  
  // Mostrar automÃƒÂ¡ticamente el panel si no estÃƒÂ¡ visible
  if (!promptsSidebar.classList.contains('active')) {
    promptsSidebar.classList.add('active');
    document.body.classList.add('prompts-panel-active');
    const toggleBtn = document.getElementById('promptsSidebarToggle');
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
      toggleBtn.title = 'Ocultar panel de prompts';
    }
  }
  
  // AÃƒÂ±adir divider si no es la primera secciÃƒÂ³n
  if (sectionNumber > 1) {
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.innerHTML = `
      <div class="section-divider-text">
        <i class="fas fa-layer-group"></i>
        SecciÃƒÂ³n ${sectionNumber}
      </div>
    `;
    promptsList.appendChild(divider);
  }
  
  // AÃƒÂ±adir cada prompt al panel
  prompts.forEach((prompt, index) => {
    // Detectar si el prompt contiene HTML (enlaces de Google Images)
    const isHtmlPrompt = prompt.includes('<a href=') && prompt.includes('target="_blank"');
    const cleanText = isHtmlPrompt ? prompt.replace(/<[^>]*>/g, '').replace(/^Ã°Å¸â€â€”\s*/, '').replace(/^Buscar:\s*"/, '').replace(/"$/, '') : prompt.trim();
    
    // Almacenar en el array global con texto limpio
    allAccumulatedPrompts.push({
      text: cleanText,
      section: sectionNumber,
      imageNumber: index + 1
    });
    
    const promptItem = createPromptItem(prompt, sectionNumber, index + 1, isHtmlPrompt);
    promptsList.appendChild(promptItem);
    
    // AÃƒÂ±adir animaciÃƒÂ³n de entrada
    setTimeout(() => {
      promptItem.classList.add('new');
    }, index * 100);
  });
  
  // Hacer scroll al ÃƒÂºltimo prompt aÃƒÂ±adido
  setTimeout(() => {
    const lastPrompt = promptsList.lastElementChild;
    if (lastPrompt) {
      lastPrompt.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 300);
}

// FunciÃƒÂ³n para crear enlaces de Google Images
function createGoogleImageLinks(prompts, sectionNumber) {
  console.log('Ã°Å¸Å¡â‚¬Ã°Å¸Å¡â‚¬Ã°Å¸Å¡â‚¬ INICIO createGoogleImageLinks - ESTA FUNCIÃƒâ€œN SE ESTÃƒÂ EJECUTANDO Ã°Å¸Å¡â‚¬Ã°Å¸Å¡â‚¬Ã°Å¸Å¡â‚¬');
  console.log('Ã°Å¸â€â€” prompts:', prompts);
  console.log('Ã°Å¸â€â€” sectionNumber:', sectionNumber);
  console.log('Ã°Å¸â€â€” prompts.length:', prompts ? prompts.length : 'null');
  console.log('Ã°Å¸â€â€” Array.isArray(prompts):', Array.isArray(prompts));
  
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    console.log('Ã¢ÂÅ’ No hay prompts vÃƒÂ¡lidos para crear enlaces de Google Images');
    return;
  }
  
  console.log(`Ã°Å¸â€â€” Creando ${prompts.length} enlaces de Google Images de la secciÃƒÂ³n ${sectionNumber}`);
  
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  const promptsSidebar = document.getElementById('promptsSidebar');
  
  if (!promptsList || !emptyState || !promptsSidebar) {
    console.log('Ã¢ÂÅ’ Elementos del panel lateral no encontrados');
    return;
  }
  
  // Ocultar el estado vacÃƒÂ­o si existe
  if (emptyState.style.display !== 'none') {
    emptyState.style.display = 'none';
  }
  
  // Mostrar automÃƒÂ¡ticamente el panel si no estÃƒÂ¡ visible
  if (!promptsSidebar.classList.contains('active')) {
    promptsSidebar.classList.add('active');
    document.body.classList.add('prompts-panel-active');
    const toggleBtn = document.getElementById('promptsSidebarToggle');
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
      toggleBtn.title = 'Ocultar panel de prompts';
    }
  }
  
  // AÃƒÂ±adir divider si no es la primera secciÃƒÂ³n
  if (sectionNumber > 1) {
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.innerHTML = `
      <div class="section-divider-text">
        <i class="fas fa-layer-group"></i>
        SecciÃƒÂ³n ${sectionNumber}
      </div>
    `;
    promptsList.appendChild(divider);
  }
  
  // AÃƒÂ±adir cada enlace de Google al panel
  console.log('Ã°Å¸â€â€” Iniciando bucle para crear enlaces...');
  prompts.forEach((prompt, index) => {
    console.log(`Ã°Å¸â€â€” Procesando prompt ${index + 1}: "${prompt}"`);
    
    // Crear el tÃƒÂ©rmino de bÃƒÂºsqueda limpiando el prompt
    const searchTerm = prompt.trim()
      .replace(/[^\w\s]/g, '') // Remover caracteres especiales
      .replace(/\s+/g, '+'); // Reemplazar espacios con +
    
    const googleUrl = `https://www.google.com/search?q=${searchTerm}&tbm=isch`;
    
    console.log(`Ã°Å¸â€â€” searchTerm: "${searchTerm}"`);
    console.log(`Ã°Å¸â€â€” googleUrl: "${googleUrl}"`);
    
    // Almacenar en el array global (como Google link en lugar de prompt)
    allAccumulatedPrompts.push({
      text: googleUrl,
      section: sectionNumber,
      imageNumber: index + 1,
      isGoogleLink: true,
      originalPrompt: prompt.trim()
    });
    
    const linkItem = createGoogleLinkItem(prompt.trim(), googleUrl, sectionNumber, index + 1);
    console.log(`Ã°Å¸â€â€” linkItem creado:`, !!linkItem);
    promptsList.appendChild(linkItem);
    console.log(`Ã°Å¸â€â€” linkItem aÃƒÂ±adido al promptsList`);
    
    // AÃƒÂ±adir animaciÃƒÂ³n de entrada
    setTimeout(() => {
      linkItem.classList.add('new');
    }, index * 100);
  });
  
  console.log('Ã°Å¸â€â€” Bucle completado');
  
  // Hacer scroll al ÃƒÂºltimo enlace aÃƒÂ±adido
  setTimeout(() => {
    const lastLink = promptsList.lastElementChild;
    if (lastLink) {
      lastLink.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 300);
  
  console.log('Ã°Å¸â€â€” FIN createGoogleImageLinks');
}

// FunciÃƒÂ³n para crear un item de prompt individual
function createPromptItem(promptText, sectionNumber, imageNumber, isHtml = false) {
  const promptItem = document.createElement('div');
  promptItem.className = 'prompt-item';
  
  const header = document.createElement('div');
  header.className = 'prompt-item-header';
  
  const title = document.createElement('div');
  title.className = 'prompt-item-title';
  title.innerHTML = `<i class="fas fa-image"></i> SecciÃƒÂ³n ${sectionNumber} - Imagen ${imageNumber}`;
  
  const copyBtn = document.createElement('button');
  copyBtn.className = 'prompt-copy-btn';
  copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
  copyBtn.title = 'Copiar prompt';
  
  // Para HTML, extraer el texto limpio para copiar
  const textToCopy = isHtml ? promptText.replace(/<[^>]*>/g, '').replace(/^Ã°Å¸â€â€”\s*/, '').replace(/^Buscar:\s*"/, '').replace(/"$/, '') : promptText;
  
  // Event listener para copiar
  copyBtn.addEventListener('click', async function(e) {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(textToCopy);
      
      // Cambiar el estilo del botÃƒÂ³n temporalmente
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = '<i class="fas fa-check"></i>';
      copyBtn.title = 'Copiado!';
      
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
        copyBtn.title = 'Copiar prompt';
      }, 2000);
      
      console.log('Ã°Å¸â€œâ€¹ Prompt copiado al portapapeles');
    } catch (err) {
      console.error('Ã¢ÂÅ’ Error al copiar prompt:', err);
      
      // Fallback para navegadores que no soportan clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = textToCopy;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = '<i class="fas fa-check"></i>';
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
      }, 2000);
    }
  });
  
  header.appendChild(title);
  header.appendChild(copyBtn);
  
  const textElement = document.createElement('div');
  textElement.className = 'prompt-item-text';
  
  // Usar innerHTML si es HTML, textContent si es texto normal
  if (isHtml) {
    textElement.innerHTML = promptText;
  } else {
    textElement.textContent = promptText;
  }
  
  // AÃƒÂ±adir botÃƒÂ³n de expandir si el texto es largo (usar longitud del texto limpio)
  const textLength = isHtml ? textToCopy.length : promptText.length;
  if (textLength > 150) {
    const expandBtn = document.createElement('button');
    expandBtn.className = 'prompt-expand-btn';
    expandBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Ver mÃƒÂ¡s';
    
    expandBtn.addEventListener('click', function() {
      const isExpanded = textElement.classList.contains('expanded');
      
      if (isExpanded) {
        textElement.classList.remove('expanded');
        expandBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Ver mÃƒÂ¡s';
      } else {
        textElement.classList.add('expanded');
        expandBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Ver menos';
      }
    });
    
    promptItem.appendChild(header);
    promptItem.appendChild(textElement);
    promptItem.appendChild(expandBtn);
  } else {
    promptItem.appendChild(header);
    promptItem.appendChild(textElement);
  }
  
  return promptItem;
}

// FunciÃƒÂ³n para crear un item de enlace de Google
function createGoogleLinkItem(originalPrompt, googleUrl, sectionNumber, imageNumber) {
  const linkItem = document.createElement('div');
  linkItem.className = 'prompt-item google-link-item';
  
  const header = document.createElement('div');
  header.className = 'prompt-item-header';
  
  const title = document.createElement('div');
  title.className = 'prompt-item-title';
  title.innerHTML = `<i class="fab fa-google"></i> SecciÃƒÂ³n ${sectionNumber} - Imagen ${imageNumber}`;
  
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'google-link-actions';
  
  const openBtn = document.createElement('button');
  openBtn.className = 'prompt-copy-btn google-open-btn';
  openBtn.innerHTML = '<i class="fas fa-external-link-alt"></i>';
  openBtn.title = 'Abrir en Google Images';
  
  const copyBtn = document.createElement('button');
  copyBtn.className = 'prompt-copy-btn';
  copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
  copyBtn.title = 'Copiar enlace';
  
  // Event listener para abrir el enlace
  openBtn.addEventListener('click', function(e) {
    e.preventDefault();
    window.open(googleUrl, '_blank');
    console.log('Ã°Å¸â€â€” Abriendo bÃƒÂºsqueda de Google Images:', googleUrl);
  });
  
  // Event listener para copiar el enlace
  copyBtn.addEventListener('click', async function(e) {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(googleUrl);
      
      // Cambiar el estilo del botÃƒÂ³n temporalmente
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = '<i class="fas fa-check"></i>';
      copyBtn.title = 'Copiado!';
      
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
        copyBtn.title = 'Copiar enlace';
      }, 2000);
      
      console.log('Ã°Å¸â€œâ€¹ Enlace de Google copiado al portapapeles');
    } catch (err) {
      console.error('Ã¢ÂÅ’ Error al copiar enlace:', err);
      
      // Fallback para navegadores que no soportan clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = googleUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = '<i class="fas fa-check"></i>';
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
      }, 2000);
    }
  });
  
  actionsDiv.appendChild(openBtn);
  actionsDiv.appendChild(copyBtn);
  header.appendChild(title);
  header.appendChild(actionsDiv);
  
  const textElement = document.createElement('div');
  textElement.className = 'prompt-item-text google-link-text';
  
  // Crear el enlace clickeable
  const linkElement = document.createElement('a');
  linkElement.href = googleUrl;
  linkElement.target = '_blank';
  linkElement.className = 'google-search-link';
  linkElement.innerHTML = `<i class="fab fa-google"></i> ${googleUrl}`;
  
  textElement.appendChild(linkElement);
  
  linkItem.appendChild(header);
  linkItem.appendChild(textElement);
  
  return linkItem;
}

// FunciÃƒÂ³n para limpiar el panel de prompts
function clearPromptsPanel() {
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  
  if (promptsList) {
    promptsList.innerHTML = '';
  }
  
  if (emptyState) {
    emptyState.style.display = 'block';
  }
  
  // Limpiar tambiÃƒÂ©n el contenedor de prompts visuales antiguo si existe
  const oldPromptsContainer = document.getElementById('image-prompts-display');
  if (oldPromptsContainer) {
    oldPromptsContainer.remove();
    console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Contenedor de prompts visuales eliminado');
  }
  
  // Limpiar el array global
  allAccumulatedPrompts = [];
  
  console.log('Ã°Å¸Â§Â¹ Panel de prompts limpiado');
}

// FunciÃƒÂ³n para obtener todos los prompts acumulados
function getAllAccumulatedPrompts() {
  return allAccumulatedPrompts;
}

// FunciÃƒÂ³n para exportar todos los prompts como texto
function exportAllPrompts() {
  if (allAccumulatedPrompts.length === 0) {
    console.log('Ã¢ÂÅ’ No hay prompts para exportar');
    return;
  }
  
  let exportText = 'PROMPTS DE IMÃƒÂGENES GENERADOS\n';
  exportText += '================================\n\n';
  
  let currentSection = 0;
  
  allAccumulatedPrompts.forEach((prompt, index) => {
    if (prompt.section !== currentSection) {
      currentSection = prompt.section;
      exportText += `SECCIÃƒâ€œN ${currentSection}\n`;
      exportText += '-'.repeat(20) + '\n\n';
    }
    
    exportText += `Imagen ${prompt.imageNumber}:\n`;
    exportText += `${prompt.text}\n\n`;
  });
  
  // Crear y descargar archivo
  const blob = new Blob([exportText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `prompts_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  console.log('Ã°Å¸â€œâ€ž Prompts exportados como archivo de texto');
}

// Modificar la funciÃƒÂ³n showImagePrompts existente para incluir el panel lateral
const originalShowImagePrompts = showImagePrompts;
showImagePrompts = function(prompts, sectionNumber, promptsFileInfo) {
  // Llamar a la funciÃƒÂ³n original
  originalShowImagePrompts(prompts, sectionNumber, promptsFileInfo);
  
  // AÃƒÂ±adir prompts al panel lateral
  addPromptsToSidebar(prompts, sectionNumber);
};

// Inicializar el panel cuando el DOM estÃƒÂ© listo
document.addEventListener('DOMContentLoaded', function() {
  console.log('Ã°Å¸Å’Å¸ DOM Content Loaded - Iniciando inicializaciÃƒÂ³n del panel de prompts');
  // Esperar un poco para asegurar que todos los elementos estÃƒÂ©n cargados
  setTimeout(() => {
    initializePromptsPanel();
  }, 100);
});

// Inicializar tambiÃƒÂ©n cuando la ventana estÃƒÂ© completamente cargada (backup)
window.addEventListener('load', function() {
  console.log('Ã°Å¸Å’Å¸ Window Loaded - Backup de inicializaciÃƒÂ³n del panel de prompts');
  setTimeout(() => {
    // Solo inicializar si no se ha hecho antes
    const toggleBtn = document.getElementById('promptsSidebarToggle');
    if (toggleBtn && !toggleBtn.hasEventListener) {
      initializePromptsPanel();
    }
  }, 500);
});

// TambiÃƒÂ©n aÃƒÂ±adir una inicializaciÃƒÂ³n manual como backup adicional
setTimeout(() => {
  console.log('Ã°Å¸Å’Å¸ Timeout backup - Verificando inicializaciÃƒÂ³n del panel');
  const toggleBtn = document.getElementById('promptsSidebarToggle');
  if (toggleBtn && !toggleBtn.hasEventListener) {
    console.log('Ã°Å¸â€â€ž Ejecutando inicializaciÃƒÂ³n de backup');
    initializePromptsPanel();
  }
}, 2000);

// FunciÃƒÂ³n de test para verificar el funcionamiento del panel
window.testPromptsPanel = function() {
  console.log('Ã°Å¸Â§Âª TESTING PROMPTS PANEL');
  
  const promptsSidebar = document.getElementById('promptsSidebar');
  const toggleBtn = document.getElementById('promptsSidebarToggle');
  const headerBtn = document.getElementById('showPromptsPanel');
  
  console.log('Elements found:');
  console.log('- promptsSidebar:', !!promptsSidebar);
  console.log('- toggleBtn:', !!toggleBtn);
  console.log('- headerBtn:', !!headerBtn);
  
  if (toggleBtn) {
    console.log('- toggleBtn has event listener:', !!toggleBtn.hasEventListener);
    console.log('- toggleBtn innerHTML:', toggleBtn.innerHTML);
  }
  
  if (promptsSidebar) {
    console.log('- Panel is active:', promptsSidebar.classList.contains('active'));
  }
  
  return {
    promptsSidebar,
    toggleBtn,
    headerBtn,
    isActive: promptsSidebar ? promptsSidebar.classList.contains('active') : false
  };
};

// Funcionalidad para navegaciÃƒÂ³n entre secciones
function initializeSectionNavigation() {
  console.log('Ã°Å¸â€Â§ Inicializando navegaciÃƒÂ³n de secciones...');
  
  const prevSectionBtn = document.getElementById('prevSectionBtn');
  const nextSectionBtn = document.getElementById('nextSectionBtn');
  
  console.log('BotÃƒÂ³n anterior encontrado:', !!prevSectionBtn);
  console.log('BotÃƒÂ³n siguiente encontrado:', !!nextSectionBtn);
  
  if (!prevSectionBtn || !nextSectionBtn) {
    console.log('Ã¢ÂÅ’ Botones de navegaciÃƒÂ³n de secciones no encontrados');
    return;
  }
  
  // Remover event listeners anteriores si existen
  prevSectionBtn.replaceWith(prevSectionBtn.cloneNode(true));
  nextSectionBtn.replaceWith(nextSectionBtn.cloneNode(true));
  
  // Obtener referencias nuevas despuÃƒÂ©s del clonado
  const newPrevBtn = document.getElementById('prevSectionBtn');
  const newNextBtn = document.getElementById('nextSectionBtn');
  
  // FunciÃƒÂ³n para ir a la secciÃƒÂ³n anterior
  newPrevBtn.addEventListener('click', function() {
    console.log(`Ã°Å¸â€â€ž CLICK ANTERIOR - Actual: ${currentSectionNumber}, Total secciones: ${allSections.length}`);
    console.log('Secciones disponibles:', allSections.map((s, i) => s ? `${i+1}: Ã¢Å“â€¦` : `${i+1}: Ã¢ÂÅ’`).join(', '));
    
    if (currentSectionNumber > 1) {
      console.log(`Ã¢Å“â€¦ Navegando a secciÃƒÂ³n ${currentSectionNumber - 1}`);
      showStoredSection(currentSectionNumber - 1);
    } else {
      console.log('Ã¢ÂÅ’ Ya estÃƒÂ¡s en la primera secciÃƒÂ³n');
    }
  });
  
  // FunciÃƒÂ³n para ir a la secciÃƒÂ³n siguiente
  newNextBtn.addEventListener('click', function() {
    console.log(`Ã°Å¸â€â€ž CLICK SIGUIENTE - Actual: ${currentSectionNumber}, Total secciones: ${allSections.length}`);
    console.log('Secciones disponibles:', allSections.map((s, i) => s ? `${i+1}: Ã¢Å“â€¦` : `${i+1}: Ã¢ÂÅ’`).join(', '));
    
    if (currentSectionNumber < allSections.length) {
      console.log(`Ã¢Å“â€¦ Navegando a secciÃƒÂ³n ${currentSectionNumber + 1}`);
      showStoredSection(currentSectionNumber + 1);
    } else {
      console.log('Ã¢ÂÅ’ Ya estÃƒÂ¡s en la ÃƒÂºltima secciÃƒÂ³n');
    }
  });
  
  console.log('Ã¢Å“â€¦ Event listeners agregados correctamente');
  console.log('Ã¢Å“â€¦ NavegaciÃƒÂ³n de secciones inicializada');
}

// FunciÃƒÂ³n para mostrar una secciÃƒÂ³n almacenada
function showStoredSection(sectionNum) {
  console.log(`Ã°Å¸â€Â Intentando mostrar secciÃƒÂ³n ${sectionNum}`);
  console.log(`Total secciones almacenadas: ${allSections.length}`);
  console.log(`Contenido de secciÃƒÂ³n ${sectionNum}:`, allSections[sectionNum - 1] ? 'Disponible' : 'No disponible');
  
  if (!allSections[sectionNum - 1]) {
    console.log(`Ã¢ÂÅ’ SecciÃƒÂ³n ${sectionNum} no disponible`);
    return;
  }
  
  const sectionData = allSections[sectionNum - 1];
  const script = typeof sectionData === 'string' ? sectionData : sectionData.script;
  const chapterTitle = typeof sectionData === 'object' ? sectionData.chapterTitle : null;
  const tokenUsage = typeof sectionData === 'object' ? sectionData.tokenUsage : null;
  const sectionImages = typeof sectionData === 'object' ? sectionData.images : null;
  const sectionImagePrompts = typeof sectionData === 'object' ? sectionData.imagePrompts : null;
  const sectionImageKeywords = typeof sectionData === 'object' ? sectionData.imageKeywords : null;
  const sectionImageMode = typeof sectionData === 'object' ? sectionData.imageMode : null;
  
  const sectionTitle = document.getElementById("section-title");
  const currentSectionSpan = document.getElementById("current-section");
  const scriptContent = document.getElementById("script-content");
  
  if (!sectionTitle || !currentSectionSpan || !scriptContent) {
    console.log('Ã¢ÂÅ’ Elementos DOM no encontrados');
    return;
  }
  
  // Actualizar nÃƒÂºmero de secciÃƒÂ³n actual
  currentSectionNumber = sectionNum;
  currentScript = script;
  
  // Actualizar tÃƒÂ­tulos y contadores
  sectionTitle.textContent = `SecciÃƒÂ³n ${sectionNum}`;
  currentSectionSpan.textContent = sectionNum;
  
  // Actualizar tÃƒÂ­tulo del capÃƒÂ­tulo especÃƒÂ­fico de esta secciÃƒÂ³n
  if (chapterTitle) {
    const chapterTitleContainer = document.getElementById('chapter-title-container');
    const chapterTitleSpan = document.getElementById('chapter-title');
    if (chapterTitleContainer && chapterTitleSpan) {
      chapterTitleSpan.textContent = chapterTitle.trim();
      chapterTitleContainer.style.display = 'block';
    }
  } else {
    // Si no hay tÃƒÂ­tulo especÃƒÂ­fico, usar la funciÃƒÂ³n general
    updateChapterTitle(sectionNum);
  }
  
  // Actualizar informaciÃƒÂ³n de tokens especÃƒÂ­fica de esta secciÃƒÂ³n
  updateTokenUsage(tokenUsage);
  
  // Mostrar el contenido del script
  const scriptHTML = `
    <div class="script-container">
      <div class="script-actions">
        <button class="copy-script-btn" onclick="copyScriptText()" title="Copiar texto del guiÃƒÂ³n">
          <i class="fas fa-copy"></i>
        </button>
        <button class="audio-script-btn" onclick="generateSectionAudioButton()" title="Generar audio del guiÃƒÂ³n">
          <i class="fas fa-microphone"></i>
        </button>
      </div>
      <div class="script-text">${script.replace(/\n/g, '<br><br>')}</div>
    </div>`;
  
  scriptContent.innerHTML = scriptHTML;
  
  // Actualizar estado de los botones de navegaciÃƒÂ³n
  updateNavigationButtons();
  
  // Restaurar carrusel e imÃƒÂ¡genes de esta secciÃƒÂ³n
  setTimeout(() => {
    if (sectionImages && sectionImages.length > 0) {
      console.log(`Ã°Å¸Å½Â  Restaurando carrusel para secciÃƒÂ³n ${sectionNum} con ${sectionImages.length} imÃƒÂ¡genes (modo: ${sectionImageMode})`);
      
      // Restaurar keywords globales si es Bing
      if (sectionImageMode === 'bing' && sectionImageKeywords) {
        currentImageKeywords = sectionImageKeywords;
        console.log(`Ã°Å¸Å½Â¯ Keywords restauradas para secciÃƒÂ³n ${sectionNum}:`, currentImageKeywords);
      }
      
      // Crear carrusel con las imÃƒÂ¡genes de esta secciÃƒÂ³n
      if (sectionImageMode === 'bing') {
        createCarousel(sectionImages, sectionNum, []);
      } else if (sectionImageMode === 'ai') {
        createCarousel(sectionImages, sectionNum, sectionImagePrompts || []);
      }
    } else if (sectionImagePrompts && sectionImagePrompts.length > 0 && sectionImageMode === 'prompts') {
      // Solo prompts (sin carrusel)
      console.log(`Ã°Å¸â€œâ€¹ Restaurando prompts para secciÃƒÂ³n ${sectionNum}`);
      document.getElementById("carousel-container").style.display = "none";
      addPromptsToSidebar(sectionImagePrompts, sectionNum);
    } else {
      // Sin imÃƒÂ¡genes en memoria - intentar cargar desde el servidor si hay un proyecto cargado
      if (window.currentProject) {
        console.log(`Ã°Å¸â€â€ž Intentando cargar imÃƒÂ¡genes desde servidor para secciÃƒÂ³n ${sectionNum}...`);
        loadSectionImages(sectionNum);
      } else {
        console.log(`Ã¢ÂÅ’ Sin imÃƒÂ¡genes para secciÃƒÂ³n ${sectionNum} - ocultando carrusel`);
        document.getElementById("carousel-container").style.display = "none";
      }
    }
  }, 100);
  
  // AnimaciÃƒÂ³n suave
  scriptContent.style.opacity = "0";
  setTimeout(() => {
    scriptContent.style.transition = "opacity 0.5s ease";
    scriptContent.style.opacity = "1";
  }, 50);
  
  console.log(`Ã°Å¸â€œâ€ž Mostrando secciÃƒÂ³n ${sectionNum} almacenada`);
}

// FunciÃƒÂ³n para actualizar el estado de los botones de navegaciÃƒÂ³n
function updateNavigationButtons() {
  const prevSectionBtn = document.getElementById('prevSectionBtn');
  const nextSectionBtn = document.getElementById('nextSectionBtn');
  
  if (!prevSectionBtn || !nextSectionBtn) {
    // Si los botones no existen aÃƒÂºn, programar un retry
    setTimeout(updateNavigationButtons, 100);
    return;
  }
  
  // BotÃƒÂ³n anterior: deshabilitado si estamos en la primera secciÃƒÂ³n
  if (currentSectionNumber <= 1) {
    prevSectionBtn.disabled = true;
  } else {
    prevSectionBtn.disabled = false;
  }
  
  // BotÃƒÂ³n siguiente: deshabilitado si estamos en la ÃƒÂºltima secciÃƒÂ³n o no hay mÃƒÂ¡s secciones
  if (currentSectionNumber >= allSections.length) {
    nextSectionBtn.disabled = true;
  } else {
    nextSectionBtn.disabled = false;
  }
  
  console.log(`Ã°Å¸â€â€ž Botones actualizados - SecciÃƒÂ³n ${currentSectionNumber}/${allSections.length}`);
}

// Inicializar navegaciÃƒÂ³n cuando el DOM estÃƒÂ© listo
document.addEventListener('DOMContentLoaded', function() {
  initializeSectionNavigation();
});

// Manejar selecciÃƒÂ³n exclusiva de opciones de audio
document.addEventListener('DOMContentLoaded', function() {
  const autoGenerateAudio = document.getElementById('autoGenerateAudio');
  const autoGenerateApplioAudio = document.getElementById('autoGenerateApplioAudio');
  
  if (autoGenerateAudio && autoGenerateApplioAudio) {
    // Cuando se selecciona Google Audio, deseleccionar Applio
    autoGenerateAudio.addEventListener('change', function() {
      if (this.checked) {
        autoGenerateApplioAudio.checked = false;
        console.log('Ã°Å¸â€Å  Audio Google seleccionado, Applio desactivado');
      }
    });
    
    // Cuando se selecciona Applio Audio, deseleccionar Google
    autoGenerateApplioAudio.addEventListener('change', function() {
      if (this.checked) {
        autoGenerateAudio.checked = false;
        console.log('Ã°Å¸Å½Â¤ Audio Applio seleccionado, Google desactivado');
      }
    });
    
    console.log('Ã¢Å“â€¦ Event listeners de audio configurados - selecciÃƒÂ³n exclusiva activada');
  }
});

// ========================================
// FUNCIONALIDAD DE EXTRACCIÃƒâ€œN DE TEXTO
// ========================================

// FunciÃƒÂ³n para mostrar notificaciones
function showNotification(message, type = 'info') {
  console.log(`Ã°Å¸â€œÂ¢ NotificaciÃƒÂ³n [${type.toUpperCase()}]:`, message);
  
  // Crear elemento de notificaciÃƒÂ³n
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    z-index: 10001;
    max-width: 400px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: slideInRight 0.3s ease;
  `;
  
  // Estilos segÃƒÂºn el tipo
  switch (type) {
    case 'error':
      notification.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
      break;
    case 'warning':
      notification.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
      break;
    case 'success':
      notification.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      break;
    default:
      notification.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
  }
  
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Remover despuÃƒÂ©s de 4 segundos
  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 4000);
}

function initializeTextExtractor() {
  if (window.extractorInitialized) {
    console.log('Ã¢Å¡Â Ã¯Â¸Â Extractor ya inicializado, omitiendo...');
    return;
  }
  
  console.log('Ã°Å¸Å½Â¤ Inicializando extractor de texto...');
  
  // Elementos del DOM
  const extractTextBtn = document.getElementById('extractTextBtn');
  const extractTextModal = document.getElementById('extractTextModal');
  const closeExtractModal = document.getElementById('closeExtractModal');
  
  console.log('Ã°Å¸â€Â Verificando elementos:', {
    extractTextBtn: !!extractTextBtn,
    extractTextModal: !!extractTextModal,
    closeExtractModal: !!closeExtractModal
  });
  
  if (!extractTextBtn) {
    console.error('Ã¢ÂÅ’ BotÃƒÂ³n extractTextBtn no encontrado');
    return;
  }
  
  if (!extractTextModal) {
    console.error('Ã¢ÂÅ’ Modal extractTextModal no encontrado');
    return;
  }
  
  console.log('Ã¢Å“â€¦ Elementos principales encontrados, configurando eventos...');
  
  // Verificar todos los elementos necesarios
  const elements = {
    extractDropzone: document.getElementById('extractDropzone'),
    extractFileInput: document.getElementById('extractFileInput'),
    extractFileName: document.getElementById('extractFileName'),
    extractAudioTrackContainer: document.getElementById('extractAudioTrackContainer'),
    extractAudioTrackSelect: document.getElementById('extractAudioTrackSelect'),
    extractTranscribeBtn: document.getElementById('extractTranscribeBtn'),
    extractProgressBar: document.getElementById('extractProgressBar'),
    extractProgressText: document.getElementById('extractProgressText'),
    extractOutput: document.getElementById('extractOutput'),
    extractResultActions: document.getElementById('extractResultActions'),
    copyExtractedText: document.getElementById('copyExtractedText'),
    saveExtractedText: document.getElementById('saveExtractedText'),
    useAsPrompt: document.getElementById('useAsPrompt'),
    
    // Nuevos elementos para configuraciÃƒÂ³n
    transcriptionMethod: document.getElementById('transcriptionMethod'),
    localConfig: document.getElementById('localConfig'),
    whisperModel: document.getElementById('whisperModel'),
    audioLanguage: document.getElementById('audioLanguage'),
    localModelStatus: document.getElementById('localModelStatus')
  };
  
  console.log('Ã°Å¸â€Â VerificaciÃƒÂ³n detallada de elementos:', elements);
  
  // Verificar cada elemento
  Object.keys(elements).forEach(key => {
    if (!elements[key]) {
      console.error(`Ã¢ÂÅ’ Elemento faltante: ${key}`);
    } else {
      console.log(`Ã¢Å“â€¦ Elemento encontrado: ${key}`);
    }
  });
  
  const extractDropzone = elements.extractDropzone;
  const extractFileInput = elements.extractFileInput;
  const extractFileName = elements.extractFileName;
  const extractAudioTrackContainer = elements.extractAudioTrackContainer;
  const extractAudioTrackSelect = elements.extractAudioTrackSelect;
  const extractTranscribeBtn = elements.extractTranscribeBtn;
  const extractProgressBar = elements.extractProgressBar;
  const extractProgressText = elements.extractProgressText;
  const extractOutput = elements.extractOutput;
  const extractResultActions = elements.extractResultActions;
  const copyExtractedText = elements.copyExtractedText;
  const saveExtractedText = elements.saveExtractedText;
  const useAsPrompt = elements.useAsPrompt;
  
  // Abrir modal
  extractTextBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Ã°Å¸â€Â§ Click en botÃƒÂ³n extraer texto detectado');
    extractTextModal.style.display = 'flex';
    console.log('Ã°Å¸â€œâ€š Modal de extracciÃƒÂ³n abierto');
  });
  
  // Cerrar modal
  if (closeExtractModal) {
    closeExtractModal.addEventListener('click', () => {
      extractTextModal.style.display = 'none';
      resetExtractForm();
    });
  }
  
  // Cerrar modal al hacer click fuera
  if (extractTextModal) {
    extractTextModal.addEventListener('click', (e) => {
      if (e.target === extractTextModal) {
        extractTextModal.style.display = 'none';
        resetExtractForm();
      }
    });
  }
  
  // Drag & Drop
  if (extractDropzone) {
    console.log('Ã°Å¸Å½Â¯ Configurando drag & drop en dropzone...');
    showNotification('Ã°Å¸Å½Â¯ Drag & Drop configurado correctamente', 'success');
    
    extractDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      extractDropzone.classList.add('dragover');
      console.log('Ã°Å¸â€œÂ¥ Archivo siendo arrastrado sobre la zona...');
      showNotification('Ã°Å¸â€œÂ¥ Archivo detectado - suelta aquÃƒÂ­', 'info');
    });
    
    extractDropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      extractDropzone.classList.remove('dragover');
      console.log('Ã°Å¸â€œÂ¤ Archivo saliÃƒÂ³ de la zona de arrastre...');
    });
    
    extractDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      extractDropzone.classList.remove('dragover');
      console.log('Ã°Å¸Å½Â¯ Archivo soltado en la zona!');
      showNotification('Ã°Å¸Å½Â¯ Archivo recibido - procesando...', 'success');
      
      const files = e.dataTransfer.files;
      console.log('Ã°Å¸â€œÂ Archivos detectados:', files.length);
      
      if (files.length > 0) {
        console.log('Ã°Å¸â€œâ€ž Procesando archivo:', files[0].name, files[0].type);
        handleFileSelection(files[0]);
      } else {
        console.warn('Ã¢Å¡Â Ã¯Â¸Â No se detectaron archivos en el drop');
        showNotification('Ã¢Å¡Â Ã¯Â¸Â No se detectaron archivos', 'warning');
      }
    });
    
    // Click para seleccionar archivo
    extractDropzone.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Ã°Å¸â€“Â±Ã¯Â¸Â Click en dropzone detectado');
      showNotification('Ã°Å¸â€“Â±Ã¯Â¸Â Abriendo selector de archivos...', 'info');
      if (extractFileInput) {
        extractFileInput.click();
        console.log('Ã°Å¸â€œâ€š Abriendo selector de archivos...');
      } else {
        console.error('Ã¢ÂÅ’ Input de archivo no encontrado');
        showNotification('Ã¢ÂÅ’ Error: Input de archivo no encontrado', 'error');
      }
    });
  } else {
    console.error('Ã¢ÂÅ’ Dropzone no encontrado');
    showNotification('Ã¢ÂÅ’ Error: Zona de arrastre no encontrada', 'error');
  }
  
  if (extractFileInput) {
    console.log('Ã°Å¸â€œÂ Configurando input de archivo...');
    extractFileInput.addEventListener('change', (e) => {
      console.log('Ã°Å¸â€œâ€ž Archivo seleccionado via input:', e.target.files.length);
      showNotification('Ã°Å¸â€œâ€ž Archivo seleccionado - procesando...', 'info');
      if (e.target.files.length > 0) {
        console.log('Ã°Å¸â€œâ€¹ Procesando archivo seleccionado:', e.target.files[0].name);
        handleFileSelection(e.target.files[0]);
      }
    });
  } else {
    console.error('Ã¢ÂÅ’ Input de archivo no encontrado');
    showNotification('Ã¢ÂÅ’ Error: Input de archivo no encontrado', 'error');
  }
  
  // BotÃƒÂ³n transcribir
  if (extractTranscribeBtn) {
    extractTranscribeBtn.addEventListener('click', () => {
      startTranscription();
    });
  }
  
  // Botones de acciones
  if (copyExtractedText) {
    copyExtractedText.addEventListener('click', () => {
      navigator.clipboard.writeText(extractedText).then(() => {
        showNotification('Ã¢Å“â€¦ Texto copiado al portapapeles');
      });
    });
  }
  
  if (saveExtractedText) {
    saveExtractedText.addEventListener('click', () => {
      downloadAsText(extractedText, 'transcripcion.txt');
    });
  }
  
  if (useAsPrompt) {
    useAsPrompt.addEventListener('click', () => {
      const promptInput = document.getElementById('prompt');
      if (promptInput) {
        promptInput.value = extractedText;
        extractTextModal.style.display = 'none';
        resetExtractForm();
        showNotification('Ã¢Å“â€¦ Texto insertado como tema principal');
        promptInput.focus();
      }
    });
  }
  
  // === NUEVOS EVENT LISTENERS PARA CONFIGURACIÃƒâ€œN ===
  
  // Cambio de mÃƒÂ©todo de transcripciÃƒÂ³n
  const transcriptionMethod = elements.transcriptionMethod;
  const localConfig = elements.localConfig;
  
  if (transcriptionMethod) {
    transcriptionMethod.addEventListener('change', (e) => {
      const method = e.target.value;
      console.log(`Ã°Å¸â€Â§ MÃƒÂ©todo de transcripciÃƒÂ³n cambiado a: ${method}`);
      
      if (method === 'local') {
        localConfig.style.display = 'block';
        checkLocalModelStatus();
        showNotification('Ã°Å¸Å¡â‚¬ Modo local activado - usando GPU', 'info');
      } else {
        localConfig.style.display = 'none';
        showNotification('Ã°Å¸Å’Â Modo API activado - usando OpenAI', 'info');
      }
    });
  }
  
  // Verificar estado inicial al abrir modal
  extractTextBtn.addEventListener('click', () => {
    if (transcriptionMethod && transcriptionMethod.value === 'local') {
      localConfig.style.display = 'block';
      checkLocalModelStatus();
    }
  });
  
  console.log('Ã¢Å“â€¦ Extractor de texto inicializado correctamente');
  window.extractorInitialized = true;
}

// === FUNCIONES PARA WHISPER LOCAL ===

async function checkLocalModelStatus() {
  const localModelStatus = document.getElementById('localModelStatus');
  if (!localModelStatus) return;
  
  try {
    localModelStatus.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Verificando estado del modelo...';
    localModelStatus.style.background = 'rgba(59, 130, 246, 0.15)';
    localModelStatus.style.color = '#93c5fd';
    
    const response = await fetch('/whisper-local-info');
    const info = await response.json();
    
    if (info.error) {
      throw new Error(info.error);
    }
    
    if (info.gpu_available) {
      localModelStatus.innerHTML = `
        <i class="fas fa-check-circle"></i> 
        Ã¢Å“â€¦ GPU: ${info.gpu_name} | 
        Modelo ${info.is_loaded ? 'cargado' : 'disponible'}: ${info.model_size || 'ninguno'}
      `;
      localModelStatus.style.background = 'rgba(16, 185, 129, 0.15)';
      localModelStatus.style.color = '#00ff7f';
    } else {
      localModelStatus.innerHTML = '<i class="fas fa-desktop"></i> Ã¢Å¡Â Ã¯Â¸Â CPU disponible (sin GPU)';
      localModelStatus.style.background = 'rgba(245, 158, 11, 0.15)';
      localModelStatus.style.color = '#fbbf24';
    }
    
  } catch (error) {
    console.error('Error verificando estado local:', error);
    localModelStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Ã¢ÂÅ’ Error verificando modelo local';
    localModelStatus.style.background = 'rgba(239, 68, 68, 0.15)';
    localModelStatus.style.color = '#fca5a5';
  }
}

async function handleFileSelection(file) {
  console.log('Ã°Å¸â€œÂ === INICIANDO PROCESAMIENTO DE ARCHIVO ===');
  console.log('Ã°Å¸â€œâ€ž Archivo seleccionado:', file.name);
  console.log('Ã°Å¸â€œÅ  TamaÃƒÂ±o:', (file.size / 1024 / 1024).toFixed(2), 'MB');
  console.log('Ã°Å¸ÂÂ·Ã¯Â¸Â Tipo MIME:', file.type);
  
  // Verificar tamaÃƒÂ±o del archivo
  const fileSizeMB = file.size / 1024 / 1024;
  if (fileSizeMB > 4000) { // 4GB
    showNotification('Ã¢Å¡Â Ã¯Â¸Â Archivo muy grande (>4GB). Esto puede tomar mucho tiempo.', 'warning');
  } else if (fileSizeMB > 1000) { // 1GB
    showNotification('Ã°Å¸â€œÅ  Archivo grande detectado. La subida puede tardar unos minutos...', 'info');
  }
  
  // Validar tipo de archivo
  const validTypes = ['audio/mp3', 'audio/wav', 'audio/mpeg', 'audio/m4a', 'video/mp4', 'audio/ogg'];
  const validExtensions = ['.mp3', '.wav', '.m4a', '.mp4', '.ogg'];
  
  const isValidType = validTypes.includes(file.type) || 
                     validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
  
  console.log('Ã¢Å“â€¦ ValidaciÃƒÂ³n de tipo:', {
    mimeTypeValid: validTypes.includes(file.type),
    extensionValid: validExtensions.some(ext => file.name.toLowerCase().endsWith(ext)),
    overallValid: isValidType
  });
  
  if (!isValidType) {
    console.error('Ã¢ÂÅ’ Formato de archivo no soportado');
    showNotification('Ã¢ÂÅ’ Formato de archivo no soportado. Use MP3, WAV, M4A o MP4', 'error');
    return;
  }
  
  selectedFile = file;
  console.log('Ã°Å¸â€™Â¾ Archivo almacenado en selectedFile');
  
  // Mostrar nombre del archivo
  const extractFileName = document.getElementById('extractFileName');
  if (extractFileName) {
    extractFileName.textContent = `Ã°Å¸â€œÂ ${file.name}`;
    extractFileName.style.display = 'block';
    console.log('Ã°Å¸â€œÂ Nombre de archivo mostrado');
    showNotification(`Ã¢Å“â€¦ Archivo cargado: ${file.name}`, 'success');
  } else {
    console.error('Ã¢ÂÅ’ Elemento extractFileName no encontrado');
    showNotification('Ã¢ÂÅ’ Error: No se pudo mostrar el nombre del archivo', 'error');
  }
  
  // Si es MP4, obtener pistas de audio
  if (file.name.toLowerCase().endsWith('.mp4')) {
    console.log('Ã°Å¸Å½Â¬ Archivo MP4 detectado, cargando pistas de audio...');
    try {
      await loadAudioTracks(file);
    } catch (error) {
      console.error('Ã¢ÂÅ’ Error cargando pistas de audio:', error);
      showNotification('Ã¢Å¡Â Ã¯Â¸Â Error cargando pistas, usando configuraciÃƒÂ³n por defecto', 'warning');
      
      // Si falla cargar las pistas, habilitar transcripciÃƒÂ³n directamente
      const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
      if (extractTranscribeBtn) {
        extractTranscribeBtn.disabled = false;
        console.log('Ã¢Å“â€¦ BotÃƒÂ³n habilitado como fallback');
        showNotification('Ã¢Å“â€¦ Listo para transcribir', 'success');
      }
    }
  } else {
    console.log('Ã°Å¸Å½Âµ Archivo de audio detectado, preparando para transcripciÃƒÂ³n...');
    // Para archivos de audio, subir archivo y preparar para transcripciÃƒÂ³n
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      console.log('Ã°Å¸â€œÂ¤ Subiendo archivo de audio...');
      showNotification('Ã°Å¸â€œÂ¤ Subiendo archivo...', 'info');
      
      const uploadResponse = await fetch('/upload-audio', {
        method: 'POST',
        body: formData
      });
      
      if (uploadResponse.ok) {
        const uploadData = await uploadResponse.json();
        selectedFile.serverPath = uploadData.filePath;
        console.log('Ã¢Å“â€¦ Archivo subido correctamente:', uploadData.filePath);
        showNotification('Ã¢Å“â€¦ Archivo subido correctamente', 'success');
      } else {
        const errorData = await uploadResponse.json();
        console.error('Ã¢ÂÅ’ Error subiendo archivo:', errorData);
        showNotification(`Ã¢ÂÅ’ Error subiendo archivo: ${errorData.error}`, 'error');
        return; // Salir si hay error
      }
    } catch (error) {
      console.error('Ã¢Å¡Â Ã¯Â¸Â Error pre-subiendo archivo de audio:', error);
      showNotification(`Ã¢ÂÅ’ Error de conexiÃƒÂ³n: ${error.message}`, 'error');
      return; // Salir si hay error
    }
    
    // Ocultar selector de pistas
    const extractAudioTrackContainer = document.getElementById('extractAudioTrackContainer');
    const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
    
    console.log('Ã°Å¸Å½â€ºÃ¯Â¸Â Configurando interfaz para archivo de audio...');
    console.log('Ã°Å¸â€Â Elementos encontrados:', {
      extractAudioTrackContainer: !!extractAudioTrackContainer,
      extractTranscribeBtn: !!extractTranscribeBtn
    });
    
    if (extractAudioTrackContainer) {
      extractAudioTrackContainer.style.display = 'none';
      console.log('Ã¢Å“â€¦ Selector de pistas ocultado');
    } else {
      console.error('Ã¢ÂÅ’ extractAudioTrackContainer no encontrado');
    }
    
    if (extractTranscribeBtn) {
      extractTranscribeBtn.disabled = false;
      extractTranscribeBtn.style.opacity = '1';
      extractTranscribeBtn.style.transform = 'scale(1.02)';
      setTimeout(() => {
        if (extractTranscribeBtn) {
          extractTranscribeBtn.style.transform = 'scale(1)';
        }
      }, 200);
      console.log('Ã¢Å“â€¦ BotÃƒÂ³n de transcripciÃƒÂ³n habilitado');
      showNotification('Ã¢Å“â€¦ Listo para transcribir - haz click en "Transcribir Audio"', 'success');
    } else {
      console.error('Ã¢ÂÅ’ extractTranscribeBtn no encontrado');
      showNotification('Ã¢ÂÅ’ Error: BotÃƒÂ³n de transcripciÃƒÂ³n no encontrado', 'error');
    }
  }
  
  console.log('Ã°Å¸â€œÂ === PROCESAMIENTO DE ARCHIVO COMPLETADO ===');
  
  // Forzar actualizaciÃƒÂ³n visual
  setTimeout(() => {
    const extractFileName = document.getElementById('extractFileName');
    const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
    
    if (extractFileName && extractFileName.style.display === 'none') {
      console.log('Ã°Å¸â€â€ž Forzando visualizaciÃƒÂ³n del nombre del archivo...');
      extractFileName.style.display = 'block';
      extractFileName.style.visibility = 'visible';
    }
    
    if (extractTranscribeBtn && extractTranscribeBtn.disabled) {
      console.log('Ã°Å¸â€â€ž Forzando habilitaciÃƒÂ³n del botÃƒÂ³n...');
      extractTranscribeBtn.disabled = false;
    }
  }, 100);
}

async function loadAudioTracks(file) {
  console.log('Ã°Å¸Å½Âµ Cargando pistas de audio del MP4...');
  
  try {
    // Primero subir el archivo
    const formData = new FormData();
    formData.append('file', file);
    
    const uploadResponse = await fetch('/upload-audio', {
      method: 'POST',
      body: formData
    });
    
    if (!uploadResponse.ok) {
      throw new Error('Error subiendo archivo');
    }
    
    const uploadData = await uploadResponse.json();
    selectedFile.serverPath = uploadData.filePath; // Guardar la ruta del servidor
    
    // Luego obtener las pistas de audio
    const response = await fetch('/get-audio-tracks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ filePath: uploadData.filePath })
    });
    
    if (!response.ok) {
      throw new Error('Error obteniendo pistas de audio');
    }
    
    const data = await response.json();
    const tracks = data.tracks;
    
    const extractAudioTrackSelect = document.getElementById('extractAudioTrackSelect');
    const extractAudioTrackContainer = document.getElementById('extractAudioTrackContainer');
    
    // Limpiar opciones anteriores
    extractAudioTrackSelect.innerHTML = '<option value="">Selecciona una pista...</option>';
    
    // Agregar opciones de pistas
    tracks.forEach((track, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${track.title} (${track.codec}, ${track.channels} canales)`;
      extractAudioTrackSelect.appendChild(option);
    });
    
    extractAudioTrackContainer.style.display = 'block';
    
    // Asegurar estilos de color para el contenedor
    extractAudioTrackContainer.style.color = '#e2e8f0';
    extractAudioTrackSelect.style.color = '#ffffff';
    
    // Aplicar estilos a todos los elementos del contenedor
    const containerElements = extractAudioTrackContainer.querySelectorAll('*');
    containerElements.forEach(element => {
      element.style.color = '#e2e8f0';
    });
    
    // Habilitar transcripciÃƒÂ³n cuando se seleccione una pista
    extractAudioTrackSelect.addEventListener('change', () => {
      document.getElementById('extractTranscribeBtn').disabled = !extractAudioTrackSelect.value;
    });
    
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error cargando pistas:', error);
    showNotification('Ã¢Å¡Â Ã¯Â¸Â No se pudieron cargar las pistas de audio. Se usarÃƒÂ¡ la pista por defecto.', 'warning');
    document.getElementById('extractAudioTrackContainer').style.display = 'none';
    document.getElementById('extractTranscribeBtn').disabled = false;
  }
}

async function startTranscription() {
  if (!selectedFile) {
    showNotification('Ã¢ÂÅ’ No hay archivo seleccionado', 'error');
    return;
  }
  
  console.log('Ã°Å¸Å½Â¤ Iniciando transcripciÃƒÂ³n...');
  
  const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
  const extractProgressBar = document.getElementById('extractProgressBar');
  const extractProgressText = document.getElementById('extractProgressText');
  const extractOutput = document.getElementById('extractOutput');
  const extractResultActions = document.getElementById('extractResultActions');
  const transcriptionMethod = document.getElementById('transcriptionMethod');
  
  // Obtener configuraciones
  const method = transcriptionMethod ? transcriptionMethod.value : 'api';
  const modelSize = document.getElementById('whisperModel')?.value || 'medium';
  const language = document.getElementById('audioLanguage')?.value || '';
  
  console.log(`Ã°Å¸â€Â§ MÃƒÂ©todo: ${method} | Modelo: ${modelSize} | Idioma: ${language || 'auto'}`);
  
  // Deshabilitar botÃƒÂ³n y mostrar progreso
  extractTranscribeBtn.disabled = true;
  extractTranscribeBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Transcribiendo (${method})...`;
  extractProgressBar.style.display = 'block';
  extractProgressText.style.display = 'block';
  extractProgressText.textContent = 'Preparando archivo...';
  extractOutput.textContent = '';
  extractResultActions.style.display = 'none';
  
  try {
    let filePath = selectedFile.serverPath;
    
    // Si no tenemos la ruta del servidor, subir el archivo primero
    if (!filePath) {
      extractProgressText.textContent = 'Subiendo archivo...';
      
      const formData = new FormData();
      formData.append('file', selectedFile);
      
      const uploadResponse = await fetch('/upload-audio', {
        method: 'POST',
        body: formData
      });
      
      if (!uploadResponse.ok) {
        throw new Error('Error subiendo archivo');
      }
      
      const uploadData = await uploadResponse.json();
      filePath = uploadData.filePath;
    }
    
    // Obtener pista de audio seleccionada (si es MP4)
    let audioTrackIndex = null;
    const extractAudioTrackSelect = document.getElementById('extractAudioTrackSelect');
    if (extractAudioTrackSelect.style.display !== 'none' && extractAudioTrackSelect.value) {
      audioTrackIndex = parseInt(extractAudioTrackSelect.value);
    }
    
    // Determinar endpoint segÃƒÂºn el mÃƒÂ©todo
    const endpoint = method === 'local' ? '/transcribe-audio-local' : '/transcribe-audio';
    const bodyData = { 
      filePath: filePath,
      audioTrackIndex: audioTrackIndex
    };
    
    // Agregar configuraciones adicionales para mÃƒÂ©todo local
    if (method === 'local') {
      bodyData.modelSize = modelSize;
      if (language) {
        bodyData.language = language;
      }
      extractProgressText.textContent = `Transcribiendo con GPU (${modelSize})...`;
    } else {
      extractProgressText.textContent = 'Transcribiendo con OpenAI API...';
    }
    
    console.log(`Ã°Å¸â€œÂ¡ Enviando a: ${endpoint}`, bodyData);
    
    // Llamar a la API de transcripciÃƒÂ³n
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyData)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Error en la transcripciÃƒÂ³n');
    }
    
    const data = await response.json();
    extractedText = data.transcript;
    
    // Mostrar resultado con informaciÃƒÂ³n adicional segÃƒÂºn el mÃƒÂ©todo
    extractProgressBar.value = 100;
    
    if (method === 'local' && data.stats) {
      extractProgressText.textContent = `Ã¢Å“â€¦ TranscripciÃƒÂ³n completada (${data.stats.processing_speed.toFixed(1)}x tiempo real)`;
      
      // Mostrar informaciÃƒÂ³n adicional en consola
      console.log(`ðŸ“Š EstadÃ­sticas de transcripciÃ³n local:`, {
        modelo: data.model_info,
        estadisticas: data.stats,
        idioma: data.language,
        duracion: data.duration
      });
      
      showNotification(`Ã¢Å“â€¦ TranscripciÃƒÂ³n local completada - ${data.stats.processing_speed.toFixed(1)}x velocidad`, 'success');
    } else {
      extractProgressText.textContent = 'Ã¢Å“â€¦ TranscripciÃƒÂ³n completada';
      showNotification('Ã¢Å“â€¦ TranscripciÃƒÂ³n completada exitosamente');
    }
    
    extractProgressText.style.color = '#00ff7f';
    extractProgressText.style.fontWeight = '600';
    extractProgressText.style.background = 'rgba(16, 185, 129, 0.15)';
    extractProgressText.style.padding = '0.5rem';
    extractProgressText.style.borderRadius = '6px';
    extractProgressText.style.border = '1px solid rgba(16, 185, 129, 0.4)';
    extractOutput.textContent = extractedText;
    extractOutput.style.display = 'block';
    extractOutput.style.color = '#ffffff';
    extractResultActions.style.display = 'flex';
    
    console.log(`Ã¢Å“â€¦ TranscripciÃƒÂ³n completada (${method})`);
    
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error en transcripciÃƒÂ³n:', error);
    extractProgressText.textContent = `Ã¢ÂÅ’ Error en la transcripciÃƒÂ³n (${method})`;
    extractProgressText.style.color = '#fca5a5';
    extractProgressText.style.fontWeight = '600';
    extractProgressText.style.background = 'rgba(239, 68, 68, 0.15)';
    extractProgressText.style.padding = '0.5rem';
    extractProgressText.style.borderRadius = '6px';
    extractProgressText.style.border = '1px solid rgba(239, 68, 68, 0.4)';
    showNotification(`Ã¢ÂÅ’ Error: ${error.message}`, 'error');
  } finally {
    // Rehabilitar botÃƒÂ³n
    extractTranscribeBtn.disabled = false;
    extractTranscribeBtn.innerHTML = '<i class="fas fa-microphone"></i> Transcribir Audio';
  }
}

function resetExtractForm() {
  selectedFile = null;
  extractedText = '';
  
  const extractFileName = document.getElementById('extractFileName');
  const extractAudioTrackContainer = document.getElementById('extractAudioTrackContainer');
  const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
  const extractProgressBar = document.getElementById('extractProgressBar');
  const extractProgressText = document.getElementById('extractProgressText');
  const extractOutput = document.getElementById('extractOutput');
  const extractResultActions = document.getElementById('extractResultActions');
  const extractFileInput = document.getElementById('extractFileInput');
  
  extractFileName.style.display = 'none';
  extractAudioTrackContainer.style.display = 'none';
  extractTranscribeBtn.disabled = true;
  extractProgressBar.style.display = 'none';
  extractProgressText.style.display = 'none';
  extractOutput.style.display = 'none';
  extractResultActions.style.display = 'none';
  extractFileInput.value = '';
  
  console.log('Ã°Å¸â€â€ž Formulario de extracciÃƒÂ³n reiniciado');
}

function downloadAsText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
  
  showNotification('Ã¢Å“â€¦ Archivo descargado exitosamente');
}

// Helpers para detecciÃƒÂ³n de idioma del guiÃƒÂ³n
function extractTextFromSection(section) {
  if (!section) return '';

  if (typeof section === 'string') {
    return section;
  }

  if (typeof section === 'object') {
    const candidateKeys = [
      'cleanedScript',
      'script',
      'content',
      'text',
      'body',
      'summary'
    ];

    for (const key of candidateKeys) {
      const value = section[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
  }

  return '';
}

function getSectionsForLanguageDetection() {
  if (Array.isArray(allSections) && allSections.length > 0) {
    const normalizedSections = allSections
      .map(extractTextFromSection)
      .filter(text => typeof text === 'string' && text.trim().length > 0)
      .map(text => text.trim());

    if (normalizedSections.length > 0) {
      return normalizedSections;
    }
  }

  if (window.currentProject) {
    const candidateCollections = [
      window.currentProject.completedSections,
      window.currentProject.sections,
      window.currentProject.generatedSections
    ].filter(collection => Array.isArray(collection));

    for (const collection of candidateCollections) {
      const scripts = collection
        .map(extractTextFromSection)
        .filter(text => typeof text === 'string' && text.trim().length > 0)
        .map(text => text.trim());

      if (scripts.length > 0) {
        return scripts;
      }
    }
  }

  return [];
}

function normalizeForLanguageDetection(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
}

function countIndicatorHits(tokens, indicators) {
  if (!Array.isArray(tokens) || tokens.length === 0) return 0;
  const indicatorSet = new Set(indicators);
  let hits = 0;

  for (const token of tokens) {
    if (indicatorSet.has(token)) {
      hits += 1;
    }
  }

  return hits;
}

function detectLanguageFromSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) {
    console.log('Ã°Å¸Å’Â DetecciÃƒÂ³n de idioma: sin secciones, se asume espaÃƒÂ±ol');
    return 'es';
  }

  const combinedText = sections.join(' ');
  const normalizedText = normalizeForLanguageDetection(combinedText);
  const tokens = normalizedText.split(/\s+/).filter(Boolean);

  const spanishIndicators = [
    'el', 'la', 'que', 'de', 'y', 'en', 'los', 'del', 'por', 'para', 'una', 'con', 'como', 'este', 'esta',
    'pero', 'porque', 'cuando', 'sobre', 'video', 'ahora', 'mas', 'solo', 'tambien'
  ];

  const englishIndicators = [
    'the', 'and', 'with', 'from', 'you', 'this', 'that', 'for', 'your', 'about', 'video', 'people', 'just',
    'they', 'have', 'will', 'what', 'when', 'why', 'how', 'into', 'over', 'after', 'before'
  ];

  const spanishScore = countIndicatorHits(tokens, spanishIndicators);
  const englishScore = countIndicatorHits(tokens, englishIndicators);

  const asciiOnlyRatio = normalizedText.replace(/[^\x00-\x7f]/g, '').length / Math.max(normalizedText.length, 1);

  const isConfidentlyEnglish = (
    englishScore >= spanishScore * 1.3 && englishScore >= 5
  ) || (
    englishScore - spanishScore >= 4
  ) || (
    asciiOnlyRatio > 0.98 && englishScore >= spanishScore && englishScore >= 4
  );

  const detectedLanguage = isConfidentlyEnglish ? 'en' : 'es';
  console.log('Ã°Å¸Å’Â DetecciÃƒÂ³n de idioma del guiÃƒÂ³n:', {
    detectedLanguage,
    spanishScore,
    englishScore,
    asciiOnlyRatio: Number(asciiOnlyRatio.toFixed(3)),
    sectionsAnalizadas: sections.length
  });

  window.lastDetectedScriptLanguage = detectedLanguage;
  return detectedLanguage;
}

// FunciÃƒÂ³n para generar metadata de YouTube
async function generateYouTubeMetadata() {
  try {
    console.log("Ã°Å¸Å½Â¬ Iniciando generaciÃƒÂ³n de metadata de YouTube...");
    
  const topicField = typeof promptInput !== 'undefined' && promptInput ? promptInput : document.getElementById('prompt');
  const topic = topicField?.value?.trim();
    const folderName = document.getElementById("folderName")?.value?.trim() || '';

    const sectionsForMetadata = getSectionsForLanguageDetection();

    if (!topic || sectionsForMetadata.length === 0) {
      console.error("Ã¢ÂÅ’ No hay tema o secciones para generar metadata");
      return;
    }

    const detectedLanguage = detectLanguageFromSections(sectionsForMetadata);

    // Mostrar indicador de carga
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'youtube-metadata-loading';
    loadingIndicator.innerHTML = `
      <div class="loading-content">
        <i class="fas fa-spinner fa-spin"></i>
        <h3>Generando Metadata para YouTube...</h3>
        <p>Creando tÃƒÂ­tulos clickbait, descripciÃƒÂ³n SEO y etiquetas...</p>
      </div>
    `;
    
    output.appendChild(loadingIndicator);

    const response = await fetch('/generate-youtube-metadata', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        topic: topic,
        allSections: sectionsForMetadata,
        folderName: folderName,
        thumbnailStyle: getThumbnailStyleData(),
        language: detectedLanguage
      })
    });

    const data = await response.json();

    // Remover indicador de carga
    loadingIndicator.remove();

    if (data.success) {
      console.log("Ã¢Å“â€¦ Metadata de YouTube generada exitosamente");
      showYouTubeMetadataResults(data.metadata, topic);

      const generatedAt = new Date().toISOString();
      window.lastGeneratedYouTubeMetadata = {
        content: data.metadata,
        topic,
        generatedAt,
        language: detectedLanguage
      };

      if (window.currentProject) {
        window.currentProject.youtubeMetadata = window.currentProject.youtubeMetadata || {};
        window.currentProject.youtubeMetadata.content = data.metadata;
        window.currentProject.youtubeMetadata.generatedAt = generatedAt;
        window.currentProject.youtubeMetadata.language = detectedLanguage;
      }

      isMetadataShown = true;
      updateYouTubeMetadataButtonState();

      return data.metadata;
    } else {
      console.error("Ã¢ÂÅ’ Error generando metadata:", data.error);
      showError("Error generando metadata de YouTube: " + data.error);
      throw new Error(data.error || 'Error al generar metadata de YouTube');
    }

  } catch (error) {
    console.error("Ã¢ÂÅ’ Error en generateYouTubeMetadata:", error);
    showError("Error generando metadata de YouTube: " + error.message);
    
    // Remover indicador de carga si existe
    const loadingIndicator = output.querySelector('.youtube-metadata-loading');
    if (loadingIndicator) {
      loadingIndicator.remove();
    }

    throw error;
  }
}

// FunciÃƒÂ³n para mostrar los resultados de metadata de YouTube
function showYouTubeMetadataResults(metadata, topic) {
  console.log("Ã°Å¸â€œÂº Mostrando resultados de metadata de YouTube");

  const metadataContainer = document.createElement('div');
  metadataContainer.className = 'youtube-metadata-container';
  
  // Procesar el texto de metadata para separar secciones
  const sections = parseMetadata(metadata);
  
  metadataContainer.innerHTML = `
    <div class="youtube-metadata-panel collapsed">
      <div class="youtube-metadata-header" onclick="toggleMainMetadataPanel(this)">
        <h3>
          <i class="fas fa-youtube"></i> Metadata para YouTube
          <span class="metadata-topic-inline">- ${topic}</span>
        </h3>
        <i class="fas fa-chevron-right main-toggle-icon"></i>
      </div>
      
      <div class="youtube-metadata-content">
        <div class="metadata-section collapsible">
          <div class="section-header" onclick="toggleMetadataSection(this)">
            <h3><i class="fas fa-fire"></i> TÃƒÂ­tulos Clickbait</h3>
            <i class="fas fa-chevron-down toggle-icon"></i>
          </div>
        <div class="section-content">
          <div class="titles-list">
            ${sections.titles.map(title => `
              <div class="title-item">
                <span class="title-text">${title}</span>
                <button class="copy-btn" onclick="copyToClipboard('${title.replace(/'/g, "\\'")}')">
                  <i class="fas fa-copy"></i>
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      
      <div class="metadata-section collapsible">
        <div class="section-header" onclick="toggleMetadataSection(this)">
          <h3><i class="fas fa-file-text"></i> DescripciÃƒÂ³n SEO</h3>
          <i class="fas fa-chevron-down toggle-icon"></i>
        </div>
        <div class="section-content">
          <div class="description-container">
            <textarea class="description-text" readonly>${sections.description}</textarea>
            <button class="copy-btn-large" onclick="copyToClipboard(\`${sections.description.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">
              <i class="fas fa-copy"></i> Copiar DescripciÃƒÂ³n
            </button>
          </div>
      </div>
    </div>
    
    <div class="metadata-section collapsible">
      <div class="section-header" onclick="toggleMetadataSection(this)">
        <h3><i class="fas fa-tags"></i> Etiquetas (25)</h3>
        <i class="fas fa-chevron-down toggle-icon"></i>
      </div>
      <div class="section-content">
        <div class="tags-container">
          <div class="tags-display">
            ${sections.tags.map(tag => `<span class="tag-item">${tag}</span>`).join('')}
          </div>
          <button class="copy-btn-large" onclick="copyToClipboard('${sections.tagsString.replace(/'/g, "\\'")}')">
            <i class="fas fa-copy"></i> Copiar Etiquetas
          </button>
        </div>
      </div>
    </div>
    
    <div class="metadata-section collapsible">
      <div class="section-header" onclick="toggleMetadataSection(this)">
        <h3><i class="fas fa-image"></i> Prompts para Miniaturas (5)</h3>
        <i class="fas fa-chevron-down toggle-icon"></i>
      </div>
      <div class="section-content">
        <div class="thumbnails-container">
          <p class="thumbnails-description">
            <i class="fas fa-info-circle"></i> 
            Usa estos prompts para generar miniaturas llamativas en herramientas de IA como DALL-E, Midjourney o Stable Diffusion
          </p>
          <div class="thumbnails-list">
            ${sections.thumbnailPrompts.map((prompt, index) => `
              <div class="thumbnail-item">
                <div class="thumbnail-number">${index + 1}</div>
                <div class="thumbnail-content">
                  <span class="thumbnail-text">${prompt}</span>
                  <button class="copy-btn" onclick="copyToClipboard('${prompt.replace(/'/g, "\\'")}')">
                    <i class="fas fa-copy"></i>
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
          <button class="copy-btn-large" onclick="copyAllThumbnailPrompts(${JSON.stringify(sections.thumbnailPrompts).replace(/"/g, '&quot;')})">
            <i class="fas fa-copy"></i> Copiar Todos los Prompts
          </button>
        </div>
      </div>
    </div>
    
    <div class="metadata-actions">
      <button class="btn btn-primary" onclick="downloadYouTubeMetadata('${topic}', \`${metadata.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">
        <i class="fas fa-download"></i> Descargar Metadata
      </button>
    </div>
    </div>
  `;
  
  output.appendChild(metadataContainer);
  
  // Ajustar altura del textarea de descripciÃƒÂ³n al contenido
  const descriptionTextarea = metadataContainer.querySelector('.description-text');
  if (descriptionTextarea) {
    // FunciÃƒÂ³n para ajustar altura automÃƒÂ¡ticamente
    function adjustTextareaHeight(textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = (textarea.scrollHeight + 10) + 'px';
    }
    
    // Ajustar inmediatamente
    setTimeout(() => adjustTextareaHeight(descriptionTextarea), 50);
  }
  
  // Inicializar secciones como colapsadas excepto la primera
  initializeCollapsedSections();
  
  // Inicializar panel principal como colapsado por defecto
  const mainPanel = output.querySelector('.youtube-metadata-panel');
  if (mainPanel) {
    mainPanel.classList.add('collapsed');
    const mainIcon = mainPanel.querySelector('.main-toggle-icon');
    if (mainIcon) {
      mainIcon.classList.remove('fa-chevron-down');
      mainIcon.classList.add('fa-chevron-right');
    }
  }
  
  // Ã°Å¸Å½Â¬ MOSTRAR BOTÃƒâ€œN DE GENERACIÃƒâ€œN DE VIDEO DESPUÃƒâ€°S DE METADATOS
  // Solo mostrar si no se ha habilitado la generaciÃƒÂ³n automÃƒÂ¡tica
  if (!shouldGenerateVideoAutomatically()) {
    showVideoGenerationButton();
  }
  
  // Scroll suave hacia el nuevo contenido
  setTimeout(() => {
    metadataContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// FunciÃ³n para parsear la metadata y extraer secciones
function parseMetadata(metadata) {
  const lines = metadata.split('\n');
  let currentSection = '';
  let titles = [];
  let description = '';
  let tags = [];
  let thumbnailPrompts = [];
  
  // Helper to normalize text for comparison (remove accents)
  const normalize = (text) => {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  };

  for (let line of lines) {
    line = line.trim();
    const upperLine = line.toUpperCase();
    const normalizedLine = normalize(line);
    
    if (
      normalizedLine.includes('TITULOS CLICKBAIT') ||
      upperLine.includes('CLICKBAIT TITLES')
    ) {
      currentSection = 'titles';
      continue;
    } else if (
      normalizedLine.includes('DESCRIPCION') ||
      upperLine.includes('DESCRIPTION')
    ) {
      currentSection = 'description';
      continue;
    } else if (
      normalizedLine.includes('ETIQUETAS') ||
      upperLine.includes('TAGS')
    ) {
      currentSection = 'tags';
      continue;
    } else if (
      normalizedLine.includes('PROMPTS PARA MINIATURAS') ||
      normalizedLine.includes('MINIATURA') ||
      upperLine.includes('THUMBNAIL PROMPTS') ||
      upperLine.includes('PROMPTS FOR YOUTUBE THUMBNAILS')
    ) {
      currentSection = 'thumbnails';
      continue;
    }
    
    if (currentSection === 'titles' && line && !line.startsWith('**')) {
      // Remover numeraciÃ³n al inicio (1., 2., etc.)
      const cleanTitle = line.replace(/^\d+\.\s*/, '');
      if (cleanTitle) {
        titles.push(cleanTitle);
      }
    } else if (currentSection === 'description' && line && !line.startsWith('**')) {
      description += line + '\n';
    } else if (currentSection === 'tags' && line && !line.startsWith('**')) {
      // Separar por comas y limpiar
      const lineTags = line.split(',').map(tag => tag.trim()).filter(tag => tag);
      tags.push(...lineTags);
    } else if (currentSection === 'thumbnails' && line && !line.startsWith('**')) {
      // Remover numeraciÃ³n al inicio (1., 2., etc.)
      const cleanPrompt = line.replace(/^\d+\.\s*/, '');
      if (cleanPrompt) {
        thumbnailPrompts.push(cleanPrompt);
      }
    }
  }
  
  const tagsString = tags.join(', ');
  
  return {
    titles: titles.slice(0, 10), // MÃ¡ximo 10 tÃ­tulos
    description: description.trim(),
    tags: tags.slice(0, 25), // MÃ¡ximo 25 etiquetas
    tagsString: tagsString,
    thumbnailPrompts: thumbnailPrompts.slice(0, 5) // MÃ¡ximo 5 prompts
  };
}

// FunciÃƒÂ³n para copiar al portapapeles
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    // Mostrar confirmaciÃƒÂ³n visual
    const event = new CustomEvent('showToast', {
      detail: { message: 'Copiado al portapapeles', type: 'success' }
    });
    document.dispatchEvent(event);
  }).catch(err => {
    console.error('Error copiando al portapapeles:', err);
    // Fallback para navegadores mÃƒÂ¡s antiguos
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  });
}

// FunciÃƒÂ³n para copiar todos los prompts de miniaturas
function copyAllThumbnailPrompts(prompts) {
  const allPrompts = prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join('\n\n');
  copyToClipboard(allPrompts);
}

// FunciÃƒÂ³n para descargar metadata de YouTube
function downloadYouTubeMetadata(topic, metadata) {
  const filename = `youtube_metadata_${topic.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.txt`;
  downloadAsText(metadata, filename);
}

// Event listener para mostrar toasts
document.addEventListener('showToast', function(event) {
  const { message, type = 'info' } = event.detail;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fas fa-check-circle"></i>
    <span>${message}</span>
  `;
  
  document.body.appendChild(toast);
  
  // Mostrar toast
  setTimeout(() => toast.classList.add('show'), 100);
  
  // Ocultar toast despuÃƒÂ©s de 3 segundos
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => document.body.removeChild(toast), 300);
  }, 3000);
});

// FunciÃƒÂ³n para colapsar/expandir secciones de metadata
function toggleMetadataSection(headerElement) {
  const section = headerElement.parentElement;
  const content = section.querySelector('.section-content');
  const icon = headerElement.querySelector('.toggle-icon');
  
  // Toggle la clase collapsed
  section.classList.toggle('collapsed');
  
  // Cambiar el icono
  if (section.classList.contains('collapsed')) {
    icon.classList.remove('fa-chevron-down');
    icon.classList.add('fa-chevron-right');
    content.style.maxHeight = '0';
    content.style.opacity = '0';
  } else {
    icon.classList.remove('fa-chevron-right');
    icon.classList.add('fa-chevron-down');
    content.style.maxHeight = content.scrollHeight + 'px';
    content.style.opacity = '1';
  }
}

// FunciÃƒÂ³n para inicializar secciones colapsadas
function initializeCollapsedSections() {
  const sections = document.querySelectorAll('.metadata-section.collapsible');
  sections.forEach((section) => {
    // Colapsar TODAS las secciones cuando el panel principal inicia colapsado
    section.classList.add('collapsed');
    const content = section.querySelector('.section-content');
    const icon = section.querySelector('.toggle-icon');
    
    if (content && icon) {
      icon.classList.remove('fa-chevron-down');
      icon.classList.add('fa-chevron-right');
      content.style.maxHeight = '0';
      content.style.opacity = '0';
    }
  });
}

// FunciÃƒÂ³n para colapsar/expandir el panel principal de metadata
function toggleMainMetadataPanel(headerElement) {
  const panel = headerElement.parentElement;
  const content = panel.querySelector('.youtube-metadata-content');
  const icon = headerElement.querySelector('.main-toggle-icon');
  
  // Toggle la clase collapsed
  panel.classList.toggle('collapsed');
  
  // Cambiar el icono
  if (panel.classList.contains('collapsed')) {
    icon.classList.remove('fa-chevron-down');
    icon.classList.add('fa-chevron-right');
  } else {
    icon.classList.remove('fa-chevron-right');
    icon.classList.add('fa-chevron-down');
    
    // Ya no expandir automÃƒÂ¡ticamente la primera secciÃƒÂ³n
    // El usuario puede expandir manualmente la secciÃƒÂ³n que desee
  }
}

// ==========================================
// SISTEMA DE ESTILOS DE MINIATURAS
// ==========================================

// FunciÃ³n para inicializar sistema de estilos de miniatura
function initThumbnailStyles() {
  console.log('ðŸ–¼ï¸ Inicializando sistema de estilos de miniatura...');
  
  try {
    loadThumbnailStyles();
    // Selector se actualiza al cargar los estilos
    
    setTimeout(() => {
      setupThumbnailStyleModalEvents();
      setupManageThumbnailStylesEvents(); // Reactivado y arreglado
      setupEditThumbnailStyleEvents();
      console.log('âœ… Sistema de estilos de miniatura inicializado correctamente');
    }, 100);
  } catch (error) {
    console.error('âŒ Error inicializando estilos de miniatura:', error);
  }
}

// FunciÃ³n para cargar estilos de miniatura desde servidor
async function loadThumbnailStyles() {
  try {
    const response = await fetch('/api/custom-styles');
    if (!response.ok) throw new Error('Error al obtener estilos');
    
    const data = await response.json();
    if (data.thumbnailStyles) {
      customThumbnailStyles = data.thumbnailStyles;
      console.log('ðŸ–¼ï¸ Estilos de miniatura cargados:', customThumbnailStyles);
    } else {
      customThumbnailStyles = [];
      console.log('ðŸ–¼ï¸ No hay estilos de miniatura guardados');
    }
  } catch (error) {
    console.error('âŒ Error cargando estilos de miniatura:', error);
    customThumbnailStyles = [];
  }
  updateThumbnailStyleSelector();
}

// FunciÃ³n para guardar estilos de miniatura en servidor
async function saveThumbnailStyles() {
  try {
      const response = await fetch('/api/custom-styles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ thumbnailStyles: customThumbnailStyles })
      });
      if (!response.ok) throw new Error('Error al guardar');
    console.log('ðŸ’¾ Estilos de miniatura guardados exitosamente');
  } catch (error) {
    console.error('âŒ Error guardando estilos de miniatura:', error);
    alert('Error al guardar estilos en el servidor');
  }
}

// FunciÃƒÂ³n para actualizar el selector de estilos de miniatura
function updateThumbnailStyleSelector() {
  const thumbnailStyleSelect = document.getElementById('thumbnailStyleSelect');
  if (!thumbnailStyleSelect) {
    console.error('Ã¢ÂÅ’ Selector de estilos de miniatura no encontrado');
    return;
  }

  // Limpiar opciones existentes
  thumbnailStyleSelect.innerHTML = '';

  // Agregar estilos predeterminados
  Object.keys(defaultThumbnailStyles).forEach(key => {
    const style = defaultThumbnailStyles[key];
    const option = document.createElement('option');
    option.value = key;
    option.textContent = style.name;
    thumbnailStyleSelect.appendChild(option);
  });

  // Agregar estilos personalizados
  customThumbnailStyles.forEach(style => {
    const option = document.createElement('option');
    option.value = `custom_${style.id}`;
    option.textContent = `${style.name} (Personalizado)`;
    thumbnailStyleSelect.appendChild(option);
  });

  console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Selector de estilos de miniatura actualizado');
}

// FunciÃƒÂ³n para obtener instrucciones de estilo de miniatura
function getThumbnailStyleInstructions(styleId) {
  if (styleId.startsWith('custom_')) {
    const customId = styleId.replace('custom_', '');
    const customStyle = customThumbnailStyles.find(style => style.id === customId);
    if (customStyle) {
      return customStyle.instructions;
    }
  } else if (defaultThumbnailStyles[styleId]) {
    return defaultThumbnailStyles[styleId].instructions;
  }
  
  // Fallback al estilo predeterminado
  return defaultThumbnailStyles.default.instructions;
}

// FunciÃƒÂ³n para configurar eventos del modal de crear estilo de miniatura
function setupThumbnailStyleModalEvents() {
  console.log('Ã°Å¸â€Â§ Configurando eventos del modal de crear estilo de miniatura...');
  
  try {
    const thumbnailStyleModal = document.getElementById('thumbnailStyleModal');
    const closeModalBtn = document.getElementById('closeThumbnailStyleModal');
    const cancelBtn = document.getElementById('cancelThumbnailStyleBtn');
    const saveBtn = document.getElementById('saveThumbnailStyleBtn');
    
    // Botones de la sidebar
    const createFromSidebarBtn = document.getElementById('createThumbnailStyleFromSidebar');
    
    console.log('Ã°Å¸â€Â Elementos encontrados:', {
      thumbnailStyleModal: !!thumbnailStyleModal,
      closeModalBtn: !!closeModalBtn,
      cancelBtn: !!cancelBtn,
      saveBtn: !!saveBtn,
      createFromSidebarBtn: !!createFromSidebarBtn
    });
    
    if (!thumbnailStyleModal || !closeModalBtn || !cancelBtn || !saveBtn) {
      console.error('Ã¢ÂÅ’ Algunos elementos del modal de miniatura no fueron encontrados');
      return;
    }
    
    // FunciÃƒÂ³n para cerrar modal
    function closeModal() {
      console.log('Ã°Å¸â€â€™ Cerrando modal de crear miniatura...');
      thumbnailStyleModal.style.display = 'none';
      document.body.style.overflow = 'auto';
      // Solo limpiar si se cierra sin guardar exitosamente
    }
    
    // Eventos de cerrar
    closeModalBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    
    // Evento de guardar (sin duplicados)
    if (saveBtn) {
      // Quitar event listeners previos
      saveBtn.removeEventListener('click', saveThumbnailStyle);
      saveBtn.onclick = null;
      
      // Agregar nuevo event listener
      saveBtn.addEventListener('click', saveThumbnailStyle);
      console.log('Ã¢Å“â€¦ Event listener del botÃƒÂ³n guardar configurado');
    } else {
      console.error('Ã¢ÂÅ’ BotÃƒÂ³n guardar no encontrado');
    }
    
    // Evento para abrir desde sidebar
    if (createFromSidebarBtn) {
      createFromSidebarBtn.addEventListener('click', () => {
        console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Abriendo modal desde sidebar...');
        openThumbnailStyleModal();
      });
      console.log('Ã¢Å“â€¦ Event listener configurado para botÃƒÂ³n crear desde sidebar');
    } else {
      console.error('Ã¢ÂÅ’ BotÃƒÂ³n crear desde sidebar no encontrado');
    }
    
    // Cerrar al hacer clic fuera del modal
    thumbnailStyleModal.addEventListener('click', (e) => {
      if (e.target === thumbnailStyleModal) {
        closeModal();
      }
    });
    
    console.log('Ã¢Å“â€¦ Eventos del modal de miniatura configurados correctamente');
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error configurando eventos del modal de miniatura:', error);
  }
}

// FunciÃƒÂ³n para abrir modal de crear estilo de miniatura
function openThumbnailStyleModal() {
  console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Abriendo modal de crear estilo de miniatura...');
  
  try {
    const thumbnailStyleModal = document.getElementById('thumbnailStyleModal');
    if (thumbnailStyleModal) {
      // Solo limpiar si estÃƒÂ¡ cerrado para evitar interferir mientras se escribe
      if (thumbnailStyleModal.style.display !== 'flex') {
        clearThumbnailModalForm();
      }
      
      thumbnailStyleModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      console.log('Ã¢Å“â€¦ Modal de crear estilo de miniatura abierto');
      
      // Enfocar el primer campo
      setTimeout(() => {
        const nameField = document.getElementById('thumbnailStyleName');
        if (nameField) {
          nameField.focus();
        }
      }, 100);
    } else {
      console.error('Ã¢ÂÅ’ Modal de crear estilo de miniatura no encontrado');
    }
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error abriendo modal de crear miniatura:', error);
  }
}

// FunciÃƒÂ³n para limpiar formulario del modal
function clearThumbnailModalForm() {
  document.getElementById('thumbnailStyleName').value = '';
  document.getElementById('thumbnailStyleDescription').value = '';
  document.getElementById('thumbnailPrimaryColor').value = '';
  document.getElementById('thumbnailSecondaryColor').value = '';
  document.getElementById('thumbnailInstructions').value = '';
}

// FunciÃƒÂ³n para guardar nuevo estilo de miniatura
function saveThumbnailStyle() {
  console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Intentando guardar estilo de miniatura...');
  
  try {
    const name = document.getElementById('thumbnailStyleName').value.trim();
    const description = document.getElementById('thumbnailStyleDescription').value.trim();
    const primaryColor = document.getElementById('thumbnailPrimaryColor').value.trim();
    const secondaryColor = document.getElementById('thumbnailSecondaryColor').value.trim();
    const instructions = document.getElementById('thumbnailInstructions').value.trim();
    
    console.log('Ã°Å¸â€œÂ Valores del formulario:', {
      name, description, primaryColor, secondaryColor, instructions
    });
    
    if (!name || !description || !primaryColor || !secondaryColor || !instructions) {
      console.warn('Ã¢Å¡Â Ã¯Â¸Â Campos incompletos');
      alert('Por favor, completa todos los campos');
      return;
    }
    
    const newStyle = {
      id: Date.now().toString(),
      name: name,
      description: description,
      primaryColor: primaryColor,
      secondaryColor: secondaryColor,
      instructions: instructions,
      createdAt: new Date().toISOString()
    };
    
    console.log('Ã°Å¸â€™Â¾ Guardando nuevo estilo:', newStyle);
    
    customThumbnailStyles.push(newStyle);
    saveThumbnailStyles();
    updateThumbnailStyleSelector();
    
    console.log('Ã¢Å“â€¦ Estilo agregado al array, cerrando modal...');
    
    // Cerrar modal
    const modal = document.getElementById('thumbnailStyleModal');
    if (modal) {
      modal.style.display = 'none';
      document.body.style.overflow = 'auto';
      clearThumbnailModalForm();
      console.log('Ã¢Å“â€¦ Modal cerrado');
    } else {
      console.error('Ã¢ÂÅ’ Modal no encontrado');
    }
    
    console.log('Ã¢Å“â€¦ Estilo de miniatura guardado:', newStyle);
    
    // Mostrar mensaje de ÃƒÂ©xito
    try {
      showNotification('Ã¢Å“â€¦ Estilo de miniatura creado exitosamente', 'success');
      console.log('Ã¢Å“â€¦ NotificaciÃƒÂ³n mostrada');
    } catch (notifError) {
      console.error('Ã¢ÂÅ’ Error mostrando notificaciÃƒÂ³n:', notifError);
    }
    
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error en saveThumbnailStyle:', error);
    alert('Error guardando el estilo: ' + error.message);
  }
}

// FunciÃƒÂ³n para configurar eventos del modal de gestionar estilos
function setupManageThumbnailStylesEvents() {
  console.log('Ã°Å¸â€Â§ Configurando eventos del modal de gestionar estilos de miniatura...');
  
  try {
    const manageThumbnailStylesModal = document.getElementById('manageThumbnailStylesModal');
    const closeManageBtn = document.getElementById('closeManageThumbnailStylesModal');
    const closeManageFooterBtn = document.getElementById('closeManageThumbnailStylesBtn');
    
    console.log('Ã°Å¸â€Â Elementos de gestiÃƒÂ³n encontrados:', {
      manageThumbnailStylesModal: !!manageThumbnailStylesModal,
      closeManageBtn: !!closeManageBtn,
      closeManageFooterBtn: !!closeManageFooterBtn
    });
    
    // FunciÃƒÂ³n para cerrar el modal
    function closeManageModal() {
      console.log('Ã¯Â¿Â½ Cerrando modal de gestionar miniaturas...');
      if (manageThumbnailStylesModal) {
        manageThumbnailStylesModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        console.log('Ã¢Å“â€¦ Modal de gestiÃƒÂ³n cerrado');
      }
    }
    
    // NO configurar el botÃƒÂ³n de abrir aquÃƒÂ­ (se hace manualmente)
    // Solo configurar los botones de cerrar
    
    if (closeManageBtn) {
      closeManageBtn.addEventListener('click', closeManageModal);
      console.log('Ã¢Å“â€¦ BotÃƒÂ³n X de cerrar configurado');
    } else {
      console.error('Ã¢ÂÅ’ BotÃƒÂ³n X de cerrar no encontrado');
    }
    
    if (closeManageFooterBtn) {
      closeManageFooterBtn.addEventListener('click', closeManageModal);
      console.log('Ã¢Å“â€¦ BotÃƒÂ³n Cerrar del footer configurado');
    } else {
      console.error('Ã¢ÂÅ’ BotÃƒÂ³n Cerrar del footer no encontrado');
    }
    
    if (manageThumbnailStylesModal) {
      manageThumbnailStylesModal.addEventListener('click', (e) => {
        if (e.target === manageThumbnailStylesModal) {
          closeManageModal();
        }
      });
      console.log('Ã¢Å“â€¦ Evento de clic fuera del modal configurado');
    }
    
    console.log('Ã¢Å“â€¦ Eventos de gestiÃƒÂ³n de miniatura configurados correctamente');
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error configurando eventos de gestiÃƒÂ³n de miniatura:', error);
  }
}

// FunciÃƒÂ³n para abrir modal de gestionar estilos de miniatura
function openManageThumbnailStylesModal() {
  console.log('Ã°Å¸â€Â§ Abriendo modal de gestionar estilos de miniatura...');
  
  try {
    const manageThumbnailStylesModal = document.getElementById('manageThumbnailStylesModal');
    if (manageThumbnailStylesModal) {
      console.log('Ã¢Å“â€¦ Modal de gestiÃƒÂ³n encontrado, cargando lista...');
      loadThumbnailStylesList();
      manageThumbnailStylesModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      console.log('Ã¢Å“â€¦ Modal de gestiÃƒÂ³n abierto');
    } else {
      console.error('Ã¢ÂÅ’ Modal de gestiÃƒÂ³n no encontrado');
    }
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error abriendo modal de gestiÃƒÂ³n:', error);
  }
}

// FunciÃƒÂ³n para cargar lista de estilos de miniatura
function loadThumbnailStylesList() {
  console.log('Ã°Å¸â€œâ€¹ Cargando lista de estilos de miniatura...');
  console.log('Ã°Å¸â€œÅ  Estilos disponibles:', customThumbnailStyles);
  
  try {
    const thumbnailStylesList = document.getElementById('thumbnailStylesList');
    const noThumbnailStylesMessage = document.getElementById('noThumbnailStylesMessage');
    
    console.log('Ã°Å¸â€Â Elementos encontrados:', {
      thumbnailStylesList: !!thumbnailStylesList,
      noThumbnailStylesMessage: !!noThumbnailStylesMessage
    });
    
    if (!thumbnailStylesList || !noThumbnailStylesMessage) {
      console.error('Ã¢ÂÅ’ Elementos de lista no encontrados');
      return;
    }
    
    thumbnailStylesList.innerHTML = '';
    
    if (customThumbnailStyles.length === 0) {
      console.log('Ã°Å¸â€œÂ No hay estilos personalizados, mostrando mensaje');
      noThumbnailStylesMessage.style.display = 'block';
      thumbnailStylesList.style.display = 'none';
    } else {
      console.log(`Ã°Å¸â€œÂ Mostrando ${customThumbnailStyles.length} estilos personalizados`);
      noThumbnailStylesMessage.style.display = 'none';
      thumbnailStylesList.style.display = 'block';
    
    customThumbnailStyles.forEach(style => {
      const styleItem = document.createElement('div');
      styleItem.className = 'thumbnail-style-item';
      styleItem.innerHTML = `
        <div class="thumbnail-style-header">
          <div class="thumbnail-style-info">
            <h4 class="thumbnail-style-name">${style.name}</h4>
            <p class="thumbnail-style-description">${style.description}</p>
            <div class="style-colors">
              <span class="color-info">Principal: ${style.primaryColor}</span>
              <span class="color-info">Secundario: ${style.secondaryColor}</span>
            </div>
          </div>
          <div class="thumbnail-style-actions">
            <button class="edit-style-btn" data-style-id="${style.id}">
              <i class="fas fa-edit"></i>
              Editar
            </button>
            <button class="delete-style-btn" data-style-id="${style.id}">
              <i class="fas fa-trash"></i>
              Eliminar
            </button>
          </div>
        </div>
      `;
      thumbnailStylesList.appendChild(styleItem);
    });
    
    // Agregar eventos a los botones
    thumbnailStylesList.querySelectorAll('.edit-style-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const styleId = e.target.closest('.edit-style-btn').dataset.styleId;
        editThumbnailStyle(styleId);
      });
    });
    
    thumbnailStylesList.querySelectorAll('.delete-style-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const styleId = e.target.closest('.delete-style-btn').dataset.styleId;
        deleteThumbnailStyle(styleId);
      });
    });
    }
    
    console.log('Ã¢Å“â€¦ Lista de estilos cargada correctamente');
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error cargando lista de estilos:', error);
  }
}

// FunciÃƒÂ³n para eliminar estilo de miniatura
function deleteThumbnailStyle(styleId) {
  if (confirm('Ã‚Â¿EstÃƒÂ¡s seguro de que quieres eliminar este estilo de miniatura?')) {
    customThumbnailStyles = customThumbnailStyles.filter(style => style.id !== styleId);
    saveThumbnailStyles();
    updateThumbnailStyleSelector();
    loadThumbnailStylesList();
    showNotification('Ã¢Å“â€¦ Estilo de miniatura eliminado', 'success');
  }
}

// FunciÃƒÂ³n para editar estilo de miniatura
function editThumbnailStyle(styleId) {
  const style = customThumbnailStyles.find(s => s.id === styleId);
  if (!style) return;
  
  currentEditingThumbnailStyleId = styleId;
  
  // Llenar formulario de ediciÃƒÂ³n
  document.getElementById('editThumbnailStyleName').value = style.name;
  document.getElementById('editThumbnailStyleDescription').value = style.description;
  document.getElementById('editThumbnailPrimaryColor').value = style.primaryColor;
  document.getElementById('editThumbnailSecondaryColor').value = style.secondaryColor;
  document.getElementById('editThumbnailInstructions').value = style.instructions;
  
  // Cerrar modal de gestionar y abrir modal de editar
  document.getElementById('manageThumbnailStylesModal').style.display = 'none';
  document.getElementById('editThumbnailStyleModal').style.display = 'flex';
}

// FunciÃƒÂ³n para configurar eventos del modal de editar
function setupEditThumbnailStyleEvents() {
  const editModal = document.getElementById('editThumbnailStyleModal');
  const closeBtn = document.getElementById('closeEditThumbnailStyleModal');
  const cancelBtn = document.getElementById('cancelEditThumbnailStyleBtn');
  const saveBtn = document.getElementById('saveEditThumbnailStyleBtn');
  
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      editModal.style.display = 'none';
      document.body.style.overflow = 'auto';
    });
  }
  
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      editModal.style.display = 'none';
      document.body.style.overflow = 'auto';
    });
  }
  
  if (saveBtn) {
    saveBtn.addEventListener('click', saveEditThumbnailStyle);
  }
  
  if (editModal) {
    editModal.addEventListener('click', (e) => {
      if (e.target === editModal) {
        editModal.style.display = 'none';
        document.body.style.overflow = 'auto';
      }
    });
  }
}

// FunciÃƒÂ³n para guardar cambios en estilo editado
function saveEditThumbnailStyle() {
  if (!currentEditingThumbnailStyleId) return;
  
  const name = document.getElementById('editThumbnailStyleName').value.trim();
  const description = document.getElementById('editThumbnailStyleDescription').value.trim();
  const primaryColor = document.getElementById('editThumbnailPrimaryColor').value.trim();
  const secondaryColor = document.getElementById('editThumbnailSecondaryColor').value.trim();
  const instructions = document.getElementById('editThumbnailInstructions').value.trim();
  
  if (!name || !description || !primaryColor || !secondaryColor || !instructions) {
    alert('Por favor, completa todos los campos');
    return;
  }
  
  const styleIndex = customThumbnailStyles.findIndex(s => s.id === currentEditingThumbnailStyleId);
  if (styleIndex !== -1) {
    customThumbnailStyles[styleIndex] = {
      ...customThumbnailStyles[styleIndex],
      name,
      description,
      primaryColor,
      secondaryColor,
      instructions
    };
    
    saveThumbnailStyles();
    updateThumbnailStyleSelector();
    
    document.getElementById('editThumbnailStyleModal').style.display = 'none';
    document.body.style.overflow = 'auto';
    
    showNotification('Ã¢Å“â€¦ Estilo de miniatura actualizado', 'success');
    currentEditingThumbnailStyleId = null;
  }
}

// FunciÃƒÂ³n para obtener datos del estilo de miniatura seleccionado
function getThumbnailStyleData() {
  const thumbnailStyleSelect = document.getElementById('thumbnailStyleSelect');
  if (!thumbnailStyleSelect) {
    console.log('Ã°Å¸â€Â DEBUG - thumbnailStyleSelect no encontrado, usando default');
    return 'default';
  }
  
  const selectedValue = thumbnailStyleSelect.value;
  console.log('Ã°Å¸â€Â DEBUG - selectedValue del selector:', selectedValue);
  
  // Si es un estilo personalizado
  if (selectedValue.startsWith('custom_')) {
    const customId = selectedValue.replace('custom_', '');
    const customStyle = customThumbnailStyles.find(style => style.id === customId);
    if (customStyle) {
      const result = {
        instructions: customStyle.instructions,
        primaryColor: customStyle.primaryColor,
        secondaryColor: customStyle.secondaryColor,
        type: 'custom',
        name: customStyle.name
      };
      console.log('Ã°Å¸â€Â DEBUG - Enviando estilo personalizado completo:', result);
      return result;
    }
  }
  
  // Estilo predeterminado
  console.log('Ã°Å¸â€Â DEBUG - Enviando estilo predeterminado:', selectedValue);
  return selectedValue;
}

// FALLBACK PARA SIDEBAR - Se ejecuta despuÃƒÂ©s de que todo estÃƒÂ© cargado
setTimeout(function() {
  console.log('Ã°Å¸â€â€ž FALLBACK: Verificando configuraciÃƒÂ³n del sidebar...');
  
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.getElementById('sidebar');
  
  if (menuToggleBtn && sidebar) {
    console.log('Ã¢Å“â€¦ Elementos del sidebar encontrados - onclick ya configurado en HTML');
  } else {
    console.error('Ã¢ÂÅ’ FALLBACK: Elementos del sidebar no encontrados');
    console.error('menuToggleBtn:', menuToggleBtn);
    console.error('sidebar:', sidebar);
  }
}, 3000);

// ================================
// SISTEMA DE PROYECTOS
// ================================

// Inicializar sistema de proyectos
document.addEventListener('DOMContentLoaded', function() {
  console.log('Ã°Å¸Å¡â‚¬ DOM cargado, inicializando sistema de proyectos...');
  initializeProjectSystem();
});

// Fallback con delay para asegurar que se inicialice
setTimeout(function() {
  console.log('Ã°Å¸â€â€ž Inicializador de respaldo ejecutÃƒÂ¡ndose...');
  const saveBtn = document.getElementById('saveProjectBtn');
  const loadBtn = document.getElementById('loadProjectBtn');
  const manageBtn = document.getElementById('manageProjectsBtn');
  
  if (saveBtn && !saveBtn.onclick && !saveBtn.hasAttribute('data-initialized')) {
    console.log('Ã°Å¸â€Â§ Configurando eventos de respaldo...');
    
    saveBtn.addEventListener('click', function(e) {
      console.log('Ã°Å¸â€™Â¾ RESPALDO: Click en Guardar Proyecto');
      e.preventDefault();
      saveCurrentProject();
    });
    saveBtn.setAttribute('data-initialized', 'true');
    
    if (loadBtn) {
      loadBtn.addEventListener('click', function(e) {
        console.log('Ã°Å¸â€œâ€š RESPALDO: Click en Cargar Proyecto');
        e.preventDefault();
        showLoadProjectModal();
      });
      loadBtn.setAttribute('data-initialized', 'true');
    }
    
    if (manageBtn) {
      manageBtn.addEventListener('click', function(e) {
        console.log('Ã°Å¸â€Â§ RESPALDO: Click en Gestionar Proyectos');
        e.preventDefault();
        showManageProjectsModal();
      });
      manageBtn.setAttribute('data-initialized', 'true');
    }
    
    console.log('Ã¢Å“â€¦ Eventos de respaldo configurados');
  } else {
    console.log('Ã¢â€žÂ¹Ã¯Â¸Â Eventos ya configurados o elementos no encontrados');
  }
}, 2000);

function initializeProjectSystem() {
  console.log('Ã°Å¸â€Â§ Inicializando sistema de proyectos...');
  
  const saveProjectBtn = document.getElementById('saveProjectBtn');
  const loadProjectBtn = document.getElementById('loadProjectBtn');
  const manageProjectsBtn = document.getElementById('manageProjectsBtn');

  console.log('Ã°Å¸â€Â Elementos encontrados:', {
    saveProjectBtn: !!saveProjectBtn,
    loadProjectBtn: !!loadProjectBtn,
    manageProjectsBtn: !!manageProjectsBtn
  });

  if (saveProjectBtn) {
    console.log('Ã¢Å“â€¦ Configurando evento para saveProjectBtn');
    saveProjectBtn.addEventListener('click', function(e) {
      console.log('Ã°Å¸â€“Â±Ã¯Â¸Â Click en Guardar Proyecto');
      e.preventDefault();
      saveCurrentProject();
    });
  } else {
    console.error('Ã¢ÂÅ’ No se encontrÃƒÂ³ saveProjectBtn');
  }
  
  if (loadProjectBtn) {
    console.log('Ã¢Å“â€¦ Configurando evento para loadProjectBtn');
    loadProjectBtn.addEventListener('click', function(e) {
      console.log('Ã°Å¸â€“Â±Ã¯Â¸Â Click en Cargar Proyecto');
      e.preventDefault();
      showLoadProjectModal();
    });
  } else {
    console.error('Ã¢ÂÅ’ No se encontrÃƒÂ³ loadProjectBtn');
  }
  
  if (manageProjectsBtn) {
    console.log('Ã¢Å“â€¦ Configurando evento para manageProjectsBtn');
    manageProjectsBtn.addEventListener('click', function(e) {
      console.log('Ã°Å¸â€“Â±Ã¯Â¸Â Click en Gestionar Proyectos');
      e.preventDefault();
      showManageProjectsModal();
    });
  } else {
    console.error('Ã¢ÂÅ’ No se encontrÃƒÂ³ manageProjectsBtn');
  }

  // Inicializar event listeners de modales
  initializeProjectModals();
  
  console.log('Ã¢Å“â€¦ Sistema de proyectos inicializado');
}

// FunciÃƒÂ³n para guardar el proyecto actual
async function saveCurrentProject() {
  try {
    console.log('Ã°Å¸â€™Â¾ Iniciando guardado de proyecto...');
    
    const topicElement = document.getElementById('topic');
    const folderNameElement = document.getElementById('folderName');
    const sectionsNumberElement = document.getElementById('sectionsNumber');
    
    console.log('Ã°Å¸â€Â Elementos encontrados:', {
      topic: !!topicElement,
      folderName: !!folderNameElement,
      sectionsNumber: !!sectionsNumberElement
    });
    
    if (!topicElement || !folderNameElement || !sectionsNumberElement) {
      showNotification('Ã¢Å¡Â Ã¯Â¸Â No se encontraron los elementos del formulario. AsegÃƒÂºrate de haber configurado un proyecto.', 'warning');
      return;
    }
    
    const topic = topicElement.value.trim();
    const folderName = folderNameElement.value.trim();
    const totalSections = parseInt(sectionsNumberElement.value);
    
    if (!topic) {
      showNotification('Ã¢Å¡Â Ã¯Â¸Â Ingresa un tema para guardar el proyecto', 'warning');
      return;
    }

    // El proyecto se guarda automÃƒÂ¡ticamente al generar contenido
    // Esta funciÃƒÂ³n es principalmente para mostrar confirmaciÃƒÂ³n manual
    showNotification('Ã°Å¸â€™Â¾ El proyecto se guarda automÃƒÂ¡ticamente al generar contenido', 'info');
    
    // Si hay contenido generado, refrescar la lista de proyectos
    if (currentSectionNumber > 0) {
      await refreshProjectsList();
      showNotification('Ã¢Å“â€¦ Estado del proyecto actualizado', 'success');
    }
    
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error guardando proyecto:', error);
    showNotification('Ã¢ÂÅ’ Error guardando el proyecto', 'error');
  }
}

// FunciÃƒÂ³n para mostrar modal de cargar proyecto
async function showLoadProjectModal() {
  const modal = document.getElementById('loadProjectModal');
  const container = document.getElementById('projectsListContainer');
  
  modal.style.display = 'block';
  container.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i><span>Cargando proyectos...</span></div>';
  
  try {
    console.log('Ã°Å¸â€Â Haciendo fetch a /api/projects...');
    const response = await fetch('/api/projects');
    console.log('Ã°Å¸â€œÂ¡ Respuesta recibida:', response.status, response.statusText);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Ã°Å¸â€œÅ  Datos recibidos:', data);
    
    if (data.success) {
      window.availableProjects = data.projects || [];
      console.log('Ã¢Å“â€¦ Proyectos cargados en window.availableProjects:', window.availableProjects.length);
      renderProjectsList(container, 'load');
    } else {
      console.error('Ã¢ÂÅ’ API devolviÃƒÂ³ error:', data.error);
      container.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><h3>Error cargando proyectos</h3><p>${data.error || 'No se pudieron cargar los proyectos disponibles'}</p></div>`;
    }
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error cargando proyectos:', error);
    // No usar availableProjects aquÃƒÂ­ que causa el error
    container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Error de conexiÃƒÂ³n</h3><p>Error: ${error.message}</p><p>AsegÃƒÂºrate de que el servidor estÃƒÂ© funcionando en http://localhost:3000</p></div>`;
  }
}

// FunciÃƒÂ³n para mostrar modal de gestionar proyectos
async function showManageProjectsModal() {
  const modal = document.getElementById('manageProjectsModal');
  const container = document.getElementById('manageProjectsContainer');
  
  modal.style.display = 'block';
  container.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i><span>Cargando proyectos...</span></div>';
  
  try {
    await refreshProjectsList();
    renderProjectsList(container, 'manage');
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error cargando proyectos para gestiÃƒÂ³n:', error);
    container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Error de conexiÃƒÂ³n</h3><p>No se pudo conectar con el servidor</p></div>';
  }
}

// FunciÃƒÂ³n para refrescar lista de proyectos
async function refreshProjectsList() {
  // Verificar que availableProjects estÃƒÂ© definido
  if (typeof window.availableProjects === 'undefined') {
    console.log('Ã¢Å¡Â Ã¯Â¸Â window.availableProjects no definido en refresh, inicializando...');
    window.availableProjects = [];
  }
  
  try {
    const response = await fetch('/api/projects');
    const data = await response.json();
    
    if (data.success) {
      window.availableProjects = data.projects;
      availableProjects = window.availableProjects; // Sincronizar variable local
      
      // Actualizar containers si estÃƒÂ¡n visibles
      const loadContainer = document.getElementById('projectsListContainer');
      const manageContainer = document.getElementById('manageProjectsContainer');
      
      if (loadContainer && !loadContainer.querySelector('.loading-indicator')) {
        renderProjectsList(loadContainer, 'load');
      }
      
      if (manageContainer && !manageContainer.querySelector('.loading-indicator')) {
        renderProjectsList(manageContainer, 'manage');
      }
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error refrescando proyectos:', error);
    return false;
  }
}

// FunciÃƒÂ³n para renderizar lista de proyectos
function getProjectTopicPreview(topic, maxWords = 5) {
  if (typeof topic !== 'string') {
    return '';
  }

  const words = topic.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return '';
  }

  if (words.length <= maxWords) {
    return words.join(' ');
  }

  return `${words.slice(0, maxWords).join(' ')}Ã¢â‚¬Â¦`;
}

function renderProjectsList(container, mode = 'load') {
  // Usar window.availableProjects como fuente principal
  const projectsToRender = window.availableProjects || [];
  
  if (!projectsToRender || projectsToRender.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-folder-open"></i>
        <h3>No hay proyectos guardados</h3>
        <p>Genera algunas secciones para crear tu primer proyecto</p>
      </div>
    `;
    return;
  }

  const projectsHTML = projectsToRender.map(project => {
    const progress = (project.sectionsCompleted / project.totalSections) * 100;
    const isComplete = project.sectionsCompleted >= project.totalSections;
    const isUserMarkedComplete = Boolean(window.userProjectCompletion?.[project.folderName]);
    const cardClasses = ['project-card'];
    const topicPreview = getProjectTopicPreview(project.topic, 5);

    if (isUserMarkedComplete) {
      cardClasses.push('user-complete');
    }

    return `
      <div class="${cardClasses.join(' ')}" data-project="${project.folderName}" data-user-complete="${isUserMarkedComplete}">
        <div class="project-card-header">
          <div class="project-card-title-group">
            <h3 class="project-title">${project.folderName}</h3>
            <label class="project-completion-toggle">
              <input type="checkbox" class="project-completion-checkbox" data-project-id="${project.folderName}" ${isUserMarkedComplete ? 'checked' : ''}>
              <span>${isUserMarkedComplete ? 'Marcado como completo' : 'Marcar como completo'}</span>
            </label>
          </div>
          <span class="project-status">${isComplete ? 'Completo' : 'En progreso'}</span>
        </div>
        
        <div class="project-info">
          <div class="project-info-item">
            <span class="project-info-label">Tema:</span>
            <span class="project-info-value">${topicPreview}</span>
          </div>
          <div class="project-info-item">
            <span class="project-info-label">Secciones:</span>
            <span class="project-info-value">${project.sectionsCompleted}/${project.totalSections}</span>
          </div>
          <div class="project-info-item">
            <span class="project-info-label">Estado de imÃƒÂ¡genes:</span>
            <span class="project-info-value">
              ${project.imagesPerSection ? project.imagesPerSection.map(s => 
                `<span class="status-square status-${s.status}" title="${s.section.replace('seccion_', 'SecciÃƒÂ³n ')}: ${s.images} imÃƒÂ¡genes, ${s.prompts} prompts"></span>`
              ).join('') : 'N/A'}
            </span>
          </div>
          <div class="project-info-item">
            <span class="project-info-label">Estado de audios:</span>
            <span class="project-info-value">
              <span class="status-square status-${project.audioStatus || 'red'}" title="Audios: ${project.totalAudios || 0}/${project.totalSections || 0} secciones"></span>
            </span>
          </div>
          <div class="project-info-item">
            <span class="project-info-label">ÃƒÅ¡ltima modificaciÃƒÂ³n:</span>
            <span class="project-info-value">${project.lastModifiedDate}</span>
          </div>
        </div>
        
        <div class="project-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${progress}%"></div>
          </div>
          <div class="progress-text">${Math.round(progress)}% completado</div>
        </div>
        
        <div class="project-actions">
          ${mode === 'load' ? `
            <button class="project-action-btn load-action" onclick="loadProject('${project.folderName}')">
              <i class="fas fa-folder-open"></i>
              Cargar
            </button>
          ` : `
            <button class="project-action-btn load-action" onclick="loadProject('${project.folderName}')">
              <i class="fas fa-eye"></i>
              Ver
            </button>
            <button class="project-action-btn duplicate-action" onclick="duplicateProject('${project.folderName}')">
              <i class="fas fa-copy"></i>
              Duplicar
            </button>
            <button class="project-action-btn delete-action" onclick="confirmDeleteProject('${project.folderName}', '${project.folderName}')">>
              <i class="fas fa-trash"></i>
              Eliminar
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="projects-container">${projectsHTML}</div>`;
  attachProjectCompletionHandlers(container);
  applyProjectCompletionStateToDOM(container);
}

function attachProjectCompletionHandlers(rootElement) {
  const scope = rootElement instanceof Element ? rootElement : document;
  const checkboxes = scope.querySelectorAll('.project-completion-checkbox');

  checkboxes.forEach((checkbox) => {
    if (checkbox.dataset.projectCompletionBound === 'true') {
      updateProjectCompletionCheckboxLabel(checkbox, checkbox.checked);
      return;
    }

    checkbox.dataset.projectCompletionBound = 'true';
    checkbox.addEventListener('change', handleProjectCompletionCheckboxChange);
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    updateProjectCompletionCheckboxLabel(checkbox, checkbox.checked);
  });
}

function handleProjectCompletionCheckboxChange(event) {
  event.stopPropagation();
  const checkbox = event.target;

  if (!(checkbox instanceof HTMLInputElement)) {
    return;
  }

  const folderName = checkbox.dataset.projectId;
  if (!folderName) {
    return;
  }

  const isChecked = checkbox.checked;
  setProjectCompletion(folderName, isChecked, { sourceCheckbox: checkbox });
}

function setProjectCompletion(folderName, isComplete, options = {}) {
  if (!folderName) {
    return;
  }

  const state = ensureProjectCompletionState();
  if (isComplete) {
    state[folderName] = true;
  } else {
    delete state[folderName];
  }

  saveProjectCompletionToStorage(state);
  updateProjectCompletionVisualState(folderName, isComplete, options.scope || document, options.sourceCheckbox || null);
}

function ensureProjectCompletionState() {
  if (!window.userProjectCompletion || typeof window.userProjectCompletion !== 'object') {
    window.userProjectCompletion = {};
  }
  return window.userProjectCompletion;
}

function updateProjectCompletionVisualState(folderName, isComplete, scope = document, sourceCheckbox = null) {
  const card = findProjectCardElement(folderName, scope) || findProjectCardElement(folderName, document);
  if (!card) {
    return;
  }

  const completed = Boolean(isComplete);
  card.classList.toggle('user-complete', completed);
  card.dataset.userComplete = String(completed);

  const checkbox = sourceCheckbox || card.querySelector('.project-completion-checkbox');
  if (checkbox) {
    checkbox.checked = completed;
    updateProjectCompletionCheckboxLabel(checkbox, completed);
  }
}

function updateProjectCompletionCheckboxLabel(checkbox, isComplete) {
  const label = checkbox.closest('.project-completion-toggle');
  const textElement = label ? label.querySelector('span') : null;

  if (textElement) {
    textElement.textContent = isComplete ? 'Marcado como completo' : 'Marcar como completo';
  }
}

function applyProjectCompletionStateToDOM(rootElement = document) {
  const scope = rootElement instanceof Element ? rootElement : document;
  const state = ensureProjectCompletionState();
  const cards = scope.querySelectorAll('.project-card');

  cards.forEach((card) => {
    const folderName = card.dataset.project;
    if (!folderName) {
      return;
    }

    const isComplete = Boolean(state[folderName]);
    card.classList.toggle('user-complete', isComplete);
    card.dataset.userComplete = String(isComplete);

    const checkbox = card.querySelector('.project-completion-checkbox');
    if (checkbox) {
      checkbox.checked = isComplete;
      updateProjectCompletionCheckboxLabel(checkbox, isComplete);
    }
  });
}

function findProjectCardElement(folderName, scope = document) {
  if (!scope || typeof scope.querySelectorAll !== 'function') {
    return null;
  }

  const cards = scope.querySelectorAll('.project-card');
  for (const card of cards) {
    if (card.dataset.project === folderName) {
      return card;
    }
  }
  return null;
}

function loadProjectCompletionFromStorage() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(PROJECT_COMPLETION_STORAGE_KEY);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    console.warn('Ã¢Å¡Â Ã¯Â¸Â No se pudo cargar el estado de proyectos completados:', error);
  }

  return {};
}

function saveProjectCompletionToStorage(state = {}) {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(PROJECT_COMPLETION_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Ã¢Å¡Â Ã¯Â¸Â No se pudo guardar el estado de proyectos completados:', error);
  }
}

function initializeProjectCompletionState() {
  const storedState = loadProjectCompletionFromStorage();
  if (storedState && typeof storedState === 'object') {
    window.userProjectCompletion = storedState;
  } else {
    ensureProjectCompletionState();
  }

  applyProjectCompletionStateToDOM();
}

// FunciÃƒÂ³n para inicializar el colapso del contenedor del script
function initializeScriptCollapse() {
  const scriptContainer = document.querySelector('.script-container');
  const scriptHeader = document.querySelector('.script-header');
  
  if (!scriptContainer || !scriptHeader) {
    console.warn('Script container or header not found for collapse functionality');
    return;
  }
  
  // Iniciar colapsado por defecto
  scriptContainer.classList.add('collapsed');
  
  // Agregar event listener para toggle
  scriptHeader.addEventListener('click', (e) => {
    // Evitar que el click se propague si hay elementos interactivos dentro del header
    if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) {
      return;
    }
    
    scriptContainer.classList.toggle('collapsed');
  });
}

// FunciÃƒÂ³n para cargar un proyecto
async function loadProject(folderName) {
  try {
    // Evitar cargar el mismo proyecto mÃƒÂºltiples veces
    if (window.currentProject && window.currentProject.folderName === folderName) {
      console.log(`Ã°Å¸â€â€ž Proyecto "${folderName}" ya estÃƒÂ¡ cargado, omitiendo recarga`);
      return;
    }
    
    isLoadingProject = true; // Activar bandera de carga
    isMetadataShown = false; // Resetear bandera de metadatos solo si es un proyecto diferente
    showNotification('Ã°Å¸â€œâ€š Cargando proyecto...', 'info');
    
    // Limpiar metadatos anteriores de la interfaz
    const output = document.getElementById('output');
    if (output) {
      const existingMetadataContainers = output.querySelectorAll('.youtube-metadata-container');
      existingMetadataContainers.forEach(container => container.remove());
      console.log('Ã°Å¸Â§Â¹ Metadatos anteriores limpiados de la interfaz');
    }
    
    const response = await fetch(`/api/projects/${folderName}`);
    const data = await response.json();
    
    if (data.success) {
      window.currentProject = data.project;
      window.lastGeneratedYouTubeMetadata = null;
      updateSectionClipButtons(window.currentProject);
      updateSectionImageButtons(window.currentProject);
      updateYouTubeMetadataButtonState();
      
      // Verificar y llenar formulario con datos del proyecto
      const topicElement = document.getElementById('prompt'); // Cambiado de 'topic' a 'prompt'
      const folderNameElement = document.getElementById('folderName');
      const sectionsNumberElement = document.getElementById('sectionsNumber');
      const voiceSelectElement = document.getElementById('voiceSelect');
  const imageModelSelectElement = document.getElementById('imageModelSelect');
      const llmModelSelectElement = document.getElementById('llmModelSelect');
      
      console.log('Ã°Å¸â€Â Elementos del formulario encontrados:', {
        prompt: !!topicElement, // Cambiado de topic a prompt
        folderName: !!folderNameElement,
        sectionsNumber: !!sectionsNumberElement,
        voiceSelect: !!voiceSelectElement,
        imageModelSelect: !!imageModelSelectElement,
        llmModelSelect: !!llmModelSelectElement
      });
      
      if (topicElement) {
        topicElement.value = window.currentProject.topic;
        console.log('Ã°Å¸â€œÂ Tema del guiÃƒÂ³n cargado:', window.currentProject.topic);
      } else {
        console.warn('Ã¢Å¡Â Ã¯Â¸Â Elemento prompt (tema del guiÃƒÂ³n) no encontrado');
      }
      
      if (folderNameElement) {
        folderNameElement.value = window.currentProject.folderName;
      } else {
        console.warn('Ã¢Å¡Â Ã¯Â¸Â Elemento folderName no encontrado');
      }
      
      if (sectionsNumberElement) {
        sectionsNumberElement.value = window.currentProject.totalSections;
        updateSectionButtons(); // Actualizar estado de botones
      } else {
        console.warn('Ã¢Å¡Â Ã¯Â¸Â Elemento sectionsNumber no encontrado');
      }
      
      if (voiceSelectElement) {
        voiceSelectElement.value = window.currentProject.voice || 'shimmer';
      } else {
        console.warn('Ã¢Å¡Â Ã¯Â¸Â Elemento voiceSelect no encontrado');
      }
      
      if (imageModelSelectElement) {
        const normalizedImageModel = normalizeImageModel(window.currentProject.imageModel);
        const hasOption = Array.from(imageModelSelectElement.options || []).some(option => option.value === normalizedImageModel);
        imageModelSelectElement.value = hasOption ? normalizedImageModel : IMAGE_MODEL_DEFAULT;
        window.currentProject.imageModel = imageModelSelectElement.value;
      }
      
      // Cargar modelo LLM
      if (llmModelSelectElement && window.currentProject.llmModel) {
        llmModelSelectElement.value = window.currentProject.llmModel;
        console.log('Ã°Å¸Â§Â  Modelo LLM cargado:', window.currentProject.llmModel);
      }
      
      // Ã°Å¸â€Â§ CARGAR CONFIGURACIONES ADICIONALES DEL PROYECTO
      console.log('Ã°Å¸â€Â§ Cargando configuraciones adicionales del proyecto...');
      
      // Cargar estilo de narraciÃƒÂ³n
      const styleSelectElement = document.getElementById('styleSelect');
      if (styleSelectElement && window.currentProject.scriptStyle) {
        styleSelectElement.value = window.currentProject.scriptStyle;
        console.log('Ã°Å¸â€œÂ Estilo de narraciÃƒÂ³n cargado:', window.currentProject.scriptStyle);
      }
      
      // Cargar voz de Applio
      const applioVoiceSelectElement = document.getElementById('applioVoiceSelect');
      if (applioVoiceSelectElement && window.currentProject.applioVoice) {
        applioVoiceSelectElement.value = window.currentProject.applioVoice;
        console.log('Ã°Å¸Å½Â¤ Voz de Applio cargada:', window.currentProject.applioVoice);
      }
      
      // Cargar modelo de Applio
      const applioModelSelectElement = document.getElementById('applioModelSelect');
      if (applioModelSelectElement && window.currentProject.applioModel) {
        applioModelSelectElement.value = window.currentProject.applioModel;
        console.log('Ã°Å¸Å½â€ºÃ¯Â¸Â Modelo de Applio cargado:', window.currentProject.applioModel);
      }
      
      // Cargar pitch de Applio
      const applioPitchElement = document.getElementById('applioPitch');
      const pitchValueElement = document.getElementById('pitchValue');
      if (applioPitchElement && typeof window.currentProject.applioPitch !== 'undefined') {
        applioPitchElement.value = window.currentProject.applioPitch;
        if (pitchValueElement) {
          pitchValueElement.textContent = window.currentProject.applioPitch;
        }
        console.log('Ã°Å¸Å½Âµ Pitch de Applio cargado:', window.currentProject.applioPitch);
      }

      const applioSpeedElement = document.getElementById('applioSpeed');
      const speedValueElement = document.getElementById('speedValue');
      if (applioSpeedElement && typeof window.currentProject.applioSpeed !== 'undefined') {
        applioSpeedElement.value = window.currentProject.applioSpeed;
        if (speedValueElement) {
          speedValueElement.textContent = window.currentProject.applioSpeed;
        }
        console.log('Ã°Å¸Å¡â‚¬ Velocidad de Applio cargada:', window.currentProject.applioSpeed);
      }
      
      // Cargar modificador de prompts (instrucciones para imÃƒÂ¡genes)
      const promptModifierElement = document.getElementById('promptModifier');
      if (promptModifierElement && window.currentProject.promptModifier) {
        promptModifierElement.value = window.currentProject.promptModifier;
        console.log('Ã°Å¸Å½Â¨ Modificador de prompts cargado:', window.currentProject.promptModifier);
      }
      
      // Cargar configuraciÃƒÂ³n de checkboxes
      const skipImagesElement = document.getElementById('skipImages');
      if (skipImagesElement && typeof window.currentProject.skipImages === 'boolean') {
        skipImagesElement.checked = window.currentProject.skipImages;
        console.log('Ã°Å¸Å¡Â« Skip imÃƒÂ¡genes cargado:', window.currentProject.skipImages, 'checkbox checked:', skipImagesElement.checked);
      } else {
        console.warn('Ã¢Å¡Â Ã¯Â¸Â Skip Images - elemento:', !!skipImagesElement, 'valor en proyecto:', window.currentProject.skipImages, 'tipo:', typeof window.currentProject.skipImages);
      }
      
      const googleImagesElement = document.getElementById('googleImages');
      if (googleImagesElement && typeof window.currentProject.googleImages === 'boolean') {
        googleImagesElement.checked = window.currentProject.googleImages;
        console.log('Ã°Å¸â€â€” Google Images cargado:', window.currentProject.googleImages, 'checkbox checked:', googleImagesElement.checked);
      } else {
        console.warn('Ã¢Å¡Â Ã¯Â¸Â Google Images - elemento:', !!googleImagesElement, 'valor en proyecto:', window.currentProject.googleImages, 'tipo:', typeof window.currentProject.googleImages);
      }
      
      // Cargar nÃƒÂºmero de imÃƒÂ¡genes
      const imagesSelectElement = document.getElementById('imagesSelect');
      if (imagesSelectElement && window.currentProject.imageCount) {
        imagesSelectElement.value = window.currentProject.imageCount;
        console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â NÃƒÂºmero de imÃƒÂ¡genes cargado:', window.currentProject.imageCount);
      }
      
      // Cargar palabras por secciÃƒÂ³n (minWords y maxWords)
      const minWordsElement = document.getElementById('minWords');
      if (minWordsElement && window.currentProject.minWords) {
        minWordsElement.value = window.currentProject.minWords;
        console.log('Ã°Å¸â€œÂ MinWords cargado:', window.currentProject.minWords);
      }
      
      const maxWordsElement = document.getElementById('maxWords');
      if (maxWordsElement && window.currentProject.maxWords) {
        maxWordsElement.value = window.currentProject.maxWords;
        console.log('Ã°Å¸â€œÂ MaxWords cargado:', window.currentProject.maxWords);
      }
      
      console.log('Ã¢Å“â€¦ Todas las configuraciones del proyecto han sido restauradas');
      
      // Actualizar estado de la interfaz
      if (window.currentProject.completedSections.length > 0) {
        window.currentTopic = window.currentProject.topic;
        window.totalSections = window.currentProject.totalSections;
        // Para el botÃƒÂ³n continuar, currentSectionNumber debe ser el nÃƒÂºmero de secciones completadas
        window.currentSectionNumber = window.currentProject.completedSections.length;
        
        // TambiÃƒÂ©n actualizar las variables globales para compatibilidad
        currentTopic = window.currentProject.topic;
        totalSections = window.currentProject.totalSections;
        currentSectionNumber = window.currentProject.completedSections.length;
        
        console.log('Ã°Å¸â€œÅ  Variables globales actualizadas:', {
          currentTopic,
          totalSections,
          currentSectionNumber,
          completedSections: window.currentProject.completedSections.length
        });
        
        // Mostrar la ÃƒÂºltima secciÃƒÂ³n completada
        const lastSection = window.currentProject.completedSections[window.currentProject.completedSections.length - 1];
        if (lastSection) {
          showLoadedSection(lastSection);
        }
        
        // Cargar prompts al panel lateral si existen
        loadProjectPrompts(window.currentProject);
      }

        syncSectionImageProgressFromProject(window.currentProject);
        startSectionImageProgressPolling(window.currentProject);
      
      // Ã°Å¸Å½Â¬ VERIFICAR Y MOSTRAR METADATOS DE YOUTUBE SI EXISTEN
      if (window.currentProject.youtubeMetadata && !isMetadataShown) {
        console.log('Ã°Å¸Å½Â¬ Proyecto tiene metadatos de YouTube, mostrando automÃƒÂ¡ticamente...');
        const isProjectComplete = window.currentProject.completedSections.length >= window.currentProject.totalSections;
        
        if (isProjectComplete) {
          // Mostrar metadatos automÃƒÂ¡ticamente para proyectos completos
          isMetadataShown = true; // Marcar como mostrado INMEDIATAMENTE
          setTimeout(() => {
            showYouTubeMetadataResults(window.currentProject.youtubeMetadata.content, window.currentProject.topic);
            showNotification('Ã°Å¸Å½Â¬ Metadatos de YouTube cargados automÃƒÂ¡ticamente', 'info');
          }, 1500); // Delay para que se complete la carga del proyecto
        } else {
          console.log('Ã°Å¸â€œÅ  Proyecto incompleto, metadatos disponibles pero no se muestran automÃƒÂ¡ticamente');
          showNotification('Ã°Å¸â€œÅ  Este proyecto tiene metadatos de YouTube generados anteriormente', 'info');
        }
      } else if (window.currentProject.youtubeMetadata && isMetadataShown) {
        console.log('Ã°Å¸Å½Â¬ Metadatos ya mostrados, omitiendo duplicado');
      } else {
        const isProjectComplete = window.currentProject.completedSections.length >= window.currentProject.totalSections;
        if (isProjectComplete) {
          console.log('Ã°Å¸Å½Â¬ Proyecto completo sin metadatos, se pueden generar manualmente');
          showNotification('Ã°Å¸Å½Â¬ Proyecto completo. Puedes generar metadatos de YouTube en el extractor de texto.', 'info');
        }
      }
      
      // Actualizar estado de los botones segÃƒÂºn el progreso del proyecto
      updateProjectButtons(window.currentProject);
      
      // Cerrar modales
      closeModal('loadProjectModal');
      closeModal('manageProjectsModal');
      
      showNotification(`Ã¢Å“â€¦ Proyecto "${window.currentProject.folderName}" cargado exitosamente`, 'success');
      
      // Mostrar detalles del proyecto cargado
      showProjectDetails(window.currentProject);
      
    } else {
      showNotification('Ã¢ÂÅ’ Error cargando el proyecto', 'error');
    }
    
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error cargando proyecto:', error);
    showNotification('Ã¢ÂÅ’ Error de conexiÃƒÂ³n al cargar proyecto', 'error');
  } finally {
    isLoadingProject = false; // Desactivar bandera de carga al finalizar
  }
}

// FunciÃƒÂ³n para mostrar secciÃƒÂ³n cargada
function showLoadedSection(section) {
  const scriptContent = document.getElementById('scriptContent');
  const sectionTitle = document.getElementById('sectionTitle');
  const currentSectionSpan = document.getElementById('currentSection');
  
  if (scriptContent && section.script) {
    // Mostrar script
    const scriptHTML = `
      <div class="script-container">
        <div class="script-actions">
          <button class="copy-script-btn" onclick="copyScriptText()" title="Copiar texto del guiÃƒÂ³n">
            <i class="fas fa-copy"></i>
          </button>
          <button class="audio-script-btn" onclick="generateSectionAudioButton()" title="Generar audio del guiÃƒÂ³n">
            <i class="fas fa-microphone"></i>
          </button>
        </div>
        <div class="script-text">${section.script.replace(/\n/g, '<br><br>')}</div>
      </div>`;
    
    scriptContent.innerHTML = scriptHTML;
    scriptContent.style.display = 'block';
  }
  
  if (sectionTitle) {
    sectionTitle.textContent = `SecciÃƒÂ³n ${section.section}`;
  }
  
  if (currentSectionSpan) {
    currentSectionSpan.textContent = section.section;
  }
  
  // Cargar y mostrar imÃƒÂ¡genes en el carrusel si existen
  if (section.hasImages || section.imageFiles || section.googleImagesMode) {
    console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Cargando imÃƒÂ¡genes para secciÃƒÂ³n:', section.section);
    console.log('Ã°Å¸â€Â Motivo de carga:', {
      hasImages: section.hasImages,
      imageFiles: !!section.imageFiles,
      googleImagesMode: section.googleImagesMode
    });
    console.log('Ã°Å¸â€Â Datos completos de la secciÃƒÂ³n:', section);
    loadSectionImages(section.section);
  } else {
    console.log('Ã°Å¸Å¡Â« No se detectaron imÃƒÂ¡genes para cargar:', {
      hasImages: section.hasImages,
      imageFiles: !!section.imageFiles,
      googleImagesMode: section.googleImagesMode,
      sectionKeys: Object.keys(section)
    });
    
    // FORZAR carga de imÃƒÂ¡genes independientemente de las banderas
    console.log('Ã°Å¸â€Â§ Intentando cargar imÃƒÂ¡genes forzadamente...');
    loadSectionImages(section.section);
  }
}

// FunciÃƒÂ³n para cargar imÃƒÂ¡genes de una secciÃƒÂ³n especÃƒÂ­fica desde el proyecto
async function loadSectionImages(sectionNumber) {
  try {
    console.log(`Ã°Å¸â€Â [loadSectionImages] Iniciando carga para secciÃƒÂ³n ${sectionNumber}`);
    
    if (!window.currentProject) {
      console.warn('Ã¢Å¡Â Ã¯Â¸Â No hay proyecto cargado actualmente');
      return;
    }
    
    // Ã°Å¸â€Â Usar la carpeta correcta del proyecto
    const projectFolderName = window.currentProject.folderName || 
                             window.currentProject.originalFolderName || 
                             window.currentProject.topic.toLowerCase().replace(/\s+/g, '_');
    
    console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â Buscando imÃƒÂ¡genes para secciÃƒÂ³n ${sectionNumber} en proyecto: ${projectFolderName}`);
    console.log(`Ã°Å¸â€â€” URL que se va a llamar: /api/project-images/${projectFolderName}/${sectionNumber}`);
    
    const response = await fetch(`/api/project-images/${projectFolderName}/${sectionNumber}`);
    console.log(`Ã°Å¸â€œÂ¡ Respuesta del servidor:`, response.status, response.statusText);
    
    const data = await response.json();
    console.log(`Ã°Å¸â€œÅ  Datos recibidos completos:`, JSON.stringify(data, null, 2));
    
    if (data.success && data.images && data.images.length > 0) {
      console.log(`Ã¢Å“â€¦ Encontradas ${data.images.length} imÃƒÂ¡genes para secciÃƒÂ³n ${sectionNumber}`);
      
      // Preparar imÃƒÂ¡genes para el carrusel
      const carouselImages = data.images.map((image, index) => {
        console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â Procesando imagen ${index + 1}:`, image);
        return {
          url: image.url,
          caption: image.caption || `Imagen ${index + 1} de la SecciÃƒÂ³n ${sectionNumber}`,
          filename: image.filename,
          path: image.path,
          source: image.source || 'Google Images' // AÃƒÂ±adir source para la lÃƒÂ³gica del carrusel
        };
      });
      
      console.log(`Ã°Å¸Å½Â  ImÃƒÂ¡genes preparadas para carrusel:`, carouselImages);
      
      // Cargar keywords si estÃƒÂ¡n disponibles
      console.log(`Ã°Å¸â€Â [loadSectionImages] Data.keywords recibidas:`, data.keywords);
      console.log(`Ã°Å¸â€Â [loadSectionImages] Longitud de keywords:`, data.keywords ? data.keywords.length : 0);
      if (data.keywords && data.keywords.length > 0) {
        currentImageKeywords = data.keywords;
        console.log(`Ã°Å¸â€œâ€¹ Keywords cargadas para las imÃƒÂ¡genes:`, data.keywords);
      } else {
        currentImageKeywords = [];
        console.log(`Ã¢Å¡Â Ã¯Â¸Â No se recibieron keywords del backend`);
      }
      
      console.log(`Ã°Å¸â€Â [loadSectionImages] currentImageKeywords final:`, currentImageKeywords);
      
      // Mostrar carrusel
      createCarousel(carouselImages, sectionNumber, []);
      
      // Actualizar variables globales
      totalSlides = carouselImages.length;
      currentSlide = 0;
      
      // Almacenar prompts si estÃƒÂ¡n disponibles
      if (data.prompts && data.prompts.length > 0) {
        imagePrompts = data.prompts;
        console.log(`Ã°Å¸Å½Â¨ Prompts de imÃƒÂ¡genes cargados:`, data.prompts);
      }
      
      console.log(`Ã°Å¸Å½Â  Carrusel creado exitosamente para secciÃƒÂ³n ${sectionNumber}`);
      
    } else {
      console.log(`Ã°Å¸â€œÂ· No se encontraron imÃƒÂ¡genes para secciÃƒÂ³n ${sectionNumber}`, data);
      
      // Ocultar carrusel si no hay imÃƒÂ¡genes
      const carouselContainer = document.getElementById("carousel-container");
      if (carouselContainer) {
        carouselContainer.style.display = "none";
        console.log(`Ã°Å¸â€â€™ Carrusel ocultado para secciÃƒÂ³n ${sectionNumber}`);
      }
    }
    
  } catch (error) {
    console.error(`Ã¢ÂÅ’ Error cargando imÃƒÂ¡genes para secciÃƒÂ³n ${sectionNumber}:`, error);
    
    // Ocultar carrusel en caso de error
    const carouselContainer = document.getElementById("carousel-container");
    if (carouselContainer) {
      carouselContainer.style.display = "none";
    }
  }

  if (shouldRefreshSectionImageProgress()) {
    refreshSectionImageProgress().catch((error) => {
      console.warn('Ã¢Å¡Â Ã¯Â¸Â Error actualizando progreso de imÃƒÂ¡genes tras cargar secciÃƒÂ³n:', error);
    });
  }
}

// FunciÃƒÂ³n para cargar prompts del proyecto al panel lateral
function loadProjectPrompts(project) {
  console.log('Ã°Å¸â€œâ€¹ Iniciando carga de prompts del proyecto...');
  
  if (!project.completedSections || project.completedSections.length === 0) {
    console.log('Ã¢ÂÅ’ No hay secciones completadas con prompts');
    return;
  }
  
  // Limpiar prompts existentes
  allAccumulatedPrompts = [];
  
  // Limpiar el panel lateral
  clearPromptsSidebar();
  
  let totalPrompts = 0;
  
  // Cargar prompts de cada secciÃƒÂ³n completada
  project.completedSections.forEach(section => {
    console.log(`Ã°Å¸â€Â Procesando secciÃƒÂ³n ${section.section}:`, {
      tienePrompts: !!(section.imagePrompts && section.imagePrompts.length > 0),
      tieneImageUrls: !!(section.imageUrls && section.imageUrls.length > 0),
      esGoogleImages: section.googleImagesMode
    });
    
    if (section.imagePrompts && section.imagePrompts.length > 0) {
      console.log(`Ã°Å¸â€œâ€¹ Cargando ${section.imagePrompts.length} prompts de la secciÃƒÂ³n ${section.section}`);
      
      if (section.googleImagesMode) {
        console.log(`Ã°Å¸â€â€” SecciÃƒÂ³n ${section.section} tiene keywords para Google Images`);
        
        // Para Google Images, convertir keywords en URLs clicables
        const googleImageUrls = section.imagePrompts.map((keyword, index) => {
          const encodedKeyword = encodeURIComponent(keyword.trim());
          const googleUrl = `https://www.google.com/search?q=${encodedKeyword}&tbm=isch`;
          return `Ã°Å¸â€â€” <a href="${googleUrl}" target="_blank" style="color: #00bfff; text-decoration: underline;">Buscar: "${keyword.trim()}"</a>`;
        });
        
        addPromptsToSidebar(googleImageUrls, section.section);
        totalPrompts += googleImageUrls.length;
      } else {
        // Prompts normales de imagen
        addPromptsToSidebar(section.imagePrompts, section.section);
        totalPrompts += section.imagePrompts.length;
      }
    } else if (section.imageUrls && section.imageUrls.length > 0) {
      console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â SecciÃƒÂ³n ${section.section} tiene ${section.imageUrls.length} URLs de imÃƒÂ¡genes generadas`);
      
      // Si tiene URLs pero no prompts, crear prompts genÃƒÂ©ricos
      const genericPrompts = section.imageUrls.map((url, index) => `Imagen ${index + 1} generada para la secciÃƒÂ³n ${section.section}`);
      addPromptsToSidebar(genericPrompts, section.section);
      totalPrompts += genericPrompts.length;
    } else if (section.googleImagesMode) {
      console.log(`Ã°Å¸â€â€” SecciÃƒÂ³n ${section.section} usa Google Images automÃƒÂ¡tico`);
      
      // Para Google Images, mostrar un indicador
      const googleImageIndicator = [`SecciÃƒÂ³n ${section.section} configurada para usar Google Images automÃƒÂ¡tico`];
      addPromptsToSidebar(googleImageIndicator, section.section);
      totalPrompts += 1;
    }
  });
  
  console.log(`Ã¢Å“â€¦ Total de prompts cargados en el panel: ${totalPrompts}`);
  syncSectionImageProgressFromProject(project);
}

// FunciÃƒÂ³n para mostrar detalles del proyecto
function showProjectDetails(project) {
  console.log('Ã°Å¸â€œÅ  Mostrando detalles del proyecto:', project);
  
  const modal = document.getElementById('projectDetailModal');
  const title = document.getElementById('projectDetailTitle');
  const content = document.getElementById('projectDetailContent');
  
  if (!modal || !title || !content) {
    console.error('Ã¢ÂÅ’ Elementos del modal no encontrados:', { modal: !!modal, title: !!title, content: !!content });
    return;
  }
  
  title.innerHTML = `<i class="fas fa-folder"></i> ${project.folderName}`;
  
  const progress = (project.completedSections.length / project.totalSections) * 100;
  const isComplete = project.completedSections.length >= project.totalSections;
  
  console.log('Ã°Å¸â€œË† Progreso del proyecto:', {
    completed: project.completedSections.length,
    total: project.totalSections,
    progress: progress,
    sections: project.completedSections,
    folderName: project.folderName
  });
  
  content.innerHTML = `
    <div class="project-detail-content">
      <div class="project-overview">
        <h4><i class="fas fa-info-circle"></i> InformaciÃƒÂ³n General</h4>
        <div class="overview-grid">
          <div class="overview-item">
            <div class="overview-label">Tema</div>
            <div class="overview-value">${project.topic}</div>
          </div>
          <div class="overview-item">
            <div class="overview-label">Estado</div>
            <div class="overview-value">${isComplete ? 'Ã¢Å“â€¦ Completo' : 'Ã°Å¸â€â€ž En progreso'}</div>
          </div>
          <div class="overview-item">
            <div class="overview-label">Progreso</div>
            <div class="overview-value">${project.completedSections.length}/${project.totalSections} secciones</div>
          </div>
          <div class="overview-item">
            <div class="overview-label">Creado</div>
            <div class="overview-value">${project.createdAt ? new Date(project.createdAt).toLocaleString() : 'No disponible'}</div>
          </div>
          <div class="overview-item">
            <div class="overview-label">ÃƒÅ¡ltima modificaciÃƒÂ³n</div>
            <div class="overview-value">${project.lastModified ? new Date(project.lastModified).toLocaleString() : 'No disponible'}</div>
          </div>
          <div class="overview-item">
            <div class="overview-label">Voz</div>
            <div class="overview-value">${project.voice || 'No especificada'}</div>
          </div>
          ${project.imageModel ? `
          <div class="overview-item">
            <div class="overview-label">Modelo de IA</div>
            <div class="overview-value">${getImageModelLabel(project.imageModel)}</div>
          </div>
          ` : ''}
          <div class="overview-item">
            <div class="overview-label">Metadatos YouTube</div>
            <div class="overview-value">${project.youtubeMetadata ? 
              `Ã¢Å“â€¦ Generados ${project.youtubeMetadata.generatedAt ? 
                `(${new Date(project.youtubeMetadata.generatedAt).toLocaleDateString()})` : ''
              }` : 
              (isComplete ? 'Ã¢Å¡Â Ã¯Â¸Â Disponibles para generar' : 'Ã¢ÂÅ’ No disponibles')
            }</div>
          </div>
        </div>
      </div>
      
      <div class="project-sections">
        <div class="sections-header">
          <h4><i class="fas fa-list"></i> Secciones Completadas (${project.completedSections.length})</h4>
          <div class="progress-bar" style="width: 200px;">
            <div class="progress-fill" style="width: ${progress}%"></div>
          </div>
        </div>
        
        ${project.completedSections.length > 0 ? `
          <div class="sections-grid">
            ${project.completedSections.map(section => {
              console.log('Ã°Å¸â€Â Procesando secciÃƒÂ³n:', section);
              const hasScript = section.script && section.script.length > 0;
              const hasImages = section.hasImages || section.imageUrls?.length > 0 || section.googleImagesMode;
              const imageCount = section.imageUrls?.length || section.imageCount || 0;
              
              return `
              <div class="section-card">
                <div class="section-header">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="section-number">${section.section}</div>
                    <span style="color: #ffffff; font-weight: 600;">SecciÃƒÂ³n ${section.section}</span>
                  </div>
                  <div class="section-status-badge completed">Completada</div>
                </div>
                <div class="section-info">
                  <div>Ã°Å¸â€œÂ Script: ${hasScript ? 'Ã¢Å“â€¦ Generado' : 'Ã¢ÂÅ’ No disponible'}</div>
                  <div>Ã°Å¸â€“Â¼Ã¯Â¸Â ImÃƒÂ¡genes: ${hasImages ? (section.googleImagesMode ? 'Ã°Å¸â€â€” Google Images' : `Ã¢Å“â€¦ ${imageCount} imÃƒÂ¡genes`) : 'Ã¢ÂÅ’ Sin imÃƒÂ¡genes'}</div>
                  <div>Ã°Å¸â€œâ€¦ ${section.completedAt ? new Date(section.completedAt).toLocaleDateString() : 'Fecha no disponible'}</div>
                  ${section.prompts?.length > 0 ? `<div>Ã°Å¸Å½Â¨ Prompts: ${section.prompts.length}</div>` : ''}
                </div>
                <div class="section-actions">
                  <button class="section-action-btn" data-section="${section.section}" data-folder="${project.folderName}" data-action="details" data-project='${JSON.stringify(project).replace(/'/g, "&#39;")}'>
                    <i class="fas fa-eye"></i>
                    Ver Detalles
                  </button>
                </div>
              </div>
              `;
            }).join('')}
          </div>
          
          <div class="project-actions-footer">
            <button class="btn btn-primary btn-activate-project" data-folder="${project.folderName}" data-project='${JSON.stringify(project).replace(/'/g, "&#39;")}'>
              <i class="fas fa-play-circle"></i>
              Activar Proyecto Completo
            </button>
            
            <button class="btn btn-secondary btn-open-folder" data-folder="${project.folderName}">
              <i class="fas fa-folder-open"></i>
              Abrir Carpeta
            </button>
            
            ${isComplete ? `
              <button class="btn btn-secondary btn-youtube-metadata" data-folder="${project.folderName}" data-topic="${project.topic}" data-has-metadata="${!!project.youtubeMetadata}">
                <i class="fas fa-youtube"></i>
                ${project.youtubeMetadata ? 'Ver Metadatos YouTube' : 'Generar Metadatos YouTube'}
              </button>
            ` : ''}
          </div>
        ` : `
          <div class="empty-state">
            <i class="fas fa-file-alt"></i>
            <h3>No hay secciones completadas</h3>
            <p>Genera contenido para ver las secciones aquÃƒÂ­</p>
          </div>
        `}
      </div>
    </div>
  `;
  
  // Agregar event listeners para los botones
  setTimeout(() => {
    const actionButtons = content.querySelectorAll('.section-action-btn');
    const activateButton = content.querySelector('.btn-activate-project');
    const youtubeMetadataButton = content.querySelector('.btn-youtube-metadata');
    console.log('Ã°Å¸Å½Â¯ Configurando event listeners para', actionButtons.length, 'botones de secciÃƒÂ³n,', activateButton ? '1' : '0', 'botÃƒÂ³n de activar y', youtubeMetadataButton ? '1' : '0', 'botÃƒÂ³n de metadatos');
    
    // Event listeners para botones de secciÃƒÂ³n individuales
    actionButtons.forEach(button => {
      const section = button.getAttribute('data-section');
      const folder = button.getAttribute('data-folder');
      const action = button.getAttribute('data-action');
      const projectData = button.getAttribute('data-project');
      
      button.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Ã°Å¸â€â€ž Click en botÃƒÂ³n:', action, 'secciÃƒÂ³n:', section);
        
        let projectObj = project; // Usar el proyecto actual por defecto
        
        // Si hay datos del proyecto en el atributo, usarlos
        if (projectData) {
          try {
            projectObj = JSON.parse(projectData);
          } catch (error) {
            console.error('Ã¢ÂÅ’ Error parseando datos del proyecto:', error);
          }
        }
        
        if (action === 'details') {
          loadSectionDetailsWithProject(parseInt(section), folder, projectObj);
        }
      });
    });
    
    // Event listener para el botÃƒÂ³n de activar proyecto completo
    if (activateButton) {
      const folder = activateButton.getAttribute('data-folder');
      const projectData = activateButton.getAttribute('data-project');
      
      activateButton.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Ã°Å¸Å¡â‚¬ Activando proyecto completo:', folder);
        
        let projectObj = project;
        if (projectData) {
          try {
            projectObj = JSON.parse(projectData);
          } catch (error) {
            console.error('Ã¢ÂÅ’ Error parseando datos del proyecto:', error);
          }
        }
        
        activateFullProject(projectObj);
      });
    }
    
    // Event listener para el botÃƒÂ³n de abrir carpeta
    const openFolderButton = content.querySelector('.btn-open-folder');
    if (openFolderButton) {
      const folder = openFolderButton.getAttribute('data-folder');
      
      openFolderButton.addEventListener('click', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Ã°Å¸â€œâ€š Abriendo carpeta del proyecto:', folder);
        
        try {
          const response = await fetch('/api/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderName: folder })
          });
          
          const result = await response.json();
          
          if (result.success) {
            showNotification(`Ã°Å¸â€œâ€š Carpeta abierta: ${folder}`, 'success');
          } else {
            showNotification('Ã¢ÂÅ’ Error al abrir la carpeta: ' + result.error, 'error');
          }
        } catch (error) {
          console.error('Ã¢ÂÅ’ Error al abrir carpeta:', error);
          showNotification('Ã¢ÂÅ’ Error al abrir la carpeta', 'error');
        }
      });
    }
    
    // Event listener para el botÃƒÂ³n de metadatos de YouTube
    if (youtubeMetadataButton) {
      const folder = youtubeMetadataButton.getAttribute('data-folder');
      const topic = youtubeMetadataButton.getAttribute('data-topic');
      const hasMetadata = youtubeMetadataButton.getAttribute('data-has-metadata') === 'true';
      
      youtubeMetadataButton.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Ã°Å¸Å½Â¬ Click en metadatos YouTube:', { folder, topic, hasMetadata });
        
        if (hasMetadata && project.youtubeMetadata) {
          // Mostrar metadatos existentes
          console.log('Ã°Å¸â€œÂ½Ã¯Â¸Â Mostrando metadatos existentes');
          closeModal('projectDetailModal');
          showYouTubeMetadataResults(project.youtubeMetadata.content, topic);
          showNotification('Ã°Å¸Å½Â¬ Metadatos de YouTube cargados', 'success');
        } else {
          // Generar nuevos metadatos
          console.log('Ã°Å¸Å½Â¬ Generando nuevos metadatos de YouTube');
          closeModal('projectDetailModal');
          showNotification('Ã°Å¸Å½Â¬ Generando metadatos de YouTube...', 'info');
          
          // Establecer el tema en el campo para que generateYouTubeMetadata funcione
          const promptElement = document.getElementById('prompt');
          if (promptElement) {
            promptElement.value = topic;
          }
          
          // Cargar el proyecto primero para tener acceso a todas las secciones
          loadProject(folder).then(() => {
            setTimeout(() => {
              generateYouTubeMetadata().then(() => {
                showNotification('Ã¢Å“â€¦ Metadatos de YouTube generados exitosamente', 'success');
              }).catch(error => {
                console.error('Ã¢ÂÅ’ Error generando metadatos:', error);
                showNotification('Ã¢ÂÅ’ Error generando metadatos de YouTube', 'error');
              });
            }, 1000);
          }).catch(error => {
            console.error('Ã¢ÂÅ’ Error cargando proyecto:', error);
            showNotification('Ã¢ÂÅ’ Error cargando proyecto', 'error');
          });
        }
      });
    }
  }, 100);
  
  modal.style.display = 'block';
}

// FunciÃƒÂ³n para duplicar proyecto
async function duplicateProject(folderName) {
  const newName = prompt('Ingresa el nombre para el proyecto duplicado:');
  if (!newName || !newName.trim()) return;
  
  try {
    showNotification('Ã°Å¸â€œâ€¹ Duplicando proyecto...', 'info');
    
    const response = await fetch(`/api/projects/${folderName}/duplicate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ newName: newName.trim() })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('Ã¢Å“â€¦ Proyecto duplicado exitosamente', 'success');
      await refreshProjectsList();
    } else {
      showNotification(`Ã¢ÂÅ’ Error: ${data.error}`, 'error');
    }
    
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error duplicando proyecto:', error);
    showNotification('Ã¢ÂÅ’ Error de conexiÃƒÂ³n', 'error');
  }
}

// FunciÃƒÂ³n para confirmar eliminaciÃƒÂ³n de proyecto
function confirmDeleteProject(folderName, projectName) {
  const modal = document.getElementById('confirmDeleteModal');
  const text = document.getElementById('deleteConfirmText');
  const confirmBtn = document.getElementById('confirmDelete');
  
  text.textContent = `Ã‚Â¿EstÃƒÂ¡s seguro de que quieres eliminar el proyecto "${projectName}"? Esta acciÃƒÂ³n no se puede deshacer.`;
  
  // Limpiar event listeners anteriores
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  
  // Agregar nuevo event listener
  newConfirmBtn.addEventListener('click', () => deleteProject(folderName));
  
  modal.style.display = 'block';
}

// FunciÃƒÂ³n para eliminar proyecto
async function deleteProject(folderName) {
  try {
    showNotification('Ã°Å¸â€”â€˜Ã¯Â¸Â Eliminando proyecto...', 'info');
    
    const response = await fetch(`/api/projects/${folderName}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('Ã¢Å“â€¦ Proyecto eliminado exitosamente', 'success');
      await refreshProjectsList();
      closeModal('confirmDeleteModal');
    } else {
      showNotification(`Ã¢ÂÅ’ Error: ${data.error}`, 'error');
    }
    
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error eliminando proyecto:', error);
    showNotification('Ã¢ÂÅ’ Error de conexiÃƒÂ³n', 'error');
  }
}

// FunciÃƒÂ³n para inicializar modales de proyectos
function initializeProjectModals() {
  console.log('Ã°Å¸â€Â§ Inicializando modales de proyectos...');
  
  // Event listeners para cerrar modales con mÃƒÂºltiples mÃƒÂ©todos
  document.querySelectorAll('.close').forEach(closeBtn => {
    closeBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('Ã¢ÂÅ’ Cerrando modal via botÃƒÂ³n X');
      const modalId = this.getAttribute('data-modal');
      if (modalId) {
        closeModal(modalId);
      } else {
        // Fallback - buscar el modal padre
        const modal = this.closest('.modal');
        if (modal) {
          modal.style.display = 'none';
        }
      }
    });
  });
  
  // Cerrar modal al hacer click fuera
  window.addEventListener('click', function(event) {
    if (event.target.classList.contains('modal')) {
      console.log('Ã¢ÂÅ’ Cerrando modal via click fuera');
      event.target.style.display = 'none';
    }
  });
  
  // Botones especÃƒÂ­ficos de cerrar para modales de proyecto
  const closeButtons = [
    'closeLoadProjectModal',
    'closeManageProjectsModal', 
    'closeProjectDetailModal',
    'closeConfirmDeleteModal'
  ];
  
  closeButtons.forEach(btnId => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log(`Ã¢ÂÅ’ Cerrando modal via ${btnId}`);
        const modal = this.closest('.modal');
        if (modal) {
          modal.style.display = 'none';
        }
      });
    }
  });
  
  // BotÃƒÂ³n de cancelar eliminaciÃƒÂ³n
  const cancelDeleteBtn = document.getElementById('cancelDelete');
  if (cancelDeleteBtn) {
    cancelDeleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal('confirmDeleteModal');
    });
  }
  
  // BotÃƒÂ³n de refrescar proyectos
  const refreshBtn = document.getElementById('refreshProjectsList');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';
      await refreshProjectsList();
      refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Actualizar';
    });
  }
  
  // BÃƒÂºsqueda de proyectos
  const searchInput = document.getElementById('projectsSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      filterProjects(this.value);
    });
  }
  
  console.log('Ã¢Å“â€¦ Modales de proyectos inicializados');
}

// FunciÃƒÂ³n para cerrar modal
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
}

// FunciÃƒÂ³n para filtrar proyectos
function filterProjects(searchTerm) {
  const projectCards = document.querySelectorAll('.project-card');
  const term = searchTerm.toLowerCase();
  
  projectCards.forEach(card => {
    const projectName = card.querySelector('.project-title').textContent.toLowerCase();
    const projectTopic = card.querySelector('.project-info-value').textContent.toLowerCase();
    
    if (projectName.includes(term) || projectTopic.includes(term)) {
      card.style.display = 'block';
    } else {
      card.style.display = 'none';
    }
  });
}

// FunciÃƒÂ³n para cargar detalles de una secciÃƒÂ³n especÃƒÂ­fica
function loadSectionDetails(sectionNumber) {
  if (!currentProject || !currentProject.completedSections) return;
  
  const section = currentProject.completedSections.find(s => s.section === sectionNumber);
  if (section) {
    showLoadedSection(section);
    closeModal('projectDetailModal');
    showNotification(`Ã°Å¸â€œâ€ž SecciÃƒÂ³n ${sectionNumber} cargada`, 'success');
  }
}

console.log('Ã¢Å“â€¦ Sistema de proyectos cargado completamente');

// INICIALIZADOR FINAL DIRECTO - FORZAR EVENTOS
setTimeout(function() {
  console.log('Ã°Å¸â€Â§ INICIALIZADOR FINAL: Configurando eventos directos...');
  
  // Configurar eventos directos como onclick
  const saveBtn = document.getElementById('saveProjectBtn');
  const loadBtn = document.getElementById('loadProjectBtn');
  const manageBtn = document.getElementById('manageProjectsBtn');
  
  if (saveBtn) {
    console.log('Ã¢Å“â€¦ Configurando saveProjectBtn con onclick directo');
    saveBtn.onclick = function(e) {
      console.log('Ã°Å¸â€™Â¾ ONCLICK DIRECTO: Guardar Proyecto');
      e.preventDefault();
      saveCurrentProject();
      return false;
    };
  }
  
  if (loadBtn) {
    console.log('Ã¢Å“â€¦ Configurando loadProjectBtn con onclick directo');
    loadBtn.onclick = function(e) {
      console.log('Ã°Å¸â€œâ€š ONCLICK DIRECTO: Cargar Proyecto');
      e.preventDefault();
      showLoadProjectModal();
      return false;
    };
  }
  
  if (manageBtn) {
    console.log('Ã¢Å“â€¦ Configurando manageProjectsBtn con onclick directo');
    manageBtn.onclick = function(e) {
      console.log('Ã°Å¸â€Â§ ONCLICK DIRECTO: Gestionar Proyectos');
      e.preventDefault();
      showManageProjectsModal();
      return false;
    };
  }
  
  // Inicializar modales de proyectos
  initializeProjectModals();
  
  // FORZAR eventos de cerrar modal especÃƒÂ­ficamente
  console.log('Ã°Å¸â€â€™ Configurando eventos de cerrar modal...');
  document.querySelectorAll('.close[data-modal]').forEach(closeBtn => {
    const modalId = closeBtn.getAttribute('data-modal');
    console.log(`Ã¢Å¡â„¢Ã¯Â¸Â Configurando cierre para modal: ${modalId}`);
    
    closeBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log(`Ã¢ÂÅ’ CERRANDO MODAL: ${modalId}`);
      closeModal(modalId);
      return false;
    };
  });
  
  console.log('Ã°Å¸Å½Â¯ Eventos onclick directos configurados');
}, 3000);

// FunciÃƒÂ³n para activar un proyecto completo con navegaciÃƒÂ³n
function activateFullProject(projectData) {
  console.log('Ã°Å¸Å¡â‚¬ Activando proyecto completo:', projectData);
  
  if (!projectData || !projectData.completedSections) {
    console.error('Ã¢ÂÅ’ Datos del proyecto no vÃƒÂ¡lidos');
    showNotification('Ã¢ÂÅ’ Datos del proyecto no vÃƒÂ¡lidos', 'error');
    return;
  }
  
  isLoadingProject = true; // Activar bandera de carga
  
  // Cargar el proyecto completo
  loadProject(projectData.folderName).then(() => {
    console.log('Ã¢Å“â€¦ Proyecto cargado, configurando navegaciÃƒÂ³n completa');
    
    // Configurar allSections con todas las secciones completadas
    allSections = new Array(projectData.totalSections);
    // Para el botÃƒÂ³n continuar, currentSectionNumber debe ser el nÃƒÂºmero de secciones completadas
    currentSectionNumber = projectData.completedSections.length;
    
    // TambiÃƒÂ©n actualizar variables globales
    currentTopic = projectData.topic;
    totalSections = projectData.totalSections;
    
    console.log('Ã°Å¸â€œÅ  Variables de navegaciÃƒÂ³n configuradas:', {
      currentSectionNumber,
      totalSections,
      completedSections: projectData.completedSections.length
    });
    
    // Llenar allSections con los scripts de las secciones completadas
    projectData.completedSections.forEach(section => {
      if (section.script) {
        allSections[section.section - 1] = section.script;
      }
    });
    
    console.log('Ã¯Â¿Â½ NavegaciÃƒÂ³n configurada:', allSections.map((s, i) => s ? `${i+1}: Ã¢Å“â€¦` : `${i+1}: Ã¢ÂÅ’`).join(', '));
    
    // Buscar la primera secciÃƒÂ³n disponible
    let firstAvailableSection = projectData.completedSections.find(s => s.script);
    if (firstAvailableSection) {
      currentSectionNumber = firstAvailableSection.section;
      
      // Mostrar la primera secciÃƒÂ³n disponible
      showScript(firstAvailableSection.script, firstAvailableSection.section, projectData.totalSections);
      
      // Asegurar que la secciÃƒÂ³n del script sea visible
      const scriptSection = document.getElementById("script-section");
      if (scriptSection) {
        scriptSection.style.display = 'block';
      }
      
      // Configurar navegaciÃƒÂ³n
      setTimeout(() => {
        initializeSectionNavigation();
        updateNavigationButtons();
      }, 300);
      
      // Cargar TODOS los prompts del proyecto en el panel lateral
      loadProjectPrompts(projectData);
      
      // Cerrar modal de detalles del proyecto
      const modal = document.getElementById('projectDetailModal');
      if (modal) {
        modal.style.display = 'none';
      }
      
      // Actualizar botones segÃƒÂºn el estado del proyecto
      updateProjectButtons(projectData);
      
      showNotification(`Ã°Å¸Å¡â‚¬ Proyecto "${projectData.folderName}" activado. Usa Ã¢â€ Â Ã¢â€ â€™ para navegar entre secciones.`, 'success');
    } else {
      showNotification('Ã¢ÂÅ’ No hay secciones con script disponibles', 'error');
    }
    
    isLoadingProject = false; // Desactivar bandera de carga al finalizar
  }).catch(error => {
    console.error('Ã¢ÂÅ’ Error cargando proyecto:', error);
    showNotification('Ã¢ÂÅ’ Error cargando proyecto', 'error');
    isLoadingProject = false; // Desactivar bandera en caso de error
  });
}

// FunciÃƒÂ³n para actualizar botones segÃƒÂºn el estado del proyecto
function updateProjectButtons(project) {
  console.log('Ã°Å¸â€â€ž Actualizando botones del proyecto:', project);
  
  // Validar que el proyecto tenga la estructura esperada
  if (!project || typeof project !== 'object') {
    console.error('Ã¢ÂÅ’ Proyecto no vÃƒÂ¡lido:', project);
    return;
  }
  
  if (!project.completedSections || !Array.isArray(project.completedSections)) {
    console.error('Ã¢ÂÅ’ completedSections no vÃƒÂ¡lido:', project.completedSections);
    return;
  }
  
  if (!project.totalSections || typeof project.totalSections !== 'number') {
    console.error('Ã¢ÂÅ’ totalSections no vÃƒÂ¡lido:', project.totalSections);
    return;
  }
  
  const generateBtn = document.getElementById("generateBtn");
  const generateAudioBtn = document.getElementById("generateAudioBtn");
  const generateImagesControls = document.getElementById('generateMissingImagesControls');
  const generateImagesBtn = document.getElementById('generateMissingImagesBtn');
  
  if (!generateBtn || !generateAudioBtn) {
    console.error('Ã¢ÂÅ’ Botones no encontrados en el DOM');
    return;
  }

  if (generateImagesControls) {
    generateImagesControls.style.display = 'none';
  }
  if (generateImagesBtn) {
    generateImagesBtn.style.display = 'none';
  }
  
  const completedSections = project.completedSections.length;
  const totalSections = project.totalSections;
  const nextSection = completedSections + 1;
  
  // Ã¢Å¡Â Ã¯Â¸Â CRÃƒÂTICO: Actualizar variables globales para que coincidan con el estado del proyecto
  currentSectionNumber = completedSections;
  currentTopic = project.topic;
  window.totalSections = totalSections;
  window.currentSectionNumber = completedSections;
  window.currentTopic = project.topic;
  
  console.log('Ã°Å¸â€œÅ  Estado del proyecto:', {
    completedSections,
    totalSections,
    nextSection,
    isComplete: completedSections >= totalSections,
    'Variables globales actualizadas': {
      currentSectionNumber,
      currentTopic,
      totalSections
    }
  });
  
  // Ocultar todos los botones primero
  generateBtn.style.display = "none";
  generateAudioBtn.style.display = "none";
  
  if (completedSections === 0) {
    // No hay secciones completadas - mostrar botÃƒÂ³n de generar primera secciÃƒÂ³n
    generateBtn.style.display = "inline-flex";
    generateBtn.innerHTML = `
      <i class="fas fa-video"></i>
      <span>Generar SecciÃƒÂ³n 1</span>
    `;
  } else if (completedSections < totalSections) {
    // Hay secciones completadas pero no todas - mostrar botÃƒÂ³n de audio para la secciÃƒÂ³n actual
    generateAudioBtn.style.display = "inline-flex";
  } else {
    // Todas las secciones estÃƒÂ¡n completadas - mostrar botÃƒÂ³n de audio y botÃƒÂ³n de video
    generateAudioBtn.style.display = "inline-flex";
    
    // Mostrar botÃƒÂ³n de generaciÃƒÂ³n de video manual
    showVideoGenerationButton();
    
    // Ã°Å¸Å½Â¬ VERIFICAR GENERACIÃƒâ€œN AUTOMÃƒÂTICA DE VIDEO
    // Solo generar automÃƒÂ¡ticamente si no se ha generado ya y estÃƒÂ¡ activada la opciÃƒÂ³n
    if (shouldGenerateVideoAutomatically()) {
      const folderName = document.getElementById("folderName").value.trim();
      if (folderName && !isGeneratingVideo) {
        console.log('Ã°Å¸Å½Â¬ Proyecto completo - iniciando generaciÃƒÂ³n automÃƒÂ¡tica de video...');
        // Delay para permitir que se complete la visualizaciÃƒÂ³n del proyecto
        setTimeout(() => {
          generateVideoAutomatically();
        }, 2000);
      }
    }
  }
  
  // Siempre mostrar el botÃƒÂ³n de regenerar audios cuando hay un proyecto cargado
  // (independientemente del estado de completado)
  if (window.currentProject) {
    // Solo mostrar el contenedor de video si no hay mÃƒÂºltiples proyectos paralelos
    const hasMultipleProjects = projectProgressContainers.size > 1;
    if (!hasMultipleProjects) {
      const videoContainer = document.getElementById('videoGenerationContainer');
      if (videoContainer) {
        videoContainer.style.display = 'block';
      }
    }
    
    // Actualizar visibility del botÃƒÂ³n de regenerar audios
    const regenerateAudioBtn = document.getElementById('regenerateApplioAudiosBtn');
    if (regenerateAudioBtn) {
      regenerateAudioBtn.style.display = 'inline-flex';
      console.log('Ã°Å¸Å½Â¤ BotÃƒÂ³n de regenerar audios mostrado para proyecto cargado');
    }
    
    // Actualizar visibility del botÃƒÂ³n de regenerar guiones
    const regenerateScriptsBtn = document.getElementById('regenerateMissingScriptsBtn');
    if (regenerateScriptsBtn) {
      regenerateScriptsBtn.style.display = 'inline-flex';
      console.log('Ã°Å¸â€œÂ BotÃƒÂ³n de regenerar guiones mostrado para proyecto cargado');
    }
    
    // Actualizar visibility del botÃƒÂ³n de generar imÃƒÂ¡genes faltantes
    if (generateImagesBtn) {
      generateImagesBtn.style.display = 'inline-flex';
      console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â BotÃƒÂ³n de generar imÃƒÂ¡genes mostrado para proyecto cargado');
    }
    if (generateImagesControls) {
      generateImagesControls.style.display = 'flex';
    }
    
    // Actualizar visibility del botÃƒÂ³n de generar solo prompts
    const generatePromptsBtn = document.getElementById('generateMissingPromptsBtn');
    if (generatePromptsBtn) {
      generatePromptsBtn.style.display = 'inline-flex';
      console.log('Ã°Å¸â€œÂ BotÃƒÂ³n de generar prompts mostrado para proyecto cargado');
    }

    // Actualizar visibility del botÃƒÂ³n de descargar zip (mostrar siempre que haya proyecto cargado)
    const downloadZipBtn = document.getElementById('downloadProjectZipBtn');
    if (downloadZipBtn) {
      downloadZipBtn.style.display = 'inline-flex';
      console.log('ðŸ“¦ BotÃ³n de descargar proyecto (ZIP) mostrado para proyecto cargado');
    }

    // Mostrar botÃ³n de Descargar Contenido (B-Roll)
    const brollQuickBtn = document.getElementById('brollQuickBtn');
    if (brollQuickBtn) {
      brollQuickBtn.style.display = 'inline-flex';
    }

    // Actualizar visibility del panel de traducciÃƒÂ³n
    const translationPanel = document.getElementById('translationPanel');
    if (translationPanel) {
      translationPanel.style.display = 'block';
      console.log('Ã°Å¸Å’Â Panel de traducciÃƒÂ³n mostrado para proyecto cargado');
    }

    updateSectionClipButtons(project);
    updateSectionImageButtons(project);
    updateYouTubeMetadataButtonState();

    // Mostrar panel de B-Roll
    const brollPanel = document.getElementById('brollPanel');
    if (brollPanel) {
      brollPanel.style.display = 'block';
    }
  }
  
  console.log('Ã¢Å“â€¦ Botones actualizados correctamente');
}

// FunciÃƒÂ³n auxiliar para cargar prompts en el sidebar
function loadPromptsInSidebar(prompts, sectionNumber) {
  console.log('Ã°Å¸Å½Â¨ Cargando prompts en panel lateral');
  
  // Mostrar panel de prompts
  const promptsSidebar = document.getElementById('promptsSidebar');
  if (promptsSidebar) {
    promptsSidebar.classList.add('expanded');
  }
  
  // Buscar el contenedor de prompts en el panel lateral
  const promptsContainer = document.querySelector('#promptsSidebar .prompts-list') || 
                         document.querySelector('#promptsSidebar .sidebar-content') ||
                         document.querySelector('#promptsSidebar');
  
  if (promptsContainer) {
    // Crear lista de prompts
    const promptsHTML = `
      <div class="loaded-prompts">
        <h4>Ã°Å¸Å½Â¨ Prompts de SecciÃƒÂ³n ${sectionNumber}</h4>
        ${prompts.map((prompt, index) => `
          <div class="prompt-item-sidebar">
            <div class="prompt-header-sidebar">
              <strong>Prompt ${index + 1}</strong>
              <button class="copy-btn-sidebar" onclick="copyToClipboard(\`${prompt.replace(/`/g, '\\`')}\`)">
                <i class="fas fa-copy"></i>
              </button>
            </div>
            <div class="prompt-text-sidebar">${prompt}</div>
          </div>
        `).join('')}
      </div>
    `;
    
    // Limpiar prompts anteriores y agregar nuevos
    const existingPrompts = promptsContainer.querySelector('.loaded-prompts');
    if (existingPrompts) {
      existingPrompts.remove();
    }
    
    promptsContainer.insertAdjacentHTML('beforeend', promptsHTML);
  }
}

// FunciÃƒÂ³n para obtener el estado actual del proyecto
function getCurrentProjectState() {
  console.log('Ã°Å¸â€œâ€¹ Obteniendo estado del proyecto actual:', window.currentProject);
  return window.currentProject;
}

// FunciÃƒÂ³n para cargar detalles de una secciÃƒÂ³n especÃƒÂ­fica con datos del proyecto
function loadSectionDetailsWithProject(sectionNumber, folderName, projectData) {
  console.log('Ã°Å¸â€Â Cargando detalles de secciÃƒÂ³n con proyecto:', sectionNumber, folderName, projectData);
  
  isLoadingProject = true; // Activar bandera de carga
  
  if (!projectData || !projectData.completedSections) {
    console.error('Ã¢ÂÅ’ Datos del proyecto no vÃƒÂ¡lidos');
    showNotification('Ã¢ÂÅ’ Datos del proyecto no vÃƒÂ¡lidos', 'error');
    isLoadingProject = false; // Desactivar en caso de error
    return;
  }
  
  const section = projectData.completedSections.find(s => s.section === sectionNumber);
  if (!section) {
    console.error('Ã¢ÂÅ’ SecciÃƒÂ³n no encontrada:', sectionNumber);
    showNotification('Ã¢ÂÅ’ SecciÃƒÂ³n no encontrada', 'error');
    isLoadingProject = false; // Desactivar en caso de error
    return;
  }
  
  console.log('Ã°Å¸â€œâ€¹ Datos de la secciÃƒÂ³n encontrada:', section);
  
  // Crear modal para mostrar detalles de la secciÃƒÂ³n
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'block';
  modal.innerHTML = `
    <div class="modal-content section-detail-modal">
      <div class="modal-header">
        <h3><i class="fas fa-file-alt"></i> SecciÃƒÂ³n ${sectionNumber} - Detalles</h3>
        <span class="close" onclick="closeSectionModal()">&times;</span>
      </div>
      
      <div class="section-detail-content">
        <div class="detail-tabs">
          <button class="detail-tab active" onclick="showSectionTab(event, 'script-tab')">
            <i class="fas fa-file-text"></i> Script
          </button>
          <button class="detail-tab" onclick="showSectionTab(event, 'images-tab')">
            <i class="fas fa-images"></i> ImÃƒÂ¡genes
          </button>
          <button class="detail-tab" onclick="showSectionTab(event, 'prompts-tab')">
            <i class="fas fa-palette"></i> Prompts
          </button>
        </div>
        
        <div id="script-tab" class="tab-content active">
          <h4>Ã°Å¸Å½Â¬ Script Generado</h4>
          <div class="script-content">
            ${section.script ? 
              `<pre class="script-text">${section.script}</pre>` : 
              '<p class="no-content">Ã¢ÂÅ’ No hay script generado para esta secciÃƒÂ³n</p>'
            }
          </div>
        </div>
        
        <div id="images-tab" class="tab-content">
          <h4>Ã°Å¸â€“Â¼Ã¯Â¸Â GestiÃƒÂ³n de ImÃƒÂ¡genes</h4>
          <div class="images-content">
            ${section.googleImagesMode ? `
              <div class="google-images-info">
                <p><strong>Ã°Å¸â€â€” Modo Google Images activado</strong></p>
                <p>Las imÃƒÂ¡genes se buscarÃƒÂ¡n automÃƒÂ¡ticamente desde Google Images</p>
                ${section.keywords ? `<p><strong>Keywords:</strong> ${section.keywords.join(', ')}</p>` : ''}
              </div>
            ` : section.imageUrls && section.imageUrls.length > 0 ? `
              <div class="generated-images">
                <p><strong>Ã°Å¸â€œÅ  ImÃƒÂ¡genes generadas: ${section.imageUrls.length}</strong></p>
                <div class="image-grid">
                  ${section.imageUrls.map((url, index) => `
                    <div class="image-item">
                      <img src="${url}" alt="Imagen ${index + 1}" onclick="window.open('${url}', '_blank')">
                      <div class="image-info">Imagen ${index + 1}</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : '<p class="no-content">Ã¢ÂÅ’ No hay imÃƒÂ¡genes para esta secciÃƒÂ³n</p>'}
          </div>
        </div>
        
        <div id="prompts-tab" class="tab-content">
          <h4>Ã°Å¸Å½Â¨ Prompts de Imagen</h4>
          <div class="prompts-content">
            ${section.prompts && section.prompts.length > 0 ? `
              <div class="prompts-list">
                ${section.prompts.map((prompt, index) => `
                  <div class="prompt-item">
                    <div class="prompt-header">
                      <strong>Prompt ${index + 1}</strong>
                      <button class="copy-btn" onclick="copyToClipboard(\`${prompt.replace(/`/g, '\\`')}\`)">
                        <i class="fas fa-copy"></i>
                      </button>
                    </div>
                    <div class="prompt-text">${prompt}</div>
                  </div>
                `).join('')}
              </div>
            ` : '<p class="no-content">Ã¢ÂÅ’ No hay prompts generados para esta secciÃƒÂ³n</p>'}
          </div>
        </div>
      </div>
      
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeSectionModal()">
          <i class="fas fa-times"></i> Cerrar
        </button>
        <button class="btn btn-primary" onclick="loadProjectSectionWithProject(${sectionNumber}, '${projectData.folderName}')">
          <i class="fas fa-play"></i> Cargar en Editor
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  isLoadingProject = false; // Desactivar bandera de carga al finalizar
}

// FunciÃƒÂ³n para cargar una secciÃƒÂ³n especÃƒÂ­fica en el editor con datos del proyecto
function loadProjectSectionWithProject(sectionNumber, folderNameOrProject) {
  console.log('Ã°Å¸â€œÂ¥ Cargando secciÃƒÂ³n en editor:', sectionNumber, folderNameOrProject);
  
  // Si es un string, es el folderName, cargar el proyecto completo
  if (typeof folderNameOrProject === 'string') {
    console.log('Ã°Å¸â€œâ€š Cargando proyecto:', folderNameOrProject);
    loadProject(folderNameOrProject).then(() => {
      // DespuÃƒÂ©s de cargar el proyecto, cargar la secciÃƒÂ³n especÃƒÂ­fica
      const projectState = getCurrentProjectState();
      if (projectState) {
        const section = projectState.completedSections.find(s => s.section === sectionNumber);
        if (section) {
          loadProjectSectionData(sectionNumber, section);
        }
      }
    });
  } else {
    // Si es un objeto, usar los datos directamente
    const projectData = folderNameOrProject;
    if (!projectData || !projectData.completedSections) {
      console.error('Ã¢ÂÅ’ Datos del proyecto no vÃƒÂ¡lidos');
      showNotification('Ã¢ÂÅ’ Datos del proyecto no vÃƒÂ¡lidos', 'error');
      return;
    }
    
    const section = projectData.completedSections.find(s => s.section === sectionNumber);
    if (!section) {
      console.error('Ã¢ÂÅ’ SecciÃƒÂ³n no encontrada:', sectionNumber);
      showNotification('Ã¢ÂÅ’ SecciÃƒÂ³n no encontrada', 'error');
      return;
    }
    
    // Primero cargar el proyecto si no estÃƒÂ¡ activo
    if (!window.currentProject || window.currentProject.folderName !== projectData.folderName) {
      console.log('Ã°Å¸â€œâ€š Cargando proyecto antes de cargar secciÃƒÂ³n');
      loadProject(projectData.folderName).then(() => {
        // DespuÃƒÂ©s de cargar el proyecto, cargar la secciÃƒÂ³n
        loadProjectSectionData(sectionNumber, section);
      });
    } else {
      // Si el proyecto ya estÃƒÂ¡ activo, cargar directamente la secciÃƒÂ³n
      loadProjectSectionData(sectionNumber, section);
    }
  }
}

// FunciÃƒÂ³n auxiliar para cargar datos de secciÃƒÂ³n
function loadProjectSectionData(sectionNumber, section) {
  console.log('Ã°Å¸â€œâ€¹ Cargando datos de secciÃƒÂ³n en interfaz:', sectionNumber, section);
  
  // Actualizar variables globales
  if (window.currentProject) {
    // Para el botÃƒÂ³n continuar, currentSectionNumber debe ser el nÃƒÂºmero de secciones completadas
    currentSectionNumber = window.currentProject.completedSections.length;
    window.currentSectionNumber = window.currentProject.completedSections.length;
    window.totalSections = window.currentProject.totalSections;
    window.currentTopic = window.currentProject.topic;
    
    // TambiÃƒÂ©n actualizar variables globales para compatibilidad
    currentTopic = window.currentProject.topic;
    totalSections = window.currentProject.totalSections;
    
    console.log('Ã°Å¸â€œÅ  Variables actualizadas en loadProjectSectionData:', {
      currentSectionNumber,
      totalSections,
      completedSections: window.currentProject.completedSections.length,
      showingSection: sectionNumber
    });
    
    // Configurar allSections para la navegaciÃƒÂ³n
    allSections = new Array(window.currentProject.totalSections); // Usar variable global directa
    
    // Llenar allSections con los scripts de las secciones completadas
    window.currentProject.completedSections.forEach(completedSection => {
      if (completedSection.script) {
        allSections[completedSection.section - 1] = completedSection.script;
      }
    });
    
    console.log('Ã°Å¸â€œÅ¡ allSections configurado:', allSections.map((s, i) => s ? `${i+1}: Ã¢Å“â€¦` : `${i+1}: Ã¢ÂÅ’`).join(', '));
  }
  
  // Actualizar el ÃƒÂ¡rea del script principal usando la funciÃƒÂ³n existente
  if (section.script) {
    console.log('Ã°Å¸â€œÂ Mostrando script en interfaz');
    // Usar la funciÃƒÂ³n existente para mostrar el script
    showScript(section.script, sectionNumber, window.totalSections || 3);
    
    // Asegurar que la secciÃƒÂ³n del script sea visible
    const scriptSection = document.getElementById("script-section");
    if (scriptSection) {
      scriptSection.style.display = 'block';
    }
    
    // Inicializar navegaciÃƒÂ³n entre secciones
    setTimeout(() => {
      initializeSectionNavigation();
      updateNavigationButtons();
    }, 200);
  }
  
  // Actualizar el tema si existe el campo
  const promptArea = document.getElementById('prompt');
  if (promptArea && window.currentProject) {
    promptArea.value = window.currentProject.topic;
    console.log('Ã°Å¸â€œÂ Tema del guiÃƒÂ³n actualizado en secciÃƒÂ³n:', window.currentProject.topic);
  } else {
    console.warn('Ã¢Å¡Â Ã¯Â¸Â No se pudo actualizar el tema del guiÃƒÂ³n - elemento:', !!promptArea, 'proyecto:', !!window.currentProject);
  }
  
  // Cargar configuraciÃƒÂ³n de checkboxes desde el proyecto actual
  if (window.currentProject) {
    const skipImagesElement = document.getElementById('skipImages');
    if (skipImagesElement && typeof window.currentProject.skipImages === 'boolean') {
      skipImagesElement.checked = window.currentProject.skipImages;
      console.log('Ã°Å¸Å¡Â« Skip imÃƒÂ¡genes actualizado en secciÃƒÂ³n:', window.currentProject.skipImages);
    }
    
    const googleImagesElement = document.getElementById('googleImages');
    if (googleImagesElement && typeof window.currentProject.googleImages === 'boolean') {
      googleImagesElement.checked = window.currentProject.googleImages;
      console.log('Ã°Å¸â€â€” Google Images actualizado en secciÃƒÂ³n:', window.currentProject.googleImages);
    }
  }
  
  // Cargar prompts en el panel lateral si existen
  if (section.imagePrompts && section.imagePrompts.length > 0) {
    console.log(`Ã°Å¸Å½Â¨ Cargando ${section.imagePrompts.length} prompts de la secciÃƒÂ³n ${sectionNumber} en panel lateral`);
    
    // Limpiar el panel antes de cargar nuevos prompts de una secciÃƒÂ³n especÃƒÂ­fica
    clearPromptsSidebar();
    
    // Usar la funciÃƒÂ³n estÃƒÂ¡ndar para aÃƒÂ±adir prompts
    addPromptsToSidebar(section.imagePrompts, sectionNumber);
    
  } else if (section.imageUrls && section.imageUrls.length > 0) {
    console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â SecciÃƒÂ³n ${sectionNumber} tiene ${section.imageUrls.length} URLs de imÃƒÂ¡genes generadas`);
    
    // Si tiene URLs pero no prompts, crear prompts genÃƒÂ©ricos
    const genericPrompts = section.imageUrls.map((url, index) => `Imagen ${index + 1} - URL: ${url}`);
    clearPromptsSidebar();
    addPromptsToSidebar(genericPrompts, sectionNumber);
    
  } else if (section.googleImagesMode) {
    console.log(`Ã°Å¸â€â€” SecciÃƒÂ³n ${sectionNumber} configurada para Google Images automÃƒÂ¡tico`);
    
    // Para Google Images, mostrar un indicador
    const googleImageIndicator = [`SecciÃƒÂ³n ${sectionNumber} configurada para usar Google Images automÃƒÂ¡tico`];
    clearPromptsSidebar();
    addPromptsToSidebar(googleImageIndicator, sectionNumber);
  }
  
  // Actualizar modo de imÃƒÂ¡genes si estÃƒÂ¡ activado
  if (section.googleImagesMode) {
    const useGoogleImagesCheckbox = document.getElementById('useGoogleImages');
    if (useGoogleImagesCheckbox) {
      useGoogleImagesCheckbox.checked = true;
    }
  }
  
  // Mostrar informaciÃƒÂ³n sobre las imÃƒÂ¡genes
  if (section.imageUrls && section.imageUrls.length > 0) {
    console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Mostrando informaciÃƒÂ³n de imÃƒÂ¡genes generadas');
    
    // Mostrar carrusel de imÃƒÂ¡genes si existe la funciÃƒÂ³n
    if (typeof showImageCarousel === 'function') {
      showImageCarousel(section.imageUrls, sectionNumber);
    } else {
      // Mostrar carrusel bÃƒÂ¡sico
      const carouselContainer = document.getElementById('carousel-container');
      if (carouselContainer) {
        carouselContainer.style.display = 'block';
        const carouselTrack = document.getElementById('carouselTrack');
        const carouselTitle = document.getElementById('carousel-section-title');
        const totalImagesSpan = document.getElementById('total-images');
        const currentImageSpan = document.getElementById('current-image');
        
        if (carouselTitle) {
          carouselTitle.textContent = `SecciÃƒÂ³n ${sectionNumber}`;
        }
        
        if (totalImagesSpan) {
          totalImagesSpan.textContent = section.imageUrls.length;
        }
        
        if (currentImageSpan) {
          currentImageSpan.textContent = '1';
        }
        
        if (carouselTrack) {
          carouselTrack.innerHTML = section.imageUrls.map((url, index) => `
            <div class="carousel-slide ${index === 0 ? 'active' : ''}">
              <img src="${url}" alt="Imagen ${index + 1}" loading="lazy">
            </div>
          `).join('');
        }
      }
    }
    
    showNotification(`Ã°Å¸â€œÂ¸ SecciÃƒÂ³n ${sectionNumber} tiene ${section.imageUrls.length} imÃƒÂ¡genes generadas`, 'info');
  } else if (section.googleImagesMode) {
    console.log('Ã°Å¸â€â€” Modo Google Images activado para esta secciÃƒÂ³n');
    showNotification(`Ã°Å¸â€â€” SecciÃƒÂ³n ${sectionNumber} usa Google Images automÃƒÂ¡tico`, 'info');
  }
  
  // Cerrar modal
  closeSectionModal();
  
  // Actualizar estado de los botones segÃƒÂºn el progreso del proyecto
  updateProjectButtons(window.currentProject);
  
  showNotification(`Ã¢Å“â€¦ SecciÃƒÂ³n ${sectionNumber} cargada en editor`, 'success');
}

// FunciÃƒÂ³n para cerrar modal de secciÃƒÂ³n
function closeSectionModal() {
  const modal = document.querySelector('.section-detail-modal');
  if (modal) {
    modal.closest('.modal').remove();
  }
}

// Exponer funciones globalmente
window.loadSectionDetails = loadSectionDetails;
window.closeSectionModal = closeSectionModal;

// FunciÃƒÂ³n para cambiar entre tabs del detalle de secciÃƒÂ³n
function showSectionTab(event, tabId) {
  console.log('Ã°Å¸â€â€ž Cambiando a tab:', tabId);
  // Remover clase active de todos los tabs
  document.querySelectorAll('.detail-tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  // Activar el tab seleccionado
  event.target.closest('.detail-tab').classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

// FunciÃƒÂ³n para cargar una secciÃƒÂ³n especÃƒÂ­fica en el editor
function loadProjectSection(sectionNumber) {
  console.log('Ã°Å¸â€œÂ¥ Cargando secciÃƒÂ³n en editor:', sectionNumber);
  
  const projectState = getCurrentProjectState();
  if (!projectState) {
    console.error('Ã¢ÂÅ’ No hay proyecto activo');
    showNotification('Ã¢ÂÅ’ No hay proyecto activo', 'error');
    return;
  }
  
  const section = projectState.completedSections.find(s => s.section === sectionNumber);
  if (!section) {
    console.error('Ã¢ÂÅ’ SecciÃƒÂ³n no encontrada:', sectionNumber);
    showNotification('Ã¢ÂÅ’ SecciÃƒÂ³n no encontrada', 'error');
    return;
  }
  
  // Actualizar el nÃƒÂºmero de secciÃƒÂ³n actual
  const sectionInput = document.getElementById('sectionNumber');
  if (sectionInput) {
    sectionInput.value = sectionNumber;
  }
  
  // Cargar el script en el ÃƒÂ¡rea de texto
  const scriptArea = document.getElementById('script');
  if (scriptArea && section.script) {
    scriptArea.value = section.script;
    // Ajustar altura del textarea
    scriptArea.style.height = 'auto';
    scriptArea.style.height = scriptArea.scrollHeight + 'px';
  }
  
  // Actualizar modo de imÃƒÂ¡genes
  if (section.googleImagesMode) {
    const googleImagesCheckbox = document.getElementById('useGoogleImages');
    if (googleImagesCheckbox) {
      googleImagesCheckbox.checked = true;
    }
  }
  
  // Cargar prompts si existen
  if (section.prompts && section.prompts.length > 0) {
    const promptsArea = document.getElementById('prompts');
    if (promptsArea) {
      promptsArea.value = section.prompts.join('\n\n---\n\n');
      // Ajustar altura del textarea
      promptsArea.style.height = 'auto';
      promptsArea.style.height = promptsArea.scrollHeight + 'px';
    }
  }
  
  // Cerrar modal
  closeSectionModal();
  
  showNotification(`Ã¢Å“â€¦ SecciÃƒÂ³n ${sectionNumber} cargada en editor`, 'success');
}

// FunciÃƒÂ³n para auto-redimensionar textareas
function autoResize(textarea) {
  if (textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }
}

// Exponer todas las funciones globalmente
window.getCurrentProjectState = getCurrentProjectState;
window.loadSectionDetails = loadSectionDetails;
window.loadSectionDetailsWithProject = loadSectionDetailsWithProject;
window.loadProjectSectionWithProject = loadProjectSectionWithProject;
window.loadProjectSectionData = loadProjectSectionData;
window.activateFullProject = activateFullProject;
window.loadPromptsInSidebar = loadPromptsInSidebar;
window.showSectionTab = showSectionTab;
window.copyToClipboard = copyToClipboard;
window.loadProjectSection = loadProjectSection;
window.autoResize = autoResize;
window.initializeSectionNavigation = initializeSectionNavigation;
window.updateNavigationButtons = updateNavigationButtons;

// FunciÃƒÂ³n para actualizar el tÃƒÂ­tulo del capÃƒÂ­tulo
function updateChapterTitle(sectionNum) {
  const chapterTitleContainer = document.getElementById('chapter-title-container');
  const chapterTitleSpan = document.getElementById('chapter-title');
  
  if (!chapterTitleContainer || !chapterTitleSpan) {
    return;
  }
  
  if (globalChapterStructure && globalChapterStructure.length > 0 && sectionNum <= globalChapterStructure.length) {
    const chapterTitle = globalChapterStructure[sectionNum - 1];
    if (chapterTitle && chapterTitle.trim()) {
      chapterTitleSpan.textContent = chapterTitle.trim();
      chapterTitleContainer.style.display = 'block';
      return;
    }
  }
  
  // Ocultar si no hay tÃƒÂ­tulo disponible
  chapterTitleContainer.style.display = 'none';
}

// FunciÃƒÂ³n para almacenar la estructura de capÃƒÂ­tulos cuando se recibe del servidor
function storeChapterStructure(chapterStructure) {
  globalChapterStructure = chapterStructure || [];
  console.log('Ã°Å¸â€œÅ¡ Estructura de capÃƒÂ­tulos almacenada:', globalChapterStructure.length, 'capÃƒÂ­tulos');
}

// FunciÃƒÂ³n para actualizar la informaciÃƒÂ³n de tokens
function updateTokenUsage(tokenUsage) {
  const tokenContainer = document.getElementById('token-usage-container');
  const inputTokensSpan = document.getElementById('input-tokens');
  const outputTokensSpan = document.getElementById('output-tokens');
  const totalTokensSpan = document.getElementById('total-tokens');
  const modelUsedSpan = document.getElementById('model-used');
  
  if (!tokenContainer || !inputTokensSpan || !outputTokensSpan || !totalTokensSpan || !modelUsedSpan) {
    return;
  }
  
  if (tokenUsage) {
    inputTokensSpan.textContent = tokenUsage.inputTokens.toLocaleString();
    outputTokensSpan.textContent = tokenUsage.outputTokens.toLocaleString();
    totalTokensSpan.textContent = tokenUsage.totalTokens.toLocaleString();
    modelUsedSpan.textContent = tokenUsage.model || 'N/A';
    tokenContainer.style.display = 'block';
    
    console.log('Ã°Å¸â€œÅ  InformaciÃƒÂ³n de tokens actualizada:', tokenUsage);
  } else {
    tokenContainer.style.display = 'none';
  }
}

// Exponer funciÃƒÂ³n globalmente
window.updateTokenUsage = updateTokenUsage;

// Exponer funciones globalmente
window.updateChapterTitle = updateChapterTitle;
window.storeChapterStructure = storeChapterStructure;

// =====================================
// FUNCIONES ADICIONALES PARA IMÃƒÂGENES DE BING
// =====================================

function downloadBingImage(imageUrl, filename) {
  console.log(`Ã°Å¸â€œÂ¥ Descargando imagen: ${filename}`);
  
  const link = document.createElement('a');
  link.href = imageUrl;
  link.download = filename || 'bing_image.jpg';
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function showBingImageFullscreen(imageUrl, caption) {
  console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â Mostrando imagen en pantalla completa: ${caption}`);
  
  // Crear modal para imagen completa
  const modal = document.createElement('div');
  modal.className = 'bing-image-modal';
  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeBingImageModal()">
      <div class="modal-content" onclick="event.stopPropagation()">
        <button class="modal-close" onclick="closeBingImageModal()">
          <i class="fas fa-times"></i>
        </button>
        <img src="${imageUrl}" alt="${caption}" />
        <div class="modal-caption">${caption}</div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  modal.style.display = 'flex';
}

function closeBingImageModal() {
  const modal = document.querySelector('.bing-image-modal');
  if (modal) {
    modal.remove();
  }
}

// Exponer funciones globalmente
window.downloadBingImage = downloadBingImage;
window.showBingImageFullscreen = showBingImageFullscreen;
window.closeBingImageModal = closeBingImageModal;
window.refreshBingImageWithCustomKeyword = refreshBingImageWithCustomKeyword;

// FunciÃƒÂ³n para refrescar una imagen especÃƒÂ­fica
async function refreshBingImage(imageIndex, sectionNum) {
  console.log(`Ã°Å¸â€â€ž Refrescando imagen ${imageIndex} de la secciÃƒÂ³n ${sectionNum}`);
  
  // Verificar que tenemos keywords para esta imagen
  if (!currentImageKeywords || !currentImageKeywords[imageIndex]) {
    console.error(`Ã¢ÂÅ’ No hay keywords disponibles para la imagen ${imageIndex}`);
    console.log(`Ã°Å¸â€Â DEBUG - currentImageKeywords:`, currentImageKeywords);
    console.log(`Ã°Å¸â€Â DEBUG - imageIndex:`, imageIndex);
    alert('No se pueden obtener nuevas keywords para esta imagen. Por favor, genera el contenido nuevamente.');
    return;
  }
  
  // Obtener el nombre de la carpeta actual del proyecto cargado
  let folderName;
  if (window.currentProject && window.currentProject.folderName) {
    folderName = window.currentProject.folderName;
    console.log(`Ã°Å¸â€œÂ Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    const folderNameElement = document.getElementById('folderName');
    if (!folderNameElement) {
      console.error('Ã¢ÂÅ’ No se pudo obtener el nombre del proyecto');
      alert('Error: No se pudo obtener el nombre del proyecto');
      return;
    }
    folderName = folderNameElement.value.trim();
    console.log(`Ã°Å¸â€œÂ Usando folderName del elemento HTML: ${folderName}`);
  }
  
  // Obtener las imÃƒÂ¡genes actuales del carrusel para mantener mapeo correcto
  const currentImages = [];
  const carouselSlides = document.querySelectorAll('.carousel-slide img');
  carouselSlides.forEach(img => {
    currentImages.push({
      url: img.src.split('?')[0], // Remover query params para obtener URL limpia
      alt: img.alt
    });
  });
  
  console.log(`Ã°Å¸Å½Â¯ ImÃƒÂ¡genes actuales detectadas:`, currentImages.map((img, i) => `${i}: ${img.url.split('/').pop()}`));
  console.log(`Ã°Å¸Å½Â¯ Refrescando imagen en posiciÃƒÂ³n visual ${imageIndex}: ${currentImages[imageIndex]?.url.split('/').pop()}`);
  
  try {
    // Mostrar indicador de carga en el botÃƒÂ³n
    const refreshButton = document.querySelector(`[onclick="refreshBingImage(${imageIndex}, ${sectionNum})"]`);
    if (refreshButton) {
      refreshButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      refreshButton.disabled = true;
    }
    
    // Hacer peticiÃƒÂ³n al backend para refrescar la imagen
    const response = await fetch('/api/refresh-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        folderName: folderName,
        imageIndex: imageIndex,
        sectionNum: sectionNum,
        keywords: currentImageKeywords[imageIndex],
        currentImages: currentImages // Enviar mapeo actual de imÃƒÂ¡genes
      })
    });
    
    if (!response.ok) {
      throw new Error(`Error del servidor: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`Ã¢Å“â€¦ Nueva imagen descargada: ${result.newImage.filename}`);
      console.log(`Ã°Å¸Å½Â¯ Mapeo confirmado: posiciÃƒÂ³n visual ${imageIndex} Ã¢â€ â€™ ${result.newImage.filename}`);
      
      // Actualizar la imagen en el carrusel con efecto visual
      const currentSlideImg = document.querySelector('.carousel-slide:nth-child(' + (imageIndex + 1) + ') img');
      if (currentSlideImg) {
        // AÃƒÂ±adir efecto de transiciÃƒÂ³n suave
        currentSlideImg.style.opacity = '0.3';
        currentSlideImg.style.transition = 'opacity 0.3s ease';
        
        // Crear nueva imagen para precargar
        const newImg = new Image();
        newImg.onload = function() {
          // Una vez cargada la nueva imagen, actualizar con timestamp para evitar cache
          currentSlideImg.src = result.newImage.url + '?t=' + Date.now();
          currentSlideImg.alt = `Nueva imagen ${imageIndex + 1} de la SecciÃƒÂ³n ${sectionNum}`;
          
          // Restaurar opacidad con efecto suave
          setTimeout(() => {
            currentSlideImg.style.opacity = '1';
          }, 100);
        };
        
        newImg.onerror = function() {
          // Si hay error cargando la imagen, restaurar opacidad
          currentSlideImg.style.opacity = '1';
        };
        
        // Iniciar precarga de la nueva imagen
        newImg.src = result.newImage.url + '?t=' + Date.now();
      }
      
      // Mostrar notificaciÃƒÂ³n de ÃƒÂ©xito
      showNotification('Ã¢Å“â€¦ Imagen renovada exitosamente', 'success');
      
    } else {
      throw new Error(result.error || 'Error desconocido');
    }
    
  } catch (error) {
    console.error(`Ã¢ÂÅ’ Error refrescando imagen:`, error);
    showNotification(`Ã¢ÂÅ’ Error renovando imagen: ${error.message}`, 'error');
  } finally {
    // Restaurar el botÃƒÂ³n
    const refreshButton = document.querySelector(`[onclick="refreshBingImage(${imageIndex}, ${sectionNum})"]`);
    if (refreshButton) {
      refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i>';
      refreshButton.disabled = false;
    }
  }
}

// FunciÃƒÂ³n para refrescar una imagen con keyword personalizado
async function refreshBingImageWithCustomKeyword(imageIndex, sectionNum) {
  console.log(`Ã°Å¸â€â€ž Refrescando imagen ${imageIndex} de la secciÃƒÂ³n ${sectionNum} con keyword personalizado`);
  
  // Obtener el keyword del input field
  const keywordInput = document.getElementById(`keyword-${imageIndex}-${sectionNum}`);
  if (!keywordInput) {
    console.error(`Ã¢ÂÅ’ No se encontrÃƒÂ³ el input de keyword para imagen ${imageIndex}`);
    alert('Error: No se pudo obtener el tÃƒÂ©rmino de bÃƒÂºsqueda');
    return;
  }
  
  const customKeyword = keywordInput.value.trim();
  if (!customKeyword) {
    alert('Por favor, ingresa un tÃƒÂ©rmino de bÃƒÂºsqueda antes de refrescar la imagen');
    return;
  }
  
  // Obtener el nombre de la carpeta actual del proyecto cargado
  let folderName;
  if (window.currentProject && window.currentProject.folderName) {
    folderName = window.currentProject.folderName;
    console.log(`Ã°Å¸â€œÂ Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    const folderNameElement = document.getElementById('folderName');
    if (!folderNameElement) {
      console.error('Ã¢ÂÅ’ No se pudo obtener el nombre del proyecto');
      alert('Error: No se pudo obtener el nombre del proyecto');
      return;
    }
    folderName = folderNameElement.value.trim();
    console.log(`Ã°Å¸â€œÂ Usando folderName del elemento HTML: ${folderName}`);
  }
  
  // Obtener las imÃƒÂ¡genes actuales del carrusel para mantener mapeo correcto
  const carouselTrack = document.querySelector('.carousel-track');
  const currentImages = Array.from(carouselTrack.querySelectorAll('.carousel-slide img')).map((img, index) => {
    const filename = img.src.split('/').pop().split('?')[0]; // Extraer filename de la URL
    return {
      url: img.src,
      alt: img.alt,
      index: index,
      filename: filename
    };
  });
  
  console.log(`Ã°Å¸Å½Â¯ ImÃƒÂ¡genes actuales detectadas:`, currentImages.map((img, i) => `${i}: ${img.filename}`));
  console.log(`Ã°Å¸Å½Â¯ Refrescando imagen en posiciÃƒÂ³n visual ${imageIndex}: ${currentImages[imageIndex]?.filename}`);
  
  try {
    // Mostrar indicador de carga en el botÃƒÂ³n
    const refreshButton = document.querySelector(`[onclick="refreshBingImageWithCustomKeyword(${imageIndex}, ${sectionNum})"]`);
    if (refreshButton) {
      refreshButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      refreshButton.disabled = true;
    }
    
    const response = await fetch('/api/refresh-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        folderName: folderName,
        imageIndex: imageIndex,
        sectionNum: sectionNum,
        keywords: customKeyword, // Usar keyword personalizado
        currentImages: currentImages
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`Ã¢Å“â€¦ Nueva imagen descargada: ${result.filename}`);
      console.log(`Ã°Å¸Å½Â¯ Mapeo confirmado: posiciÃƒÂ³n visual ${imageIndex} Ã¢â€ â€™ ${result.filename}`);
      
      // Actualizar la imagen en el carrusel
      const currentSlide = document.querySelectorAll('.carousel-slide')[imageIndex];
      if (currentSlide) {
        const img = currentSlide.querySelector('img');
        if (img) {
          // Agregar timestamp para evitar cachÃƒÂ©
          const timestamp = new Date().getTime();
          img.src = `${result.newImageUrl}?t=${timestamp}`;
          
          // Actualizar el keyword almacenado
          if (currentImageKeywords && currentImageKeywords[imageIndex]) {
            currentImageKeywords[imageIndex] = customKeyword;
            console.log(`Ã°Å¸Å½Â¯ Keyword actualizado: posiciÃƒÂ³n ${imageIndex} Ã¢â€ â€™ "${customKeyword}"`);
          }
        }
      }
      
      showNotification(`Ã¢Å“â€¦ Imagen ${imageIndex + 1} renovada exitosamente con "${customKeyword}"`, 'success');
    } else {
      throw new Error(`Error del servidor: ${response.status}`);
    }
    
  } catch (error) {
    console.error(`Ã¢ÂÅ’ Error refrescando imagen:`, error);
    showNotification(`Ã¢ÂÅ’ Error renovando imagen: ${error.message}`, 'error');
  } finally {
    // Restaurar el botÃƒÂ³n
    const refreshButton = document.querySelector(`[onclick="refreshBingImageWithCustomKeyword(${imageIndex}, ${sectionNum})"]`);
    if (refreshButton) {
      refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i>';
      refreshButton.disabled = false;
    }
  }
}

// Exponer la nueva funciÃƒÂ³n globalmente
window.refreshBingImage = refreshBingImage;
window.showBingImageFullscreen = showBingImageFullscreen;
window.closeBingImageModal = closeBingImageModal;

// ================================
// FUNCIONES PARA GENERACIÃƒâ€œN DE VIDEO
// ================================

// FunciÃƒÂ³n para verificar si se debe generar video automÃƒÂ¡ticamente
function shouldGenerateVideoAutomatically() {
  const generateVideoCheckbox = document.getElementById('generateVideo');
  return generateVideoCheckbox && generateVideoCheckbox.checked;
}

function getAvailableSectionNumbers(projectOverride = null) {
  const sectionSet = new Set();
  const project = projectOverride || window.currentProject || null;

  if (project?.completedSections?.length) {
    project.completedSections.forEach((section) => {
      const rawValue = section?.section ?? section?.sectionNumber ?? section?.id;
      const parsedValue = Number.parseInt(rawValue, 10);
      if (Number.isInteger(parsedValue) && parsedValue > 0) {
        sectionSet.add(parsedValue);
      }
    });
  }

  if (!sectionSet.size && Array.isArray(allSections) && allSections.length) {
    allSections.forEach((sectionScript, index) => {
      if (sectionScript) {
        sectionSet.add(index + 1);
      }
    });
  }

  return Array.from(sectionSet).sort((a, b) => a - b);
}

const CLIP_PROGRESS_POLL_INTERVAL = 1500;

function getClipProgressElements() {
  return {
    container: document.getElementById('clipProgressContainer'),
    summary: document.getElementById('clipProgressSummary'),
    columns: document.getElementById('clipProgressColumns')
  };
}

function clearClipProgressTimers() {
  if (clipProgressUiState.pollTimer) {
    clearInterval(clipProgressUiState.pollTimer);
    clipProgressUiState.pollTimer = null;
  }

  if (clipProgressUiState.autoHideTimer) {
    clearTimeout(clipProgressUiState.autoHideTimer);
    clipProgressUiState.autoHideTimer = null;
  }
}

function hideClipProgressContainer() {
  const { container, summary, columns } = getClipProgressElements();
  if (!container) {
    return;
  }

  container.style.display = 'none';
  container.classList.remove('clip-progress-container--completed');

  if (summary) {
    summary.textContent = 'Preparando progreso...';
  }

  if (columns) {
    columns.innerHTML = '';
  }

  clipProgressUiState.sessionId = null;
  clipProgressUiState.lastStatus = null;
}

function resetClipProgressUI() {
  const { container, summary, columns } = getClipProgressElements();
  if (!container) {
    return;
  }

  container.style.display = 'block';
  container.classList.remove('clip-progress-container--completed');

  if (summary) {
    summary.textContent = 'Preparando progreso...';
  }

  if (columns) {
    columns.innerHTML = '';
  }
}

async function fetchClipProgressState(sessionId) {
  if (!sessionId) {
    return null;
  }

  try {
    const response = await fetch(`/clip-progress/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      cache: 'no-store'
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error consultando progreso de clips:', error);
    return null;
  }
}

function ensureClipProgressColumn(section) {
  const { columns } = getClipProgressElements();
  if (!columns) {
    return null;
  }

  const sectionNumber = Number(section?.sectionNumber);
  if (!Number.isInteger(sectionNumber) || sectionNumber <= 0) {
    return null;
  }

  let column = columns.querySelector(`.clip-progress-column[data-section-number="${sectionNumber}"]`);

  if (!column) {
    column = document.createElement('div');
    column.className = 'clip-progress-column';
    column.dataset.sectionNumber = sectionNumber.toString();

    const title = document.createElement('div');
    title.className = 'clip-progress-column__title';
    const titleText = document.createElement('span');
    titleText.dataset.role = 'title';
    title.appendChild(titleText);
    const counts = document.createElement('span');
    counts.dataset.role = 'counts';
    counts.textContent = '0/0';
    title.appendChild(counts);

    const meta = document.createElement('div');
    meta.className = 'clip-progress-column__meta';
    const totalLabel = document.createElement('span');
    totalLabel.dataset.role = 'total';
    const audioLabel = document.createElement('span');
    audioLabel.dataset.role = 'audio';
    meta.append(totalLabel, audioLabel);

    const capsules = document.createElement('div');
    capsules.className = 'clip-progress-capsules';
    capsules.dataset.role = 'capsules';

    const status = document.createElement('div');
    status.className = 'clip-progress-column__status';
    const generatedLabel = document.createElement('span');
    generatedLabel.dataset.role = 'generated';
    const skippedLabel = document.createElement('span');
    skippedLabel.dataset.role = 'skipped';
    status.append(generatedLabel, skippedLabel);

    column.append(title, meta, capsules, status);
    columns.appendChild(column);
  }

  return column;
}

function updateClipProgressCapsules(column, section) {
  const capsules = column.querySelector('[data-role="capsules"]');
  const clipList = Array.isArray(section?.clips) ? section.clips : [];
  const totalClips = Number(section?.totalClips) || clipList.length;

  if (!capsules) {
    return;
  }

  const currentCount = capsules.children.length;
  if (currentCount < totalClips) {
    for (let i = currentCount; i < totalClips; i += 1) {
      const capsule = document.createElement('div');
      capsule.className = 'clip-progress-capsule';
      capsule.dataset.status = 'pending';
      capsule.dataset.index = (i + 1).toString();
      capsules.appendChild(capsule);
    }
  } else if (currentCount > totalClips) {
    while (capsules.children.length > totalClips) {
      capsules.removeChild(capsules.lastChild);
    }
  }

  Array.from(capsules.children).forEach((element, index) => {
    const clipData = clipList[index];
    let status = clipData?.status || 'pending';
    
    // Si el proceso general estÃƒÂ¡ completado y el clip no tiene status de error, marcar como generated
    if (clipProgressUiState.lastStatus === 'completed' && status === 'pending' && clipData?.status !== 'error') {
      status = 'generated';
    }
    
    const currentStatus = element.dataset.status;

    if (currentStatus === status) {
      return;
    }

    element.dataset.status = status;
    element.className = 'clip-progress-capsule';

    if (status === 'generated') {
      element.classList.add('clip-progress-capsule--generated');
    } else if (status === 'skipped') {
      element.classList.add('clip-progress-capsule--skipped');
    } else if (status === 'error') {
      element.classList.add('clip-progress-capsule--error');
    }
  });
}

function renderClipProgress(progress) {
  const { container, summary, columns } = getClipProgressElements();
  if (!container) {
    return;
  }

  container.style.display = 'block';

  if (!progress || progress.success === false) {
    if (summary) {
      summary.textContent = progress?.error
        ? `Ã¢Å¡Â Ã¯Â¸Â ${progress.error}`
        : 'Sin progreso disponible';
    }
    if (columns) {
      columns.innerHTML = '';
    }
    return;
  }

  const status = progress.status || 'running';
  const total = Number(progress.total) || 0;
  const completed = Number(progress.completed) || 0;
  const sections = Array.isArray(progress.sections) ? progress.sections : [];

  if (summary) {
    if (status === 'failed') {
      summary.textContent = progress.error
        ? `Ã¢ÂÅ’ Error generando clips: ${progress.error}`
        : 'Ã¢ÂÅ’ Error generando clips';
    } else if (status === 'completed') {
      summary.textContent = progress.message || `Ã¢Å“â€¦ ${total}/${total} clips listos`;
    } else {
      const percent = progress.progress ?? (total > 0 ? Math.round((completed / total) * 100) : 0);
      summary.textContent = `${completed}/${total} clips listos (${percent || 0}%)`;
    }
  }

  if (!columns) {
    return;
  }

  const renderedSections = new Set();

  sections.forEach((section) => {
    const column = ensureClipProgressColumn(section);
    if (!column) {
      return;
    }

    renderedSections.add(Number(section.sectionNumber));

    const title = column.querySelector('[data-role="title"]');
    if (title) {
      title.textContent = section.name || `SecciÃƒÂ³n ${section.sectionNumber}`;
    }

    const counts = column.querySelector('[data-role="counts"]');
    if (counts) {
      counts.textContent = `${section.completedClips || 0}/${section.totalClips || 0}`;
    }

    const totalLabel = column.querySelector('[data-role="total"]');
    if (totalLabel) {
      totalLabel.textContent = `Clips: ${section.totalClips || 0}`;
    }

    const audioLabel = column.querySelector('[data-role="audio"]');
    if (audioLabel) {
      audioLabel.textContent = section.audioCount && section.audioCount > 0
        ? `Audios: ${section.audioCount}`
        : 'Sin audio';
    }

    const generatedLabel = column.querySelector('[data-role="generated"]');
    if (generatedLabel) {
      generatedLabel.textContent = `Listos ${section.generatedClips || 0}`;
    }

    const skippedLabel = column.querySelector('[data-role="skipped"]');
    if (skippedLabel) {
      const skipped = section.skippedClips || 0;
      const errors = section.errorClips || 0;
      if (skipped || errors) {
        const parts = [];
        if (skipped) {
          parts.push(`Omitidos ${skipped}`);
        }
        if (errors) {
          parts.push(`Errores ${errors}`);
        }
        skippedLabel.textContent = parts.join(' Ã‚Â· ');
      } else {
        skippedLabel.textContent = 'En progreso';
      }
    }

    updateClipProgressCapsules(column, section);
  });

  Array.from(columns.querySelectorAll('.clip-progress-column')).forEach((column) => {
    const sectionNumber = Number(column.dataset.sectionNumber);
    if (!renderedSections.has(sectionNumber)) {
      column.remove();
    }
  });

  if (status === 'completed') {
    container.classList.add('clip-progress-container--completed');
  } else {
    container.classList.remove('clip-progress-container--completed');
  }

  clipProgressUiState.lastStatus = status;

  // Si el proceso estÃƒÂ¡ completado, asegurar que todas las cÃƒÂ¡psulas se marquen como generated
  if (status === 'completed' && columns) {
    const allCapsules = columns.querySelectorAll('.clip-progress-capsule');
    allCapsules.forEach(capsule => {
      capsule.dataset.status = 'generated';
      capsule.className = 'clip-progress-capsule clip-progress-capsule--generated';
    });
  }
}

function stopClipProgressTracking(options = {}) {
  const { keepVisible = false, finalStatus = null, finalMessage = null } = options;
  clearClipProgressTimers();

  clipProgressUiState.isActive = false;
  clipProgressUiState.sessionId = null;

  const { container, summary } = getClipProgressElements();
  if (!container) {
    return;
  }

  if (keepVisible) {
    container.style.display = 'block';
    if (finalStatus === 'completed') {
      container.classList.add('clip-progress-container--completed');
      // Forzar que todas las cÃƒÂ¡psulas se muestren como generated
      const allCapsules = container.querySelectorAll('.clip-progress-capsule');
      allCapsules.forEach(capsule => {
        capsule.dataset.status = 'generated';
        capsule.className = 'clip-progress-capsule clip-progress-capsule--generated';
      });
    } else if (finalStatus === 'failed') {
      container.classList.remove('clip-progress-container--completed');
    }

    if (summary && finalMessage) {
      summary.textContent = finalMessage;
    }

    if (finalStatus === 'failed') {
      clipProgressUiState.autoHideTimer = setTimeout(() => {
        if (!clipProgressUiState.isActive) {
          hideClipProgressContainer();
        }
      }, 10000);
    }
  } else {
    hideClipProgressContainer();
  }
}

function startClipProgressTracking(sessionId) {
  clearClipProgressTimers();

  clipProgressUiState.sessionId = sessionId;
  clipProgressUiState.isActive = true;
  clipProgressUiState.lastStatus = null;

  resetClipProgressUI();

  const poll = async () => {
    if (!clipProgressUiState.sessionId) {
      return;
    }

    const progressPayload = await fetchClipProgressState(clipProgressUiState.sessionId);
    if (!progressPayload) {
      return;
    }

    if (progressPayload.success === false) {
      if (progressPayload.error && !/sesiÃƒÂ³n no encontrada/i.test(progressPayload.error)) {
        renderClipProgress(progressPayload);
      }
      return;
    }

    const progress = progressPayload.progress || progressPayload;
    renderClipProgress(progress);

    if (progress && (progress.status === 'completed' || progress.status === 'failed')) {
      // Hacer una consulta final para asegurar que tengamos el estado mÃƒÂ¡s reciente
      const finalProgressPayload = await fetchClipProgressState(clipProgressUiState.sessionId);
      if (finalProgressPayload && finalProgressPayload.success !== false) {
        const finalProgress = finalProgressPayload.progress || finalProgressPayload;
        // Forzar status completed para asegurar que las cÃƒÂ¡psulas se marquen correctamente
        finalProgress.status = progress.status;
        renderClipProgress(finalProgress);
      }
      stopClipProgressTracking({
        keepVisible: true,
        finalStatus: progress.status,
        finalMessage: progress.status === 'failed'
          ? (progress.error ? `Ã¢ÂÅ’ ${progress.error}` : 'Ã¢ÂÅ’ Error generando clips')
          : (progress.message || `Ã¢Å“â€¦ ${progress.total || progress.completed}/${progress.total} clips listos`)
      });
    }
  };

  // Hacer primera consulta inmediata
  poll();
  clipProgressUiState.pollTimer = setInterval(poll, CLIP_PROGRESS_POLL_INTERVAL);
}

function updateSectionClipButtons(projectOverride = null) {
  const container = document.getElementById('sectionClipsContainer');
  const buttonsWrapper = document.getElementById('sectionClipsButtons');

  if (!container || !buttonsWrapper) {
    return;
  }

  const sectionNumbers = getAvailableSectionNumbers(projectOverride);

  if (!sectionNumbers.length) {
    container.style.display = 'none';
    buttonsWrapper.innerHTML = '';
    return;
  }

  container.style.display = 'block';
  buttonsWrapper.innerHTML = '';

  sectionNumbers.forEach((sectionNumber) => {
    const button = document.createElement('button');
    button.className = 'section-clip-btn';
    button.dataset.sectionNumber = sectionNumber.toString();
    button.innerHTML = `
      <i class="fas fa-film"></i>
      <span>SecciÃƒÂ³n ${sectionNumber}</span>
    `;
    button.disabled = !!isGeneratingVideo;
    button.addEventListener('click', handleSectionClipButtonClick);
    buttonsWrapper.appendChild(button);
  });
}

function handleSectionClipButtonClick(event) {
  event.preventDefault();
  const button = event.currentTarget;
  const sectionNumber = Number.parseInt(button?.dataset?.sectionNumber, 10);

  if (!Number.isInteger(sectionNumber) || sectionNumber <= 0) {
    console.warn('Ã¢Å¡Â Ã¯Â¸Â NÃƒÂºmero de secciÃƒÂ³n invÃƒÂ¡lido para generar clip:', button?.dataset);
    return;
  }

  if (isGeneratingVideo) {
    showNotification('Ã¢Å¡Â Ã¯Â¸Â Ya hay una generaciÃƒÂ³n en progreso. Espera a que termine antes de generar otro clip.', 'info');
    return;
  }

  let folderName;

  if (window.currentProject && window.currentProject.folderName) {
    folderName = window.currentProject.folderName;
    console.log(`Ã°Å¸Å½Â¯ Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    const folderInput = document.getElementById('folderName');
    const inputFolderName = folderInput ? folderInput.value.trim() : '';

    if (!inputFolderName) {
      showError('Por favor, especifica el nombre de la carpeta del proyecto');
      return;
    }

    folderName = inputFolderName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    console.log(`Ã°Å¸â€Â§ Normalizando folderName: "${inputFolderName}" Ã¢â€ â€™ "${folderName}"`);
  }

  generateSeparateVideos(folderName, {
    sectionNumber,
    buttonElement: button
  });
}

function getSectionImageProgressElements() {
  if (!sectionImageProgressState.container) {
    sectionImageProgressState.container = document.getElementById('sectionImagesProgressContainer');
    sectionImageProgressState.barsWrapper = document.getElementById('sectionImagesProgressBars');
    sectionImageProgressState.summary = document.getElementById('sectionImagesProgressSummary');
  }
  return sectionImageProgressState;
}

function resolveProjectFolderName(projectData = null) {
  const project = projectData || window.currentProject;
  if (project?.folderName) {
    return project.folderName;
  }

  if (project?.projectKey) {
    return project.projectKey;
  }

  if (project?.safeFolderName) {
    return project.safeFolderName;
  }

  const folderInput = document.getElementById('folderName');
  if (folderInput) {
    const rawValue = folderInput.dataset.safeFolderName || folderInput.value?.trim();
    if (rawValue) {
      return createSafeFolderName(rawValue);
    }
  }

  return null;
}

function getCachedSectionData(sectionNumber, projectData = null) {
  const project = projectData || window.currentProject;
  const response = {
    promptCount: 0,
    imageCount: 0
  };

  if (!project) {
    return response;
  }

  const targetSection = Array.isArray(project.completedSections)
    ? project.completedSections.find(section => {
        const sectionId = section?.section ?? section?.sectionNumber ?? section?.id;
        return Number(sectionId) === Number(sectionNumber);
      })
    : null;

  if (targetSection) {
    if (Array.isArray(targetSection.imagePrompts)) {
      response.promptCount = targetSection.imagePrompts.length;
    } else if (Array.isArray(targetSection.prompts)) {
      response.promptCount = targetSection.prompts.length;
    }

    if (Array.isArray(targetSection.imageUrls)) {
      response.imageCount = targetSection.imageUrls.length;
    } else if (Array.isArray(targetSection.imageFiles)) {
      response.imageCount = targetSection.imageFiles.length;
    } else if (typeof targetSection.imageCount === 'number') {
      response.imageCount = targetSection.imageCount;
    } else if (targetSection.hasImages) {
      response.imageCount = Math.max(response.promptCount, 1);
    }
  }

  if (!response.promptCount && Array.isArray(project.imagePrompts)) {
    const promptsEntry = project.imagePrompts.find(entry => {
      const sectionId = entry?.section ?? entry?.sectionNumber ?? entry?.id ?? entry?.sectionIndex;
      return Number(sectionId) === Number(sectionNumber);
    });

    if (promptsEntry && Array.isArray(promptsEntry.prompts)) {
      response.promptCount = promptsEntry.prompts.length;
    }
  }

  return response;
}

function updateProjectSectionImageData(sectionNumber, updates = {}, projectOverride = null) {
  const projectData = projectOverride || window.currentProject || null;
  const normalizedSection = Number(sectionNumber);

  if (!projectData || !Number.isInteger(normalizedSection) || normalizedSection <= 0) {
    return;
  }

  if (!Array.isArray(projectData.completedSections)) {
    projectData.completedSections = [];
  }

  let target = projectData.completedSections.find((sectionEntry) => {
    const entryNumber = Number(sectionEntry?.section ?? sectionEntry?.sectionNumber ?? sectionEntry?.id ?? sectionEntry?.index);
    return Number.isInteger(entryNumber) && entryNumber === normalizedSection;
  });

  if (!target) {
    target = {
      section: normalizedSection,
      sectionNumber: normalizedSection,
      script: '',
      imagePrompts: [],
      prompts: [],
      imageUrls: [],
      imageCount: 0,
      hasImages: false
    };
    projectData.completedSections.push(target);
    projectData.completedSections.sort((a, b) => {
      const aNumber = Number(a?.section ?? a?.sectionNumber ?? a?.id ?? 0);
      const bNumber = Number(b?.section ?? b?.sectionNumber ?? b?.id ?? 0);
      return aNumber - bNumber;
    });
  }

  if (Array.isArray(updates.prompts)) {
    const normalizedPrompts = updates.prompts.filter((item) => typeof item === 'string' && item.trim().length > 0);
    target.imagePrompts = normalizedPrompts.slice();
    target.prompts = normalizedPrompts.slice();
  }

  if (Array.isArray(updates.imageUrls)) {
    target.imageUrls = updates.imageUrls.slice();
  }

  if (typeof updates.imageCount === 'number' && Number.isFinite(updates.imageCount)) {
    const normalizedImageCount = Math.max(0, Math.floor(updates.imageCount));
    target.imageCount = normalizedImageCount;
    target.hasImages = normalizedImageCount > 0;
  }

  if (typeof updates.googleImagesMode === 'boolean') {
    target.googleImagesMode = updates.googleImagesMode;
  }

  if (typeof updates.promptCount === 'number' && updates.promptCount <= 0 && !Array.isArray(updates.prompts)) {
    target.imagePrompts = [];
    target.prompts = [];
  }
}

function syncSectionImageProgressFromProject(projectOverride = null) {
  const projectData = projectOverride || window.currentProject || null;
  const { container } = getSectionImageProgressElements();

  if (!projectData) {
    return;
  }

  const sectionNumbers = getAvailableSectionNumbers(projectData);

  if (!sectionNumbers.length) {
    return;
  }

  const stats = sectionNumbers.map((sectionNumber) => {
    const cached = getCachedSectionData(sectionNumber, projectData);
    const previous = sectionImageProgressState.lastRenderedStats.find((stat) => stat.sectionNumber === sectionNumber);

    const promptCountRaw = Number(cached.promptCount);
    const promptCount = Number.isFinite(promptCountRaw) && promptCountRaw > 0 ? Math.floor(promptCountRaw) : 0;

    const imageCountRaw = Number(cached.imageCount);
    const imageCount = Number.isFinite(imageCountRaw) && imageCountRaw > 0 ? Math.floor(imageCountRaw) : 0;

    const previousCapsules = previous && Number.isFinite(previous.totalCapsules) ? previous.totalCapsules : 0;
    const totalCapsulesCandidate = promptCount > 0
      ? promptCount
      : previousCapsules > 0
        ? previousCapsules
        : imageCount > 0
          ? imageCount
          : 10;
    const totalCapsules = Math.max(1, Math.floor(totalCapsulesCandidate));
    const filledCount = Math.min(imageCount, totalCapsules);

    return {
      sectionNumber,
      promptCount,
      totalCapsules,
      imageCount,
      filledCount
    };
  });

  renderSectionImageProgressColumns(stats);

  if (container) {
    container.style.display = 'block';
  }
}

function updateSectionImageProgressStat(sectionNumber, updates = {}) {
  const normalizedSection = Number(sectionNumber);

  if (!Number.isInteger(normalizedSection) || normalizedSection <= 0) {
    return;
  }

  const { container } = getSectionImageProgressElements();

  const stats = sectionImageProgressState.lastRenderedStats.length
    ? sectionImageProgressState.lastRenderedStats.map((stat) => ({ ...stat }))
    : [];

  let target = stats.find((stat) => stat.sectionNumber === normalizedSection);

  if (!target) {
    const baseCapsules = typeof updates.totalCapsules === 'number' && updates.totalCapsules > 0
      ? Math.floor(updates.totalCapsules)
      : typeof updates.promptCount === 'number' && updates.promptCount > 0
        ? Math.floor(updates.promptCount)
        : 10;

    target = {
      sectionNumber: normalizedSection,
      promptCount: 0,
      totalCapsules: Math.max(1, baseCapsules),
      imageCount: 0,
      filledCount: 0
    };
    stats.push(target);
    stats.sort((a, b) => a.sectionNumber - b.sectionNumber);
  }

  let hasChanges = false;

  if (typeof updates.promptCount === 'number' && updates.promptCount >= 0) {
    const normalizedPrompt = Math.floor(updates.promptCount);
    if (target.promptCount !== normalizedPrompt) {
      target.promptCount = normalizedPrompt;
      hasChanges = true;
    }
  }

  if (typeof updates.imageCount === 'number' && updates.imageCount >= 0) {
    const normalizedImages = Math.floor(updates.imageCount);
    if (target.imageCount !== normalizedImages) {
      target.imageCount = normalizedImages;
      hasChanges = true;
    }
  }

  let desiredCapsules;

  if (typeof updates.totalCapsules === 'number' && updates.totalCapsules >= 0) {
    desiredCapsules = Math.floor(updates.totalCapsules);
  } else if (typeof updates.promptCount === 'number' && updates.promptCount > 0) {
    desiredCapsules = Math.floor(updates.promptCount);
  } else if (target.promptCount > 0) {
    desiredCapsules = target.promptCount;
  } else if (target.imageCount > target.totalCapsules) {
    desiredCapsules = target.imageCount;
  } else {
    desiredCapsules = target.totalCapsules;
  }

  if (!Number.isFinite(desiredCapsules) || desiredCapsules <= 0) {
    desiredCapsules = Math.max(target.promptCount, target.imageCount, 10);
  }

  desiredCapsules = Math.max(1, desiredCapsules);

  if (target.totalCapsules !== desiredCapsules) {
    target.totalCapsules = desiredCapsules;
    hasChanges = true;
  }

  const computedFilled = Math.min(target.imageCount, target.totalCapsules);
  if (target.filledCount !== computedFilled) {
    target.filledCount = computedFilled;
    hasChanges = true;
  }

  if (!hasChanges) {
    return;
  }

  renderSectionImageProgressColumns(stats);

  if (container) {
    container.style.display = 'block';
  }
}

function renderSectionImageProgressColumns(sectionsStats) {
  const { container, barsWrapper, summary } = getSectionImageProgressElements();
  if (!container || !barsWrapper) {
    return;
  }

  let sanitizedStats = Array.isArray(sectionsStats)
    ? sectionsStats.map((stat) => {
        const sectionNumber = Number.isFinite(Number(stat?.sectionNumber))
          ? Number(stat.sectionNumber)
          : 0;
        const promptCount = Number.isFinite(Number(stat?.promptCount)) && Number(stat.promptCount) >= 0
          ? Math.floor(Number(stat.promptCount))
          : 0;
        const totalCapsulesRaw = Number.isFinite(Number(stat?.totalCapsules)) && Number(stat.totalCapsules) > 0
          ? Math.floor(Number(stat.totalCapsules))
          : 1;
        const imageCount = Number.isFinite(Number(stat?.imageCount)) && Number(stat.imageCount) >= 0
          ? Math.floor(Number(stat.imageCount))
          : 0;
        const filledCountRaw = Number.isFinite(Number(stat?.filledCount)) && Number(stat.filledCount) >= 0
          ? Math.floor(Number(stat.filledCount))
          : 0;

        const totalCapsules = Math.max(1, totalCapsulesRaw);
        const filledCount = Math.min(filledCountRaw, totalCapsules, imageCount);

        return {
          sectionNumber,
          promptCount,
          totalCapsules,
          imageCount,
          filledCount
        };
      })
      .filter((stat) => stat.sectionNumber > 0)
    : [];

  sanitizedStats.sort((a, b) => a.sectionNumber - b.sectionNumber);

  const previousStats = Array.isArray(sectionImageProgressState.lastRenderedStats)
    ? sectionImageProgressState.lastRenderedStats
    : [];

  const statsChanged =
    sanitizedStats.length !== previousStats.length ||
    sanitizedStats.some((stat, index) => {
      const previous = previousStats[index];
      if (!previous) {
        return true;
      }

      return (
        previous.sectionNumber !== stat.sectionNumber ||
        previous.promptCount !== stat.promptCount ||
        previous.totalCapsules !== stat.totalCapsules ||
        previous.imageCount !== stat.imageCount ||
        previous.filledCount !== stat.filledCount
      );
    });

  if (!statsChanged) {
    return;
  }

  sectionImageProgressState.lastRenderedStats = sanitizedStats.map((stat) => ({ ...stat }));

  barsWrapper.innerHTML = '';

  const totalSections = sanitizedStats.length;
  let totalCapsules = 0;
  let totalFilled = 0;

  sanitizedStats.forEach((sectionStat) => {
    const { sectionNumber, totalCapsules: capsules, filledCount } = sectionStat;
    totalCapsules += capsules;
    totalFilled += filledCount;

    const column = document.createElement('div');
    column.className = 'image-progress-column';
    column.dataset.sectionNumber = sectionNumber.toString();

    const title = document.createElement('div');
    title.className = 'image-progress-column__title';

    const name = document.createElement('span');
    name.textContent = `SecciÃƒÂ³n ${sectionNumber}`;

    const count = document.createElement('span');
    count.className = 'image-progress-column__count';
    count.textContent = `${filledCount}/${capsules}`;

    title.append(name, count);

    const capsulesWrapper = document.createElement('div');
    capsulesWrapper.className = 'image-progress-capsules';

    for (let capsuleIndex = 0; capsuleIndex < capsules; capsuleIndex += 1) {
      const capsule = document.createElement('div');
      capsule.className = 'image-progress-capsule';
      capsule.dataset.index = (capsules - capsuleIndex).toString();

      if (capsuleIndex < filledCount) {
        capsule.classList.add('image-progress-capsule--filled');
      }

      capsulesWrapper.appendChild(capsule);
    }

    if (!capsulesWrapper.children.length) {
      const emptyCapsule = document.createElement('div');
      emptyCapsule.className = 'image-progress-capsule';
      capsulesWrapper.appendChild(emptyCapsule);
    }

    column.append(title, capsulesWrapper);

    const actions = document.createElement('div');
    actions.className = 'image-progress-column__actions';

    const button = document.createElement('button');
    button.className = 'section-image-btn section-image-btn--inline';
    button.dataset.sectionNumber = sectionNumber.toString();

    const isActive = sectionImageProgressState.activeSection === sectionNumber && isGeneratingImages;
    if (isActive) {
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando...</span>';
      button.disabled = true;
    } else {
      button.innerHTML = `<i class="fas fa-images"></i><span>SecciÃƒÂ³n ${sectionNumber}</span>`;
      button.disabled = !!isGeneratingImages;
    }

    button.addEventListener('click', handleSectionImageButtonClick);
    actions.appendChild(button);

    column.appendChild(actions);
    barsWrapper.appendChild(column);
  });

  if (summary) {
    if (!totalSections) {
      summary.textContent = 'Sin datos';
    } else {
      summary.textContent = `${totalSections} secciones Ã‚Â· ${totalFilled}/${totalCapsules || 1} imÃƒÂ¡genes listas`;
    }
  }
}

async function refreshSectionImageProgress(projectOverride = null) {
  const elements = getSectionImageProgressElements();
  if (!elements.container || !elements.barsWrapper) {
    return;
  }

  const projectData = projectOverride || window.currentProject || null;
  const sectionNumbers = getAvailableSectionNumbers(projectData);

  if (!sectionNumbers.length) {
    elements.container.style.display = 'none';
    elements.barsWrapper.innerHTML = '';
    if (elements.summary) {
      elements.summary.textContent = 'Sin datos';
    }
    return;
  }

  const folderName = resolveProjectFolderName(projectData);
  if (!folderName) {
    elements.container.style.display = 'none';
    elements.barsWrapper.innerHTML = '';
    if (elements.summary) {
      elements.summary.textContent = 'Sin datos';
    }
    return;
  }

  elements.container.style.display = 'block';

  const fallbackStats = sectionNumbers.map((sectionNumber) => {
    const cached = getCachedSectionData(sectionNumber, projectData);
    const previous = Array.isArray(sectionImageProgressState.lastRenderedStats)
      ? sectionImageProgressState.lastRenderedStats.find((stat) => stat.sectionNumber === sectionNumber)
      : null;

    const cachedPrompt = Number.isFinite(Number(cached.promptCount)) ? Math.max(0, Math.floor(Number(cached.promptCount))) : 0;
    const previousPrompt = previous && Number.isFinite(Number(previous.promptCount))
      ? Math.max(0, Math.floor(Number(previous.promptCount)))
      : 0;
    const promptCount = cachedPrompt > 0 ? cachedPrompt : previousPrompt;

    const previousTotal = previous && Number.isFinite(Number(previous.totalCapsules))
      ? Math.max(1, Math.floor(Number(previous.totalCapsules)))
      : 0;
    const resolvedPromptCapsules = promptCount > 0 ? promptCount : previousTotal;

    let totalCapsules = Number.isFinite(resolvedPromptCapsules) && resolvedPromptCapsules > 0
      ? Math.floor(resolvedPromptCapsules)
      : 10;
    totalCapsules = Math.max(1, totalCapsules);

    const cachedImages = Number.isFinite(Number(cached.imageCount)) ? Math.max(0, Math.floor(Number(cached.imageCount))) : 0;
    const previousImages = previous && Number.isFinite(Number(previous.imageCount))
      ? Math.max(0, Math.floor(Number(previous.imageCount)))
      : 0;
    const imageCount = cachedImages > 0 ? cachedImages : previousImages;

    const filledCount = Math.min(imageCount, totalCapsules);

    return {
      sectionNumber,
      promptCount,
      totalCapsules,
      imageCount,
      filledCount
    };
  });

  renderSectionImageProgressColumns(fallbackStats);

  const updateToken = sectionImageProgressState.updateToken + 1;
  sectionImageProgressState.updateToken = updateToken;

  try {
    const resolvedStats = await Promise.all(sectionNumbers.map(async (sectionNumber) => {
      const fallback = fallbackStats.find(stat => stat.sectionNumber === sectionNumber) || {
        sectionNumber,
        promptCount: 0,
        totalCapsules: 10,
        imageCount: 0,
        filledCount: 0
      };

      try {
        const response = await fetch(`/api/project-images/${encodeURIComponent(folderName)}/${sectionNumber}`, {
          method: 'GET',
          cache: 'no-store'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const promptsArray = Array.isArray(data?.prompts)
          ? data.prompts.filter(line => typeof line === 'string' && line.trim())
          : [];
        const promptCount = promptsArray.length > 0 ? promptsArray.length : fallback.promptCount;
        const fallbackTotal = Number.isFinite(fallback?.totalCapsules) && fallback.totalCapsules > 0
          ? Math.max(1, Math.floor(fallback.totalCapsules))
          : 10;
        const totalCapsules = promptCount > 0 ? promptCount : fallbackTotal;
        const imageCount = Array.isArray(data?.images)
          ? data.images.length
          : Number.isFinite(data?.imageCount)
            ? data.imageCount
            : fallback.imageCount;
        const filledCount = Math.min(imageCount, totalCapsules);

        return {
          sectionNumber,
          promptCount,
          totalCapsules,
          imageCount,
          filledCount
        };
      } catch (error) {
        console.warn(`Ã¢Å¡Â Ã¯Â¸Â No se pudo actualizar progreso de imÃƒÂ¡genes para secciÃƒÂ³n ${sectionNumber}:`, error);
        return fallback;
      }
    }));

    if (sectionImageProgressState.updateToken !== updateToken) {
      return;
    }

    renderSectionImageProgressColumns(resolvedStats);
  } catch (error) {
    console.warn('Ã¢Å¡Â Ã¯Â¸Â Error refrescando progreso de imÃƒÂ¡genes:', error);
  }
}

function shouldRefreshSectionImageProgress(projectOverride = null) {
  if (!window.currentProject) {
    return true;
  }

  if (!projectOverride) {
    return true;
  }

  const currentName = window.currentProject.folderName || window.currentProject.projectKey || window.currentProject.safeFolderName;
  const overrideName = projectOverride.folderName || projectOverride.projectKey || projectOverride.safeFolderName;

  if (!currentName || !overrideName) {
    return true;
  }

  return currentName === overrideName;
}

function startSectionImageProgressPolling(projectOverride = null) {
  if (!shouldRefreshSectionImageProgress(projectOverride)) {
    return;
  }

  stopSectionImageProgressPolling();

  const pollImagesProgress = () => {
    refreshSectionImageProgress(projectOverride).catch((error) => {
      console.warn('Ã¢Å¡Â Ã¯Â¸Â Error actualizando barras de imÃƒÂ¡genes durante el polling:', error);
    });
  };

  pollImagesProgress();

  sectionImageProgressPollInterval = setInterval(pollImagesProgress, SECTION_IMAGE_PROGRESS_POLL_MS);
}

function stopSectionImageProgressPolling() {
  if (sectionImageProgressPollInterval) {
    clearInterval(sectionImageProgressPollInterval);
    sectionImageProgressPollInterval = null;
  }
}

function updateSectionImageButtons(projectOverride = null) {
  const container = document.getElementById('sectionImagesContainer');
  const buttonsWrapper = document.getElementById('sectionImagesButtons');

  const sectionNumbers = getAvailableSectionNumbers(projectOverride);

  if (container) {
    container.style.display = 'none';
  }
  if (buttonsWrapper) {
    buttonsWrapper.innerHTML = '';
  }

  if (!sectionNumbers.length) {
    if (sectionImageProgressState.lastRenderedStats.length) {
      renderSectionImageProgressColumns([]);
    }
    return;
  }

  if (shouldRefreshSectionImageProgress(projectOverride)) {
    refreshSectionImageProgress(projectOverride).catch((error) => {
      console.warn('Ã¢Å¡Â Ã¯Â¸Â Error actualizando barras de progreso de imÃƒÂ¡genes:', error);
    });
  } else if (sectionImageProgressState.lastRenderedStats.length) {
    renderSectionImageProgressColumns(sectionImageProgressState.lastRenderedStats);
  }
}

function handleSectionImageButtonClick(event) {
  event.preventDefault();
  const button = event.currentTarget;
  const sectionNumber = Number.parseInt(button?.dataset?.sectionNumber, 10);

  if (!Number.isInteger(sectionNumber) || sectionNumber <= 0) {
    console.warn('Ã¢Å¡Â Ã¯Â¸Â NÃƒÂºmero de secciÃƒÂ³n invÃƒÂ¡lido para generar imÃƒÂ¡genes:', button?.dataset);
    return;
  }

  if (isGeneratingImages) {
    showNotification('Ã¢Å¡Â Ã¯Â¸Â Ya hay una generaciÃƒÂ³n de imÃƒÂ¡genes en progreso. Espera a que termine antes de iniciar otra.', 'info');
    return;
  }

  let folderName;

  if (window.currentProject && window.currentProject.folderName) {
    folderName = window.currentProject.folderName;
    console.log(`Ã°Å¸Å½Â¯ Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    const folderInput = document.getElementById('folderName');
    const inputFolderName = folderInput ? folderInput.value.trim() : '';

    if (!inputFolderName) {
      showError('Por favor, especifica el nombre de la carpeta del proyecto');
      return;
    }

    folderName = inputFolderName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    console.log(`Ã°Å¸â€Â§ Normalizando folderName: "${inputFolderName}" Ã¢â€ â€™ "${folderName}"`);
  }

  generateMissingImages({
    folderName,
    sectionNumber,
    buttonElement: button
  });
}

async function generateMissingPrompts() {
  try {
    const projectData = window.currentProject;

    // Verificar que haya un proyecto cargado
    if (!projectData || !projectData.completedSections) {
      showError('No hay un proyecto cargado con secciones completadas');
      return;
    }

    const uiSelectedImageModel = getSelectedImageModel();
    const projectImageModel = projectData?.imageModel ? normalizeImageModel(projectData.imageModel) : null;
    const selectedImageModel = normalizeImageModel(uiSelectedImageModel || projectImageModel);

    // Obtener imageCount del selector o proyecto o configuraciÃƒÂ³n por defecto
    let imageCount = parseInt(document.getElementById("imagesSelect")?.value) || projectData?.imageCount || 10;

    // Actualizar el proyecto con el nuevo imageCount si cambiÃƒÂ³
    if (projectData && imageCount !== projectData.imageCount) {
      projectData.imageCount = imageCount;
      if (window.currentProject === projectData) {
        window.currentProject.imageCount = imageCount;
      }
    }

    if (projectData && selectedImageModel && selectedImageModel !== projectImageModel) {
      projectData.imageModel = selectedImageModel;
      window.currentProject.imageModel = selectedImageModel;
    }

    let folderName = projectData.folderName;

    if (!folderName) {
      const folderInput = document.getElementById("folderName");
      folderName = folderInput ? folderInput.value.trim() : '';

      if (!folderName) {
        showError('No se ha especificado el nombre del proyecto');
        return;
      }

      folderName = folderName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    }

    console.log(`Ã°Å¸â€œÂ Generando prompts faltantes para proyecto: ${folderName}`);

    // Obtener configuraciones para imÃƒÂ¡genes
    const imageInstructions = document.getElementById('promptModifier')?.value || '';

    // Llamar al backend para generar prompts faltantes
    const response = await fetch('/api/generate-prompts-only', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        folderName: folderName,
        imageInstructions: imageInstructions,
        imageCount: imageCount
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData?.error || `Error generando prompts`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || `Error desconocido generando prompts`);
    }

    console.log('Ã¢Å“â€¦ Prompts generados exitosamente:', data.data);
    showNotification(`Ã¢Å“â€¦ Prompts generados para ${data.data.generatedPrompts.length} secciÃƒÂ³n(es)`, 'success');

    const generatedPrompts = Array.isArray(data?.data?.generatedPrompts) ? data.data.generatedPrompts : [];
    generatedPrompts.forEach((entry) => {
      const entrySection = Number(entry?.section ?? entry?.sectionNumber ?? entry?.id ?? entry?.index);
      if (!Number.isInteger(entrySection) || entrySection <= 0) {
        return;
      }

      const entryPrompts = Array.isArray(entry?.prompts) ? entry.prompts.filter((item) => typeof item === 'string' && item.trim().length > 0) : [];

      if (entryPrompts.length) {
        updateProjectSectionImageData(entrySection, { prompts: entryPrompts }, projectData);
        updateSectionImageProgressStat(entrySection, { promptCount: entryPrompts.length });
      }
    });

    if (shouldRefreshSectionImageProgress(projectData)) {
      await refreshSectionImageProgress(projectData);
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error generando prompts:', error);
    throw error;
  }
}

async function handleProjectSectionImageButtonClick(event, projectKey, sectionNumber) {
  event.preventDefault();
  const btn = event.currentTarget;

  if (!Number.isInteger(sectionNumber) || sectionNumber <= 0) {
    console.warn('Ã¢Å¡Â Ã¯Â¸Â NÃƒÂºmero de secciÃƒÂ³n invÃƒÂ¡lido para generar imÃƒÂ¡genes:', sectionNumber);
    return;
  }

  if (isGeneratingImages) {
    showNotification('Ã¢Å¡Â Ã¯Â¸Â Ya hay una generaciÃƒÂ³n de imÃƒÂ¡genes en progreso. Espera a que termine antes de iniciar otra.', 'info');
    return;
  }

  const projectData = projectDataMap.get(projectKey) || window.currentProject;
  if (!projectData) {
    showError('No se encontrÃƒÂ³ la informaciÃƒÂ³n del proyecto');
    return;
  }

  const uiSelectedImageModel = getSelectedImageModel();
  const projectImageModel = projectData?.imageModel ? normalizeImageModel(projectData.imageModel) : null;
  const selectedImageModel = normalizeImageModel(uiSelectedImageModel || projectImageModel);

  // Usar imageCount del proyecto o 10 por defecto
  const imageCount = projectData?.imageCount || 10;

  try {
    isGeneratingImages = true;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando...</span>';

    // Verificar si la secciÃƒÂ³n ya tiene imÃƒÂ¡genes
    const hasImages = await checkIfSectionHasImages(projectKey, sectionNumber, imageCount);
    if (hasImages) {
      showNotification(`Ã¢Å“â€¦ La secciÃƒÂ³n ${sectionNumber} ya tiene suficientes imÃƒÂ¡genes generadas (${imageCount}).`, 'success');
      return;
    }

    console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â Generando ${imageCount} imÃƒÂ¡genes para secciÃƒÂ³n ${sectionNumber} del proyecto ${projectKey} usando APIs gratuitas de Google...`);

    await generateMissingImagesForSection({
      folderName: projectKey,
      sectionNumber,
      projectData,
      selectedImageModel,
      imageCount
    });

    showNotification(`Ã¢Å“â€¦ ImÃƒÂ¡genes generadas exitosamente para la secciÃƒÂ³n ${sectionNumber}.`, 'success');
  } catch (error) {
    console.error(`Ã¢ÂÅ’ Error generando imÃƒÂ¡genes para secciÃƒÂ³n ${sectionNumber}:`, error);
    showError(`Error generando imÃƒÂ¡genes: ${error.message}`);
  } finally {
    isGeneratingImages = false;
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-images"></i><span>SecciÃƒÂ³n ${sectionNumber}</span>`;
  }
}

// FunciÃƒÂ³n para mostrar el botÃƒÂ³n de generaciÃƒÂ³n manual de video
function showVideoGenerationButton() {
  // Solo mostrar el contenedor de video si hay un solo proyecto (no mÃƒÂºltiples proyectos paralelos)
  const hasMultipleProjects = projectProgressContainers.size > 1;

  if (!hasMultipleProjects) {
    // Mostrar el contenedor principal de generaciÃƒÂ³n de video solo para proyectos ÃƒÂºnicos
    const videoContainer = document.getElementById('videoGenerationContainer');
    if (videoContainer) {
      videoContainer.style.display = 'block';
    }
  }

  const simpleVideoBtn = document.getElementById('generateSimpleVideoBtn');
  if (simpleVideoBtn) {
    simpleVideoBtn.style.display = 'inline-flex';
  }

  const dzBtn = document.getElementById('downloadProjectZipBtn');
  if (dzBtn) {
    dzBtn.style.display = 'inline-flex';
  }

  const generateImagesControls = document.getElementById('generateMissingImagesControls');
  if (generateImagesControls) {
    generateImagesControls.style.display = 'flex';
  }

  const generateImagesBtn = document.getElementById('generateMissingImagesBtn');
  if (generateImagesBtn) {
    generateImagesBtn.style.display = 'inline-flex';
  }

  const cancelImagesBtn = document.getElementById('cancelMissingImagesBtn');
  if (cancelImagesBtn) {
    cancelImagesBtn.style.display = 'none';
  }

  const generatePromptsBtn = document.getElementById('generateMissingPromptsBtn');
  if (generatePromptsBtn) {
    generatePromptsBtn.style.display = 'inline-flex';
  }

  initializeGoogleApiSelector();
  renderGoogleApiSelector();

  // Mostrar botÃƒÂ³n de regenerar audios solo si Applio estÃƒÂ¡ activado
  const regenerateAudioBtn = document.getElementById('regenerateApplioAudiosBtn');
  const applioCheckbox = document.getElementById('autoGenerateApplioAudio');
  
  // Mostrar el botÃƒÂ³n si Applio estÃƒÂ¡ activado O si hay un proyecto cargado (para permitir generar audios faltantes)
  if (regenerateAudioBtn && ((applioCheckbox && applioCheckbox.checked) || window.currentProject)) {
    regenerateAudioBtn.style.display = 'inline-flex';
    console.log('Ã°Å¸Å½Â¤ BotÃƒÂ³n de generar audios faltantes mostrado');
  } else {
    if (regenerateAudioBtn) {
      regenerateAudioBtn.style.display = 'none';
    }
  }
  
  // Mostrar botÃƒÂ³n de regenerar guiones si hay un proyecto cargado
  const regenerateScriptsBtn = document.getElementById('regenerateMissingScriptsBtn');
  if (regenerateScriptsBtn && window.currentProject) {
    regenerateScriptsBtn.style.display = 'inline-flex';
    console.log('Ã°Å¸â€œÂ BotÃƒÂ³n de regenerar guiones vacÃƒÂ­os mostrado');
  } else {
    if (regenerateScriptsBtn) {
      regenerateScriptsBtn.style.display = 'none';
    }
  }
  
  updateYouTubeMetadataButtonState();
  
  // Actualizar botones de clips por secciÃƒÂ³n cuando haya informaciÃƒÂ³n disponible
  updateSectionClipButtons();
  updateSectionImageButtons();
  
  console.log('Ã°Å¸â€œÂ¹ Botones de generaciÃƒÂ³n de video mostrados');
}

  function updateYouTubeMetadataButtonState() {
    const metadataBtn = document.getElementById('generateYouTubeMetadataBtn');
    if (!metadataBtn) {
      return;
    }

    const hasSections = (Array.isArray(allSections) && allSections.length > 0) ||
      (window.currentProject && Array.isArray(window.currentProject.completedSections) && window.currentProject.completedSections.length > 0);

    if (!hasSections) {
      metadataBtn.style.display = 'none';
      metadataBtn.dataset.metadataExists = 'false';
      metadataBtn.title = 'Genera primero las secciones para crear metadatos.';
      return;
    }

    metadataBtn.style.display = 'inline-flex';

    const metadataExists = !!(
      (window.currentProject && window.currentProject.youtubeMetadata && window.currentProject.youtubeMetadata.content) ||
      (window.lastGeneratedYouTubeMetadata && window.lastGeneratedYouTubeMetadata.content)
    );
    metadataBtn.dataset.metadataExists = metadataExists ? 'true' : 'false';
    metadataBtn.title = metadataExists
      ? 'Ya existen metadatos para este proyecto. Haz clic para revisarlos.'
      : 'Genera metadatos de YouTube para este proyecto.';
  }

// FunciÃƒÂ³n principal para generar video automÃƒÂ¡ticamente
async function generateVideoAutomatically() {
  // No generar video automÃƒÂ¡ticamente si hay mÃƒÂºltiples proyectos en progreso
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (hasMultipleProjects) {
    console.log('Ã°Å¸â€â€ž MÃƒÂºltiples proyectos en progreso - omitiendo generaciÃƒÂ³n automÃƒÂ¡tica de video');
    return;
  }
  
  if (!shouldGenerateVideoAutomatically()) {
    console.log('Ã°Å¸â€œÂ¹ GeneraciÃƒÂ³n automÃƒÂ¡tica de video desactivada');
    return;
  }
  
  // Ã¢Å“â€¦ CORREGIDO: Usar folderName del proyecto actual, no del input original
  let folderName;
  
  if (window.currentProject && window.currentProject.folderName) {
    // Si hay proyecto cargado, usar su folderName normalizado
    folderName = window.currentProject.folderName;
    console.log(`Ã°Å¸Å½Â¯ Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    // Fallback: usar el input y normalizarlo
    const inputFolderName = document.getElementById("folderName").value.trim();
    if (!inputFolderName) {
      console.warn('Ã¢Å¡Â Ã¯Â¸Â No hay nombre de carpeta para generar video');
      return;
    }
    // Normalizar el nombre como lo hace el backend
    folderName = inputFolderName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    console.log(`Ã°Å¸â€Â§ Normalizando folderName: "${inputFolderName}" Ã¢â€ â€™ "${folderName}"`);
  }
  
  if (!allSections || allSections.length === 0) {
    console.log("Ã¢Å¡Â Ã¯Â¸Â No hay secciones generadas para crear los clips");
    return;
  }
  
  console.log('Ã°Å¸Å½Â¬ Iniciando generaciÃƒÂ³n automÃƒÂ¡tica de clips separados...');
  
  try {
    // Ã¢Å“â€¦ USAR LA MISMA FUNCIÃƒâ€œN QUE EL BOTÃƒâ€œN generateSeparateVideosBtn
    await generateSeparateVideos(folderName);
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error en generaciÃƒÂ³n automÃƒÂ¡tica de clips separados:', error);
    showError(`Error generando clips separados automÃƒÂ¡ticamente: ${error.message}`);
  }
}

// FunciÃƒÂ³n principal para generar video del proyecto
async function generateProjectVideo(folderName, isAutomatic = false) {
  if (isGeneratingVideo) {
    console.log('Ã¢Å¡Â Ã¯Â¸Â Ya se estÃƒÂ¡ generando un video');
    return;
  }
  
  isGeneratingVideo = true;
  currentVideoSession = Date.now().toString();
  
  try {
    // Obtener configuraciÃƒÂ³n de video
    const animationType = document.getElementById('videoAnimation')?.value || 'zoom-out';
    const quality = document.getElementById('videoQuality')?.value || 'standard';
    
    console.log(`Ã°Å¸Å½Â¬ Generando video para proyecto: ${folderName}`);
    console.log(`Ã°Å¸Å½Â¬ ConfiguraciÃƒÂ³n: animaciÃƒÂ³n=${animationType}, calidad=${quality}`);

    // Mostrar progreso en la parte superior del panel
    showAutomaticVideoProgress();
    updateAutomaticVideoProgress(0, 'Iniciando generaciÃƒÂ³n de video...');
    
    // Realizar llamada al servidor
    const response = await fetch('/generate-project-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: folderName,
        animationType: animationType,
        quality: quality
      })
    });
    
    // Obtener sessionId del servidor
    const sessionId = response.headers.get('X-Video-Session-ID');
    
    if (sessionId) {
      // Conectar al progreso en tiempo real
      const eventSource = new EventSource(`/video-progress/${sessionId}`);
      
      eventSource.onmessage = function(event) {
        try {
          const progressData = JSON.parse(event.data);
          
          updateAutomaticVideoProgress(progressData.percent, progressData.message);
          
          if (progressData.percent >= 100) {
            eventSource.close();
          }
        } catch (e) {
          console.error('Error parsing video progress data:', e);
        }
      };
      
      eventSource.onerror = function(event) {
        console.error('Video EventSource error:', event);
        eventSource.close();
      };
    }
    
    if (response.ok) {
      console.log('Ã°Å¸Å½Â¬ Respuesta de video recibida, descargando...');
      
      const blob = await response.blob();
      console.log('Ã°Å¸Å½Â¬ Video blob creado, tamaÃƒÂ±o:', blob.size);
      
      // Crear enlace de descarga
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folderName}_video_completo.mp4`;
      a.style.display = 'none';
      document.body.appendChild(a);
      
      // Intentar descarga automÃƒÂ¡tica
      try {
        a.click();
        console.log('Ã°Å¸Å½Â¬ Descarga de video iniciada automÃƒÂ¡ticamente');
        
        showAutomaticVideoComplete();
        showSuccess('Ã°Å¸Å½Â¬ Ã‚Â¡Video generado y descargado exitosamente!');
      } catch (clickError) {
        console.log('Ã°Å¸Å½Â¬ Click automÃƒÂ¡tico fallÃƒÂ³, mostrando enlace manual');
        a.style.display = 'block';
        a.textContent = 'Hacer clic aquÃƒÂ­ para descargar el video';
        a.style.color = '#00ff7f';
        a.style.textDecoration = 'underline';
        a.style.fontSize = '1.1rem';
        a.style.padding = '10px';
        
        showAutomaticVideoComplete();
      }
      
      // Limpiar despuÃƒÂ©s de un tiempo
      setTimeout(() => {
        try {
          window.URL.revokeObjectURL(url);
          if (a.parentNode) {
            document.body.removeChild(a);
          }
        } catch (e) {
          console.log('Error limpiando URL de video:', e);
        }
      }, 10000);
      
    } else {
      const error = await response.json();
      throw new Error(error.error || 'Error al generar el video');
    }
    
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error generando video:', error);
    
    showError(`Error generando video: ${error.message}`);
  } finally {
    isGeneratingVideo = false;
    currentVideoSession = null;
  }
}

// FunciÃƒÂ³n para generar video simple (sin animaciones)
async function generateSimpleProjectVideo(folderName) {
  if (isGeneratingVideo) {
    console.log('Ã¢Å¡Â Ã¯Â¸Â Ya se estÃƒÂ¡ generando un video');
    return;
  }

  isGeneratingVideo = true;
  const button = document.getElementById('generateSimpleVideoBtn');
  
  try {
    // Deshabilitar botÃƒÂ³n y mostrar estado de carga
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando Video Simple...</span>';
    
    console.log('Ã°Å¸Å½Â¬ Iniciando generaciÃƒÂ³n de video simple para proyecto:', folderName);
    
    const response = await fetch('/generate-simple-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        folderName: folderName
        // No enviamos duration porque se calcula automÃƒÂ¡ticamente basado en audio
      }),
    });

    if (response.ok) {
      // El servidor deberÃƒÂ­a enviar el archivo para descarga automÃƒÂ¡tica
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${folderName}_video_simple.mp4`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showSuccess('Ã‚Â¡Video simple generado y descargado exitosamente!');
    } else {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Error interno del servidor');
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error generando video simple:', error);
    showError(`Error generando video simple: ${error.message}`);
  } finally {
    // Restaurar botÃƒÂ³n
    isGeneratingVideo = false;
    button.disabled = false;
    button.innerHTML = '<i class="fas fa-images"></i><span>Video Simple (Sin AnimaciÃƒÂ³n)</span>';
  }
}

// FunciÃƒÂ³n para generar clips separados por secciÃƒÂ³n
async function generateSeparateVideos(folderName, options = {}) {
  const { sectionNumber = null, buttonElement = null } = options;
  const progressSessionId = options.progressSessionId || `clip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  if (isGeneratingVideo) {
    console.log('Ã¢Å¡Â Ã¯Â¸Â Ya se estÃƒÂ¡ generando un video');
    showNotification('Ã¢Å¡Â Ã¯Â¸Â Ya hay una generaciÃƒÂ³n de video en curso. Espera a que finalice para iniciar otra.', 'info');
    return;
  }

  isGeneratingVideo = true;

  const button = buttonElement || document.getElementById('generateSeparateVideosBtn');
  const isSectionButton = button?.classList?.contains('section-clip-btn');
  const originalContent = button ? button.innerHTML : null;

  if (button) {
    button.disabled = true;
    button.dataset.originalContent = originalContent;
    if (sectionNumber !== null && Number.isInteger(Number(sectionNumber))) {
      button.innerHTML = `<i class="fas fa-spinner fa-spin"></i><span>SecciÃƒÂ³n ${sectionNumber}...</span>`;
    } else {
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando Clips Separados...</span>';
    }
    if (isSectionButton) {
      button.classList.add('section-clip-btn--generating');
    }
  }

  startClipProgressTracking(progressSessionId);

  try {
    console.log('Ã°Å¸Å½Â¬ Iniciando generaciÃƒÂ³n de clips separados para proyecto:', folderName, sectionNumber ? `Ã¢â€ â€™ SecciÃƒÂ³n ${sectionNumber}` : '' );

    const payload = { folderName, progressSessionId };
    if (sectionNumber !== null && Number.isInteger(Number(sectionNumber))) {
      payload.sectionNumber = Number(sectionNumber);
    }

    const response = await fetch('/generate-separate-videos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let serverError = {};
      try {
        serverError = await response.json();
      } catch (_) {
        serverError = {};
      }
      throw new Error(serverError.error || 'Error interno del servidor');
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Error interno del servidor');
    }

    const generatedCount = Number(result.videosGenerated) || 0;
    const skippedCount = Number(result.videosSkipped) || 0;
    const requestedSections = Array.isArray(result.requestedSections) ? result.requestedSections : [];

    console.log('Ã¢Å“â€¦ Clips separados generados:', {
      total: generatedCount,
      requestedSections,
      omitidos: skippedCount,
      detalle: result.videos,
      omitidosDetalle: result.skippedVideos
    });

    if (generatedCount === 0) {
      const infoMessage = result.message || 'No se generaron clips para la selecciÃƒÂ³n solicitada.';
      showNotification(infoMessage, 'info');
      if (skippedCount > 0) {
        showNotification(`Se detectaron ${skippedCount} clip${skippedCount === 1 ? '' : 's'} ya generado${skippedCount === 1 ? '' : 's'} en la carpeta del proyecto.`, 'info');
      }
      stopClipProgressTracking({
        keepVisible: true,
        finalStatus: 'completed',
        finalMessage: infoMessage
      });
      return;
    }

    const clipWord = generatedCount === 1 ? 'clip' : 'clips';
    let successMessage;

    if (sectionNumber !== null && Number.isInteger(Number(sectionNumber))) {
      successMessage = `Ã‚Â¡${generatedCount} ${clipWord} de la secciÃƒÂ³n ${sectionNumber} generado${generatedCount === 1 ? '' : 's'} exitosamente!`;
      if (skippedCount > 0) {
        successMessage += ` (${skippedCount} clip${skippedCount === 1 ? '' : 's'} ya existÃƒÂ­a${skippedCount === 1 ? '' : 'n'} y se omitieron)`;
      }
    } else if (requestedSections.length === 1) {
      successMessage = `Ã‚Â¡${generatedCount} ${clipWord} de la secciÃƒÂ³n ${requestedSections[0]} generado${generatedCount === 1 ? '' : 's'} exitosamente!`;
      if (skippedCount > 0) {
        successMessage += ` (${skippedCount} clip${skippedCount === 1 ? '' : 's'} ya existÃƒÂ­a${skippedCount === 1 ? '' : 'n'} y se omitieron)`;
      }
    } else if (requestedSections.length > 1) {
      const baseMessage = result.message || `Ã‚Â¡${generatedCount} ${clipWord} generados para las secciones ${requestedSections.join(', ')}!`;
      successMessage = skippedCount > 0
        ? `${baseMessage} (${skippedCount} clip${skippedCount === 1 ? '' : 's'} existente${skippedCount === 1 ? '' : 's'} omitido${skippedCount === 1 ? '' : 's'})`
        : baseMessage;
    } else {
      const baseMessage = result.message || `Ã‚Â¡${generatedCount} ${clipWord} generados exitosamente en sus respectivas carpetas de secciÃƒÂ³n!`;
      successMessage = skippedCount > 0
        ? `${baseMessage} (${skippedCount} clip${skippedCount === 1 ? '' : 's'} existente${skippedCount === 1 ? '' : 's'} omitido${skippedCount === 1 ? '' : 's'})`
        : baseMessage;
    }

    if (successMessage) {
      showSuccess(successMessage);
      stopClipProgressTracking({
        keepVisible: true,
        finalStatus: 'completed',
        finalMessage: successMessage
      });
    }

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error generando clips separados:', error);
    showError(`Error generando clips separados: ${error.message}`);
    stopClipProgressTracking({
      keepVisible: true,
      finalStatus: 'failed',
      finalMessage: `Ã¢ÂÅ’ ${error.message}`
    });
  } finally {
    // Restaurar botÃƒÂ³n
    isGeneratingVideo = false;
    if (button) {
      button.disabled = false;
      if (button.dataset.originalContent) {
        button.innerHTML = button.dataset.originalContent;
        delete button.dataset.originalContent;
      } else if (sectionNumber !== null && Number.isInteger(Number(sectionNumber))) {
        button.innerHTML = `<i class="fas fa-film"></i><span>SecciÃƒÂ³n ${sectionNumber}</span>`;
      } else {
        button.innerHTML = '<i class="fas fa-video"></i><span>Clips Separados por SecciÃƒÂ³n</span>';
      }
      if (isSectionButton) {
        button.classList.remove('section-clip-btn--generating');
      }
    }

    updateSectionClipButtons();
    updateSectionImageButtons();
  }
}

// FunciÃƒÂ³n para mostrar progreso de video automÃƒÂ¡tico
function showAutomaticVideoProgress() {
  // No mostrar progreso si hay mÃƒÂºltiples proyectos en progreso
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (hasMultipleProjects) {
    console.log('Ã°Å¸â€â€ž MÃƒÂºltiples proyectos en progreso - omitiendo progreso de video automÃƒÂ¡tico');
    return;
  }
  
  const automaticMessage = document.createElement('div');
  automaticMessage.id = 'automaticVideoProgress';
  automaticMessage.className = 'auto-completion-message';
  automaticMessage.innerHTML = `
    <div class="success-content">
      <i class="fas fa-video"></i>
      <h3>Generando Video AutomÃƒÂ¡ticamente</h3>
      <p>Convirtiendo todas las secciones en un video compilado...</p>
      <div class="video-progress-bar">
        <div id="autoVideoProgressFill" class="video-progress-fill"></div>
      </div>
      <div id="autoVideoProgressText" class="video-progress-text">0%</div>
      <div id="autoVideoProgressInfo" class="video-progress-info">Iniciando...</div>
    </div>
  `;
  
  output.insertBefore(automaticMessage, output.firstChild);
}

// FunciÃƒÂ³n para actualizar progreso de video automÃƒÂ¡tico
function updateAutomaticVideoProgress(percent, message) {
  const progressFill = document.getElementById('autoVideoProgressFill');
  const progressText = document.getElementById('autoVideoProgressText');
  const progressInfo = document.getElementById('autoVideoProgressInfo');
  
  if (progressFill) {
    progressFill.style.width = percent + '%';
  }
  
  if (progressText) {
    progressText.textContent = Math.round(percent) + '%';
  }
  
  if (progressInfo) {
    progressInfo.textContent = message;
  }
}

// FunciÃƒÂ³n para mostrar completaciÃƒÂ³n de video automÃƒÂ¡tico
function showAutomaticVideoComplete() {
  // No mostrar mensaje si hay mÃƒÂºltiples proyectos en progreso
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (hasMultipleProjects) {
    console.log('Ã°Å¸â€â€ž MÃƒÂºltiples proyectos en progreso - omitiendo mensaje de video completado');
    return;
  }
  
  const automaticProgress = document.getElementById('automaticVideoProgress');
  if (automaticProgress) {
    automaticProgress.innerHTML = `
      <div class="success-content">
        <i class="fas fa-check-circle"></i>
        <h3>Ã‚Â¡Video Generado AutomÃƒÂ¡ticamente!</h3>
        <p>El video compilado se ha descargado exitosamente.</p>
      </div>
    `;
    
    // Ocultar despuÃƒÂ©s de unos segundos
    setTimeout(() => {
      if (automaticProgress.parentNode) {
        automaticProgress.remove();
      }
    }, 5000);
  }
}

// =====================================
// FUNCIONALIDAD REGENERAR AUDIOS (GOOGLE/APPLIO)
// =====================================

async function regenerateAllAudios() {
  const useGoogleTTS = document.getElementById('autoGenerateAudio')?.checked || false;
  const useApplio = document.getElementById('autoGenerateApplioAudio')?.checked || false;

  if (!useGoogleTTS && !useApplio) {
    showError('Activa al menos una opciÃƒÂ³n de audio (Google o Applio) para continuar');
    return;
  }

  if (!window.currentProject || !window.currentProject.completedSections) {
    showError('No hay un proyecto cargado con secciones completadas');
    return;
  }

  // Obtener folderName normalizado del proyecto o del input
  let folderName = window.currentProject.folderName;
  if (!folderName) {
    const inputFolderName = document.getElementById('folderName')?.value?.trim();
    if (!inputFolderName) {
      showError('No se ha especificado el nombre del proyecto');
      return;
    }
    folderName = inputFolderName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  // ConfiguraciÃƒÂ³n de estilo y rangos
  const styleSelect = document.getElementById('styleSelect');
  const selectedStyleValue = styleSelect ? styleSelect.value : 'professional';

  let scriptStyle = 'professional';
  let customStyleInstructions = '';

  if (selectedStyleValue.startsWith('custom_')) {
    scriptStyle = 'custom';
    customStyleInstructions = getCustomStyleInstructions(selectedStyleValue) || '';
    console.log(`Ã°Å¸Å½Â¨ Estilo personalizado detectado: ${selectedStyleValue}`);
    console.log(`Ã°Å¸Å½Â¨ Instrucciones: ${customStyleInstructions.substring(0, 100)}...`);
  } else {
    scriptStyle = selectedStyleValue;
  }

  const wordsMin = parseInt(document.getElementById('wordsMin')?.value) || 800;
  const wordsMax = parseInt(document.getElementById('wordsMax')?.value) || 1100;

  const regenerateBtn = document.getElementById('regenerateApplioAudiosBtn');
  if (regenerateBtn) {
    regenerateBtn.disabled = true;
    regenerateBtn.innerHTML = `
      <i class="fas fa-spinner fa-spin"></i>
      <span>Verificando audios...</span>
    `;
  }

  const summary = {
    google: { generated: 0, pending: 0 },
    applio: { generated: 0, pending: 0 }
  };

  try {
    if (useGoogleTTS) {
      console.log('Ã°Å¸Å½Â¤ Verificando audios faltantes para Google TTS...');
      showNotification('Ã°Å¸â€Â Verificando audios de Google...', 'info');

      const selectedVoice = document.getElementById('voiceSelect')?.value || 'Kore';
      const narrationStyle = document.getElementById('narrationStyle')?.value?.trim() || '';

      const response = await fetch('/generate-missing-google-audios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName,
          voice: selectedVoice,
          narrationStyle: narrationStyle || null,
          scriptStyle,
          customStyleInstructions,
          wordsMin,
          wordsMax
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error verificando/generando audios con Google');
      }

      summary.google.generated = data.data?.generatedCount || 0;
      summary.google.pending = data.data?.missingAudioSections?.length || 0;

      if (summary.google.generated > 0) {
        showNotification(`Ã¢Å“â€¦ ${summary.google.generated} audios Google generados correctamente`, 'success');
      } else {
        showNotification('Ã¢Å“â€¦ Todos los audios de Google ya existÃƒÂ­an', 'info');
      }

      console.log('Ã¢Å“â€¦ Resultado Google TTS:', data.message);
    }

    if (useApplio) {
      console.log('Ã°Å¸Å½Â¤ Verificando audios faltantes para Applio...');
      showNotification('Ã°Å¸â€Â Verificando audios de Applio...', 'info');

      const selectedApplioVoice = document.getElementById('applioVoiceSelect')?.value;
    const selectedApplioModel = document.getElementById('applioModelSelect')?.value;
    const applioPitch = parseInt(document.getElementById('applioPitch')?.value) || 0;
    const applioSpeed = parseInt(document.getElementById('applioSpeed')?.value) || 0;

      const response = await fetch('/generate-missing-applio-audios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName,
          applioVoice: selectedApplioVoice,
          applioModel: selectedApplioModel,
          applioPitch,
          applioSpeed,
          totalSections: window.currentProject.completedSections.length,
          scriptStyle,
          customStyleInstructions,
          wordsMin,
          wordsMax
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error verificando/generando audios con Applio');
      }

      summary.applio.generated = data.data?.generatedCount || 0;
      summary.applio.pending = data.data?.missingAudioSections?.length || 0;

      if (summary.applio.generated > 0) {
        showNotification(`Ã¢Å“â€¦ ${summary.applio.generated} audios Applio generados correctamente`, 'success');
      } else {
        showNotification('Ã¢Å“â€¦ Todos los audios de Applio ya existÃƒÂ­an', 'info');
      }

      console.log('Ã¢Å“â€¦ Resultado Applio:', data.message);
    }

    const totalGenerated = summary.google.generated + summary.applio.generated;
    const methodsUsed = [
      useGoogleTTS ? `Google (${summary.google.generated})` : null,
      useApplio ? `Applio (${summary.applio.generated})` : null
    ].filter(Boolean).join(' + ');

    showNotification(`Ã°Å¸Å½â€° RegeneraciÃƒÂ³n completada (${methodsUsed || 'Sin mÃƒÂ©todos activos'}). Total generados: ${totalGenerated}`, 'success');

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error verificando/generando audios:', error);
    showError(`Error verificando/generando audios: ${error.message}`);
  } finally {
    if (regenerateBtn) {
      regenerateBtn.disabled = false;
      regenerateBtn.innerHTML = `
        <i class="fas fa-microphone-alt"></i>
        <span>Generar Audios Faltantes</span>
      `;
    }
  }
}

// FunciÃƒÂ³n para regenerar audios faltantes para un proyecto especÃƒÂ­fico
async function regenerateAllAudiosForProject(folderName) {
  const useGoogleTTS = document.getElementById('autoGenerateAudio')?.checked || false;
  const useApplio = document.getElementById('autoGenerateApplioAudio')?.checked || false;

  if (!useGoogleTTS && !useApplio) {
    console.log('Ã¢Å¡Â Ã¯Â¸Â No hay opciones de audio activas para verificar en proyecto:', folderName);
    return;
  }

  if (!folderName) {
    throw new Error('No se ha especificado el nombre del proyecto');
  }

  // ConfiguraciÃƒÂ³n de estilo y rangos
  const styleSelect = document.getElementById('styleSelect');
  const selectedStyleValue = styleSelect ? styleSelect.value : 'professional';

  let scriptStyle = 'professional';
  let customStyleInstructions = '';

  if (selectedStyleValue.startsWith('custom_')) {
    scriptStyle = 'custom';
    customStyleInstructions = getCustomStyleInstructions(selectedStyleValue) || '';
  } else {
    scriptStyle = selectedStyleValue;
  }

  const wordsMin = parseInt(document.getElementById('wordsMin')?.value) || 800;
  const wordsMax = parseInt(document.getElementById('wordsMax')?.value) || 1100;

  const summary = {
    google: { generated: 0, pending: 0 },
    applio: { generated: 0, pending: 0 }
  };

  try {
    if (useGoogleTTS) {
      console.log(`Ã°Å¸Å½Â¤ Verificando audios faltantes para Google TTS en proyecto: ${folderName}`);

      const selectedVoice = document.getElementById('voiceSelect')?.value || 'Kore';
      const narrationStyle = document.getElementById('narrationStyle')?.value?.trim() || '';

      const response = await fetch('/generate-missing-google-audios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName,
          voice: selectedVoice,
          narrationStyle: narrationStyle || null,
          scriptStyle,
          customStyleInstructions,
          wordsMin,
          wordsMax
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error verificando/generando audios con Google');
      }

      summary.google.generated = data.data?.generatedCount || 0;
      summary.google.pending = data.data?.missingAudioSections?.length || 0;

      if (summary.google.generated > 0) {
        console.log(`Ã¢Å“â€¦ ${summary.google.generated} audios Google generados para ${folderName}`);
      } else {
        console.log(`Ã¢Å“â€¦ Todos los audios de Google ya existÃƒÂ­an en ${folderName}`);
      }
    }

    if (useApplio) {
      console.log(`Ã°Å¸Å½Â¤ Verificando audios faltantes para Applio en proyecto: ${folderName}`);

      const selectedApplioVoice = document.getElementById('applioVoiceSelect')?.value;
      const selectedApplioModel = document.getElementById('applioModelSelect')?.value;
      const applioPitch = parseInt(document.getElementById('applioPitch')?.value) || 0;
      const applioSpeed = parseInt(document.getElementById('applioSpeed')?.value) || 0;

      const response = await fetch('/generate-missing-applio-audios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName,
          applioVoice: selectedApplioVoice,
          applioModel: selectedApplioModel,
          applioPitch,
          applioSpeed,
          totalSections: 5, // Asumir 5 secciones por defecto, el backend lo calcularÃƒÂ¡
          scriptStyle,
          customStyleInstructions,
          wordsMin,
          wordsMax
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error verificando/generando audios con Applio');
      }

      summary.applio.generated = data.data?.generatedCount || 0;
      summary.applio.pending = data.data?.missingAudioSections?.length || 0;

      if (summary.applio.generated > 0) {
        console.log(`Ã¢Å“â€¦ ${summary.applio.generated} audios Applio generados para ${folderName}`);
      } else {
        console.log(`Ã¢Å“â€¦ Todos los audios de Applio ya existÃƒÂ­an en ${folderName}`);
      }
    }

    const totalGenerated = summary.google.generated + summary.applio.generated;
    console.log(`Ã¢Å“â€¦ VerificaciÃƒÂ³n de audios completada para ${folderName}. Total generados: ${totalGenerated}`);

  } catch (error) {
    console.error(`Ã¢ÂÅ’ Error verificando/generando audios para proyecto ${folderName}:`, error);
    throw error; // Re-lanzar para que sea manejado por el llamador
  }
}

// FunciÃƒÂ³n para regenerar guiones faltantes
async function regenerateMissingScripts() {
  try {
    // Verificar que haya un proyecto cargado
    if (!window.currentProject || !window.currentProject.completedSections) {
      showError('No hay un proyecto cargado con secciones completadas');
      return;
    }
    
    const folderName = document.getElementById("folderName").value.trim();
    
    if (!folderName) {
      showError('No se ha especificado el nombre del proyecto');
      return;
    }
    
    // Obtener configuraciÃƒÂ³n de estilo actual
    const styleSelect = document.getElementById('styleSelect');
    const selectedStyleValue = styleSelect ? styleSelect.value : 'professional';
    
    let scriptStyle = 'professional';
    let customStyleInstructions = '';
    
    // Determinar el tipo de estilo y obtener las instrucciones
    if (selectedStyleValue.startsWith('custom_')) {
      scriptStyle = 'custom';
      customStyleInstructions = getCustomStyleInstructions(selectedStyleValue) || '';
      console.log(`Ã°Å¸Å½Â¨ Estilo personalizado detectado: ${selectedStyleValue}`);
      console.log(`Ã°Å¸Å½Â¨ Instrucciones: ${customStyleInstructions.substring(0, 100)}...`);
    } else {
      scriptStyle = selectedStyleValue;
    }
    
    const wordsMin = parseInt(document.getElementById('wordsMin')?.value) || 800;
    const wordsMax = parseInt(document.getElementById('wordsMax')?.value) || 1100;

    console.log('Ã°Å¸â€œÂ Verificando guiones faltantes...');
    console.log('Ã°Å¸â€œÂ ConfiguraciÃƒÂ³n:', {
      proyecto: folderName,
      secciones: window.currentProject.completedSections.length,
      estilo: scriptStyle
    });
    
    // Deshabilitar botÃƒÂ³n durante el proceso
    const regenerateBtn = document.getElementById('regenerateMissingScriptsBtn');
    if (regenerateBtn) {
      regenerateBtn.disabled = true;
      regenerateBtn.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        <span>Verificando guiones...</span>
      `;
    }
    
    // Mostrar progreso
    showNotification('Ã°Å¸â€Â Verificando quÃƒÂ© guiones estÃƒÂ¡n vacÃƒÂ­os...', 'info');
    
    // Llamar al backend para verificar y generar solo los guiones faltantes
    const response = await fetch('/generate-missing-scripts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: folderName,
        scriptStyle: scriptStyle,
        customStyleInstructions: customStyleInstructions,
        wordsMin: wordsMin,
        wordsMax: wordsMax
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('Ã¢Å“â€¦ VerificaciÃƒÂ³n y generaciÃƒÂ³n de guiones completada:', data.message);
      
      if (data.data.generatedCount > 0) {
        showNotification(`Ã¢Å“â€¦ ${data.data.generatedCount} guiones faltantes generados exitosamente`, 'success');
        
        // Actualizar el proyecto cargado para reflejar los cambios
        if (window.currentProject) {
          // Recargar el proyecto para obtener los guiones actualizados
          setTimeout(() => {
            showNotification('Ã°Å¸â€â€ž Recargando proyecto para mostrar los cambios...', 'info');
            // AquÃƒÂ­ podrÃƒÂ­as recargar el proyecto actual si tienes esa funcionalidad
          }, 2000);
        }
      } else {
        showNotification('Ã¢Å“â€¦ Todos los guiones ya tienen contenido, no se generÃƒÂ³ ninguno nuevo', 'info');
      }
      
      // Mostrar detalles si hay informaciÃƒÂ³n adicional
      if (data.data.missingScripts && data.data.missingScripts.length > 0) {
        console.log('Ã°Å¸â€œÂ Secciones que tenÃƒÂ­an guiones vacÃƒÂ­os:', data.data.missingScripts);
      }
      
    } else {
      throw new Error(data.error || 'Error desconocido regenerando guiones');
    }
    
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error regenerando guiones:', error);
    showError(`Error regenerando guiones: ${error.message}`);
  } finally {
    // Restaurar botÃƒÂ³n
    const regenerateBtn = document.getElementById('regenerateMissingScriptsBtn');
    if (regenerateBtn) {
      regenerateBtn.disabled = false;
      regenerateBtn.innerHTML = `
        <i class="fas fa-file-alt"></i>
        <span>Regenerar Guiones VacÃƒÂ­os</span>
      `;
    }
  }
}

// FunciÃƒÂ³n para regenerar guiones faltantes para un proyecto especÃƒÂ­fico
async function regenerateMissingScriptsForProject(folderName) {
  try {
    if (!folderName) {
      throw new Error('No se ha especificado el nombre del proyecto');
    }
    
    // Obtener configuraciÃƒÂ³n de estilo actual
    const styleSelect = document.getElementById('styleSelect');
    const selectedStyleValue = styleSelect ? styleSelect.value : 'professional';
    
    let scriptStyle = 'professional';
    let customStyleInstructions = '';
    
    // Determinar el tipo de estilo y obtener las instrucciones
    if (selectedStyleValue.startsWith('custom_')) {
      scriptStyle = 'custom';
      customStyleInstructions = getCustomStyleInstructions(selectedStyleValue) || '';
      console.log(`Ã°Å¸Å½Â¨ Estilo personalizado detectado: ${selectedStyleValue}`);
    } else {
      scriptStyle = selectedStyleValue;
    }
    
    const wordsMin = parseInt(document.getElementById('wordsMin')?.value) || 800;
    const wordsMax = parseInt(document.getElementById('wordsMax')?.value) || 1100;

    console.log(`Ã°Å¸â€œÂ Verificando guiones faltantes para proyecto: ${folderName}`);
    
    // Llamar al backend para verificar y generar solo los guiones faltantes
    const response = await fetch('/generate-missing-scripts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: folderName,
        scriptStyle: scriptStyle,
        customStyleInstructions: customStyleInstructions,
        wordsMin: wordsMin,
        wordsMax: wordsMax
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log(`Ã¢Å“â€¦ VerificaciÃƒÂ³n y generaciÃƒÂ³n de guiones completada para ${folderName}:`, data.message);
      
      if (data.data.generatedCount > 0) {
        console.log(`Ã¢Å“â€¦ ${data.data.generatedCount} guiones faltantes generados para ${folderName}`);
      } else {
        console.log(`Ã¢Å“â€¦ Todos los guiones ya tienen contenido en ${folderName}`);
      }
    } else {
      throw new Error(data.error || 'Error desconocido regenerando guiones');
    }
    
  } catch (error) {
    console.error(`Ã¢ÂÅ’ Error regenerando guiones para proyecto ${folderName}:`, error);
    throw error; // Re-lanzar para que sea manejado por el llamador
  }
}

const comfyUIDefaults = {
  steps: 15,
  cfg: 1.8,
  guidance: 3.5,
  resolutions: {
    '16:9': { width: 800, height: 400 },
    '9:16': { width: 400, height: 800 },
    '1:1': { width: 800, height: 800 }
  }
};

let comfyDefaultsPromise = null;

async function loadComfyDefaultsFromServer() {
  if (comfyDefaultsPromise) {
    return comfyDefaultsPromise;
  }

  comfyDefaultsPromise = (async () => {
    try {
      const response = await fetch('/api/comfy-defaults');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data?.success) {
        if (data.resolutions && typeof data.resolutions === 'object') {
          comfyUIDefaults.resolutions = {
            ...comfyUIDefaults.resolutions,
            ...Object.entries(data.resolutions).reduce((acc, [ratio, value]) => {
              if (value && typeof value === 'object') {
                const width = Number.parseInt(value.width, 10);
                const height = Number.parseInt(value.height, 10);
                if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
                  acc[ratio] = { width, height };
                }
              }
              return acc;
            }, {})
          };
        }

        if (Number.isFinite(Number.parseInt(data.steps, 10))) {
          comfyUIDefaults.steps = Math.max(1, Number.parseInt(data.steps, 10));
        }

        if (Number.isFinite(Number.parseFloat(data.cfg))) {
          comfyUIDefaults.cfg = Number.parseFloat(data.cfg);
        }

        if (Number.isFinite(Number.parseFloat(data.guidance))) {
          comfyUIDefaults.guidance = Number.parseFloat(data.guidance);
        }

        console.log('Ã¢Å¡â„¢Ã¯Â¸Â Defaults ComfyUI actualizados desde el servidor:', comfyUIDefaults);
      } else {
        console.warn('Ã¢Å¡Â Ã¯Â¸Â No se pudo cargar defaults de ComfyUI desde el servidor:', data?.error || data);
      }
    } catch (error) {
      console.warn('Ã¢Å¡Â Ã¯Â¸Â Error cargando defaults de ComfyUI, usando valores locales:', error);
    }

    return comfyUIDefaults;
  })();

  return comfyDefaultsPromise;
}

function resolveComfyUIResolution(aspectRatio = '16:9') {
  const resolved = comfyUIDefaults.resolutions?.[aspectRatio];
  if (resolved && Number.isFinite(resolved.width) && Number.isFinite(resolved.height)) {
    return { width: resolved.width, height: resolved.height };
  }

  const fallback = comfyUIDefaults.resolutions?.['16:9'] || { width: 800, height: 400 };
  return { width: fallback.width, height: fallback.height };
}

function getComfyDefaultSteps() {
  return comfyUIDefaults.steps;
}

function getComfyDefaultCfg() {
  return comfyUIDefaults.cfg;
}

function getComfyDefaultGuidance() {
  return comfyUIDefaults.guidance;
}

function getComfyUISettings() {
  return {
    steps: parseInt(document.getElementById('comfyUISteps')?.value, 10) || getComfyDefaultSteps(),
    guidance: parseFloat(document.getElementById('comfyUIGuidance')?.value) || getComfyDefaultGuidance(),
    cfg: getComfyDefaultCfg(),
    width: parseInt(document.getElementById('comfyUIWidth')?.value, 10) || resolveComfyUIResolution('9:16').width,
    height: parseInt(document.getElementById('comfyUIHeight')?.value, 10) || resolveComfyUIResolution('9:16').height,
    model: document.getElementById('comfyUIModel')?.value || 'flux1-dev-fp8.safetensors',
    sampler: document.getElementById('comfyUISampler')?.value || 'euler',
    scheduler: document.getElementById('comfyUIScheduler')?.value || 'simple'
  };
}

// FunciÃƒÂ³n para generar imÃƒÂ¡genes faltantes
async function generateMissingImages(options = {}) {
  const {
    folderName: overrideFolderName = null,
    sectionNumber = null,
    buttonElement = null,
    projectOverride = null
  } = options || {};
  const originalButtonHtml = buttonElement ? buttonElement.innerHTML : null;
  let attemptComfyCheckbox = null;
  let attemptComfyToggle = null;

  try {
    const projectData = projectOverride || window.currentProject;

    // Verificar que haya un proyecto cargado
    if (!projectData || !projectData.completedSections) {
      showError('No hay un proyecto cargado con secciones completadas');
      return;
    }

    const uiSelectedImageModel = getSelectedImageModel();
    const projectImageModel = projectData?.imageModel ? normalizeImageModel(projectData.imageModel) : null;
    const selectedImageModel = normalizeImageModel(uiSelectedImageModel || projectImageModel);

    // Obtener imageCount del selector o proyecto o configuraciÃƒÂ³n por defecto
    let imageCount = parseInt(document.getElementById("imagesSelect")?.value) || projectData?.imageCount || 10;

    // Actualizar el proyecto con el nuevo imageCount si cambiÃƒÂ³
    if (projectData && imageCount !== projectData.imageCount) {
      projectData.imageCount = imageCount;
      if (window.currentProject === projectData) {
        window.currentProject.imageCount = imageCount;
      }
    }

    if (projectData && selectedImageModel && selectedImageModel !== projectImageModel) {
      projectData.imageModel = selectedImageModel;
      if (window.currentProject === projectData) {
        window.currentProject.imageModel = selectedImageModel;
      }
    }

    let folderName = overrideFolderName;

    if (!folderName) {
      const folderInput = document.getElementById("folderName");
      folderName = folderInput ? folderInput.value.trim() : '';

      if (!folderName && projectData.folderName) {
        folderName = projectData.folderName;
      }

      if (!folderName) {
        showError('No se ha especificado el nombre del proyecto');
        return;
      }

      folderName = folderName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    }

    // Si no se especifica sectionNumber, verificar quÃƒÂ© secciones necesitan imÃƒÂ¡genes
    if (sectionNumber === null) {
      console.log('Ã°Å¸â€Â Verificando quÃƒÂ© secciones necesitan imÃƒÂ¡genes...');

      // Obtener todas las secciones completadas
      const completedSections = projectData.completedSections || [];
      const sectionsNeedingImages = [];

      for (let i = 0; i < completedSections.length; i++) {
        const section = completedSections[i];
        if (section && section.script) {
          // Verificar si esta secciÃƒÂ³n tiene imÃƒÂ¡genes generadas
          const sectionFolder = `${folderName}/seccion_${i + 1}`;
          const hasImages = await checkIfSectionHasImages(folderName, i + 1, imageCount);

          if (!hasImages) {
            sectionsNeedingImages.push(i + 1);
            console.log(`Ã°Å¸â€œâ€¹ SecciÃƒÂ³n ${i + 1} necesita imÃƒÂ¡genes (${imageCount} requeridas)`);
          } else {
            console.log(`Ã¢Å“â€¦ SecciÃƒÂ³n ${i + 1} ya tiene suficientes imÃƒÂ¡genes (${imageCount})`);
          }
        }
      }

      if (sectionsNeedingImages.length === 0) {
        showNotification('Ã¢Å“â€¦ Todas las secciones ya tienen imÃƒÂ¡genes generadas.', 'success');
        return;
      }

      console.log(`Ã°Å¸Å½Â¯ Secciones que necesitan imÃƒÂ¡genes: ${sectionsNeedingImages.join(', ')}`);

      // Generar imÃƒÂ¡genes para todas las secciones en paralelo (mÃƒÂ¡ximo 10 concurrentes)
      // Solo usar APIs de Google gratis
      console.log('Ã°Å¸Å½Â¯ Generando imÃƒÂ¡genes en paralelo (mÃƒÂ¡ximo 10 concurrentes) usando solo APIs de Google gratis...');
      
      const imageGenerationPromises = [];
      const maxConcurrent = 10;
      let completedImages = 0;
      const totalImagesToGenerate = sectionsNeedingImages.length * imageCount;
      
      // Variables para tracking de resultados
      let successCount = 0;
      let errorCount = 0;
      const failedSections = [];
      
      // Obtener configuraciones para imÃƒÂ¡genes
      const imageInstructions = document.getElementById('promptModifier')?.value || '';
      const aspectRatio = document.getElementById('aspectRatioSelect')?.value || '9:16';
      
      // Obtener APIs de Google disponibles
      const selectedGoogleApis = getSelectedGoogleApis();
      
      // FunciÃƒÂ³n para procesar una secciÃƒÂ³n
      const processSection = async (sectionNum) => {
        try {
          console.log(`Ã°Å¸â€“Â¼Ã¯Â¸Â Generando ${imageCount} imÃƒÂ¡genes para secciÃƒÂ³n ${sectionNum}...`);
          
          // Llamar al backend para generar imÃƒÂ¡genes de esta secciÃƒÂ³n
          const response = await fetch('/api/generate-missing-images', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              folderName: folderName,
              imageInstructions: imageInstructions,
              imageCount: imageCount,
              aspectRatio: aspectRatio,
              useLocalAI: false, // Solo APIs de Google gratis
              comfyUIConfig: {},
              allowComfyFallback: false,
              comfyOnlyMode: false,
              sectionNumber: sectionNum,
              selectedApis: selectedGoogleApis.length > 0 ? selectedGoogleApis : ['GRATIS', 'GRATIS2', 'GRATIS3', 'GRATIS4', 'GRATIS5'], // APIs gratuitas por defecto
              imageModel: selectedImageModel,
              projectKey: folderName
            })
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.error || `Error en secciÃƒÂ³n ${sectionNum}`);
          }
          
          const data = await response.json();
          if (!data.success) {
            throw new Error(data.error || `Error desconocido en secciÃƒÂ³n ${sectionNum}`);
          }
          
          console.log(`Ã¢Å“â€¦ ImÃƒÂ¡genes generadas exitosamente para secciÃƒÂ³n ${sectionNum}`);
          return { sectionNum, success: true };
        } catch (error) {
          console.error(`Ã¢ÂÅ’ Error en secciÃƒÂ³n ${sectionNum}:`, error);
          return { sectionNum, success: false, error: error.message };
        }
      };
      
      // Procesar secciones en lotes de mÃƒÂ¡ximo 5 concurrentes
      for (let i = 0; i < sectionsNeedingImages.length; i += maxConcurrent) {
        const batch = sectionsNeedingImages.slice(i, i + maxConcurrent);
        console.log(`Ã°Å¸â€â€ž Procesando lote ${Math.floor(i/maxConcurrent) + 1}: secciones ${batch.join(', ')}`);
        
        const batchPromises = batch.map(sectionNum => processSection(sectionNum));
        const batchResults = await Promise.all(batchPromises);
        
        // Procesar resultados del lote
        batchResults.forEach(result => {
          if (result.success) {
            successCount++;
          } else {
            errorCount++;
            failedSections.push(result.sectionNum);
            showNotification(`Ã¢ÂÅ’ SecciÃƒÂ³n ${result.sectionNum}: ${result.error}`, 'error');
          }
        });
        
        // PequeÃƒÂ±a pausa entre lotes
        if (i + maxConcurrent < sectionsNeedingImages.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Mostrar resultado final
      if (successCount > 0) {
        const message = errorCount > 0
          ? `Ã¢Å“â€¦ Se generaron imÃƒÂ¡genes para ${successCount} secciones. ${errorCount} secciones fallaron: ${failedSections.join(', ')}.`
          : `Ã¢Å“â€¦ Se generaron imÃƒÂ¡genes exitosamente para todas las ${successCount} secciones que las necesitaban.`;
        showSuccess(message);
      } else {
        showError(`Ã¢ÂÅ’ No se pudieron generar imÃƒÂ¡genes para ninguna secciÃƒÂ³n. Secciones fallidas: ${failedSections.join(', ')}`);
      }

      return;
    }

    // CÃƒÂ³digo original para una secciÃƒÂ³n especÃƒÂ­fica continÃƒÂºa aquÃƒÂ­...
    // Obtener configuraciones para imÃƒÂ¡genes
  await loadComfyDefaultsFromServer();

  const imageInstructions = document.getElementById('promptModifier')?.value || '';
  imageCount = parseInt(document.getElementById('imagesSelect')?.value) || 5;
    const aspectRatio = document.getElementById('aspectRatioSelect')?.value || '9:16';
    const { width: defaultWidth, height: defaultHeight } = resolveComfyUIResolution(aspectRatio);
    const defaultSteps = getComfyDefaultSteps();
    const defaultGuidance = getComfyDefaultGuidance();
    const defaultCfg = getComfyDefaultCfg();
    
    // Verificar si se debe usar IA local (ComfyUI)
    let useLocalAI = document.getElementById('localAIImages')?.checked || false;
    attemptComfyCheckbox = document.getElementById('attemptComfyCheckbox');
    attemptComfyToggle = attemptComfyCheckbox ? attemptComfyCheckbox.closest('.attempt-comfy-toggle') : null;
    const comfyOnlyMode = attemptComfyCheckbox ? attemptComfyCheckbox.checked : false;
    const allowComfyFallback = comfyOnlyMode;

    if (comfyOnlyMode && !useLocalAI) {
      useLocalAI = true;
    }

    let selectedGoogleApis = [];
    if (!comfyOnlyMode) {
      const selectionReady = await ensureGoogleApiSelectionReady();
      if (!selectionReady) {
        showError('No se pudieron cargar las APIs de Google. Intenta recargar la pÃƒÂ¡gina.');
        return;
      }

      selectedGoogleApis = getSelectedGoogleApis();
      if (!selectedGoogleApis.length) {
        showError('Selecciona al menos una API de Google disponible antes de generar imÃƒÂ¡genes.');
        return;
      }
    } else {
      console.log('Ã°Å¸Å½Â¯ Modo Comfy directo activado: se omitirÃƒÂ¡n las APIs de Google para esta ejecuciÃƒÂ³n.');
    }
    
    // Obtener configuraciones de ComfyUI si estÃƒÂ¡ habilitado
    let comfyUIConfig = {};
    if (useLocalAI) {
      comfyUIConfig = {
        steps: parseInt(document.getElementById('comfyUISteps')?.value, 10) || defaultSteps,
        guidance: parseFloat(document.getElementById('comfyUIGuidance')?.value) || defaultGuidance,
        cfg: defaultCfg,
        width: parseInt(document.getElementById('comfyUIWidth')?.value, 10) || defaultWidth,
        height: parseInt(document.getElementById('comfyUIHeight')?.value, 10) || defaultHeight,
        model: document.getElementById('comfyUIModel')?.value || 'flux1-dev-fp8.safetensors',
        sampler: document.getElementById('comfyUISampler')?.value || 'euler',
        scheduler: document.getElementById('comfyUIScheduler')?.value || 'simple'
      };
    }
    
    console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Iniciando generaciÃƒÂ³n de imÃƒÂ¡genes faltantes...');
    console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â ConfiguraciÃƒÂ³n:', {
      proyecto: folderName,
      instrucciones: imageInstructions.substring(0, 50) + '...',
      cantidadImagenes: imageCount,
      cantidadImagenesElemento: document.getElementById('imagesSelect')?.value,
      usarIALocal: useLocalAI,
      intentarConComfy: allowComfyFallback,
      modoComfyDirecto: comfyOnlyMode,
      apisSeleccionadas: selectedGoogleApis,
      configComfyUI: useLocalAI ? comfyUIConfig : 'No aplicable',
      modeloImagen: getImageModelLabel(selectedImageModel),
      sectionNumber
    });

    if (comfyOnlyMode) {
      showNotification('Ã°Å¸Å½Â¨ Modo Comfy directo: las imÃƒÂ¡genes se generarÃƒÂ¡n de una en una usando ComfyUI.', 'info');
    } else if (!allowComfyFallback) {
      showNotification('Ã°Å¸â€Â Se intentarÃƒÂ¡ generar imÃƒÂ¡genes solo con las APIs. Si fallan por cuota, se cambiarÃƒÂ¡ automÃƒÂ¡ticamente a ComfyUI.', 'info');
    }
    
    // Deshabilitar botÃƒÂ³n y mostrar progreso
    const generateBtn = document.getElementById('generateMissingImagesBtn');
    const cancelBtn = document.getElementById('cancelMissingImagesBtn');
    if (generateBtn) {
      generateBtn.disabled = true;
      generateBtn.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        <span>Generando ImÃƒÂ¡genes...</span>
      `;
    }
    if (cancelBtn) {
      cancelBtn.style.display = 'inline-flex';
      cancelBtn.disabled = false;
      cancelBtn.innerHTML = `
        <i class="fas fa-stop-circle"></i>
        <span>Detener GeneraciÃƒÂ³n</span>
      `;
    }
    if (buttonElement) {
      buttonElement.disabled = true;
      buttonElement.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        <span>Generando...</span>
      `;
    }
    setGoogleApiCheckboxesDisabled(true);
    if (attemptComfyCheckbox) {
      attemptComfyCheckbox.disabled = true;
      if (attemptComfyToggle) {
        attemptComfyToggle.classList.add('is-disabled');
      }
    }

    isGeneratingImages = true;
    isCancellingImages = false;
  startSectionImageProgressPolling(projectData);
    updateSectionImageButtons(projectData);
    
    console.log('Ã°Å¸â€œÂ¤ ENVIANDO AL SERVIDOR:', {
      folderName: folderName,
      imageInstructions: imageInstructions,
      imageCount: imageCount,
      aspectRatio: aspectRatio,
      useLocalAI: useLocalAI,
      comfyUIConfig: comfyUIConfig,
      sectionNumber: sectionNumber,
      comfyOnlyMode: comfyOnlyMode,
      selectedApis: selectedGoogleApis,
      imageModel: selectedImageModel
    });

    // PRIMERA INTENTO: Con la configuraciÃƒÂ³n actual
    let response = await fetch('/api/generate-missing-images', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        folderName: folderName,
        imageInstructions: imageInstructions,
        imageCount: imageCount,
        aspectRatio: aspectRatio,
        useLocalAI: useLocalAI,
        comfyUIConfig: comfyUIConfig,
        allowComfyFallback: allowComfyFallback,
        comfyOnlyMode: comfyOnlyMode,
        sectionNumber: sectionNumber,
        selectedApis: selectedGoogleApis,
        imageModel: selectedImageModel
      })
    });
    
    let data = await response.json();

    // Si falla por cuota y no estamos en modo Comfy directo, intentar con ComfyUI
    if (!response.ok && !comfyOnlyMode && data?.error && 
        (data.error.includes('quota') || data.error.includes('429') || data.error.includes('Too Many Requests'))) {
      
      console.log('Ã°Å¸Å¡Â¨ Detectado error de cuota en APIs de Google. Cambiando automÃƒÂ¡ticamente a ComfyUI...');
      showNotification('Ã°Å¸Å¡Â¨ Cuota de APIs gratuitas agotada. Cambiando automÃƒÂ¡ticamente a ComfyUI (IA Local)...', 'warning');
      
      // Cambiar configuraciÃƒÂ³n para usar ComfyUI
      useLocalAI = true;
      comfyOnlyMode = true;
      allowComfyFallback = true;
      selectedGoogleApis = []; // No usar APIs de Google
      
      // Reintentar con ComfyUI
      console.log('Ã°Å¸â€â€ž Reintentando con ComfyUI...');
      
      response = await fetch('/api/generate-missing-images', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          folderName: folderName,
          imageInstructions: imageInstructions,
          imageCount: imageCount,
          aspectRatio: aspectRatio,
          useLocalAI: useLocalAI,
          comfyUIConfig: comfyUIConfig,
          allowComfyFallback: allowComfyFallback,
          comfyOnlyMode: comfyOnlyMode,
          sectionNumber: sectionNumber,
          selectedApis: selectedGoogleApis,
          imageModel: selectedImageModel
        })
      });
      
      data = await response.json();
    }

    if (!response.ok) {
      throw new Error(data?.error || data?.message || 'Error generando imÃƒÂ¡genes');
    }

    if (data.cancelled) {
      const cancelPrefix = sectionNumber ? `SecciÃƒÂ³n ${sectionNumber}` : 'Proceso completo';
      showNotification(`Ã¢â€ºâ€Ã¯Â¸Â ${cancelPrefix}: ${data.message || 'La generaciÃƒÂ³n de imÃƒÂ¡genes fue cancelada.'}`, 'info');
      console.log('Ã°Å¸â€ºâ€˜ GeneraciÃƒÂ³n cancelada por el usuario:', data);
      return;
    }

    if (data.success) {
      const successPrefix = sectionNumber ? `SecciÃƒÂ³n ${sectionNumber}` : 'Proceso completo';
      showSuccess(`Ã¢Å“â€¦ ${successPrefix}: ${data.message}`);
      console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Resultados:', data.data);
      
      // Mostrar detalles si hay informaciÃƒÂ³n adicional
      if (data.data.generatedPrompts && data.data.generatedPrompts.length > 0) {
        console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Prompts generados para secciones:', data.data.generatedPrompts);
      }
      
      if (data.data.generatedImages && data.data.generatedImages.length > 0) {
        console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â ImÃƒÂ¡genes generadas para secciones:', data.data.generatedImages);
      }

      const generatedPrompts = Array.isArray(data?.data?.generatedPrompts) ? data.data.generatedPrompts : [];
      generatedPrompts.forEach((entry) => {
        const entrySection = Number(entry?.section ?? entry?.sectionNumber ?? entry?.id ?? entry?.index);
        if (!Number.isInteger(entrySection) || entrySection <= 0) {
          return;
        }

        const entryPrompts = Array.isArray(entry?.prompts) ? entry.prompts.filter((item) => typeof item === 'string' && item.trim().length > 0) : [];

        if (entryPrompts.length) {
          updateProjectSectionImageData(entrySection, { prompts: entryPrompts }, projectData);
          updateSectionImageProgressStat(entrySection, { promptCount: entryPrompts.length });
        }
      });

      const generatedImages = Array.isArray(data?.data?.generatedImages) ? data.data.generatedImages : [];
      generatedImages.forEach((entry) => {
        const entrySection = Number(entry?.section ?? entry?.sectionNumber ?? entry?.id ?? entry?.index);
        if (!Number.isInteger(entrySection) || entrySection <= 0) {
          return;
        }

        const entryPrompts = Array.isArray(entry?.prompts) ? entry.prompts.filter((item) => typeof item === 'string' && item.trim().length > 0) : [];
        const entryImages = Array.isArray(entry?.images) ? entry.images : Array.isArray(entry?.imageUrls) ? entry.imageUrls : [];
        const entryImageCountValue = Number(entry?.imageCount);
        const entryImageCount = entryImages.length
          ? entryImages.length
          : Number.isFinite(entryImageCountValue) && entryImageCountValue >= 0
            ? Math.floor(entryImageCountValue)
            : 0;

        updateProjectSectionImageData(entrySection, {
          prompts: entryPrompts.length ? entryPrompts : undefined,
          imageUrls: Array.isArray(entry?.imageUrls) ? entry.imageUrls : undefined,
          imageCount: entryImageCount
        }, projectData);

        const statUpdates = { imageCount: entryImageCount };
        if (entryPrompts.length) {
          statUpdates.promptCount = entryPrompts.length;
        }

        updateSectionImageProgressStat(entrySection, statUpdates);
      });
      
    } else {
      throw new Error(data.error || 'Error desconocido generando imÃƒÂ¡genes');
    }
    
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error generando imÃƒÂ¡genes:', error);
    if (error?.code === 'CANCELLED_BY_USER' || error?.message?.toLowerCase().includes('cancelado')) {
      showNotification(`Ã¢â€ºâ€Ã¯Â¸Â ${error.message}`, 'info');
    } else {
      showError(`Error generando imÃƒÂ¡genes: ${error.message}`);
    }
  } finally {
    isGeneratingImages = false;
    isCancellingImages = false;
    stopSectionImageProgressPolling();
    updateSectionImageButtons(projectOverride || window.currentProject);

    // Restaurar botÃƒÂ³n
    const generateBtn = document.getElementById('generateMissingImagesBtn');
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.innerHTML = `
        <i class="fas fa-image"></i>
        <span>Generar ImÃƒÂ¡genes Faltantes</span>
      `;
    }
    const cancelBtn = document.getElementById('cancelMissingImagesBtn');
    if (cancelBtn) {
      cancelBtn.style.display = 'none';
      cancelBtn.disabled = false;
      cancelBtn.innerHTML = `
        <i class="fas fa-stop-circle"></i>
        <span>Detener GeneraciÃƒÂ³n</span>
      `;
    }
    if (buttonElement) {
      buttonElement.disabled = false;
      if (originalButtonHtml !== null) {
        buttonElement.innerHTML = originalButtonHtml;
      } else {
        buttonElement.innerHTML = `
          <i class="fas fa-images"></i>
          <span>SecciÃƒÂ³n ${sectionNumber || ''}</span>
        `;
      }
    }
    if (attemptComfyCheckbox) {
      attemptComfyCheckbox.disabled = false;
      if (attemptComfyToggle) {
        attemptComfyToggle.classList.remove('is-disabled');
      }
    }
    setGoogleApiCheckboxesDisabled(false);
  }
}

async function cancelMissingImagesGeneration() {
  if (!isGeneratingImages) {
    showNotification('Ã¢â€žÂ¹Ã¯Â¸Â No hay una generaciÃƒÂ³n de imÃƒÂ¡genes en curso.', 'info');
    return;
  }

  if (isCancellingImages) {
    showNotification('Ã¢ÂÂ³ Ya se solicitÃƒÂ³ la cancelaciÃƒÂ³n. Espera un momento.', 'info');
    return;
  }

  const cancelBtn = document.getElementById('cancelMissingImagesBtn');
  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.innerHTML = `
      <i class="fas fa-spinner fa-spin"></i>
      <span>Cancelando...</span>
    `;
  }

  isCancellingImages = true;

  try {
    const response = await fetch('/api/cancel-missing-images', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (response.ok && data.success) {
      showNotification(data.message || 'CancelaciÃƒÂ³n solicitada. El proceso se detendrÃƒÂ¡ en breve.', 'info');
    } else {
      const errorMessage = data?.message || data?.error || 'No se pudo cancelar la generaciÃƒÂ³n de imÃƒÂ¡genes.';
      showError(errorMessage);
    }
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error cancelando la generaciÃƒÂ³n de imÃƒÂ¡genes:', error);
    showError(`Error cancelando la generaciÃƒÂ³n de imÃƒÂ¡genes: ${error.message}`);
  } finally {
    isCancellingImages = false;
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.innerHTML = `
        <i class="fas fa-stop-circle"></i>
        <span>Detener GeneraciÃƒÂ³n</span>
      `;
    }
  }
}

// FunciÃƒÂ³n auxiliar para verificar si una secciÃƒÂ³n ya tiene imÃƒÂ¡genes generadas
async function checkIfSectionHasImages(folderName, sectionNumber, expectedCount = 1) {
  try {
    const response = await fetch(`/api/check-section-images?folderName=${encodeURIComponent(folderName)}&sectionNumber=${sectionNumber}`);
    if (response.ok) {
      const data = await response.json();
      return (data.imageCount || 0) >= expectedCount;
    }
    return false;
  } catch (error) {
    console.warn(`Ã¢Å¡Â Ã¯Â¸Â Error verificando imÃƒÂ¡genes para secciÃƒÂ³n ${sectionNumber}:`, error);
    return false;
  }
}

// FunciÃƒÂ³n auxiliar para generar imÃƒÂ¡genes para una secciÃƒÂ³n especÃƒÂ­fica
async function generateMissingImagesForSection(options) {
  const { folderName, sectionNumber, projectData, selectedImageModel, imageCount: overrideImageCount } = options;

  const pollingProject = projectData || window.currentProject || null;
  startSectionImageProgressPolling(pollingProject);

  try {
    // Obtener configuraciones para imÃƒÂ¡genes
    await loadComfyDefaultsFromServer();

    const imageInstructions = document.getElementById('promptModifier')?.value || '';
    const imageCount = overrideImageCount || parseInt(document.getElementById('imagesSelect')?.value) || 10;
    const aspectRatio = document.getElementById('aspectRatioSelect')?.value || '9:16';
    const { width: defaultWidth, height: defaultHeight } = resolveComfyUIResolution(aspectRatio);
    const defaultSteps = getComfyDefaultSteps();
    const defaultGuidance = getComfyDefaultGuidance();
    const defaultCfg = getComfyDefaultCfg();

    // Verificar si se debe usar IA local (ComfyUI)
    let useLocalAI = document.getElementById('localAIImages')?.checked || false;
    const attemptComfyCheckbox = document.getElementById('attemptComfyCheckbox');
    const comfyOnlyMode = attemptComfyCheckbox ? attemptComfyCheckbox.checked : false;
    const allowComfyFallback = comfyOnlyMode;

    if (comfyOnlyMode && !useLocalAI) {
      useLocalAI = true;
    }

    let selectedGoogleApis = [];
    if (!comfyOnlyMode) {
      const selectionReady = await ensureGoogleApiSelectionReady();
      if (!selectionReady) {
        throw new Error('No se pudieron cargar las APIs de Google.');
      }

      selectedGoogleApis = getSelectedGoogleApis();
      if (!selectedGoogleApis.length) {
        throw new Error('Selecciona al menos una API de Google disponible.');
      }
    }

    // Obtener configuraciones de ComfyUI si estÃƒÂ¡ habilitado
    let comfyUIConfig = {};
    if (useLocalAI) {
      comfyUIConfig = {
        steps: parseInt(document.getElementById('comfyUISteps')?.value, 10) || defaultSteps,
        guidance: parseFloat(document.getElementById('comfyUIGuidance')?.value) || defaultGuidance,
        cfg: defaultCfg,
        width: parseInt(document.getElementById('comfyUIWidth')?.value, 10) || defaultWidth,
        height: parseInt(document.getElementById('comfyUIHeight')?.value, 10) || defaultHeight,
        model: document.getElementById('comfyUIModel')?.value || 'flux1-dev-fp8.safetensors',
        sampler: document.getElementById('comfyUISampler')?.value || 'euler',
        scheduler: document.getElementById('comfyUIScheduler')?.value || 'simple'
      };
    }

    // PRIMERA INTENTO: Con la configuraciÃƒÂ³n actual
    let response = await fetch('/api/generate-missing-images', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        folderName: folderName,
        imageInstructions: imageInstructions,
        imageCount: imageCount,
        aspectRatio: aspectRatio,
        useLocalAI: useLocalAI,
        comfyUIConfig: comfyUIConfig,
        allowComfyFallback: allowComfyFallback,
        comfyOnlyMode: comfyOnlyMode,
        sectionNumber: sectionNumber,
        selectedApis: selectedGoogleApis,
        imageModel: selectedImageModel
      })
    });

    let data = await response.json();

    // Si falla por cuota, error de stream, o cualquier error de Google Gemini, intentar con ComfyUI
    if (!response.ok && !comfyOnlyMode && data?.error &&
        (data.error.includes('quota') || data.error.includes('429') ||
         data.error.includes('Too Many Requests') || data.error.includes('Failed to parse stream') ||
         data.error.includes('GoogleGenerativeAI'))) {

      console.log(`Ã°Å¸Å¡Â¨ SecciÃƒÂ³n ${sectionNumber} - Error detectado (${data.error}). Cambiando automÃƒÂ¡ticamente a ComfyUI...`);

      // Cambiar configuraciÃƒÂ³n para usar ComfyUI
      useLocalAI = true;
      comfyOnlyMode = true;
      allowComfyFallback = true;
      selectedGoogleApis = []; // No usar APIs de Google

      // Reintentar con ComfyUI
      console.log(`Ã°Å¸â€â€ž SecciÃƒÂ³n ${sectionNumber} - Reintentando con ComfyUI...`);

      response = await fetch('/api/generate-missing-images', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          folderName: folderName,
          imageInstructions: imageInstructions,
          imageCount: imageCount,
          aspectRatio: aspectRatio,
          useLocalAI: useLocalAI,
          comfyUIConfig: comfyUIConfig,
          allowComfyFallback: allowComfyFallback,
          comfyOnlyMode: comfyOnlyMode,
          sectionNumber: sectionNumber,
          selectedApis: selectedGoogleApis,
          imageModel: selectedImageModel
        })
      });

      data = await response.json();
    }

    if (!response.ok) {
      throw new Error(data?.error || data?.message || 'Error generando imÃƒÂ¡genes');
    }

    if (data.cancelled) {
      throw new Error(`SecciÃƒÂ³n ${sectionNumber}: ${data.message || 'La generaciÃƒÂ³n fue cancelada.'}`);
    }

    if (!data.success) {
      throw new Error(data.error || 'Error desconocido generando imÃƒÂ¡genes');
    }

    return data;
  } finally {
    stopSectionImageProgressPolling();
  }
}

// FunciÃƒÂ³n auxiliar para verificar si una secciÃƒÂ³n ya tiene imÃƒÂ¡genes generadas

// ValidaciÃƒÂ³n para minWords y maxWords
document.addEventListener('DOMContentLoaded', function() {
  const minWordsInput = document.getElementById('minWords');
  const maxWordsInput = document.getElementById('maxWords');

  if (minWordsInput && maxWordsInput) {
    function validateWordsRange() {
      const minVal = parseInt(minWordsInput.value) || 0;
      const maxVal = parseInt(maxWordsInput.value) || 0;

      if (maxVal < minVal + 100) {
        maxWordsInput.value = minVal + 100;
      }
    }

    minWordsInput.addEventListener('input', validateWordsRange);
    maxWordsInput.addEventListener('input', validateWordsRange);
  }

  // Formateo automÃƒÂ¡tico para el input de duraciÃƒÂ³n (MM:SS)
  const targetDurationInput = document.getElementById('targetDurationInput');
  if (targetDurationInput) {
    targetDurationInput.addEventListener('input', function(e) {
      let value = e.target.value.replace(/\D/g, ''); // Eliminar no dÃƒÂ­gitos
      if (value.length > 4) value = value.slice(0, 4); // Limitar a 4 dÃƒÂ­gitos
      
      if (value.length >= 3) {
        value = value.slice(0, value.length - 2) + ':' + value.slice(value.length - 2);
      }
      
      e.target.value = value;
    });
  }

  // Configurar botones de traducciÃƒÂ³n
  const translateBtns = document.querySelectorAll('.translate-btn');
  translateBtns.forEach(btn => {
    btn.addEventListener('click', async function() {
      const lang = this.getAttribute('data-lang');
      const langNames = {
        'en': 'InglÃƒÂ©s', 'fr': 'FrancÃƒÂ©s', 'de': 'AlemÃƒÂ¡n', 
        'ko': 'Coreano', 'ru': 'Ruso', 'pt': 'PortuguÃƒÂ©s', 'zh': 'Chino'
      };
      
      if (!window.currentProject || !window.currentProject.folderName) {
        showNotification('Ã¢ÂÅ’ No hay un proyecto cargado para traducir', 'error');
        return;
      }

      if (confirm(`Ã‚Â¿EstÃƒÂ¡s seguro de traducir todo el proyecto al ${langNames[lang]}? Esto generarÃƒÂ¡ nuevos archivos de guion.`)) {
        await translateProjectScripts(lang);
      }
    });
  });

  // Configurar botÃƒÂ³n de traducir a todos
  const translateAllBtn = document.getElementById('translateAllBtn');
  if (translateAllBtn) {
    translateAllBtn.addEventListener('click', async function() {
      if (!window.currentProject || !window.currentProject.folderName) {
        showNotification('Ã¢ÂÅ’ No hay un proyecto cargado para traducir', 'error');
        return;
      }

      if (confirm('Ã‚Â¿EstÃƒÂ¡s seguro de traducir el proyecto a TODOS los idiomas (EN, FR, DE, KO, RU, PT, ZH)?\n\nEsto se harÃƒÂ¡ en paralelo para mayor velocidad.')) {
        await translateProjectAll();
      }
    });
  }

  // Configurar botÃƒÂ³n de generar audios de traducciÃƒÂ³n
  const generateTranslatedAudiosBtn = document.getElementById('generateTranslatedAudiosBtn');
  if (generateTranslatedAudiosBtn) {
    generateTranslatedAudiosBtn.addEventListener('click', async function() {
      if (!window.currentProject || !window.currentProject.folderName) {
        showNotification('Ã¢ÂÅ’ No hay un proyecto cargado', 'error');
        return;
      }

      const autoGenerateApplioAudio = document.getElementById('autoGenerateApplioAudio').checked;
      if (!autoGenerateApplioAudio) {
        showNotification('Ã¢Å¡Â Ã¯Â¸Â Debes activar la casilla "Incluir Audio Applio" para usar esta funciÃƒÂ³n', 'warning');
        return;
      }

      if (confirm('Ã‚Â¿Generar audios para todos los guiones traducidos usando Applio?\n\nEsto puede tomar tiempo dependiendo de la cantidad de archivos.')) {
        await generateTranslatedAudios();
      }
    });
  }
});

async function generateTranslatedAudios() {
  const progressDiv = document.getElementById('translationProgress');
  const progressBar = document.getElementById('translationProgressBar');
  const statusText = document.getElementById('translationStatus');
  const buttons = document.querySelectorAll('.translate-btn');
  const translateAllBtn = document.getElementById('translateAllBtn');
  const generateTranslatedAudiosBtn = document.getElementById('generateTranslatedAudiosBtn');
  
  // Mostrar progreso y deshabilitar botones
  progressDiv.style.display = 'block';
  buttons.forEach(b => b.disabled = true);
  if (translateAllBtn) translateAllBtn.disabled = true;
  if (generateTranslatedAudiosBtn) generateTranslatedAudiosBtn.disabled = true;
  
  try {
    const folderName = window.currentProject.folderName;
    const totalSections = window.currentProject.totalSections || window.currentProject.completedSections.length;
    
    // Obtener parÃƒÂ¡metros de Applio
    const applioVoice = document.getElementById("applioVoiceSelect").value;
    const applioModel = document.getElementById("applioModelSelect").value;
    const applioPitch = parseInt(document.getElementById("applioPitch").value) || 0;
    const applioSpeed = parseInt(document.getElementById("applioSpeed").value) || 0;
    
    // Parsear duraciÃƒÂ³n objetivo (MM:SS)
    const targetDurationInput = document.getElementById("targetDurationInput").value;
    let targetDuration = 0;
    if (targetDurationInput && targetDurationInput.includes(':')) {
        const parts = targetDurationInput.split(':');
        if (parts.length === 2) {
            const minutes = parseInt(parts[0]) || 0;
            const seconds = parseInt(parts[1]) || 0;
            targetDuration = (minutes * 60) + seconds;
        }
    }

    statusText.textContent = `Iniciando generaciÃƒÂ³n de audios traducidos...`;
    progressBar.style.width = '2%';

    const response = await fetch('/generate-translated-audios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: folderName,
        totalSections: totalSections,
        applioVoice: applioVoice,
        applioModel: applioModel, // Este es el modelo TTS base que se usarÃƒÂ¡ si no hay uno especÃƒÂ­fico por idioma
        applioPitch: applioPitch,
        applioSpeed: applioSpeed,
        targetDuration: targetDuration
      })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const startTime = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.progress) {
              // Fix: usar data.totalTasks en lugar de data.total
              const total = data.totalTasks || data.total || 1;
              const current = data.completedTasks || data.current || 0;
              const percent = Math.round((current / total) * 100);
              
              // CÃƒÂ¡lculo de tiempo estimado
              const elapsedTime = Date.now() - startTime;
              let timeString = "";
              
              if (current > 0) {
                const msPerTask = elapsedTime / current;
                const remainingTasks = total - current;
                const remainingMs = msPerTask * remainingTasks;
                
                // Formatear tiempo restante
                const remainingSeconds = Math.ceil(remainingMs / 1000);
                if (remainingSeconds < 60) {
                  timeString = ` - Restante: ${remainingSeconds}s`;
                } else {
                  const mins = Math.floor(remainingSeconds / 60);
                  const secs = remainingSeconds % 60;
                  timeString = ` - Restante: ${mins}m ${secs}s`;
                }
              }

              progressBar.style.width = `${percent}%`;
              statusText.textContent = `Generando audio: ${current} de ${total} (${percent}%)${timeString}`;
            }
            
            if (data.complete) {
              statusText.textContent = 'Ã¢Å“â€¦ GeneraciÃƒÂ³n de audios completada';
              showNotification('Ã¢Å“â€¦ Audios traducidos generados exitosamente', 'success');
              setTimeout(() => {
                progressDiv.style.display = 'none';
                buttons.forEach(b => b.disabled = false);
                if (translateAllBtn) translateAllBtn.disabled = false;
                if (generateTranslatedAudiosBtn) generateTranslatedAudiosBtn.disabled = false;
              }, 3000);
            }
            
            if (data.error) {
              throw new Error(data.error);
            }
          } catch (e) {
            console.warn('Error parseando SSE:', e);
          }
        }
      }
    }

  } catch (error) {
    console.error('Error en generaciÃƒÂ³n de audios:', error);
    statusText.textContent = 'Ã¢ÂÅ’ Error: ' + error.message;
    statusText.style.color = '#fc8181';
    showNotification('Ã¢ÂÅ’ Error generando audios', 'error');
    buttons.forEach(b => b.disabled = false);
    if (translateAllBtn) translateAllBtn.disabled = false;
    if (generateTranslatedAudiosBtn) generateTranslatedAudiosBtn.disabled = false;
  }
}

async function translateProjectAll() {
  const progressDiv = document.getElementById('translationProgress');
  const progressBar = document.getElementById('translationProgressBar');
  const statusText = document.getElementById('translationStatus');
  const buttons = document.querySelectorAll('.translate-btn');
  const translateAllBtn = document.getElementById('translateAllBtn');
  
  // Mostrar progreso y deshabilitar botones
  progressDiv.style.display = 'block';
  buttons.forEach(b => b.disabled = true);
  if (translateAllBtn) translateAllBtn.disabled = true;
  
  try {
    const folderName = window.currentProject.folderName;
    const totalSections = window.currentProject.totalSections || window.currentProject.completedSections.length;
    
    statusText.textContent = `Iniciando traducciÃƒÂ³n masiva paralela...`;
    progressBar.style.width = '2%';

    const response = await fetch('/translate-project-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: folderName,
        totalSections: totalSections
      })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const startTime = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.progress) {
              // Fix: usar data.totalTasks en lugar de data.total
              const total = data.totalTasks || data.total || 1;
              const current = data.completedTasks || data.current || 0;
              const percent = Math.round((current / total) * 100);
              
              // CÃƒÂ¡lculo de tiempo estimado
              const elapsedTime = Date.now() - startTime;
              let timeString = "";
              
              if (current > 0) {
                const msPerTask = elapsedTime / current;
                const remainingTasks = total - current;
                const remainingMs = msPerTask * remainingTasks;
                
                // Formatear tiempo restante
                const remainingSeconds = Math.ceil(remainingMs / 1000);
                if (remainingSeconds < 60) {
                  timeString = ` - Restante: ${remainingSeconds}s`;
                } else {
                  const mins = Math.floor(remainingSeconds / 60);
                  const secs = remainingSeconds % 60;
                  timeString = ` - Restante: ${mins}m ${secs}s`;
                }
              }

              progressBar.style.width = `${percent}%`;
              statusText.textContent = `Traduciendo: ${current} de ${total} archivos (${percent}%)${timeString}`;
            }
            
            if (data.complete) {
              statusText.textContent = 'Ã¢Å“â€¦ TraducciÃƒÂ³n masiva completada exitosamente';
              showNotification('Ã¢Å“â€¦ Proyecto traducido a todos los idiomas', 'success');
              setTimeout(() => {
                progressDiv.style.display = 'none';
                buttons.forEach(b => b.disabled = false);
                if (translateAllBtn) translateAllBtn.disabled = false;
              }, 3000);
            }
            
            if (data.error) {
              throw new Error(data.error);
            }
          } catch (e) {
            console.warn('Error parseando SSE:', e);
          }
        }
      }
    }

  } catch (error) {
    console.error('Error en traducciÃƒÂ³n masiva:', error);
    statusText.textContent = 'Ã¢ÂÅ’ Error: ' + error.message;
    statusText.style.color = '#fc8181';
    showNotification('Ã¢ÂÅ’ Error durante la traducciÃƒÂ³n masiva', 'error');
    buttons.forEach(b => b.disabled = false);
    if (translateAllBtn) translateAllBtn.disabled = false;
  }
}

async function translateProjectScripts(targetLang) {
  const progressDiv = document.getElementById('translationProgress');
  const progressBar = document.getElementById('translationProgressBar');
  const statusText = document.getElementById('translationStatus');
  const buttons = document.querySelectorAll('.translate-btn');
  
  // Mostrar progreso y deshabilitar botones
  progressDiv.style.display = 'block';
  buttons.forEach(b => b.disabled = true);
  
  try {
    const folderName = window.currentProject.folderName;
    const totalSections = window.currentProject.totalSections || window.currentProject.completedSections.length;
    
    statusText.textContent = `Iniciando traducciÃƒÂ³n de ${totalSections} secciones...`;
    progressBar.style.width = '5%';

    const response = await fetch('/translate-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: folderName,
        targetLang: targetLang,
        totalSections: totalSections
      })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          
          if (data.progress) {
            const percent = Math.round((data.current / data.total) * 100);
            progressBar.style.width = `${percent}%`;
            statusText.textContent = `Traduciendo secciÃƒÂ³n ${data.current} de ${data.total}...`;
          }
          
          if (data.complete) {
            statusText.textContent = 'Ã¢Å“â€¦ TraducciÃƒÂ³n completada exitosamente';
            showNotification('Ã¢Å“â€¦ Proyecto traducido correctamente', 'success');
            setTimeout(() => {
              progressDiv.style.display = 'none';
              buttons.forEach(b => b.disabled = false);
            }, 3000);
          }
          
          if (data.error) {
            throw new Error(data.error);
          }
        }
      }
    }

  } catch (error) {
    console.error('Error en traducciÃƒÂ³n:', error);
    statusText.textContent = 'Ã¢ÂÅ’ Error: ' + error.message;
    statusText.style.color = '#fc8181';
    showNotification('Ã¢ÂÅ’ Error durante la traducciÃƒÂ³n', 'error');
    buttons.forEach(b => b.disabled = false);
  }
}

// LÃ³gica para traducciÃ³n de tÃ­tulos
document.addEventListener('DOMContentLoaded', function() {
  const translateTitleBtn = document.getElementById('translateTitleBtn');
  const titleInput = document.getElementById('titleInput');
  const translatedTitlesList = document.getElementById('translatedTitlesList');

  if (translateTitleBtn && titleInput) {
    translateTitleBtn.addEventListener('click', async function() {
      const title = titleInput.value.trim();
      if (!title) {
        showNotification(' Por favor ingresa un tÃ­tulo', 'warning');
        return;
      }

      // UI Loading State
      const originalBtnText = translateTitleBtn.innerHTML;
      translateTitleBtn.disabled = true;
      translateTitleBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Traduciendo...';
      translatedTitlesList.style.display = 'none';
      translatedTitlesList.innerHTML = '';

      try {
        const response = await fetch('/translate-title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title })
        });

        if (!response.ok) throw new Error('Error en la traducciÃ³n');

        const translations = await response.json();
        
        // Render results
        const langNames = {
          'en': 'InglÃ©s', 'fr': 'FrancÃ©s', 'de': 'AlemÃ¡n', 
          'ko': 'Coreano', 'ru': 'Ruso', 'pt': 'PortuguÃ©s', 'zh': 'Chino'
        };

        const flags = {
          'en': 'ðŸ‡ºðŸ‡¸', 'fr': 'ðŸ‡«ðŸ‡·', 'de': 'ðŸ‡©ðŸ‡ª', 
          'ko': 'ðŸ‡°ðŸ‡·', 'ru': 'ðŸ‡·ðŸ‡º', 'pt': 'ðŸ‡µðŸ‡¹', 'zh': 'ðŸ‡¨ðŸ‡³'
        };

        Object.entries(translations).forEach(([lang, translatedTitle]) => {
          const item = document.createElement('div');
          item.className = 'translated-title-item';
          item.style.cssText = 'background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--color-border-soft);';
          
          item.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 4px; overflow: hidden;">
              <span style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 5px;">
                ${flags[lang] || ''} ${langNames[lang] || lang.toUpperCase()}
              </span>
              <span class="title-text" style="font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${translatedTitle}</span>
            </div>
            <button class="copy-btn" style="background: transparent; border: none; color: var(--color-accent-2); cursor: pointer; padding: 5px; transition: transform 0.2s;" title="Copiar">
              <i class="fas fa-copy"></i>
            </button>
          `;

          // Copy functionality
          const copyBtn = item.querySelector('.copy-btn');
          copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(translatedTitle).then(() => {
              const icon = copyBtn.querySelector('i');
              icon.className = 'fas fa-check';
              setTimeout(() => icon.className = 'fas fa-copy', 1500);
              showNotification('Copiado al portapapeles', 'success');
            });
          });

          translatedTitlesList.appendChild(item);
        });

        translatedTitlesList.style.display = 'grid';

      } catch (error) {
        console.error(error);
        showNotification(' Error al traducir el tÃ­tulo', 'error');
      } finally {
        translateTitleBtn.disabled = false;
        translateTitleBtn.innerHTML = originalBtnText;
      }
    });
  }
});

// --- Funciones para Traducir Videos ---

function openTranslateVideoModal() {
  const modal = document.getElementById('translateVideoModal');
  if (modal) {
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
  }
  collapseSidebar();
}

function closeTranslateVideoModal() {
  const modal = document.getElementById('translateVideoModal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 300);
    // Reset form
    const fileInput = document.getElementById('videoUpload');
    const fileNameDisplay = document.getElementById('videoFileName');
    const generateBtn = document.getElementById('generateTranslatedVideoBtn');
    const progressContainer = document.getElementById('translateVideoProgress');
    
    if(fileInput) fileInput.value = '';
    if(fileNameDisplay) fileNameDisplay.textContent = '';
    if(generateBtn) generateBtn.disabled = true;
    if(progressContainer) progressContainer.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', function() {
    const translateVideoBtn = document.getElementById('translateVideoBtn');
    
    // Funciones globales para tabs de traducciÃ³n
    window.switchTranslateTab = function(tabName) {
        // Update Buttons
        document.querySelectorAll('.modal-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(tabName === 'auto' ? 'tabBtnAuto' : 'tabBtnManual').classList.add('active');
        
        // Update Button Styles (Visual feedback)
        const autoBtn = document.getElementById('tabBtnAuto');
        const manualBtn = document.getElementById('tabBtnManual');
        
        if (tabName === 'auto') {
            autoBtn.style.color = 'white';
            autoBtn.style.borderBottom = '2px solid #4fd1c5';
            manualBtn.style.color = '#a0aec0';
            manualBtn.style.borderBottom = 'none';
        } else {
            manualBtn.style.color = 'white';
            manualBtn.style.borderBottom = '2px solid #4fd1c5';
            autoBtn.style.color = '#a0aec0';
            autoBtn.style.borderBottom = 'none';
        }

        // Update Content
        document.getElementById('tabContentAuto').style.display = tabName === 'auto' ? 'block' : 'none';
        document.getElementById('tabContentManual').style.display = tabName === 'manual' ? 'block' : 'none';

        // Update Generate Button Text
        const generateBtn = document.getElementById('generateTranslatedVideoBtn');
        if (generateBtn) {
            generateBtn.innerHTML = tabName === 'auto' 
                ? '<i class="fas fa-magic"></i> Generar Audios de TraducciÃ³n' 
                : '<i class="fas fa-hammer"></i> Generar Videos Manualmente';
        }
    };

    if (translateVideoBtn) {
        translateVideoBtn.addEventListener('click', openTranslateVideoModal);
    }

    const closeTranslateVideoModalBtn = document.getElementById('closeTranslateVideoModal');
    if (closeTranslateVideoModalBtn) {
        closeTranslateVideoModalBtn.addEventListener('click', closeTranslateVideoModal);
    }

    const cancelTranslateVideoBtn = document.getElementById('cancelTranslateVideoBtn');
    if (cancelTranslateVideoBtn) {
        cancelTranslateVideoBtn.addEventListener('click', closeTranslateVideoModal);
    }

    // Drag and Drop Logic
    const dropZone = document.getElementById('videoDropZone');
    const fileInput = document.getElementById('videoUpload');
    const fileNameDisplay = document.getElementById('videoFileName');
    
    const musicDropZone = document.getElementById('musicDropZone');
    const musicInput = document.getElementById('musicUpload');
    const musicNameDisplay = document.getElementById('musicFileName');

    const generateBtn = document.getElementById('generateTranslatedVideoBtn');

    // Expose toggleVoiceSelect globally so it can be called from HTML
    window.toggleVoiceSelect = function() {
        const selectedProvider = document.querySelector('input[name="ttsProvider"]:checked')?.value;
        const container = document.getElementById('googleVoiceSelectContainer');
        if (container) {
            container.style.display = (selectedProvider === 'google' || selectedProvider === 'google_pro') ? 'block' : 'none';
        }
    };

    // Helper para configurar DropZones
    function setupDropZone(dropZoneId, inputId, displayId, allowedTypes, onFileSelect) {
        const dropZone = document.getElementById(dropZoneId);
        const input = document.getElementById(inputId);
        const display = document.getElementById(displayId);

        if (!dropZone || !input) return;

        dropZone.addEventListener('click', (e) => {
             // Evitar doble click si se hace click en el input mismo
             if (e.target !== input) input.click();
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
                input.files = e.dataTransfer.files;
                validateAndHandle(input.files[0]);
            }
        });

        input.addEventListener('change', () => {
            if (input.files.length) {
                validateAndHandle(input.files[0]);
            }
        });

        function validateAndHandle(file) {
            let valid = false;
            
            if (allowedTypes === 'video') {
                if (file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4')) valid = true;
                else alert('Por favor, selecciona un archivo .mp4 vÃ¡lido.');
            } else if (allowedTypes === 'audio') {
                 if (file.type.startsWith('audio/') || file.name.toLowerCase().endsWith('.mp3') || file.name.toLowerCase().endsWith('.wav')) valid = true;
                 else alert('Por favor, selecciona un archivo de audio vÃ¡lido (.mp3, .wav).');
            }

            if (valid) {
                if (display) display.textContent = file.name;
                if (onFileSelect) onFileSelect(file);
            } else {
                input.value = '';
                if (display) display.textContent = '';
            }
        }
    }

    // Configurar DropZones Originales (AUTO)
    setupDropZone('videoDropZone', 'videoUpload', 'videoFileName', 'video', (file) => {
        const btn = document.getElementById('generateTranslatedVideoBtn');
        if(btn) btn.disabled = false;
    });
    setupDropZone('musicDropZone', 'musicUpload', 'musicFileName', 'audio');

    // Configurar DropZones Manuales
    setupDropZone('dropZone_manual_video', 'videoUploadManual', 'fileName_manual_video', 'video', () => {
         const btn = document.getElementById('generateTranslatedVideoBtn');
         if(btn) btn.disabled = false;
    });
    setupDropZone('dropZone_manual_music', 'musicUploadManual', 'fileName_manual_music', 'audio');

    // Configurar DropZones de Idiomas
    ['en', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ko', 'ja'].forEach(lang => {
        setupDropZone(`dropZone_manual_${lang}`, `manual_audio_${lang}`, `fileName_manual_${lang}`, 'audio', () => {
            const btn = document.getElementById('generateTranslatedVideoBtn');
            if(btn) btn.disabled = false;
        });
    });

    // Generate Button Logic
    window.startVideoTranslation = async function(isRetry = false) {
        // Detectar modo manual
        const manualTab = document.getElementById('tabContentManual');
        const isManualMode = manualTab && manualTab.style.display !== 'none';

        let file, musicFile;

        if (isManualMode) {
            const vIn = document.getElementById('videoUploadManual');
            const mIn = document.getElementById('musicUploadManual');
            file = vIn ? vIn.files[0] : null;
            musicFile = mIn && mIn.files.length ? mIn.files[0] : null;
        } else {
            file = fileInput.files[0];
            musicFile = musicInput && musicInput.files.length ? musicInput.files[0] : null;
        }

        if (!file && !(isRetry && !isManualMode)) {
            // En modo manual no hay retry (por ahora), asÃ­ que siempre requerimos archivo
            // En modo auto, si isRetry es true, puede que no necesitemos archivo (usa el anterior)
            if (!isRetry) {
                alert("Por favor selecciona un archivo de video.");
                return;
            }
        }
        
        generateBtn.disabled = true;
        const progressContainer = document.getElementById('translateVideoProgress');
        const statusText = document.getElementById('translateVideoStatus');
        const progressBar = document.getElementById('translateVideoProgressBar');
        const percentText = document.getElementById('translateVideoPercent');
        const timeRemainingText = document.getElementById('translateVideoTimeRemaining');
        
        progressContainer.style.display = 'block';
        statusText.textContent = isRetry ? 'Reanudando proceso...' : 'Iniciando subida...';
        statusText.innerHTML = isRetry ? 'Reanudando proceso...' : 'Iniciando subida...'; // Reset HTML
        progressBar.style.width = '0%';
        progressBar.style.backgroundColor = '#4299e1'; // Reset color
        if (percentText) percentText.textContent = '0%';
        if (timeRemainingText) timeRemainingText.textContent = 'Calculando tiempo...';

        const formData = new FormData();
        
        // Checkbox Short (Global)
        const isShortVideo = document.getElementById('isShortVideo')?.checked || false;
        formData.append('isShortVideo', isShortVideo);

        let endpoint = '/api/translate-video';

        if (isManualMode) {
            endpoint = '/api/manual-translate-video';
            if (file) formData.append('video', file);
            if (musicFile) formData.append('music', musicFile);

            // Audios manuales
            const langs = ['en', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ko', 'ja'];
            let audioCount = 0;
            langs.forEach(lang => {
                const el = document.getElementById('manual_audio_' + lang);
                if (el && el.files.length > 0) {
                    formData.append('audio_' + lang, el.files[0]);
                    audioCount++;
                }
            });
            
            if (audioCount === 0) {
                 alert("Por favor selecciona al menos un archivo de audio para un idioma.");
                 generateBtn.disabled = false;
                 progressContainer.style.display = 'none';
                 return;
            }

        } else {
            // Auto
            if (isRetry) {
                // Asumimos que el archivo sigue seleccionado
                formData.append('retryVideoName', file.name);
            } else {
                formData.append('video', file);
            }

            if (musicFile) {
                formData.append('music', musicFile);
            }
            
            const ttsProvider = document.querySelector('input[name="ttsProvider"]:checked')?.value || 'applio';
            formData.append('ttsProvider', ttsProvider);

            const selectedLanguages = Array.from(document.querySelectorAll('input[name="targetLanguages"]:checked'))
                .map(cb => cb.value);
            formData.append('targetLanguages', JSON.stringify(selectedLanguages));

            const googleVoice = document.getElementById('googleVoiceSelect')?.value || 'Kore';
            formData.append('googleVoice', googleVoice);
        }

        const startTime = Date.now();

        try {
            statusText.textContent = isRetry ? 'Verificando archivos existentes...' : 'Subiendo y procesando...';
            
            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Error en la traducciÃ³n del video');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const text = decoder.decode(value);
                const lines = text.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            
                            if (data.status) {
                                statusText.textContent = data.status;
                            }

                            if (data.error === "RATE_LIMIT_EXCEEDED" || (data.error && data.error.includes("RATE_LIMIT_EXCEEDED"))) {
                                statusText.innerHTML = `<span style="color: #f56565;"><i class="fas fa-exclamation-triangle"></i> Cuota de API agotada.</span>`;
                                if (timeRemainingText) {
                                    timeRemainingText.innerHTML = `
                                        <div style="margin-top: 10px; padding: 10px; background: rgba(245, 101, 101, 0.1); border-radius: 8px; border: 1px solid rgba(245, 101, 101, 0.3);">
                                            <p style="color: #feb2b2; margin-bottom: 8px;">Se han agotado las cuotas de la API de Google.</p>
                                            <button onclick="window.startVideoTranslation(true)" style="background: #c53030; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 0.9em;">
                                                <i class="fas fa-redo"></i> Reintentar proceso (Continuar)
                                            </button>
                                        </div>
                                    `;
                                }
                                // Stop processing UI updates but don't close modal immediately
                                generateBtn.disabled = false;
                                return; 
                            }
                            
                            if (data.progress) {
                                const progress = parseFloat(data.progress);
                                progressBar.style.width = `${progress}%`;
                                if (percentText) percentText.textContent = `${Math.round(progress)}%`;

                                // Calcular tiempo restante
                                if (progress > 0) {
                                    const elapsedTime = Date.now() - startTime;
                                    const estimatedTotalTime = (elapsedTime / progress) * 100;
                                    const remainingTime = estimatedTotalTime - elapsedTime;
                                    
                                    // Formatear a MM:SS
                                    const remainingSeconds = Math.max(0, Math.floor(remainingTime / 1000));
                                    const mins = Math.floor(remainingSeconds / 60);
                                    const secs = remainingSeconds % 60;
                                    
                                    if (timeRemainingText) {
                                        timeRemainingText.textContent = `Tiempo restante estimado: ${mins}:${secs.toString().padStart(2, '0')}`;
                                    }
                                }
                            }
                            
                            if (data.completed) {
                                statusText.textContent = 'Â¡Completado!';
                                progressBar.style.width = '100%';
                                if (percentText) percentText.textContent = '100%';
                                if (timeRemainingText) timeRemainingText.textContent = 'Completado';
                                
                                // PequeÃ±a pausa para que el usuario vea el 100%
                                setTimeout(() => {
                                    alert('Video traducido y audios generados correctamente en la carpeta "outputs".');
                                    closeTranslateVideoModal();
                                    generateBtn.disabled = false;
                                }, 500);
                            }
                            
                            if (data.error) {
                                throw new Error(data.error);
                            }
                        } catch (e) {
                            console.error('Error parsing SSE data', e);
                        }
                    }
                }
            }

        } catch (error) {
            console.error(error);
            statusText.textContent = 'Error: ' + error.message;
            progressBar.style.backgroundColor = '#e53e3e'; // Red color
            generateBtn.disabled = false;
        }
    };

    if (generateBtn) {
        generateBtn.addEventListener('click', () => window.startVideoTranslation(false));
    }
});

// ------- SISTEMA DE AJUSTES GLOBALES -------
document.addEventListener('DOMContentLoaded', () => {
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsModal = document.getElementById('closeSettingsModal');
    const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
    const globalOutputDirInput = document.getElementById('globalOutputDirInput');

    if (openSettingsBtn && settingsModal) {
        openSettingsBtn.addEventListener('click', async () => {
            settingsModal.style.display = 'block';
            try {
                const res = await fetch('/api/settings/output-dir');
                if (res.ok) {
                    const data = await res.json();
                    globalOutputDirInput.value = data.outputsDir || '';
                }
            } catch (e) {
                console.error('Error fetching settings', e);
            }
            // Cargar API keys y config del .env
            try {
                const envRes = await fetch('/api/settings/env-config');
                if (envRes.ok) {
                    const envData = await envRes.json();
                    const setVal = (id, key) => { const el = document.getElementById(id); if (el) el.value = envData[key] || ''; };
                    setVal('envGoogleApiKey', 'GOOGLE_API_KEY');
                    setVal('envGoogleApiKeyGratis', 'GOOGLE_API_KEY_GRATIS');
                    setVal('envGoogleApiKeyGratis2', 'GOOGLE_API_KEY_GRATIS2');
                    setVal('envGoogleApiKeyGratis3', 'GOOGLE_API_KEY_GRATIS3');
                    setVal('envGoogleApiKeyGratis4', 'GOOGLE_API_KEY_GRATIS4');
                    setVal('envGoogleApiKeyGratis5', 'GOOGLE_API_KEY_GRATIS5');
                    setVal('envOpenaiApiKey', 'OPENAI_API_KEY');
                    setVal('envApplioPath', 'APPLIO_PATH');
                    setVal('envApplioUrl', 'APPLIO_SERVER_URL');
                }
            } catch (e) {
                console.error('Error fetching env config', e);
            }
        });

        const closeModal = () => settingsModal.style.display = 'none';
        if (closeSettingsModal) closeSettingsModal.addEventListener('click', closeModal);
        if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', closeModal);
    }
});

async function saveGlobalSettings() {
    const globalOutputDirInput = document.getElementById('globalOutputDirInput');
    const settingsModal = document.getElementById('settingsModal');
    const newDir = globalOutputDirInput.value.trim();
    
    if (!newDir) return alert('La ruta de outputs no puede estar vacÃ­a');
    
    try {
        // Guardar ruta de outputs
        const res = await fetch('/api/settings/output-dir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outputsDir: newDir })
        });
        
        if (!res.ok) {
            const err = await res.json();
            alert('Error al guardar ruta: ' + err.error);
            return;
        }

        // Guardar API keys y config del .env
        const getVal = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
        const envConfig = {
            GOOGLE_API_KEY: getVal('envGoogleApiKey'),
            GOOGLE_API_KEY_GRATIS: getVal('envGoogleApiKeyGratis'),
            GOOGLE_API_KEY_GRATIS2: getVal('envGoogleApiKeyGratis2'),
            GOOGLE_API_KEY_GRATIS3: getVal('envGoogleApiKeyGratis3'),
            GOOGLE_API_KEY_GRATIS4: getVal('envGoogleApiKeyGratis4'),
            GOOGLE_API_KEY_GRATIS5: getVal('envGoogleApiKeyGratis5'),
            OPENAI_API_KEY: getVal('envOpenaiApiKey'),
            APPLIO_PATH: getVal('envApplioPath'),
            APPLIO_SERVER_URL: getVal('envApplioUrl'),
        };

        const envRes = await fetch('/api/settings/env-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(envConfig)
        });

        if (envRes.ok) {
            alert('Ajustes guardados correctamente.');
            settingsModal.style.display = 'none';
            if(typeof loadProjectsList === 'function') loadProjectsList();
        } else {
            const err = await envRes.json();
            alert('Error al guardar configuraciÃ³n: ' + err.error);
        }
    } catch (e) {
        console.error('Error saving settings', e);
        alert('Hubo un error al guardar los ajustes.');
    }
}
// Event listener para el botÃ³n de descargar el proyecto en ZIP
const downloadProjectZipBtn = document.getElementById('downloadProjectZipBtn'); 
if (downloadProjectZipBtn) {
  downloadProjectZipBtn.addEventListener('click', async () => {
    if (!window.currentProject || !window.currentProject.folderName) {
      showNotification('No hay un proyecto cargado.', 'error');
      return;
    }

    const folderName = window.currentProject.folderName;
    const downloadUrl = `/api/projects/${folderName}/download`;
    const originalHtml = downloadProjectZipBtn.innerHTML;

    downloadProjectZipBtn.disabled = true;
    downloadProjectZipBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Preparando ZIP...</span>';

    try {
      showNotification('Preparando descarga del proyecto en ZIP...', 'info');   
      // Crear enlace temporal para forzar la descarga
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${folderName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => {
        showNotification('Descarga iniciada.', 'success');
      }, 500);
    } catch (error) {
      console.error('Error descargando ZIP:', error);
      showNotification('Error descargando el proyecto.', 'error');
    } finally {
      setTimeout(() => {
        downloadProjectZipBtn.disabled = false;
        downloadProjectZipBtn.innerHTML = originalHtml;
      }, 1500);
    }
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// B-ROLL MODULE: Buscar y descargar videos/imÃ¡genes de apoyo
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
(function initBRollModule() {
  const brollAnalyzeBtn = document.getElementById('brollAnalyzeBtn');
  const brollDownloadBtn = document.getElementById('brollDownloadBtn');
  const brollStatus = document.getElementById('brollStatus');
  const brollResults = document.getElementById('brollResults');
  const brollDownloadProgress = document.getElementById('brollDownloadProgress');
  const brollDownloadList = document.getElementById('brollDownloadList');

  if (!brollAnalyzeBtn) return;

  let brollSections = []; // Datos de la bÃºsqueda actual

  // BotÃ³n rÃ¡pido "Descargar Contenido" (fuera del details)
  let brollQuickTriggered = false;
  const brollQuickBtn = document.getElementById('brollQuickBtn');
  if (brollQuickBtn) {
    brollQuickBtn.addEventListener('click', () => {
      // Abrir el panel de B-Roll y disparar anÃ¡lisis
      const panel = document.getElementById('brollPanel');
      if (panel) {
        panel.style.display = 'block';
        panel.open = true;
      }
      brollQuickTriggered = true;
      brollAnalyzeBtn.click();
    });
  }

  function setBrollStatus(msg, isError = false) {
    brollStatus.style.display = 'block';
    brollStatus.textContent = msg;
    brollStatus.className = 'broll-status' + (isError ? ' error' : '');
  }

  function hideBrollStatus() {
    brollStatus.style.display = 'none';
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // Obtener el guion completo del proyecto actual
  function getProjectScript() {
    if (!window.currentProject) return null;
    const folder = window.currentProject;
    // Intentar obtener el texto del guion completo desde el output visible
    const outputDiv = document.getElementById('output');
    if (outputDiv) {
      const allText = outputDiv.innerText || outputDiv.textContent;
      if (allText && allText.trim().length > 50) return allText.trim();
    }
    return null;
  }

  // Analizar y buscar
  brollAnalyzeBtn.addEventListener('click', async () => {
    if (!window.currentProject) {
      setBrollStatus('No hay proyecto activo. Genera o carga un proyecto primero.', true);
      return;
    }

    const maxVideos = parseInt(document.getElementById('brollMaxVideos').value) || 0;
    const maxImages = parseInt(document.getElementById('brollMaxImages').value) || 0;
    const maxDuration = parseInt(document.getElementById('brollMaxDuration').value) || 20;
    const excludeShorts = document.getElementById('brollExcludeShorts').checked;

    if (maxVideos === 0 && maxImages === 0) {
      setBrollStatus('Debes poner al menos 1 video o 1 imagen por tÃ©rmino.', true);
      return;
    }

    brollAnalyzeBtn.disabled = true;
    brollResults.innerHTML = '';
    brollDownloadBtn.style.display = 'none';
    brollDownloadProgress.style.display = 'none';
    brollSections = [];

    setBrollStatus('Analizando guion con IA para extraer tÃ©rminos de B-Roll...');

    try {
      // Paso 1: Analizar tema del proyecto con IA
      const projectFolder = window.currentProject.folderName || window.currentProject.projectKey || window.currentProject;
      const topicText = document.getElementById('prompt')?.value?.trim();
      if (!topicText) {
        setBrollStatus('Escribe un tema en el campo "Tema del GuiÃ³n" antes de buscar B-Roll.', true);
        brollAnalyzeBtn.disabled = false;
        return;
      }
      const numSections = parseInt(document.getElementById('sectionsNumber')?.value) || 8;
      const analyzeRes = await fetch('/api/broll/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName: projectFolder, topic: topicText, numSections })
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok) throw new Error(analyzeData.error);

      const terms = analyzeData.terms;
      setBrollStatus(`${terms.length} secciones encontradas. Buscando en YouTube...`);

      // Paso 2: Buscar
      const searchRes = await fetch('/api/broll/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms, maxResults: maxVideos, maxDuration, excludeShorts, maxImages })
      });
      const searchData = await searchRes.json();
      if (!searchRes.ok) throw new Error(searchData.error);

      hideBrollStatus();
      renderBrollResults(searchData.results, maxImages);

      if (brollSections.some(s => s.urls.length > 0) || maxImages > 0) {
        brollDownloadBtn.style.display = 'inline-flex';
      }

      // Auto-descarga siempre activa
      if (brollSections.some(s => s.urls.length > 0) || maxImages > 0) {
        brollQuickTriggered = false;
        startBrollDownload();
      }
    } catch (err) {
      setBrollStatus(err.message, true);
    } finally {
      brollAnalyzeBtn.disabled = false;
    }
  });

  function renderBrollResults(results, maxImages) {
    brollResults.innerHTML = '';
    brollSections = [];

    for (const section of results) {
      const card = document.createElement('div');
      card.className = 'broll-section-card';

      let sectionUrls = [];
      const imageTerms = section.imageTerms || [];

      let html = `<div class="broll-section-title">${escHtml(section.section)}</div>`;

      for (const group of section.videos) {
        html += `<div class="broll-term-group">`;
        html += `<div class="broll-term-label">ðŸ” ${escHtml(group.term)}</div>`;

        if (group.error) {
          html += `<div class="broll-video-item"><span style="color:#fca5a5;font-size:0.8rem">${escHtml(group.error)}</span></div>`;
        } else if (group.results) {
          for (const video of group.results) {
            sectionUrls.push(video.url);
            html += `<div class="broll-video-item">
              <a href="${video.url}" target="_blank" title="${escHtml(video.title)}">${escHtml(video.title)}</a>
              <span class="broll-video-duration">${video.duration}</span>
              <span class="broll-video-channel">${escHtml(video.channel)}</span>
            </div>`;
          }
        }
        html += `</div>`;
      }

      if (maxImages > 0 && imageTerms.length > 0) {
        html += `<div class="broll-image-info">ðŸ–¼ï¸ ${maxImages} imgs Ã— ${imageTerms.length} tÃ©rminos = ${maxImages * imageTerms.length} imÃ¡genes al descargar</div>`;
      }

      card.innerHTML = html;
      brollResults.appendChild(card);
      brollSections.push({ section: section.section, urls: sectionUrls, imageTerms });
    }
  }

  // Descargar
  brollDownloadBtn.addEventListener('click', () => startBrollDownload());

  async function startBrollDownload() {
    if (brollSections.length === 0 || !window.currentProject) return;

    const projectFolder = window.currentProject.folderName || window.currentProject.projectKey || window.currentProject;
    const maxImages = parseInt(document.getElementById('brollMaxImages').value) || 0;
    const resolution = document.getElementById('brollResolution').value;

    brollDownloadBtn.disabled = true;
    brollDownloadProgress.style.display = 'block';
    brollDownloadList.innerHTML = '';

    // Crear placeholders
    let idx = 0;
    for (const sec of brollSections) {
      for (const url of sec.urls) {
        const row = document.createElement('div');
        row.className = 'broll-dl-item pending';
        row.id = `broll-dl-${idx}`;
        row.innerHTML = `
          <div class="broll-dl-info">
            <span class="broll-dl-title">[${escHtml(sec.section)}] Preparando...</span>
          </div>
          <div class="broll-dl-bar-container"><div class="broll-dl-bar-fill"></div></div>
          <div class="broll-dl-meta"><span class="broll-dl-percent">0%</span><span class="broll-dl-speed"></span></div>
        `;
        brollDownloadList.appendChild(row);
        idx++;
      }
    }

    // Placeholders para imÃ¡genes
    if (maxImages > 0) {
      let imgIdx = 0;
      for (const sec of brollSections) {
        if (sec.imageTerms && sec.imageTerms.length > 0) {
          for (const term of sec.imageTerms) {
            const row = document.createElement('div');
            row.className = 'broll-dl-item pending';
            row.id = `broll-img-${imgIdx}`;
            row.innerHTML = `
              <div class="broll-dl-info">
                <span class="broll-dl-title">ðŸ–¼ï¸ [${escHtml(sec.section)}] "${escHtml(term)}"</span>
              </div>
              <div class="broll-dl-bar-container"><div class="broll-dl-bar-fill"></div></div>
              <div class="broll-dl-meta"><span class="broll-dl-percent">Pendiente</span></div>
            `;
            brollDownloadList.appendChild(row);
            imgIdx++;
          }
        }
      }
    }

    try {
      const res = await fetch('/api/broll/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sections: brollSections,
          folderName: projectFolder,
          maxImages,
          resolution
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Poll progress
      const jobId = data.jobId;
      const poll = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/broll/download/status/${jobId}`);
          const status = await statusRes.json();

          // Update video items
          status.videos.forEach((v, i) => {
            const row = document.getElementById(`broll-dl-${i}`);
            if (!row) return;
            const title = row.querySelector('.broll-dl-title');
            const barFill = row.querySelector('.broll-dl-bar-fill');
            const percent = row.querySelector('.broll-dl-percent');
            const speed = row.querySelector('.broll-dl-speed');

            const displayTitle = v.title || v.url.replace('https://www.youtube.com/watch?v=', '');
            title.textContent = `[${v.section || ''}] ${displayTitle}`;

            if (v.status === 'downloading') {
              row.className = 'broll-dl-item downloading';
              barFill.style.width = v.percent + '%';
              percent.textContent = Math.round(v.percent) + '%';
              if (speed) speed.textContent = v.speed || '';
            } else if (v.status === 'merging') {
              row.className = 'broll-dl-item merging';
              barFill.style.width = '100%';
              percent.textContent = 'Fusionando...';
            } else if (v.status === 'done') {
              row.className = 'broll-dl-item done';
              barFill.style.width = '100%';
              percent.textContent = 'âœ“';
            } else if (v.status === 'error') {
              row.className = 'broll-dl-item error';
              percent.textContent = v.error || 'Error';
            }
          });

          // Update image tasks
          if (status.imageTasks) {
            status.imageTasks.forEach((img, i) => {
              const row = document.getElementById(`broll-img-${i}`);
              if (!row) return;
              const percent = row.querySelector('.broll-dl-percent');
              const barFill = row.querySelector('.broll-dl-bar-fill');

              if (img.status === 'downloading') {
                row.className = 'broll-dl-item downloading';
                barFill.style.width = '50%';
                percent.textContent = 'Descargando...';
              } else if (img.status === 'done') {
                row.className = 'broll-dl-item done';
                barFill.style.width = '100%';
                percent.textContent = `âœ“ ${img.downloaded} imgs`;
              } else if (img.status === 'error') {
                row.className = 'broll-dl-item error';
                percent.textContent = img.error || 'Error';
              }
            });
          }

          if (status.done) {
            clearInterval(poll);
            brollDownloadBtn.disabled = false;
            setBrollStatus(`âœ“ B-Roll descargado â†’ ${data.folder}`);
          }
        } catch (e) {
          clearInterval(poll);
          brollDownloadBtn.disabled = false;
        }
      }, 800);
    } catch (err) {
      setBrollStatus(`Error: ${err.message}`, true);
      brollDownloadBtn.disabled = false;
    }
  }
})();