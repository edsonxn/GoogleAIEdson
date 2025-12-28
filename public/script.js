// FunciÃ³n simple para verificar que el script se carga
console.log('ðŸš€ Script.js cargado correctamente - VERSIÃ“N CON FIX DE KEYWORDS v2');

// Variable global para almacenar la estructura de capÃ­tulos
let globalChapterStructure = [];

// Variable global para almacenar las keywords de cada imagen para el botÃ³n de refresh
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
// VARIABLES GLOBALES PARA GENERACIÃ“N DE VIDEO
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
// VARIABLES GLOBALES PARA GENERACIÃ“N DE IMÃGENES
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
// GESTOR DE PROYECTOS MÃšLTIPLES
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
    <div class="field-group">
      <label for="${folderId}" class="field-label">
        <i class="fas fa-folder"></i>
        Carpeta:
      </label>
      <input type="text" id="${folderId}" class="field-input project-folder-input" data-project-role="folder" placeholder="Ej: proyecto_secundario" />
    </div>
    <div class="field-group topic-group">
      <label for="${topicId}" class="field-label">
        <i class="fas fa-edit"></i>
        Tema del GuiÃ³n:
      </label>
      <textarea id="${topicId}" class="topic-textarea project-topic-input" data-project-role="topic" rows="3" placeholder="Describe el guiÃ³n para este proyecto"></textarea>
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
    console.warn('âš ï¸ No se encontrÃ³ el contenedor para proyectos adicionales');
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
    console.warn('âš ï¸ createSafeFolderName recibiÃ³ valor invÃ¡lido:', topic);
    return 'proyecto_sin_nombre';
  }
  
  const safeName = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, '') // Remover caracteres especiales, mantener guiones bajos
    .replace(/\s+/g, '_') // Reemplazar espacios con guiones bajos
    .substring(0, 50); // Limitar longitud
    
  console.log(`ðŸ“ createSafeFolderName: "${topic}" â†’ "${safeName}"`);
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
      console.log('ðŸš€ Lanzando generaciÃ³n paralela para proyectos adicionales:', {
        proyectos: projects,
        configuracion: sharedConfig
      });

      showNotification(`ðŸš€ Iniciando ${projects.length} proyecto(s) adicional(es) en paralelo...`, 'info');

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
            console.log(`ðŸ”‘ Actualizada clave de proyecto ${index + 1}: ${projects[index].folderName} â†’ ${backendProject.projectKey}`);
          }
        });
      }

      const folderSummary = projects.map(project => {
        const topicSnippet = project.topic.length > 60 ? `${project.topic.slice(0, 57)}...` : project.topic;
        return `${topicSnippet} â†’ ${project.folderName}`;
      }).join('; ');
      showNotification(`âœ… Proyectos adicionales en proceso: ${folderSummary}`, 'success');
    } catch (error) {
      console.error('âŒ Error lanzando generaciÃ³n paralela:', error);
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
    errorMessage.textContent = 'No se pudieron cargar las APIs de Google. Intenta recargar la pÃ¡gina.';
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
      console.error('âŒ Error cargando APIs de Google:', error);
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
    generateBtn.title = 'Configura al menos una API de Google disponible para generar imÃ¡genes.';
  } else {
    if (generateBtn.dataset.disabledNoApis === 'true') {
      generateBtn.disabled = false;
    }
    generateBtn.dataset.disabledNoApis = 'false';
    if (!hasSelectableApis && comfyOnlyMode) {
      generateBtn.title = 'Modo Comfy directo activo: se omiten las APIs de Google.';
    } else if (generateBtn.title === 'Configura al menos una API de Google disponible para generar imÃ¡genes.' || generateBtn.title === 'Modo Comfy directo activo: se omiten las APIs de Google.') {
      generateBtn.title = '';
    }
  }
}

// ================================
// FUNCIÃ“N PARA MANEJAR SELECTOR NUMÃ‰RICO DE SECCIONES
// ================================
function changeSectionCount(change) {
  const input = document.getElementById('sectionsNumber');
  if (!input) {
    console.error('âŒ No se encontrÃ³ el campo sectionsNumber');
    return;
  }
  
  // Si el campo estÃ¡ vacÃ­o, usar valor por defecto
  const currentValue = parseInt(input.value) || 3;
  const newValue = currentValue + change;
  
  // Verificar lÃ­mites
  if (newValue < 1 || newValue > 150) {
    console.log(`âš ï¸ Valor fuera de rango: ${newValue}. Rango permitido: 1-150`);
    return;
  }
  
  // Actualizar valor
  input.value = newValue;
  console.log(`ðŸ“Š Secciones actualizadas via botones: ${newValue}`);
  
  // Actualizar estado de botones
  updateSectionButtons();
}

function updateSectionButtons() {
  const input = document.getElementById('sectionsNumber');
  const decreaseBtn = document.querySelector('.decrease-btn');
  const increaseBtn = document.querySelector('.increase-btn');
  
  if (!input || !decreaseBtn || !increaseBtn) {
    console.error('âŒ No se encontraron elementos del selector numÃ©rico');
    return;
  }
  
  const inputValue = input.value.trim();
  const currentValue = parseInt(inputValue) || 3; // Default a 3 si no es vÃ¡lido
  
  // Si el campo estÃ¡ vacÃ­o, permitir ambos botones pero con restricciones lÃ³gicas
  const isEmpty = inputValue === '';
  
  // Deshabilitar botones segÃºn lÃ­mites
  decreaseBtn.disabled = !isEmpty && currentValue <= 1;
  increaseBtn.disabled = !isEmpty && currentValue >= 150;
  
  // Actualizar tÃ­tulos de botones
  if (isEmpty) {
    decreaseBtn.title = 'Disminuir secciones';
    increaseBtn.title = 'Aumentar secciones';
  } else {
    decreaseBtn.title = currentValue <= 1 ? 'MÃ­nimo 1 secciÃ³n' : 'Disminuir secciones';
    increaseBtn.title = currentValue >= 150 ? 'MÃ¡ximo 150 secciones' : 'Aumentar secciones';
  }
}

// Inicializar estado de botones cuando se carga la pÃ¡gina
document.addEventListener('DOMContentLoaded', function() {
  console.log('ðŸŽ¯ Inicializando selector numÃ©rico de secciones...');
  updateSectionButtons();
  initializeGoogleApiSelector();
  
  // TambiÃ©n agregar listener para cambios manuales en el input
  const input = document.getElementById('sectionsNumber');
  if (input) {
    // Evento para validar mientras el usuario escribe
    input.addEventListener('input', function(e) {
      let value = parseInt(this.value);
      
      // Permitir campo vacÃ­o temporalmente mientras el usuario escribe
      if (this.value === '') {
        updateSectionButtons();
        return;
      }
      
      // Validar rango y corregir si es necesario
      if (isNaN(value) || value < 1) {
        console.log('âš ï¸ Valor corregido a mÃ­nimo: 1');
        this.value = 1;
        value = 1;
      } else if (value > 150) {
        console.log('âš ï¸ Valor corregido a mÃ¡ximo: 150');
        this.value = 150;
        value = 150;
      }
      
      updateSectionButtons();
      console.log(`ðŸ“Š Secciones actualizadas via input: ${value}`);
    });
    
    // Evento para manejar cuando el usuario sale del campo
    input.addEventListener('blur', function(e) {
      // Si el campo estÃ¡ vacÃ­o al salir, establecer valor por defecto
      if (this.value === '' || isNaN(parseInt(this.value))) {
        console.log('âš ï¸ Campo vacÃ­o, estableciendo valor por defecto: 3');
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
    
    console.log('âœ… Selector numÃ©rico de secciones inicializado');
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
  const slope = 1 / 700; // â‰ˆ1 minuto para 300 palabras, â‰ˆ2 para 1000, â‰ˆ5 para 3000
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
  return 10 + (capped / 10); // entre ~10s y ~16s segÃºn cantidad
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

// Inicializar cÃ¡psulas de progreso
function initializeProgressCapsules(containerId = 'progressCapsules') {
  const progressCapsules = document.getElementById(containerId);
  const sectionsNumberElement = document.getElementById('sectionsNumber');
  
  if (!progressCapsules || !sectionsNumberElement) return;
  
  // Limpiar cÃ¡psulas existentes
  progressCapsules.innerHTML = '';
  
  const totalSections = parseInt(sectionsNumberElement.value) || 3;
  
  // Crear cÃ¡psulas para cada secciÃ³n
  for (let i = 0; i < totalSections; i++) {
    const capsule = document.createElement('div');
    capsule.className = 'capsule';
    capsule.dataset.sectionIndex = i;
    progressCapsules.appendChild(capsule);
  }
}

// Actualizar cÃ¡psulas de progreso
function updateProgressCapsules(currentStep, totalSteps, containerId = 'progressCapsules') {
  const progressCapsules = document.getElementById(containerId);
  if (!progressCapsules) return;
  
  const capsules = progressCapsules.querySelectorAll('.capsule');
  
  // Marcar cÃ¡psulas completadas hasta currentStep - 1
  capsules.forEach((capsule, index) => {
    if (index < currentStep) {
      capsule.classList.add('completed');
    } else {
      capsule.classList.remove('completed');
    }
  });
}

// Inicializar cÃ¡psulas de audio
function initializeAudioCapsules(containerId, totalSections) {
  const audioCapsules = document.getElementById(containerId);
  if (!audioCapsules) return;
  
  // Limpiar cÃ¡psulas existentes
  audioCapsules.innerHTML = '';
  
  // Crear cÃ¡psulas para cada secciÃ³n (una por audio)
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
    
    // Limpiar cÃ¡psulas existentes
    imageCapsules.innerHTML = '';
    
    // Crear cÃ¡psulas para cada imagen en la secciÃ³n
    for (let i = 0; i < imagesPerSection; i++) {
      const capsule = document.createElement('div');
      capsule.className = 'capsule image-capsule';
      capsule.dataset.sectionIndex = section - 1;
      capsule.dataset.imageIndex = i;
      imageCapsules.appendChild(capsule);
    }
  }
}

// Actualizar cÃ¡psulas de audio
function updateAudioCapsules(currentStep, totalSteps, containerId) {
  const audioCapsules = document.getElementById(containerId);
  if (!audioCapsules) return;
  
  const capsules = audioCapsules.querySelectorAll('.audio-capsule');
  
  // Marcar cÃ¡psulas completadas hasta currentStep - 1
  capsules.forEach((capsule, index) => {
    capsule.classList.remove('completed', 'active');
    
    if (index < currentStep) {
      capsule.classList.add('completed');
    } else if (index === currentStep) {
      capsule.classList.add('active');
    }
  });
}

// Actualizar cÃ¡psulas de imÃ¡genes para una secciÃ³n especÃ­fica
function updateImageCapsules(projectKey, sectionIndex, completedImages, totalImages) {
  const containerId = `imageCapsules-${projectKey}-section${sectionIndex + 1}`;
  const imageCapsules = document.getElementById(containerId);
  if (!imageCapsules) return;
  
  const capsules = imageCapsules.querySelectorAll('.image-capsule');
  
  // Marcar cÃ¡psulas completadas
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

// Crear contenedor de progreso para un proyecto especÃ­fico
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
        <!-- CÃ¡psulas de audio se generarÃ¡n dinÃ¡micamente -->
      </div>
      <div class="audio-progress-info">
        <span class="audio-current-task">Esperando generaciÃ³n de guiones...</span>
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
            <span>SecciÃ³n ${section}</span>
          </div>
          <div class="progress-capsules image-capsules" id="imageCapsules-${projectKey}-section${section}" data-section="${section}">
            <!-- CÃ¡psulas de imÃ¡genes se generarÃ¡n dinÃ¡micamente -->
          </div>
        </div>
      `;
    }
    
    imagesProgressHTML = `
    <div class="images-progress-wrapper">
      <div class="images-progress-header">
        <i class="fas fa-images"></i>
        <span>Progreso de ImÃ¡genes</span>
        <span class="images-percentage">0%</span>
      </div>
      <div class="images-sections-container">
        ${imagesBarsHTML}
      </div>
      <div class="images-progress-info">
        <span class="images-current-task">Esperando generaciÃ³n de guiones...</span>
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
        <!-- CÃ¡psulas se generarÃ¡n dinÃ¡micamente -->
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
        <span>Generar imÃ¡genes por secciÃ³n</span>
      </div>
      <div id="sectionImagesButtons-${projectKey}" class="section-images-grid">
        <!-- Botones de secciÃ³n se generarÃ¡n dinÃ¡micamente -->
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

  // Inicializar cÃ¡psulas
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

// Actualizar progreso de un proyecto especÃ­fico
function updateProjectProgress(projectKey, data) {
  console.log(`ðŸ”„ [${projectKey}] Actualizando progreso:`, data);
  const container = projectProgressContainers.get(projectKey);
  if (!container) {
    console.error(`âŒ [${projectKey}] Contenedor de progreso no encontrado!`);
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

  // Actualizar porcentaje de imÃ¡genes si existe
  if (imagesProgress) {
    const imagesPercentageElement = container.querySelector('.images-percentage');
    if (imagesPercentageElement) {
      const normalizedImagesPercentage = Math.round(clampPercentage(imagesProgress.percentage) || 0);
      imagesPercentageElement.textContent = `${normalizedImagesPercentage}%`;
    }

    // Actualizar tarea de imÃ¡genes
    const imagesTaskElement = container.querySelector('.images-current-task');
    if (imagesTaskElement) {
      imagesTaskElement.textContent = imagesProgress.currentTask || 'Generando imÃ¡genes...';
    }
  }

  // Actualizar fase
  const phaseElement = container.querySelector('.project-phase');
  if (phaseElement) {
    const phaseNames = {
      script: 'Generando guiones',
      audio: 'Generando audios',
      images: 'Generando imÃ¡genes',
      completed: 'Completado'
    };
    phaseElement.textContent = phaseNames[phase] || 'Procesando...';
  }

  // Mostrar botones de secciÃ³n cuando el proyecto estÃ© completado o cuando los audios estÃ©n terminados
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
            <span>SecciÃ³n ${sectionNumber}</span>
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

  // Actualizar cÃ¡psulas si estamos en fase de script o si el proyecto estÃ¡ completo
  if (phase === 'script') {
    updateProgressCapsules(currentStep, totalSteps, `progressCapsules-${projectKey}`);
  } else if (phase === 'completed') {
    // Si el proyecto estÃ¡ completo, marcar todas las cÃ¡psulas como completadas
    updateProgressCapsules(totalSteps, totalSteps, `progressCapsules-${projectKey}`);
  }

  // Actualizar cÃ¡psulas de audio si estamos en fase de audio
  if (phase === 'audio') {
    updateAudioCapsules(currentStep, totalSteps, `audioCapsules-${projectKey}`);
  } else if (phase === 'completed') {
    // Si el proyecto estÃ¡ completo, marcar todas las cÃ¡psulas de audio como completadas
    updateAudioCapsules(totalSteps, totalSteps, `audioCapsules-${projectKey}`);
  }

  // Actualizar cÃ¡psulas de audio si tenemos progreso de audio especÃ­fico
  if (audioProgress && audioProgress.currentStep !== undefined) {
    updateAudioCapsules(audioProgress.currentStep, audioProgress.totalSteps || totalSteps, `audioCapsules-${projectKey}`);
  }

  // Actualizar cÃ¡psulas de imÃ¡genes si tenemos progreso de imÃ¡genes especÃ­fico
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
    
    // Inicializar cÃ¡psulas de progreso
    initializeProgressCapsules();
  }
  
  // Ocultar el botÃ³n de generaciÃ³n mientras se muestra el progreso
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
    // Limpiar cÃ¡psulas
    const progressCapsules = document.getElementById('progressCapsules');
    if (progressCapsules) {
      progressCapsules.innerHTML = '';
    }
  }
  
  // Limpiar contenedores de progreso de proyectos
  clearAllProjectProgressContainers();
  
  // Detener polling - solo detener el polling general, no los individuales
  // Los polling individuales se detienen cuando se completan los proyectos especÃ­ficos
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
      console.log(`ðŸ“Š [${projectKey}] Polling progreso...`);
      const response = await fetch(`/progress/${projectKey}`);
      const data = await response.json();
      
      console.log(`ðŸ“Š [${projectKey}] Respuesta del servidor:`, data);
      
      if (data.success && data.progress) {
        const progressData = data.progress;
        
        console.log(`ðŸ“Š Datos de progreso recibidos:`, {
          fase: progressData.currentPhase,
          porcentaje: progressData.percentage,
          paso: progressData.currentStep,
          total: progressData.totalSteps
        });
        
        // Calcular tarea actual basada en la fase y progreso
        let currentTask = 'Procesando...';
        const currentPhase = progressData.currentPhase || progressData.phase;
        
        if (currentPhase === 'script') {
          currentTask = `Generando guiÃ³n ${progressData.currentStep}/${progressData.totalSteps}`;
        } else if (currentPhase === 'audio') {
          currentTask = `Generando audio ${progressData.currentStep}/${progressData.totalSteps}`;
        } else if (currentPhase === 'images') {
          currentTask = `Generando imÃ¡genes ${progressData.currentStep}/${progressData.totalSteps}`;
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
        
        // Detener polling si el proyecto estÃ¡ completo
        if (currentPhase === 'completed' || progressData.percentage >= 100) {
          console.log(`âœ… [${projectKey}] Proyecto completado, deteniendo polling`);
          stopProgressPolling(projectKey);
        }
      } else {
        console.warn(`âš ï¸ [${projectKey}] No se recibieron datos de progreso vÃ¡lidos:`, data);
      }
    } catch (error) {
      console.error(`âŒ [${projectKey}] Error obteniendo progreso del servidor:`, error);
    }
  }, 2000);
  
  progressPollingIntervals.set(projectKey, interval);
  return interval;
}

// Detener polling del progreso
function stopProgressPolling(projectKey = null) {
  if (projectKey) {
    // Detener polling para un proyecto especÃ­fico
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

  // Actualizar cÃ¡psulas si estamos en fase de script (solo para compatibilidad con cÃ³digo antiguo)
  // Nota: El nuevo sistema usa updateProjectProgress con contenedores especÃ­ficos
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
      images: 'Generando imÃ¡genes',
      completed: 'GeneraciÃ³n finalizada'
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
    currentTask: 'Preparando generaciÃ³n...',
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
function completeProgressBar(message = 'GeneraciÃ³n completada') {
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
  
  // Solo detener polling si no hay mÃºltiples proyectos (para compatibilidad con sistema antiguo)
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (!hasMultipleProjects) {
    // Detener polling solo para el sistema antiguo de un solo proyecto
    stopProgressPolling();
    
    // Ocultar despuÃ©s de 3 segundos solo para proyectos Ãºnicos
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
  
  // Solo detener polling si no hay mÃºltiples proyectos (para compatibilidad con sistema antiguo)
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (!hasMultipleProjects) {
    // Detener polling solo para el sistema antiguo de un solo proyecto
    stopProgressPolling();
    
    // Ocultar despuÃ©s de 5 segundos solo para proyectos Ãºnicos
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

// FunciÃ³n para cargar las voces disponibles de Applio
async function loadApplioVoices() {
  try {
    console.log('ðŸŽ¤ Cargando voces de Applio...');
    const response = await fetch('/api/applio-voices');
    const data = await response.json();
    
    if (data.success && data.voices) {
      availableApplioVoices = data.voices;
      console.log(`âœ… Cargadas ${data.voices.length} voces de Applio`);
      
      // Actualizar el dropdown
      updateApplioVoicesDropdown();
      
      return true;
    } else {
      console.error('âŒ Error en respuesta de voces:', data);
      return false;
    }
  } catch (error) {
    console.error('âŒ Error cargando voces de Applio:', error);
    return false;
  }
}

// FunciÃ³n para actualizar el dropdown de voces
function updateApplioVoicesDropdown() {
  const select = document.getElementById('applioVoiceSelect');
  if (!select) {
    console.error('âŒ No se encontrÃ³ el dropdown de voces de Applio');
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
    console.log(`ðŸ“ Dropdown actualizado con ${availableApplioVoices.length} voces`);
  } else {
    // OpciÃ³n por defecto si no hay voces
    const option = document.createElement('option');
    option.value = 'logs\\VOCES\\RemyOriginal.pth';
    option.textContent = 'RemyOriginal (Default)';
    select.appendChild(option);
    console.log('ðŸ“ Dropdown con voz por defecto');
  }
}

// FunciÃ³n para mostrar/ocultar el dropdown de voces segÃºn la casilla de Applio
function toggleApplioVoiceDropdown() {
  const checkbox = document.getElementById('autoGenerateApplioAudio');
  const voiceGroup = document.getElementById('applioVoiceGroup');
  
  if (!checkbox || !voiceGroup) {
    console.error('âŒ No se encontraron elementos de Applio');
    return;
  }
  
  if (checkbox.checked) {
    console.log('ðŸŽ¤ Activando selector de voces de Applio...');
    voiceGroup.style.display = 'flex';
    
    // Cargar voces si no se han cargado aÃºn
    if (availableApplioVoices.length === 0) {
      loadApplioVoices();
    }
  } else {
    console.log('ðŸ”‡ Ocultando selector de voces de Applio...');
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
    voiceSelect.title = 'La voz se elegirÃ¡ automÃ¡ticamente para cada proyecto.';
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

// FunciÃ³n para mostrar/ocultar las configuraciones de voz Google segÃºn la casilla correspondiente
function toggleGoogleVoiceDropdown() {
  const checkbox = document.getElementById('autoGenerateAudio');
  const voiceGroup = document.getElementById('googleVoiceGroup');
  
  if (!checkbox || !voiceGroup) {
    console.error('âŒ No se encontraron elementos de Google Voice');
    return;
  }
  
  if (checkbox.checked) {
    console.log('ðŸŽµ Activando configuraciones de voz Google...');
    voiceGroup.style.display = 'block';
  } else {
    console.log('ðŸ”‡ Ocultando configuraciones de voz Google...');
    voiceGroup.style.display = 'none';
  }

  updateRandomVoiceSelectionUI();
}

// Inicializar eventos para Applio cuando se carga la pÃ¡gina
document.addEventListener('DOMContentLoaded', function() {
  console.log('ðŸŽ¤ Inicializando controles de Applio...');
  
  const applioCheckbox = document.getElementById('autoGenerateApplioAudio');
  if (applioCheckbox) {
    // Agregar evento para mostrar/ocultar dropdown
    applioCheckbox.addEventListener('change', toggleApplioVoiceDropdown);
    
    // Verificar estado inicial
    toggleApplioVoiceDropdown();
    
    console.log('âœ… Controles de Applio inicializados');
  } else {
    console.error('âŒ No se encontrÃ³ la casilla de Applio');
  }

  // Inicializar control de velocidad
  const speedSlider = document.getElementById('applioSpeed');
  const speedValue = document.getElementById('speedValue');

  if (speedSlider && speedValue) {
    speedValue.textContent = speedSlider.value;
    speedSlider.addEventListener('input', function() {
      speedValue.textContent = this.value;
      console.log(`ðŸš€ Velocidad ajustada a: ${this.value}`);
    });

    console.log('âœ… Control de velocidad inicializado');
  } else {
    console.error('âŒ No se encontraron elementos del control de velocidad');
  }

  // Inicializar control de pitch
  const pitchSlider = document.getElementById('applioPitch');
  const pitchValue = document.getElementById('pitchValue');
  
  if (pitchSlider && pitchValue) {
    pitchValue.textContent = pitchSlider.value;
    pitchSlider.addEventListener('input', function() {
      pitchValue.textContent = this.value;
      console.log(`ðŸŽµ Pitch ajustado a: ${this.value}`);
    });
    
    console.log('âœ… Control de pitch inicializado');
  } else {
    console.error('âŒ No se encontraron elementos del pitch slider');
  }

  // Inicializar controles de Google Voice
  console.log('ðŸŽµ Inicializando controles de Google Voice...');
  
  const googleCheckbox = document.getElementById('autoGenerateAudio');
  if (googleCheckbox) {
    // Agregar evento para mostrar/ocultar configuraciones de voz Google
    googleCheckbox.addEventListener('change', toggleGoogleVoiceDropdown);
    
    // Verificar estado inicial
    toggleGoogleVoiceDropdown();
    
    console.log('âœ… Controles de Google Voice inicializados');
  } else {
    console.error('âŒ No se encontrÃ³ la casilla de Google Audio');
  }

  const randomCheckbox = document.getElementById('randomGoogleVoice');
  if (randomCheckbox) {
    randomCheckbox.addEventListener('change', updateRandomVoiceSelectionUI);
    updateRandomVoiceSelectionUI();
  }
});

// ================================
// VARIABLES GLOBALES PARA PROYECTOS - INICIALIZACIÃ“N INMEDIATA
// ================================
if (typeof window.currentProject === 'undefined') {
  window.currentProject = null;
}
if (typeof window.availableProjects === 'undefined') {
  window.availableProjects = [];
}

// ================================
// VARIABLES GLOBALES PARA PROYECTOS - INICIALIZACIÃ“N ÃšNICA
// ================================
if (typeof window.currentProject === 'undefined') {
  window.currentProject = null;
}
if (typeof window.availableProjects === 'undefined') {
  window.availableProjects = [];
}

console.log('âœ… Variables globales de proyectos inicializadas:', {
  currentProject: window.currentProject,
  availableProjects: window.availableProjects
});

// DEBUG: Verificar elementos de miniatura al cargar
setTimeout(() => {
  console.log('ðŸ” DEBUG: Verificando elementos de miniatura...');
  const createBtn = document.getElementById('createThumbnailStyleFromSidebar');
  const manageBtn = document.getElementById('manageThumbnailStylesFromSidebar');
  
  console.log('createThumbnailStyleFromSidebar:', createBtn);
  console.log('manageThumbnailStylesFromSidebar:', manageBtn);
  
  if (createBtn) {
    console.log('âœ… BotÃ³n crear miniatura encontrado, agregando click manual...');
    createBtn.onclick = function() {
      console.log('ðŸ–¼ï¸ Click en crear miniatura detectado');
      openThumbnailStyleModal();
    };
  }
  
  if (manageBtn) {
    console.log('âœ… BotÃ³n gestionar miniatura encontrado, agregando click manual...');
    manageBtn.onclick = function() {
      console.log('ðŸ”§ Click en gestionar miniatura detectado');
      openManageThumbnailStylesModal();
    };
  }
}, 2000);

// Variables globales para el extractor de texto
let selectedFile = null;
let extractedText = '';

// Inicializar funcionalidad de extracciÃ³n de texto tan pronto como sea posible
document.addEventListener('DOMContentLoaded', function() {
  console.log('ðŸŒ DOM cargado - iniciando extractor de texto...');
  initializeTextExtractor();
});

// TambiÃ©n intentar inicializar despuÃ©s de que todo se cargue
setTimeout(() => {
  console.log('â° Timeout - verificando si el extractor necesita inicializaciÃ³n...');
  if (!window.extractorInitialized) {
    console.log('ðŸ”„ Inicializando extractor de texto desde timeout...');
    initializeTextExtractor();
  }
}, 1000);

// Verificar que elementos existen al cargar
window.addEventListener('load', function() {
  console.log('ðŸŒ Ventana cargada completamente');
  
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
  
  console.log('ðŸ” VerificaciÃ³n de elementos:', elements);
  
  // Verificar si faltan elementos
  Object.keys(elements).forEach(key => {
    if (!elements[key]) {
      console.error(`âŒ Elemento faltante: ${key}`);
    } else {
      console.log(`âœ… Elemento encontrado: ${key}`);
    }
  });
  
  // Intentar inicializar el extractor de texto nuevamente si no se hizo antes
  if (document.getElementById('extractTextBtn') && !window.extractorInitialized) {
    console.log('ðŸ”„ Inicializando extractor de texto desde window.load...');
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
let allSections = []; // Almacenar todas las secciones generadas con datos completos (script, tÃ­tulo, tokens)
let imagePrompts = []; // Almacenar los prompts de las imÃ¡genes
let isAutoGenerating = false; // Bandera para la generaciÃ³n automÃ¡tica
let isLoadingProject = false; // Bandera para evitar validaciones durante la carga de proyectos
let isMetadataShown = false; // Bandera para evitar mostrar metadatos duplicados

// Variables globales para estilos de miniatura
let customThumbnailStyles = [];
let currentEditingThumbnailStyleId = null;

// Estilos predeterminados de miniatura
const defaultThumbnailStyles = {
  'default': {
    name: 'Amarillo y Blanco (Predeterminado)',
    description: 'Estilo clÃ¡sico con texto amarillo y blanco',
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
    name: 'Azul NeÃ³n',
    description: 'Estilo futurista con azul neÃ³n y efectos cyberpunk',
    primaryColor: 'azul neÃ³n',
    secondaryColor: 'cyan claro',
    instructions: 'El texto debe tener un estilo futurista cyberpunk con la frase principal en azul neÃ³n brillante y la secundaria en cyan claro, con contorno oscuro y efectos de resplandor azul neÃ³n'
  },
  'retro_purple': {
    name: 'PÃºrpura Retro',
    description: 'Estilo retro gaming con pÃºrpura y rosa',
    primaryColor: 'pÃºrpura brillante',
    secondaryColor: 'rosa',
    instructions: 'El texto debe tener un estilo retro gaming de los 80s con la frase principal en pÃºrpura brillante y la secundaria en rosa, con contorno negro y efectos de resplandor pÃºrpura'
  }
};

// FunciÃ³n para la generaciÃ³n automÃ¡tica completa
async function runAutoGeneration() {
  console.log("ðŸ¤– Iniciando generaciÃ³n automÃ¡tica completa");
  
  // Verificar que los elementos del DOM estÃ©n disponibles
  const requiredElements = [
    'maxWords', 'styleSelect', 'imagesSelect', 'aspectRatioSelect', 
    'promptModifier', 'llmModelSelect', 
    'googleImages', 'localAIImages'
  ];
  
  const missingElements = requiredElements.filter(id => !document.getElementById(id));
  if (missingElements.length > 0) {
    console.error("âŒ Elementos del DOM faltantes:", missingElements);
    showError(`Error: No se encontraron los siguientes elementos: ${missingElements.join(', ')}`);
    return;
  }
  
  isAutoGenerating = true;
  
  const normalizedProjects = normalizeProjectEntries(collectProjectEntries());
  if (!normalizedProjects.length) {
    showError('Agrega al menos un tema antes de iniciar la generaciÃ³n automÃ¡tica.');
    isAutoGenerating = false;
    return;
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
  
  console.log("ðŸ–¼ï¸ ConfiguraciÃ³n de imÃ¡genes:");
  console.log("  - Google Images:", googleImages);
  console.log("  - Local AI Images (ComfyUI):", localAIImages);
  console.log("  - Modelo seleccionado:", getImageModelLabel(selectedImageModel));
  
  // Calcular automÃ¡ticamente skipImages: true si NO hay opciones de imÃ¡genes activas
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
    console.warn('âš ï¸ Se solicitÃ³ voz aleatoria pero no hay opciones disponibles en el selector. Se usarÃ¡ la voz seleccionada manualmente.');
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
    console.log('ðŸŽ² Voces aleatorias asignadas por proyecto:', voiceAssignments);
  }

  const parallelProjectsWithVoices = parallelProjects.map(project => ({
    ...project,
    voice: voiceAssignmentsMap.get(project.folderName) || effectivePrimaryVoice
  }));
  
  // ðŸ”§ VALIDACIÃ“N SIMPLIFICADA: Las imÃ¡genes se pueden generar con cualquier combinaciÃ³n
  // Prioridad: Si estÃ¡ activada IA Local, usar ComfyUI; si estÃ¡ Google Images, usar APIs de Google
  console.log(`ðŸ”Š GeneraciÃ³n de audio Google: ${generateAudio ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`ðŸŽ¤ GeneraciÃ³n de audio Applio: ${generateApplioAudio ? 'ACTIVADA' : 'DESACTIVADA'}`);
  if (generateApplioAudio) {
    console.log(`ðŸŽ™ï¸ Voz Applio seleccionada: ${selectedApplioVoice}`);
    console.log(`ðŸŽšï¸ Modelo Applio: ${selectedApplioModel}`);
    console.log(`ðŸš€ Velocidad Applio: ${applioSpeed}`);
    console.log(`ðŸŽµ Pitch Applio: ${applioPitch}`);
  }
  console.log(`ðŸŽ­ Estilo de narraciÃ³n solicitado: ${narrationStyle || 'Sin estilo personalizado'}`);
  console.log(`ðŸ–¼ï¸ ImÃ¡genes de Google: ${googleImages ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`ðŸ§  ImÃ¡genes IA Local: ${localAIImages ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`ðŸš« Omitir imÃ¡genes (auto): ${skipImages ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`ðŸŽ›ï¸ Modo Comfy directo: ${comfyOnlyMode ? 'ACTIVADO' : 'DESACTIVADO'}`);
  if (parallelProjects.length) {
    console.log('ðŸ”€ Proyectos adicionales detectados para ejecuciÃ³n paralela:', parallelProjectsWithVoices);
  }
  
  let selectedGoogleApiIds = [];
  if (!skipImages && googleImages && typeof ensureGoogleApiSelectionReady === 'function') {
    try {
      const selectionReady = await ensureGoogleApiSelectionReady();
      if (selectionReady && typeof getSelectedGoogleApis === 'function') {
        selectedGoogleApiIds = getSelectedGoogleApis();
      }
    } catch (selectionError) {
      console.warn('âš ï¸ No se pudieron preparar las APIs de Google para proyectos paralelos:', selectionError);
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
  
  // Limpiar el panel de prompts al iniciar una nueva generaciÃ³n
  clearPromptsPanel();
  
  // Actualizar botones de navegaciÃ³n
  updateNavigationButtons();

  // Deshabilitar controles durante la generaciÃ³n automÃ¡tica
  disableControls(true);
  
  try {
    console.log('\n' + 'ðŸš€'.repeat(50));
    console.log('ðŸš€ USANDO NUEVO SISTEMA DE GENERACIÃ“N POR LOTES');
    console.log('ðŸš€'.repeat(50));

    const averageWordsPerSection = Math.max(150, Math.round((minWords + maxWords) / 2));
    configureProgressEstimation({
      averageWordsPerSection,
      sections: totalSections,
      audioEnabled: generateAudio || generateApplioAudio,
      imagesEnabled: !skipImages,
      estimatedImages: skipImages ? 0 : Math.max(imageCount, totalSections)
    });
    
  // ðŸ“Š INICIALIZAR BARRAS DE PROGRESO PARA TODOS LOS PROYECTOS
  clearAllProjectProgressContainers();
  
  // Determinar si incluir barra de progreso de audio
  const includeAudioProgress = generateAudio || generateApplioAudio;
  
  // Determinar si incluir barra de progreso de imÃ¡genes
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
    console.log(`ðŸ“¦ Creando contenedor para proyecto paralelo ${index + 1}/${parallelProjectsWithVoices.length}: ${projectKey} (${displayName})`);
    createProjectProgressContainer(projectKey, displayName, totalSections, includeAudioProgress, includeImagesProgress, imagesPerSection, project);
  });
  
  // Mostrar el contenedor de progreso principal (opcional, ya que ahora tenemos individuales)
  // showProgressBar();
    
    // Obtener configuraciÃ³n de ComfyUI si estÃ¡ habilitada
    let comfyUISettings = null;
    if (localAIImages) {
      comfyUISettings = getComfyUISettings();
      console.log('ðŸŽ¨ ConfiguraciÃ³n ComfyUI obtenida del frontend:', comfyUISettings);
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

      // Esperar a que se complete la inicializaciÃ³n de proyectos paralelos
      await triggerParallelProjectGeneration(parallelProjectsWithVoices, sharedParallelConfig);
    }
    
    // ===============================================================
    // FASE 1: GENERAR TODOS LOS GUIONES Y PROMPTS DE IMÃGENES
    // ===============================================================
    console.log('\nðŸ“ INICIANDO FASE 1: GeneraciÃ³n de guiones y prompts...');
    
    // ðŸ“Š INICIAR POLLING DEL PROGRESO PARA TODOS LOS PROYECTOS
    console.log('ðŸ“Š Iniciando seguimiento de progreso para todos los proyectos...');
    
    // Iniciar polling para el proyecto principal
    const primaryProjectKey = (primaryProject.folderName || '').trim() || createSafeFolderName(primaryProject.topic);
    
    // Actualizar progreso inicial del proyecto principal
    updateProjectProgress(primaryProjectKey, {
      percentage: 5,
      phase: 'script',
      currentStep: 0,
      totalSteps: totalSections,
      estimatedTimeRemaining: 'Calculando...',
      currentTask: 'Generando guiones y prompts de imÃ¡genes...'
    });
    
    startProgressPolling(primaryProjectKey, (progressData) => {
      updateProjectProgress(primaryProjectKey, progressData);
    });
    
    // Iniciar polling para proyectos paralelos con un pequeÃ±o delay para dar tiempo a que se guarden los archivos
    parallelProjectsWithVoices.forEach((project, index) => {
      const projectKey = project.projectKey || (project.folderName || '').trim() || createSafeFolderName(project.topic);
      console.log(`ðŸš€ Iniciando polling para proyecto paralelo ${index + 1}/${parallelProjectsWithVoices.length}: ${projectKey} (topic: ${project.topic})`);
      
      // Agregar delay progresivo para evitar sobrecargar el servidor
      setTimeout(() => {
        startProgressPolling(projectKey, (progressData) => {
          console.log(`ðŸ“Š Callback ejecutado para proyecto ${projectKey}:`, progressData);
          updateProjectProgress(projectKey, progressData);
        });
      }, index * 1000); // 1 segundo de delay por proyecto
    });
    
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
      throw new Error(`Fase 1 fallÃ³: ${phase1Data.error}`);
    }
    
    console.log('âœ… FASE 1 COMPLETADA:', phase1Data.message);
    const projectData = phase1Data.data;
  const resolvedImageModel = normalizeImageModel(projectData?.imageModel || selectedImageModel);
  projectData.imageModel = resolvedImageModel;
    
    // El polling ya se iniciÃ³ antes de la generaciÃ³n
    console.log('ðŸ“Š Polling ya activo para proyecto:', projectData.projectKey);
    
    // IMPORTANTE: Para el proceso automÃ¡tico, determinar quÃ© tipo de audio generar
    const shouldGenerateAudio = generateAudio || generateApplioAudio || (selectedApplioVoice && selectedApplioVoice !== '');
    // No forzar generateApplioAudio=true, respetar la selecciÃ³n del usuario
    
    // Mostrar los guiones generados en la UI
    allSections = projectData.sections.map(section => {
      const script = section.script;
      // Asegurar que cada script sea un string vÃ¡lido
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
        console.log(`ðŸŽ¨ Agregando ${sectionData.imagePrompts.length} prompts al panel lateral para secciÃ³n ${i + 1}`);
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
    // VERIFICACIÃ“N DE GUIONES ANTES DE GENERAR AUDIOS
    // =============================================================== 
    if (generateAudio || generateApplioAudio) {
      console.log('\nðŸ” VERIFICANDO INTEGRIDAD DE GUIONES PARA TODOS LOS PROYECTOS...');
      
      try {
        // Verificar guiones para el proyecto principal
        await regenerateMissingScripts();
        console.log('âœ… VerificaciÃ³n de guiones completada para proyecto principal');
        
        // Verificar guiones para proyectos adicionales si existen
        if (window.currentProject && window.currentProject.additionalProjects && window.currentProject.additionalProjects.length > 0) {
          console.log(`ðŸ” Verificando guiones para ${window.currentProject.additionalProjects.length} proyectos adicionales...`);
          
          for (const additionalProject of window.currentProject.additionalProjects) {
            try {
              console.log(`ðŸ” Verificando guiones para proyecto adicional: ${additionalProject.folderName}`);
              await regenerateMissingScriptsForProject(additionalProject.folderName);
              console.log(`âœ… Guiones verificados para proyecto: ${additionalProject.folderName}`);
            } catch (projectError) {
              console.error(`âŒ Error verificando guiones para proyecto ${additionalProject.folderName}:`, projectError);
              // Continuar con otros proyectos
            }
          }
        }
        
        console.log('âœ… VerificaciÃ³n de guiones completada para todos los proyectos');
      } catch (error) {
        console.error('âŒ Error verificando guiones:', error);
        // No detener el proceso, continuar con la generaciÃ³n de audios
        console.log('âš ï¸ Continuando con generaciÃ³n de audios a pesar del error en verificaciÃ³n de guiones');
      }
    }
    
    // =============================================================== 
    // VERIFICACIÃ“N Y ESPERA: TODOS LOS PROYECTOS DEBEN ESTAR COMPLETOS
    // =============================================================== 
    async function waitForAllProjectsComplete(projectsToProcess) {
      console.log('\nâ³ ESPERANDO A QUE TODOS LOS PROYECTOS ESTÃ‰N COMPLETOS ANTES DE GENERAR AUDIO...');
      
      return new Promise((resolve) => {
        const checkInterval = setInterval(async () => {
          console.log('\nðŸ” Verificando completitud de todos los proyectos...');
          
          const allComplete = await verifyAllProjectsComplete(projectsToProcess);
          
          if (allComplete) {
            console.log('ðŸŽ‰ TODOS LOS PROYECTOS ESTÃN COMPLETOS - INICIANDO GENERACIÃ“N DE AUDIO');
            clearInterval(checkInterval);
            resolve(true);
          } else {
            console.log('â³ Algunos proyectos aÃºn no estÃ¡n completos. Esperando 5 segundos para volver a verificar...');
            // Esperar 5 segundos antes de la prÃ³xima verificaciÃ³n
          }
        }, 5000); // Verificar cada 5 segundos
      });
    }
    
    // FunciÃ³n auxiliar para verificar si todos los proyectos estÃ¡n completos
    async function verifyAllProjectsComplete(projectsToProcess) {
      console.log('\nðŸ” Verificando completitud de proyectos...');
      
      for (let i = 0; i < projectsToProcess.length; i++) {
        const project = projectsToProcess[i];
        console.log(`ðŸ” [${i + 1}/${projectsToProcess.length}] Verificando proyecto: ${project.projectName} (${project.projectKey})`);
        
        try {
          // Obtener el estado del proyecto desde el backend
          const projectStateResponse = await fetch(`/get-project-state/${project.projectKey}`);
          if (!projectStateResponse.ok) {
            console.error(`âŒ No se pudo obtener estado del proyecto ${project.projectKey}: ${projectStateResponse.status}`);
            return false;
          }
          
          const projectState = await projectStateResponse.json();
          
          // Verificar si el proyecto tiene todas las secciones completas
          const completedSections = projectState.completedSections?.length || 0;
          const totalSections = projectState.totalSections || 0;
          
          console.log(`ðŸ“Š Proyecto ${project.projectName}: ${completedSections}/${totalSections} secciones completas`);
          
          if (completedSections < totalSections) {
            console.log(`â³ Proyecto ${project.projectName} aÃºn no estÃ¡ completo: ${completedSections}/${totalSections} secciones`);
            return false;
          }
          
          // Verificar que todas las secciones tienen guiones vÃ¡lidos
          for (let sectionNum = 1; sectionNum <= totalSections; sectionNum++) {
            try {
              const scriptResponse = await fetch(`/read-script-file/${project.projectKey}/${sectionNum}`);
              if (!scriptResponse.ok) {
                console.log(`â³ No se pudo leer guiÃ³n de secciÃ³n ${sectionNum} del proyecto ${project.projectKey}: ${scriptResponse.status}`);
                return false;
              }
              
              const scriptData = await scriptResponse.json();
              if (!scriptData.success || !scriptData.script || scriptData.script.trim().length === 0) {
                console.log(`â³ GuiÃ³n vacÃ­o o invÃ¡lido en secciÃ³n ${sectionNum} del proyecto ${project.projectName}`);
                return false;
              }
              
              console.log(`âœ… SecciÃ³n ${sectionNum} del proyecto ${project.projectName}: guiÃ³n vÃ¡lido (${scriptData.script.length} caracteres)`);
            } catch (scriptError) {
              console.log(`â³ Error verificando guiÃ³n de secciÃ³n ${sectionNum} del proyecto ${project.projectKey}:`, scriptError.message);
              return false;
            }
          }
          
          console.log(`âœ… Proyecto ${project.projectName} estÃ¡ COMPLETO`);
          
        } catch (error) {
          console.log(`â³ Error verificando proyecto ${project.projectKey}:`, error.message);
          return false;
        }
      }
      
      console.log('âœ… Todos los proyectos verificados - estÃ¡n completos');
      return true;
    }
    
    // =============================================================== 
    // FASE 2: GENERAR TODOS LOS ARCHIVOS DE AUDIO SECUENCIALMENTE
    // =============================================================== 
    // MODIFICACIÃ“N: Si ya se generaron audios en Fase 1 (inmediata), no ejecutar Fase 2 para el proyecto principal
    // Pero sÃ­ ejecutar para proyectos adicionales si los hay
    
    const hasAdditionalProjects = window.currentProject && window.currentProject.additionalProjects && window.currentProject.additionalProjects.length > 0;
    
    // Si hay proyectos adicionales, siempre ejecutar Fase 2 (pero filtrar el principal si ya tiene audio)
    // Si NO hay proyectos adicionales, y ya se generÃ³ audio en Fase 1, saltar Fase 2
    
    if (generateAudio || generateApplioAudio) {
      console.log('\nðŸŽµ INICIANDO FASE 2: GeneraciÃ³n secuencial de audio...');
      
      // Generar un ID Ãºnico para esta sesiÃ³n de generaciÃ³n de audio
      const audioRunId = `audio_batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let globalAudioOrder = 0;
      
      // Crear lista de proyectos en orden
      const projectsToProcess = [];
      
      // Solo agregar el proyecto principal si NO se generÃ³ audio en Fase 1
      // OJO: En la implementaciÃ³n actual de Fase 1, SIEMPRE se genera audio si useApplio/generateAudio es true
      // Por lo tanto, el proyecto principal YA TIENE audio.
      
      // Sin embargo, para mantener compatibilidad, verificamos si realmente se generÃ³
      // Como acabamos de modificar el backend para generar audio inmediato, asumimos que el principal ya estÃ¡ listo.
      
      console.log('â„¹ï¸ El proyecto principal ya deberÃ­a tener audios generados en Fase 1.');
      
      // Agregar proyectos adicionales
      if (hasAdditionalProjects) {
        console.log(`ðŸ“‹ PROYECTOS ADICIONALES ENCONTRADOS:`, window.currentProject.additionalProjects.length);
        window.currentProject.additionalProjects.forEach((proj, index) => {
          console.log(`ðŸ“‹ Proyecto adicional ${index + 1}: ${proj.topic} (${proj.folderName})`);
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
        console.log(`ðŸ“‹ No hay proyectos adicionales`);
      }

      // Esperar a que todos los proyectos estÃ©n completos antes de continuar
      // Esto es crucial porque la Fase 1 puede haber terminado de enviar solicitudes,
      // pero el backend aÃºn puede estar procesando guiones/audios en segundo plano.
      await waitForAllProjectsComplete(hasAdditionalProjects ? projectsToProcess : [{
        projectKey: window.currentProject.projectKey,
        projectName: window.currentProject.topic
      }]);
      
      if (projectsToProcess.length === 0) {
        console.log('âœ… No hay proyectos pendientes de audio (el principal ya se generÃ³ en Fase 1).');
        // NO HACER RETURN AQUÃ, para permitir que continÃºe a la Fase 2.5
      } else {
        console.log(`ðŸŽµ Proyectos ADICIONALES a procesar en orden:`, projectsToProcess.map(p => `${p.projectName} (${p.projectKey})`));
        
        // â³ ESPERAR HASTA QUE TODOS LOS PROYECTOS ESTÃ‰N COMPLETOS ANTES DE GENERAR AUDIO
        console.log('\nâ³ ESPERANDO A QUE TODOS LOS PROYECTOS TENGAN TODOS SUS GUIONES COMPLETOS...');
        await waitForAllProjectsComplete(projectsToProcess);
        
        console.log('âœ… TODOS LOS PROYECTOS ESTÃN LISTOS. Iniciando generaciÃ³n de audio secuencial...');
        
        // Procesar cada proyecto completamente antes de pasar al siguiente
        for (let projectIndex = 0; projectIndex < projectsToProcess.length; projectIndex++) {
          const project = projectsToProcess[projectIndex];
          console.log(`\nðŸŽµ [${projectIndex + 1}/${projectsToProcess.length}] INICIANDO PROCESAMIENTO DE PROYECTO: ${project.projectName} (${project.projectKey})`);
          console.log(`ðŸŽµ [${projectIndex + 1}/${projectsToProcess.length}] Detalles del proyecto:`, {
            projectKey: project.projectKey,
            projectName: project.projectName,
            isApplio: project.isApplio,
            voice: project.voice,
            isMainProject: project.projectKey === projectData.projectKey
          });
          
          if (projectIndex === 0) {
            console.log(`ðŸŽ¯ PRIMER PROYECTO A PROCESAR: ${project.projectName} (${project.projectKey})`);
            console.log(`ðŸŽ¯ Este deberÃ­a ser el TEMA 1`);
          }
          
          // Procesar todas las secciones de este proyecto
          for (let sectionNum = 1; sectionNum <= totalSections; sectionNum++) {
            console.log(`ðŸŽµ [${projectIndex + 1}/${projectsToProcess.length}] Generando audio: ${project.projectName} - SecciÃ³n ${sectionNum}/${totalSections}`);
            
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
            
            // Actualizar progreso solo para este proyecto
            const projectProgressPercentage = Math.round(((sectionNum - 1) / totalSections) * 100);
            
            updateProjectProgress(project.projectKey, {
              percentage: projectProgressPercentage,
              phase: 'audio',
              currentStep: sectionNum - 1,
              totalSteps: totalSections,
              currentTask: `Generando audio: SecciÃ³n ${sectionNum}`,
              audioProgress: {
                percentage: projectProgressPercentage,
                currentStep: sectionNum - 1,
                totalSteps: totalSections,
                currentTask: `Generando audio: SecciÃ³n ${sectionNum}`
              }
            });
            
            // Obtener el script para esta secciÃ³n
            let scriptContent = "";
            if (project.projectKey === projectData.projectKey) {
              // Proyecto principal
              scriptContent = allSections[sectionNum - 1]?.script || "";
              // Asegurar que scriptContent sea un string vÃ¡lido
              if (typeof scriptContent !== 'string') {
                console.warn(`âš ï¸ [${project.projectKey}] scriptContent no es string, convirtiendo. Tipo: ${typeof scriptContent}, Valor:`, scriptContent);
                scriptContent = String(scriptContent || "");
              }
              console.log(`ðŸ“„ [${project.projectKey}] PROYECTO PRINCIPAL - Usando script del array allSections[${sectionNum - 1}]: ${scriptContent.substring(0, 100)}...`);
              console.log(`ðŸ“„ [${project.projectKey}] allSections.length: ${allSections.length}, sectionNum: ${sectionNum}`);
              console.log(`ðŸ“„ [${project.projectKey}] Contenido de allSections:`, allSections.map((s, i) => `SecciÃ³n ${i+1}: ${(typeof s === 'string' ? s.substring(0, 50) : String(s).substring(0, 50))}...`));
            } else {
              // Proyecto adicional - leer desde archivo
              console.log(`ðŸ“„ [${project.projectKey}] Intentando leer script desde archivo para secciÃ³n ${sectionNum}...`);
              try {
                const scriptResponse = await fetch(`/read-script-file/${project.projectKey}/${sectionNum}`);
                console.log(`ðŸ“„ [${project.projectKey}] Respuesta del endpoint /read-script-file:`, scriptResponse.status);
                
                if (scriptResponse.ok) {
                  const scriptData = await scriptResponse.json();
                  scriptContent = scriptData.script || "";
                  // Asegurar que scriptContent sea un string vÃ¡lido
                  if (typeof scriptContent !== 'string') {
                    console.warn(`âš ï¸ [${project.projectKey}] scriptContent del endpoint no es string, convirtiendo. Tipo: ${typeof scriptContent}, Valor:`, scriptContent);
                    scriptContent = String(scriptContent || "");
                  }
                  console.log(`ðŸ“„ [${project.projectKey}] Script leÃ­do exitosamente (${scriptContent.length} caracteres): ${scriptContent.substring(0, 50)}...`);
                } else {
                  const errorData = await scriptResponse.json();
                  console.warn(`âš ï¸ [${project.projectKey}] Error leyendo script para secciÃ³n ${sectionNum}:`, errorData);
                  scriptContent = `Script para ${project.projectName} - SecciÃ³n ${sectionNum}`;
                }
              } catch (scriptError) {
                console.warn(`âš ï¸ [${project.projectKey}] Error de red leyendo script para secciÃ³n ${sectionNum}:`, scriptError);
                scriptContent = `Script para ${project.projectName} - SecciÃ³n ${sectionNum}`;
              }
            }
            
            if (scriptContent.trim() === "" || scriptContent.startsWith("Script para")) {
              console.warn(`âš ï¸ [${project.projectKey}] Script vacÃ­o o fallback para secciÃ³n ${sectionNum}, usando contenido bÃ¡sico`);
              scriptContent = `Contenido detallado de la secciÃ³n ${sectionNum} del tema ${project.projectName}. Esta secciÃ³n contiene informaciÃ³n importante sobre el tema principal.`;
            }
            
            console.log(`ðŸ“ [${project.projectKey}] Script final para secciÃ³n ${sectionNum} (${scriptContent.length} caracteres): ${scriptContent.substring(0, 150)}...`);
            
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
            
            console.log(`ðŸŽµ [${project.projectKey}] Enviando solicitud a ${endpoint} para secciÃ³n ${sectionNum}...`);
            console.log(`ðŸŽµ [${project.projectKey}] Request body:`, {
              scriptLength: scriptContent.length,
              topic: project.projectName,
              folderName: project.projectKey,
              currentSection: sectionNum,
              endpoint: endpoint,
              runId: audioRunId,
              order: globalAudioOrder - 1, // Mostrar el order actual (ya incrementado)
              projectIndex: projectIndex,
              totalProjects: projectsToProcess.length,
              isFirstProject: projectIndex === 0,
              isMainProject: project.projectKey === projectData.projectKey
            });
            
            // Enviar solicitud y esperar respuesta completa
            console.log(`â³ [${project.projectKey}] Esperando respuesta del servidor para secciÃ³n ${sectionNum}...`);
            const audioResponse = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody)
            });
            
            if (!audioResponse.ok) {
              const errorText = await audioResponse.text();
              console.error(`âŒ [${project.projectKey}] Error HTTP ${audioResponse.status} para secciÃ³n ${sectionNum}:`, errorText);
              throw new Error(`Error HTTP ${audioResponse.status}: ${errorText}`);
            }
            
            const audioData = await audioResponse.json();
            console.log(`âœ… [${project.projectKey}] Respuesta recibida para secciÃ³n ${sectionNum}:`, {
              success: audioData.success,
              hasAudio: !!audioData.audio,
              voice: audioData.voice
            });
            
            if (!audioData.success) {
              console.error(`âŒ [${project.projectKey}] Error generando audio para ${project.projectName} - SecciÃ³n ${sectionNum}: ${audioData.error}`);
            } else {
              console.log(`âœ… [${project.projectKey}] Audio generado exitosamente: ${project.projectName} - SecciÃ³n ${sectionNum}`);
            }
            
            // Actualizar progreso final para esta secciÃ³n
            const finalProgressPercentage = Math.round((sectionNum / totalSections) * 100);
            updateProjectProgress(project.projectKey, {
              percentage: finalProgressPercentage,
              phase: sectionNum === totalSections ? 'completed' : 'audio',
              currentStep: sectionNum,
              totalSteps: totalSections,
              currentTask: sectionNum === totalSections ? 'Completado' : `Generando audio: SecciÃ³n ${sectionNum + 1}`,
              audioProgress: {
                percentage: finalProgressPercentage,
                currentStep: sectionNum,
                totalSteps: totalSections,
                currentTask: sectionNum === totalSections ? 'Completado' : `Generando audio: SecciÃ³n ${sectionNum + 1}`
              }
            });
            
            // PequeÃ±a pausa entre generaciones para no sobrecargar el servidor
            console.log(`â³ [${project.projectKey}] Esperando 2 segundos antes de la siguiente secciÃ³n...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            
          } catch (error) {
            console.error(`âŒ [${project.projectKey}] Error procesando audio ${project.projectName} - SecciÃ³n ${sectionNum}:`, error);
          }
        }
        
        console.log(`âœ… [${projectIndex + 1}/${projectsToProcess.length}] PROYECTO COMPLETADO: ${project.projectName} (${project.projectKey})`);
        
        // Pausa entre proyectos para asegurar secuencialidad
        if (projectIndex < projectsToProcess.length - 1) {
          console.log(`â³ Esperando 2 segundos antes de pasar al siguiente proyecto...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      console.log('âœ… FASE 2 COMPLETADA: Todos los audios generados secuencialmente');
    }
    } else {
      console.log('â­ï¸ FASE 2 OMITIDA: No se solicitÃ³ generaciÃ³n de audio');
    }

    // ===============================================================
    // FASE 2.5: GENERACIÃ“N DE TRADUCCIONES (SI SE SOLICITÃ“)
    // ===============================================================
    const includeTranslations = document.getElementById('includeTranslations')?.checked || false;
    const silencePadding = document.getElementById('audioSilencePadding')?.value || 20;

    if (includeTranslations) {
      console.log('\nðŸŒ INICIANDO FASE 2.5: GeneraciÃ³n de traducciones...');
      
      // Lista de todos los proyectos a procesar (principal + adicionales)
      const allProjectsToTranslate = [window.currentProject];
      if (window.currentProject.additionalProjects) {
        allProjectsToTranslate.push(...window.currentProject.additionalProjects);
      }

      for (const project of allProjectsToTranslate) {
        console.log(`ðŸŒ Procesando traducciones para: ${project.folderName}`);
        
        try {
          // 1. Generar textos traducidos
          console.log(`ðŸ“ Generando guiones traducidos para ${project.folderName}...`);
          await fetch('/translate-project-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              folderName: project.folderName,
              totalSections: project.totalSections
            })
          });

          // 2. Generar audios traducidos y unirlos
          console.log(`ðŸŽ¤ Generando audios traducidos para ${project.folderName}...`);
          
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
                                    console.log(`ðŸŒ [${project.folderName}] Progreso: ${data.message || (data.current ? data.current + '/' + data.totalTasks : '')}`);
                                }
                                if (data.complete) {
                                    resolve();
                                }
                                if (data.error) {
                                    console.error(`âŒ Error en traducciÃ³n: ${data.error}`);
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
          
          console.log(`âœ… Traducciones completadas para: ${project.folderName}`);

        } catch (error) {
          console.error(`âŒ Error procesando traducciones para ${project.folderName}:`, error);
        }
      }
    }

    // ===============================================================
    // FASE 3: GENERAR TODAS LAS IMÃGENES (usando la misma funciÃ³n que el botÃ³n)
    // ===============================================================
    if (!skipImages) {
      console.log('\nðŸŽ¨ INICIANDO FASE 3: GeneraciÃ³n de imÃ¡genes usando generateMissingImages()...');
      
      try {
        // Ejecutar la misma funciÃ³n que el botÃ³n "generateMissingImagesBtn"
        await generateMissingImages();
        console.log('âœ… FASE 3 COMPLETADA: ImÃ¡genes generadas correctamente');
      } catch (error) {
        console.error('âŒ Error en FASE 3:', error);
        throw new Error(`Fase 3 fallÃ³: ${error.message}`);
      }
    } else {
      console.log('â­ï¸ FASE 3 OMITIDA: Se solicitÃ³ omitir imÃ¡genes');
    }
    
    // =============================================================== 
    // VERIFICACIÃ“N FINAL: ASEGURAR QUE TODOS LOS AUDIOS ESTÃ‰N COMPLETOS
    // =============================================================== 
    if (generateAudio || generateApplioAudio) {
      console.log('\nðŸ” REALIZANDO VERIFICACIÃ“N FINAL DE AUDIOS...');
      
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
    
    console.log('\n' + 'ðŸŽ‰'.repeat(50));
    console.log('ðŸŽ‰ GENERACIÃ“N AUTOMÃTICA POR LOTES COMPLETADA');
    console.log('ðŸŽ‰'.repeat(50));
    
    // ðŸ“Š COMPLETAR BARRA DE PROGRESO (solo para proyectos Ãºnicos)
    const hasMultipleProjects = projectProgressContainers.size > 1;
    if (!hasMultipleProjects) {
      completeProgressBar('Â¡GeneraciÃ³n automÃ¡tica completada exitosamente!');
    }
    
    showAutoGenerationComplete();
    
  } catch (error) {
    console.error("âŒ Error durante generaciÃ³n automÃ¡tica:", error);
    const hasMultipleProjects = projectProgressContainers.size > 1;
    if (!hasMultipleProjects) {
      showProgressError(error.message);
    }
    showError(`Error durante la generaciÃ³n automÃ¡tica: ${error.message}`);
  } finally {
    isAutoGenerating = false;
    disableControls(false);
    restoreGenerateButton();
  }
}

// FunciÃ³n para restaurar el botÃ³n de generar a su estado original
function restoreGenerateButton() {
  // Remover cualquier clase de loading
  generateBtn.classList.remove('loading');
  
  // Restaurar contenido original
  generateBtn.innerHTML = `
    <i class="fas fa-video"></i>
    <span>Generar SecciÃ³n 1</span>
  `;
  
  // Asegurar que estÃ© habilitado
  generateBtn.disabled = false;
  
  // Limpiar cualquier etapa de loading residual
  const loadingStages = output.querySelector('.loading-stages');
  if (loadingStages) {
    loadingStages.remove();
    console.log("ðŸ§¹ Etapas de loading residuales limpiadas");
  }
  
  console.log("ðŸ”„ BotÃ³n de generar restaurado a su estado original");
}

// FunciÃ³n para obtener las instrucciones del estilo personalizado
function getCustomStyleInstructions(styleId) {
  console.log(`ðŸŽ¨ DEBUG - getCustomStyleInstructions llamada con styleId: "${styleId}"`);
  console.log(`ðŸŽ¨ DEBUG - customStyles array:`, customStyles);
  
  if (!styleId || !styleId.startsWith('custom_')) {
    console.log(`ðŸŽ¨ DEBUG - No es un estilo personalizado: ${styleId}`);
    return null;
  }
  
  const customStyle = customStyles.find(style => style.id === styleId);
  console.log(`ðŸŽ¨ DEBUG - Estilo encontrado:`, customStyle);
  
  if (customStyle) {
    console.log(`ðŸŽ¨ DEBUG - Instrucciones del estilo: ${customStyle.instructions}`);
    return customStyle.instructions;
  }
  
  console.log(`ðŸŽ¨ DEBUG - No se encontrÃ³ el estilo personalizado`);
  return null;
}

// FunciÃ³n para generar contenido de una secciÃ³n
async function generateSectionContent(section, params) {
  try {
    const customStyleInstructions = getCustomStyleInstructions(params.selectedStyle);
    
    // Obtener configuraciÃ³n de ComfyUI si estÃ¡ habilitada
    let comfyUISettings = null;
    if (params.localAIImages && document.getElementById('localAIImages').checked) {
      comfyUISettings = getComfyUISettings();
      console.log('ðŸŽ¨ ConfiguraciÃ³n ComfyUI obtenida del frontend:', comfyUISettings);
      
      // Debug extra para verificar valores especÃ­ficos
      console.log('ðŸ” Valores especÃ­ficos:', {
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
        comfyUISettings: comfyUISettings, // Agregar configuraciÃ³n ComfyUI
        applioVoice: params.selectedApplioVoice,
        applioModel: params.selectedApplioModel,
        applioPitch: params.applioPitch,
        applioSpeed: params.applioSpeed,
        allSections: allSections
      })
    });

    const data = await response.json();
    
    if (data.script) {
      // Preparar datos completos de la secciÃ³n
      let chapterTitle = null;
      if (globalChapterStructure && globalChapterStructure.length > 0 && section <= globalChapterStructure.length) {
        chapterTitle = globalChapterStructure[section - 1];
      }
      
      // Guardar la secciÃ³n completa en el historial
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

// FunciÃ³n para generar audio de una secciÃ³n con Applio
async function generateSectionApplioAudio(section) {
  try {
    console.log(`ðŸŽ¤ Iniciando generaciÃ³n de audio con Applio para secciÃ³n ${section}...`);
    
    if (!allSections[section - 1]) {
      throw new Error(`No hay guiÃ³n disponible para la secciÃ³n ${section}`);
    }
    
    // Obtener el script de la secciÃ³n (compatible con formato nuevo y antiguo)
    const sectionData = allSections[section - 1];
    const script = typeof sectionData === 'string' ? sectionData : sectionData.script;
    
    const selectedApplioVoice = document.getElementById("applioVoiceSelect").value;
    const selectedApplioModel = document.getElementById("applioModelSelect").value;
    const applioPitch = parseInt(document.getElementById("applioPitch").value) || 0;
    const applioSpeed = parseInt(document.getElementById("applioSpeed").value) || 0;
    console.log(`ðŸŽ¤ Usando voz de Applio: ${selectedApplioVoice}`);
    console.log(`ðŸŽ›ï¸ Usando modelo de Applio: ${selectedApplioModel}`);
    console.log(`ðŸŽµ Usando pitch: ${applioPitch}`);
    console.log(`ðŸš€ Usando velocidad: ${applioSpeed}`);
    
    const response = await fetch("/generate-section-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: script, // Usar el guiÃ³n de la secciÃ³n actual
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
      console.log(`âœ… Audio Applio generado exitosamente para secciÃ³n ${section}: ${data.audioFile}`);
      console.log(`ðŸ“Š TamaÃ±o: ${(data.size / 1024).toFixed(1)} KB con ${data.method}`);
      
      // Esperar un momento adicional para asegurar que el archivo se escribiÃ³ completamente
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
    console.error(`âŒ Error generando audio Applio para secciÃ³n ${section}:`, error);
    return { 
      success: false, 
      error: error.message,
      section: section
    };
  }
}

// FunciÃ³n para generar audio de una secciÃ³n
async function generateSectionAudio(section, voice) {
  try {
    console.log(`ðŸŽµ Iniciando generaciÃ³n de audio para secciÃ³n ${section}...`);
    
    const narrationStyle = document.getElementById("narrationStyle").value.trim();
    
    // Obtener el script de la secciÃ³n (compatible con formato nuevo y antiguo)
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
        script: script, // Usar el guiÃ³n de la secciÃ³n actual
        narrationStyle: narrationStyle
      })
    });

    const data = await response.json();
    
    if (data.success && data.audio) {
      console.log(`âœ… Audio generado exitosamente para secciÃ³n ${section}: ${data.audio}`);
      
      // Esperar un momento adicional para asegurar que el archivo se escribiÃ³ completamente
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      console.log(`ðŸŽµ Audio completamente procesado para secciÃ³n ${section}`);
      return { success: true, data };
    } else {
      return { success: false, error: data.error || "Error generando audio" };
    }
  } catch (error) {
    console.error(`âŒ Error generando audio para secciÃ³n ${section}:`, error);
    return { success: false, error: error.message };
  }
}

// FunciÃ³n para mostrar contenido de una secciÃ³n
async function displaySectionContent(data, section) {
  return new Promise((resolve) => {
    // Almacenar estructura de capÃ­tulos si estÃ¡ disponible
    if (data.chapterStructure) {
      storeChapterStructure(data.chapterStructure);
    }
    
    // Mostrar guiÃ³n
    showScript(data.script, section, totalSections, data.voice, data.scriptFile, data.tokenUsage);
    
    setTimeout(() => {
      // Usar los datos del servidor en lugar de leer los checkboxes
      const skipImages = data.imagesSkipped || false;
      const bingImages = data.bingImagesMode || false;
      const localAIImages = data.localAIMode || false;
      const downloadedImages = data.downloadedImages || [];
      const localAIImagesData = data.localAIImages || [];
      
      console.log(`ðŸ” DEBUG displaySectionContent - skipImages: ${skipImages}`);
      console.log(`ðŸ” DEBUG displaySectionContent - bingImages: ${bingImages}`);
      console.log(`ðŸ” DEBUG displaySectionContent - localAIImages: ${localAIImages}`);
      console.log(`ðŸ” DEBUG displaySectionContent - downloadedImages.length: ${downloadedImages.length}`);
      console.log(`ðŸ” DEBUG displaySectionContent - localAIImagesData.length: ${localAIImagesData.length}`);
      console.log(`ðŸ” DEBUG displaySectionContent - data.imagesSkipped: ${data.imagesSkipped}`);
      console.log(`ðŸ” DEBUG displaySectionContent - data.bingImagesMode: ${data.bingImagesMode}`);
      console.log(`ðŸ” DEBUG displaySectionContent - data.localAIMode: ${data.localAIMode}`);
      console.log(`ðŸ” DEBUG displaySectionContent - data.images: ${data.images ? data.images.length : 'null'}`);
      console.log(`ðŸ” DEBUG displaySectionContent - data.imagePrompts: ${data.imagePrompts ? data.imagePrompts.length : 'null'}`);
      
      console.log(`ðŸ” DEBUG displaySectionContent - EVALUANDO CONDICIONES:`);
      console.log(`ðŸ” DEBUG - CondiciÃ³n 1 (IA Local): localAIImages=${localAIImages} && localAIImagesData.length=${localAIImagesData.length} > 0 = ${localAIImages && localAIImagesData.length > 0}`);
      console.log(`ðŸ” DEBUG - CondiciÃ³n 2 (Bing): bingImages=${bingImages} && downloadedImages.length=${downloadedImages.length} > 0 = ${bingImages && downloadedImages.length > 0}`);
      console.log(`ðŸ” DEBUG - CondiciÃ³n 3 (Normal): !skipImages=${!skipImages} && !bingImages=${!bingImages} && !localAIImages=${!localAIImages} && data.images=${data.images ? 'exists' : 'null'} = ${!skipImages && !bingImages && !localAIImages && data.images && data.images.length > 0}`);
      
      if (localAIImages && localAIImagesData.length > 0) {
        // Mostrar carrusel con imÃ¡genes generadas por IA Local
        console.log(`ðŸ¤– Mostrando carrusel con ${localAIImagesData.length} imÃ¡genes de IA Local`);
        console.log(`ðŸ¤– DEBUG - Datos de la primera imagen IA Local:`, localAIImagesData[0]);
        
        createCarousel(localAIImagesData, section, []);
        
        // Almacenar imÃ¡genes de IA Local en allSections
        if (allSections[section - 1]) {
          allSections[section - 1].images = localAIImagesData;
          allSections[section - 1].localAIMode = true;
          console.log(`ðŸ“‚ ImÃ¡genes de IA Local almacenadas en allSections[${section - 1}]`);
        }
        
      } else if (bingImages && downloadedImages.length > 0) {
        // Mostrar carrusel con imÃ¡genes descargadas de Bing
        console.log(`ðŸ–¼ï¸ Mostrando carrusel con ${downloadedImages.length} imÃ¡genes de Bing`);
        console.log(`ðŸ–¼ï¸ DEBUG - Datos de la primera imagen:`, downloadedImages[0]);
        console.log(`ðŸ” DEBUG - data.imageKeywords:`, data.imageKeywords);
        console.log(`ðŸ” DEBUG - data completa:`, data);
        
        // Almacenar las keywords para el botÃ³n de refresh
        if (data.imageKeywords && data.imageKeywords.length > 0) {
          currentImageKeywords = data.imageKeywords;
          console.log(`ðŸŽ¯ Keywords almacenadas para refresh (bloque principal):`, currentImageKeywords);
        } else {
          console.warn(`âš ï¸ No se recibieron keywords para refresh (bloque principal)`);
          console.warn(`âš ï¸ DEBUG - data.imageKeywords:`, data.imageKeywords);
          currentImageKeywords = [];
        }
        
        console.log(`ðŸ–¼ï¸ DEBUG - Llamando a createCarousel...`);
        createCarousel(downloadedImages, section, []);
        console.log(`ðŸ–¼ï¸ DEBUG - createCarousel ejecutado`);
        
        // Guardar datos de imÃ¡genes en la secciÃ³n para navegaciÃ³n
        if (allSections[section - 1]) {
          allSections[section - 1].images = downloadedImages;
          allSections[section - 1].imageKeywords = data.imageKeywords || [];
          allSections[section - 1].imageMode = 'bing';
          console.log(`ðŸ’¾ Datos de imÃ¡genes Bing guardados para secciÃ³n ${section}`);
        }
      } else if (!skipImages && !bingImages && !localAIImages && data.images && data.images.length > 0) {
        // Mostrar carrusel de imÃ¡genes normales
        console.log(`ðŸ“· Mostrando carrusel de imÃ¡genes normales`);
        createCarousel(data.images, section, data.imagePrompts);
        
        // Guardar datos de imÃ¡genes en la secciÃ³n para navegaciÃ³n
        if (allSections[section - 1]) {
          allSections[section - 1].images = data.images;
          allSections[section - 1].imagePrompts = data.imagePrompts || [];
          allSections[section - 1].imageMode = 'ai';
          console.log(`ðŸ’¾ Datos de imÃ¡genes AI guardados para secciÃ³n ${section}`);
        }
      } else if (bingImages && data.imagePrompts && data.imagePrompts.length > 0) {
        // Fallback: mostrar prompts si fallÃ³ la descarga de Bing
        console.log(`âš ï¸ Descarga de Bing fallÃ³, mostrando prompts como fallback`);
        addPromptsToSidebar(data.imagePrompts, section);
        
        // Guardar datos de prompts en la secciÃ³n para navegaciÃ³n
        if (allSections[section - 1]) {
          allSections[section - 1].imagePrompts = data.imagePrompts;
          allSections[section - 1].imageMode = 'prompts';
          console.log(`ðŸ’¾ Datos de prompts guardados para secciÃ³n ${section}`);
        }
      } else if (data.imagePrompts && data.imagePrompts.length > 0) {
        // Mostrar prompts de imÃ¡genes en el panel lateral
        console.log(`ðŸ“‹ Mostrando prompts en el panel lateral`);
        addPromptsToSidebar(data.imagePrompts, section);
        
        // Guardar datos de prompts en la secciÃ³n para navegaciÃ³n
        if (allSections[section - 1]) {
          allSections[section - 1].imagePrompts = data.imagePrompts;
          allSections[section - 1].imageMode = 'prompts';
          console.log(`ðŸ’¾ Datos de prompts guardados para secciÃ³n ${section}`);
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

// FunciÃ³n para actualizar el progreso de generaciÃ³n automÃ¡tica
function updateGenerationProgress(section, total, phase, customMessage = null) {
  const phaseText = customMessage || (phase === 'script' ? 'Generando guiÃ³n e imÃ¡genes' : phase === 'audio' ? 'Generando audio' : phase === 'images' ? 'Generando imÃ¡genes' : 'Procesando...');
  
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

// FunciÃ³n para mostrar etapa de generaciÃ³n de audio
function showAudioGenerationStage(section) {
  output.innerHTML = `
    <div class="loading-stages">
      <div class="stage completed" id="stage-script">
        <div class="stage-icon"><i class="fas fa-check-circle"></i></div>
        <div class="stage-text">GuiÃ³n generado - SecciÃ³n ${section}</div>
      </div>
      <div class="stage completed" id="stage-images">
        <div class="stage-icon"><i class="fas fa-check-circle"></i></div>
        <div class="stage-text">ImÃ¡genes procesadas</div>
      </div>
      <div class="stage active" id="stage-audio">
        <div class="stage-icon"><i class="fas fa-spinner loading"></i></div>
        <div class="stage-text">Generando audio narraciÃ³n...</div>
      </div>
    </div>
  `;
}

// FunciÃ³n para mostrar etapa de generaciÃ³n de imÃ¡genes
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
        <div class="stage-text">Generando todas las imÃ¡genes...</div>
      </div>
    </div>
  `;
}

// FunciÃ³n para mostrar completaciÃ³n de generaciÃ³n automÃ¡tica
async function showAutoGenerationComplete() {
  // No mostrar mensaje de Ã©xito si hay mÃºltiples proyectos en progreso
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (hasMultipleProjects) {
    console.log('ðŸ”„ MÃºltiples proyectos en progreso - omitiendo mensaje de Ã©xito individual');
    return;
  }
  
  generateBtn.innerHTML = `
    <i class="fas fa-check-circle"></i>
    <span>GeneraciÃ³n AutomÃ¡tica Completada</span>
  `;
  
  // Limpiar las etapas de loading
  const loadingStages = output.querySelector('.loading-stages');
  if (loadingStages) {
    loadingStages.remove();
    console.log("ðŸ§¹ Etapas de loading limpiadas");
  }
  
  // Mostrar mensaje de Ã©xito
  const successMessage = document.createElement('div');
  successMessage.className = 'auto-completion-message';
  successMessage.innerHTML = `
    <div class="success-content">
      <i class="fas fa-trophy"></i>
      <h3>Â¡GeneraciÃ³n AutomÃ¡tica Completada!</h3>
      <p>Se han generado exitosamente ${totalSections} secciones con guiÃ³n, imÃ¡genes y audio.</p>
      <p>Puedes generar los metadatos de YouTube cuando lo necesites desde el botÃ³n "Generar Metadatos".</p>
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
      successContent.insertAdjacentHTML('beforeend', '<p><strong>ðŸŽ¬ Iniciando generaciÃ³n automÃ¡tica de video...</strong></p>');
    }
  }

  let projectButtonsUpdated = false;

  if (window.currentProject && Array.isArray(window.currentProject.completedSections)) {
    try {
      updateProjectButtons(window.currentProject);
      projectButtonsUpdated = true;
    } catch (projectButtonsError) {
      console.error('âŒ Error actualizando los botones del proyecto tras la generaciÃ³n automÃ¡tica:', projectButtonsError);
    }
  }

  if (!projectButtonsUpdated) {
    showVideoGenerationButton();
    updateYouTubeMetadataButtonState();

    if (shouldAnnounceAutoVideo) {
      console.log('ðŸŽ¬ GeneraciÃ³n completa - iniciando video automÃ¡tico (fallback)...');
      setTimeout(() => {
        generateVideoAutomatically();
      }, 2000);
    }
  }
  
  setTimeout(() => {
    generateBtn.innerHTML = `
      <i class="fas fa-video"></i>
      <span>Generar SecciÃ³n 1</span>
    `;
  }, 3000);
}

// FunciÃ³n para habilitar/deshabilitar controles
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
  
  // TambiÃ©n deshabilitar los botones de video
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

// FunciÃ³n para mostrar mensaje de carga con etapas
function showLoadingStages(sectionNum, imageCount = 5, skipImages = false, googleImages = false, localAIImages = false) {
  let imageStagesHTML = '';
  
  if (!skipImages && !googleImages && !localAIImages) {
    // Modo normal: generar imÃ¡genes
    imageStagesHTML = `
      <div class="stage" id="stage-prompt">
        <div class="stage-icon"><i class="fas fa-brain"></i></div>
        <div class="stage-text">Creando secuencia visual...</div>
      </div>
      <div class="stage" id="stage-image">
        <div class="stage-icon"><i class="fas fa-images"></i></div>
        <div class="stage-text">Generando ${imageCount} imÃ¡genes gaming...</div>
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
        <div class="stage-text">Generando ${imageCount} imÃ¡genes con Fooocus...</div>
      </div>
    `;
  }
  
  output.innerHTML = `
    <div class="loading-stages">
      <div class="stage active" id="stage-script">
        <div class="stage-icon"><i class="fas fa-spinner loading"></i></div>
        <div class="stage-text">Generando guiÃ³n - SecciÃ³n ${sectionNum}...</div>
      </div>
      ${imageStagesHTML}
    </div>
  `;
}

// FunciÃ³n para actualizar etapa
function updateStage(stageId, status) {
  const stage = document.getElementById(stageId);
  
  // Validar que el elemento existe antes de continuar
  if (!stage) {
    console.warn(`âš ï¸ updateStage: Elemento con ID '${stageId}' no encontrado`);
    return;
  }
  
  const icon = stage.querySelector('.stage-icon i');
  
  // Validar que el icono existe
  if (!icon) {
    console.warn(`âš ï¸ updateStage: Icono no encontrado en elemento '${stageId}'`);
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

// FunciÃ³n para crear el carrusel de imÃ¡genes cronolÃ³gicas
function createCarousel(images, sectionNum, receivedPrompts = []) {
  console.log(`ðŸŽ  DEBUG - createCarousel llamada con ${images.length} imÃ¡genes para secciÃ³n ${sectionNum}`);
  
  const carouselContainer = document.getElementById("carousel-container");
  const carouselTrack = document.getElementById("carouselTrack");
  const carouselIndicators = document.getElementById("carouselIndicators");
  const currentImageSpan = document.getElementById("current-image");
  const totalImagesSpan = document.getElementById("total-images");
  const carouselSectionTitle = document.getElementById("carousel-section-title");
  
  console.log(`ðŸŽ  DEBUG - Elementos encontrados:`, {
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
  
  // Guardar los prompts de las imÃ¡genes - manejar mÃºltiples variaciones
  imagePrompts = images.map((img, index) => {
    if (img.prompt) {
      return img.prompt;
    } else if (img.caption) {
      // Para imÃ¡genes de Bing, usar el caption como prompt
      return img.caption;
    } else if (img.originalPromptIndex !== undefined && receivedPrompts && receivedPrompts[img.originalPromptIndex]) {
      // Si la imagen tiene un Ã­ndice de prompt original, usar ese prompt
      return receivedPrompts[img.originalPromptIndex];
    } else if (receivedPrompts && receivedPrompts[Math.floor(index / 3)]) {
      // Fallback: dividir el Ã­ndice por 3 para obtener el prompt original
      return receivedPrompts[Math.floor(index / 3)];
    }
    return '';
  });
  
  console.log('Prompts guardados:', imagePrompts.length);
  
  // Actualizar tÃ­tulos
  carouselSectionTitle.textContent = `SecciÃ³n ${sectionNum}`;
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
      img.alt = imageData.caption || `Imagen ${index + 1} de la SecciÃ³n ${sectionNum}`;
      console.log(`ðŸ–¼ï¸ Cargando imagen local: ${relativePath} (original: ${imageData.path})`);
    } else if (imageData.url) {
      // Imagen con URL pÃºblica (por ejemplo, Bing sin descarga local)
      img.src = imageData.url;
      img.alt = imageData.caption || `Imagen ${index + 1} de la SecciÃ³n ${sectionNum}`;
      console.log(`ðŸŒ Cargando imagen externa: ${imageData.url}`);
    } else if (imageData.image) {
      // Imagen generada con IA (base64)
      img.src = "data:image/png;base64," + imageData.image;
      img.alt = `Imagen ${index + 1} de la SecciÃ³n ${sectionNum}`;
      console.log(`ðŸ¤– Cargando imagen IA (base64)`);
    } else {
      // Fallback para formato no reconocido
      console.warn('Formato de imagen no reconocido:', imageData);
      img.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNiIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlbiBubyBkaXNwb25pYmxlPC90ZXh0Pjwvc3ZnPg==";
      img.alt = `Error cargando imagen ${index + 1}`;
    }
    
    img.style.opacity = "0";
    img.style.transition = "opacity 0.5s ease";
    
    // Agregar manejo de errores para imÃ¡genes de Bing
    img.onerror = function() {
      this.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNiIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkVycm9yIGNhcmdhbmRvIGltYWdlbjwvdGV4dD48L3N2Zz4=";
      this.alt = "Error cargando imagen";
    };
    
    imageContainer.appendChild(img);
    
    // Agregar botones de acciÃ³n para imÃ¡genes de Bing
    if (imageData.url) {
      // Obtener keyword para esta imagen
      const imageKeyword = (currentImageKeywords && currentImageKeywords[index]) ? currentImageKeywords[index] : '';
      console.log(`ðŸ”‘ [createCarousel] Imagen ${index}: keyword="${imageKeyword}"`);
      
      const actionButtons = document.createElement('div');
      actionButtons.className = 'bing-image-actions';
      actionButtons.innerHTML = `
        <div class="keyword-editor">
          <label for="keyword-${index}-${sectionNum}">TÃ©rmino de bÃºsqueda:</label>
          <input type="text" id="keyword-${index}-${sectionNum}" class="keyword-input" value="${imageKeyword}" placeholder="Ingresa tÃ©rminos de bÃºsqueda...">
        </div>
        <div class="action-buttons">
          <button class="btn-bing-download" onclick="downloadBingImage('${imageData.url}', '${imageData.filename || 'bing_image.jpg'}')" title="Descargar imagen">
            <i class="fas fa-download"></i>
          </button>
          <button class="btn-bing-fullscreen" onclick="showBingImageFullscreen('${imageData.url}', '${imageData.caption || 'Imagen de Bing'}')" title="Ver en tamaÃ±o completo">
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
    
    // AÃ±adir nÃºmero al indicador
    const indicatorNumber = document.createElement('span');
    indicatorNumber.textContent = index + 1;
    indicator.appendChild(indicatorNumber);
    
    carouselIndicators.appendChild(indicator);
    
    // AnimaciÃ³n de carga de imagen
    setTimeout(() => {
      img.style.opacity = "1";
    }, index * 200);
  });
  
  // Mostrar carrusel
  console.log(`ðŸŽ  DEBUG - Mostrando carrusel: ${carouselContainer ? 'elemento encontrado' : 'elemento NO encontrado'}`);
  console.log(`ðŸŽ  DEBUG - Display antes:`, carouselContainer ? carouselContainer.style.display : 'N/A');
  
  carouselContainer.style.display = "block";
  
  console.log(`ðŸŽ  DEBUG - Display despuÃ©s:`, carouselContainer ? carouselContainer.style.display : 'N/A');
  console.log(`ðŸŽ  DEBUG - Computed display:`, carouselContainer ? getComputedStyle(carouselContainer).display : 'N/A');
  console.log(`ðŸŽ  DEBUG - Visibility:`, carouselContainer ? getComputedStyle(carouselContainer).visibility : 'N/A');
  console.log(`ðŸŽ  DEBUG - OffsetHeight:`, carouselContainer ? carouselContainer.offsetHeight : 'N/A');
  
  // Configurar controles del carrusel
  setupCarouselControls();
  
  // Agregar prompts al panel lateral
  if (receivedPrompts && receivedPrompts.length > 0) {
    addPromptsToSidebar(receivedPrompts, sectionNum);
  }
  
  // Mostrar panel de prompts
  // setupImagePromptPanel(); // Comentado: Panel eliminado, ahora se usa el panel lateral
}

// FunciÃ³n para configurar controles del carrusel
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

// FunciÃ³n para ir a un slide especÃ­fico
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

// FunciÃ³n para actualizar estado de botones del carrusel
function updateCarouselButtons() {
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  
  prevBtn.disabled = currentSlide === 0;
  nextBtn.disabled = currentSlide === totalSlides - 1;
}

// FunciÃ³n para configurar el panel de prompts de imÃ¡genes
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
  
  // Re-obtener referencias despuÃ©s del clonado
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
  
  // Configurar botÃ³n de editar
  newEditPromptBtn.addEventListener("click", () => {
    promptView.style.display = "none";
    promptEdit.style.display = "block";
    
    // Llenar el textarea con el prompt actual
    promptTextarea.value = imagePrompts[currentSlide] || '';
    promptTextarea.focus();
  });
  
  // Configurar botÃ³n de cancelar
  newCancelPromptBtn.addEventListener("click", () => {
    promptEdit.style.display = "none";
    promptView.style.display = "block";
  });
  
  // Configurar botÃ³n de guardar y regenerar
  newSavePromptBtn.addEventListener("click", async () => {
    const newPrompt = promptTextarea.value.trim();
    if (!newPrompt) {
      alert("El prompt no puede estar vacÃ­o");
      return;
    }
    
    await regenerateImage(currentSlide, newPrompt);
  });
  
  // Configurar botÃ³n de regenerar imagen (sin editar prompt)
  if (newRegenerateImageBtn) {
    newRegenerateImageBtn.addEventListener("click", async () => {
      const currentPrompt = imagePrompts[currentSlide];
      if (!currentPrompt) {
        alert("No hay prompt disponible para regenerar esta imagen");
        return;
      }
      
      // Mostrar estado de carga en el botÃ³n
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
        alert('Error al regenerar la imagen. Por favor, intÃ©ntalo de nuevo.');
      } finally {
        // Restaurar estado del botÃ³n
        newRegenerateImageBtn.disabled = false;
        newRegenerateImageBtn.classList.remove('loading');
        newRegenerateImageBtn.innerHTML = originalContent;
      }
    });
  }
  
  // Configurar primer prompt
  // updateImagePromptPanel(); // Comentado: Panel eliminado
}

// FunciÃ³n para actualizar el panel de prompt de la imagen actual
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

// FunciÃ³n para regenerar una imagen
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
      // Ahora el backend devuelve mÃºltiples imÃ¡genes, usar la primera como reemplazo principal
      const primaryImage = data.images[0];
      
      // Actualizar la imagen en el carrusel con la primera variaciÃ³n
      const slides = document.querySelectorAll('.carousel-slide');
      const img = slides[imageIndex].querySelector('img');
      img.src = "data:image/png;base64," + primaryImage.image;
      
      // Actualizar el prompt guardado
      imagePrompts[imageIndex] = data.prompt;
      
      // Actualizar el prompt mostrado
      // updateImagePromptPanel(); // Comentado: Panel eliminado
      
      // Mostrar mensaje de Ã©xito con informaciÃ³n sobre las variaciones
      regenerationStatus.innerHTML = `
        <div class="regeneration-loading" style="color: #00ff7f;">
          <i class="fas fa-check-circle"></i>
          <span>Â¡${data.images.length} variaciones regeneradas! Se muestra la primera.</span>
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
    // Restaurar botÃ³n
    savePromptBtn.disabled = false;
    savePromptBtn.innerHTML = `
      <i class="fas fa-save"></i>
      Guardar y Regenerar
    `;
  }
}

// FunciÃ³n para mostrar guiÃ³n (sin audio inicialmente)
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
  
  // Obtener el tÃ­tulo del capÃ­tulo actual
  let chapterTitle = null;
  if (globalChapterStructure && globalChapterStructure.length > 0 && sectionNum <= globalChapterStructure.length) {
    chapterTitle = globalChapterStructure[sectionNum - 1];
  }
  
  // Guardar la secciÃ³n completa en el array de secciones
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
  
  console.log(`Guardando secciÃ³n ${sectionNum} completa:`, {
    script: script.substring(0, 100) + '...',
    chapterTitle: chapterTitle,
    tokenUsage: tokenUsage
  });
  
  // Actualizar tÃ­tulos y contadores
  sectionTitle.textContent = `SecciÃ³n ${sectionNum}`;
  currentSectionSpan.textContent = sectionNum;
  totalSectionsSpan.textContent = totalSections;
  
  // Actualizar tÃ­tulo del capÃ­tulo si estÃ¡ disponible
  updateChapterTitle(sectionNum);
  
  // Actualizar informaciÃ³n de tokens si estÃ¡ disponible
  updateTokenUsage(tokenUsage);
  
  // Crear contenido del script con informaciÃ³n del archivo guardado
  let scriptHTML = `
    <div class="script-container">
      <div class="script-actions">
        <button class="copy-script-btn" onclick="copyScriptText()" title="Copiar texto del guiÃ³n">
          <i class="fas fa-copy"></i>
        </button>
        <button class="audio-script-btn" onclick="generateSectionAudioButton()" title="Generar audio del guiÃ³n">
          <i class="fas fa-microphone"></i>
        </button>
      </div>
      <div class="script-text">${script.replace(/\n/g, '<br><br>')}</div>
    </div>`;
  
  // Agregar informaciÃ³n sobre el archivo guardado si estÃ¡ disponible
  if (scriptFileInfo && scriptFileInfo.saved) {
    scriptHTML += `
      <div class="script-file-info">
        <div class="file-saved-notification">
          <i class="fas fa-save"></i>
          <span>GuiÃ³n guardado automÃ¡ticamente como: <strong>${scriptFileInfo.filename}</strong></span>
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
  
  // Mostrar botÃ³n de generar audio
  generateAudioBtn.style.display = "inline-flex";
  
  // Actualizar estado de los botones de navegaciÃ³n
  updateNavigationButtons();
  
  // Reinicializar navegaciÃ³n para asegurar que los eventos funcionen
  initializeSectionNavigation();
  
  // AnimaciÃ³n de escritura
  scriptContent.style.opacity = "0";
  setTimeout(() => {
    scriptContent.style.transition = "opacity 1s ease";
    scriptContent.style.opacity = "1";
  }, 100);
}

// FunciÃ³n para mostrar audio cuando se genere
function showAudio(audioFileName, voiceUsed) {
  const audioControls = document.getElementById("audio-controls");
  const scriptAudio = document.getElementById("scriptAudio");
  const playBtn = document.getElementById("playBtn");
  
  scriptAudio.src = audioFileName;
  audioControls.style.display = "flex";
  
  // Actualizar el texto del botÃ³n para mostrar la voz usada
  const voiceInfo = voiceUsed ? ` (${voiceUsed})` : '';
  playBtn.innerHTML = `
    <i class="fas fa-play"></i>
    <span>Escuchar NarraciÃ³n${voiceInfo}</span>
  `;
  
  // Ocultar botÃ³n de generar audio y campo de estilo de narraciÃ³n
  generateAudioBtn.style.display = "none";
  
  setupAudioControls();
}

// FunciÃ³n para copiar el texto del guiÃ³n al portapapeles
function copyScriptText() {
  // Obtener el script de la secciÃ³n actual que se estÃ¡ mostrando (compatible con formato nuevo y antiguo)
  const sectionData = allSections[currentSectionNumber - 1];
  const scriptText = typeof sectionData === 'string' ? sectionData : (sectionData ? sectionData.script : null);
  
  if (!scriptText) {
    console.log(`âŒ No hay texto del guiÃ³n para la secciÃ³n ${currentSectionNumber}`);
    return;
  }
  
  // Usar la API moderna del portapapeles si estÃ¡ disponible
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(scriptText).then(() => {
      console.log(`âœ… Texto del guiÃ³n de la secciÃ³n ${currentSectionNumber} copiado al portapapeles`);
      showCopyNotification();
    }).catch(err => {
      console.error('âŒ Error copiando al portapapeles:', err);
      fallbackCopyTextToClipboard(scriptText);
    });
  } else {
    // Fallback para navegadores mÃ¡s antiguos
    fallbackCopyTextToClipboard(scriptText);
  }
}

// FunciÃ³n fallback para copiar texto (navegadores mÃ¡s antiguos)
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
      console.log('âœ… Texto del guiÃ³n copiado al portapapeles (fallback)');
      showCopyNotification();
    } else {
      console.error('âŒ Error copiando al portapapeles (fallback)');
    }
  } catch (err) {
    console.error('âŒ Error ejecutando comando de copia:', err);
  }
  
  document.body.removeChild(textArea);
}

// FunciÃ³n para mostrar notificaciÃ³n de copiado
function showCopyNotification() {
  const button = document.querySelector('.copy-script-btn');
  if (button) {
    const originalHTML = button.innerHTML;
    button.innerHTML = `<i class="fas fa-check"></i> SecciÃ³n ${currentSectionNumber}`;
    button.style.background = 'linear-gradient(135deg, #00ff7f, #00bf63)';
    
    setTimeout(() => {
      button.innerHTML = originalHTML;
      button.style.background = '';
    }, 2000);
  }
}

// FunciÃ³n para generar audio de la secciÃ³n actual usando Applio (botÃ³n micrÃ³fono)
async function generateSectionAudioButton() {
  const audioButton = document.querySelector('.audio-script-btn');
  if (!audioButton) {
    console.error('âŒ BotÃ³n de audio no encontrado');
    return;
  }

  // Verificar que tenemos los datos necesarios
  if (!currentScript || !currentTopic || !currentSectionNumber) {
    showError('No hay suficientes datos para generar el audio. AsegÃºrate de haber generado una secciÃ³n primero.');
    return;
  }

  const originalHTML = audioButton.innerHTML;
  const originalBackground = audioButton.style.background;
  
  try {
    // Mostrar estado de carga
    audioButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    audioButton.style.background = 'linear-gradient(135deg, #ff9500, #ff7b00)';
    audioButton.disabled = true;

    console.log(`ðŸŽµ Generando audio con Applio para secciÃ³n ${currentSectionNumber}...`);

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
      // Mostrar Ã©xito
      audioButton.innerHTML = '<i class="fas fa-check"></i>';
      audioButton.style.background = 'linear-gradient(135deg, #00ff7f, #00bf63)';
      
      showSuccess(`Audio generado con ${result.method || 'Applio'} para la secciÃ³n ${currentSectionNumber}`);
      
      console.log(`âœ… Audio generado: ${result.audioFile}`);
      
    } else {
      throw new Error(result.error || 'Error generando audio');
    }

  } catch (error) {
    console.error('âŒ Error generando audio:', error);
    
    // Mostrar error
    audioButton.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
    audioButton.style.background = 'linear-gradient(135deg, #e53e3e, #c53030)';
    
    // Mensajes de error mÃ¡s especÃ­ficos
    let errorMessage = `Error generando audio: ${error.message}`;
    
    if (error.message.includes('servidor Applio no disponible') || error.message.includes('503')) {
      errorMessage = 'Servidor Applio no disponible. Ejecuta: python applio_server.py en el puerto 5004';
    } else if (error.message.includes('ECONNREFUSED')) {
      errorMessage = 'No se puede conectar al servidor Applio. Verifica que estÃ© corriendo.';
    }
    
    showError(errorMessage);
  } finally {
    // Restaurar botÃ³n despuÃ©s de 3 segundos
    setTimeout(() => {
      audioButton.innerHTML = originalHTML;
      audioButton.style.background = originalBackground;
      audioButton.disabled = false;
    }, 3000);
  }
}

// FunciÃ³n para configurar controles de audio
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
  
  // FunciÃ³n para formatear tiempo
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  
  // FunciÃ³n para actualizar posiciÃ³n de la barra de progreso
  function updateProgress() {
    if (!isDragging && scriptAudio.duration) {
      const progress = (scriptAudio.currentTime / scriptAudio.duration) * 100;
      progressFill.style.width = progress + '%';
      progressHandle.style.left = progress + '%';
      currentTimeEl.textContent = formatTime(scriptAudio.currentTime);
    }
  }
  
  // FunciÃ³n para establecer posiciÃ³n del audio
  function setAudioPosition(percentage) {
    if (scriptAudio.duration) {
      scriptAudio.currentTime = (percentage / 100) * scriptAudio.duration;
      progressFill.style.width = percentage + '%';
      progressHandle.style.left = percentage + '%';
      currentTimeEl.textContent = formatTime(scriptAudio.currentTime);
    }
  }
  
  // Eventos de los botones de reproducciÃ³n
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
  
  // Soporte para dispositivos tÃ¡ctiles
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

// FunciÃ³n para mostrar error
function showError(message) {
  output.innerHTML = `
    <div class="error-message">
      <i class="fas fa-exclamation-triangle"></i>
      <strong>Â¡Oops!</strong> ${message}
    </div>
  `;
}

// FunciÃ³n para mostrar Ã©xito
function showSuccess(message) {
  output.innerHTML = `
    <div class="success-message">
      <i class="fas fa-check-circle"></i>
      <strong>Â¡Ã‰xito!</strong> ${message}
    </div>
  `;
}

// FunciÃ³n para mostrar mensaje de finalizaciÃ³n
function showCompletionMessage(sectionNum, totalSections, isComplete) {
  if (isComplete) {
    output.innerHTML = `
      <div class="completion-message">
        <div class="completion-icon">
          <i class="fas fa-trophy"></i>
        </div>
        <h3>Â¡GuiÃ³n Completo de "CrÃ³nicas del Gaming"!</h3>
        <p>Has generado todas las ${totalSections} secciones del guiÃ³n. Cada secciÃ³n incluye su secuencia visual cronolÃ³gica. Ahora puedes generar el audio de narraciÃ³n.</p>
        <p style="color: #00ff7f; margin-top: 15px;"><i class="fas fa-youtube"></i> Usa el botÃ³n "Generar Metadatos" cuando quieras preparar la metadata de YouTube.</p>
      </div>
    `;
      updateYouTubeMetadataButtonState();
  } else {
    output.innerHTML = `
      <div class="completion-message">
        <div class="completion-icon">
          <i class="fas fa-check-circle"></i>
        </div>
        <h3>Â¡SecciÃ³n ${sectionNum} Completada!</h3>
        <p>GuiÃ³n y secuencia visual de la SecciÃ³n ${sectionNum} listos. Puedes generar el audio o continuar con la SecciÃ³n ${sectionNum + 1}.</p>
      </div>
    `;
  }
}

// Event listener para el botÃ³n principal
generateBtn.addEventListener("click", async () => {
  console.log("ðŸ” DEBUG: BotÃ³n clickeado");
  
  // GeneraciÃ³n automÃ¡tica estÃ¡ siempre activada
  const autoGenerate = true;
  console.log(`ðŸ” DEBUG: autoGenerate = ${autoGenerate}`);
  
  if (autoGenerate) {
    console.log("ðŸ¤– DETECTADO: GeneraciÃ³n automÃ¡tica ACTIVADA - usando sistema de lotes");
    // PequeÃ±o delay para asegurar que el DOM estÃ© completamente listo
    setTimeout(async () => {
      await runAutoGeneration();
    }, 100);
    return;
  }
  
  console.log("ðŸ“ DETECTADO: GeneraciÃ³n automÃ¡tica DESACTIVADA - usando sistema tradicional");
  
  // Continuar con la generaciÃ³n normal
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
    console.log("Tema vacÃ­o, mostrando error");
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
  
  // Limpiar el panel de prompts al iniciar una nueva generaciÃ³n
  clearPromptsPanel();
  
  // Actualizar botones de navegaciÃ³n
  updateNavigationButtons();

  // Deshabilitar botÃ³n y mostrar estado de carga
  generateBtn.disabled = true;
  generateBtn.innerHTML = `
    <i class="fas fa-spinner loading"></i>
    <span>Generando SecciÃ³n 1...</span>
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

    // Almacenar estructura de capÃ­tulos si estÃ¡ disponible (funciÃ³n principal)
    if (data.chapterStructure) {
      storeChapterStructure(data.chapterStructure);
      console.log('ðŸ“š Estructura de capÃ­tulos recibida:', data.chapterStructure.length, 'capÃ­tulos');
    }

    if (data.script) {
      // Actualizar etapas completadas (con pequeÃ±o delay para asegurar que los elementos existen)
      setTimeout(() => {
        updateStage('stage-script', 'completed');
      }, 100);
      
      if (!skipImages && ((data.images && data.images.length > 0) || (data.downloadedImages && data.downloadedImages.length > 0) || (data.localAIImages && data.localAIImages.length > 0))) {
        // Con imÃ¡genes (IA generadas o descargadas de Bing)
        setTimeout(() => {
          updateStage('stage-prompt', 'completed');
          updateStage('stage-image', 'completed');
        }, 200);
        
        // Mostrar guiÃ³n primero
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile, data.tokenUsage);
        }, 500);
        
        // Mostrar carrusel de imÃ¡genes
        setTimeout(() => {
          if (data.localAIImages && data.localAIImages.length > 0) {
            // ImÃ¡genes generadas con IA Local
            console.log(`ðŸ¤– Mostrando carrusel con ${data.localAIImages.length} imÃ¡genes de IA Local`);
            
            createCarousel(data.localAIImages, data.currentSection, data.imagePrompts || []);
            
            // Guardar datos de imÃ¡genes en la secciÃ³n para navegaciÃ³n
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.localAIImages;
              allSections[data.currentSection - 1].imagePrompts = data.imagePrompts || [];
              allSections[data.currentSection - 1].imageMode = 'local_ai';
              allSections[data.currentSection - 1].localAIMode = true;
              console.log(`ðŸ’¾ Datos de imÃ¡genes IA Local guardados para secciÃ³n ${data.currentSection}`);
            }
            
          } else if (data.downloadedImages && data.downloadedImages.length > 0) {
            // ImÃ¡genes de Bing descargadas
            console.log(`ðŸ–¼ï¸ Mostrando carrusel con ${data.downloadedImages.length} imÃ¡genes de Bing`);
            
            // âœ… IMPORTANTE: Almacenar las keywords ANTES de crear el carrusel
            if (data.imageKeywords && data.imageKeywords.length > 0) {
              currentImageKeywords = data.imageKeywords;
              console.log(`ðŸŽ¯ Keywords almacenadas para refresh (funciÃ³n principal):`, currentImageKeywords);
            } else {
              console.warn(`âš ï¸ No se recibieron keywords para refresh (funciÃ³n principal)`);
              console.warn(`âš ï¸ DEBUG - data.imageKeywords:`, data.imageKeywords);
              console.warn(`âš ï¸ DEBUG - data completa:`, data);
              currentImageKeywords = [];
            }
            
            // âœ… Crear carrusel despuÃ©s de asignar keywords
            createCarousel(data.downloadedImages, data.currentSection, []);
            
            // Guardar datos de imÃ¡genes en la secciÃ³n para navegaciÃ³n (funciÃ³n principal)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.downloadedImages;
              allSections[data.currentSection - 1].imageKeywords = data.imageKeywords || [];
              allSections[data.currentSection - 1].imageMode = 'bing';
              console.log(`ðŸ’¾ Datos de imÃ¡genes Bing guardados para secciÃ³n ${data.currentSection} (funciÃ³n principal)`);
            }
          } else if (data.images && data.images.length > 0) {
            // ImÃ¡genes generadas con IA
            console.log(`ðŸ“· Mostrando carrusel de imÃ¡genes IA`);
            createCarousel(data.images, data.currentSection, data.imagePrompts);
            
            // Guardar datos de imÃ¡genes en la secciÃ³n para navegaciÃ³n (funciÃ³n principal)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.images;
              allSections[data.currentSection - 1].imagePrompts = data.imagePrompts || [];
              allSections[data.currentSection - 1].imageMode = 'ai';
              console.log(`ðŸ’¾ Datos de imÃ¡genes AI guardados para secciÃ³n ${data.currentSection} (funciÃ³n principal)`);
            }
          }
        }, 1000);
      } else {
        // Sin imÃ¡genes generadas o descargadas
        // Mostrar solo el guiÃ³n
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile, data.tokenUsage);
          
          // Solo ocultar el carrusel si NO hay imÃ¡genes de Bing
          if (!data.downloadedImages || data.downloadedImages.length === 0) {
            document.getElementById("carousel-container").style.display = "none";
          }
          
          // Verificar si hay imÃ¡genes descargadas de Bing o prompts tradicionales
          console.log(`ðŸ” DEBUG FRONTEND - Verificando imÃ¡genes/prompts...`);
          console.log(`ðŸ” DEBUG FRONTEND - data.downloadedImages:`, data.downloadedImages);
          console.log(`ðŸ” DEBUG FRONTEND - data.bingImagesMode:`, data.bingImagesMode);
          console.log(`ðŸ” DEBUG FRONTEND - data.imagePrompts:`, data.imagePrompts);
          console.log(`ðŸ” DEBUG FRONTEND - data.googleImagesMode:`, data.googleImagesMode);
          console.log(`ðŸ” DEBUG FRONTEND - data.mode:`, data.mode);
          
          // Mostrar imÃ¡genes de Bing en carrusel si estÃ¡n disponibles
          if (data.downloadedImages && data.downloadedImages.length > 0 && data.bingImagesMode) {
            console.log(`ðŸ–¼ï¸ Mostrando carrusel tardÃ­o con ${data.downloadedImages.length} imÃ¡genes de Bing`);
            
            // Almacenar las keywords para el botÃ³n de refresh
            if (data.imageKeywords && data.imageKeywords.length > 0) {
              currentImageKeywords = data.imageKeywords;
              console.log(`ðŸŽ¯ Keywords almacenadas para refresh:`, currentImageKeywords);
            } else {
              console.warn(`âš ï¸ No se recibieron keywords para refresh`);
              currentImageKeywords = [];
            }
            
            createCarousel(data.downloadedImages, data.currentSection, []);
          }
          // Solo mostrar en panel lateral si NO se omiten imÃ¡genes, NO hay imÃ¡genes de Bing y SÃ hay prompts tradicionales
          else if (!skipImages && data.imagePrompts && data.imagePrompts.length > 0 && !data.bingImagesMode) {
            if (data.googleImagesMode) {
              console.log(`ðŸ”— DEBUG FRONTEND - Ejecutando createGoogleImageLinks con ${data.imagePrompts.length} keywords`);
              createGoogleImageLinks(data.imagePrompts, data.currentSection);
            } else {
              console.log(`ðŸ“‹ DEBUG FRONTEND - Ejecutando addPromptsToSidebar con ${data.imagePrompts.length} prompts`);
              addPromptsToSidebar(data.imagePrompts, data.currentSection);
            }
          } else {
            if (skipImages) {
              console.log(`â­ï¸ DEBUG FRONTEND - Omitiendo prompts de imagen porque skipImages estÃ¡ activado`);
            } else {
              console.log(`âŒ DEBUG FRONTEND - No se encontraron imÃ¡genes ni prompts vÃ¡lidos`);
            }
          }
        }, 500);
      }
      
      // Mostrar mensaje de finalizaciÃ³n y botones
      setTimeout(() => {
        showCompletionMessage(data.currentSection, data.totalSections, data.isComplete);
        
        // Mostrar botÃ³n correspondiente
        if (!data.isComplete) {
          continueBtn.style.display = "inline-flex";
          continueBtn.querySelector('span').textContent = `Continuar con SecciÃ³n ${data.currentSection + 1}`;
        }
      }, 1500);
      
    } else {
      showError(data.error || "No se pudo generar el contenido. Intenta con un tema diferente.");
    }
  } catch (error) {
    showError("Error de conexiÃ³n. Verifica tu conexiÃ³n a internet e intenta nuevamente.");
    console.error("Error:", error);
  } finally {
    // Restaurar botÃ³n
    generateBtn.disabled = false;
    generateBtn.innerHTML = `
      <i class="fas fa-video"></i>
      <span>Generar SecciÃ³n 1</span>
    `;
  }
});

// Event listener para el botÃ³n de generar audio
/* COMENTADO: FunciÃ³n del botÃ³n continueBtn eliminado
  console.log('ðŸ“Š Variables de estado actual:', {
    currentTopic,
    currentSectionNumber,
    totalSections,
    'window.currentProject?.completedSections?.length': window.currentProject?.completedSections?.length
  });

  if (!currentTopic || currentSectionNumber >= totalSections) {
    showError("No se puede continuar. Genera primero una secciÃ³n o ya has completado todas las secciones.");
    return;
  }

  const nextSection = currentSectionNumber + 1;
  console.log('ðŸŽ¯ SecciÃ³n que se va a generar:', nextSection);
  
  const imageCount = parseInt(document.getElementById("imagesSelect").value);
  const aspectRatio = document.getElementById("aspectRatioSelect").value;
  // ðŸ”§ FIX: Usar el folderName del proyecto cargado si existe, sino el del input
  const folderName = window.currentProject ? window.currentProject.folderName : document.getElementById("folderName").value.trim();
  console.log('ðŸ“ Usando folderName:', folderName, 'desde proyecto cargado:', !!window.currentProject);
  const selectedStyle = document.getElementById("styleSelect").value;
  const promptModifier = document.getElementById("promptModifier").value.trim();
  const selectedImageModel = getSelectedImageModel();
  const selectedLlmModel = document.getElementById("llmModelSelect").value;
  let skipImages = document.getElementById("skipImages").checked;
  let googleImages = document.getElementById("googleImages").checked;
  
  // ðŸ”§ VALIDACIÃ“N: No se puede omitir imÃ¡genes Y usar Google Images al mismo tiempo
  // PERO solo aplicar esta validaciÃ³n si NO estamos cargando un proyecto
  if (skipImages && googleImages && !isLoadingProject) {
    console.warn('âš ï¸ ConfiguraciÃ³n contradictoria detectada en CONTINUAR: skipImages=true y googleImages=true');
    console.warn('ðŸ”§ Corrigiendo: Desactivando skipImages porque googleImages tiene prioridad');
    skipImages = false;
    document.getElementById("skipImages").checked = false;
    showNotification('âš ï¸ CorrecciÃ³n automÃ¡tica: No puedes omitir imÃ¡genes si usas Google Images', 'warning');
  } else if (skipImages && googleImages && isLoadingProject) {
    console.log('ðŸ“‚ Continuando proyecto: Permitiendo skipImages=true y googleImages=true (solo guiÃ³n + keywords)');
  }
  
  // Deshabilitar botÃ³n y mostrar estado de carga
  continueBtn.disabled = true;
  continueBtn.innerHTML = `
    <i class="fas fa-spinner loading"></i>
    <span>Generando SecciÃ³n ${nextSection}...</span>
  `;
  
  generateAudioBtn.style.display = "none";
  
  showLoadingStages(nextSection, imageCount, skipImages, googleImages, localAIImages);

  try {
    console.log(`Enviando llamada API para secciÃ³n ${nextSection}`);
    const skipImages = document.getElementById("skipImages").checked;
    const googleImages = document.getElementById("googleImages").checked;
    const localAIImages = document.getElementById("localAIImages").checked;
    const currentApplioVoice = document.getElementById("applioVoiceSelect").value;
    console.log(`Omitir imÃ¡genes: ${skipImages}`);
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
      // Actualizar etapas completadas (con pequeÃ±o delay para asegurar que los elementos existen)
      setTimeout(() => {
        updateStage('stage-script', 'completed');
      }, 100);
      
      // Usar los datos del servidor en lugar de leer los checkboxes
      const serverSkipImages = data.imagesSkipped || false;
      const serverGoogleImages = data.googleImagesMode || false;
      
      console.log(`ðŸ” DEBUG continueGeneration - skipImages: ${skipImages}`);
      console.log(`ðŸ” DEBUG continueGeneration - googleImages: ${googleImages}`);
      console.log(`ðŸ” DEBUG continueGeneration - serverSkipImages: ${serverSkipImages}`);
      console.log(`ðŸ” DEBUG continueGeneration - serverGoogleImages: ${serverGoogleImages}`);
      console.log(`ðŸ” DEBUG continueGeneration - data.imagesSkipped: ${data.imagesSkipped}`);
      console.log(`ðŸ” DEBUG continueGeneration - data.googleImagesMode: ${data.googleImagesMode}`);
      console.log(`ðŸ” DEBUG continueGeneration - data.images: ${data.images ? data.images.length : 'null'}`);
      console.log(`ðŸ” DEBUG continueGeneration - data.imagePrompts: ${data.imagePrompts ? data.imagePrompts.length : 'null'}`);
      console.log(`ðŸ” DEBUG continueGeneration - data.downloadedImages: ${data.downloadedImages ? data.downloadedImages.length : 'null'}`);
      
      if (!serverSkipImages && !serverGoogleImages && ((data.images && data.images.length > 0) || (data.downloadedImages && data.downloadedImages.length > 0))) {
        // Con imÃ¡genes (IA generadas o descargadas de Bing)
        console.log(`ðŸ“· continueGeneration - Mostrando carrusel de imÃ¡genes ${data.downloadedImages ? 'Bing' : 'IA'}`);
        setTimeout(() => {
          updateStage('stage-prompt', 'completed');
          updateStage('stage-image', 'completed');
        }, 200);
        
        // Actualizar nÃºmero de secciÃ³n actual
        currentSectionNumber = data.currentSection;
        
        // Mostrar guiÃ³n de la nueva secciÃ³n
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile);
        }, 500);
        
        // Mostrar carrusel de imÃ¡genes
        setTimeout(() => {
          if (data.downloadedImages && data.downloadedImages.length > 0) {
            // ImÃ¡genes de Bing descargadas
            console.log(`ðŸ–¼ï¸ continueGeneration - Creando carrusel con ${data.downloadedImages.length} imÃ¡genes de Bing`);
            
            // Almacenar las keywords para el botÃ³n de refresh
            if (data.imageKeywords && data.imageKeywords.length > 0) {
              currentImageKeywords = data.imageKeywords;
              console.log(`ðŸŽ¯ Keywords almacenadas para refresh (continueGeneration):`, currentImageKeywords);
            } else {
              console.warn(`âš ï¸ No se recibieron keywords para refresh (continueGeneration)`);
              currentImageKeywords = [];
            }
            
            createCarousel(data.downloadedImages, data.currentSection, []);
            
            // Guardar datos de imÃ¡genes en la secciÃ³n para navegaciÃ³n (continueGeneration)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.downloadedImages;
              allSections[data.currentSection - 1].imageKeywords = data.imageKeywords || [];
              allSections[data.currentSection - 1].imageMode = 'bing';
              console.log(`ðŸ’¾ Datos de imÃ¡genes Bing guardados para secciÃ³n ${data.currentSection} (continueGeneration)`);
            }
          } else if (data.images && data.images.length > 0) {
            // ImÃ¡genes generadas con IA
            console.log(`ðŸ“· continueGeneration - Creando carrusel con ${data.images.length} imÃ¡genes IA`);
            createCarousel(data.images, data.currentSection, data.imagePrompts);
            
            // Guardar datos de imÃ¡genes en la secciÃ³n para navegaciÃ³n (continueGeneration)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.images;
              allSections[data.currentSection - 1].imagePrompts = data.imagePrompts || [];
              allSections[data.currentSection - 1].imageMode = 'ai';
              console.log(`ðŸ’¾ Datos de imÃ¡genes AI guardados para secciÃ³n ${data.currentSection} (continueGeneration)`);
            }
          }
        }, 1000);
      } else if (!skipImages && serverGoogleImages && data.imagePrompts && data.imagePrompts.length > 0) {
        // Modo Google Images (solo si no se omiten imÃ¡genes)
        console.log(`ðŸ”—ðŸ”—ðŸ”— continueGeneration - EJECUTANDO createGoogleImageLinks ðŸ”—ðŸ”—ðŸ”—`);
        setTimeout(() => {
          updateStage('stage-prompt', 'completed');
        }, 200);
        
        // Actualizar nÃºmero de secciÃ³n actual
        currentSectionNumber = data.currentSection;
        
        // Mostrar guiÃ³n
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile);
          // Ocultar el carrusel de imÃ¡genes
          document.getElementById("carousel-container").style.display = "none";
          
          // Crear enlaces de Google Images
          createGoogleImageLinks(data.imagePrompts, data.currentSection);
        }, 500);
      } else {
        // Sin imÃ¡genes (omitidas)
        console.log(`ðŸ“‹ continueGeneration - Mostrando prompts en panel lateral (modo skipImages)`);
        // Actualizar nÃºmero de secciÃ³n actual
        currentSectionNumber = data.currentSection;
        
        // Mostrar solo el guiÃ³n
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile);
          // Ocultar el carrusel de imÃ¡genes
          document.getElementById("carousel-container").style.display = "none";
          
          // Mostrar prompts de imÃ¡genes en el panel lateral solo si no se omiten imÃ¡genes
          if (!skipImages && data.imagePrompts && data.imagePrompts.length > 0) {
            addPromptsToSidebar(data.imagePrompts, data.currentSection);
          } else if (skipImages) {
            console.log(`â­ï¸ DEBUG FRONTEND (continuar) - Omitiendo prompts de imagen porque skipImages estÃ¡ activado`);
          }
        }, 500);
      }
      
      // Mostrar mensaje de finalizaciÃ³n
      setTimeout(() => {
        showCompletionMessage(data.currentSection, data.totalSections, data.isComplete);
        
        // Mostrar u ocultar botÃ³n de continuar
        if (data.isComplete) {
          continueBtn.style.display = "none";
        } else {
          continueBtn.style.display = "inline-flex";
          continueBtn.querySelector('span').textContent = `Continuar con SecciÃ³n ${data.currentSection + 1}`;
        }
      }, 1500);
      
    } else {
      showError(data.error || "No se pudo generar la siguiente secciÃ³n. Intenta nuevamente.");
    }
  } catch (error) {
    showError("Error generando la siguiente secciÃ³n. Verifica tu conexiÃ³n e intenta nuevamente.");
    console.error("Error:", error);
// Event listener para el botÃ³n de generar audio
*/ 
// Event listener para el botÃ³n de generar audio
generateAudioBtn.addEventListener("click", async () => {
  if (!currentScript) {
    showError("Primero genera un guiÃ³n antes de crear el audio.");
    return;
  }

  const folderName = document.getElementById("folderName").value.trim();
  const narrationStyle = document.getElementById("narrationStyle").value.trim();

  // Deshabilitar botÃ³n y mostrar estado de carga
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
    showError("Error generando audio. Verifica tu conexiÃ³n e intenta nuevamente.");
    console.error("Error:", error);
  } finally {
    // Restaurar botÃ³n
    generateAudioBtn.disabled = false;
    generateAudioBtn.innerHTML = `
      <i class="fas fa-microphone"></i>
      <span>Generar Audio</span>
    `;
  }
});

// Event listener para el botÃ³n de generar video simple (sin animaciones)
document.getElementById("generateSimpleVideoBtn").addEventListener("click", async () => {
  // âœ… CORREGIDO: Usar folderName del proyecto actual, no del input original
  let folderName;
  
  if (window.currentProject && window.currentProject.folderName) {
    // Si hay proyecto cargado, usar su folderName normalizado
    folderName = window.currentProject.folderName;
    console.log(`ðŸŽ¯ Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    // Fallback: usar el input y normalizarlo
    const inputFolderName = document.getElementById("folderName").value.trim();
    if (!inputFolderName) {
      showError("Por favor, especifica el nombre de la carpeta del proyecto");
      return;
    }
    // Normalizar el nombre como lo hace el backend
    folderName = inputFolderName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    console.log(`ðŸ”§ Normalizando folderName: "${inputFolderName}" â†’ "${folderName}"`);
  }
  
  if (!allSections || allSections.length === 0) {
    showError("No hay secciones generadas para crear el video");
    return;
  }
  
  console.log(`ðŸŽ¬ Iniciando generaciÃ³n de video simple para proyecto: ${folderName}`);
  
  try {
    await generateSimpleProjectVideo(folderName);
  } catch (error) {
    console.error("âŒ Error generando video simple:", error);
    showError(`Error generando video simple: ${error.message}`);
  }
});

// Event listener para el botÃ³n de generar/metadatos de YouTube
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

      showNotification('â„¹ï¸ Ya existen metadatos de YouTube para este proyecto.', 'info');
      return;
    }

    if ((!Array.isArray(allSections) || allSections.length === 0) && !(window.currentProject?.completedSections?.length)) {
      showNotification('âš ï¸ Genera al menos una secciÃ³n antes de crear metadatos.', 'warning');
      return;
    }

    const originalHtml = generateYouTubeMetadataBtn.innerHTML;
    generateYouTubeMetadataBtn.disabled = true;
    generateYouTubeMetadataBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando Metadatos...</span>';

    try {
      const metadata = await generateYouTubeMetadata();
      if (metadata) {
        showNotification('âœ… Metadatos de YouTube generados exitosamente.', 'success');
      }
    } catch (error) {
      console.error('âŒ Error generando metadatos desde el botÃ³n principal:', error);
      showNotification(`âŒ Error generando metadatos: ${error.message || error}`, 'error');
    } finally {
      generateYouTubeMetadataBtn.disabled = false;
      generateYouTubeMetadataBtn.innerHTML = originalHtml;
      updateYouTubeMetadataButtonState();
    }
  });
}

// Event listener para el botÃ³n de generar clips separados por secciÃ³n
document.getElementById("generateSeparateVideosBtn").addEventListener("click", async (event) => {
  // âœ… CORREGIDO: Usar folderName del proyecto actual, no del input original
  let folderName;
  
  if (window.currentProject && window.currentProject.folderName) {
    // Si hay proyecto cargado, usar su folderName normalizado
    folderName = window.currentProject.folderName;
    console.log(`ðŸŽ¯ Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    // Fallback: usar el input y normalizarlo
    const inputFolderName = document.getElementById("folderName").value.trim();
    if (!inputFolderName) {
      showError("Por favor, especifica el nombre de la carpeta del proyecto");
      return;
    }
    // Normalizar el nombre como lo hace el backend
    folderName = inputFolderName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    console.log(`ðŸ”§ Normalizando folderName: "${inputFolderName}" â†’ "${folderName}"`);
  }
  
  if (!allSections || allSections.length === 0) {
    showError("No hay secciones generadas para crear los clips");
    return;
  }
  
  console.log(`ðŸŽ¬ Iniciando generaciÃ³n de clips separados para proyecto: ${folderName}`);
  
  try {
    await generateSeparateVideos(folderName, {
      buttonElement: event.currentTarget
    });
  } catch (error) {
    console.error("âŒ Error generando clips separados:", error);
    showError(`Error generando clips separados: ${error.message}`);
  }
});

// Event listener para el botÃ³n de regenerar audios faltantes
document.getElementById("regenerateApplioAudiosBtn").addEventListener("click", async () => {
  console.log('ðŸŽ¤ Click en botÃ³n de regenerar audios faltantes');
  
  try {
    await regenerateAllAudios();
  } catch (error) {
    console.error("âŒ Error regenerando audios:", error);
    showError(`Error regenerando audios: ${error.message}`);
  }
});

// Event listener para el botÃ³n de regenerar guiones faltantes
document.getElementById("regenerateMissingScriptsBtn").addEventListener("click", async () => {
  console.log('ðŸ“ Click en botÃ³n de regenerar guiones faltantes');
  
  try {
    await regenerateMissingScripts();
  } catch (error) {
    console.error("âŒ Error regenerando guiones:", error);
    showError(`Error regenerando guiones: ${error.message}`);
  }
});

// Event listener para el botÃ³n de generar imÃ¡genes faltantes
document.getElementById("generateMissingImagesBtn").addEventListener("click", async () => {
  const btn = document.getElementById("generateMissingImagesBtn");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando ImÃ¡genes...</span>';
  
  console.log('ðŸ–¼ï¸ Click en botÃ³n de generar imÃ¡genes faltantes');
  
  try {
    await generateMissingImages();
  } catch (error) {
    console.error("âŒ Error generando imÃ¡genes:", error);
    showError(`Error generando imÃ¡genes: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});

document.getElementById("cancelMissingImagesBtn").addEventListener("click", async () => {
  console.log('ðŸ›‘ Click en botÃ³n de cancelar generaciÃ³n de imÃ¡genes');
  try {
    await cancelMissingImagesGeneration();
  } catch (error) {
    console.error('âŒ Error cancelando la generaciÃ³n de imÃ¡genes:', error);
    showError(`Error cancelando la generaciÃ³n de imÃ¡genes: ${error.message}`);
  }
});

const attemptComfyCheckboxElement = document.getElementById('attemptComfyCheckbox');
if (attemptComfyCheckboxElement) {
  attemptComfyCheckboxElement.addEventListener('change', () => {
    updateGenerateImagesButtonState();
  });
}

// Event listener para el botÃ³n de generar solo prompts de imÃ¡genes
document.getElementById("generateMissingPromptsBtn").addEventListener("click", async () => {
  console.log('ðŸ“ Click en botÃ³n de generar solo prompts de imÃ¡genes');
  
  try {
    await generateMissingPrompts();
  } catch (error) {
    console.error("âŒ Error generando prompts:", error);
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

// âš¡ Configurar eventos para los checkboxes de imÃ¡genes (manejo automÃ¡tico)
function setupImageCheckboxEvents() {
  const googleImagesCheckbox = document.getElementById("googleImages");
  const localAIImagesCheckbox = document.getElementById("localAIImages");
  
  // Event listeners simplificados - ahora se pueden activar ambas opciones
  if (googleImagesCheckbox) {
    googleImagesCheckbox.addEventListener("change", function() {
      console.log('ðŸ–¼ï¸ Google Images:', this.checked);
    });
  }
  
  if (localAIImagesCheckbox) {
    localAIImagesCheckbox.addEventListener("change", function() {
      console.log('ðŸ§  Local AI Images:', this.checked);
    });
  }
}

// Inicializar eventos de checkboxes
document.addEventListener('DOMContentLoaded', function() {
  setupImageCheckboxEvents();
});

// FunciÃ³n para mostrar prompts de imÃ¡genes cuando se omiten las imÃ¡genes
function showImagePrompts(prompts, sectionNumber, promptsFileInfo) {
  console.log(`ðŸŽ¨ DEBUG showImagePrompts - Iniciando funciÃ³n...`);
  console.log(`ðŸŽ¨ DEBUG showImagePrompts - prompts recibidos:`, prompts);
  console.log(`ðŸŽ¨ DEBUG showImagePrompts - prompts.length:`, prompts ? prompts.length : 'undefined');
  console.log(`ðŸŽ¨ DEBUG showImagePrompts - sectionNumber:`, sectionNumber);
  console.log(`ðŸŽ¨ DEBUG showImagePrompts - promptsFileInfo:`, promptsFileInfo);
  
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    console.log(`âŒ DEBUG showImagePrompts - Prompts invÃ¡lidos o vacÃ­os`);
    return;
  }
  
  console.log(`ðŸŽ¨ Mostrando ${prompts.length} prompts de imÃ¡genes para la secciÃ³n ${sectionNumber}`);
  
  // Buscar si ya existe un contenedor de prompts y eliminarlo
  const existingContainer = document.getElementById('image-prompts-display');
  if (existingContainer) {
    console.log(`ðŸ”„ DEBUG showImagePrompts - Eliminando contenedor existente`);
    existingContainer.remove();
  }
  
  // Crear el contenedor principal
  const container = document.createElement('div');
  container.id = 'image-prompts-display';
  container.className = 'image-prompts-container';
  console.log(`ðŸ“¦ DEBUG showImagePrompts - Contenedor creado`);
  
  // Crear el header
  const header = document.createElement('div');
  header.className = 'image-prompts-header';
  header.innerHTML = `
    <i class="fas fa-palette"></i>
    <span>Prompts Visuales - SecciÃ³n ${sectionNumber}</span>
  `;
  
  // Agregar informaciÃ³n sobre el archivo guardado si estÃ¡ disponible
  if (promptsFileInfo && promptsFileInfo.saved) {
    const fileInfo = document.createElement('div');
    fileInfo.className = 'prompts-file-info';
    fileInfo.innerHTML = `
      <div class="file-saved-notification">
        <i class="fas fa-save"></i>
        <span>Prompts guardados automÃ¡ticamente como: <strong>${promptsFileInfo.filename}</strong></span>
      </div>
    `;
    header.appendChild(fileInfo);
  }
  
  // Crear la lista de prompts
  const list = document.createElement('div');
  list.className = 'image-prompts-list';
  
  prompts.forEach((prompt, index) => {
    console.log(`ðŸ” DEBUG showImagePrompts - Procesando prompt ${index + 1}: ${prompt.substring(0, 50)}...`);
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
  let noteText = "Estos prompts describen las imÃ¡genes que se habrÃ­an generado para acompaÃ±ar visualmente el guiÃ³n.";
  
  if (additionalInstructions) {
    noteText += ` Las instrucciones adicionales ("${additionalInstructions}") han sido aplicadas a estos prompts.`;
    console.log(`ðŸ“ DEBUG showImagePrompts - Instrucciones adicionales aplicadas: "${additionalInstructions}"`);
  }
  
  note.innerHTML = `
    <i class="fas fa-info-circle"></i>
    ${noteText}
  `;
  
  // Ensamblar el contenedor
  container.appendChild(header);
  container.appendChild(list);
  container.appendChild(note);
  
  // Insertar despuÃ©s del output del script
  const output = document.getElementById('output');
  console.log(`ðŸ” DEBUG showImagePrompts - Element output encontrado:`, !!output);
  
  if (output && output.nextSibling) {
    output.parentNode.insertBefore(container, output.nextSibling);
    console.log(`ðŸ“ DEBUG showImagePrompts - Insertado despuÃ©s del output (con nextSibling)`);
  } else if (output) {
    output.parentNode.appendChild(container);
    console.log(`ðŸ“ DEBUG showImagePrompts - Insertado despuÃ©s del output (appendChild)`);
  } else {
    document.body.appendChild(container);
    console.log(`ðŸ“ DEBUG showImagePrompts - Insertado en body (fallback)`);
  }
  
  // AnimaciÃ³n de apariciÃ³n
  container.style.opacity = '0';
  container.style.transform = 'translateY(20px)';
  
  setTimeout(() => {
    container.style.transition = 'all 0.5s ease';
    container.style.opacity = '1';
    container.style.transform = 'translateY(0)';
    console.log(`âœ¨ DEBUG showImagePrompts - AnimaciÃ³n aplicada`);
  }, 100);
  
  console.log(`âœ… DEBUG showImagePrompts - FunciÃ³n completada exitosamente`);
}

// Event listener para controlar la casilla de audio segÃºn la generaciÃ³n automÃ¡tica
document.addEventListener('DOMContentLoaded', function() {
  console.log('ðŸš€ DOM completamente cargado');
  
  // Limpiar cualquier contenedor de prompts visuales residual
  const existingPromptsContainer = document.getElementById('image-prompts-display');
  if (existingPromptsContainer) {
    existingPromptsContainer.remove();
    console.log('ðŸ—‘ï¸ Contenedor de prompts visuales residual eliminado');
  }
  
  // Verificar localStorage inmediatamente
  const savedStyles = localStorage.getItem('customScriptStyles');
  console.log('ðŸ” VERIFICACIÃ“N DIRECTA localStorage:', savedStyles);
  
  const autoGenerateAudioCheckbox = document.getElementById('autoGenerateAudio');
  const autoAudioContainer = document.querySelector('.auto-audio-container');
  
  // Verificar si los elementos de audio existen y habilitarlos ya que la generaciÃ³n automÃ¡tica estÃ¡ siempre activa
  if (autoGenerateAudioCheckbox && autoAudioContainer) {
    // Habilitar la casilla de audio ya que la generaciÃ³n automÃ¡tica estÃ¡ siempre activa
    autoGenerateAudioCheckbox.disabled = false;
    autoAudioContainer.style.opacity = '1';
    console.log('ðŸ”Š Casilla de audio habilitada (generaciÃ³n automÃ¡tica siempre activa)');
  } else {
    console.log('âš ï¸ Algunos elementos de audio no encontrados (diseÃ±o compacto)');
  }
  
  // Inicializar sistema de estilos personalizados
  console.log('ðŸŽ¨ A punto de inicializar estilos...');
  initCustomStyles();
  
  // Inicializar sistema de estilos de miniatura
  console.log('ðŸ–¼ï¸ A punto de inicializar estilos de miniatura...');
  initThumbnailStyles();
  
  // Configurar eventos de botones manualmente como backup
  setTimeout(() => {
    console.log('ðŸ”§ Configurando eventos de botones manualmente...');
    
    const createBtn = document.getElementById('createStyleBtn');
    const manageBtn = document.getElementById('manageStylesBtn');
    
    if (createBtn) {
      createBtn.addEventListener('click', function() {
        console.log('ðŸŽ¨ BotÃ³n crear estilo clickeado');
        openStyleModal();
      });
      console.log('âœ… Event listener del botÃ³n crear configurado');
    } else {
      console.error('âŒ BotÃ³n crear estilo no encontrado');
    }
    
    if (manageBtn) {
      manageBtn.addEventListener('click', function() {
        console.log('ðŸ”§ BotÃ³n gestionar estilos clickeado');
        openManageStylesModal();
      });
      console.log('âœ… Event listener del botÃ³n gestionar configurado');
    } else {
      console.error('âŒ BotÃ³n gestionar estilos no encontrado');
    }
    
    // Configurar eventos de botones de miniatura
    const createThumbnailBtn = document.getElementById('createThumbnailStyleFromSidebar');
    const manageThumbnailBtn = document.getElementById('manageThumbnailStylesFromSidebar');
    
    if (createThumbnailBtn) {
      createThumbnailBtn.addEventListener('click', function() {
        console.log('ðŸ–¼ï¸ BotÃ³n crear estilo de miniatura clickeado');
        openThumbnailStyleModal();
      });
      console.log('âœ… Event listener del botÃ³n crear miniatura configurado');
    } else {
      console.error('âŒ BotÃ³n crear estilo de miniatura no encontrado');
    }
    
    if (manageThumbnailBtn) {
      manageThumbnailBtn.addEventListener('click', function() {
        console.log('ðŸ”§ BotÃ³n gestionar estilos de miniatura clickeado desde backup manual');
        try {
          openManageThumbnailStylesModal();
        } catch (error) {
          console.error('âŒ Error ejecutando openManageThumbnailStylesModal:', error);
        }
      });
      console.log('âœ… Event listener del botÃ³n gestionar miniatura configurado (backup manual)');
      
      // TambiÃ©n agregar onclick como backup adicional
      manageThumbnailBtn.onclick = function() {
        console.log('ðŸ”„ Onclick backup del botÃ³n gestionar activado');
        try {
          openManageThumbnailStylesModal();
        } catch (error) {
          console.error('âŒ Error en onclick backup:', error);
        }
      };
    } else {
      console.error('âŒ BotÃ³n gestionar estilos de miniatura no encontrado');
    }
    
    // Configurar eventos de botones de modal como backup
    setTimeout(() => {
      console.log('ðŸ”„ Configurando eventos de modal como backup...');
      const saveBtn = document.getElementById('saveThumbnailStyleBtn');
      if (saveBtn && !saveBtn.onclick) {
        saveBtn.onclick = function() {
          console.log('ðŸ”„ Backup directo del botÃ³n guardar activado');
          saveThumbnailStyle();
        };
        console.log('âœ… Backup de botÃ³n guardar configurado');
      }
    }, 1000);
  }, 500);
  
  // Verificar el selector despuÃ©s de la inicializaciÃ³n
  setTimeout(() => {
    const styleSelect = document.getElementById('styleSelect');
    console.log('ðŸ” Opciones en el selector despuÃ©s de inicializar:', styleSelect?.innerHTML);
    console.log('ðŸ” NÃºmero de opciones:', styleSelect?.options?.length);
  }, 1000);
});

// Sistema de Estilos Personalizados
let customStyles = [];

// Cargar estilos personalizados del localStorage
function loadCustomStyles() {
  console.log('ðŸ” Iniciando carga de estilos personalizados...');
  const saved = localStorage.getItem('customScriptStyles');
  console.log('ðŸ” Datos en localStorage:', saved);
  
  if (saved) {
    try {
      customStyles = JSON.parse(saved);
      console.log(`ðŸ“ Cargados ${customStyles.length} estilos personalizados:`, customStyles);
    } catch (error) {
      console.error('âŒ Error cargando estilos:', error);
      customStyles = [];
    }
  } else {
    console.log('ðŸ“ No hay estilos personalizados guardados');
    customStyles = [];
  }
}

// Guardar estilos en localStorage
function saveCustomStyles() {
  localStorage.setItem('customScriptStyles', JSON.stringify(customStyles));
  console.log(`ðŸ’¾ Guardados ${customStyles.length} estilos personalizados`);
}

// Inicializar sistema de estilos
function initCustomStyles() {
  console.log('ðŸŽ¨ Inicializando sistema de estilos personalizados...');
  loadCustomStyles();
  updateStyleSelector();
  
  // Configurar eventos con un retraso para asegurar que el DOM estÃ© listo
  setTimeout(() => {
    setupStyleModalEvents();
    setupManageStylesEvents();
    setupEditStyleEvents();
    
    // Configurar especÃ­ficamente los botones del sidebar
    setupSidebarStyleButtons();
    
    console.log('âœ… Sistema de estilos inicializado correctamente');
  }, 100);
}

// Configurar botones del sidebar para estilos
function setupSidebarStyleButtons() {
  console.log('ðŸ”§ Configurando botones del sidebar para estilos...');
  
  const createFromSidebarBtn = document.getElementById('createStyleFromSidebar');
  if (createFromSidebarBtn) {
    // Remover event listeners previos
    const newBtn = createFromSidebarBtn.cloneNode(true);
    createFromSidebarBtn.parentNode.replaceChild(newBtn, createFromSidebarBtn);
    
    newBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('ðŸŽ¨ BotÃ³n crear estilo clickeado desde sidebar');
      openCreateStyleFromSidebar();
    });
    console.log('âœ… Event listener del botÃ³n crear desde barra lateral configurado');
  } else {
    console.error('âŒ No se encontrÃ³ createStyleFromSidebar');
  }
  
  const manageFromSidebarBtn = document.getElementById('manageStylesFromSidebar');
  if (manageFromSidebarBtn) {
    // Remover event listeners previos
    const newBtn = manageFromSidebarBtn.cloneNode(true);
    manageFromSidebarBtn.parentNode.replaceChild(newBtn, manageFromSidebarBtn);
    
    newBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('ðŸ”§ BotÃ³n gestionar estilos clickeado desde sidebar');
      openManageStylesFromSidebar();
    });
    console.log('âœ… Event listener del botÃ³n gestionar desde barra lateral configurado');
  } else {
    console.error('âŒ No se encontrÃ³ manageStylesFromSidebar');
  }
}

// FunciÃ³n para abrir modal de crear estilo
function openStyleModal() {
  console.log('ðŸŽ¨ Abriendo modal de crear estilo...');
  const styleModal = document.getElementById('styleModal');
  if (styleModal) {
    styleModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    console.log('âœ… Modal de crear estilo abierto');
  } else {
    console.error('âŒ Modal de crear estilo no encontrado');
  }
}

// FunciÃ³n para cerrar modal de crear estilo
function closeStyleModal() {
  console.log('ðŸŽ¨ Cerrando modal de crear estilo...');
  const styleModal = document.getElementById('styleModal');
  if (styleModal) {
    styleModal.style.display = 'none';
    document.body.style.overflow = 'auto';
    clearModalForm();
    console.log('âœ… Modal de crear estilo cerrado');
  }
}

// Configurar eventos del modal
function setupStyleModalEvents() {
  console.log('ðŸ”§ Configurando eventos del modal de crear estilo...');
  
  const styleModal = document.getElementById('styleModal');
  const closeModalBtn = document.getElementById('closeStyleModal');
  const cancelBtn = document.getElementById('cancelStyleBtn');
  const saveBtn = document.getElementById('saveStyleBtn');
  
  console.log('ðŸ” Elementos encontrados:', {
    styleModal: !!styleModal,
    closeModalBtn: !!closeModalBtn,
    cancelBtn: !!cancelBtn,
    saveBtn: !!saveBtn
  });
  
  if (!styleModal || !closeModalBtn || !cancelBtn || !saveBtn) {
    console.error('âŒ Algunos elementos del modal no fueron encontrados');
    return;
  }
  
  // FunciÃ³n para cerrar modal
  function closeModal() {
    console.log('ðŸŽ¨ Cerrando modal de crear estilo...');
    styleModal.style.display = 'none';
    document.body.style.overflow = 'auto';
    clearModalForm();
  }
  
  // Configurar event listeners
  closeModalBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('ðŸ”˜ BotÃ³n cerrar clickeado');
    closeModal();
  });
  
  cancelBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('ðŸ”˜ BotÃ³n cancelar clickeado');
    closeModal();
  });
  
  // Cerrar modal al hacer clic fuera
  styleModal.addEventListener('click', (e) => {
    if (e.target === styleModal) {
      console.log('ðŸ”˜ Click fuera del modal');
      closeModal();
    }
  });
  
  // Guardar nuevo estilo
  saveBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('ðŸ”˜ BotÃ³n guardar clickeado');
    saveNewStyle();
  });
  
  console.log('âœ… Eventos del modal configurados correctamente');
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
    alert('âŒ El nombre del estilo es requerido');
    return;
  }
  
  if (!instructions) {
    alert('âŒ Las instrucciones para la IA son requeridas');
    return;
  }
  
  // Verificar que no exista un estilo con el mismo nombre
  if (customStyles.find(style => style.name.toLowerCase() === name.toLowerCase())) {
    alert('âŒ Ya existe un estilo con ese nombre');
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
  
  // Mostrar confirmaciÃ³n
  alert(`âœ… Estilo "${name}" creado exitosamente!`);
  
  console.log(`ðŸŽ¨ Nuevo estilo creado: ${name}`);
}

// Actualizar el selector de estilos
function updateStyleSelector() {
  console.log('ðŸ”„ Iniciando actualizaciÃ³n del selector...');
  
  const styleSelect = document.getElementById('styleSelect');
  if (!styleSelect) {
    console.error('âŒ No se encontrÃ³ el elemento styleSelect');
    return;
  }
  
  // Guardar el valor actualmente seleccionado
  const currentValue = styleSelect.value;
  console.log('ðŸ’¾ Valor actual seleccionado:', currentValue);
  
  // Limpiar y recrear todas las opciones
  styleSelect.innerHTML = '';
  console.log('ðŸ§¹ Selector limpiado');
  
  // Agregar opciones predeterminadas
  const professionalOption = document.createElement('option');
  professionalOption.value = 'professional';
  professionalOption.textContent = 'Profesional';
  styleSelect.appendChild(professionalOption);
  
  const comedyOption = document.createElement('option');
  comedyOption.value = 'comedy';
  comedyOption.textContent = 'CÃ³mico';
  styleSelect.appendChild(comedyOption);
  
  console.log('âœ… Opciones predeterminadas agregadas');
  
  // Verificar customStyles
  console.log('ðŸŽ¨ customStyles disponibles:', customStyles);
  console.log('ðŸ“Š NÃºmero de estilos personalizados:', customStyles.length);
  
  // Agregar estilos personalizados
  customStyles.forEach((style, index) => {
    console.log(`ðŸŽ¨ Procesando estilo ${index + 1}:`, style);
    
    const option = document.createElement('option');
    option.value = style.id;
    option.textContent = `${style.name} (Personalizado)`;
    option.title = style.description || '';
    styleSelect.appendChild(option);
    
    console.log(`âœ… Estilo agregado: ${style.name}`);
  });
  
  // Restaurar selecciÃ³n anterior si existe
  if (currentValue && styleSelect.querySelector(`option[value="${currentValue}"]`)) {
    styleSelect.value = currentValue;
    console.log(`ðŸ”„ SelecciÃ³n restaurada: ${currentValue}`);
  } else {
    styleSelect.value = 'professional'; // Default
    console.log('ðŸ”„ SelecciÃ³n por defecto: professional');
  }
  
  console.log(`ðŸŽ¯ Selector actualizado - Total opciones: ${styleSelect.options.length}`);
  console.log('ðŸ” HTML del selector:', styleSelect.innerHTML);
}

// Variables para gestiÃ³n de estilos
let currentEditingStyle = null;

// Configurar eventos del modal de gestiÃ³n de estilos
function setupManageStylesEvents() {
  console.log('ðŸ”§ Configurando eventos del modal de gestionar estilos...');
  
  const manageModal = document.getElementById('manageStylesModal');
  const closeManageBtn = document.getElementById('closeManageStylesModal');
  const closeManageBtnFooter = document.getElementById('closeManageStylesBtn');
  
  console.log('ðŸ” Elementos encontrados:', {
    manageModal: !!manageModal,
    closeManageBtn: !!closeManageBtn,
    closeManageBtnFooter: !!closeManageBtnFooter
  });
  
  if (!manageModal || !closeManageBtn || !closeManageBtnFooter) {
    console.error('âŒ Algunos elementos del modal de gestionar no fueron encontrados');
    return;
  }
  
  // FunciÃ³n para cerrar modal
  function closeModal() {
    console.log('ðŸ”§ Cerrando modal de gestionar estilos...');
    manageModal.style.display = 'none';
    document.body.style.overflow = 'auto';
  }
  
  // Configurar event listeners
  closeManageBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('ðŸ”˜ BotÃ³n cerrar (X) clickeado');
    closeModal();
  });
  
  closeManageBtnFooter.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('ðŸ”˜ BotÃ³n cerrar footer clickeado');
    closeModal();
  });
  
  // Cerrar modal al hacer clic fuera
  manageModal.addEventListener('click', (e) => {
    if (e.target === manageModal) {
      console.log('ðŸ”˜ Click fuera del modal de gestionar');
      closeModal();
    }
  });
  
  console.log('âœ… Eventos del modal de gestionar configurados correctamente');
}

// Configurar eventos del modal de ediciÃ³n de estilos
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

// Abrir modal de gestiÃ³n de estilos
function openManageStylesModal() {
  const manageModal = document.getElementById('manageStylesModal');
  manageModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  renderStylesList();
}

// Cerrar modal de gestiÃ³n de estilos
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
          <div class="style-item-description">${escapeHtml(style.description || 'Sin descripciÃ³n')}</div>
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

// FunciÃ³n para escapar HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Editar estilo
function editStyle(styleId) {
  const style = customStyles.find(s => s.id === styleId);
  if (!style) {
    alert('âŒ Estilo no encontrado');
    return;
  }
  
  currentEditingStyle = style;
  
  // Llenar formulario de ediciÃ³n
  document.getElementById('editStyleName').value = style.name;
  document.getElementById('editStyleDescription').value = style.description || '';
  document.getElementById('editStyleInstructions').value = style.instructions;
  
  // Cerrar modal de gestiÃ³n y abrir modal de ediciÃ³n
  closeManageStylesModal();
  
  const editModal = document.getElementById('editStyleModal');
  editModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

// Cerrar modal de ediciÃ³n
function closeEditStyleModal() {
  const editModal = document.getElementById('editStyleModal');
  editModal.style.display = 'none';
  document.body.style.overflow = 'auto';
  currentEditingStyle = null;
  clearEditModalForm();
}

// Limpiar formulario de ediciÃ³n
function clearEditModalForm() {
  document.getElementById('editStyleName').value = '';
  document.getElementById('editStyleDescription').value = '';
  document.getElementById('editStyleInstructions').value = '';
}

// Guardar estilo editado
function saveEditedStyle() {
  if (!currentEditingStyle) {
    alert('âŒ Error: No hay estilo seleccionado para editar');
    return;
  }
  
  const name = document.getElementById('editStyleName').value.trim();
  const description = document.getElementById('editStyleDescription').value.trim();
  const instructions = document.getElementById('editStyleInstructions').value.trim();
  
  // Validaciones
  if (!name) {
    alert('âŒ El nombre del estilo es requerido');
    return;
  }
  
  if (!instructions) {
    alert('âŒ Las instrucciones para la IA son requeridas');
    return;
  }
  
  // Verificar que no exista otro estilo con el mismo nombre
  const existingStyle = customStyles.find(style => 
    style.name.toLowerCase() === name.toLowerCase() && style.id !== currentEditingStyle.id
  );
  
  if (existingStyle) {
    alert('âŒ Ya existe un estilo con ese nombre');
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
    
    // Mostrar confirmaciÃ³n
    alert(`âœ… Estilo "${name}" actualizado exitosamente!`);
    
    console.log(`ðŸŽ¨ Estilo editado: ${name}`);
  }
}

// Eliminar estilo
function deleteStyle(styleId) {
  const style = customStyles.find(s => s.id === styleId);
  if (!style) {
    alert('âŒ Estilo no encontrado');
    return;
  }
  
  // Confirmar eliminaciÃ³n
  if (!confirm(`Â¿EstÃ¡s seguro de que quieres eliminar el estilo "${style.name}"?\n\nEsta acciÃ³n no se puede deshacer.`)) {
    return;
  }
  
  // Eliminar del array
  customStyles = customStyles.filter(s => s.id !== styleId);
  
  // Guardar en localStorage
  saveCustomStyles();
  
  // Actualizar selector
  updateStyleSelector();
  
  // Actualizar lista de estilos si el modal estÃ¡ abierto
  const manageModal = document.getElementById('manageStylesModal');
  if (manageModal.style.display === 'flex') {
    renderStylesList();
  }
  
  // Mostrar confirmaciÃ³n
  alert(`âœ… Estilo "${style.name}" eliminado exitosamente!`);
  
  console.log(`ðŸ—‘ï¸ Estilo eliminado: ${style.name}`);
}

// FunciÃ³n de prueba para crear un estilo desde la consola
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
  
  console.log('âœ… Estilo de prueba creado:', testStyle);
  return testStyle;
}

// FunciÃ³n de debug para mostrar estado actual
function debugStyles() {
  console.log('ðŸ” Estado actual de estilos:');
  console.log('ðŸ“¦ customStyles array:', customStyles);
  console.log('ðŸ’¾ localStorage:', localStorage.getItem('customScriptStyles'));
  
  const styleSelect = document.getElementById('styleSelect');
  console.log('ðŸŽ¯ Selector HTML:', styleSelect.innerHTML);
  console.log('ðŸ“Š NÃºmero de opciones:', styleSelect.options.length);
  
  return {
    customStyles,
    localStorage: localStorage.getItem('customScriptStyles'),
    selectorHTML: styleSelect.innerHTML,
    optionsCount: styleSelect.options.length
  };
}

// Funciones para la barra lateral colapsable
function toggleSidebar() {
  console.log('ðŸ”„ toggleSidebar() ejecutada');
  
  const sidebar = document.getElementById('sidebar');
  const body = document.body;
  
  console.log('ðŸ” sidebar element:', sidebar);
  console.log('ðŸ” body element:', body);
  
  if (sidebar && body) {
    const wasExpanded = sidebar.classList.contains('expanded');
    
    sidebar.classList.toggle('expanded');
    body.classList.toggle('sidebar-expanded');
    
    const isExpanded = sidebar.classList.contains('expanded');
    console.log(`ðŸŽ¯ Barra lateral cambiÃ³ de ${wasExpanded ? 'expandida' : 'colapsada'} a ${isExpanded ? 'expandida' : 'colapsada'}`);
    console.log('ðŸ” Clases del sidebar:', sidebar.className);
    console.log('ðŸ” Clases del body:', body.className);
  } else {
    console.error('âŒ No se encontrÃ³ el sidebar o el body');
    console.error('sidebar:', sidebar);
    console.error('body:', body);
  }
}

// Hacer la funciÃ³n disponible globalmente
window.toggleSidebar = toggleSidebar;

function collapseSidebar() {
  const sidebar = document.getElementById('sidebar');
  const body = document.body;
  
  if (sidebar && body) {
    sidebar.classList.remove('expanded');
    body.classList.remove('sidebar-expanded');
    console.log('ðŸŽ¯ Barra lateral colapsada');
  }
}

// Funciones para abrir modales desde la barra lateral
function openCreateStyleFromSidebar() {
  openStyleModal(); // Esta funciÃ³n abre el modal de CREAR estilo
  collapseSidebar();
  console.log('ðŸŽ¨ Abriendo modal de crear estilo desde barra lateral');
}

function openManageStylesFromSidebar() {
  openManageStylesModal(); // Esta funciÃ³n abre el modal de GESTIONAR estilos
  collapseSidebar();
  console.log('ðŸ”§ Abriendo modal de gestionar estilos desde barra lateral');
}

// Event listeners para la barra lateral
document.addEventListener('DOMContentLoaded', function() {
  // BotÃ³n de menÃº para expandir/colapsar barra lateral
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.getElementById('sidebar');
  
  console.log('ðŸ” Debug sidebar - menuToggleBtn:', menuToggleBtn);
  console.log('ðŸ” Debug sidebar - sidebar:', sidebar);
  
  if (menuToggleBtn) {
    console.log('âœ… BotÃ³n de menÃº encontrado - onclick configurado en HTML');
  } else {
    console.error('âŒ No se encontrÃ³ el botÃ³n menuToggleBtn');
  }
  
  if (!sidebar) {
    console.error('âŒ No se encontrÃ³ el elemento sidebar');
  }
  
  // Botones de la barra lateral
  const createFromSidebarBtn = document.getElementById('createStyleFromSidebar');
  if (createFromSidebarBtn) {
    createFromSidebarBtn.addEventListener('click', openCreateStyleFromSidebar);
    console.log('âœ… Event listener del botÃ³n crear desde barra lateral configurado');
  }
  
  const manageFromSidebarBtn = document.getElementById('manageStylesFromSidebar');
  if (manageFromSidebarBtn) {
    manageFromSidebarBtn.addEventListener('click', openManageStylesFromSidebar);
    console.log('âœ… Event listener del botÃ³n gestionar desde barra lateral configurado');
  }
  
  // Cerrar barra lateral al hacer clic fuera de ella
  document.addEventListener('click', function(event) {
    const sidebar = document.getElementById('sidebar');
    const isClickInsideSidebar = sidebar && sidebar.contains(event.target);
    
    if (!isClickInsideSidebar && sidebar && sidebar.classList.contains('expanded')) {
      collapseSidebar();
    }
  });
  
  // ConfiguraciÃ³n adicional de eventos del modal como backup
  setTimeout(() => {
    console.log('ðŸ”§ ConfiguraciÃ³n adicional de eventos del modal...');
    
    const closeModalBtn = document.getElementById('closeStyleModal');
    const cancelBtn = document.getElementById('cancelStyleBtn');
    const saveBtn = document.getElementById('saveStyleBtn');
    const styleModal = document.getElementById('styleModal');
    
    if (closeModalBtn && !closeModalBtn.hasEventListener) {
      closeModalBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('ðŸ”˜ [BACKUP] BotÃ³n cerrar clickeado');
        const modal = document.getElementById('styleModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
          clearModalForm();
        }
      });
      closeModalBtn.hasEventListener = true;
      console.log('âœ… Event listener del botÃ³n cerrar configurado (backup)');
    }
    
    if (cancelBtn && !cancelBtn.hasEventListener) {
      cancelBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('ðŸ”˜ [BACKUP] BotÃ³n cancelar clickeado');
        const modal = document.getElementById('styleModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
          clearModalForm();
        }
      });
      cancelBtn.hasEventListener = true;
      console.log('âœ… Event listener del botÃ³n cancelar configurado (backup)');
    }
    
    if (saveBtn && !saveBtn.hasEventListener) {
      saveBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('ðŸ”˜ [BACKUP] BotÃ³n guardar clickeado');
        saveNewStyle();
      });
      saveBtn.hasEventListener = true;
      console.log('âœ… Event listener del botÃ³n guardar configurado (backup)');
    }
    
    // ConfiguraciÃ³n backup para modal de gestionar estilos
    const closeManageBtn = document.getElementById('closeManageStylesModal');
    const closeManageBtnFooter = document.getElementById('closeManageStylesBtn');
    const manageModal = document.getElementById('manageStylesModal');
    
    if (closeManageBtn && !closeManageBtn.hasEventListener) {
      closeManageBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('ðŸ”˜ [BACKUP] BotÃ³n cerrar (X) gestionar clickeado');
        const modal = document.getElementById('manageStylesModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
        }
      });
      closeManageBtn.hasEventListener = true;
      console.log('âœ… Event listener del botÃ³n cerrar (X) gestionar configurado (backup)');
    }
    
    if (closeManageBtnFooter && !closeManageBtnFooter.hasEventListener) {
      closeManageBtnFooter.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('ðŸ”˜ [BACKUP] BotÃ³n cerrar footer gestionar clickeado');
        const modal = document.getElementById('manageStylesModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
        }
      });
      closeManageBtnFooter.hasEventListener = true;
      console.log('âœ… Event listener del botÃ³n cerrar footer gestionar configurado (backup)');
    }
  }, 1000);
});

// ================================
// FUNCIONALIDADES DEL PANEL LATERAL DE PROMPTS
// ================================

// Variable global para almacenar todos los prompts
let allAccumulatedPrompts = [];

// FunciÃ³n para inicializar el panel lateral de prompts
function initializePromptsPanel() {
  console.log('ðŸ” Iniciando inicializaciÃ³n del panel de prompts...');
  
  const promptsSidebar = document.getElementById('promptsSidebar');
  const toggleBtn = document.getElementById('promptsSidebarToggle');
  const headerBtn = document.getElementById('showPromptsPanel');
  
  console.log('promptsSidebar:', !!promptsSidebar);
  console.log('toggleBtn:', !!toggleBtn);
  console.log('headerBtn:', !!headerBtn);
  
  if (!promptsSidebar || !toggleBtn) {
    console.log('âŒ Panel de prompts no encontrado en el DOM');
    return;
  }
  
  // Verificar si ya estÃ¡ inicializado
  if (toggleBtn.hasEventListener) {
    console.log('âš ï¸ Panel ya inicializado, saltando...');
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
  
  // Event listener para el botÃ³n toggle del panel
  const toggleHandler = function() {
    console.log('ðŸ”˜ BotÃ³n toggle del panel clickeado');
    const isActive = promptsSidebar.classList.contains('active');
    console.log('Estado actual antes del toggle:', isActive ? 'activo' : 'inactivo');
    
    if (isActive) {
      // Cerrar panel
      promptsSidebar.classList.remove('active');
      document.body.classList.remove('prompts-panel-active');
      toggleBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
      toggleBtn.title = 'Mostrar panel de prompts';
      
      // Actualizar botÃ³n del header
      if (headerBtn) {
        headerBtn.classList.remove('active');
        headerBtn.innerHTML = '<i class="fas fa-images"></i><span>Prompts</span>';
      }
      console.log('âœ… Panel cerrado');
    } else {
      // Abrir panel
      promptsSidebar.classList.add('active');
      document.body.classList.add('prompts-panel-active');
      toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
      toggleBtn.title = 'Ocultar panel de prompts';
      
      // Actualizar botÃ³n del header
      if (headerBtn) {
        headerBtn.classList.add('active');
        headerBtn.innerHTML = '<i class="fas fa-eye-slash"></i><span>Ocultar</span>';
      }
      console.log('âœ… Panel abierto');
    }
  };
  
  toggleBtn.addEventListener('click', toggleHandler);
  toggleBtn.hasEventListener = true;
  
  // Event listener para el botÃ³n del header
  if (headerBtn && !headerBtn.hasEventListener) {
    const headerHandler = function() {
      console.log('ðŸ”˜ BotÃ³n header clickeado');
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
        console.log('âœ… Panel cerrado desde header');
      } else {
        // Abrir panel
        promptsSidebar.classList.add('active');
        document.body.classList.add('prompts-panel-active');
        toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
        toggleBtn.title = 'Ocultar panel de prompts';
        headerBtn.classList.add('active');
        headerBtn.innerHTML = '<i class="fas fa-eye-slash"></i><span>Ocultar</span>';
        console.log('âœ… Panel abierto desde header');
      }
    };
    
    headerBtn.addEventListener('click', headerHandler);
    headerBtn.hasEventListener = true;
  }
  
  console.log('âœ… Panel lateral de prompts inicializado correctamente');
}

// FunciÃ³n para limpiar el panel lateral de prompts
function clearPromptsSidebar() {
  console.log('ðŸ§¹ Limpiando panel lateral de prompts...');
  
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  
  if (promptsList) {
    // Limpiar todos los prompts existentes
    promptsList.innerHTML = '';
  }
  
  if (emptyState) {
    // Mostrar estado vacÃ­o
    emptyState.style.display = 'block';
  }
  
  // Limpiar array global
  allAccumulatedPrompts = [];
  
  console.log('âœ… Panel lateral limpiado');
}

// FunciÃ³n para aÃ±adir prompts al panel lateral
function addPromptsToSidebar(prompts, sectionNumber) {
  console.log('ðŸ“‹ðŸ“‹ðŸ“‹ INICIO addPromptsToSidebar - ESTA FUNCIÃ“N SE ESTÃ EJECUTANDO ðŸ“‹ðŸ“‹ðŸ“‹');
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    console.log('âŒ No hay prompts vÃ¡lidos para aÃ±adir al panel lateral');
    return;
  }
  
  console.log(`ðŸ“‹ AÃ±adiendo ${prompts.length} prompts de la secciÃ³n ${sectionNumber} al panel lateral`);
  
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  const promptsSidebar = document.getElementById('promptsSidebar');
  
  if (!promptsList || !emptyState || !promptsSidebar) {
    console.log('âŒ Elementos del panel lateral no encontrados');
    return;
  }
  
  // Ocultar el estado vacÃ­o si existe
  if (emptyState.style.display !== 'none') {
    emptyState.style.display = 'none';
  }
  
  // Mostrar automÃ¡ticamente el panel si no estÃ¡ visible
  if (!promptsSidebar.classList.contains('active')) {
    promptsSidebar.classList.add('active');
    document.body.classList.add('prompts-panel-active');
    const toggleBtn = document.getElementById('promptsSidebarToggle');
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
      toggleBtn.title = 'Ocultar panel de prompts';
    }
  }
  
  // AÃ±adir divider si no es la primera secciÃ³n
  if (sectionNumber > 1) {
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.innerHTML = `
      <div class="section-divider-text">
        <i class="fas fa-layer-group"></i>
        SecciÃ³n ${sectionNumber}
      </div>
    `;
    promptsList.appendChild(divider);
  }
  
  // AÃ±adir cada prompt al panel
  prompts.forEach((prompt, index) => {
    // Detectar si el prompt contiene HTML (enlaces de Google Images)
    const isHtmlPrompt = prompt.includes('<a href=') && prompt.includes('target="_blank"');
    const cleanText = isHtmlPrompt ? prompt.replace(/<[^>]*>/g, '').replace(/^ðŸ”—\s*/, '').replace(/^Buscar:\s*"/, '').replace(/"$/, '') : prompt.trim();
    
    // Almacenar en el array global con texto limpio
    allAccumulatedPrompts.push({
      text: cleanText,
      section: sectionNumber,
      imageNumber: index + 1
    });
    
    const promptItem = createPromptItem(prompt, sectionNumber, index + 1, isHtmlPrompt);
    promptsList.appendChild(promptItem);
    
    // AÃ±adir animaciÃ³n de entrada
    setTimeout(() => {
      promptItem.classList.add('new');
    }, index * 100);
  });
  
  // Hacer scroll al Ãºltimo prompt aÃ±adido
  setTimeout(() => {
    const lastPrompt = promptsList.lastElementChild;
    if (lastPrompt) {
      lastPrompt.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 300);
}

// FunciÃ³n para crear enlaces de Google Images
function createGoogleImageLinks(prompts, sectionNumber) {
  console.log('ðŸš€ðŸš€ðŸš€ INICIO createGoogleImageLinks - ESTA FUNCIÃ“N SE ESTÃ EJECUTANDO ðŸš€ðŸš€ðŸš€');
  console.log('ðŸ”— prompts:', prompts);
  console.log('ðŸ”— sectionNumber:', sectionNumber);
  console.log('ðŸ”— prompts.length:', prompts ? prompts.length : 'null');
  console.log('ðŸ”— Array.isArray(prompts):', Array.isArray(prompts));
  
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    console.log('âŒ No hay prompts vÃ¡lidos para crear enlaces de Google Images');
    return;
  }
  
  console.log(`ðŸ”— Creando ${prompts.length} enlaces de Google Images de la secciÃ³n ${sectionNumber}`);
  
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  const promptsSidebar = document.getElementById('promptsSidebar');
  
  if (!promptsList || !emptyState || !promptsSidebar) {
    console.log('âŒ Elementos del panel lateral no encontrados');
    return;
  }
  
  // Ocultar el estado vacÃ­o si existe
  if (emptyState.style.display !== 'none') {
    emptyState.style.display = 'none';
  }
  
  // Mostrar automÃ¡ticamente el panel si no estÃ¡ visible
  if (!promptsSidebar.classList.contains('active')) {
    promptsSidebar.classList.add('active');
    document.body.classList.add('prompts-panel-active');
    const toggleBtn = document.getElementById('promptsSidebarToggle');
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
      toggleBtn.title = 'Ocultar panel de prompts';
    }
  }
  
  // AÃ±adir divider si no es la primera secciÃ³n
  if (sectionNumber > 1) {
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.innerHTML = `
      <div class="section-divider-text">
        <i class="fas fa-layer-group"></i>
        SecciÃ³n ${sectionNumber}
      </div>
    `;
    promptsList.appendChild(divider);
  }
  
  // AÃ±adir cada enlace de Google al panel
  console.log('ðŸ”— Iniciando bucle para crear enlaces...');
  prompts.forEach((prompt, index) => {
    console.log(`ðŸ”— Procesando prompt ${index + 1}: "${prompt}"`);
    
    // Crear el tÃ©rmino de bÃºsqueda limpiando el prompt
    const searchTerm = prompt.trim()
      .replace(/[^\w\s]/g, '') // Remover caracteres especiales
      .replace(/\s+/g, '+'); // Reemplazar espacios con +
    
    const googleUrl = `https://www.google.com/search?q=${searchTerm}&tbm=isch`;
    
    console.log(`ðŸ”— searchTerm: "${searchTerm}"`);
    console.log(`ðŸ”— googleUrl: "${googleUrl}"`);
    
    // Almacenar en el array global (como Google link en lugar de prompt)
    allAccumulatedPrompts.push({
      text: googleUrl,
      section: sectionNumber,
      imageNumber: index + 1,
      isGoogleLink: true,
      originalPrompt: prompt.trim()
    });
    
    const linkItem = createGoogleLinkItem(prompt.trim(), googleUrl, sectionNumber, index + 1);
    console.log(`ðŸ”— linkItem creado:`, !!linkItem);
    promptsList.appendChild(linkItem);
    console.log(`ðŸ”— linkItem aÃ±adido al promptsList`);
    
    // AÃ±adir animaciÃ³n de entrada
    setTimeout(() => {
      linkItem.classList.add('new');
    }, index * 100);
  });
  
  console.log('ðŸ”— Bucle completado');
  
  // Hacer scroll al Ãºltimo enlace aÃ±adido
  setTimeout(() => {
    const lastLink = promptsList.lastElementChild;
    if (lastLink) {
      lastLink.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 300);
  
  console.log('ðŸ”— FIN createGoogleImageLinks');
}

// FunciÃ³n para crear un item de prompt individual
function createPromptItem(promptText, sectionNumber, imageNumber, isHtml = false) {
  const promptItem = document.createElement('div');
  promptItem.className = 'prompt-item';
  
  const header = document.createElement('div');
  header.className = 'prompt-item-header';
  
  const title = document.createElement('div');
  title.className = 'prompt-item-title';
  title.innerHTML = `<i class="fas fa-image"></i> SecciÃ³n ${sectionNumber} - Imagen ${imageNumber}`;
  
  const copyBtn = document.createElement('button');
  copyBtn.className = 'prompt-copy-btn';
  copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
  copyBtn.title = 'Copiar prompt';
  
  // Para HTML, extraer el texto limpio para copiar
  const textToCopy = isHtml ? promptText.replace(/<[^>]*>/g, '').replace(/^ðŸ”—\s*/, '').replace(/^Buscar:\s*"/, '').replace(/"$/, '') : promptText;
  
  // Event listener para copiar
  copyBtn.addEventListener('click', async function(e) {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(textToCopy);
      
      // Cambiar el estilo del botÃ³n temporalmente
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = '<i class="fas fa-check"></i>';
      copyBtn.title = 'Copiado!';
      
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
        copyBtn.title = 'Copiar prompt';
      }, 2000);
      
      console.log('ðŸ“‹ Prompt copiado al portapapeles');
    } catch (err) {
      console.error('âŒ Error al copiar prompt:', err);
      
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
  
  // AÃ±adir botÃ³n de expandir si el texto es largo (usar longitud del texto limpio)
  const textLength = isHtml ? textToCopy.length : promptText.length;
  if (textLength > 150) {
    const expandBtn = document.createElement('button');
    expandBtn.className = 'prompt-expand-btn';
    expandBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Ver mÃ¡s';
    
    expandBtn.addEventListener('click', function() {
      const isExpanded = textElement.classList.contains('expanded');
      
      if (isExpanded) {
        textElement.classList.remove('expanded');
        expandBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Ver mÃ¡s';
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

// FunciÃ³n para crear un item de enlace de Google
function createGoogleLinkItem(originalPrompt, googleUrl, sectionNumber, imageNumber) {
  const linkItem = document.createElement('div');
  linkItem.className = 'prompt-item google-link-item';
  
  const header = document.createElement('div');
  header.className = 'prompt-item-header';
  
  const title = document.createElement('div');
  title.className = 'prompt-item-title';
  title.innerHTML = `<i class="fab fa-google"></i> SecciÃ³n ${sectionNumber} - Imagen ${imageNumber}`;
  
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
    console.log('ðŸ”— Abriendo bÃºsqueda de Google Images:', googleUrl);
  });
  
  // Event listener para copiar el enlace
  copyBtn.addEventListener('click', async function(e) {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(googleUrl);
      
      // Cambiar el estilo del botÃ³n temporalmente
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = '<i class="fas fa-check"></i>';
      copyBtn.title = 'Copiado!';
      
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
        copyBtn.title = 'Copiar enlace';
      }, 2000);
      
      console.log('ðŸ“‹ Enlace de Google copiado al portapapeles');
    } catch (err) {
      console.error('âŒ Error al copiar enlace:', err);
      
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

// FunciÃ³n para limpiar el panel de prompts
function clearPromptsPanel() {
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  
  if (promptsList) {
    promptsList.innerHTML = '';
  }
  
  if (emptyState) {
    emptyState.style.display = 'block';
  }
  
  // Limpiar tambiÃ©n el contenedor de prompts visuales antiguo si existe
  const oldPromptsContainer = document.getElementById('image-prompts-display');
  if (oldPromptsContainer) {
    oldPromptsContainer.remove();
    console.log('ðŸ—‘ï¸ Contenedor de prompts visuales eliminado');
  }
  
  // Limpiar el array global
  allAccumulatedPrompts = [];
  
  console.log('ðŸ§¹ Panel de prompts limpiado');
}

// FunciÃ³n para obtener todos los prompts acumulados
function getAllAccumulatedPrompts() {
  return allAccumulatedPrompts;
}

// FunciÃ³n para exportar todos los prompts como texto
function exportAllPrompts() {
  if (allAccumulatedPrompts.length === 0) {
    console.log('âŒ No hay prompts para exportar');
    return;
  }
  
  let exportText = 'PROMPTS DE IMÃGENES GENERADOS\n';
  exportText += '================================\n\n';
  
  let currentSection = 0;
  
  allAccumulatedPrompts.forEach((prompt, index) => {
    if (prompt.section !== currentSection) {
      currentSection = prompt.section;
      exportText += `SECCIÃ“N ${currentSection}\n`;
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
  
  console.log('ðŸ“„ Prompts exportados como archivo de texto');
}

// Modificar la funciÃ³n showImagePrompts existente para incluir el panel lateral
const originalShowImagePrompts = showImagePrompts;
showImagePrompts = function(prompts, sectionNumber, promptsFileInfo) {
  // Llamar a la funciÃ³n original
  originalShowImagePrompts(prompts, sectionNumber, promptsFileInfo);
  
  // AÃ±adir prompts al panel lateral
  addPromptsToSidebar(prompts, sectionNumber);
};

// Inicializar el panel cuando el DOM estÃ© listo
document.addEventListener('DOMContentLoaded', function() {
  console.log('ðŸŒŸ DOM Content Loaded - Iniciando inicializaciÃ³n del panel de prompts');
  // Esperar un poco para asegurar que todos los elementos estÃ©n cargados
  setTimeout(() => {
    initializePromptsPanel();
  }, 100);
});

// Inicializar tambiÃ©n cuando la ventana estÃ© completamente cargada (backup)
window.addEventListener('load', function() {
  console.log('ðŸŒŸ Window Loaded - Backup de inicializaciÃ³n del panel de prompts');
  setTimeout(() => {
    // Solo inicializar si no se ha hecho antes
    const toggleBtn = document.getElementById('promptsSidebarToggle');
    if (toggleBtn && !toggleBtn.hasEventListener) {
      initializePromptsPanel();
    }
  }, 500);
});

// TambiÃ©n aÃ±adir una inicializaciÃ³n manual como backup adicional
setTimeout(() => {
  console.log('ðŸŒŸ Timeout backup - Verificando inicializaciÃ³n del panel');
  const toggleBtn = document.getElementById('promptsSidebarToggle');
  if (toggleBtn && !toggleBtn.hasEventListener) {
    console.log('ðŸ”„ Ejecutando inicializaciÃ³n de backup');
    initializePromptsPanel();
  }
}, 2000);

// FunciÃ³n de test para verificar el funcionamiento del panel
window.testPromptsPanel = function() {
  console.log('ðŸ§ª TESTING PROMPTS PANEL');
  
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

// Funcionalidad para navegaciÃ³n entre secciones
function initializeSectionNavigation() {
  console.log('ðŸ”§ Inicializando navegaciÃ³n de secciones...');
  
  const prevSectionBtn = document.getElementById('prevSectionBtn');
  const nextSectionBtn = document.getElementById('nextSectionBtn');
  
  console.log('BotÃ³n anterior encontrado:', !!prevSectionBtn);
  console.log('BotÃ³n siguiente encontrado:', !!nextSectionBtn);
  
  if (!prevSectionBtn || !nextSectionBtn) {
    console.log('âŒ Botones de navegaciÃ³n de secciones no encontrados');
    return;
  }
  
  // Remover event listeners anteriores si existen
  prevSectionBtn.replaceWith(prevSectionBtn.cloneNode(true));
  nextSectionBtn.replaceWith(nextSectionBtn.cloneNode(true));
  
  // Obtener referencias nuevas despuÃ©s del clonado
  const newPrevBtn = document.getElementById('prevSectionBtn');
  const newNextBtn = document.getElementById('nextSectionBtn');
  
  // FunciÃ³n para ir a la secciÃ³n anterior
  newPrevBtn.addEventListener('click', function() {
    console.log(`ðŸ”„ CLICK ANTERIOR - Actual: ${currentSectionNumber}, Total secciones: ${allSections.length}`);
    console.log('Secciones disponibles:', allSections.map((s, i) => s ? `${i+1}: âœ…` : `${i+1}: âŒ`).join(', '));
    
    if (currentSectionNumber > 1) {
      console.log(`âœ… Navegando a secciÃ³n ${currentSectionNumber - 1}`);
      showStoredSection(currentSectionNumber - 1);
    } else {
      console.log('âŒ Ya estÃ¡s en la primera secciÃ³n');
    }
  });
  
  // FunciÃ³n para ir a la secciÃ³n siguiente
  newNextBtn.addEventListener('click', function() {
    console.log(`ðŸ”„ CLICK SIGUIENTE - Actual: ${currentSectionNumber}, Total secciones: ${allSections.length}`);
    console.log('Secciones disponibles:', allSections.map((s, i) => s ? `${i+1}: âœ…` : `${i+1}: âŒ`).join(', '));
    
    if (currentSectionNumber < allSections.length) {
      console.log(`âœ… Navegando a secciÃ³n ${currentSectionNumber + 1}`);
      showStoredSection(currentSectionNumber + 1);
    } else {
      console.log('âŒ Ya estÃ¡s en la Ãºltima secciÃ³n');
    }
  });
  
  console.log('âœ… Event listeners agregados correctamente');
  console.log('âœ… NavegaciÃ³n de secciones inicializada');
}

// FunciÃ³n para mostrar una secciÃ³n almacenada
function showStoredSection(sectionNum) {
  console.log(`ðŸ” Intentando mostrar secciÃ³n ${sectionNum}`);
  console.log(`Total secciones almacenadas: ${allSections.length}`);
  console.log(`Contenido de secciÃ³n ${sectionNum}:`, allSections[sectionNum - 1] ? 'Disponible' : 'No disponible');
  
  if (!allSections[sectionNum - 1]) {
    console.log(`âŒ SecciÃ³n ${sectionNum} no disponible`);
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
    console.log('âŒ Elementos DOM no encontrados');
    return;
  }
  
  // Actualizar nÃºmero de secciÃ³n actual
  currentSectionNumber = sectionNum;
  currentScript = script;
  
  // Actualizar tÃ­tulos y contadores
  sectionTitle.textContent = `SecciÃ³n ${sectionNum}`;
  currentSectionSpan.textContent = sectionNum;
  
  // Actualizar tÃ­tulo del capÃ­tulo especÃ­fico de esta secciÃ³n
  if (chapterTitle) {
    const chapterTitleContainer = document.getElementById('chapter-title-container');
    const chapterTitleSpan = document.getElementById('chapter-title');
    if (chapterTitleContainer && chapterTitleSpan) {
      chapterTitleSpan.textContent = chapterTitle.trim();
      chapterTitleContainer.style.display = 'block';
    }
  } else {
    // Si no hay tÃ­tulo especÃ­fico, usar la funciÃ³n general
    updateChapterTitle(sectionNum);
  }
  
  // Actualizar informaciÃ³n de tokens especÃ­fica de esta secciÃ³n
  updateTokenUsage(tokenUsage);
  
  // Mostrar el contenido del script
  const scriptHTML = `
    <div class="script-container">
      <div class="script-actions">
        <button class="copy-script-btn" onclick="copyScriptText()" title="Copiar texto del guiÃ³n">
          <i class="fas fa-copy"></i>
        </button>
        <button class="audio-script-btn" onclick="generateSectionAudioButton()" title="Generar audio del guiÃ³n">
          <i class="fas fa-microphone"></i>
        </button>
      </div>
      <div class="script-text">${script.replace(/\n/g, '<br><br>')}</div>
    </div>`;
  
  scriptContent.innerHTML = scriptHTML;
  
  // Actualizar estado de los botones de navegaciÃ³n
  updateNavigationButtons();
  
  // Restaurar carrusel e imÃ¡genes de esta secciÃ³n
  setTimeout(() => {
    if (sectionImages && sectionImages.length > 0) {
      console.log(`ðŸŽ  Restaurando carrusel para secciÃ³n ${sectionNum} con ${sectionImages.length} imÃ¡genes (modo: ${sectionImageMode})`);
      
      // Restaurar keywords globales si es Bing
      if (sectionImageMode === 'bing' && sectionImageKeywords) {
        currentImageKeywords = sectionImageKeywords;
        console.log(`ðŸŽ¯ Keywords restauradas para secciÃ³n ${sectionNum}:`, currentImageKeywords);
      }
      
      // Crear carrusel con las imÃ¡genes de esta secciÃ³n
      if (sectionImageMode === 'bing') {
        createCarousel(sectionImages, sectionNum, []);
      } else if (sectionImageMode === 'ai') {
        createCarousel(sectionImages, sectionNum, sectionImagePrompts || []);
      }
    } else if (sectionImagePrompts && sectionImagePrompts.length > 0 && sectionImageMode === 'prompts') {
      // Solo prompts (sin carrusel)
      console.log(`ðŸ“‹ Restaurando prompts para secciÃ³n ${sectionNum}`);
      document.getElementById("carousel-container").style.display = "none";
      addPromptsToSidebar(sectionImagePrompts, sectionNum);
    } else {
      // Sin imÃ¡genes en memoria - intentar cargar desde el servidor si hay un proyecto cargado
      if (window.currentProject) {
        console.log(`ðŸ”„ Intentando cargar imÃ¡genes desde servidor para secciÃ³n ${sectionNum}...`);
        loadSectionImages(sectionNum);
      } else {
        console.log(`âŒ Sin imÃ¡genes para secciÃ³n ${sectionNum} - ocultando carrusel`);
        document.getElementById("carousel-container").style.display = "none";
      }
    }
  }, 100);
  
  // AnimaciÃ³n suave
  scriptContent.style.opacity = "0";
  setTimeout(() => {
    scriptContent.style.transition = "opacity 0.5s ease";
    scriptContent.style.opacity = "1";
  }, 50);
  
  console.log(`ðŸ“„ Mostrando secciÃ³n ${sectionNum} almacenada`);
}

// FunciÃ³n para actualizar el estado de los botones de navegaciÃ³n
function updateNavigationButtons() {
  const prevSectionBtn = document.getElementById('prevSectionBtn');
  const nextSectionBtn = document.getElementById('nextSectionBtn');
  
  if (!prevSectionBtn || !nextSectionBtn) {
    // Si los botones no existen aÃºn, programar un retry
    setTimeout(updateNavigationButtons, 100);
    return;
  }
  
  // BotÃ³n anterior: deshabilitado si estamos en la primera secciÃ³n
  if (currentSectionNumber <= 1) {
    prevSectionBtn.disabled = true;
  } else {
    prevSectionBtn.disabled = false;
  }
  
  // BotÃ³n siguiente: deshabilitado si estamos en la Ãºltima secciÃ³n o no hay mÃ¡s secciones
  if (currentSectionNumber >= allSections.length) {
    nextSectionBtn.disabled = true;
  } else {
    nextSectionBtn.disabled = false;
  }
  
  console.log(`ðŸ”„ Botones actualizados - SecciÃ³n ${currentSectionNumber}/${allSections.length}`);
}

// Inicializar navegaciÃ³n cuando el DOM estÃ© listo
document.addEventListener('DOMContentLoaded', function() {
  initializeSectionNavigation();
});

// Manejar selecciÃ³n exclusiva de opciones de audio
document.addEventListener('DOMContentLoaded', function() {
  const autoGenerateAudio = document.getElementById('autoGenerateAudio');
  const autoGenerateApplioAudio = document.getElementById('autoGenerateApplioAudio');
  
  if (autoGenerateAudio && autoGenerateApplioAudio) {
    // Cuando se selecciona Google Audio, deseleccionar Applio
    autoGenerateAudio.addEventListener('change', function() {
      if (this.checked) {
        autoGenerateApplioAudio.checked = false;
        console.log('ðŸ”Š Audio Google seleccionado, Applio desactivado');
      }
    });
    
    // Cuando se selecciona Applio Audio, deseleccionar Google
    autoGenerateApplioAudio.addEventListener('change', function() {
      if (this.checked) {
        autoGenerateAudio.checked = false;
        console.log('ðŸŽ¤ Audio Applio seleccionado, Google desactivado');
      }
    });
    
    console.log('âœ… Event listeners de audio configurados - selecciÃ³n exclusiva activada');
  }
});

// ========================================
// FUNCIONALIDAD DE EXTRACCIÃ“N DE TEXTO
// ========================================

// FunciÃ³n para mostrar notificaciones
function showNotification(message, type = 'info') {
  console.log(`ðŸ“¢ NotificaciÃ³n [${type.toUpperCase()}]:`, message);
  
  // Crear elemento de notificaciÃ³n
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
  
  // Estilos segÃºn el tipo
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
  
  // Remover despuÃ©s de 4 segundos
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
    console.log('âš ï¸ Extractor ya inicializado, omitiendo...');
    return;
  }
  
  console.log('ðŸŽ¤ Inicializando extractor de texto...');
  
  // Elementos del DOM
  const extractTextBtn = document.getElementById('extractTextBtn');
  const extractTextModal = document.getElementById('extractTextModal');
  const closeExtractModal = document.getElementById('closeExtractModal');
  
  console.log('ðŸ” Verificando elementos:', {
    extractTextBtn: !!extractTextBtn,
    extractTextModal: !!extractTextModal,
    closeExtractModal: !!closeExtractModal
  });
  
  if (!extractTextBtn) {
    console.error('âŒ BotÃ³n extractTextBtn no encontrado');
    return;
  }
  
  if (!extractTextModal) {
    console.error('âŒ Modal extractTextModal no encontrado');
    return;
  }
  
  console.log('âœ… Elementos principales encontrados, configurando eventos...');
  
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
    
    // Nuevos elementos para configuraciÃ³n
    transcriptionMethod: document.getElementById('transcriptionMethod'),
    localConfig: document.getElementById('localConfig'),
    whisperModel: document.getElementById('whisperModel'),
    audioLanguage: document.getElementById('audioLanguage'),
    localModelStatus: document.getElementById('localModelStatus')
  };
  
  console.log('ðŸ” VerificaciÃ³n detallada de elementos:', elements);
  
  // Verificar cada elemento
  Object.keys(elements).forEach(key => {
    if (!elements[key]) {
      console.error(`âŒ Elemento faltante: ${key}`);
    } else {
      console.log(`âœ… Elemento encontrado: ${key}`);
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
    console.log('ðŸ”§ Click en botÃ³n extraer texto detectado');
    extractTextModal.style.display = 'flex';
    console.log('ðŸ“‚ Modal de extracciÃ³n abierto');
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
    console.log('ðŸŽ¯ Configurando drag & drop en dropzone...');
    showNotification('ðŸŽ¯ Drag & Drop configurado correctamente', 'success');
    
    extractDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      extractDropzone.classList.add('dragover');
      console.log('ðŸ“¥ Archivo siendo arrastrado sobre la zona...');
      showNotification('ðŸ“¥ Archivo detectado - suelta aquÃ­', 'info');
    });
    
    extractDropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      extractDropzone.classList.remove('dragover');
      console.log('ðŸ“¤ Archivo saliÃ³ de la zona de arrastre...');
    });
    
    extractDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      extractDropzone.classList.remove('dragover');
      console.log('ðŸŽ¯ Archivo soltado en la zona!');
      showNotification('ðŸŽ¯ Archivo recibido - procesando...', 'success');
      
      const files = e.dataTransfer.files;
      console.log('ðŸ“ Archivos detectados:', files.length);
      
      if (files.length > 0) {
        console.log('ðŸ“„ Procesando archivo:', files[0].name, files[0].type);
        handleFileSelection(files[0]);
      } else {
        console.warn('âš ï¸ No se detectaron archivos en el drop');
        showNotification('âš ï¸ No se detectaron archivos', 'warning');
      }
    });
    
    // Click para seleccionar archivo
    extractDropzone.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('ðŸ–±ï¸ Click en dropzone detectado');
      showNotification('ðŸ–±ï¸ Abriendo selector de archivos...', 'info');
      if (extractFileInput) {
        extractFileInput.click();
        console.log('ðŸ“‚ Abriendo selector de archivos...');
      } else {
        console.error('âŒ Input de archivo no encontrado');
        showNotification('âŒ Error: Input de archivo no encontrado', 'error');
      }
    });
  } else {
    console.error('âŒ Dropzone no encontrado');
    showNotification('âŒ Error: Zona de arrastre no encontrada', 'error');
  }
  
  if (extractFileInput) {
    console.log('ðŸ“ Configurando input de archivo...');
    extractFileInput.addEventListener('change', (e) => {
      console.log('ðŸ“„ Archivo seleccionado via input:', e.target.files.length);
      showNotification('ðŸ“„ Archivo seleccionado - procesando...', 'info');
      if (e.target.files.length > 0) {
        console.log('ðŸ“‹ Procesando archivo seleccionado:', e.target.files[0].name);
        handleFileSelection(e.target.files[0]);
      }
    });
  } else {
    console.error('âŒ Input de archivo no encontrado');
    showNotification('âŒ Error: Input de archivo no encontrado', 'error');
  }
  
  // BotÃ³n transcribir
  if (extractTranscribeBtn) {
    extractTranscribeBtn.addEventListener('click', () => {
      startTranscription();
    });
  }
  
  // Botones de acciones
  if (copyExtractedText) {
    copyExtractedText.addEventListener('click', () => {
      navigator.clipboard.writeText(extractedText).then(() => {
        showNotification('âœ… Texto copiado al portapapeles');
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
        showNotification('âœ… Texto insertado como tema principal');
        promptInput.focus();
      }
    });
  }
  
  // === NUEVOS EVENT LISTENERS PARA CONFIGURACIÃ“N ===
  
  // Cambio de mÃ©todo de transcripciÃ³n
  const transcriptionMethod = elements.transcriptionMethod;
  const localConfig = elements.localConfig;
  
  if (transcriptionMethod) {
    transcriptionMethod.addEventListener('change', (e) => {
      const method = e.target.value;
      console.log(`ðŸ”§ MÃ©todo de transcripciÃ³n cambiado a: ${method}`);
      
      if (method === 'local') {
        localConfig.style.display = 'block';
        checkLocalModelStatus();
        showNotification('ðŸš€ Modo local activado - usando GPU', 'info');
      } else {
        localConfig.style.display = 'none';
        showNotification('ðŸŒ Modo API activado - usando OpenAI', 'info');
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
  
  console.log('âœ… Extractor de texto inicializado correctamente');
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
        âœ… GPU: ${info.gpu_name} | 
        Modelo ${info.is_loaded ? 'cargado' : 'disponible'}: ${info.model_size || 'ninguno'}
      `;
      localModelStatus.style.background = 'rgba(16, 185, 129, 0.15)';
      localModelStatus.style.color = '#00ff7f';
    } else {
      localModelStatus.innerHTML = '<i class="fas fa-desktop"></i> âš ï¸ CPU disponible (sin GPU)';
      localModelStatus.style.background = 'rgba(245, 158, 11, 0.15)';
      localModelStatus.style.color = '#fbbf24';
    }
    
  } catch (error) {
    console.error('Error verificando estado local:', error);
    localModelStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i> âŒ Error verificando modelo local';
    localModelStatus.style.background = 'rgba(239, 68, 68, 0.15)';
    localModelStatus.style.color = '#fca5a5';
  }
}

async function handleFileSelection(file) {
  console.log('ðŸ“ === INICIANDO PROCESAMIENTO DE ARCHIVO ===');
  console.log('ðŸ“„ Archivo seleccionado:', file.name);
  console.log('ðŸ“Š TamaÃ±o:', (file.size / 1024 / 1024).toFixed(2), 'MB');
  console.log('ðŸ·ï¸ Tipo MIME:', file.type);
  
  // Verificar tamaÃ±o del archivo
  const fileSizeMB = file.size / 1024 / 1024;
  if (fileSizeMB > 4000) { // 4GB
    showNotification('âš ï¸ Archivo muy grande (>4GB). Esto puede tomar mucho tiempo.', 'warning');
  } else if (fileSizeMB > 1000) { // 1GB
    showNotification('ðŸ“Š Archivo grande detectado. La subida puede tardar unos minutos...', 'info');
  }
  
  // Validar tipo de archivo
  const validTypes = ['audio/mp3', 'audio/wav', 'audio/mpeg', 'audio/m4a', 'video/mp4'];
  const validExtensions = ['.mp3', '.wav', '.m4a', '.mp4'];
  
  const isValidType = validTypes.includes(file.type) || 
                     validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
  
  console.log('âœ… ValidaciÃ³n de tipo:', {
    mimeTypeValid: validTypes.includes(file.type),
    extensionValid: validExtensions.some(ext => file.name.toLowerCase().endsWith(ext)),
    overallValid: isValidType
  });
  
  if (!isValidType) {
    console.error('âŒ Formato de archivo no soportado');
    showNotification('âŒ Formato de archivo no soportado. Use MP3, WAV, M4A o MP4', 'error');
    return;
  }
  
  selectedFile = file;
  console.log('ðŸ’¾ Archivo almacenado en selectedFile');
  
  // Mostrar nombre del archivo
  const extractFileName = document.getElementById('extractFileName');
  if (extractFileName) {
    extractFileName.textContent = `ðŸ“ ${file.name}`;
    extractFileName.style.display = 'block';
    console.log('ðŸ“ Nombre de archivo mostrado');
    showNotification(`âœ… Archivo cargado: ${file.name}`, 'success');
  } else {
    console.error('âŒ Elemento extractFileName no encontrado');
    showNotification('âŒ Error: No se pudo mostrar el nombre del archivo', 'error');
  }
  
  // Si es MP4, obtener pistas de audio
  if (file.name.toLowerCase().endsWith('.mp4')) {
    console.log('ðŸŽ¬ Archivo MP4 detectado, cargando pistas de audio...');
    try {
      await loadAudioTracks(file);
    } catch (error) {
      console.error('âŒ Error cargando pistas de audio:', error);
      showNotification('âš ï¸ Error cargando pistas, usando configuraciÃ³n por defecto', 'warning');
      
      // Si falla cargar las pistas, habilitar transcripciÃ³n directamente
      const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
      if (extractTranscribeBtn) {
        extractTranscribeBtn.disabled = false;
        console.log('âœ… BotÃ³n habilitado como fallback');
        showNotification('âœ… Listo para transcribir', 'success');
      }
    }
  } else {
    console.log('ðŸŽµ Archivo de audio detectado, preparando para transcripciÃ³n...');
    // Para archivos de audio, subir archivo y preparar para transcripciÃ³n
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      console.log('ðŸ“¤ Subiendo archivo de audio...');
      showNotification('ðŸ“¤ Subiendo archivo...', 'info');
      
      const uploadResponse = await fetch('/upload-audio', {
        method: 'POST',
        body: formData
      });
      
      if (uploadResponse.ok) {
        const uploadData = await uploadResponse.json();
        selectedFile.serverPath = uploadData.filePath;
        console.log('âœ… Archivo subido correctamente:', uploadData.filePath);
        showNotification('âœ… Archivo subido correctamente', 'success');
      } else {
        const errorData = await uploadResponse.json();
        console.error('âŒ Error subiendo archivo:', errorData);
        showNotification(`âŒ Error subiendo archivo: ${errorData.error}`, 'error');
        return; // Salir si hay error
      }
    } catch (error) {
      console.error('âš ï¸ Error pre-subiendo archivo de audio:', error);
      showNotification(`âŒ Error de conexiÃ³n: ${error.message}`, 'error');
      return; // Salir si hay error
    }
    
    // Ocultar selector de pistas
    const extractAudioTrackContainer = document.getElementById('extractAudioTrackContainer');
    const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
    
    console.log('ðŸŽ›ï¸ Configurando interfaz para archivo de audio...');
    console.log('ðŸ” Elementos encontrados:', {
      extractAudioTrackContainer: !!extractAudioTrackContainer,
      extractTranscribeBtn: !!extractTranscribeBtn
    });
    
    if (extractAudioTrackContainer) {
      extractAudioTrackContainer.style.display = 'none';
      console.log('âœ… Selector de pistas ocultado');
    } else {
      console.error('âŒ extractAudioTrackContainer no encontrado');
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
      console.log('âœ… BotÃ³n de transcripciÃ³n habilitado');
      showNotification('âœ… Listo para transcribir - haz click en "Transcribir Audio"', 'success');
    } else {
      console.error('âŒ extractTranscribeBtn no encontrado');
      showNotification('âŒ Error: BotÃ³n de transcripciÃ³n no encontrado', 'error');
    }
  }
  
  console.log('ðŸ“ === PROCESAMIENTO DE ARCHIVO COMPLETADO ===');
  
  // Forzar actualizaciÃ³n visual
  setTimeout(() => {
    const extractFileName = document.getElementById('extractFileName');
    const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
    
    if (extractFileName && extractFileName.style.display === 'none') {
      console.log('ðŸ”„ Forzando visualizaciÃ³n del nombre del archivo...');
      extractFileName.style.display = 'block';
      extractFileName.style.visibility = 'visible';
    }
    
    if (extractTranscribeBtn && extractTranscribeBtn.disabled) {
      console.log('ðŸ”„ Forzando habilitaciÃ³n del botÃ³n...');
      extractTranscribeBtn.disabled = false;
    }
  }, 100);
}

async function loadAudioTracks(file) {
  console.log('ðŸŽµ Cargando pistas de audio del MP4...');
  
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
    
    // Habilitar transcripciÃ³n cuando se seleccione una pista
    extractAudioTrackSelect.addEventListener('change', () => {
      document.getElementById('extractTranscribeBtn').disabled = !extractAudioTrackSelect.value;
    });
    
  } catch (error) {
    console.error('âŒ Error cargando pistas:', error);
    showNotification('âš ï¸ No se pudieron cargar las pistas de audio. Se usarÃ¡ la pista por defecto.', 'warning');
    document.getElementById('extractAudioTrackContainer').style.display = 'none';
    document.getElementById('extractTranscribeBtn').disabled = false;
  }
}

async function startTranscription() {
  if (!selectedFile) {
    showNotification('âŒ No hay archivo seleccionado', 'error');
    return;
  }
  
  console.log('ðŸŽ¤ Iniciando transcripciÃ³n...');
  
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
  
  console.log(`ðŸ”§ MÃ©todo: ${method} | Modelo: ${modelSize} | Idioma: ${language || 'auto'}`);
  
  // Deshabilitar botÃ³n y mostrar progreso
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
    
    // Determinar endpoint segÃºn el mÃ©todo
    const endpoint = method === 'local' ? '/transcribe-audio-local' : '/transcribe-audio';
    const bodyData = { 
      filePath: filePath,
      audioTrackIndex: audioTrackIndex
    };
    
    // Agregar configuraciones adicionales para mÃ©todo local
    if (method === 'local') {
      bodyData.modelSize = modelSize;
      if (language) {
        bodyData.language = language;
      }
      extractProgressText.textContent = `Transcribiendo con GPU (${modelSize})...`;
    } else {
      extractProgressText.textContent = 'Transcribiendo con OpenAI API...';
    }
    
    console.log(`ðŸ“¡ Enviando a: ${endpoint}`, bodyData);
    
    // Llamar a la API de transcripciÃ³n
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyData)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Error en la transcripciÃ³n');
    }
    
    const data = await response.json();
    extractedText = data.transcript;
    
    // Mostrar resultado con informaciÃ³n adicional segÃºn el mÃ©todo
    extractProgressBar.value = 100;
    
    if (method === 'local' && data.stats) {
      extractProgressText.textContent = `âœ… TranscripciÃ³n completada (${data.stats.processing_speed.toFixed(1)}x tiempo real)`;
      
      // Mostrar informaciÃ³n adicional en consola
      console.log(`📊 Estadísticas de transcripción local:`, {
        modelo: data.model_info,
        estadisticas: data.stats,
        idioma: data.language,
        duracion: data.duration
      });
      
      showNotification(`âœ… TranscripciÃ³n local completada - ${data.stats.processing_speed.toFixed(1)}x velocidad`, 'success');
    } else {
      extractProgressText.textContent = 'âœ… TranscripciÃ³n completada';
      showNotification('âœ… TranscripciÃ³n completada exitosamente');
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
    
    console.log(`âœ… TranscripciÃ³n completada (${method})`);
    
  } catch (error) {
    console.error('âŒ Error en transcripciÃ³n:', error);
    extractProgressText.textContent = `âŒ Error en la transcripciÃ³n (${method})`;
    extractProgressText.style.color = '#fca5a5';
    extractProgressText.style.fontWeight = '600';
    extractProgressText.style.background = 'rgba(239, 68, 68, 0.15)';
    extractProgressText.style.padding = '0.5rem';
    extractProgressText.style.borderRadius = '6px';
    extractProgressText.style.border = '1px solid rgba(239, 68, 68, 0.4)';
    showNotification(`âŒ Error: ${error.message}`, 'error');
  } finally {
    // Rehabilitar botÃ³n
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
  
  console.log('ðŸ”„ Formulario de extracciÃ³n reiniciado');
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
  
  showNotification('âœ… Archivo descargado exitosamente');
}

// Helpers para detecciÃ³n de idioma del guiÃ³n
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
    console.log('ðŸŒ DetecciÃ³n de idioma: sin secciones, se asume espaÃ±ol');
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
  console.log('ðŸŒ DetecciÃ³n de idioma del guiÃ³n:', {
    detectedLanguage,
    spanishScore,
    englishScore,
    asciiOnlyRatio: Number(asciiOnlyRatio.toFixed(3)),
    sectionsAnalizadas: sections.length
  });

  window.lastDetectedScriptLanguage = detectedLanguage;
  return detectedLanguage;
}

// FunciÃ³n para generar metadata de YouTube
async function generateYouTubeMetadata() {
  try {
    console.log("ðŸŽ¬ Iniciando generaciÃ³n de metadata de YouTube...");
    
  const topicField = typeof promptInput !== 'undefined' && promptInput ? promptInput : document.getElementById('prompt');
  const topic = topicField?.value?.trim();
    const folderName = document.getElementById("folderName")?.value?.trim() || '';

    const sectionsForMetadata = getSectionsForLanguageDetection();

    if (!topic || sectionsForMetadata.length === 0) {
      console.error("âŒ No hay tema o secciones para generar metadata");
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
        <p>Creando tÃ­tulos clickbait, descripciÃ³n SEO y etiquetas...</p>
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
      console.log("âœ… Metadata de YouTube generada exitosamente");
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
      console.error("âŒ Error generando metadata:", data.error);
      showError("Error generando metadata de YouTube: " + data.error);
      throw new Error(data.error || 'Error al generar metadata de YouTube');
    }

  } catch (error) {
    console.error("âŒ Error en generateYouTubeMetadata:", error);
    showError("Error generando metadata de YouTube: " + error.message);
    
    // Remover indicador de carga si existe
    const loadingIndicator = output.querySelector('.youtube-metadata-loading');
    if (loadingIndicator) {
      loadingIndicator.remove();
    }

    throw error;
  }
}

// FunciÃ³n para mostrar los resultados de metadata de YouTube
function showYouTubeMetadataResults(metadata, topic) {
  console.log("ðŸ“º Mostrando resultados de metadata de YouTube");

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
            <h3><i class="fas fa-fire"></i> TÃ­tulos Clickbait</h3>
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
          <h3><i class="fas fa-file-text"></i> DescripciÃ³n SEO</h3>
          <i class="fas fa-chevron-down toggle-icon"></i>
        </div>
        <div class="section-content">
          <div class="description-container">
            <textarea class="description-text" readonly>${sections.description}</textarea>
            <button class="copy-btn-large" onclick="copyToClipboard(\`${sections.description.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">
              <i class="fas fa-copy"></i> Copiar DescripciÃ³n
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
  
  // Ajustar altura del textarea de descripciÃ³n al contenido
  const descriptionTextarea = metadataContainer.querySelector('.description-text');
  if (descriptionTextarea) {
    // FunciÃ³n para ajustar altura automÃ¡ticamente
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
  
  // ðŸŽ¬ MOSTRAR BOTÃ“N DE GENERACIÃ“N DE VIDEO DESPUÃ‰S DE METADATOS
  // Solo mostrar si no se ha habilitado la generaciÃ³n automÃ¡tica
  if (!shouldGenerateVideoAutomatically()) {
    showVideoGenerationButton();
  }
  
  // Scroll suave hacia el nuevo contenido
  setTimeout(() => {
    metadataContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// Función para parsear la metadata y extraer secciones
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
      // Remover numeración al inicio (1., 2., etc.)
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
      // Remover numeración al inicio (1., 2., etc.)
      const cleanPrompt = line.replace(/^\d+\.\s*/, '');
      if (cleanPrompt) {
        thumbnailPrompts.push(cleanPrompt);
      }
    }
  }
  
  const tagsString = tags.join(', ');
  
  return {
    titles: titles.slice(0, 10), // Máximo 10 títulos
    description: description.trim(),
    tags: tags.slice(0, 25), // Máximo 25 etiquetas
    tagsString: tagsString,
    thumbnailPrompts: thumbnailPrompts.slice(0, 5) // Máximo 5 prompts
  };
}

// FunciÃ³n para copiar al portapapeles
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    // Mostrar confirmaciÃ³n visual
    const event = new CustomEvent('showToast', {
      detail: { message: 'Copiado al portapapeles', type: 'success' }
    });
    document.dispatchEvent(event);
  }).catch(err => {
    console.error('Error copiando al portapapeles:', err);
    // Fallback para navegadores mÃ¡s antiguos
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  });
}

// FunciÃ³n para copiar todos los prompts de miniaturas
function copyAllThumbnailPrompts(prompts) {
  const allPrompts = prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join('\n\n');
  copyToClipboard(allPrompts);
}

// FunciÃ³n para descargar metadata de YouTube
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
  
  // Ocultar toast despuÃ©s de 3 segundos
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => document.body.removeChild(toast), 300);
  }, 3000);
});

// FunciÃ³n para colapsar/expandir secciones de metadata
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

// FunciÃ³n para inicializar secciones colapsadas
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

// FunciÃ³n para colapsar/expandir el panel principal de metadata
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
    
    // Ya no expandir automÃ¡ticamente la primera secciÃ³n
    // El usuario puede expandir manualmente la secciÃ³n que desee
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
    updateThumbnailStyleSelector();
    
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

// FunciÃ³n para cargar estilos de miniatura desde localStorage
function loadThumbnailStyles() {
  try {
    const savedStyles = localStorage.getItem('customThumbnailStyles');
    if (savedStyles) {
      customThumbnailStyles = JSON.parse(savedStyles);
      console.log('ðŸ–¼ï¸ Estilos de miniatura cargados:', customThumbnailStyles);
    } else {
      customThumbnailStyles = [];
      console.log('ðŸ–¼ï¸ No hay estilos de miniatura guardados');
    }
  } catch (error) {
    console.error('âŒ Error cargando estilos de miniatura:', error);
    customThumbnailStyles = [];
  }
}

// FunciÃ³n para guardar estilos de miniatura en localStorage
function saveThumbnailStyles() {
  try {
    localStorage.setItem('customThumbnailStyles', JSON.stringify(customThumbnailStyles));
    console.log('ðŸ’¾ Estilos de miniatura guardados exitosamente');
  } catch (error) {
    console.error('âŒ Error guardando estilos de miniatura:', error);
  }
}

// FunciÃ³n para actualizar el selector de estilos de miniatura
function updateThumbnailStyleSelector() {
  const thumbnailStyleSelect = document.getElementById('thumbnailStyleSelect');
  if (!thumbnailStyleSelect) {
    console.error('âŒ Selector de estilos de miniatura no encontrado');
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

  console.log('ðŸ–¼ï¸ Selector de estilos de miniatura actualizado');
}

// FunciÃ³n para obtener instrucciones de estilo de miniatura
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

// FunciÃ³n para configurar eventos del modal de crear estilo de miniatura
function setupThumbnailStyleModalEvents() {
  console.log('ðŸ”§ Configurando eventos del modal de crear estilo de miniatura...');
  
  try {
    const thumbnailStyleModal = document.getElementById('thumbnailStyleModal');
    const closeModalBtn = document.getElementById('closeThumbnailStyleModal');
    const cancelBtn = document.getElementById('cancelThumbnailStyleBtn');
    const saveBtn = document.getElementById('saveThumbnailStyleBtn');
    
    // Botones de la sidebar
    const createFromSidebarBtn = document.getElementById('createThumbnailStyleFromSidebar');
    
    console.log('ðŸ” Elementos encontrados:', {
      thumbnailStyleModal: !!thumbnailStyleModal,
      closeModalBtn: !!closeModalBtn,
      cancelBtn: !!cancelBtn,
      saveBtn: !!saveBtn,
      createFromSidebarBtn: !!createFromSidebarBtn
    });
    
    if (!thumbnailStyleModal || !closeModalBtn || !cancelBtn || !saveBtn) {
      console.error('âŒ Algunos elementos del modal de miniatura no fueron encontrados');
      return;
    }
    
    // FunciÃ³n para cerrar modal
    function closeModal() {
      console.log('ðŸ”’ Cerrando modal de crear miniatura...');
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
      console.log('âœ… Event listener del botÃ³n guardar configurado');
    } else {
      console.error('âŒ BotÃ³n guardar no encontrado');
    }
    
    // Evento para abrir desde sidebar
    if (createFromSidebarBtn) {
      createFromSidebarBtn.addEventListener('click', () => {
        console.log('ðŸ–¼ï¸ Abriendo modal desde sidebar...');
        openThumbnailStyleModal();
      });
      console.log('âœ… Event listener configurado para botÃ³n crear desde sidebar');
    } else {
      console.error('âŒ BotÃ³n crear desde sidebar no encontrado');
    }
    
    // Cerrar al hacer clic fuera del modal
    thumbnailStyleModal.addEventListener('click', (e) => {
      if (e.target === thumbnailStyleModal) {
        closeModal();
      }
    });
    
    console.log('âœ… Eventos del modal de miniatura configurados correctamente');
  } catch (error) {
    console.error('âŒ Error configurando eventos del modal de miniatura:', error);
  }
}

// FunciÃ³n para abrir modal de crear estilo de miniatura
function openThumbnailStyleModal() {
  console.log('ðŸ–¼ï¸ Abriendo modal de crear estilo de miniatura...');
  
  try {
    const thumbnailStyleModal = document.getElementById('thumbnailStyleModal');
    if (thumbnailStyleModal) {
      // Solo limpiar si estÃ¡ cerrado para evitar interferir mientras se escribe
      if (thumbnailStyleModal.style.display !== 'flex') {
        clearThumbnailModalForm();
      }
      
      thumbnailStyleModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      console.log('âœ… Modal de crear estilo de miniatura abierto');
      
      // Enfocar el primer campo
      setTimeout(() => {
        const nameField = document.getElementById('thumbnailStyleName');
        if (nameField) {
          nameField.focus();
        }
      }, 100);
    } else {
      console.error('âŒ Modal de crear estilo de miniatura no encontrado');
    }
  } catch (error) {
    console.error('âŒ Error abriendo modal de crear miniatura:', error);
  }
}

// FunciÃ³n para limpiar formulario del modal
function clearThumbnailModalForm() {
  document.getElementById('thumbnailStyleName').value = '';
  document.getElementById('thumbnailStyleDescription').value = '';
  document.getElementById('thumbnailPrimaryColor').value = '';
  document.getElementById('thumbnailSecondaryColor').value = '';
  document.getElementById('thumbnailInstructions').value = '';
}

// FunciÃ³n para guardar nuevo estilo de miniatura
function saveThumbnailStyle() {
  console.log('ðŸ–¼ï¸ Intentando guardar estilo de miniatura...');
  
  try {
    const name = document.getElementById('thumbnailStyleName').value.trim();
    const description = document.getElementById('thumbnailStyleDescription').value.trim();
    const primaryColor = document.getElementById('thumbnailPrimaryColor').value.trim();
    const secondaryColor = document.getElementById('thumbnailSecondaryColor').value.trim();
    const instructions = document.getElementById('thumbnailInstructions').value.trim();
    
    console.log('ðŸ“ Valores del formulario:', {
      name, description, primaryColor, secondaryColor, instructions
    });
    
    if (!name || !description || !primaryColor || !secondaryColor || !instructions) {
      console.warn('âš ï¸ Campos incompletos');
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
    
    console.log('ðŸ’¾ Guardando nuevo estilo:', newStyle);
    
    customThumbnailStyles.push(newStyle);
    saveThumbnailStyles();
    updateThumbnailStyleSelector();
    
    console.log('âœ… Estilo agregado al array, cerrando modal...');
    
    // Cerrar modal
    const modal = document.getElementById('thumbnailStyleModal');
    if (modal) {
      modal.style.display = 'none';
      document.body.style.overflow = 'auto';
      clearThumbnailModalForm();
      console.log('âœ… Modal cerrado');
    } else {
      console.error('âŒ Modal no encontrado');
    }
    
    console.log('âœ… Estilo de miniatura guardado:', newStyle);
    
    // Mostrar mensaje de Ã©xito
    try {
      showNotification('âœ… Estilo de miniatura creado exitosamente', 'success');
      console.log('âœ… NotificaciÃ³n mostrada');
    } catch (notifError) {
      console.error('âŒ Error mostrando notificaciÃ³n:', notifError);
    }
    
  } catch (error) {
    console.error('âŒ Error en saveThumbnailStyle:', error);
    alert('Error guardando el estilo: ' + error.message);
  }
}

// FunciÃ³n para configurar eventos del modal de gestionar estilos
function setupManageThumbnailStylesEvents() {
  console.log('ðŸ”§ Configurando eventos del modal de gestionar estilos de miniatura...');
  
  try {
    const manageThumbnailStylesModal = document.getElementById('manageThumbnailStylesModal');
    const closeManageBtn = document.getElementById('closeManageThumbnailStylesModal');
    const closeManageFooterBtn = document.getElementById('closeManageThumbnailStylesBtn');
    
    console.log('ðŸ” Elementos de gestiÃ³n encontrados:', {
      manageThumbnailStylesModal: !!manageThumbnailStylesModal,
      closeManageBtn: !!closeManageBtn,
      closeManageFooterBtn: !!closeManageFooterBtn
    });
    
    // FunciÃ³n para cerrar el modal
    function closeManageModal() {
      console.log('ï¿½ Cerrando modal de gestionar miniaturas...');
      if (manageThumbnailStylesModal) {
        manageThumbnailStylesModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        console.log('âœ… Modal de gestiÃ³n cerrado');
      }
    }
    
    // NO configurar el botÃ³n de abrir aquÃ­ (se hace manualmente)
    // Solo configurar los botones de cerrar
    
    if (closeManageBtn) {
      closeManageBtn.addEventListener('click', closeManageModal);
      console.log('âœ… BotÃ³n X de cerrar configurado');
    } else {
      console.error('âŒ BotÃ³n X de cerrar no encontrado');
    }
    
    if (closeManageFooterBtn) {
      closeManageFooterBtn.addEventListener('click', closeManageModal);
      console.log('âœ… BotÃ³n Cerrar del footer configurado');
    } else {
      console.error('âŒ BotÃ³n Cerrar del footer no encontrado');
    }
    
    if (manageThumbnailStylesModal) {
      manageThumbnailStylesModal.addEventListener('click', (e) => {
        if (e.target === manageThumbnailStylesModal) {
          closeManageModal();
        }
      });
      console.log('âœ… Evento de clic fuera del modal configurado');
    }
    
    console.log('âœ… Eventos de gestiÃ³n de miniatura configurados correctamente');
  } catch (error) {
    console.error('âŒ Error configurando eventos de gestiÃ³n de miniatura:', error);
  }
}

// FunciÃ³n para abrir modal de gestionar estilos de miniatura
function openManageThumbnailStylesModal() {
  console.log('ðŸ”§ Abriendo modal de gestionar estilos de miniatura...');
  
  try {
    const manageThumbnailStylesModal = document.getElementById('manageThumbnailStylesModal');
    if (manageThumbnailStylesModal) {
      console.log('âœ… Modal de gestiÃ³n encontrado, cargando lista...');
      loadThumbnailStylesList();
      manageThumbnailStylesModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      console.log('âœ… Modal de gestiÃ³n abierto');
    } else {
      console.error('âŒ Modal de gestiÃ³n no encontrado');
    }
  } catch (error) {
    console.error('âŒ Error abriendo modal de gestiÃ³n:', error);
  }
}

// FunciÃ³n para cargar lista de estilos de miniatura
function loadThumbnailStylesList() {
  console.log('ðŸ“‹ Cargando lista de estilos de miniatura...');
  console.log('ðŸ“Š Estilos disponibles:', customThumbnailStyles);
  
  try {
    const thumbnailStylesList = document.getElementById('thumbnailStylesList');
    const noThumbnailStylesMessage = document.getElementById('noThumbnailStylesMessage');
    
    console.log('ðŸ” Elementos encontrados:', {
      thumbnailStylesList: !!thumbnailStylesList,
      noThumbnailStylesMessage: !!noThumbnailStylesMessage
    });
    
    if (!thumbnailStylesList || !noThumbnailStylesMessage) {
      console.error('âŒ Elementos de lista no encontrados');
      return;
    }
    
    thumbnailStylesList.innerHTML = '';
    
    if (customThumbnailStyles.length === 0) {
      console.log('ðŸ“ No hay estilos personalizados, mostrando mensaje');
      noThumbnailStylesMessage.style.display = 'block';
      thumbnailStylesList.style.display = 'none';
    } else {
      console.log(`ðŸ“ Mostrando ${customThumbnailStyles.length} estilos personalizados`);
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
    
    console.log('âœ… Lista de estilos cargada correctamente');
  } catch (error) {
    console.error('âŒ Error cargando lista de estilos:', error);
  }
}

// FunciÃ³n para eliminar estilo de miniatura
function deleteThumbnailStyle(styleId) {
  if (confirm('Â¿EstÃ¡s seguro de que quieres eliminar este estilo de miniatura?')) {
    customThumbnailStyles = customThumbnailStyles.filter(style => style.id !== styleId);
    saveThumbnailStyles();
    updateThumbnailStyleSelector();
    loadThumbnailStylesList();
    showNotification('âœ… Estilo de miniatura eliminado', 'success');
  }
}

// FunciÃ³n para editar estilo de miniatura
function editThumbnailStyle(styleId) {
  const style = customThumbnailStyles.find(s => s.id === styleId);
  if (!style) return;
  
  currentEditingThumbnailStyleId = styleId;
  
  // Llenar formulario de ediciÃ³n
  document.getElementById('editThumbnailStyleName').value = style.name;
  document.getElementById('editThumbnailStyleDescription').value = style.description;
  document.getElementById('editThumbnailPrimaryColor').value = style.primaryColor;
  document.getElementById('editThumbnailSecondaryColor').value = style.secondaryColor;
  document.getElementById('editThumbnailInstructions').value = style.instructions;
  
  // Cerrar modal de gestionar y abrir modal de editar
  document.getElementById('manageThumbnailStylesModal').style.display = 'none';
  document.getElementById('editThumbnailStyleModal').style.display = 'flex';
}

// FunciÃ³n para configurar eventos del modal de editar
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

// FunciÃ³n para guardar cambios en estilo editado
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
    
    showNotification('âœ… Estilo de miniatura actualizado', 'success');
    currentEditingThumbnailStyleId = null;
  }
}

// FunciÃ³n para obtener datos del estilo de miniatura seleccionado
function getThumbnailStyleData() {
  const thumbnailStyleSelect = document.getElementById('thumbnailStyleSelect');
  if (!thumbnailStyleSelect) {
    console.log('ðŸ” DEBUG - thumbnailStyleSelect no encontrado, usando default');
    return 'default';
  }
  
  const selectedValue = thumbnailStyleSelect.value;
  console.log('ðŸ” DEBUG - selectedValue del selector:', selectedValue);
  
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
      console.log('ðŸ” DEBUG - Enviando estilo personalizado completo:', result);
      return result;
    }
  }
  
  // Estilo predeterminado
  console.log('ðŸ” DEBUG - Enviando estilo predeterminado:', selectedValue);
  return selectedValue;
}

// FALLBACK PARA SIDEBAR - Se ejecuta despuÃ©s de que todo estÃ© cargado
setTimeout(function() {
  console.log('ðŸ”„ FALLBACK: Verificando configuraciÃ³n del sidebar...');
  
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.getElementById('sidebar');
  
  if (menuToggleBtn && sidebar) {
    console.log('âœ… Elementos del sidebar encontrados - onclick ya configurado en HTML');
  } else {
    console.error('âŒ FALLBACK: Elementos del sidebar no encontrados');
    console.error('menuToggleBtn:', menuToggleBtn);
    console.error('sidebar:', sidebar);
  }
}, 3000);

// ================================
// SISTEMA DE PROYECTOS
// ================================

// Inicializar sistema de proyectos
document.addEventListener('DOMContentLoaded', function() {
  console.log('ðŸš€ DOM cargado, inicializando sistema de proyectos...');
  initializeProjectSystem();
});

// Fallback con delay para asegurar que se inicialice
setTimeout(function() {
  console.log('ðŸ”„ Inicializador de respaldo ejecutÃ¡ndose...');
  const saveBtn = document.getElementById('saveProjectBtn');
  const loadBtn = document.getElementById('loadProjectBtn');
  const manageBtn = document.getElementById('manageProjectsBtn');
  
  if (saveBtn && !saveBtn.onclick && !saveBtn.hasAttribute('data-initialized')) {
    console.log('ðŸ”§ Configurando eventos de respaldo...');
    
    saveBtn.addEventListener('click', function(e) {
      console.log('ðŸ’¾ RESPALDO: Click en Guardar Proyecto');
      e.preventDefault();
      saveCurrentProject();
    });
    saveBtn.setAttribute('data-initialized', 'true');
    
    if (loadBtn) {
      loadBtn.addEventListener('click', function(e) {
        console.log('ðŸ“‚ RESPALDO: Click en Cargar Proyecto');
        e.preventDefault();
        showLoadProjectModal();
      });
      loadBtn.setAttribute('data-initialized', 'true');
    }
    
    if (manageBtn) {
      manageBtn.addEventListener('click', function(e) {
        console.log('ðŸ”§ RESPALDO: Click en Gestionar Proyectos');
        e.preventDefault();
        showManageProjectsModal();
      });
      manageBtn.setAttribute('data-initialized', 'true');
    }
    
    console.log('âœ… Eventos de respaldo configurados');
  } else {
    console.log('â„¹ï¸ Eventos ya configurados o elementos no encontrados');
  }
}, 2000);

function initializeProjectSystem() {
  console.log('ðŸ”§ Inicializando sistema de proyectos...');
  
  const saveProjectBtn = document.getElementById('saveProjectBtn');
  const loadProjectBtn = document.getElementById('loadProjectBtn');
  const manageProjectsBtn = document.getElementById('manageProjectsBtn');

  console.log('ðŸ” Elementos encontrados:', {
    saveProjectBtn: !!saveProjectBtn,
    loadProjectBtn: !!loadProjectBtn,
    manageProjectsBtn: !!manageProjectsBtn
  });

  if (saveProjectBtn) {
    console.log('âœ… Configurando evento para saveProjectBtn');
    saveProjectBtn.addEventListener('click', function(e) {
      console.log('ðŸ–±ï¸ Click en Guardar Proyecto');
      e.preventDefault();
      saveCurrentProject();
    });
  } else {
    console.error('âŒ No se encontrÃ³ saveProjectBtn');
  }
  
  if (loadProjectBtn) {
    console.log('âœ… Configurando evento para loadProjectBtn');
    loadProjectBtn.addEventListener('click', function(e) {
      console.log('ðŸ–±ï¸ Click en Cargar Proyecto');
      e.preventDefault();
      showLoadProjectModal();
    });
  } else {
    console.error('âŒ No se encontrÃ³ loadProjectBtn');
  }
  
  if (manageProjectsBtn) {
    console.log('âœ… Configurando evento para manageProjectsBtn');
    manageProjectsBtn.addEventListener('click', function(e) {
      console.log('ðŸ–±ï¸ Click en Gestionar Proyectos');
      e.preventDefault();
      showManageProjectsModal();
    });
  } else {
    console.error('âŒ No se encontrÃ³ manageProjectsBtn');
  }

  // Inicializar event listeners de modales
  initializeProjectModals();
  
  console.log('âœ… Sistema de proyectos inicializado');
}

// FunciÃ³n para guardar el proyecto actual
async function saveCurrentProject() {
  try {
    console.log('ðŸ’¾ Iniciando guardado de proyecto...');
    
    const topicElement = document.getElementById('topic');
    const folderNameElement = document.getElementById('folderName');
    const sectionsNumberElement = document.getElementById('sectionsNumber');
    
    console.log('ðŸ” Elementos encontrados:', {
      topic: !!topicElement,
      folderName: !!folderNameElement,
      sectionsNumber: !!sectionsNumberElement
    });
    
    if (!topicElement || !folderNameElement || !sectionsNumberElement) {
      showNotification('âš ï¸ No se encontraron los elementos del formulario. AsegÃºrate de haber configurado un proyecto.', 'warning');
      return;
    }
    
    const topic = topicElement.value.trim();
    const folderName = folderNameElement.value.trim();
    const totalSections = parseInt(sectionsNumberElement.value);
    
    if (!topic) {
      showNotification('âš ï¸ Ingresa un tema para guardar el proyecto', 'warning');
      return;
    }

    // El proyecto se guarda automÃ¡ticamente al generar contenido
    // Esta funciÃ³n es principalmente para mostrar confirmaciÃ³n manual
    showNotification('ðŸ’¾ El proyecto se guarda automÃ¡ticamente al generar contenido', 'info');
    
    // Si hay contenido generado, refrescar la lista de proyectos
    if (currentSectionNumber > 0) {
      await refreshProjectsList();
      showNotification('âœ… Estado del proyecto actualizado', 'success');
    }
    
  } catch (error) {
    console.error('âŒ Error guardando proyecto:', error);
    showNotification('âŒ Error guardando el proyecto', 'error');
  }
}

// FunciÃ³n para mostrar modal de cargar proyecto
async function showLoadProjectModal() {
  const modal = document.getElementById('loadProjectModal');
  const container = document.getElementById('projectsListContainer');
  
  modal.style.display = 'block';
  container.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i><span>Cargando proyectos...</span></div>';
  
  try {
    console.log('ðŸ” Haciendo fetch a /api/projects...');
    const response = await fetch('/api/projects');
    console.log('ðŸ“¡ Respuesta recibida:', response.status, response.statusText);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('ðŸ“Š Datos recibidos:', data);
    
    if (data.success) {
      window.availableProjects = data.projects || [];
      console.log('âœ… Proyectos cargados en window.availableProjects:', window.availableProjects.length);
      renderProjectsList(container, 'load');
    } else {
      console.error('âŒ API devolviÃ³ error:', data.error);
      container.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><h3>Error cargando proyectos</h3><p>${data.error || 'No se pudieron cargar los proyectos disponibles'}</p></div>`;
    }
  } catch (error) {
    console.error('âŒ Error cargando proyectos:', error);
    // No usar availableProjects aquÃ­ que causa el error
    container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Error de conexiÃ³n</h3><p>Error: ${error.message}</p><p>AsegÃºrate de que el servidor estÃ© funcionando en http://localhost:3000</p></div>`;
  }
}

// FunciÃ³n para mostrar modal de gestionar proyectos
async function showManageProjectsModal() {
  const modal = document.getElementById('manageProjectsModal');
  const container = document.getElementById('manageProjectsContainer');
  
  modal.style.display = 'block';
  container.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i><span>Cargando proyectos...</span></div>';
  
  try {
    await refreshProjectsList();
    renderProjectsList(container, 'manage');
  } catch (error) {
    console.error('âŒ Error cargando proyectos para gestiÃ³n:', error);
    container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Error de conexiÃ³n</h3><p>No se pudo conectar con el servidor</p></div>';
  }
}

// FunciÃ³n para refrescar lista de proyectos
async function refreshProjectsList() {
  // Verificar que availableProjects estÃ© definido
  if (typeof window.availableProjects === 'undefined') {
    console.log('âš ï¸ window.availableProjects no definido en refresh, inicializando...');
    window.availableProjects = [];
  }
  
  try {
    const response = await fetch('/api/projects');
    const data = await response.json();
    
    if (data.success) {
      window.availableProjects = data.projects;
      availableProjects = window.availableProjects; // Sincronizar variable local
      
      // Actualizar containers si estÃ¡n visibles
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
    console.error('âŒ Error refrescando proyectos:', error);
    return false;
  }
}

// FunciÃ³n para renderizar lista de proyectos
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

  return `${words.slice(0, maxWords).join(' ')}â€¦`;
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
            <span class="project-info-label">Estado de imÃ¡genes:</span>
            <span class="project-info-value">
              ${project.imagesPerSection ? project.imagesPerSection.map(s => 
                `<span class="status-square status-${s.status}" title="${s.section.replace('seccion_', 'SecciÃ³n ')}: ${s.images} imÃ¡genes, ${s.prompts} prompts"></span>`
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
            <span class="project-info-label">Ãšltima modificaciÃ³n:</span>
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
    console.warn('âš ï¸ No se pudo cargar el estado de proyectos completados:', error);
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
    console.warn('âš ï¸ No se pudo guardar el estado de proyectos completados:', error);
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

// FunciÃ³n para inicializar el colapso del contenedor del script
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

// FunciÃ³n para cargar un proyecto
async function loadProject(folderName) {
  try {
    // Evitar cargar el mismo proyecto mÃºltiples veces
    if (window.currentProject && window.currentProject.folderName === folderName) {
      console.log(`ðŸ”„ Proyecto "${folderName}" ya estÃ¡ cargado, omitiendo recarga`);
      return;
    }
    
    isLoadingProject = true; // Activar bandera de carga
    isMetadataShown = false; // Resetear bandera de metadatos solo si es un proyecto diferente
    showNotification('ðŸ“‚ Cargando proyecto...', 'info');
    
    // Limpiar metadatos anteriores de la interfaz
    const output = document.getElementById('output');
    if (output) {
      const existingMetadataContainers = output.querySelectorAll('.youtube-metadata-container');
      existingMetadataContainers.forEach(container => container.remove());
      console.log('ðŸ§¹ Metadatos anteriores limpiados de la interfaz');
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
      
      console.log('ðŸ” Elementos del formulario encontrados:', {
        prompt: !!topicElement, // Cambiado de topic a prompt
        folderName: !!folderNameElement,
        sectionsNumber: !!sectionsNumberElement,
        voiceSelect: !!voiceSelectElement,
        imageModelSelect: !!imageModelSelectElement,
        llmModelSelect: !!llmModelSelectElement
      });
      
      if (topicElement) {
        topicElement.value = window.currentProject.topic;
        console.log('ðŸ“ Tema del guiÃ³n cargado:', window.currentProject.topic);
      } else {
        console.warn('âš ï¸ Elemento prompt (tema del guiÃ³n) no encontrado');
      }
      
      if (folderNameElement) {
        folderNameElement.value = window.currentProject.folderName;
      } else {
        console.warn('âš ï¸ Elemento folderName no encontrado');
      }
      
      if (sectionsNumberElement) {
        sectionsNumberElement.value = window.currentProject.totalSections;
        updateSectionButtons(); // Actualizar estado de botones
      } else {
        console.warn('âš ï¸ Elemento sectionsNumber no encontrado');
      }
      
      if (voiceSelectElement) {
        voiceSelectElement.value = window.currentProject.voice || 'shimmer';
      } else {
        console.warn('âš ï¸ Elemento voiceSelect no encontrado');
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
        console.log('ðŸ§  Modelo LLM cargado:', window.currentProject.llmModel);
      }
      
      // ðŸ”§ CARGAR CONFIGURACIONES ADICIONALES DEL PROYECTO
      console.log('ðŸ”§ Cargando configuraciones adicionales del proyecto...');
      
      // Cargar estilo de narraciÃ³n
      const styleSelectElement = document.getElementById('styleSelect');
      if (styleSelectElement && window.currentProject.scriptStyle) {
        styleSelectElement.value = window.currentProject.scriptStyle;
        console.log('ðŸ“ Estilo de narraciÃ³n cargado:', window.currentProject.scriptStyle);
      }
      
      // Cargar voz de Applio
      const applioVoiceSelectElement = document.getElementById('applioVoiceSelect');
      if (applioVoiceSelectElement && window.currentProject.applioVoice) {
        applioVoiceSelectElement.value = window.currentProject.applioVoice;
        console.log('ðŸŽ¤ Voz de Applio cargada:', window.currentProject.applioVoice);
      }
      
      // Cargar modelo de Applio
      const applioModelSelectElement = document.getElementById('applioModelSelect');
      if (applioModelSelectElement && window.currentProject.applioModel) {
        applioModelSelectElement.value = window.currentProject.applioModel;
        console.log('ðŸŽ›ï¸ Modelo de Applio cargado:', window.currentProject.applioModel);
      }
      
      // Cargar pitch de Applio
      const applioPitchElement = document.getElementById('applioPitch');
      const pitchValueElement = document.getElementById('pitchValue');
      if (applioPitchElement && typeof window.currentProject.applioPitch !== 'undefined') {
        applioPitchElement.value = window.currentProject.applioPitch;
        if (pitchValueElement) {
          pitchValueElement.textContent = window.currentProject.applioPitch;
        }
        console.log('ðŸŽµ Pitch de Applio cargado:', window.currentProject.applioPitch);
      }

      const applioSpeedElement = document.getElementById('applioSpeed');
      const speedValueElement = document.getElementById('speedValue');
      if (applioSpeedElement && typeof window.currentProject.applioSpeed !== 'undefined') {
        applioSpeedElement.value = window.currentProject.applioSpeed;
        if (speedValueElement) {
          speedValueElement.textContent = window.currentProject.applioSpeed;
        }
        console.log('ðŸš€ Velocidad de Applio cargada:', window.currentProject.applioSpeed);
      }
      
      // Cargar modificador de prompts (instrucciones para imÃ¡genes)
      const promptModifierElement = document.getElementById('promptModifier');
      if (promptModifierElement && window.currentProject.promptModifier) {
        promptModifierElement.value = window.currentProject.promptModifier;
        console.log('ðŸŽ¨ Modificador de prompts cargado:', window.currentProject.promptModifier);
      }
      
      // Cargar configuraciÃ³n de checkboxes
      const skipImagesElement = document.getElementById('skipImages');
      if (skipImagesElement && typeof window.currentProject.skipImages === 'boolean') {
        skipImagesElement.checked = window.currentProject.skipImages;
        console.log('ðŸš« Skip imÃ¡genes cargado:', window.currentProject.skipImages, 'checkbox checked:', skipImagesElement.checked);
      } else {
        console.warn('âš ï¸ Skip Images - elemento:', !!skipImagesElement, 'valor en proyecto:', window.currentProject.skipImages, 'tipo:', typeof window.currentProject.skipImages);
      }
      
      const googleImagesElement = document.getElementById('googleImages');
      if (googleImagesElement && typeof window.currentProject.googleImages === 'boolean') {
        googleImagesElement.checked = window.currentProject.googleImages;
        console.log('ðŸ”— Google Images cargado:', window.currentProject.googleImages, 'checkbox checked:', googleImagesElement.checked);
      } else {
        console.warn('âš ï¸ Google Images - elemento:', !!googleImagesElement, 'valor en proyecto:', window.currentProject.googleImages, 'tipo:', typeof window.currentProject.googleImages);
      }
      
      // Cargar nÃºmero de imÃ¡genes
      const imagesSelectElement = document.getElementById('imagesSelect');
      if (imagesSelectElement && window.currentProject.imageCount) {
        imagesSelectElement.value = window.currentProject.imageCount;
        console.log('ðŸ–¼ï¸ NÃºmero de imÃ¡genes cargado:', window.currentProject.imageCount);
      }
      
      // Cargar palabras por secciÃ³n (minWords y maxWords)
      const minWordsElement = document.getElementById('minWords');
      if (minWordsElement && window.currentProject.minWords) {
        minWordsElement.value = window.currentProject.minWords;
        console.log('ðŸ“ MinWords cargado:', window.currentProject.minWords);
      }
      
      const maxWordsElement = document.getElementById('maxWords');
      if (maxWordsElement && window.currentProject.maxWords) {
        maxWordsElement.value = window.currentProject.maxWords;
        console.log('ðŸ“ MaxWords cargado:', window.currentProject.maxWords);
      }
      
      console.log('âœ… Todas las configuraciones del proyecto han sido restauradas');
      
      // Actualizar estado de la interfaz
      if (window.currentProject.completedSections.length > 0) {
        window.currentTopic = window.currentProject.topic;
        window.totalSections = window.currentProject.totalSections;
        // Para el botÃ³n continuar, currentSectionNumber debe ser el nÃºmero de secciones completadas
        window.currentSectionNumber = window.currentProject.completedSections.length;
        
        // TambiÃ©n actualizar las variables globales para compatibilidad
        currentTopic = window.currentProject.topic;
        totalSections = window.currentProject.totalSections;
        currentSectionNumber = window.currentProject.completedSections.length;
        
        console.log('ðŸ“Š Variables globales actualizadas:', {
          currentTopic,
          totalSections,
          currentSectionNumber,
          completedSections: window.currentProject.completedSections.length
        });
        
        // Mostrar la Ãºltima secciÃ³n completada
        const lastSection = window.currentProject.completedSections[window.currentProject.completedSections.length - 1];
        if (lastSection) {
          showLoadedSection(lastSection);
        }
        
        // Cargar prompts al panel lateral si existen
        loadProjectPrompts(window.currentProject);
      }

        syncSectionImageProgressFromProject(window.currentProject);
        startSectionImageProgressPolling(window.currentProject);
      
      // ðŸŽ¬ VERIFICAR Y MOSTRAR METADATOS DE YOUTUBE SI EXISTEN
      if (window.currentProject.youtubeMetadata && !isMetadataShown) {
        console.log('ðŸŽ¬ Proyecto tiene metadatos de YouTube, mostrando automÃ¡ticamente...');
        const isProjectComplete = window.currentProject.completedSections.length >= window.currentProject.totalSections;
        
        if (isProjectComplete) {
          // Mostrar metadatos automÃ¡ticamente para proyectos completos
          isMetadataShown = true; // Marcar como mostrado INMEDIATAMENTE
          setTimeout(() => {
            showYouTubeMetadataResults(window.currentProject.youtubeMetadata.content, window.currentProject.topic);
            showNotification('ðŸŽ¬ Metadatos de YouTube cargados automÃ¡ticamente', 'info');
          }, 1500); // Delay para que se complete la carga del proyecto
        } else {
          console.log('ðŸ“Š Proyecto incompleto, metadatos disponibles pero no se muestran automÃ¡ticamente');
          showNotification('ðŸ“Š Este proyecto tiene metadatos de YouTube generados anteriormente', 'info');
        }
      } else if (window.currentProject.youtubeMetadata && isMetadataShown) {
        console.log('ðŸŽ¬ Metadatos ya mostrados, omitiendo duplicado');
      } else {
        const isProjectComplete = window.currentProject.completedSections.length >= window.currentProject.totalSections;
        if (isProjectComplete) {
          console.log('ðŸŽ¬ Proyecto completo sin metadatos, se pueden generar manualmente');
          showNotification('ðŸŽ¬ Proyecto completo. Puedes generar metadatos de YouTube en el extractor de texto.', 'info');
        }
      }
      
      // Actualizar estado de los botones segÃºn el progreso del proyecto
      updateProjectButtons(window.currentProject);
      
      // Cerrar modales
      closeModal('loadProjectModal');
      closeModal('manageProjectsModal');
      
      showNotification(`âœ… Proyecto "${window.currentProject.folderName}" cargado exitosamente`, 'success');
      
      // Mostrar detalles del proyecto cargado
      showProjectDetails(window.currentProject);
      
    } else {
      showNotification('âŒ Error cargando el proyecto', 'error');
    }
    
  } catch (error) {
    console.error('âŒ Error cargando proyecto:', error);
    showNotification('âŒ Error de conexiÃ³n al cargar proyecto', 'error');
  } finally {
    isLoadingProject = false; // Desactivar bandera de carga al finalizar
  }
}

// FunciÃ³n para mostrar secciÃ³n cargada
function showLoadedSection(section) {
  const scriptContent = document.getElementById('scriptContent');
  const sectionTitle = document.getElementById('sectionTitle');
  const currentSectionSpan = document.getElementById('currentSection');
  
  if (scriptContent && section.script) {
    // Mostrar script
    const scriptHTML = `
      <div class="script-container">
        <div class="script-actions">
          <button class="copy-script-btn" onclick="copyScriptText()" title="Copiar texto del guiÃ³n">
            <i class="fas fa-copy"></i>
          </button>
          <button class="audio-script-btn" onclick="generateSectionAudioButton()" title="Generar audio del guiÃ³n">
            <i class="fas fa-microphone"></i>
          </button>
        </div>
        <div class="script-text">${section.script.replace(/\n/g, '<br><br>')}</div>
      </div>`;
    
    scriptContent.innerHTML = scriptHTML;
    scriptContent.style.display = 'block';
  }
  
  if (sectionTitle) {
    sectionTitle.textContent = `SecciÃ³n ${section.section}`;
  }
  
  if (currentSectionSpan) {
    currentSectionSpan.textContent = section.section;
  }
  
  // Cargar y mostrar imÃ¡genes en el carrusel si existen
  if (section.hasImages || section.imageFiles || section.googleImagesMode) {
    console.log('ðŸ–¼ï¸ Cargando imÃ¡genes para secciÃ³n:', section.section);
    console.log('ðŸ” Motivo de carga:', {
      hasImages: section.hasImages,
      imageFiles: !!section.imageFiles,
      googleImagesMode: section.googleImagesMode
    });
    console.log('ðŸ” Datos completos de la secciÃ³n:', section);
    loadSectionImages(section.section);
  } else {
    console.log('ðŸš« No se detectaron imÃ¡genes para cargar:', {
      hasImages: section.hasImages,
      imageFiles: !!section.imageFiles,
      googleImagesMode: section.googleImagesMode,
      sectionKeys: Object.keys(section)
    });
    
    // FORZAR carga de imÃ¡genes independientemente de las banderas
    console.log('ðŸ”§ Intentando cargar imÃ¡genes forzadamente...');
    loadSectionImages(section.section);
  }
}

// FunciÃ³n para cargar imÃ¡genes de una secciÃ³n especÃ­fica desde el proyecto
async function loadSectionImages(sectionNumber) {
  try {
    console.log(`ðŸ” [loadSectionImages] Iniciando carga para secciÃ³n ${sectionNumber}`);
    
    if (!window.currentProject) {
      console.warn('âš ï¸ No hay proyecto cargado actualmente');
      return;
    }
    
    // ðŸ” Usar la carpeta correcta del proyecto
    const projectFolderName = window.currentProject.folderName || 
                             window.currentProject.originalFolderName || 
                             window.currentProject.topic.toLowerCase().replace(/\s+/g, '_');
    
    console.log(`ðŸ–¼ï¸ Buscando imÃ¡genes para secciÃ³n ${sectionNumber} en proyecto: ${projectFolderName}`);
    console.log(`ðŸ”— URL que se va a llamar: /api/project-images/${projectFolderName}/${sectionNumber}`);
    
    const response = await fetch(`/api/project-images/${projectFolderName}/${sectionNumber}`);
    console.log(`ðŸ“¡ Respuesta del servidor:`, response.status, response.statusText);
    
    const data = await response.json();
    console.log(`ðŸ“Š Datos recibidos completos:`, JSON.stringify(data, null, 2));
    
    if (data.success && data.images && data.images.length > 0) {
      console.log(`âœ… Encontradas ${data.images.length} imÃ¡genes para secciÃ³n ${sectionNumber}`);
      
      // Preparar imÃ¡genes para el carrusel
      const carouselImages = data.images.map((image, index) => {
        console.log(`ðŸ–¼ï¸ Procesando imagen ${index + 1}:`, image);
        return {
          url: image.url,
          caption: image.caption || `Imagen ${index + 1} de la SecciÃ³n ${sectionNumber}`,
          filename: image.filename,
          path: image.path,
          source: image.source || 'Google Images' // AÃ±adir source para la lÃ³gica del carrusel
        };
      });
      
      console.log(`ðŸŽ  ImÃ¡genes preparadas para carrusel:`, carouselImages);
      
      // Cargar keywords si estÃ¡n disponibles
      console.log(`ðŸ” [loadSectionImages] Data.keywords recibidas:`, data.keywords);
      console.log(`ðŸ” [loadSectionImages] Longitud de keywords:`, data.keywords ? data.keywords.length : 0);
      if (data.keywords && data.keywords.length > 0) {
        currentImageKeywords = data.keywords;
        console.log(`ðŸ“‹ Keywords cargadas para las imÃ¡genes:`, data.keywords);
      } else {
        currentImageKeywords = [];
        console.log(`âš ï¸ No se recibieron keywords del backend`);
      }
      
      console.log(`ðŸ” [loadSectionImages] currentImageKeywords final:`, currentImageKeywords);
      
      // Mostrar carrusel
      createCarousel(carouselImages, sectionNumber, []);
      
      // Actualizar variables globales
      totalSlides = carouselImages.length;
      currentSlide = 0;
      
      // Almacenar prompts si estÃ¡n disponibles
      if (data.prompts && data.prompts.length > 0) {
        imagePrompts = data.prompts;
        console.log(`ðŸŽ¨ Prompts de imÃ¡genes cargados:`, data.prompts);
      }
      
      console.log(`ðŸŽ  Carrusel creado exitosamente para secciÃ³n ${sectionNumber}`);
      
    } else {
      console.log(`ðŸ“· No se encontraron imÃ¡genes para secciÃ³n ${sectionNumber}`, data);
      
      // Ocultar carrusel si no hay imÃ¡genes
      const carouselContainer = document.getElementById("carousel-container");
      if (carouselContainer) {
        carouselContainer.style.display = "none";
        console.log(`ðŸ”’ Carrusel ocultado para secciÃ³n ${sectionNumber}`);
      }
    }
    
  } catch (error) {
    console.error(`âŒ Error cargando imÃ¡genes para secciÃ³n ${sectionNumber}:`, error);
    
    // Ocultar carrusel en caso de error
    const carouselContainer = document.getElementById("carousel-container");
    if (carouselContainer) {
      carouselContainer.style.display = "none";
    }
  }

  if (shouldRefreshSectionImageProgress()) {
    refreshSectionImageProgress().catch((error) => {
      console.warn('âš ï¸ Error actualizando progreso de imÃ¡genes tras cargar secciÃ³n:', error);
    });
  }
}

// FunciÃ³n para cargar prompts del proyecto al panel lateral
function loadProjectPrompts(project) {
  console.log('ðŸ“‹ Iniciando carga de prompts del proyecto...');
  
  if (!project.completedSections || project.completedSections.length === 0) {
    console.log('âŒ No hay secciones completadas con prompts');
    return;
  }
  
  // Limpiar prompts existentes
  allAccumulatedPrompts = [];
  
  // Limpiar el panel lateral
  clearPromptsSidebar();
  
  let totalPrompts = 0;
  
  // Cargar prompts de cada secciÃ³n completada
  project.completedSections.forEach(section => {
    console.log(`ðŸ” Procesando secciÃ³n ${section.section}:`, {
      tienePrompts: !!(section.imagePrompts && section.imagePrompts.length > 0),
      tieneImageUrls: !!(section.imageUrls && section.imageUrls.length > 0),
      esGoogleImages: section.googleImagesMode
    });
    
    if (section.imagePrompts && section.imagePrompts.length > 0) {
      console.log(`ðŸ“‹ Cargando ${section.imagePrompts.length} prompts de la secciÃ³n ${section.section}`);
      
      if (section.googleImagesMode) {
        console.log(`ðŸ”— SecciÃ³n ${section.section} tiene keywords para Google Images`);
        
        // Para Google Images, convertir keywords en URLs clicables
        const googleImageUrls = section.imagePrompts.map((keyword, index) => {
          const encodedKeyword = encodeURIComponent(keyword.trim());
          const googleUrl = `https://www.google.com/search?q=${encodedKeyword}&tbm=isch`;
          return `ðŸ”— <a href="${googleUrl}" target="_blank" style="color: #00bfff; text-decoration: underline;">Buscar: "${keyword.trim()}"</a>`;
        });
        
        addPromptsToSidebar(googleImageUrls, section.section);
        totalPrompts += googleImageUrls.length;
      } else {
        // Prompts normales de imagen
        addPromptsToSidebar(section.imagePrompts, section.section);
        totalPrompts += section.imagePrompts.length;
      }
    } else if (section.imageUrls && section.imageUrls.length > 0) {
      console.log(`ðŸ–¼ï¸ SecciÃ³n ${section.section} tiene ${section.imageUrls.length} URLs de imÃ¡genes generadas`);
      
      // Si tiene URLs pero no prompts, crear prompts genÃ©ricos
      const genericPrompts = section.imageUrls.map((url, index) => `Imagen ${index + 1} generada para la secciÃ³n ${section.section}`);
      addPromptsToSidebar(genericPrompts, section.section);
      totalPrompts += genericPrompts.length;
    } else if (section.googleImagesMode) {
      console.log(`ðŸ”— SecciÃ³n ${section.section} usa Google Images automÃ¡tico`);
      
      // Para Google Images, mostrar un indicador
      const googleImageIndicator = [`SecciÃ³n ${section.section} configurada para usar Google Images automÃ¡tico`];
      addPromptsToSidebar(googleImageIndicator, section.section);
      totalPrompts += 1;
    }
  });
  
  console.log(`âœ… Total de prompts cargados en el panel: ${totalPrompts}`);
  syncSectionImageProgressFromProject(project);
}

// FunciÃ³n para mostrar detalles del proyecto
function showProjectDetails(project) {
  console.log('ðŸ“Š Mostrando detalles del proyecto:', project);
  
  const modal = document.getElementById('projectDetailModal');
  const title = document.getElementById('projectDetailTitle');
  const content = document.getElementById('projectDetailContent');
  
  if (!modal || !title || !content) {
    console.error('âŒ Elementos del modal no encontrados:', { modal: !!modal, title: !!title, content: !!content });
    return;
  }
  
  title.innerHTML = `<i class="fas fa-folder"></i> ${project.folderName}`;
  
  const progress = (project.completedSections.length / project.totalSections) * 100;
  const isComplete = project.completedSections.length >= project.totalSections;
  
  console.log('ðŸ“ˆ Progreso del proyecto:', {
    completed: project.completedSections.length,
    total: project.totalSections,
    progress: progress,
    sections: project.completedSections,
    folderName: project.folderName
  });
  
  content.innerHTML = `
    <div class="project-detail-content">
      <div class="project-overview">
        <h4><i class="fas fa-info-circle"></i> InformaciÃ³n General</h4>
        <div class="overview-grid">
          <div class="overview-item">
            <div class="overview-label">Tema</div>
            <div class="overview-value">${project.topic}</div>
          </div>
          <div class="overview-item">
            <div class="overview-label">Estado</div>
            <div class="overview-value">${isComplete ? 'âœ… Completo' : 'ðŸ”„ En progreso'}</div>
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
            <div class="overview-label">Ãšltima modificaciÃ³n</div>
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
              `âœ… Generados ${project.youtubeMetadata.generatedAt ? 
                `(${new Date(project.youtubeMetadata.generatedAt).toLocaleDateString()})` : ''
              }` : 
              (isComplete ? 'âš ï¸ Disponibles para generar' : 'âŒ No disponibles')
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
              console.log('ðŸ” Procesando secciÃ³n:', section);
              const hasScript = section.script && section.script.length > 0;
              const hasImages = section.hasImages || section.imageUrls?.length > 0 || section.googleImagesMode;
              const imageCount = section.imageUrls?.length || section.imageCount || 0;
              
              return `
              <div class="section-card">
                <div class="section-header">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="section-number">${section.section}</div>
                    <span style="color: #ffffff; font-weight: 600;">SecciÃ³n ${section.section}</span>
                  </div>
                  <div class="section-status-badge completed">Completada</div>
                </div>
                <div class="section-info">
                  <div>ðŸ“ Script: ${hasScript ? 'âœ… Generado' : 'âŒ No disponible'}</div>
                  <div>ðŸ–¼ï¸ ImÃ¡genes: ${hasImages ? (section.googleImagesMode ? 'ðŸ”— Google Images' : `âœ… ${imageCount} imÃ¡genes`) : 'âŒ Sin imÃ¡genes'}</div>
                  <div>ðŸ“… ${section.completedAt ? new Date(section.completedAt).toLocaleDateString() : 'Fecha no disponible'}</div>
                  ${section.prompts?.length > 0 ? `<div>ðŸŽ¨ Prompts: ${section.prompts.length}</div>` : ''}
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
            <p>Genera contenido para ver las secciones aquÃ­</p>
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
    console.log('ðŸŽ¯ Configurando event listeners para', actionButtons.length, 'botones de secciÃ³n,', activateButton ? '1' : '0', 'botÃ³n de activar y', youtubeMetadataButton ? '1' : '0', 'botÃ³n de metadatos');
    
    // Event listeners para botones de secciÃ³n individuales
    actionButtons.forEach(button => {
      const section = button.getAttribute('data-section');
      const folder = button.getAttribute('data-folder');
      const action = button.getAttribute('data-action');
      const projectData = button.getAttribute('data-project');
      
      button.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('ðŸ”„ Click en botÃ³n:', action, 'secciÃ³n:', section);
        
        let projectObj = project; // Usar el proyecto actual por defecto
        
        // Si hay datos del proyecto en el atributo, usarlos
        if (projectData) {
          try {
            projectObj = JSON.parse(projectData);
          } catch (error) {
            console.error('âŒ Error parseando datos del proyecto:', error);
          }
        }
        
        if (action === 'details') {
          loadSectionDetailsWithProject(parseInt(section), folder, projectObj);
        }
      });
    });
    
    // Event listener para el botÃ³n de activar proyecto completo
    if (activateButton) {
      const folder = activateButton.getAttribute('data-folder');
      const projectData = activateButton.getAttribute('data-project');
      
      activateButton.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('ðŸš€ Activando proyecto completo:', folder);
        
        let projectObj = project;
        if (projectData) {
          try {
            projectObj = JSON.parse(projectData);
          } catch (error) {
            console.error('âŒ Error parseando datos del proyecto:', error);
          }
        }
        
        activateFullProject(projectObj);
      });
    }
    
    // Event listener para el botÃ³n de abrir carpeta
    const openFolderButton = content.querySelector('.btn-open-folder');
    if (openFolderButton) {
      const folder = openFolderButton.getAttribute('data-folder');
      
      openFolderButton.addEventListener('click', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('ðŸ“‚ Abriendo carpeta del proyecto:', folder);
        
        try {
          const response = await fetch('/api/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderName: folder })
          });
          
          const result = await response.json();
          
          if (result.success) {
            showNotification(`ðŸ“‚ Carpeta abierta: ${folder}`, 'success');
          } else {
            showNotification('âŒ Error al abrir la carpeta: ' + result.error, 'error');
          }
        } catch (error) {
          console.error('âŒ Error al abrir carpeta:', error);
          showNotification('âŒ Error al abrir la carpeta', 'error');
        }
      });
    }
    
    // Event listener para el botÃ³n de metadatos de YouTube
    if (youtubeMetadataButton) {
      const folder = youtubeMetadataButton.getAttribute('data-folder');
      const topic = youtubeMetadataButton.getAttribute('data-topic');
      const hasMetadata = youtubeMetadataButton.getAttribute('data-has-metadata') === 'true';
      
      youtubeMetadataButton.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('ðŸŽ¬ Click en metadatos YouTube:', { folder, topic, hasMetadata });
        
        if (hasMetadata && project.youtubeMetadata) {
          // Mostrar metadatos existentes
          console.log('ðŸ“½ï¸ Mostrando metadatos existentes');
          closeModal('projectDetailModal');
          showYouTubeMetadataResults(project.youtubeMetadata.content, topic);
          showNotification('ðŸŽ¬ Metadatos de YouTube cargados', 'success');
        } else {
          // Generar nuevos metadatos
          console.log('ðŸŽ¬ Generando nuevos metadatos de YouTube');
          closeModal('projectDetailModal');
          showNotification('ðŸŽ¬ Generando metadatos de YouTube...', 'info');
          
          // Establecer el tema en el campo para que generateYouTubeMetadata funcione
          const promptElement = document.getElementById('prompt');
          if (promptElement) {
            promptElement.value = topic;
          }
          
          // Cargar el proyecto primero para tener acceso a todas las secciones
          loadProject(folder).then(() => {
            setTimeout(() => {
              generateYouTubeMetadata().then(() => {
                showNotification('âœ… Metadatos de YouTube generados exitosamente', 'success');
              }).catch(error => {
                console.error('âŒ Error generando metadatos:', error);
                showNotification('âŒ Error generando metadatos de YouTube', 'error');
              });
            }, 1000);
          }).catch(error => {
            console.error('âŒ Error cargando proyecto:', error);
            showNotification('âŒ Error cargando proyecto', 'error');
          });
        }
      });
    }
  }, 100);
  
  modal.style.display = 'block';
}

// FunciÃ³n para duplicar proyecto
async function duplicateProject(folderName) {
  const newName = prompt('Ingresa el nombre para el proyecto duplicado:');
  if (!newName || !newName.trim()) return;
  
  try {
    showNotification('ðŸ“‹ Duplicando proyecto...', 'info');
    
    const response = await fetch(`/api/projects/${folderName}/duplicate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ newName: newName.trim() })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('âœ… Proyecto duplicado exitosamente', 'success');
      await refreshProjectsList();
    } else {
      showNotification(`âŒ Error: ${data.error}`, 'error');
    }
    
  } catch (error) {
    console.error('âŒ Error duplicando proyecto:', error);
    showNotification('âŒ Error de conexiÃ³n', 'error');
  }
}

// FunciÃ³n para confirmar eliminaciÃ³n de proyecto
function confirmDeleteProject(folderName, projectName) {
  const modal = document.getElementById('confirmDeleteModal');
  const text = document.getElementById('deleteConfirmText');
  const confirmBtn = document.getElementById('confirmDelete');
  
  text.textContent = `Â¿EstÃ¡s seguro de que quieres eliminar el proyecto "${projectName}"? Esta acciÃ³n no se puede deshacer.`;
  
  // Limpiar event listeners anteriores
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  
  // Agregar nuevo event listener
  newConfirmBtn.addEventListener('click', () => deleteProject(folderName));
  
  modal.style.display = 'block';
}

// FunciÃ³n para eliminar proyecto
async function deleteProject(folderName) {
  try {
    showNotification('ðŸ—‘ï¸ Eliminando proyecto...', 'info');
    
    const response = await fetch(`/api/projects/${folderName}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('âœ… Proyecto eliminado exitosamente', 'success');
      await refreshProjectsList();
      closeModal('confirmDeleteModal');
    } else {
      showNotification(`âŒ Error: ${data.error}`, 'error');
    }
    
  } catch (error) {
    console.error('âŒ Error eliminando proyecto:', error);
    showNotification('âŒ Error de conexiÃ³n', 'error');
  }
}

// FunciÃ³n para inicializar modales de proyectos
function initializeProjectModals() {
  console.log('ðŸ”§ Inicializando modales de proyectos...');
  
  // Event listeners para cerrar modales con mÃºltiples mÃ©todos
  document.querySelectorAll('.close').forEach(closeBtn => {
    closeBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('âŒ Cerrando modal via botÃ³n X');
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
      console.log('âŒ Cerrando modal via click fuera');
      event.target.style.display = 'none';
    }
  });
  
  // Botones especÃ­ficos de cerrar para modales de proyecto
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
        console.log(`âŒ Cerrando modal via ${btnId}`);
        const modal = this.closest('.modal');
        if (modal) {
          modal.style.display = 'none';
        }
      });
    }
  });
  
  // BotÃ³n de cancelar eliminaciÃ³n
  const cancelDeleteBtn = document.getElementById('cancelDelete');
  if (cancelDeleteBtn) {
    cancelDeleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal('confirmDeleteModal');
    });
  }
  
  // BotÃ³n de refrescar proyectos
  const refreshBtn = document.getElementById('refreshProjectsList');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';
      await refreshProjectsList();
      refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Actualizar';
    });
  }
  
  // BÃºsqueda de proyectos
  const searchInput = document.getElementById('projectsSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      filterProjects(this.value);
    });
  }
  
  console.log('âœ… Modales de proyectos inicializados');
}

// FunciÃ³n para cerrar modal
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
}

// FunciÃ³n para filtrar proyectos
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

// FunciÃ³n para cargar detalles de una secciÃ³n especÃ­fica
function loadSectionDetails(sectionNumber) {
  if (!currentProject || !currentProject.completedSections) return;
  
  const section = currentProject.completedSections.find(s => s.section === sectionNumber);
  if (section) {
    showLoadedSection(section);
    closeModal('projectDetailModal');
    showNotification(`ðŸ“„ SecciÃ³n ${sectionNumber} cargada`, 'success');
  }
}

console.log('âœ… Sistema de proyectos cargado completamente');

// INICIALIZADOR FINAL DIRECTO - FORZAR EVENTOS
setTimeout(function() {
  console.log('ðŸ”§ INICIALIZADOR FINAL: Configurando eventos directos...');
  
  // Configurar eventos directos como onclick
  const saveBtn = document.getElementById('saveProjectBtn');
  const loadBtn = document.getElementById('loadProjectBtn');
  const manageBtn = document.getElementById('manageProjectsBtn');
  
  if (saveBtn) {
    console.log('âœ… Configurando saveProjectBtn con onclick directo');
    saveBtn.onclick = function(e) {
      console.log('ðŸ’¾ ONCLICK DIRECTO: Guardar Proyecto');
      e.preventDefault();
      saveCurrentProject();
      return false;
    };
  }
  
  if (loadBtn) {
    console.log('âœ… Configurando loadProjectBtn con onclick directo');
    loadBtn.onclick = function(e) {
      console.log('ðŸ“‚ ONCLICK DIRECTO: Cargar Proyecto');
      e.preventDefault();
      showLoadProjectModal();
      return false;
    };
  }
  
  if (manageBtn) {
    console.log('âœ… Configurando manageProjectsBtn con onclick directo');
    manageBtn.onclick = function(e) {
      console.log('ðŸ”§ ONCLICK DIRECTO: Gestionar Proyectos');
      e.preventDefault();
      showManageProjectsModal();
      return false;
    };
  }
  
  // Inicializar modales de proyectos
  initializeProjectModals();
  
  // FORZAR eventos de cerrar modal especÃ­ficamente
  console.log('ðŸ”’ Configurando eventos de cerrar modal...');
  document.querySelectorAll('.close[data-modal]').forEach(closeBtn => {
    const modalId = closeBtn.getAttribute('data-modal');
    console.log(`âš™ï¸ Configurando cierre para modal: ${modalId}`);
    
    closeBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log(`âŒ CERRANDO MODAL: ${modalId}`);
      closeModal(modalId);
      return false;
    };
  });
  
  console.log('ðŸŽ¯ Eventos onclick directos configurados');
}, 3000);

// FunciÃ³n para activar un proyecto completo con navegaciÃ³n
function activateFullProject(projectData) {
  console.log('ðŸš€ Activando proyecto completo:', projectData);
  
  if (!projectData || !projectData.completedSections) {
    console.error('âŒ Datos del proyecto no vÃ¡lidos');
    showNotification('âŒ Datos del proyecto no vÃ¡lidos', 'error');
    return;
  }
  
  isLoadingProject = true; // Activar bandera de carga
  
  // Cargar el proyecto completo
  loadProject(projectData.folderName).then(() => {
    console.log('âœ… Proyecto cargado, configurando navegaciÃ³n completa');
    
    // Configurar allSections con todas las secciones completadas
    allSections = new Array(projectData.totalSections);
    // Para el botÃ³n continuar, currentSectionNumber debe ser el nÃºmero de secciones completadas
    currentSectionNumber = projectData.completedSections.length;
    
    // TambiÃ©n actualizar variables globales
    currentTopic = projectData.topic;
    totalSections = projectData.totalSections;
    
    console.log('ðŸ“Š Variables de navegaciÃ³n configuradas:', {
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
    
    console.log('ï¿½ NavegaciÃ³n configurada:', allSections.map((s, i) => s ? `${i+1}: âœ…` : `${i+1}: âŒ`).join(', '));
    
    // Buscar la primera secciÃ³n disponible
    let firstAvailableSection = projectData.completedSections.find(s => s.script);
    if (firstAvailableSection) {
      currentSectionNumber = firstAvailableSection.section;
      
      // Mostrar la primera secciÃ³n disponible
      showScript(firstAvailableSection.script, firstAvailableSection.section, projectData.totalSections);
      
      // Asegurar que la secciÃ³n del script sea visible
      const scriptSection = document.getElementById("script-section");
      if (scriptSection) {
        scriptSection.style.display = 'block';
      }
      
      // Configurar navegaciÃ³n
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
      
      // Actualizar botones segÃºn el estado del proyecto
      updateProjectButtons(projectData);
      
      showNotification(`ðŸš€ Proyecto "${projectData.folderName}" activado. Usa â† â†’ para navegar entre secciones.`, 'success');
    } else {
      showNotification('âŒ No hay secciones con script disponibles', 'error');
    }
    
    isLoadingProject = false; // Desactivar bandera de carga al finalizar
  }).catch(error => {
    console.error('âŒ Error cargando proyecto:', error);
    showNotification('âŒ Error cargando proyecto', 'error');
    isLoadingProject = false; // Desactivar bandera en caso de error
  });
}

// FunciÃ³n para actualizar botones segÃºn el estado del proyecto
function updateProjectButtons(project) {
  console.log('ðŸ”„ Actualizando botones del proyecto:', project);
  
  // Validar que el proyecto tenga la estructura esperada
  if (!project || typeof project !== 'object') {
    console.error('âŒ Proyecto no vÃ¡lido:', project);
    return;
  }
  
  if (!project.completedSections || !Array.isArray(project.completedSections)) {
    console.error('âŒ completedSections no vÃ¡lido:', project.completedSections);
    return;
  }
  
  if (!project.totalSections || typeof project.totalSections !== 'number') {
    console.error('âŒ totalSections no vÃ¡lido:', project.totalSections);
    return;
  }
  
  const generateBtn = document.getElementById("generateBtn");
  const generateAudioBtn = document.getElementById("generateAudioBtn");
  const generateImagesControls = document.getElementById('generateMissingImagesControls');
  const generateImagesBtn = document.getElementById('generateMissingImagesBtn');
  
  if (!generateBtn || !generateAudioBtn) {
    console.error('âŒ Botones no encontrados en el DOM');
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
  
  // âš ï¸ CRÃTICO: Actualizar variables globales para que coincidan con el estado del proyecto
  currentSectionNumber = completedSections;
  currentTopic = project.topic;
  window.totalSections = totalSections;
  window.currentSectionNumber = completedSections;
  window.currentTopic = project.topic;
  
  console.log('ðŸ“Š Estado del proyecto:', {
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
    // No hay secciones completadas - mostrar botÃ³n de generar primera secciÃ³n
    generateBtn.style.display = "inline-flex";
    generateBtn.innerHTML = `
      <i class="fas fa-video"></i>
      <span>Generar SecciÃ³n 1</span>
    `;
  } else if (completedSections < totalSections) {
    // Hay secciones completadas pero no todas - mostrar botÃ³n de audio para la secciÃ³n actual
    generateAudioBtn.style.display = "inline-flex";
  } else {
    // Todas las secciones estÃ¡n completadas - mostrar botÃ³n de audio y botÃ³n de video
    generateAudioBtn.style.display = "inline-flex";
    
    // Mostrar botÃ³n de generaciÃ³n de video manual
    showVideoGenerationButton();
    
    // ðŸŽ¬ VERIFICAR GENERACIÃ“N AUTOMÃTICA DE VIDEO
    // Solo generar automÃ¡ticamente si no se ha generado ya y estÃ¡ activada la opciÃ³n
    if (shouldGenerateVideoAutomatically()) {
      const folderName = document.getElementById("folderName").value.trim();
      if (folderName && !isGeneratingVideo) {
        console.log('ðŸŽ¬ Proyecto completo - iniciando generaciÃ³n automÃ¡tica de video...');
        // Delay para permitir que se complete la visualizaciÃ³n del proyecto
        setTimeout(() => {
          generateVideoAutomatically();
        }, 2000);
      }
    }
  }
  
  // Siempre mostrar el botÃ³n de regenerar audios cuando hay un proyecto cargado
  // (independientemente del estado de completado)
  if (window.currentProject) {
    // Solo mostrar el contenedor de video si no hay mÃºltiples proyectos paralelos
    const hasMultipleProjects = projectProgressContainers.size > 1;
    if (!hasMultipleProjects) {
      const videoContainer = document.getElementById('videoGenerationContainer');
      if (videoContainer) {
        videoContainer.style.display = 'block';
      }
    }
    
    // Actualizar visibility del botÃ³n de regenerar audios
    const regenerateAudioBtn = document.getElementById('regenerateApplioAudiosBtn');
    if (regenerateAudioBtn) {
      regenerateAudioBtn.style.display = 'inline-flex';
      console.log('ðŸŽ¤ BotÃ³n de regenerar audios mostrado para proyecto cargado');
    }
    
    // Actualizar visibility del botÃ³n de regenerar guiones
    const regenerateScriptsBtn = document.getElementById('regenerateMissingScriptsBtn');
    if (regenerateScriptsBtn) {
      regenerateScriptsBtn.style.display = 'inline-flex';
      console.log('ðŸ“ BotÃ³n de regenerar guiones mostrado para proyecto cargado');
    }
    
    // Actualizar visibility del botÃ³n de generar imÃ¡genes faltantes
    if (generateImagesBtn) {
      generateImagesBtn.style.display = 'inline-flex';
      console.log('ðŸ–¼ï¸ BotÃ³n de generar imÃ¡genes mostrado para proyecto cargado');
    }
    if (generateImagesControls) {
      generateImagesControls.style.display = 'flex';
    }
    
    // Actualizar visibility del botÃ³n de generar solo prompts
    const generatePromptsBtn = document.getElementById('generateMissingPromptsBtn');
    if (generatePromptsBtn) {
      generatePromptsBtn.style.display = 'inline-flex';
      console.log('ðŸ“ BotÃ³n de generar prompts mostrado para proyecto cargado');
    }

    // Actualizar visibility del panel de traducciÃ³n
    const translationPanel = document.getElementById('translationPanel');
    if (translationPanel) {
      translationPanel.style.display = 'block';
      console.log('ðŸŒ Panel de traducciÃ³n mostrado para proyecto cargado');
    }

    updateSectionClipButtons(project);
    updateSectionImageButtons(project);
    updateYouTubeMetadataButtonState();
  }
  
  console.log('âœ… Botones actualizados correctamente');
}

// FunciÃ³n auxiliar para cargar prompts en el sidebar
function loadPromptsInSidebar(prompts, sectionNumber) {
  console.log('ðŸŽ¨ Cargando prompts en panel lateral');
  
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
        <h4>ðŸŽ¨ Prompts de SecciÃ³n ${sectionNumber}</h4>
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

// FunciÃ³n para obtener el estado actual del proyecto
function getCurrentProjectState() {
  console.log('ðŸ“‹ Obteniendo estado del proyecto actual:', window.currentProject);
  return window.currentProject;
}

// FunciÃ³n para cargar detalles de una secciÃ³n especÃ­fica con datos del proyecto
function loadSectionDetailsWithProject(sectionNumber, folderName, projectData) {
  console.log('ðŸ” Cargando detalles de secciÃ³n con proyecto:', sectionNumber, folderName, projectData);
  
  isLoadingProject = true; // Activar bandera de carga
  
  if (!projectData || !projectData.completedSections) {
    console.error('âŒ Datos del proyecto no vÃ¡lidos');
    showNotification('âŒ Datos del proyecto no vÃ¡lidos', 'error');
    isLoadingProject = false; // Desactivar en caso de error
    return;
  }
  
  const section = projectData.completedSections.find(s => s.section === sectionNumber);
  if (!section) {
    console.error('âŒ SecciÃ³n no encontrada:', sectionNumber);
    showNotification('âŒ SecciÃ³n no encontrada', 'error');
    isLoadingProject = false; // Desactivar en caso de error
    return;
  }
  
  console.log('ðŸ“‹ Datos de la secciÃ³n encontrada:', section);
  
  // Crear modal para mostrar detalles de la secciÃ³n
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'block';
  modal.innerHTML = `
    <div class="modal-content section-detail-modal">
      <div class="modal-header">
        <h3><i class="fas fa-file-alt"></i> SecciÃ³n ${sectionNumber} - Detalles</h3>
        <span class="close" onclick="closeSectionModal()">&times;</span>
      </div>
      
      <div class="section-detail-content">
        <div class="detail-tabs">
          <button class="detail-tab active" onclick="showSectionTab(event, 'script-tab')">
            <i class="fas fa-file-text"></i> Script
          </button>
          <button class="detail-tab" onclick="showSectionTab(event, 'images-tab')">
            <i class="fas fa-images"></i> ImÃ¡genes
          </button>
          <button class="detail-tab" onclick="showSectionTab(event, 'prompts-tab')">
            <i class="fas fa-palette"></i> Prompts
          </button>
        </div>
        
        <div id="script-tab" class="tab-content active">
          <h4>ðŸŽ¬ Script Generado</h4>
          <div class="script-content">
            ${section.script ? 
              `<pre class="script-text">${section.script}</pre>` : 
              '<p class="no-content">âŒ No hay script generado para esta secciÃ³n</p>'
            }
          </div>
        </div>
        
        <div id="images-tab" class="tab-content">
          <h4>ðŸ–¼ï¸ GestiÃ³n de ImÃ¡genes</h4>
          <div class="images-content">
            ${section.googleImagesMode ? `
              <div class="google-images-info">
                <p><strong>ðŸ”— Modo Google Images activado</strong></p>
                <p>Las imÃ¡genes se buscarÃ¡n automÃ¡ticamente desde Google Images</p>
                ${section.keywords ? `<p><strong>Keywords:</strong> ${section.keywords.join(', ')}</p>` : ''}
              </div>
            ` : section.imageUrls && section.imageUrls.length > 0 ? `
              <div class="generated-images">
                <p><strong>ðŸ“Š ImÃ¡genes generadas: ${section.imageUrls.length}</strong></p>
                <div class="image-grid">
                  ${section.imageUrls.map((url, index) => `
                    <div class="image-item">
                      <img src="${url}" alt="Imagen ${index + 1}" onclick="window.open('${url}', '_blank')">
                      <div class="image-info">Imagen ${index + 1}</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : '<p class="no-content">âŒ No hay imÃ¡genes para esta secciÃ³n</p>'}
          </div>
        </div>
        
        <div id="prompts-tab" class="tab-content">
          <h4>ðŸŽ¨ Prompts de Imagen</h4>
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
            ` : '<p class="no-content">âŒ No hay prompts generados para esta secciÃ³n</p>'}
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

// FunciÃ³n para cargar una secciÃ³n especÃ­fica en el editor con datos del proyecto
function loadProjectSectionWithProject(sectionNumber, folderNameOrProject) {
  console.log('ðŸ“¥ Cargando secciÃ³n en editor:', sectionNumber, folderNameOrProject);
  
  // Si es un string, es el folderName, cargar el proyecto completo
  if (typeof folderNameOrProject === 'string') {
    console.log('ðŸ“‚ Cargando proyecto:', folderNameOrProject);
    loadProject(folderNameOrProject).then(() => {
      // DespuÃ©s de cargar el proyecto, cargar la secciÃ³n especÃ­fica
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
      console.error('âŒ Datos del proyecto no vÃ¡lidos');
      showNotification('âŒ Datos del proyecto no vÃ¡lidos', 'error');
      return;
    }
    
    const section = projectData.completedSections.find(s => s.section === sectionNumber);
    if (!section) {
      console.error('âŒ SecciÃ³n no encontrada:', sectionNumber);
      showNotification('âŒ SecciÃ³n no encontrada', 'error');
      return;
    }
    
    // Primero cargar el proyecto si no estÃ¡ activo
    if (!window.currentProject || window.currentProject.folderName !== projectData.folderName) {
      console.log('ðŸ“‚ Cargando proyecto antes de cargar secciÃ³n');
      loadProject(projectData.folderName).then(() => {
        // DespuÃ©s de cargar el proyecto, cargar la secciÃ³n
        loadProjectSectionData(sectionNumber, section);
      });
    } else {
      // Si el proyecto ya estÃ¡ activo, cargar directamente la secciÃ³n
      loadProjectSectionData(sectionNumber, section);
    }
  }
}

// FunciÃ³n auxiliar para cargar datos de secciÃ³n
function loadProjectSectionData(sectionNumber, section) {
  console.log('ðŸ“‹ Cargando datos de secciÃ³n en interfaz:', sectionNumber, section);
  
  // Actualizar variables globales
  if (window.currentProject) {
    // Para el botÃ³n continuar, currentSectionNumber debe ser el nÃºmero de secciones completadas
    currentSectionNumber = window.currentProject.completedSections.length;
    window.currentSectionNumber = window.currentProject.completedSections.length;
    window.totalSections = window.currentProject.totalSections;
    window.currentTopic = window.currentProject.topic;
    
    // TambiÃ©n actualizar variables globales para compatibilidad
    currentTopic = window.currentProject.topic;
    totalSections = window.currentProject.totalSections;
    
    console.log('ðŸ“Š Variables actualizadas en loadProjectSectionData:', {
      currentSectionNumber,
      totalSections,
      completedSections: window.currentProject.completedSections.length,
      showingSection: sectionNumber
    });
    
    // Configurar allSections para la navegaciÃ³n
    allSections = new Array(window.currentProject.totalSections); // Usar variable global directa
    
    // Llenar allSections con los scripts de las secciones completadas
    window.currentProject.completedSections.forEach(completedSection => {
      if (completedSection.script) {
        allSections[completedSection.section - 1] = completedSection.script;
      }
    });
    
    console.log('ðŸ“š allSections configurado:', allSections.map((s, i) => s ? `${i+1}: âœ…` : `${i+1}: âŒ`).join(', '));
  }
  
  // Actualizar el Ã¡rea del script principal usando la funciÃ³n existente
  if (section.script) {
    console.log('ðŸ“ Mostrando script en interfaz');
    // Usar la funciÃ³n existente para mostrar el script
    showScript(section.script, sectionNumber, window.totalSections || 3);
    
    // Asegurar que la secciÃ³n del script sea visible
    const scriptSection = document.getElementById("script-section");
    if (scriptSection) {
      scriptSection.style.display = 'block';
    }
    
    // Inicializar navegaciÃ³n entre secciones
    setTimeout(() => {
      initializeSectionNavigation();
      updateNavigationButtons();
    }, 200);
  }
  
  // Actualizar el tema si existe el campo
  const promptArea = document.getElementById('prompt');
  if (promptArea && window.currentProject) {
    promptArea.value = window.currentProject.topic;
    console.log('ðŸ“ Tema del guiÃ³n actualizado en secciÃ³n:', window.currentProject.topic);
  } else {
    console.warn('âš ï¸ No se pudo actualizar el tema del guiÃ³n - elemento:', !!promptArea, 'proyecto:', !!window.currentProject);
  }
  
  // Cargar configuraciÃ³n de checkboxes desde el proyecto actual
  if (window.currentProject) {
    const skipImagesElement = document.getElementById('skipImages');
    if (skipImagesElement && typeof window.currentProject.skipImages === 'boolean') {
      skipImagesElement.checked = window.currentProject.skipImages;
      console.log('ðŸš« Skip imÃ¡genes actualizado en secciÃ³n:', window.currentProject.skipImages);
    }
    
    const googleImagesElement = document.getElementById('googleImages');
    if (googleImagesElement && typeof window.currentProject.googleImages === 'boolean') {
      googleImagesElement.checked = window.currentProject.googleImages;
      console.log('ðŸ”— Google Images actualizado en secciÃ³n:', window.currentProject.googleImages);
    }
  }
  
  // Cargar prompts en el panel lateral si existen
  if (section.imagePrompts && section.imagePrompts.length > 0) {
    console.log(`ðŸŽ¨ Cargando ${section.imagePrompts.length} prompts de la secciÃ³n ${sectionNumber} en panel lateral`);
    
    // Limpiar el panel antes de cargar nuevos prompts de una secciÃ³n especÃ­fica
    clearPromptsSidebar();
    
    // Usar la funciÃ³n estÃ¡ndar para aÃ±adir prompts
    addPromptsToSidebar(section.imagePrompts, sectionNumber);
    
  } else if (section.imageUrls && section.imageUrls.length > 0) {
    console.log(`ðŸ–¼ï¸ SecciÃ³n ${sectionNumber} tiene ${section.imageUrls.length} URLs de imÃ¡genes generadas`);
    
    // Si tiene URLs pero no prompts, crear prompts genÃ©ricos
    const genericPrompts = section.imageUrls.map((url, index) => `Imagen ${index + 1} - URL: ${url}`);
    clearPromptsSidebar();
    addPromptsToSidebar(genericPrompts, sectionNumber);
    
  } else if (section.googleImagesMode) {
    console.log(`ðŸ”— SecciÃ³n ${sectionNumber} configurada para Google Images automÃ¡tico`);
    
    // Para Google Images, mostrar un indicador
    const googleImageIndicator = [`SecciÃ³n ${sectionNumber} configurada para usar Google Images automÃ¡tico`];
    clearPromptsSidebar();
    addPromptsToSidebar(googleImageIndicator, sectionNumber);
  }
  
  // Actualizar modo de imÃ¡genes si estÃ¡ activado
  if (section.googleImagesMode) {
    const useGoogleImagesCheckbox = document.getElementById('useGoogleImages');
    if (useGoogleImagesCheckbox) {
      useGoogleImagesCheckbox.checked = true;
    }
  }
  
  // Mostrar informaciÃ³n sobre las imÃ¡genes
  if (section.imageUrls && section.imageUrls.length > 0) {
    console.log('ðŸ–¼ï¸ Mostrando informaciÃ³n de imÃ¡genes generadas');
    
    // Mostrar carrusel de imÃ¡genes si existe la funciÃ³n
    if (typeof showImageCarousel === 'function') {
      showImageCarousel(section.imageUrls, sectionNumber);
    } else {
      // Mostrar carrusel bÃ¡sico
      const carouselContainer = document.getElementById('carousel-container');
      if (carouselContainer) {
        carouselContainer.style.display = 'block';
        const carouselTrack = document.getElementById('carouselTrack');
        const carouselTitle = document.getElementById('carousel-section-title');
        const totalImagesSpan = document.getElementById('total-images');
        const currentImageSpan = document.getElementById('current-image');
        
        if (carouselTitle) {
          carouselTitle.textContent = `SecciÃ³n ${sectionNumber}`;
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
    
    showNotification(`ðŸ“¸ SecciÃ³n ${sectionNumber} tiene ${section.imageUrls.length} imÃ¡genes generadas`, 'info');
  } else if (section.googleImagesMode) {
    console.log('ðŸ”— Modo Google Images activado para esta secciÃ³n');
    showNotification(`ðŸ”— SecciÃ³n ${sectionNumber} usa Google Images automÃ¡tico`, 'info');
  }
  
  // Cerrar modal
  closeSectionModal();
  
  // Actualizar estado de los botones segÃºn el progreso del proyecto
  updateProjectButtons(window.currentProject);
  
  showNotification(`âœ… SecciÃ³n ${sectionNumber} cargada en editor`, 'success');
}

// FunciÃ³n para cerrar modal de secciÃ³n
function closeSectionModal() {
  const modal = document.querySelector('.section-detail-modal');
  if (modal) {
    modal.closest('.modal').remove();
  }
}

// Exponer funciones globalmente
window.loadSectionDetails = loadSectionDetails;
window.closeSectionModal = closeSectionModal;

// FunciÃ³n para cambiar entre tabs del detalle de secciÃ³n
function showSectionTab(event, tabId) {
  console.log('ðŸ”„ Cambiando a tab:', tabId);
  // Remover clase active de todos los tabs
  document.querySelectorAll('.detail-tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  // Activar el tab seleccionado
  event.target.closest('.detail-tab').classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

// FunciÃ³n para cargar una secciÃ³n especÃ­fica en el editor
function loadProjectSection(sectionNumber) {
  console.log('ðŸ“¥ Cargando secciÃ³n en editor:', sectionNumber);
  
  const projectState = getCurrentProjectState();
  if (!projectState) {
    console.error('âŒ No hay proyecto activo');
    showNotification('âŒ No hay proyecto activo', 'error');
    return;
  }
  
  const section = projectState.completedSections.find(s => s.section === sectionNumber);
  if (!section) {
    console.error('âŒ SecciÃ³n no encontrada:', sectionNumber);
    showNotification('âŒ SecciÃ³n no encontrada', 'error');
    return;
  }
  
  // Actualizar el nÃºmero de secciÃ³n actual
  const sectionInput = document.getElementById('sectionNumber');
  if (sectionInput) {
    sectionInput.value = sectionNumber;
  }
  
  // Cargar el script en el Ã¡rea de texto
  const scriptArea = document.getElementById('script');
  if (scriptArea && section.script) {
    scriptArea.value = section.script;
    // Ajustar altura del textarea
    scriptArea.style.height = 'auto';
    scriptArea.style.height = scriptArea.scrollHeight + 'px';
  }
  
  // Actualizar modo de imÃ¡genes
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
  
  showNotification(`âœ… SecciÃ³n ${sectionNumber} cargada en editor`, 'success');
}

// FunciÃ³n para auto-redimensionar textareas
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

// FunciÃ³n para actualizar el tÃ­tulo del capÃ­tulo
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
  
  // Ocultar si no hay tÃ­tulo disponible
  chapterTitleContainer.style.display = 'none';
}

// FunciÃ³n para almacenar la estructura de capÃ­tulos cuando se recibe del servidor
function storeChapterStructure(chapterStructure) {
  globalChapterStructure = chapterStructure || [];
  console.log('ðŸ“š Estructura de capÃ­tulos almacenada:', globalChapterStructure.length, 'capÃ­tulos');
}

// FunciÃ³n para actualizar la informaciÃ³n de tokens
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
    
    console.log('ðŸ“Š InformaciÃ³n de tokens actualizada:', tokenUsage);
  } else {
    tokenContainer.style.display = 'none';
  }
}

// Exponer funciÃ³n globalmente
window.updateTokenUsage = updateTokenUsage;

// Exponer funciones globalmente
window.updateChapterTitle = updateChapterTitle;
window.storeChapterStructure = storeChapterStructure;

// =====================================
// FUNCIONES ADICIONALES PARA IMÃGENES DE BING
// =====================================

function downloadBingImage(imageUrl, filename) {
  console.log(`ðŸ“¥ Descargando imagen: ${filename}`);
  
  const link = document.createElement('a');
  link.href = imageUrl;
  link.download = filename || 'bing_image.jpg';
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function showBingImageFullscreen(imageUrl, caption) {
  console.log(`ðŸ–¼ï¸ Mostrando imagen en pantalla completa: ${caption}`);
  
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

// FunciÃ³n para refrescar una imagen especÃ­fica
async function refreshBingImage(imageIndex, sectionNum) {
  console.log(`ðŸ”„ Refrescando imagen ${imageIndex} de la secciÃ³n ${sectionNum}`);
  
  // Verificar que tenemos keywords para esta imagen
  if (!currentImageKeywords || !currentImageKeywords[imageIndex]) {
    console.error(`âŒ No hay keywords disponibles para la imagen ${imageIndex}`);
    console.log(`ðŸ” DEBUG - currentImageKeywords:`, currentImageKeywords);
    console.log(`ðŸ” DEBUG - imageIndex:`, imageIndex);
    alert('No se pueden obtener nuevas keywords para esta imagen. Por favor, genera el contenido nuevamente.');
    return;
  }
  
  // Obtener el nombre de la carpeta actual del proyecto cargado
  let folderName;
  if (window.currentProject && window.currentProject.folderName) {
    folderName = window.currentProject.folderName;
    console.log(`ðŸ“ Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    const folderNameElement = document.getElementById('folderName');
    if (!folderNameElement) {
      console.error('âŒ No se pudo obtener el nombre del proyecto');
      alert('Error: No se pudo obtener el nombre del proyecto');
      return;
    }
    folderName = folderNameElement.value.trim();
    console.log(`ðŸ“ Usando folderName del elemento HTML: ${folderName}`);
  }
  
  // Obtener las imÃ¡genes actuales del carrusel para mantener mapeo correcto
  const currentImages = [];
  const carouselSlides = document.querySelectorAll('.carousel-slide img');
  carouselSlides.forEach(img => {
    currentImages.push({
      url: img.src.split('?')[0], // Remover query params para obtener URL limpia
      alt: img.alt
    });
  });
  
  console.log(`ðŸŽ¯ ImÃ¡genes actuales detectadas:`, currentImages.map((img, i) => `${i}: ${img.url.split('/').pop()}`));
  console.log(`ðŸŽ¯ Refrescando imagen en posiciÃ³n visual ${imageIndex}: ${currentImages[imageIndex]?.url.split('/').pop()}`);
  
  try {
    // Mostrar indicador de carga en el botÃ³n
    const refreshButton = document.querySelector(`[onclick="refreshBingImage(${imageIndex}, ${sectionNum})"]`);
    if (refreshButton) {
      refreshButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      refreshButton.disabled = true;
    }
    
    // Hacer peticiÃ³n al backend para refrescar la imagen
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
        currentImages: currentImages // Enviar mapeo actual de imÃ¡genes
      })
    });
    
    if (!response.ok) {
      throw new Error(`Error del servidor: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`âœ… Nueva imagen descargada: ${result.newImage.filename}`);
      console.log(`ðŸŽ¯ Mapeo confirmado: posiciÃ³n visual ${imageIndex} â†’ ${result.newImage.filename}`);
      
      // Actualizar la imagen en el carrusel con efecto visual
      const currentSlideImg = document.querySelector('.carousel-slide:nth-child(' + (imageIndex + 1) + ') img');
      if (currentSlideImg) {
        // AÃ±adir efecto de transiciÃ³n suave
        currentSlideImg.style.opacity = '0.3';
        currentSlideImg.style.transition = 'opacity 0.3s ease';
        
        // Crear nueva imagen para precargar
        const newImg = new Image();
        newImg.onload = function() {
          // Una vez cargada la nueva imagen, actualizar con timestamp para evitar cache
          currentSlideImg.src = result.newImage.url + '?t=' + Date.now();
          currentSlideImg.alt = `Nueva imagen ${imageIndex + 1} de la SecciÃ³n ${sectionNum}`;
          
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
      
      // Mostrar notificaciÃ³n de Ã©xito
      showNotification('âœ… Imagen renovada exitosamente', 'success');
      
    } else {
      throw new Error(result.error || 'Error desconocido');
    }
    
  } catch (error) {
    console.error(`âŒ Error refrescando imagen:`, error);
    showNotification(`âŒ Error renovando imagen: ${error.message}`, 'error');
  } finally {
    // Restaurar el botÃ³n
    const refreshButton = document.querySelector(`[onclick="refreshBingImage(${imageIndex}, ${sectionNum})"]`);
    if (refreshButton) {
      refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i>';
      refreshButton.disabled = false;
    }
  }
}

// FunciÃ³n para refrescar una imagen con keyword personalizado
async function refreshBingImageWithCustomKeyword(imageIndex, sectionNum) {
  console.log(`ðŸ”„ Refrescando imagen ${imageIndex} de la secciÃ³n ${sectionNum} con keyword personalizado`);
  
  // Obtener el keyword del input field
  const keywordInput = document.getElementById(`keyword-${imageIndex}-${sectionNum}`);
  if (!keywordInput) {
    console.error(`âŒ No se encontrÃ³ el input de keyword para imagen ${imageIndex}`);
    alert('Error: No se pudo obtener el tÃ©rmino de bÃºsqueda');
    return;
  }
  
  const customKeyword = keywordInput.value.trim();
  if (!customKeyword) {
    alert('Por favor, ingresa un tÃ©rmino de bÃºsqueda antes de refrescar la imagen');
    return;
  }
  
  // Obtener el nombre de la carpeta actual del proyecto cargado
  let folderName;
  if (window.currentProject && window.currentProject.folderName) {
    folderName = window.currentProject.folderName;
    console.log(`ðŸ“ Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    const folderNameElement = document.getElementById('folderName');
    if (!folderNameElement) {
      console.error('âŒ No se pudo obtener el nombre del proyecto');
      alert('Error: No se pudo obtener el nombre del proyecto');
      return;
    }
    folderName = folderNameElement.value.trim();
    console.log(`ðŸ“ Usando folderName del elemento HTML: ${folderName}`);
  }
  
  // Obtener las imÃ¡genes actuales del carrusel para mantener mapeo correcto
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
  
  console.log(`ðŸŽ¯ ImÃ¡genes actuales detectadas:`, currentImages.map((img, i) => `${i}: ${img.filename}`));
  console.log(`ðŸŽ¯ Refrescando imagen en posiciÃ³n visual ${imageIndex}: ${currentImages[imageIndex]?.filename}`);
  
  try {
    // Mostrar indicador de carga en el botÃ³n
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
      console.log(`âœ… Nueva imagen descargada: ${result.filename}`);
      console.log(`ðŸŽ¯ Mapeo confirmado: posiciÃ³n visual ${imageIndex} â†’ ${result.filename}`);
      
      // Actualizar la imagen en el carrusel
      const currentSlide = document.querySelectorAll('.carousel-slide')[imageIndex];
      if (currentSlide) {
        const img = currentSlide.querySelector('img');
        if (img) {
          // Agregar timestamp para evitar cachÃ©
          const timestamp = new Date().getTime();
          img.src = `${result.newImageUrl}?t=${timestamp}`;
          
          // Actualizar el keyword almacenado
          if (currentImageKeywords && currentImageKeywords[imageIndex]) {
            currentImageKeywords[imageIndex] = customKeyword;
            console.log(`ðŸŽ¯ Keyword actualizado: posiciÃ³n ${imageIndex} â†’ "${customKeyword}"`);
          }
        }
      }
      
      showNotification(`âœ… Imagen ${imageIndex + 1} renovada exitosamente con "${customKeyword}"`, 'success');
    } else {
      throw new Error(`Error del servidor: ${response.status}`);
    }
    
  } catch (error) {
    console.error(`âŒ Error refrescando imagen:`, error);
    showNotification(`âŒ Error renovando imagen: ${error.message}`, 'error');
  } finally {
    // Restaurar el botÃ³n
    const refreshButton = document.querySelector(`[onclick="refreshBingImageWithCustomKeyword(${imageIndex}, ${sectionNum})"]`);
    if (refreshButton) {
      refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i>';
      refreshButton.disabled = false;
    }
  }
}

// Exponer la nueva funciÃ³n globalmente
window.refreshBingImage = refreshBingImage;
window.showBingImageFullscreen = showBingImageFullscreen;
window.closeBingImageModal = closeBingImageModal;

// ================================
// FUNCIONES PARA GENERACIÃ“N DE VIDEO
// ================================

// FunciÃ³n para verificar si se debe generar video automÃ¡ticamente
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
    console.error('âŒ Error consultando progreso de clips:', error);
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
    
    // Si el proceso general estÃ¡ completado y el clip no tiene status de error, marcar como generated
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
        ? `âš ï¸ ${progress.error}`
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
        ? `âŒ Error generando clips: ${progress.error}`
        : 'âŒ Error generando clips';
    } else if (status === 'completed') {
      summary.textContent = progress.message || `âœ… ${total}/${total} clips listos`;
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
      title.textContent = section.name || `SecciÃ³n ${section.sectionNumber}`;
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
        skippedLabel.textContent = parts.join(' Â· ');
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

  // Si el proceso estÃ¡ completado, asegurar que todas las cÃ¡psulas se marquen como generated
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
      // Forzar que todas las cÃ¡psulas se muestren como generated
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
      if (progressPayload.error && !/sesiÃ³n no encontrada/i.test(progressPayload.error)) {
        renderClipProgress(progressPayload);
      }
      return;
    }

    const progress = progressPayload.progress || progressPayload;
    renderClipProgress(progress);

    if (progress && (progress.status === 'completed' || progress.status === 'failed')) {
      // Hacer una consulta final para asegurar que tengamos el estado mÃ¡s reciente
      const finalProgressPayload = await fetchClipProgressState(clipProgressUiState.sessionId);
      if (finalProgressPayload && finalProgressPayload.success !== false) {
        const finalProgress = finalProgressPayload.progress || finalProgressPayload;
        // Forzar status completed para asegurar que las cÃ¡psulas se marquen correctamente
        finalProgress.status = progress.status;
        renderClipProgress(finalProgress);
      }
      stopClipProgressTracking({
        keepVisible: true,
        finalStatus: progress.status,
        finalMessage: progress.status === 'failed'
          ? (progress.error ? `âŒ ${progress.error}` : 'âŒ Error generando clips')
          : (progress.message || `âœ… ${progress.total || progress.completed}/${progress.total} clips listos`)
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
      <span>SecciÃ³n ${sectionNumber}</span>
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
    console.warn('âš ï¸ NÃºmero de secciÃ³n invÃ¡lido para generar clip:', button?.dataset);
    return;
  }

  if (isGeneratingVideo) {
    showNotification('âš ï¸ Ya hay una generaciÃ³n en progreso. Espera a que termine antes de generar otro clip.', 'info');
    return;
  }

  let folderName;

  if (window.currentProject && window.currentProject.folderName) {
    folderName = window.currentProject.folderName;
    console.log(`ðŸŽ¯ Usando folderName del proyecto cargado: ${folderName}`);
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

    console.log(`ðŸ”§ Normalizando folderName: "${inputFolderName}" â†’ "${folderName}"`);
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
    name.textContent = `SecciÃ³n ${sectionNumber}`;

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
      button.innerHTML = `<i class="fas fa-images"></i><span>SecciÃ³n ${sectionNumber}</span>`;
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
      summary.textContent = `${totalSections} secciones Â· ${totalFilled}/${totalCapsules || 1} imÃ¡genes listas`;
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
        console.warn(`âš ï¸ No se pudo actualizar progreso de imÃ¡genes para secciÃ³n ${sectionNumber}:`, error);
        return fallback;
      }
    }));

    if (sectionImageProgressState.updateToken !== updateToken) {
      return;
    }

    renderSectionImageProgressColumns(resolvedStats);
  } catch (error) {
    console.warn('âš ï¸ Error refrescando progreso de imÃ¡genes:', error);
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
      console.warn('âš ï¸ Error actualizando barras de imÃ¡genes durante el polling:', error);
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
      console.warn('âš ï¸ Error actualizando barras de progreso de imÃ¡genes:', error);
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
    console.warn('âš ï¸ NÃºmero de secciÃ³n invÃ¡lido para generar imÃ¡genes:', button?.dataset);
    return;
  }

  if (isGeneratingImages) {
    showNotification('âš ï¸ Ya hay una generaciÃ³n de imÃ¡genes en progreso. Espera a que termine antes de iniciar otra.', 'info');
    return;
  }

  let folderName;

  if (window.currentProject && window.currentProject.folderName) {
    folderName = window.currentProject.folderName;
    console.log(`ðŸŽ¯ Usando folderName del proyecto cargado: ${folderName}`);
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

    console.log(`ðŸ”§ Normalizando folderName: "${inputFolderName}" â†’ "${folderName}"`);
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

    // Obtener imageCount del selector o proyecto o configuraciÃ³n por defecto
    let imageCount = parseInt(document.getElementById("imagesSelect")?.value) || projectData?.imageCount || 10;

    // Actualizar el proyecto con el nuevo imageCount si cambiÃ³
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

    console.log(`ðŸ“ Generando prompts faltantes para proyecto: ${folderName}`);

    // Obtener configuraciones para imÃ¡genes
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

    console.log('âœ… Prompts generados exitosamente:', data.data);
    showNotification(`âœ… Prompts generados para ${data.data.generatedPrompts.length} secciÃ³n(es)`, 'success');

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
    console.error('âŒ Error generando prompts:', error);
    throw error;
  }
}

async function handleProjectSectionImageButtonClick(event, projectKey, sectionNumber) {
  event.preventDefault();
  const btn = event.currentTarget;

  if (!Number.isInteger(sectionNumber) || sectionNumber <= 0) {
    console.warn('âš ï¸ NÃºmero de secciÃ³n invÃ¡lido para generar imÃ¡genes:', sectionNumber);
    return;
  }

  if (isGeneratingImages) {
    showNotification('âš ï¸ Ya hay una generaciÃ³n de imÃ¡genes en progreso. Espera a que termine antes de iniciar otra.', 'info');
    return;
  }

  const projectData = projectDataMap.get(projectKey) || window.currentProject;
  if (!projectData) {
    showError('No se encontrÃ³ la informaciÃ³n del proyecto');
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

    // Verificar si la secciÃ³n ya tiene imÃ¡genes
    const hasImages = await checkIfSectionHasImages(projectKey, sectionNumber, imageCount);
    if (hasImages) {
      showNotification(`âœ… La secciÃ³n ${sectionNumber} ya tiene suficientes imÃ¡genes generadas (${imageCount}).`, 'success');
      return;
    }

    console.log(`ðŸ–¼ï¸ Generando ${imageCount} imÃ¡genes para secciÃ³n ${sectionNumber} del proyecto ${projectKey} usando APIs gratuitas de Google...`);

    await generateMissingImagesForSection({
      folderName: projectKey,
      sectionNumber,
      projectData,
      selectedImageModel,
      imageCount
    });

    showNotification(`âœ… ImÃ¡genes generadas exitosamente para la secciÃ³n ${sectionNumber}.`, 'success');
  } catch (error) {
    console.error(`âŒ Error generando imÃ¡genes para secciÃ³n ${sectionNumber}:`, error);
    showError(`Error generando imÃ¡genes: ${error.message}`);
  } finally {
    isGeneratingImages = false;
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-images"></i><span>SecciÃ³n ${sectionNumber}</span>`;
  }
}

// FunciÃ³n para mostrar el botÃ³n de generaciÃ³n manual de video
function showVideoGenerationButton() {
  // Solo mostrar el contenedor de video si hay un solo proyecto (no mÃºltiples proyectos paralelos)
  const hasMultipleProjects = projectProgressContainers.size > 1;

  if (!hasMultipleProjects) {
    // Mostrar el contenedor principal de generaciÃ³n de video solo para proyectos Ãºnicos
    const videoContainer = document.getElementById('videoGenerationContainer');
    if (videoContainer) {
      videoContainer.style.display = 'block';
    }
  }

  const simpleVideoBtn = document.getElementById('generateSimpleVideoBtn');
  if (simpleVideoBtn) {
    simpleVideoBtn.style.display = 'inline-flex';
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

  // Mostrar botÃ³n de regenerar audios solo si Applio estÃ¡ activado
  const regenerateAudioBtn = document.getElementById('regenerateApplioAudiosBtn');
  const applioCheckbox = document.getElementById('autoGenerateApplioAudio');
  
  // Mostrar el botÃ³n si Applio estÃ¡ activado O si hay un proyecto cargado (para permitir generar audios faltantes)
  if (regenerateAudioBtn && ((applioCheckbox && applioCheckbox.checked) || window.currentProject)) {
    regenerateAudioBtn.style.display = 'inline-flex';
    console.log('ðŸŽ¤ BotÃ³n de generar audios faltantes mostrado');
  } else {
    if (regenerateAudioBtn) {
      regenerateAudioBtn.style.display = 'none';
    }
  }
  
  // Mostrar botÃ³n de regenerar guiones si hay un proyecto cargado
  const regenerateScriptsBtn = document.getElementById('regenerateMissingScriptsBtn');
  if (regenerateScriptsBtn && window.currentProject) {
    regenerateScriptsBtn.style.display = 'inline-flex';
    console.log('ðŸ“ BotÃ³n de regenerar guiones vacÃ­os mostrado');
  } else {
    if (regenerateScriptsBtn) {
      regenerateScriptsBtn.style.display = 'none';
    }
  }
  
  updateYouTubeMetadataButtonState();
  
  // Actualizar botones de clips por secciÃ³n cuando haya informaciÃ³n disponible
  updateSectionClipButtons();
  updateSectionImageButtons();
  
  console.log('ðŸ“¹ Botones de generaciÃ³n de video mostrados');
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

// FunciÃ³n principal para generar video automÃ¡ticamente
async function generateVideoAutomatically() {
  // No generar video automÃ¡ticamente si hay mÃºltiples proyectos en progreso
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (hasMultipleProjects) {
    console.log('ðŸ”„ MÃºltiples proyectos en progreso - omitiendo generaciÃ³n automÃ¡tica de video');
    return;
  }
  
  if (!shouldGenerateVideoAutomatically()) {
    console.log('ðŸ“¹ GeneraciÃ³n automÃ¡tica de video desactivada');
    return;
  }
  
  // âœ… CORREGIDO: Usar folderName del proyecto actual, no del input original
  let folderName;
  
  if (window.currentProject && window.currentProject.folderName) {
    // Si hay proyecto cargado, usar su folderName normalizado
    folderName = window.currentProject.folderName;
    console.log(`ðŸŽ¯ Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    // Fallback: usar el input y normalizarlo
    const inputFolderName = document.getElementById("folderName").value.trim();
    if (!inputFolderName) {
      console.warn('âš ï¸ No hay nombre de carpeta para generar video');
      return;
    }
    // Normalizar el nombre como lo hace el backend
    folderName = inputFolderName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    console.log(`ðŸ”§ Normalizando folderName: "${inputFolderName}" â†’ "${folderName}"`);
  }
  
  if (!allSections || allSections.length === 0) {
    console.log("âš ï¸ No hay secciones generadas para crear los clips");
    return;
  }
  
  console.log('ðŸŽ¬ Iniciando generaciÃ³n automÃ¡tica de clips separados...');
  
  try {
    // âœ… USAR LA MISMA FUNCIÃ“N QUE EL BOTÃ“N generateSeparateVideosBtn
    await generateSeparateVideos(folderName);
  } catch (error) {
    console.error('âŒ Error en generaciÃ³n automÃ¡tica de clips separados:', error);
    showError(`Error generando clips separados automÃ¡ticamente: ${error.message}`);
  }
}

// FunciÃ³n principal para generar video del proyecto
async function generateProjectVideo(folderName, isAutomatic = false) {
  if (isGeneratingVideo) {
    console.log('âš ï¸ Ya se estÃ¡ generando un video');
    return;
  }
  
  isGeneratingVideo = true;
  currentVideoSession = Date.now().toString();
  
  try {
    // Obtener configuraciÃ³n de video
    const animationType = document.getElementById('videoAnimation')?.value || 'zoom-out';
    const quality = document.getElementById('videoQuality')?.value || 'standard';
    
    console.log(`ðŸŽ¬ Generando video para proyecto: ${folderName}`);
    console.log(`ðŸŽ¬ ConfiguraciÃ³n: animaciÃ³n=${animationType}, calidad=${quality}`);

    // Mostrar progreso en la parte superior del panel
    showAutomaticVideoProgress();
    updateAutomaticVideoProgress(0, 'Iniciando generaciÃ³n de video...');
    
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
      console.log('ðŸŽ¬ Respuesta de video recibida, descargando...');
      
      const blob = await response.blob();
      console.log('ðŸŽ¬ Video blob creado, tamaÃ±o:', blob.size);
      
      // Crear enlace de descarga
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folderName}_video_completo.mp4`;
      a.style.display = 'none';
      document.body.appendChild(a);
      
      // Intentar descarga automÃ¡tica
      try {
        a.click();
        console.log('ðŸŽ¬ Descarga de video iniciada automÃ¡ticamente');
        
        showAutomaticVideoComplete();
        showSuccess('ðŸŽ¬ Â¡Video generado y descargado exitosamente!');
      } catch (clickError) {
        console.log('ðŸŽ¬ Click automÃ¡tico fallÃ³, mostrando enlace manual');
        a.style.display = 'block';
        a.textContent = 'Hacer clic aquÃ­ para descargar el video';
        a.style.color = '#00ff7f';
        a.style.textDecoration = 'underline';
        a.style.fontSize = '1.1rem';
        a.style.padding = '10px';
        
        showAutomaticVideoComplete();
      }
      
      // Limpiar despuÃ©s de un tiempo
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
    console.error('âŒ Error generando video:', error);
    
    showError(`Error generando video: ${error.message}`);
  } finally {
    isGeneratingVideo = false;
    currentVideoSession = null;
  }
}

// FunciÃ³n para generar video simple (sin animaciones)
async function generateSimpleProjectVideo(folderName) {
  if (isGeneratingVideo) {
    console.log('âš ï¸ Ya se estÃ¡ generando un video');
    return;
  }

  isGeneratingVideo = true;
  const button = document.getElementById('generateSimpleVideoBtn');
  
  try {
    // Deshabilitar botÃ³n y mostrar estado de carga
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando Video Simple...</span>';
    
    console.log('ðŸŽ¬ Iniciando generaciÃ³n de video simple para proyecto:', folderName);
    
    const response = await fetch('/generate-simple-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        folderName: folderName
        // No enviamos duration porque se calcula automÃ¡ticamente basado en audio
      }),
    });

    if (response.ok) {
      // El servidor deberÃ­a enviar el archivo para descarga automÃ¡tica
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

      showSuccess('Â¡Video simple generado y descargado exitosamente!');
    } else {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Error interno del servidor');
    }

  } catch (error) {
    console.error('âŒ Error generando video simple:', error);
    showError(`Error generando video simple: ${error.message}`);
  } finally {
    // Restaurar botÃ³n
    isGeneratingVideo = false;
    button.disabled = false;
    button.innerHTML = '<i class="fas fa-images"></i><span>Video Simple (Sin AnimaciÃ³n)</span>';
  }
}

// FunciÃ³n para generar clips separados por secciÃ³n
async function generateSeparateVideos(folderName, options = {}) {
  const { sectionNumber = null, buttonElement = null } = options;
  const progressSessionId = options.progressSessionId || `clip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  if (isGeneratingVideo) {
    console.log('âš ï¸ Ya se estÃ¡ generando un video');
    showNotification('âš ï¸ Ya hay una generaciÃ³n de video en curso. Espera a que finalice para iniciar otra.', 'info');
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
      button.innerHTML = `<i class="fas fa-spinner fa-spin"></i><span>SecciÃ³n ${sectionNumber}...</span>`;
    } else {
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando Clips Separados...</span>';
    }
    if (isSectionButton) {
      button.classList.add('section-clip-btn--generating');
    }
  }

  startClipProgressTracking(progressSessionId);

  try {
    console.log('ðŸŽ¬ Iniciando generaciÃ³n de clips separados para proyecto:', folderName, sectionNumber ? `â†’ SecciÃ³n ${sectionNumber}` : '' );

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

    console.log('âœ… Clips separados generados:', {
      total: generatedCount,
      requestedSections,
      omitidos: skippedCount,
      detalle: result.videos,
      omitidosDetalle: result.skippedVideos
    });

    if (generatedCount === 0) {
      const infoMessage = result.message || 'No se generaron clips para la selecciÃ³n solicitada.';
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
      successMessage = `Â¡${generatedCount} ${clipWord} de la secciÃ³n ${sectionNumber} generado${generatedCount === 1 ? '' : 's'} exitosamente!`;
      if (skippedCount > 0) {
        successMessage += ` (${skippedCount} clip${skippedCount === 1 ? '' : 's'} ya existÃ­a${skippedCount === 1 ? '' : 'n'} y se omitieron)`;
      }
    } else if (requestedSections.length === 1) {
      successMessage = `Â¡${generatedCount} ${clipWord} de la secciÃ³n ${requestedSections[0]} generado${generatedCount === 1 ? '' : 's'} exitosamente!`;
      if (skippedCount > 0) {
        successMessage += ` (${skippedCount} clip${skippedCount === 1 ? '' : 's'} ya existÃ­a${skippedCount === 1 ? '' : 'n'} y se omitieron)`;
      }
    } else if (requestedSections.length > 1) {
      const baseMessage = result.message || `Â¡${generatedCount} ${clipWord} generados para las secciones ${requestedSections.join(', ')}!`;
      successMessage = skippedCount > 0
        ? `${baseMessage} (${skippedCount} clip${skippedCount === 1 ? '' : 's'} existente${skippedCount === 1 ? '' : 's'} omitido${skippedCount === 1 ? '' : 's'})`
        : baseMessage;
    } else {
      const baseMessage = result.message || `Â¡${generatedCount} ${clipWord} generados exitosamente en sus respectivas carpetas de secciÃ³n!`;
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
    console.error('âŒ Error generando clips separados:', error);
    showError(`Error generando clips separados: ${error.message}`);
    stopClipProgressTracking({
      keepVisible: true,
      finalStatus: 'failed',
      finalMessage: `âŒ ${error.message}`
    });
  } finally {
    // Restaurar botÃ³n
    isGeneratingVideo = false;
    if (button) {
      button.disabled = false;
      if (button.dataset.originalContent) {
        button.innerHTML = button.dataset.originalContent;
        delete button.dataset.originalContent;
      } else if (sectionNumber !== null && Number.isInteger(Number(sectionNumber))) {
        button.innerHTML = `<i class="fas fa-film"></i><span>SecciÃ³n ${sectionNumber}</span>`;
      } else {
        button.innerHTML = '<i class="fas fa-video"></i><span>Clips Separados por SecciÃ³n</span>';
      }
      if (isSectionButton) {
        button.classList.remove('section-clip-btn--generating');
      }
    }

    updateSectionClipButtons();
    updateSectionImageButtons();
  }
}

// FunciÃ³n para mostrar progreso de video automÃ¡tico
function showAutomaticVideoProgress() {
  // No mostrar progreso si hay mÃºltiples proyectos en progreso
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (hasMultipleProjects) {
    console.log('ðŸ”„ MÃºltiples proyectos en progreso - omitiendo progreso de video automÃ¡tico');
    return;
  }
  
  const automaticMessage = document.createElement('div');
  automaticMessage.id = 'automaticVideoProgress';
  automaticMessage.className = 'auto-completion-message';
  automaticMessage.innerHTML = `
    <div class="success-content">
      <i class="fas fa-video"></i>
      <h3>Generando Video AutomÃ¡ticamente</h3>
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

// FunciÃ³n para actualizar progreso de video automÃ¡tico
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

// FunciÃ³n para mostrar completaciÃ³n de video automÃ¡tico
function showAutomaticVideoComplete() {
  // No mostrar mensaje si hay mÃºltiples proyectos en progreso
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (hasMultipleProjects) {
    console.log('ðŸ”„ MÃºltiples proyectos en progreso - omitiendo mensaje de video completado');
    return;
  }
  
  const automaticProgress = document.getElementById('automaticVideoProgress');
  if (automaticProgress) {
    automaticProgress.innerHTML = `
      <div class="success-content">
        <i class="fas fa-check-circle"></i>
        <h3>Â¡Video Generado AutomÃ¡ticamente!</h3>
        <p>El video compilado se ha descargado exitosamente.</p>
      </div>
    `;
    
    // Ocultar despuÃ©s de unos segundos
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
    showError('Activa al menos una opciÃ³n de audio (Google o Applio) para continuar');
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

  // ConfiguraciÃ³n de estilo y rangos
  const styleSelect = document.getElementById('styleSelect');
  const selectedStyleValue = styleSelect ? styleSelect.value : 'professional';

  let scriptStyle = 'professional';
  let customStyleInstructions = '';

  if (selectedStyleValue.startsWith('custom_')) {
    scriptStyle = 'custom';
    customStyleInstructions = getCustomStyleInstructions(selectedStyleValue) || '';
    console.log(`ðŸŽ¨ Estilo personalizado detectado: ${selectedStyleValue}`);
    console.log(`ðŸŽ¨ Instrucciones: ${customStyleInstructions.substring(0, 100)}...`);
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
      console.log('ðŸŽ¤ Verificando audios faltantes para Google TTS...');
      showNotification('ðŸ” Verificando audios de Google...', 'info');

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
        showNotification(`âœ… ${summary.google.generated} audios Google generados correctamente`, 'success');
      } else {
        showNotification('âœ… Todos los audios de Google ya existÃ­an', 'info');
      }

      console.log('âœ… Resultado Google TTS:', data.message);
    }

    if (useApplio) {
      console.log('ðŸŽ¤ Verificando audios faltantes para Applio...');
      showNotification('ðŸ” Verificando audios de Applio...', 'info');

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
        showNotification(`âœ… ${summary.applio.generated} audios Applio generados correctamente`, 'success');
      } else {
        showNotification('âœ… Todos los audios de Applio ya existÃ­an', 'info');
      }

      console.log('âœ… Resultado Applio:', data.message);
    }

    const totalGenerated = summary.google.generated + summary.applio.generated;
    const methodsUsed = [
      useGoogleTTS ? `Google (${summary.google.generated})` : null,
      useApplio ? `Applio (${summary.applio.generated})` : null
    ].filter(Boolean).join(' + ');

    showNotification(`ðŸŽ‰ RegeneraciÃ³n completada (${methodsUsed || 'Sin mÃ©todos activos'}). Total generados: ${totalGenerated}`, 'success');

  } catch (error) {
    console.error('âŒ Error verificando/generando audios:', error);
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

// FunciÃ³n para regenerar audios faltantes para un proyecto especÃ­fico
async function regenerateAllAudiosForProject(folderName) {
  const useGoogleTTS = document.getElementById('autoGenerateAudio')?.checked || false;
  const useApplio = document.getElementById('autoGenerateApplioAudio')?.checked || false;

  if (!useGoogleTTS && !useApplio) {
    console.log('âš ï¸ No hay opciones de audio activas para verificar en proyecto:', folderName);
    return;
  }

  if (!folderName) {
    throw new Error('No se ha especificado el nombre del proyecto');
  }

  // ConfiguraciÃ³n de estilo y rangos
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
      console.log(`ðŸŽ¤ Verificando audios faltantes para Google TTS en proyecto: ${folderName}`);

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
        console.log(`âœ… ${summary.google.generated} audios Google generados para ${folderName}`);
      } else {
        console.log(`âœ… Todos los audios de Google ya existÃ­an en ${folderName}`);
      }
    }

    if (useApplio) {
      console.log(`ðŸŽ¤ Verificando audios faltantes para Applio en proyecto: ${folderName}`);

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
          totalSections: 5, // Asumir 5 secciones por defecto, el backend lo calcularÃ¡
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
        console.log(`âœ… ${summary.applio.generated} audios Applio generados para ${folderName}`);
      } else {
        console.log(`âœ… Todos los audios de Applio ya existÃ­an en ${folderName}`);
      }
    }

    const totalGenerated = summary.google.generated + summary.applio.generated;
    console.log(`âœ… VerificaciÃ³n de audios completada para ${folderName}. Total generados: ${totalGenerated}`);

  } catch (error) {
    console.error(`âŒ Error verificando/generando audios para proyecto ${folderName}:`, error);
    throw error; // Re-lanzar para que sea manejado por el llamador
  }
}

// FunciÃ³n para regenerar guiones faltantes
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
    
    // Obtener configuraciÃ³n de estilo actual
    const styleSelect = document.getElementById('styleSelect');
    const selectedStyleValue = styleSelect ? styleSelect.value : 'professional';
    
    let scriptStyle = 'professional';
    let customStyleInstructions = '';
    
    // Determinar el tipo de estilo y obtener las instrucciones
    if (selectedStyleValue.startsWith('custom_')) {
      scriptStyle = 'custom';
      customStyleInstructions = getCustomStyleInstructions(selectedStyleValue) || '';
      console.log(`ðŸŽ¨ Estilo personalizado detectado: ${selectedStyleValue}`);
      console.log(`ðŸŽ¨ Instrucciones: ${customStyleInstructions.substring(0, 100)}...`);
    } else {
      scriptStyle = selectedStyleValue;
    }
    
    const wordsMin = parseInt(document.getElementById('wordsMin')?.value) || 800;
    const wordsMax = parseInt(document.getElementById('wordsMax')?.value) || 1100;

    console.log('ðŸ“ Verificando guiones faltantes...');
    console.log('ðŸ“ ConfiguraciÃ³n:', {
      proyecto: folderName,
      secciones: window.currentProject.completedSections.length,
      estilo: scriptStyle
    });
    
    // Deshabilitar botÃ³n durante el proceso
    const regenerateBtn = document.getElementById('regenerateMissingScriptsBtn');
    if (regenerateBtn) {
      regenerateBtn.disabled = true;
      regenerateBtn.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        <span>Verificando guiones...</span>
      `;
    }
    
    // Mostrar progreso
    showNotification('ðŸ” Verificando quÃ© guiones estÃ¡n vacÃ­os...', 'info');
    
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
      console.log('âœ… VerificaciÃ³n y generaciÃ³n de guiones completada:', data.message);
      
      if (data.data.generatedCount > 0) {
        showNotification(`âœ… ${data.data.generatedCount} guiones faltantes generados exitosamente`, 'success');
        
        // Actualizar el proyecto cargado para reflejar los cambios
        if (window.currentProject) {
          // Recargar el proyecto para obtener los guiones actualizados
          setTimeout(() => {
            showNotification('ðŸ”„ Recargando proyecto para mostrar los cambios...', 'info');
            // AquÃ­ podrÃ­as recargar el proyecto actual si tienes esa funcionalidad
          }, 2000);
        }
      } else {
        showNotification('âœ… Todos los guiones ya tienen contenido, no se generÃ³ ninguno nuevo', 'info');
      }
      
      // Mostrar detalles si hay informaciÃ³n adicional
      if (data.data.missingScripts && data.data.missingScripts.length > 0) {
        console.log('ðŸ“ Secciones que tenÃ­an guiones vacÃ­os:', data.data.missingScripts);
      }
      
    } else {
      throw new Error(data.error || 'Error desconocido regenerando guiones');
    }
    
  } catch (error) {
    console.error('âŒ Error regenerando guiones:', error);
    showError(`Error regenerando guiones: ${error.message}`);
  } finally {
    // Restaurar botÃ³n
    const regenerateBtn = document.getElementById('regenerateMissingScriptsBtn');
    if (regenerateBtn) {
      regenerateBtn.disabled = false;
      regenerateBtn.innerHTML = `
        <i class="fas fa-file-alt"></i>
        <span>Regenerar Guiones VacÃ­os</span>
      `;
    }
  }
}

// FunciÃ³n para regenerar guiones faltantes para un proyecto especÃ­fico
async function regenerateMissingScriptsForProject(folderName) {
  try {
    if (!folderName) {
      throw new Error('No se ha especificado el nombre del proyecto');
    }
    
    // Obtener configuraciÃ³n de estilo actual
    const styleSelect = document.getElementById('styleSelect');
    const selectedStyleValue = styleSelect ? styleSelect.value : 'professional';
    
    let scriptStyle = 'professional';
    let customStyleInstructions = '';
    
    // Determinar el tipo de estilo y obtener las instrucciones
    if (selectedStyleValue.startsWith('custom_')) {
      scriptStyle = 'custom';
      customStyleInstructions = getCustomStyleInstructions(selectedStyleValue) || '';
      console.log(`ðŸŽ¨ Estilo personalizado detectado: ${selectedStyleValue}`);
    } else {
      scriptStyle = selectedStyleValue;
    }
    
    const wordsMin = parseInt(document.getElementById('wordsMin')?.value) || 800;
    const wordsMax = parseInt(document.getElementById('wordsMax')?.value) || 1100;

    console.log(`ðŸ“ Verificando guiones faltantes para proyecto: ${folderName}`);
    
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
      console.log(`âœ… VerificaciÃ³n y generaciÃ³n de guiones completada para ${folderName}:`, data.message);
      
      if (data.data.generatedCount > 0) {
        console.log(`âœ… ${data.data.generatedCount} guiones faltantes generados para ${folderName}`);
      } else {
        console.log(`âœ… Todos los guiones ya tienen contenido en ${folderName}`);
      }
    } else {
      throw new Error(data.error || 'Error desconocido regenerando guiones');
    }
    
  } catch (error) {
    console.error(`âŒ Error regenerando guiones para proyecto ${folderName}:`, error);
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

        console.log('âš™ï¸ Defaults ComfyUI actualizados desde el servidor:', comfyUIDefaults);
      } else {
        console.warn('âš ï¸ No se pudo cargar defaults de ComfyUI desde el servidor:', data?.error || data);
      }
    } catch (error) {
      console.warn('âš ï¸ Error cargando defaults de ComfyUI, usando valores locales:', error);
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

// FunciÃ³n para generar imÃ¡genes faltantes
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

    // Obtener imageCount del selector o proyecto o configuraciÃ³n por defecto
    let imageCount = parseInt(document.getElementById("imagesSelect")?.value) || projectData?.imageCount || 10;

    // Actualizar el proyecto con el nuevo imageCount si cambiÃ³
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

    // Si no se especifica sectionNumber, verificar quÃ© secciones necesitan imÃ¡genes
    if (sectionNumber === null) {
      console.log('ðŸ” Verificando quÃ© secciones necesitan imÃ¡genes...');

      // Obtener todas las secciones completadas
      const completedSections = projectData.completedSections || [];
      const sectionsNeedingImages = [];

      for (let i = 0; i < completedSections.length; i++) {
        const section = completedSections[i];
        if (section && section.script) {
          // Verificar si esta secciÃ³n tiene imÃ¡genes generadas
          const sectionFolder = `${folderName}/seccion_${i + 1}`;
          const hasImages = await checkIfSectionHasImages(folderName, i + 1, imageCount);

          if (!hasImages) {
            sectionsNeedingImages.push(i + 1);
            console.log(`ðŸ“‹ SecciÃ³n ${i + 1} necesita imÃ¡genes (${imageCount} requeridas)`);
          } else {
            console.log(`âœ… SecciÃ³n ${i + 1} ya tiene suficientes imÃ¡genes (${imageCount})`);
          }
        }
      }

      if (sectionsNeedingImages.length === 0) {
        showNotification('âœ… Todas las secciones ya tienen imÃ¡genes generadas.', 'success');
        return;
      }

      console.log(`ðŸŽ¯ Secciones que necesitan imÃ¡genes: ${sectionsNeedingImages.join(', ')}`);

      // Generar imÃ¡genes para todas las secciones en paralelo (mÃ¡ximo 10 concurrentes)
      // Solo usar APIs de Google gratis
      console.log('ðŸŽ¯ Generando imÃ¡genes en paralelo (mÃ¡ximo 10 concurrentes) usando solo APIs de Google gratis...');
      
      const imageGenerationPromises = [];
      const maxConcurrent = 10;
      let completedImages = 0;
      const totalImagesToGenerate = sectionsNeedingImages.length * imageCount;
      
      // Variables para tracking de resultados
      let successCount = 0;
      let errorCount = 0;
      const failedSections = [];
      
      // Obtener configuraciones para imÃ¡genes
      const imageInstructions = document.getElementById('promptModifier')?.value || '';
      const aspectRatio = document.getElementById('aspectRatioSelect')?.value || '9:16';
      
      // Obtener APIs de Google disponibles
      const selectedGoogleApis = getSelectedGoogleApis();
      
      // FunciÃ³n para procesar una secciÃ³n
      const processSection = async (sectionNum) => {
        try {
          console.log(`ðŸ–¼ï¸ Generando ${imageCount} imÃ¡genes para secciÃ³n ${sectionNum}...`);
          
          // Llamar al backend para generar imÃ¡genes de esta secciÃ³n
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
            throw new Error(errorData?.error || `Error en secciÃ³n ${sectionNum}`);
          }
          
          const data = await response.json();
          if (!data.success) {
            throw new Error(data.error || `Error desconocido en secciÃ³n ${sectionNum}`);
          }
          
          console.log(`âœ… ImÃ¡genes generadas exitosamente para secciÃ³n ${sectionNum}`);
          return { sectionNum, success: true };
        } catch (error) {
          console.error(`âŒ Error en secciÃ³n ${sectionNum}:`, error);
          return { sectionNum, success: false, error: error.message };
        }
      };
      
      // Procesar secciones en lotes de mÃ¡ximo 5 concurrentes
      for (let i = 0; i < sectionsNeedingImages.length; i += maxConcurrent) {
        const batch = sectionsNeedingImages.slice(i, i + maxConcurrent);
        console.log(`ðŸ”„ Procesando lote ${Math.floor(i/maxConcurrent) + 1}: secciones ${batch.join(', ')}`);
        
        const batchPromises = batch.map(sectionNum => processSection(sectionNum));
        const batchResults = await Promise.all(batchPromises);
        
        // Procesar resultados del lote
        batchResults.forEach(result => {
          if (result.success) {
            successCount++;
          } else {
            errorCount++;
            failedSections.push(result.sectionNum);
            showNotification(`âŒ SecciÃ³n ${result.sectionNum}: ${result.error}`, 'error');
          }
        });
        
        // PequeÃ±a pausa entre lotes
        if (i + maxConcurrent < sectionsNeedingImages.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Mostrar resultado final
      if (successCount > 0) {
        const message = errorCount > 0
          ? `âœ… Se generaron imÃ¡genes para ${successCount} secciones. ${errorCount} secciones fallaron: ${failedSections.join(', ')}.`
          : `âœ… Se generaron imÃ¡genes exitosamente para todas las ${successCount} secciones que las necesitaban.`;
        showSuccess(message);
      } else {
        showError(`âŒ No se pudieron generar imÃ¡genes para ninguna secciÃ³n. Secciones fallidas: ${failedSections.join(', ')}`);
      }

      return;
    }

    // CÃ³digo original para una secciÃ³n especÃ­fica continÃºa aquÃ­...
    // Obtener configuraciones para imÃ¡genes
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
        showError('No se pudieron cargar las APIs de Google. Intenta recargar la pÃ¡gina.');
        return;
      }

      selectedGoogleApis = getSelectedGoogleApis();
      if (!selectedGoogleApis.length) {
        showError('Selecciona al menos una API de Google disponible antes de generar imÃ¡genes.');
        return;
      }
    } else {
      console.log('ðŸŽ¯ Modo Comfy directo activado: se omitirÃ¡n las APIs de Google para esta ejecuciÃ³n.');
    }
    
    // Obtener configuraciones de ComfyUI si estÃ¡ habilitado
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
    
    console.log('ðŸ–¼ï¸ Iniciando generaciÃ³n de imÃ¡genes faltantes...');
    console.log('ðŸ–¼ï¸ ConfiguraciÃ³n:', {
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
      showNotification('ðŸŽ¨ Modo Comfy directo: las imÃ¡genes se generarÃ¡n de una en una usando ComfyUI.', 'info');
    } else if (!allowComfyFallback) {
      showNotification('ðŸ” Se intentarÃ¡ generar imÃ¡genes solo con las APIs. Si fallan por cuota, se cambiarÃ¡ automÃ¡ticamente a ComfyUI.', 'info');
    }
    
    // Deshabilitar botÃ³n y mostrar progreso
    const generateBtn = document.getElementById('generateMissingImagesBtn');
    const cancelBtn = document.getElementById('cancelMissingImagesBtn');
    if (generateBtn) {
      generateBtn.disabled = true;
      generateBtn.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        <span>Generando ImÃ¡genes...</span>
      `;
    }
    if (cancelBtn) {
      cancelBtn.style.display = 'inline-flex';
      cancelBtn.disabled = false;
      cancelBtn.innerHTML = `
        <i class="fas fa-stop-circle"></i>
        <span>Detener GeneraciÃ³n</span>
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
    
    console.log('ðŸ“¤ ENVIANDO AL SERVIDOR:', {
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

    // PRIMERA INTENTO: Con la configuraciÃ³n actual
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
      
      console.log('ðŸš¨ Detectado error de cuota en APIs de Google. Cambiando automÃ¡ticamente a ComfyUI...');
      showNotification('ðŸš¨ Cuota de APIs gratuitas agotada. Cambiando automÃ¡ticamente a ComfyUI (IA Local)...', 'warning');
      
      // Cambiar configuraciÃ³n para usar ComfyUI
      useLocalAI = true;
      comfyOnlyMode = true;
      allowComfyFallback = true;
      selectedGoogleApis = []; // No usar APIs de Google
      
      // Reintentar con ComfyUI
      console.log('ðŸ”„ Reintentando con ComfyUI...');
      
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
      throw new Error(data?.error || data?.message || 'Error generando imÃ¡genes');
    }

    if (data.cancelled) {
      const cancelPrefix = sectionNumber ? `SecciÃ³n ${sectionNumber}` : 'Proceso completo';
      showNotification(`â›”ï¸ ${cancelPrefix}: ${data.message || 'La generaciÃ³n de imÃ¡genes fue cancelada.'}`, 'info');
      console.log('ðŸ›‘ GeneraciÃ³n cancelada por el usuario:', data);
      return;
    }

    if (data.success) {
      const successPrefix = sectionNumber ? `SecciÃ³n ${sectionNumber}` : 'Proceso completo';
      showSuccess(`âœ… ${successPrefix}: ${data.message}`);
      console.log('ðŸ–¼ï¸ Resultados:', data.data);
      
      // Mostrar detalles si hay informaciÃ³n adicional
      if (data.data.generatedPrompts && data.data.generatedPrompts.length > 0) {
        console.log('ðŸ–¼ï¸ Prompts generados para secciones:', data.data.generatedPrompts);
      }
      
      if (data.data.generatedImages && data.data.generatedImages.length > 0) {
        console.log('ðŸ–¼ï¸ ImÃ¡genes generadas para secciones:', data.data.generatedImages);
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
      throw new Error(data.error || 'Error desconocido generando imÃ¡genes');
    }
    
  } catch (error) {
    console.error('âŒ Error generando imÃ¡genes:', error);
    if (error?.code === 'CANCELLED_BY_USER' || error?.message?.toLowerCase().includes('cancelado')) {
      showNotification(`â›”ï¸ ${error.message}`, 'info');
    } else {
      showError(`Error generando imÃ¡genes: ${error.message}`);
    }
  } finally {
    isGeneratingImages = false;
    isCancellingImages = false;
    stopSectionImageProgressPolling();
    updateSectionImageButtons(projectOverride || window.currentProject);

    // Restaurar botÃ³n
    const generateBtn = document.getElementById('generateMissingImagesBtn');
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.innerHTML = `
        <i class="fas fa-image"></i>
        <span>Generar ImÃ¡genes Faltantes</span>
      `;
    }
    const cancelBtn = document.getElementById('cancelMissingImagesBtn');
    if (cancelBtn) {
      cancelBtn.style.display = 'none';
      cancelBtn.disabled = false;
      cancelBtn.innerHTML = `
        <i class="fas fa-stop-circle"></i>
        <span>Detener GeneraciÃ³n</span>
      `;
    }
    if (buttonElement) {
      buttonElement.disabled = false;
      if (originalButtonHtml !== null) {
        buttonElement.innerHTML = originalButtonHtml;
      } else {
        buttonElement.innerHTML = `
          <i class="fas fa-images"></i>
          <span>SecciÃ³n ${sectionNumber || ''}</span>
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
    showNotification('â„¹ï¸ No hay una generaciÃ³n de imÃ¡genes en curso.', 'info');
    return;
  }

  if (isCancellingImages) {
    showNotification('â³ Ya se solicitÃ³ la cancelaciÃ³n. Espera un momento.', 'info');
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
      showNotification(data.message || 'CancelaciÃ³n solicitada. El proceso se detendrÃ¡ en breve.', 'info');
    } else {
      const errorMessage = data?.message || data?.error || 'No se pudo cancelar la generaciÃ³n de imÃ¡genes.';
      showError(errorMessage);
    }
  } catch (error) {
    console.error('âŒ Error cancelando la generaciÃ³n de imÃ¡genes:', error);
    showError(`Error cancelando la generaciÃ³n de imÃ¡genes: ${error.message}`);
  } finally {
    isCancellingImages = false;
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.innerHTML = `
        <i class="fas fa-stop-circle"></i>
        <span>Detener GeneraciÃ³n</span>
      `;
    }
  }
}

// FunciÃ³n auxiliar para verificar si una secciÃ³n ya tiene imÃ¡genes generadas
async function checkIfSectionHasImages(folderName, sectionNumber, expectedCount = 1) {
  try {
    const response = await fetch(`/api/check-section-images?folderName=${encodeURIComponent(folderName)}&sectionNumber=${sectionNumber}`);
    if (response.ok) {
      const data = await response.json();
      return (data.imageCount || 0) >= expectedCount;
    }
    return false;
  } catch (error) {
    console.warn(`âš ï¸ Error verificando imÃ¡genes para secciÃ³n ${sectionNumber}:`, error);
    return false;
  }
}

// FunciÃ³n auxiliar para generar imÃ¡genes para una secciÃ³n especÃ­fica
async function generateMissingImagesForSection(options) {
  const { folderName, sectionNumber, projectData, selectedImageModel, imageCount: overrideImageCount } = options;

  const pollingProject = projectData || window.currentProject || null;
  startSectionImageProgressPolling(pollingProject);

  try {
    // Obtener configuraciones para imÃ¡genes
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

    // Obtener configuraciones de ComfyUI si estÃ¡ habilitado
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

    // PRIMERA INTENTO: Con la configuraciÃ³n actual
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

      console.log(`ðŸš¨ SecciÃ³n ${sectionNumber} - Error detectado (${data.error}). Cambiando automÃ¡ticamente a ComfyUI...`);

      // Cambiar configuraciÃ³n para usar ComfyUI
      useLocalAI = true;
      comfyOnlyMode = true;
      allowComfyFallback = true;
      selectedGoogleApis = []; // No usar APIs de Google

      // Reintentar con ComfyUI
      console.log(`ðŸ”„ SecciÃ³n ${sectionNumber} - Reintentando con ComfyUI...`);

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
      throw new Error(data?.error || data?.message || 'Error generando imÃ¡genes');
    }

    if (data.cancelled) {
      throw new Error(`SecciÃ³n ${sectionNumber}: ${data.message || 'La generaciÃ³n fue cancelada.'}`);
    }

    if (!data.success) {
      throw new Error(data.error || 'Error desconocido generando imÃ¡genes');
    }

    return data;
  } finally {
    stopSectionImageProgressPolling();
  }
}

// FunciÃ³n auxiliar para verificar si una secciÃ³n ya tiene imÃ¡genes generadas

// ValidaciÃ³n para minWords y maxWords
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

  // Formateo automÃ¡tico para el input de duraciÃ³n (MM:SS)
  const targetDurationInput = document.getElementById('targetDurationInput');
  if (targetDurationInput) {
    targetDurationInput.addEventListener('input', function(e) {
      let value = e.target.value.replace(/\D/g, ''); // Eliminar no dÃ­gitos
      if (value.length > 4) value = value.slice(0, 4); // Limitar a 4 dÃ­gitos
      
      if (value.length >= 3) {
        value = value.slice(0, value.length - 2) + ':' + value.slice(value.length - 2);
      }
      
      e.target.value = value;
    });
  }

  // Configurar botones de traducciÃ³n
  const translateBtns = document.querySelectorAll('.translate-btn');
  translateBtns.forEach(btn => {
    btn.addEventListener('click', async function() {
      const lang = this.getAttribute('data-lang');
      const langNames = {
        'en': 'InglÃ©s', 'fr': 'FrancÃ©s', 'de': 'AlemÃ¡n', 
        'ko': 'Coreano', 'ru': 'Ruso', 'pt': 'PortuguÃ©s', 'zh': 'Chino'
      };
      
      if (!window.currentProject || !window.currentProject.folderName) {
        showNotification('âŒ No hay un proyecto cargado para traducir', 'error');
        return;
      }

      if (confirm(`Â¿EstÃ¡s seguro de traducir todo el proyecto al ${langNames[lang]}? Esto generarÃ¡ nuevos archivos de guion.`)) {
        await translateProjectScripts(lang);
      }
    });
  });

  // Configurar botÃ³n de traducir a todos
  const translateAllBtn = document.getElementById('translateAllBtn');
  if (translateAllBtn) {
    translateAllBtn.addEventListener('click', async function() {
      if (!window.currentProject || !window.currentProject.folderName) {
        showNotification('âŒ No hay un proyecto cargado para traducir', 'error');
        return;
      }

      if (confirm('Â¿EstÃ¡s seguro de traducir el proyecto a TODOS los idiomas (EN, FR, DE, KO, RU, PT, ZH)?\n\nEsto se harÃ¡ en paralelo para mayor velocidad.')) {
        await translateProjectAll();
      }
    });
  }

  // Configurar botÃ³n de generar audios de traducciÃ³n
  const generateTranslatedAudiosBtn = document.getElementById('generateTranslatedAudiosBtn');
  if (generateTranslatedAudiosBtn) {
    generateTranslatedAudiosBtn.addEventListener('click', async function() {
      if (!window.currentProject || !window.currentProject.folderName) {
        showNotification('âŒ No hay un proyecto cargado', 'error');
        return;
      }

      const autoGenerateApplioAudio = document.getElementById('autoGenerateApplioAudio').checked;
      if (!autoGenerateApplioAudio) {
        showNotification('âš ï¸ Debes activar la casilla "Incluir Audio Applio" para usar esta funciÃ³n', 'warning');
        return;
      }

      if (confirm('Â¿Generar audios para todos los guiones traducidos usando Applio?\n\nEsto puede tomar tiempo dependiendo de la cantidad de archivos.')) {
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
    
    // Obtener parÃ¡metros de Applio
    const applioVoice = document.getElementById("applioVoiceSelect").value;
    const applioModel = document.getElementById("applioModelSelect").value;
    const applioPitch = parseInt(document.getElementById("applioPitch").value) || 0;
    const applioSpeed = parseInt(document.getElementById("applioSpeed").value) || 0;
    
    // Parsear duraciÃ³n objetivo (MM:SS)
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

    statusText.textContent = `Iniciando generaciÃ³n de audios traducidos...`;
    progressBar.style.width = '2%';

    const response = await fetch('/generate-translated-audios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: folderName,
        totalSections: totalSections,
        applioVoice: applioVoice,
        applioModel: applioModel, // Este es el modelo TTS base que se usarÃ¡ si no hay uno especÃ­fico por idioma
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
              
              // CÃ¡lculo de tiempo estimado
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
              statusText.textContent = 'âœ… GeneraciÃ³n de audios completada';
              showNotification('âœ… Audios traducidos generados exitosamente', 'success');
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
    console.error('Error en generaciÃ³n de audios:', error);
    statusText.textContent = 'âŒ Error: ' + error.message;
    statusText.style.color = '#fc8181';
    showNotification('âŒ Error generando audios', 'error');
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
    
    statusText.textContent = `Iniciando traducciÃ³n masiva paralela...`;
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
              
              // CÃ¡lculo de tiempo estimado
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
              statusText.textContent = 'âœ… TraducciÃ³n masiva completada exitosamente';
              showNotification('âœ… Proyecto traducido a todos los idiomas', 'success');
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
    console.error('Error en traducciÃ³n masiva:', error);
    statusText.textContent = 'âŒ Error: ' + error.message;
    statusText.style.color = '#fc8181';
    showNotification('âŒ Error durante la traducciÃ³n masiva', 'error');
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
    
    statusText.textContent = `Iniciando traducciÃ³n de ${totalSections} secciones...`;
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
            statusText.textContent = `Traduciendo secciÃ³n ${data.current} de ${data.total}...`;
          }
          
          if (data.complete) {
            statusText.textContent = 'âœ… TraducciÃ³n completada exitosamente';
            showNotification('âœ… Proyecto traducido correctamente', 'success');
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
    console.error('Error en traducciÃ³n:', error);
    statusText.textContent = 'âŒ Error: ' + error.message;
    statusText.style.color = '#fc8181';
    showNotification('âŒ Error durante la traducciÃ³n', 'error');
    buttons.forEach(b => b.disabled = false);
  }
}

// Lógica para traducción de títulos
document.addEventListener('DOMContentLoaded', function() {
  const translateTitleBtn = document.getElementById('translateTitleBtn');
  const titleInput = document.getElementById('titleInput');
  const translatedTitlesList = document.getElementById('translatedTitlesList');

  if (translateTitleBtn && titleInput) {
    translateTitleBtn.addEventListener('click', async function() {
      const title = titleInput.value.trim();
      if (!title) {
        showNotification(' Por favor ingresa un título', 'warning');
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

        if (!response.ok) throw new Error('Error en la traducción');

        const translations = await response.json();
        
        // Render results
        const langNames = {
          'en': 'Inglés', 'fr': 'Francés', 'de': 'Alemán', 
          'ko': 'Coreano', 'ru': 'Ruso', 'pt': 'Portugués', 'zh': 'Chino'
        };

        const flags = {
          'en': '🇺🇸', 'fr': '🇫🇷', 'de': '🇩🇪', 
          'ko': '🇰🇷', 'ru': '🇷🇺', 'pt': '🇵🇹', 'zh': '🇨🇳'
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
        showNotification(' Error al traducir el título', 'error');
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

    // Video Dropzone Logic
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

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
                fileInput.files = e.dataTransfer.files;
                handleFileSelect(fileInput.files[0]);
            }
        });

        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) {
                handleFileSelect(fileInput.files[0]);
            }
        });
    }

    // Music Dropzone Logic
    if (musicDropZone && musicInput) {
        musicDropZone.addEventListener('click', () => musicInput.click());

        musicDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            musicDropZone.classList.add('dragover');
        });

        musicDropZone.addEventListener('dragleave', () => {
            musicDropZone.classList.remove('dragover');
        });

        musicDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            musicDropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
                musicInput.files = e.dataTransfer.files;
                handleMusicSelect(musicInput.files[0]);
            }
        });

        musicInput.addEventListener('change', () => {
            if (musicInput.files.length) {
                handleMusicSelect(musicInput.files[0]);
            }
        });
    }

    function handleFileSelect(file) {
        if (file.type === 'video/mp4') {
            fileNameDisplay.textContent = file.name;
            generateBtn.disabled = false;
        } else {
            alert('Por favor, selecciona un archivo .mp4 válido.');
            fileInput.value = '';
            fileNameDisplay.textContent = '';
            generateBtn.disabled = true;
        }
    }

    function handleMusicSelect(file) {
        if (file.type.includes('audio')) {
            musicNameDisplay.textContent = file.name;
        } else {
            alert('Por favor, selecciona un archivo de audio válido (.mp3, .wav).');
            musicInput.value = '';
            musicNameDisplay.textContent = '';
        }
    }

    // Generate Button Logic
    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            const file = fileInput.files[0];
            if (!file) return;
            
            const musicFile = musicInput && musicInput.files.length ? musicInput.files[0] : null;

            generateBtn.disabled = true;
            const progressContainer = document.getElementById('translateVideoProgress');
            const statusText = document.getElementById('translateVideoStatus');
            const progressBar = document.getElementById('translateVideoProgressBar');
            const percentText = document.getElementById('translateVideoPercent');
            const timeRemainingText = document.getElementById('translateVideoTimeRemaining');
            
            progressContainer.style.display = 'block';
            statusText.textContent = 'Iniciando subida...';
            progressBar.style.width = '0%';
            if (percentText) percentText.textContent = '0%';
            if (timeRemainingText) timeRemainingText.textContent = 'Calculando tiempo...';

            const formData = new FormData();
            formData.append('video', file);
            if (musicFile) {
                formData.append('music', musicFile);
            }

            const startTime = Date.now();

            try {
                statusText.textContent = 'Subiendo y procesando...';
                
                const response = await fetch('/api/translate-video', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) throw new Error('Error en la traducción del video');

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
                                    statusText.textContent = '¡Completado!';
                                    progressBar.style.width = '100%';
                                    if (percentText) percentText.textContent = '100%';
                                    if (timeRemainingText) timeRemainingText.textContent = 'Completado';
                                    
                                    // Pequeña pausa para que el usuario vea el 100%
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
        });
    }
});

