// Función simple para verificar que el script se carga
console.log('ðŸš€ Script.js cargado correctamente - VERSIÃ“N CON FIX DE KEYWORDS v2');

// Variable global para almacenar la estructura de capítulos
let globalChapterStructure = [];

// Variable global para almacenar las keywords de cada imagen para el botón de refresh
let currentImageKeywords = [];

const IMAGE_MODEL_DEFAULT = 'gemini3';
const IMAGE_MODEL_LABELS = {
  gemini2: 'Gemini 2.0 Flash',
  gemini25: 'Gemini 2.5 Flash',
  gemini3: 'Gemini 3.5 Flash'
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
    value === 'gemini-3.5-flash' ||
    value === 'gemini-3.1-pro-preview' ||
    value === 'gemini-3.1-flash-lite' ||
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
// VARIABLES GLOBALES PARA GENERACIÃ“N DE IMÃƒÆ’Ã‚ÂGENES
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
    <input type="hidden" id="${folderId}" class="field-input project-folder-input" data-project-role="folder" value="" />
    <div class="field-group topic-group">
      <label for="${topicId}" class="field-label">
        <i class="fas fa-edit"></i>
        Tema del Guión:
      </label>
      <textarea id="${topicId}" class="topic-textarea project-topic-input" data-project-role="topic" rows="3" placeholder="Describe el guión para este proyecto"></textarea>
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
    console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se encontró el contenedor para proyectos adicionales');
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
    console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â createSafeFolderName recibió valor inválido:', topic);
    return 'proyecto_sin_nombre';
  }
  
  const safeName = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, '') // Remover caracteres especiales, mantener guiones bajos
    .replace(/\s+/g, '_') // Reemplazar espacios con guiones bajos
    .substring(0, 50); // Limitar longitud
    
  console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â createSafeFolderName: "${topic}" â†’ "${safeName}"`);
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
    // Si el usuario puso un folderName manual, usarlo. Si no, dejar vacío para que el backend genere uno con IA
    let safeFolderName = originalFolderName ? createSafeFolderName(originalFolderName) : '';

    if (!safeFolderName) {
      // No generar nombre del topic — el backend lo hará con IA
      safeFolderName = '';
    }

    let uniqueName = safeFolderName;
    if (safeFolderName) {
      let counter = 2;
      while (seenNames.has(uniqueName)) {
        uniqueName = `${safeFolderName}_${counter}`;
        counter += 1;
      }
      seenNames.add(uniqueName);
    }

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
      console.log('ðŸš€ Lanzando generación paralela para proyectos adicionales:', {
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
            console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Ëœ Actualizada clave de proyecto ${index + 1}: ${projects[index].folderName} â†’ ${backendProject.projectKey}`);
          }
        });
      }

      const folderSummary = projects.map(project => {
        const topicSnippet = project.topic.length > 60 ? `${project.topic.slice(0, 57)}...` : project.topic;
        return `${topicSnippet} â†’ ${project.folderName}`;
      }).join('; ');
      showNotification(`âœ… Proyectos adicionales en proceso: ${folderSummary}`, 'success');
    } catch (error) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error lanzando generación paralela:', error);
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

  // Restore persisted panel config and wire up auto-save listeners
  _loadConfig();
  _attachConfigListeners();
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
    errorMessage.textContent = 'No se pudieron cargar las APIs de Google. Intenta recargar la página.';
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
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando APIs de Google:', error);
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
    generateBtn.title = 'Configura al menos una API de Google disponible para generar imágenes.';
  } else {
    if (generateBtn.dataset.disabledNoApis === 'true') {
      generateBtn.disabled = false;
    }
    generateBtn.dataset.disabledNoApis = 'false';
    if (!hasSelectableApis && comfyOnlyMode) {
      generateBtn.title = 'Modo Comfy directo activo: se omiten las APIs de Google.';
    } else if (generateBtn.title === 'Configura al menos una API de Google disponible para generar imágenes.' || generateBtn.title === 'Modo Comfy directo activo: se omiten las APIs de Google.') {
      generateBtn.title = '';
    }
  }
}

// ================================
// FUNCIÃ“N PARA MANEJAR SELECTOR NUMÉRICO DE SECCIONES
// ================================
function changeSectionCount(change) {
  const input = document.getElementById('sectionsNumber');
  if (!input) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró el campo sectionsNumber');
    return;
  }
  
  // Si el campo está vacío, usar valor por defecto
  const currentValue = parseInt(input.value) || 3;
  const newValue = currentValue + change;
  
  // Verificar límites
  if (newValue < 1 || newValue > 150) {
    console.log(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Valor fuera de rango: ${newValue}. Rango permitido: 1-150`);
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
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontraron elementos del selector numérico');
    return;
  }
  
  const inputValue = input.value.trim();
  const currentValue = parseInt(inputValue) || 3; // Default a 3 si no es válido
  
  // Si el campo está vacío, permitir ambos botones pero con restricciones lógicas
  const isEmpty = inputValue === '';
  
  // Deshabilitar botones según límites
  decreaseBtn.disabled = !isEmpty && currentValue <= 1;
  increaseBtn.disabled = !isEmpty && currentValue >= 150;
  
  // Actualizar títulos de botones
  if (isEmpty) {
    decreaseBtn.title = 'Disminuir secciones';
    increaseBtn.title = 'Aumentar secciones';
  } else {
    decreaseBtn.title = currentValue <= 1 ? 'Mínimo 1 sección' : 'Disminuir secciones';
    increaseBtn.title = currentValue >= 150 ? 'Máximo 150 secciones' : 'Aumentar secciones';
  }
}

// Inicializar estado de botones cuando se carga la página
document.addEventListener('DOMContentLoaded', function() {
  console.log('ðŸŽ¯ Inicializando selector numérico de secciones...');
  updateSectionButtons();
  initializeGoogleApiSelector();
  
  // También agregar listener para cambios manuales en el input
  const input = document.getElementById('sectionsNumber');
  if (input) {
    // Evento para validar mientras el usuario escribe
    input.addEventListener('input', function(e) {
      let value = parseInt(this.value);
      
      // Permitir campo vacío temporalmente mientras el usuario escribe
      if (this.value === '') {
        updateSectionButtons();
        return;
      }
      
      // Validar rango y corregir si es necesario
      if (isNaN(value) || value < 1) {
        console.log('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Valor corregido a mínimo: 1');
        this.value = 1;
        value = 1;
      } else if (value > 150) {
        console.log('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Valor corregido a máximo: 150');
        this.value = 150;
        value = 150;
      }
      
      updateSectionButtons();
      console.log(`ðŸ“Š Secciones actualizadas via input: ${value}`);
    });
    
    // Evento para manejar cuando el usuario sale del campo
    input.addEventListener('blur', function(e) {
      // Si el campo está vacío al salir, establecer valor por defecto
      if (this.value === '' || isNaN(parseInt(this.value))) {
        console.log('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Campo vacío, estableciendo valor por defecto: 3');
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
    
    console.log('âœ… Selector numérico de secciones inicializado');
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
  return 10 + (capped / 10); // entre ~10s y ~16s según cantidad
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

// Inicializar cápsulas de progreso
function initializeProgressCapsules(containerId = 'progressCapsules') {
  const progressCapsules = document.getElementById(containerId);
  const sectionsNumberElement = document.getElementById('sectionsNumber');
  
  if (!progressCapsules || !sectionsNumberElement) return;
  
  // Limpiar cápsulas existentes
  progressCapsules.innerHTML = '';
  
  const totalSections = parseInt(sectionsNumberElement.value) || 3;
  
  // Crear cápsulas para cada sección
  for (let i = 0; i < totalSections; i++) {
    const capsule = document.createElement('div');
    capsule.className = 'capsule';
    capsule.dataset.sectionIndex = i;
    progressCapsules.appendChild(capsule);
  }
}

// Actualizar cápsulas de progreso
function updateProgressCapsules(currentStep, totalSteps, containerId = 'progressCapsules') {
  const progressCapsules = document.getElementById(containerId);
  if (!progressCapsules) return;
  
  const capsules = progressCapsules.querySelectorAll('.capsule');
  
  // Marcar cápsulas completadas hasta currentStep - 1
  capsules.forEach((capsule, index) => {
    if (index < currentStep) {
      capsule.classList.add('completed');
    } else {
      capsule.classList.remove('completed');
    }
  });
}

// Inicializar cápsulas de audio
function initializeAudioCapsules(containerId, totalSections) {
  const audioCapsules = document.getElementById(containerId);
  if (!audioCapsules) return;
  
  // Limpiar cápsulas existentes
  audioCapsules.innerHTML = '';
  
  // Crear cápsulas para cada sección (una por audio)
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
    
    // Limpiar cápsulas existentes
    imageCapsules.innerHTML = '';
    
    // Crear cápsulas para cada imagen en la sección
    for (let i = 0; i < imagesPerSection; i++) {
      const capsule = document.createElement('div');
      capsule.className = 'capsule image-capsule';
      capsule.dataset.sectionIndex = section - 1;
      capsule.dataset.imageIndex = i;
      imageCapsules.appendChild(capsule);
    }
  }
}

// Actualizar cápsulas de audio
function updateAudioCapsules(currentStep, totalSteps, containerId) {
  const audioCapsules = document.getElementById(containerId);
  if (!audioCapsules) return;
  
  const capsules = audioCapsules.querySelectorAll('.audio-capsule');
  
  // Marcar cápsulas completadas hasta currentStep - 1
  capsules.forEach((capsule, index) => {
    capsule.classList.remove('completed', 'active');
    
    if (index < currentStep) {
      capsule.classList.add('completed');
    } else if (index === currentStep) {
      capsule.classList.add('active');
    }
  });
}

// Actualizar cápsulas de imágenes para una sección específica
function updateImageCapsules(projectKey, sectionIndex, completedImages, totalImages) {
  const containerId = `imageCapsules-${projectKey}-section${sectionIndex + 1}`;
  const imageCapsules = document.getElementById(containerId);
  if (!imageCapsules) return;
  
  const capsules = imageCapsules.querySelectorAll('.image-capsule');
  
  // Marcar cápsulas completadas
  capsules.forEach((capsule, index) => {
    if (index < completedImages) {
      capsule.classList.add('completed');
    } else {
      capsule.classList.remove('completed');
    }
  });
}

// =====================================
// B-ROLL DOWNLOAD PROGRESS
// =====================================
let _brollPollingInterval = null;
let _brollDonePromiseResolve = null;
let _brollDonePromise = null;

function initBrollProgressUI(projectKey, totalVideos, totalImages) {
  const totalItems = totalVideos + totalImages;
  if (totalItems === 0) return;

  // Remove existing broll progress if any
  const existing = document.getElementById(`broll-progress-standalone-${projectKey}`);
  if (existing) existing.remove();

  let capsulesHTML = '';
  for (let i = 0; i < totalItems; i++) {
    const type = i < totalVideos ? 'video' : 'image';
    capsulesHTML += `<div class="capsule broll-capsule" data-index="${i}" data-type="${type}"></div>`;
  }

  const brollDiv = document.createElement('div');
  brollDiv.id = `broll-progress-standalone-${projectKey}`;
  brollDiv.className = 'broll-progress-wrapper broll-standalone';
  brollDiv.innerHTML = `
    <div class="broll-progress-header">
      <i class="fas fa-film"></i>
      <span>B-Roll (${totalVideos} videos${totalImages > 0 ? ', ' + totalImages + ' imgs' : ''})</span>
      <span class="broll-percentage">0%</span>
    </div>
    <div class="progress-capsules broll-capsules" id="brollCapsules-${projectKey}">
      ${capsulesHTML}
    </div>
    <div class="broll-progress-info">
      <span class="broll-current-task">Descargando...</span>
    </div>
  `;

  // Try inserting into project progress container first
  const container = document.getElementById(`progress-${projectKey}`);
  if (container) {
    const audioWrapper = container.querySelector('.audio-progress-wrapper');
    const imagesWrapper = container.querySelector('.images-progress-wrapper');
    const insertAfter = imagesWrapper || audioWrapper || container.querySelector('.project-progress-info');
    if (insertAfter && insertAfter.nextSibling) {
      insertAfter.parentNode.insertBefore(brollDiv, insertAfter.nextSibling);
    } else {
      container.appendChild(brollDiv);
    }
  } else {
    // Container was already removed (generation completed fast) — insert standalone in output
    const output = document.getElementById('output');
    if (output) {
      // Insert after success message or at the start
      const successMsg = output.querySelector('.auto-completion-message');
      if (successMsg) {
        successMsg.insertAdjacentElement('afterend', brollDiv);
      } else {
        output.insertBefore(brollDiv, output.firstChild);
      }
    }
  }
}

function updateBrollProgress(projectKey, videos, imageTasks, done) {
  // Find wrapper either in project card or standalone
  let wrapper = document.getElementById(`broll-progress-standalone-${projectKey}`);
  if (!wrapper) {
    const container = document.getElementById(`progress-${projectKey}`);
    if (container) wrapper = container.querySelector('.broll-progress-wrapper');
  }
  if (!wrapper) return;

  const capsules = wrapper.querySelectorAll('.broll-capsule');
  const totalVideos = videos.length;
  const totalImages = imageTasks ? imageTasks.length : 0;

  let completedCount = 0;

  // Update video capsules
  videos.forEach((v, i) => {
    if (i >= capsules.length) return;
    const capsule = capsules[i];
    capsule.classList.remove('completed', 'active', 'error');
    if (v.status === 'done') {
      capsule.classList.add('completed');
      completedCount++;
    } else if (v.status === 'downloading') {
      capsule.classList.add('active');
    } else if (v.status === 'error') {
      capsule.classList.add('error');
      completedCount++; // count as processed
    }
  });

  // Update image task capsules
  if (imageTasks) {
    imageTasks.forEach((img, i) => {
      const idx = totalVideos + i;
      if (idx >= capsules.length) return;
      const capsule = capsules[idx];
      capsule.classList.remove('completed', 'active', 'error');
      if (img.status === 'done') {
        capsule.classList.add('completed');
        completedCount++;
      } else if (img.status === 'downloading') {
        capsule.classList.add('active');
      } else if (img.status === 'error') {
        capsule.classList.add('error');
        completedCount++;
      }
    });
  }

  const totalItems = totalVideos + totalImages;
  const pct = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;

  const pctEl = wrapper.querySelector('.broll-percentage');
  if (pctEl) pctEl.textContent = pct + '%';

  const taskEl = wrapper.querySelector('.broll-current-task');
  if (taskEl) {
    if (done) {
      taskEl.textContent = `B-Roll completado (${completedCount}/${totalItems})`;
    } else {
      const downloading = videos.filter(v => v.status === 'downloading').length;
      taskEl.textContent = `Descargando... ${completedCount}/${totalItems}${downloading > 0 ? ` (${downloading} en paralelo)` : ''}`;
    }
  }
}

function startBrollPolling(projectKey, jobId) {
  // Clear any existing polling
  if (_brollPollingInterval) clearInterval(_brollPollingInterval);

  _brollPollingInterval = setInterval(async () => {
    try {
      const resp = await fetch(`/api/broll/download/status/${jobId}`);
      if (!resp.ok) {
        clearInterval(_brollPollingInterval);
        _brollPollingInterval = null;
        if (_brollDonePromiseResolve) { _brollDonePromiseResolve(); _brollDonePromiseResolve = null; }
        return;
      }
      const data = await resp.json();
      updateBrollProgress(projectKey, data.videos || [], data.imageTasks || [], data.done);

      if (data.done) {
        clearInterval(_brollPollingInterval);
        _brollPollingInterval = null;
        console.log('🎬 B-Roll: Descarga completada');
        if (_brollDonePromiseResolve) { _brollDonePromiseResolve(); _brollDonePromiseResolve = null; }
      }
    } catch (e) {
      console.warn('B-Roll polling error:', e.message);
    }
  }, 2000);
}

// Contenedores de progreso por proyecto
let projectProgressContainers = new Map();

// Mapa para almacenar projectData por projectKey
let projectDataMap = new Map();

// Crear contenedor de progreso para un proyecto específico
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
        <!-- Cápsulas de audio se generarán dinámicamente -->
      </div>
      <div class="audio-progress-info">
        <span class="audio-current-task">Esperando generación de guiones...</span>
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
            <span>Sección ${section}</span>
          </div>
          <div class="progress-capsules image-capsules" id="imageCapsules-${projectKey}-section${section}" data-section="${section}">
            <!-- Cápsulas de imágenes se generarán dinámicamente -->
          </div>
        </div>
      `;
    }
    
    imagesProgressHTML = `
    <div class="images-progress-wrapper">
      <div class="images-progress-header">
        <i class="fas fa-images"></i>
        <span>Progreso de Imágenes</span>
        <span class="images-percentage">0%</span>
      </div>
      <div class="images-sections-container">
        ${imagesBarsHTML}
      </div>
      <div class="images-progress-info">
        <span class="images-current-task">Esperando generación de guiones...</span>
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
        <!-- Cápsulas se generarán dinámicamente -->
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
        <span>Generar imágenes por sección</span>
      </div>
      <div id="sectionImagesButtons-${projectKey}" class="section-images-grid">
        <!-- Botones de sección se generarán dinámicamente -->
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

  // Inicializar cápsulas
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

// Orden de fases para protección contra regresión
const _projectPhaseOrder = { 'starting': 0, 'script': 1, 'audio': 2, 'images': 3, 'completed': 4 };
const _projectCurrentPhase = new Map();

// Actualizar progreso de un proyecto específico
function updateProjectProgress(projectKey, data) {
  console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ [${projectKey}] Actualizando progreso:`, data);
  const container = projectProgressContainers.get(projectKey);
  if (!container) {
    console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ [${projectKey}] Contenedor de progreso no encontrado!`);
    return;
  }

  const { percentage, phase, currentStep, totalSteps, currentTask, audioProgress, imagesProgress } = data;

  // Protección contra regresión de fase: no dejar que el polling revierta a fase anterior
  const knownPhase = _projectCurrentPhase.get(projectKey) || 'starting';
  const incomingOrder = _projectPhaseOrder[phase] ?? 0;
  const currentOrder = _projectPhaseOrder[knownPhase] ?? 0;
  if (incomingOrder < currentOrder) {
    return;
  }
  _projectCurrentPhase.set(projectKey, phase);

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

  // Actualizar porcentaje de imágenes si existe
  if (imagesProgress) {
    const imagesPercentageElement = container.querySelector('.images-percentage');
    if (imagesPercentageElement) {
      const normalizedImagesPercentage = Math.round(clampPercentage(imagesProgress.percentage) || 0);
      imagesPercentageElement.textContent = `${normalizedImagesPercentage}%`;
    }

    // Actualizar tarea de imágenes
    const imagesTaskElement = container.querySelector('.images-current-task');
    if (imagesTaskElement) {
      imagesTaskElement.textContent = imagesProgress.currentTask || 'Generando imágenes...';
    }
  }

  // Actualizar fase
  const phaseElement = container.querySelector('.project-phase');
  if (phaseElement) {
    const phaseNames = {
      script: 'Generando guiones',
      audio: 'Generando audios',
      images: 'Generando imágenes',
      completed: 'Completado'
    };
    phaseElement.textContent = phaseNames[phase] || 'Procesando...';
  }

  // Mostrar botones de sección cuando el proyecto esté completado o cuando los audios estén terminados
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
            <span>Sección ${sectionNumber}</span>
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

  // Actualizar cápsulas si estamos en fase de script o si el proyecto está completo
  if (phase === 'script') {
    updateProgressCapsules(currentStep, totalSteps, `progressCapsules-${projectKey}`);
  } else if (phase === 'audio' || phase === 'images' || phase === 'completed') {
    // Si pasamos de scripts a otra fase, marcar todas las cápsulas de scripts como completadas
    updateProgressCapsules(totalSteps, totalSteps, `progressCapsules-${projectKey}`);
  }

  // Actualizar cápsulas de audio si estamos en fase de audio
  if (phase === 'audio') {
    updateAudioCapsules(currentStep, totalSteps, `audioCapsules-${projectKey}`);
  } else if (phase === 'completed') {
    // Si el proyecto está completo, marcar todas las cápsulas de audio como completadas
    updateAudioCapsules(totalSteps, totalSteps, `audioCapsules-${projectKey}`);
  }

  // Actualizar cápsulas de audio si tenemos progreso de audio específico
  if (audioProgress && audioProgress.currentStep !== undefined) {
    updateAudioCapsules(audioProgress.currentStep, audioProgress.totalSteps || totalSteps, `audioCapsules-${projectKey}`);
  }

  // Actualizar cápsulas de imágenes si tenemos progreso de imágenes específico
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
  _projectCurrentPhase.clear();
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
    
    // Inicializar cápsulas de progreso
    initializeProgressCapsules();
  }
  
  // Ocultar el botón de generación mientras se muestra el progreso
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
    // Limpiar cápsulas
    const progressCapsules = document.getElementById('progressCapsules');
    if (progressCapsules) {
      progressCapsules.innerHTML = '';
    }
  }
  
  // Limpiar contenedores de progreso de proyectos
  clearAllProjectProgressContainers();
  
  // Detener polling - solo detener el polling general, no los individuales
  // Los polling individuales se detienen cuando se completan los proyectos específicos
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
          currentTask = `Generando guión ${progressData.currentStep}/${progressData.totalSteps}`;
        } else if (currentPhase === 'audio') {
          currentTask = `Generando audio ${progressData.currentStep}/${progressData.totalSteps}`;
        } else if (currentPhase === 'images') {
          currentTask = `Generando imágenes ${progressData.currentStep}/${progressData.totalSteps}`;
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
        
        // Detener polling si el proyecto está completo
        if (currentPhase === 'completed' || progressData.percentage >= 100) {
          console.log(`âœ… [${projectKey}] Proyecto completado, deteniendo polling`);
          stopProgressPolling(projectKey);
        }
      } else {
        console.warn(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â [${projectKey}] No se recibieron datos de progreso válidos:`, data);
      }
    } catch (error) {
      console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ [${projectKey}] Error obteniendo progreso del servidor:`, error);
    }
  }, 2000);
  
  progressPollingIntervals.set(projectKey, interval);
  return interval;
}

// Detener polling del progreso
function stopProgressPolling(projectKey = null) {
  if (projectKey) {
    // Detener polling para un proyecto específico
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

  // Actualizar cápsulas si estamos en fase de script (solo para compatibilidad con código antiguo)
  // Nota: El nuevo sistema usa updateProjectProgress con contenedores específicos
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
      images: 'Generando imágenes',
      completed: 'Generación finalizada'
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
    currentTask: 'Preparando generación...',
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
function completeProgressBar(message = 'Generación completada') {
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
  
  // Solo detener polling si no hay múltiples proyectos (para compatibilidad con sistema antiguo)
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (!hasMultipleProjects) {
    // Detener polling solo para el sistema antiguo de un solo proyecto
    stopProgressPolling();
    
    // Ocultar después de 3 segundos solo para proyectos únicos
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
  
  // Solo detener polling si no hay múltiples proyectos (para compatibilidad con sistema antiguo)
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (!hasMultipleProjects) {
    // Detener polling solo para el sistema antiguo de un solo proyecto
    stopProgressPolling();
    
    // Ocultar después de 5 segundos solo para proyectos únicos
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

// Función para cargar las voces disponibles de Applio
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
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error en respuesta de voces:', data);
      return false;
    }
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando voces de Applio:', error);
    return false;
  }
}

// Función para actualizar el dropdown de voces
function updateApplioVoicesDropdown() {
  const select = document.getElementById('applioVoiceSelect');
  if (!select) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró el dropdown de voces de Applio');
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
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Dropdown actualizado con ${availableApplioVoices.length} voces`);
  } else {
    // Opción por defecto si no hay voces
    const option = document.createElement('option');
    option.value = 'logs\\VOCES\\RemyOriginal.pth';
    option.textContent = 'RemyOriginal (Default)';
    select.appendChild(option);
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Dropdown con voz por defecto');
  }
}

// Función para mostrar/ocultar el dropdown de voces según la casilla de Applio
function toggleApplioVoiceDropdown() {
  const checkbox = document.getElementById('autoGenerateApplioAudio');
  const voiceGroup = document.getElementById('applioVoiceGroup');
  
  if (!checkbox || !voiceGroup) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontraron elementos de Applio');
    return;
  }
  
  if (checkbox.checked) {
    console.log('ðŸŽ¤ Activando selector de voces de Applio...');
    voiceGroup.style.display = 'flex';
    
    // Cargar voces si no se han cargado aún
    if (availableApplioVoices.length === 0) {
      loadApplioVoices();
    }
  } else {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬¡ Ocultando selector de voces de Applio...');
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
    voiceSelect.title = 'La voz se elegirá automáticamente para cada proyecto.';
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

// Función para mostrar/ocultar las configuraciones de voz Google según la casilla correspondiente
function toggleGoogleVoiceDropdown() {
  const checkbox = document.getElementById('autoGenerateAudio');
  const voiceGroup = document.getElementById('googleVoiceGroup');
  
  if (!checkbox || !voiceGroup) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontraron elementos de Google Voice');
    return;
  }
  
  if (checkbox.checked) {
    console.log('ðŸŽµ Activando configuraciones de voz Google...');
    voiceGroup.style.display = 'block';
  } else {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬¡ Ocultando configuraciones de voz Google...');
    voiceGroup.style.display = 'none';
  }

  updateRandomVoiceSelectionUI();
}

// Inicializar eventos para Applio cuando se carga la página
document.addEventListener('DOMContentLoaded', function() {
  console.log('ðŸŽ¤ Inicializando controles de Applio...');
  
  const applioCheckbox = document.getElementById('autoGenerateApplioAudio');
  
  const qwenCheckbox = document.getElementById('autoGenerateQwenAudio');
  if (qwenCheckbox) {
    qwenCheckbox.addEventListener('change', toggleQwenVoiceDropdown);
    toggleQwenVoiceDropdown();
  }

  if (applioCheckbox) {
    // Agregar evento para mostrar/ocultar dropdown
    applioCheckbox.addEventListener('change', toggleApplioVoiceDropdown);
    
    // Verificar estado inicial
    toggleApplioVoiceDropdown();
    
    console.log('âœ… Controles de Applio inicializados');
  } else {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró la casilla de Applio');
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
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontraron elementos del control de velocidad');
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
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontraron elementos del pitch slider');
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
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró la casilla de Google Audio');
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
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG: Verificando elementos de miniatura...');
  const createBtn = document.getElementById('createThumbnailStyleFromSidebar');
  const manageBtn = document.getElementById('manageThumbnailStylesFromSidebar');
  
  console.log('createThumbnailStyleFromSidebar:', createBtn);
  console.log('manageThumbnailStylesFromSidebar:', manageBtn);
  
  if (createBtn) {
    console.log('âœ… Botón crear miniatura encontrado, agregando click manual...');
    createBtn.onclick = function() {
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Click en crear miniatura detectado');
      openThumbnailStyleModal();
    };
  }
  
  if (manageBtn) {
    console.log('âœ… Botón gestionar miniatura encontrado, agregando click manual...');
    manageBtn.onclick = function() {
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Click en gestionar miniatura detectado');
      openManageThumbnailStylesModal();
    };
  }
}, 2000);

// Variables globales para el extractor de texto
let selectedFile = null;
let extractedText = '';

// Inicializar funcionalidad de extracción de texto tan pronto como sea posible
document.addEventListener('DOMContentLoaded', function() {
  console.log('ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â DOM cargado - iniciando extractor de texto...');
  initializeTextExtractor();
});

// También intentar inicializar después de que todo se cargue
setTimeout(() => {
  console.log('ÃƒÂ¢Ã‚ÂÃ‚Â° Timeout - verificando si el extractor necesita inicialización...');
  if (!window.extractorInitialized) {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Inicializando extractor de texto desde timeout...');
    initializeTextExtractor();
  }
}, 1000);

// Verificar que elementos existen al cargar
window.addEventListener('load', function() {
  console.log('ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â Ventana cargada completamente');
  
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
  
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Verificación de elementos:', elements);
  
  // Verificar si faltan elementos
  Object.keys(elements).forEach(key => {
    if (!elements[key]) {
      console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Elemento faltante: ${key}`);
    } else {
      console.log(`âœ… Elemento encontrado: ${key}`);
    }
  });
  
  // Intentar inicializar el extractor de texto nuevamente si no se hizo antes
  if (document.getElementById('extractTextBtn') && !window.extractorInitialized) {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Inicializando extractor de texto desde window.load...');
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
let allSections = []; // Almacenar todas las secciones generadas con datos completos (script, título, tokens)
let imagePrompts = []; // Almacenar los prompts de las imágenes
let isAutoGenerating = false; // Bandera para la generación automática
let isLoadingProject = false; // Bandera para evitar validaciones durante la carga de proyectos
let isMetadataShown = false; // Bandera para evitar mostrar metadatos duplicados

// Variables globales para estilos de miniatura
let customThumbnailStyles = [];
let currentEditingThumbnailStyleId = null;

// Estilos predeterminados de miniatura
const defaultThumbnailStyles = {
  'default': {
    name: 'Amarillo y Blanco (Predeterminado)',
    description: 'Estilo clásico con texto amarillo y blanco',
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
    name: 'Azul Neón',
    description: 'Estilo futurista con azul neón y efectos cyberpunk',
    primaryColor: 'azul neón',
    secondaryColor: 'cyan claro',
    instructions: 'El texto debe tener un estilo futurista cyberpunk con la frase principal en azul neón brillante y la secundaria en cyan claro, con contorno oscuro y efectos de resplandor azul neón'
  },
  'retro_purple': {
    name: 'Púrpura Retro',
    description: 'Estilo retro gaming con púrpura y rosa',
    primaryColor: 'púrpura brillante',
    secondaryColor: 'rosa',
    instructions: 'El texto debe tener un estilo retro gaming de los 80s con la frase principal en púrpura brillante y la secundaria en rosa, con contorno negro y efectos de resplandor púrpura'
  }
};

// Función para la generación automática completa
async function runAutoGeneration() {
  window._isActiveGeneration = true;
  console.log("ðŸ¤– Iniciando generación automática completa");
  
  // Verificar que los elementos del DOM estén disponibles
  const requiredElements = [
    'maxWords', 'styleSelect', 'imagesSelect', 'aspectRatioSelect', 
    'promptModifier', 'llmModelSelect', 
    'googleImages', 'localAIImages'
  ];
  
  const missingElements = requiredElements.filter(id => !document.getElementById(id));
  if (missingElements.length > 0) {
    console.error("ÃƒÂ¢Ã‚ÂÃ…â€™ Elementos del DOM faltantes:", missingElements);
    showError(`Error: No se encontraron los siguientes elementos: ${missingElements.join(', ')}`);
    return;
  }
  
  isAutoGenerating = true;
  
  const normalizedProjects = normalizeProjectEntries(collectProjectEntries());
  if (!normalizedProjects.length) {
    showError('Agrega al menos un tema antes de iniciar la generación automática.');
    isAutoGenerating = false;
    return;
  }

  // Generar nombres de carpeta con LLM para proyectos sin nombre explícito
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
        console.log('Ã¢Å¡Â Ã¯Â¸Â No se pudo generar nombre con LLM, usando fallback:', e.message);
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
  const mainLocalModel = document.getElementById("mainLocalModel")?.value || '';
  let googleImages = document.getElementById("googleImages")?.checked || false;
  let localAIImages = document.getElementById("localAIImages")?.checked || false;
  const comfyOnlyMode = document.getElementById('attemptComfyCheckbox')?.checked || false;

  if (comfyOnlyMode && !localAIImages) {
    localAIImages = true;
  }
  
  console.log("ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Configuración de imágenes:");
  console.log("  - Google Images:", googleImages);
  console.log("  - Local AI Images (ComfyUI):", localAIImages);
  console.log("  - Modelo seleccionado:", getImageModelLabel(selectedImageModel));
  
  // Calcular automáticamente skipImages: true si NO hay opciones de imágenes activas
  let skipImages = !googleImages && !localAIImages;
  console.log("  - Skip Images:", skipImages);
  
  const generateAudio = document.getElementById("autoGenerateAudio").checked;
  let generateApplioAudio = document.getElementById("autoGenerateApplioAudio").checked;
  let generateQwenAudio = document.getElementById("autoGenerateQwenAudio")?.checked || false;
  const selectedQwenVoice = document.getElementById("qwenVoiceSelect")?.value || "";
  const generateChatterboxAudio = document.getElementById("autoGenerateChatterboxAudio")?.checked || false;
  const chatterboxVoice = document.getElementById("chatterboxVoiceSelect")?.value || "";
  const chatterboxLanguage    = document.getElementById("chatterboxLanguage")?.value || "es";
  const chatterboxExaggeration = parseFloat(document.getElementById("chatterboxExaggeration")?.value ?? 0.5);
  const chatterboxCfgWeight    = parseFloat(document.getElementById("chatterboxCfgWeight")?.value ?? 0.5);
  const chatterboxTemperature  = parseFloat(document.getElementById("chatterboxTemperature")?.value ?? 0.8);
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
    console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Se solicitó voz aleatoria pero no hay opciones disponibles en el selector. Se usará la voz seleccionada manualmente.');
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
  
  // ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ VALIDACIÃ“N SIMPLIFICADA: Las imágenes se pueden generar con cualquier combinación
  // Prioridad: Si está activada IA Local, usar ComfyUI; si está Google Images, usar APIs de Google
  console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ…Â  Generación de audio Google: ${generateAudio ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`ðŸŽ¤ Generación de audio Applio: ${generateApplioAudio ? 'ACTIVADA' : 'DESACTIVADA'}`);
  if (generateApplioAudio) {
    console.log(`ÃƒÂ°Ã…Â¸Ã…Â½Ã¢â€žÂ¢ÃƒÂ¯Ã‚Â¸Ã‚Â Voz Applio seleccionada: ${selectedApplioVoice}`);
    console.log(`ÃƒÂ°Ã…Â¸Ã…Â½Ã…¡ÃƒÂ¯Ã‚Â¸Ã‚Â Modelo Applio: ${selectedApplioModel}`);
    console.log(`ðŸš€ Velocidad Applio: ${applioSpeed}`);
    console.log(`ðŸŽµ Pitch Applio: ${applioPitch}`);
  }
  console.log(`ðŸŽ­ Estilo de narración solicitado: ${narrationStyle || 'Sin estilo personalizado'}`);
  console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Imágenes de Google: ${googleImages ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`ðŸ§  Imágenes IA Local: ${localAIImages ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`ðŸš« Omitir imágenes (auto): ${skipImages ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`ÃƒÂ°Ã…Â¸Ã…Â½Ã¢â‚¬ÂºÃƒÂ¯Ã‚Â¸Ã‚Â Modo Comfy directo: ${comfyOnlyMode ? 'ACTIVADO' : 'DESACTIVADO'}`);
  if (parallelProjects.length) {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â€šÂ¬ Proyectos adicionales detectados para ejecución paralela:', parallelProjectsWithVoices);
  }
  
  let selectedGoogleApiIds = [];
  if (!skipImages && googleImages && typeof ensureGoogleApiSelectionReady === 'function') {
    try {
      const selectionReady = await ensureGoogleApiSelectionReady();
      if (selectionReady && typeof getSelectedGoogleApis === 'function') {
        selectedGoogleApiIds = getSelectedGoogleApis();
      }
    } catch (selectionError) {
      console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se pudieron preparar las APIs de Google para proyectos paralelos:', selectionError);
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
  
  // Limpiar el panel de prompts al iniciar una nueva generación
  clearPromptsPanel();
  
  // Actualizar botones de navegación
  updateNavigationButtons();

  // Deshabilitar controles durante la generación automática
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
  const includeAudioProgress = generateAudio || generateApplioAudio || generateQwenAudio;
  
  // Determinar si incluir barra de progreso de imágenes
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
    
    // Obtener configuración de ComfyUI si está habilitada
    let comfyUISettings = null;
    if (localAIImages) {
      comfyUISettings = getComfyUISettings();
      console.log('ðŸŽ¨ Configuración ComfyUI obtenida del frontend:', comfyUISettings);
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
        llmModel: selectedLlmModel === 'local' ? `ollama:${mainLocalModel}` : selectedLlmModel,
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
        generateQwenAudio,
        qwenVoice: selectedQwenVoice,
        generateChatterboxAudio,
        chatterboxVoice,
        chatterboxLanguage,
        chatterboxExaggeration,
        chatterboxCfgWeight,
        chatterboxTemperature,
        applioVoice: selectedApplioVoice,
        applioModel: selectedApplioModel,
        applioPitch,
        applioSpeed,
        applioQueueRunId,
        applioQueueOffset: generateApplioAudio ? 1 : 0
      };

      // Esperar a que se complete la inicialización de proyectos paralelos
      await triggerParallelProjectGeneration(parallelProjectsWithVoices, sharedParallelConfig);
    }
    
    // ===============================================================
    // FASE 1: GENERAR TODOS LOS GUIONES Y PROMPTS DE IMÃƒÆ’Ã‚ÂGENES
    // ===============================================================
    console.log('\nÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â INICIANDO FASE 1: Generación de guiones y prompts...');
    
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
      currentTask: 'Generando guiones y prompts de imágenes...'
    });
    
    startProgressPolling(primaryProjectKey, (progressData) => {
      updateProjectProgress(primaryProjectKey, progressData);
    });
    
    // Iniciar polling para proyectos paralelos con un pequeño delay para dar tiempo a que se guarden los archivos
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
        llmModel: selectedLlmModel === 'local' ? `ollama:${mainLocalModel}` : selectedLlmModel,
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
        useApplio: generateApplioAudio,
        generateQwenAudio: generateQwenAudio,
        qwenVoice: selectedQwenVoice,
        generateChatterboxAudio,
        chatterboxVoice,
        chatterboxLanguage,
        chatterboxExaggeration,
        chatterboxCfgWeight,
        chatterboxTemperature,
      })
    });

    const phase1Data = await phase1Response.json();
    
    if (!phase1Data.success) {
      throw new Error(`Fase 1 falló: ${phase1Data.error}`);
    }
    
    console.log('âœ… FASE 1 COMPLETADA:', phase1Data.message);

    // Lanzar B-Roll en paralelo con audio (fire-and-forget)
    const _brollMaxVids = parseInt(document.getElementById('brollMaxVideos')?.value) || 0;
    const _brollMaxImgs = parseInt(document.getElementById('brollMaxImages')?.value) || 0;
    if (_brollMaxVids > 0 || _brollMaxImgs > 0) {
      console.log('ðŸŽ¬ Lanzando B-Roll en paralelo con la generación...');
      const _brollTopic = document.getElementById('prompt')?.value?.trim();
      const _brollNumSections = parseInt(document.getElementById('sectionsNumber')?.value) || 8;
      const _brollFolder = folderName;
      const _brollProjectKey = primaryProject.folderName;
      // Create promise that will resolve when B-Roll download finishes
      _brollDonePromise = new Promise((resolve) => { _brollDonePromiseResolve = resolve; });
      // Fire and forget - no await (awaited later before completion screen)
      fetch('/api/broll/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName: _brollFolder, topic: _brollTopic, numSections: _brollNumSections })
      }).then(r => r.json()).then(analyzeData => {
        if (analyzeData.terms) {
          console.log('ðŸŽ¬ B-Roll: ' + analyzeData.terms.length + ' secciones analizadas, buscando videos...');
          return fetch('/api/broll/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ terms: analyzeData.terms, maxResults: _brollMaxVids, maxDuration: parseInt(document.getElementById('brollMaxDuration')?.value) || 20, mode: _brollShortsMode ? 'shorts' : 'normal', maxImages: _brollMaxImgs })
          });
        }
      }).then(r => r?.json()).then(searchData => {
        console.log('🎬 B-Roll search response:', searchData ? Object.keys(searchData) : 'null/undefined');
        if (searchData?.results) {
          console.log('🎬 B-Roll: Busqueda completa, iniciando descarga... (' + searchData.results.length + ' secciones)');
          fetch('/api/broll/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sections: searchData.results.map(sec => ({ ...sec, urls: (sec.videos || []).flatMap(v => (v.results || []).map(r => r.url)).filter(Boolean) })), folderName: _brollFolder, maxImages: _brollMaxImgs, resolution: document.getElementById('brollResolution')?.value || '720p' })
          }).then(r => r.json()).then(dlData => {
            console.log('🎬 B-Roll download response:', dlData);
            if (dlData.jobId) {
              console.log('🎬 B-Roll: Descarga iniciada (job: ' + dlData.jobId + ', videos: ' + (dlData.totalVideos || 0) + ', imgs: ' + (dlData.totalImageTasks || 0) + ')');
              initBrollProgressUI(_brollProjectKey, dlData.totalVideos || 0, dlData.totalImageTasks || 0);
              startBrollPolling(_brollProjectKey, dlData.jobId);
            } else {
              console.warn('⚠️ B-Roll download no devolvio jobId:', dlData);
              if (_brollDonePromiseResolve) { _brollDonePromiseResolve(); _brollDonePromiseResolve = null; }
            }
          }).catch(e => { console.warn('⚠️ B-Roll download fetch error:', e.message); if (_brollDonePromiseResolve) { _brollDonePromiseResolve(); _brollDonePromiseResolve = null; } });
        } else {
          console.warn('⚠️ B-Roll search no devolvio results. Keys:', searchData ? Object.keys(searchData) : 'null');
          if (_brollDonePromiseResolve) { _brollDonePromiseResolve(); _brollDonePromiseResolve = null; }
        }
      }).catch(e => { console.warn('⚠️ B-Roll chain error:', e.message); if (_brollDonePromiseResolve) { _brollDonePromiseResolve(); _brollDonePromiseResolve = null; } });
    }
    const projectData = phase1Data.data;
  const resolvedImageModel = normalizeImageModel(projectData?.imageModel || selectedImageModel);
  projectData.imageModel = resolvedImageModel;
    
    // El polling ya se inició antes de la generación
    console.log('ðŸ“Š Polling ya activo para proyecto:', projectData.projectKey);
    
    // IMPORTANTE: Para el proceso automático, determinar qué tipo de audio generar
    const shouldGenerateAudio = generateAudio || generateApplioAudio || (selectedApplioVoice && selectedApplioVoice !== '');
    // No forzar generateApplioAudio=true, respetar la selección del usuario
    
    // Mostrar los guiones generados en la UI
    allSections = projectData.sections.map(section => {
      const script = section.script;
      // Asegurar que cada script sea un string válido
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
        console.log(`ðŸŽ¨ Agregando ${sectionData.imagePrompts.length} prompts al panel lateral para sección ${i + 1}`);
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
      generateQwenAudio: generateQwenAudio,
      qwenVoice: selectedQwenVoice,
      generateChatterboxAudio,
      chatterboxVoice,
      chatterboxLanguage,
      chatterboxExaggeration,
      chatterboxCfgWeight,
      chatterboxTemperature,
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
    if (generateAudio || generateApplioAudio || generateQwenAudio || generateChatterboxAudio) {
      console.log('\nÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â VERIFICANDO INTEGRIDAD DE GUIONES PARA TODOS LOS PROYECTOS...');
      
      try {
        // Verificar guiones para el proyecto principal
        await regenerateMissingScripts();
        console.log('âœ… Verificación de guiones completada para proyecto principal');
        
        // Verificar guiones para proyectos adicionales si existen
        if (window.currentProject && window.currentProject.additionalProjects && window.currentProject.additionalProjects.length > 0) {
          console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Verificando guiones para ${window.currentProject.additionalProjects.length} proyectos adicionales...`);
          
          for (const additionalProject of window.currentProject.additionalProjects) {
            try {
              console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Verificando guiones para proyecto adicional: ${additionalProject.folderName}`);
              await regenerateMissingScriptsForProject(additionalProject.folderName);
              console.log(`âœ… Guiones verificados para proyecto: ${additionalProject.folderName}`);
            } catch (projectError) {
              console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error verificando guiones para proyecto ${additionalProject.folderName}:`, projectError);
              // Continuar con otros proyectos
            }
          }
        }
        
        console.log('âœ… Verificación de guiones completada para todos los proyectos');
      } catch (error) {
        console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error verificando guiones:', error);
        // No detener el proceso, continuar con la generación de audios
        console.log('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Continuando con generación de audios a pesar del error en verificación de guiones');
      }
    }
    
    // =============================================================== 
    // VERIFICACIÃ“N Y ESPERA: TODOS LOS PROYECTOS DEBEN ESTAR COMPLETOS
    // =============================================================== 
    async function waitForAllProjectsComplete(projectsToProcess) {
      console.log('\nÃƒÂ¢Ã‚ÂÃ‚Â³ ESPERANDO A QUE TODOS LOS PROYECTOS ESTÉN COMPLETOS ANTES DE GENERAR AUDIO...');
      
      return new Promise((resolve) => {
        const checkInterval = setInterval(async () => {
          console.log('\nÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Verificando completitud de todos los proyectos...');
          
          const allComplete = await verifyAllProjectsComplete(projectsToProcess);
          
          if (allComplete) {
            console.log('ðŸŽ‰ TODOS LOS PROYECTOS ESTÃƒÆ’Ã‚ÂN COMPLETOS - INICIANDO GENERACIÃ“N DE AUDIO');
            clearInterval(checkInterval);
            resolve(true);
          } else {
            console.log('ÃƒÂ¢Ã‚ÂÃ‚Â³ Algunos proyectos aún no están completos. Esperando 5 segundos para volver a verificar...');
            // Esperar 5 segundos antes de la próxima verificación
          }
        }, 5000); // Verificar cada 5 segundos
      });
    }
    
    // Función auxiliar para verificar si todos los proyectos están completos
    async function verifyAllProjectsComplete(projectsToProcess) {
      console.log('\nÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Verificando completitud de proyectos...');
      
      for (let i = 0; i < projectsToProcess.length; i++) {
        const project = projectsToProcess[i];
        console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â [${i + 1}/${projectsToProcess.length}] Verificando proyecto: ${project.projectName} (${project.projectKey})`);
        
        try {
          // Obtener el estado del proyecto desde el backend
          const projectStateResponse = await fetch(`/get-project-state/${project.projectKey}`);
          if (!projectStateResponse.ok) {
            console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ No se pudo obtener estado del proyecto ${project.projectKey}: ${projectStateResponse.status}`);
            return false;
          }
          
          const projectState = await projectStateResponse.json();
          
          // Verificar si el proyecto tiene todas las secciones completas
          const completedSections = projectState.completedSections?.length || 0;
          const totalSections = projectState.totalSections || 0;
          
          console.log(`ðŸ“Š Proyecto ${project.projectName}: ${completedSections}/${totalSections} secciones completas`);
          
          if (completedSections < totalSections) {
            console.log(`ÃƒÂ¢Ã‚ÂÃ‚Â³ Proyecto ${project.projectName} aún no está completo: ${completedSections}/${totalSections} secciones`);
            return false;
          }
          
          // Verificar que todas las secciones tienen guiones válidos
          for (let sectionNum = 1; sectionNum <= totalSections; sectionNum++) {
            try {
              const scriptResponse = await fetch(`/read-script-file/${project.projectKey}/${sectionNum}`);
              if (!scriptResponse.ok) {
                console.log(`ÃƒÂ¢Ã‚ÂÃ‚Â³ No se pudo leer guión de sección ${sectionNum} del proyecto ${project.projectKey}: ${scriptResponse.status}`);
                return false;
              }
              
              const scriptData = await scriptResponse.json();
              if (!scriptData.success || !scriptData.script || scriptData.script.trim().length === 0) {
                console.log(`ÃƒÂ¢Ã‚ÂÃ‚Â³ Guión vacío o inválido en sección ${sectionNum} del proyecto ${project.projectName}`);
                return false;
              }
              
              console.log(`âœ… Sección ${sectionNum} del proyecto ${project.projectName}: guión válido (${scriptData.script.length} caracteres)`);
            } catch (scriptError) {
              console.log(`ÃƒÂ¢Ã‚ÂÃ‚Â³ Error verificando guión de sección ${sectionNum} del proyecto ${project.projectKey}:`, scriptError.message);
              return false;
            }
          }
          
          console.log(`âœ… Proyecto ${project.projectName} está COMPLETO`);
          
        } catch (error) {
          console.log(`ÃƒÂ¢Ã‚ÂÃ‚Â³ Error verificando proyecto ${project.projectKey}:`, error.message);
          return false;
        }
      }
      
      console.log('âœ… Todos los proyectos verificados - están completos');
      return true;
    }
    
    // =============================================================== 
    // FASE 2: GENERAR TODOS LOS ARCHIVOS DE AUDIO SECUENCIALMENTE
    // =============================================================== 
    // MODIFICACIÃ“N: Si ya se generaron audios en Fase 1 (inmediata), no ejecutar Fase 2 para el proyecto principal
    // Pero sí ejecutar para proyectos adicionales si los hay
    
    const hasAdditionalProjects = window.currentProject && window.currentProject.additionalProjects && window.currentProject.additionalProjects.length > 0;
    
    // Si hay proyectos adicionales, siempre ejecutar Fase 2 (pero filtrar el principal si ya tiene audio)
    // Si NO hay proyectos adicionales, y ya se generó audio en Fase 1, saltar Fase 2
    
    if (generateAudio || generateApplioAudio || generateQwenAudio || generateChatterboxAudio) {
      console.log('\nðŸŽµ INICIANDO FASE 2: Generación secuencial de audio...');
      
      // Generar un ID único para esta sesión de generación de audio
      const audioRunId = `audio_batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let globalAudioOrder = 0;
      
      // Crear lista de proyectos en orden
      const projectsToProcess = [];
      
      // Solo agregar el proyecto principal si NO se generó audio en Fase 1
      // OJO: Fase 1 ya NO genera audios en el backend (se comentó/eliminó esa lógica).
      // Por lo tanto, debemos agregar el proyecto principal explícitamente.
      
      console.log('Ã¢â€žÂ¹Ã¯Â¸Â Agregando proyecto principal a la cola de generación de audio (Fase 2 manual).');
      
      projectsToProcess.push({
        projectKey: window.currentProject.projectKey,
        projectName: window.currentProject.topic,
        voice: effectivePrimaryVoice,
        isApplio: generateApplioAudio,
        isQwen: generateQwenAudio,
        qwenVoice: selectedQwenVoice,
        isChatterbox: generateChatterboxAudio,
        chatterboxVoice,
        chatterboxLanguage,
        chatterboxExaggeration,
        chatterboxCfgWeight,
        chatterboxTemperature,
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
            isQwen: generateQwenAudio,
            qwenVoice: selectedQwenVoice,
            isChatterbox: generateChatterboxAudio,
            chatterboxVoice,
            chatterboxLanguage,
            chatterboxExaggeration,
            chatterboxCfgWeight,
            chatterboxTemperature,
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

      // Esperar a que todos los proyectos estén completos antes de continuar
      // Esto es crucial porque la Fase 1 puede haber terminado de enviar solicitudes,
      // pero el backend aún puede estar procesando guiones/audios en segundo plano.
      await waitForAllProjectsComplete(hasAdditionalProjects ? projectsToProcess : [{
        projectKey: window.currentProject.projectKey,
        projectName: window.currentProject.topic
      }]);
      
      if (projectsToProcess.length === 0) {
        console.log('âœ… No hay proyectos pendientes de audio (el principal ya se generó en Fase 1).');
        // NO HACER RETURN AQUÃƒÆ’Ã‚Â, para permitir que continúe a la Fase 2.5
      } else {
        console.log(`ðŸŽµ Proyectos ADICIONALES a procesar en orden:`, projectsToProcess.map(p => `${p.projectName} (${p.projectKey})`));
        
        // ÃƒÂ¢Ã‚ÂÃ‚Â³ ESPERAR HASTA QUE TODOS LOS PROYECTOS ESTÉN COMPLETOS ANTES DE GENERAR AUDIO
        console.log('\nÃƒÂ¢Ã‚ÂÃ‚Â³ ESPERANDO A QUE TODOS LOS PROYECTOS TENGAN TODOS SUS GUIONES COMPLETOS...');
        await waitForAllProjectsComplete(projectsToProcess);
        
        console.log('âœ… TODOS LOS PROYECTOS ESTÃƒÆ’Ã‚ÂN LISTOS. Iniciando generación de audio secuencial...');
        
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
            console.log(`ðŸŽ¯ Este debería ser el TEMA 1`);
          }
          
// Función helper para procesar una sección individual
          const processSingleSectionAudio = async (sectionNum) => {
            console.log(`ðŸŽ¶ [${project.projectKey}] Generando audio: ${project.projectName} - Sección ${sectionNum}/${totalSections}`);
            
            try {
              // Inicializar progreso de audio al comenzar el proyecto (solo para la primera sección)
              if (sectionNum === 1) {
                updateProjectProgress(project.projectKey, {
                  percentage: 0,
                  phase: 'audio',
                  currentStep: 0,
                  totalSteps: totalSections,
                  currentTask: `Iniciando generación de audio...`,
                  audioProgress: {
                    percentage: 0,
                    currentStep: 0,
                    totalSteps: totalSections,
                    currentTask: `Iniciando generación de audio...`
                  }
                });
              }
              
              // (Progreso inicial eliminado para evitar saltos en batch)
              // const projectProgressPercentage = Math.round(((sectionNum - 1) / totalSections) * 100);
              
              // Obtener el script para esta sección
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
                    scriptContent = `Script para ${project.projectName} - Sección ${sectionNum}`;
                  }
                } catch (scriptError) {
                  scriptContent = `Script para ${project.projectName} - Sección ${sectionNum}`;
                }
              }
              
              if (scriptContent.trim() === "" || scriptContent.startsWith("Script para")) {
                scriptContent = `Contenido detallado de la sección ${sectionNum} del tema ${project.projectName}. Esta sección contiene información importante sobre el tema principal.`;
              }
              
              // Generar el audio
              const endpoint = (project.isApplio || project.isQwen || project.isChatterbox) ? "/generate-section-audio" : "/generate-audio";
              const requestBody = project.isChatterbox ? {
                script: scriptContent,
                topic: project.projectName,
                folderName: project.projectKey,
                currentSection: sectionNum,
                generateChatterboxAudio: true,
                chatterboxVoice: project.chatterboxVoice || '',
                chatterboxLanguage: project.chatterboxLanguage || 'es',
                chatterboxExaggeration: project.chatterboxExaggeration ?? 0.5,
                chatterboxCfgWeight: project.chatterboxCfgWeight ?? 0.5,
                chatterboxTemperature: project.chatterboxTemperature ?? 0.8,
              } : project.isQwen ? {
                script: scriptContent,
                topic: project.projectName,
                folderName: project.projectKey,
                currentSection: sectionNum,
                generateQwenAudio: true,
                qwenVoice: project.qwenVoice
              } : project.isApplio ? {
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
              
              // Marcar sección actual como "en proceso" antes del fetch (importante para TTS lentos como Chatterbox)
              updateProjectProgress(project.projectKey, {
                percentage: Math.round((completedAudioSections / totalSections) * 100),
                phase: 'audio',
                currentStep: completedAudioSections,
                totalSteps: totalSections,
                currentTask: `Generando audio sección ${sectionNum}...`,
                audioProgress: {
                  percentage: Math.round((completedAudioSections / totalSections) * 100),
                  currentStep: completedAudioSections,
                  totalSteps: totalSections,
                  currentTask: `Generando audio sección ${sectionNum}...`
                }
              });

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
                console.error(`Ã¢ÂÅ’ [${project.projectKey}] Error generando audio para ${project.projectName} - Sección ${sectionNum}: ${audioData.error}`);
              } else {
                console.log(`âœ… [${project.projectKey}] Audio generado exitosamente: ${project.projectName} - Sección ${sectionNum}`);
              }
              
              // Actualizar progreso final para esta sección
              completedAudioSections++;
              const finalProgressPercentage = Math.round((completedAudioSections / totalSections) * 100);
              
              updateProjectProgress(project.projectKey, {
                percentage: finalProgressPercentage,
                phase: completedAudioSections === totalSections ? 'completed' : 'audio',
                currentStep: completedAudioSections,
                totalSteps: totalSections,
                currentTask: completedAudioSections === totalSections ? 'Completado' : `Generando audio: Sección ${sectionNum} OK (${completedAudioSections}/${totalSections})`,
                audioProgress: {
                  percentage: finalProgressPercentage,
                  currentStep: completedAudioSections,
                  totalSteps: totalSections,
                  currentTask: completedAudioSections === totalSections ? 'Completado' : `Generando audio: Sección ${sectionNum} OK (${completedAudioSections}/${totalSections})`
                }
              });

            } catch (error) {
              console.error(`Ã¢ÂÅ’ [${project.projectKey}] Error procesando audio ${project.projectName} - Sección ${sectionNum}:`, error);
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
            
            // Pequeña pausa entre lotes
            if (startSection + batchSize <= totalSections) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        
        console.log(`âœ… [${projectIndex + 1}/${projectsToProcess.length}] PROYECTO COMPLETADO: ${project.projectName} (${project.projectKey})`);
        
        // Pausa entre proyectos para asegurar secuencialidad
        if (projectIndex < projectsToProcess.length - 1) {
          console.log(`ÃƒÂ¢Ã‚ÂÃ‚Â³ Esperando 2 segundos antes de pasar al siguiente proyecto...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      console.log('âœ… FASE 2 COMPLETADA: Todos los audios generados secuencialmente');
    }
    } else {
      console.log('ÃƒÂ¢Ã‚ÂÃ‚Â­ÃƒÂ¯Ã‚Â¸Ã‚Â FASE 2 OMITIDA: No se solicitó generación de audio');
    }

    // ===============================================================
    // FASE 2.5: GENERACIÃ“N DE TRADUCCIONES (SI SE SOLICITÃ“)
    // ===============================================================
    const includeTranslations = document.getElementById('includeTranslations')?.checked || false;
    const silencePadding = document.getElementById('audioSilencePadding')?.value || 20;

    if (includeTranslations) {
      console.log('\nÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â INICIANDO FASE 2.5: Generación de traducciones...');
      
      // Lista de todos los proyectos a procesar (principal + adicionales)
      const allProjectsToTranslate = [window.currentProject];
      if (window.currentProject.additionalProjects) {
        allProjectsToTranslate.push(...window.currentProject.additionalProjects);
      }

      for (const project of allProjectsToTranslate) {
        console.log(`ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â Procesando traducciones para: ${project.folderName}`);
        
        try {
          // 1. Generar textos traducidos
          console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Generando guiones traducidos para ${project.folderName}...`);
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
                                    console.log(`ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â [${project.folderName}] Progreso: ${data.message || (data.current ? data.current + '/' + data.totalTasks : '')}`);
                                }
                                if (data.complete) {
                                    resolve();
                                }
                                if (data.error) {
                                    console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error en traducción: ${data.error}`);
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
          console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error procesando traducciones para ${project.folderName}:`, error);
        }
      }
    }

    // ===============================================================
    // FASE 3: GENERAR TODAS LAS IMÃƒÆ’Ã‚ÂGENES (usando la misma función que el botón)
    // ===============================================================
    if (!skipImages) {
      console.log('\nðŸŽ¨ INICIANDO FASE 3: Generación de imágenes usando generateMissingImages()...');
      
      try {
        // Ejecutar la misma función que el botón "generateMissingImagesBtn"
        await generateMissingImages();
        console.log('âœ… FASE 3 COMPLETADA: Imágenes generadas correctamente');
      } catch (error) {
        console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error en FASE 3:', error);
        throw new Error(`Fase 3 falló: ${error.message}`);
      }
    } else {
      console.log('ÃƒÂ¢Ã‚ÂÃ‚Â­ÃƒÂ¯Ã‚Â¸Ã‚Â FASE 3 OMITIDA: Se solicitó omitir imágenes');
    }
    
    // =============================================================== 
    // VERIFICACIÃ“N FINAL: ASEGURAR QUE TODOS LOS AUDIOS ESTÉN COMPLETOS
    // =============================================================== 
    
    if (generateAudio || generateApplioAudio || generateQwenAudio || generateChatterboxAudio) {
      console.log('\nÃ°Å¸â€Â REALIZANDO VERIFICACIÃ“N FINAL DE AUDIOS...');
      
      // Esperar un momento para asegurar que el sistema de archivos se actualice
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      try {
        // Verificar audios para el proyecto principal
        await regenerateAllAudios();
        console.log('âœ… Verificación final de audios completada para proyecto principal');
        
        // Verificar audios para proyectos adicionales
        if (window.currentProject && window.currentProject.additionalProjects && window.currentProject.additionalProjects.length > 0) {
          console.log(`Ã°Å¸â€Â Verificando audios finales para ${window.currentProject.additionalProjects.length} proyectos adicionales...`);
          
          for (const additionalProject of window.currentProject.additionalProjects) {
            try {
              console.log(`Ã°Å¸â€Â Verificando audios finales para proyecto: ${additionalProject.folderName}`);
              // Usar la función de regenerar audios faltantes para el proyecto específico
              await regenerateAllAudiosForProject(additionalProject.folderName);
              console.log(`âœ… Audios finales verificados para proyecto: ${additionalProject.folderName}`);
            } catch (projectError) {
              console.error(`Ã¢ÂÅ’ Error verificando audios finales para proyecto ${additionalProject.folderName}:`, projectError);
              // No detener el proceso por errores en proyectos adicionales
            }
          }
        }
        
        console.log('âœ… Verificación final de audios completada para todos los proyectos');
      } catch (error) {
        console.error('Ã¢ÂÅ’ Error en verificación final de audios:', error);
        // No detener el proceso completo por errores en la verificación
        console.log('Ã¢Å¡Â Ã¯Â¸Â Generación completada pero con posibles audios faltantes');
      }
    }
    
    console.log('\n' + 'ðŸŽ‰'.repeat(50));
    console.log('ðŸŽ‰ GENERACIÃ“N AUTOMÃƒÆ’Ã‚ÂTICA POR LOTES COMPLETADA');
    console.log('ðŸŽ‰'.repeat(50));
    
    // ðŸ“Š COMPLETAR BARRA DE PROGRESO (solo para proyectos únicos)
    // ===============================================================
    // FASE FINAL B-ROLL: ESPERAR DESCARGA Y VERIFICAR SECCIONES
    // ===============================================================
    if (_brollMaxVids > 0 || _brollMaxImgs > 0) {
      if (_brollDonePromise) {
        console.log('Esperando a que la descarga de B-Roll termine...');
        await _brollDonePromise;
        _brollDonePromise = null;
        console.log('Descarga inicial de B-Roll completada');
      }

      console.log('Verificando B-Roll de cada seccion...');
      try {
        const verifyResp = await fetch('/api/broll/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folderName,
            totalSections,
            maxVideos: _brollMaxVids,
            maxImages: _brollMaxImgs,
            resolution: document.getElementById('brollResolution')?.value || '720p'
          })
        });
        const verifyData = await verifyResp.json();

        if (verifyData.allGood) {
          console.log('Todas las secciones tienen B-Roll completo');
        } else if (verifyData.repairStarted && verifyData.jobId) {
          console.log('Reparando B-Roll para secciones: ' + verifyData.missingSections.join(', '));

          const _brollRepairKey = primaryProject?.folderName || folderName;
          initBrollProgressUI(_brollRepairKey, verifyData.totalVideos || 0, verifyData.totalImageTasks || 0);

          await new Promise((resolve) => {
            const repairPoll = setInterval(async () => {
              try {
                const statusResp = await fetch('/api/broll/download/status/' + verifyData.jobId);
                if (!statusResp.ok) { clearInterval(repairPoll); resolve(); return; }
                const statusData = await statusResp.json();
                updateBrollProgress(_brollRepairKey, statusData.videos || [], statusData.imageTasks || [], statusData.done);
                if (statusData.done) {
                  clearInterval(repairPoll);
                  console.log('Reparacion de B-Roll completada');
                  resolve();
                }
              } catch (e) {
                console.warn('Error polling reparacion B-Roll:', e.message);
                clearInterval(repairPoll);
                resolve();
              }
            }, 2000);
          });
        } else if (!verifyData.allGood) {
          console.warn('Secciones sin B-Roll: ' + (verifyData.missingSections || []).join(', '));
        }
      } catch (verifyErr) {
        console.warn('Error verificando B-Roll:', verifyErr.message);
      }
    }

    const hasMultipleProjects = projectProgressContainers.size > 1;
    if (!hasMultipleProjects) {
      completeProgressBar('¡Generación automática completada exitosamente!');
    }
    
    showAutoGenerationComplete();
    
  } catch (error) {
    console.error("ÃƒÂ¢Ã‚ÂÃ…â€™ Error durante generación automática:", error);
    const hasMultipleProjects = projectProgressContainers.size > 1;
    if (!hasMultipleProjects) {
      showProgressError(error.message);
    }
    showError(`Error durante la generación automática: ${error.message}`);
  } finally {
    isAutoGenerating = false;
    disableControls(false);
    restoreGenerateButton();
  }
}

// Función para restaurar el botón de generar a su estado original
function restoreGenerateButton() {
  // Remover cualquier clase de loading
  generateBtn.classList.remove('loading');
  
  // Restaurar contenido original
  generateBtn.innerHTML = `
    <i class="fas fa-video"></i>
    <span>Generar Sección 1</span>
  `;
  
  // Asegurar que esté habilitado y visible
  generateBtn.disabled = false;
  generateBtn.style.display = 'inline-flex';
  
  // Limpiar cualquier etapa de loading residual
  const loadingStages = output.querySelector('.loading-stages');
  if (loadingStages) {
    loadingStages.remove();
    console.log("ðŸ§¹ Etapas de loading residuales limpiadas");
  }
  
  console.log("ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Botón de generar restaurado a su estado original");
}

// Función para obtener las instrucciones del estilo personalizado
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
  
  console.log(`ðŸŽ¨ DEBUG - No se encontró el estilo personalizado`);
  return null;
}

// Función para generar contenido de una sección
async function generateSectionContent(section, params) {
  try {
    const customStyleInstructions = getCustomStyleInstructions(params.selectedStyle);
    
    // Obtener configuración de ComfyUI si está habilitada
    let comfyUISettings = null;
    if (params.localAIImages && document.getElementById('localAIImages').checked) {
      comfyUISettings = getComfyUISettings();
      console.log('ðŸŽ¨ Configuración ComfyUI obtenida del frontend:', comfyUISettings);
      
      // Debug extra para verificar valores específicos
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Valores específicos:', {
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
        comfyUISettings: comfyUISettings, // Agregar configuración ComfyUI
        applioVoice: params.selectedApplioVoice,
        applioModel: params.selectedApplioModel,
        applioPitch: params.applioPitch,
        applioSpeed: params.applioSpeed,
        allSections: allSections
      })
    });

    const data = await response.json();
    
    if (data.script) {
      // Preparar datos completos de la sección
      let chapterTitle = null;
      if (globalChapterStructure && globalChapterStructure.length > 0 && section <= globalChapterStructure.length) {
        chapterTitle = globalChapterStructure[section - 1];
      }
      
      // Guardar la sección completa en el historial
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

// Función para generar audio de una sección con Applio
async function generateSectionApplioAudio(section) {
  try {
    console.log(`ðŸŽ¤ Iniciando generación de audio con Applio para sección ${section}...`);
    
    if (!allSections[section - 1]) {
      throw new Error(`No hay guión disponible para la sección ${section}`);
    }
    
    // Obtener el script de la sección (compatible con formato nuevo y antiguo)
    const sectionData = allSections[section - 1];
    const script = typeof sectionData === 'string' ? sectionData : sectionData.script;
    
    const selectedApplioVoice = document.getElementById("applioVoiceSelect").value;
    const selectedApplioModel = document.getElementById("applioModelSelect").value;
    const applioPitch = parseInt(document.getElementById("applioPitch").value) || 0;
    const applioSpeed = parseInt(document.getElementById("applioSpeed").value) || 0;
    console.log(`ðŸŽ¤ Usando voz de Applio: ${selectedApplioVoice}`);
    console.log(`ÃƒÂ°Ã…Â¸Ã…Â½Ã¢â‚¬ÂºÃƒÂ¯Ã‚Â¸Ã‚Â Usando modelo de Applio: ${selectedApplioModel}`);
    console.log(`ðŸŽµ Usando pitch: ${applioPitch}`);
    console.log(`ðŸš€ Usando velocidad: ${applioSpeed}`);
    
    const response = await fetch("/generate-section-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: script,
        topic: currentTopic,
        folderName: document.getElementById("folderName").value.trim(),
        currentSection: section,
        voice: "fr-FR-RemyMultilingualNeural",
        applioVoice: selectedApplioVoice,
        applioModel: selectedApplioModel,
        applioPitch: applioPitch,
        applioSpeed: applioSpeed,
        generateChatterboxAudio: document.getElementById("autoGenerateChatterboxAudio")?.checked || false,
        chatterboxVoice: document.getElementById("chatterboxVoiceSelect")?.value || "",
        chatterboxLanguage: document.getElementById("chatterboxLanguage")?.value || "es",
        chatterboxExaggeration: parseFloat(document.getElementById("chatterboxExaggeration")?.value ?? 0.5),
        chatterboxCfgWeight: parseFloat(document.getElementById("chatterboxCfgWeight")?.value ?? 0.5),
        chatterboxTemperature: parseFloat(document.getElementById("chatterboxTemperature")?.value ?? 0.8),
      })
    });

    const data = await response.json();
    
    if (data.success && data.audioFile) {
      console.log(`âœ… Audio Applio generado exitosamente para sección ${section}: ${data.audioFile}`);
      console.log(`ðŸ“Š Tamaño: ${(data.size / 1024).toFixed(1)} KB con ${data.method}`);
      
      // Esperar un momento adicional para asegurar que el archivo se escribió completamente
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
    console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando audio Applio para sección ${section}:`, error);
    return { 
      success: false, 
      error: error.message,
      section: section
    };
  }
}

// Función para generar audio de una sección
async function generateSectionAudio(section, voice) {
  try {
    console.log(`ðŸŽµ Iniciando generación de audio para sección ${section}...`);
    
    const narrationStyle = document.getElementById("narrationStyle").value.trim();
    
    // Obtener el script de la sección (compatible con formato nuevo y antiguo)
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
        script: script, // Usar el guión de la sección actual
        narrationStyle: narrationStyle
      })
    });

    const data = await response.json();
    
    if (data.success && data.audio) {
      console.log(`âœ… Audio generado exitosamente para sección ${section}: ${data.audio}`);
      
      // Esperar un momento adicional para asegurar que el archivo se escribió completamente
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      console.log(`ðŸŽµ Audio completamente procesado para sección ${section}`);
      return { success: true, data };
    } else {
      return { success: false, error: data.error || "Error generando audio" };
    }
  } catch (error) {
    console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando audio para sección ${section}:`, error);
    return { success: false, error: error.message };
  }
}

// Función para mostrar contenido de una sección
async function displaySectionContent(data, section) {
  return new Promise((resolve) => {
    // Almacenar estructura de capítulos si está disponible
    if (data.chapterStructure) {
      storeChapterStructure(data.chapterStructure);
    }
    
    // Mostrar guión
    showScript(data.script, section, totalSections, data.voice, data.scriptFile, data.tokenUsage);
    
    setTimeout(() => {
      // Usar los datos del servidor en lugar de leer los checkboxes
      const skipImages = data.imagesSkipped || false;
      const bingImages = data.bingImagesMode || false;
      const localAIImages = data.localAIMode || false;
      const downloadedImages = data.downloadedImages || [];
      const localAIImagesData = data.localAIImages || [];
      
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG displaySectionContent - skipImages: ${skipImages}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG displaySectionContent - bingImages: ${bingImages}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG displaySectionContent - localAIImages: ${localAIImages}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG displaySectionContent - downloadedImages.length: ${downloadedImages.length}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG displaySectionContent - localAIImagesData.length: ${localAIImagesData.length}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG displaySectionContent - data.imagesSkipped: ${data.imagesSkipped}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG displaySectionContent - data.bingImagesMode: ${data.bingImagesMode}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG displaySectionContent - data.localAIMode: ${data.localAIMode}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG displaySectionContent - data.images: ${data.images ? data.images.length : 'null'}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG displaySectionContent - data.imagePrompts: ${data.imagePrompts ? data.imagePrompts.length : 'null'}`);
      
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG displaySectionContent - EVALUANDO CONDICIONES:`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG - Condición 1 (IA Local): localAIImages=${localAIImages} && localAIImagesData.length=${localAIImagesData.length} > 0 = ${localAIImages && localAIImagesData.length > 0}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG - Condición 2 (Bing): bingImages=${bingImages} && downloadedImages.length=${downloadedImages.length} > 0 = ${bingImages && downloadedImages.length > 0}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG - Condición 3 (Normal): !skipImages=${!skipImages} && !bingImages=${!bingImages} && !localAIImages=${!localAIImages} && data.images=${data.images ? 'exists' : 'null'} = ${!skipImages && !bingImages && !localAIImages && data.images && data.images.length > 0}`);
      
      if (localAIImages && localAIImagesData.length > 0) {
        // Mostrar carrusel con imágenes generadas por IA Local
        console.log(`ðŸ¤– Mostrando carrusel con ${localAIImagesData.length} imágenes de IA Local`);
        console.log(`ðŸ¤– DEBUG - Datos de la primera imagen IA Local:`, localAIImagesData[0]);
        
        createCarousel(localAIImagesData, section, []);
        
        // Almacenar imágenes de IA Local en allSections
        if (allSections[section - 1]) {
          allSections[section - 1].images = localAIImagesData;
          allSections[section - 1].localAIMode = true;
          console.log(`ðŸ“‚ Imágenes de IA Local almacenadas en allSections[${section - 1}]`);
        }
        
      } else if (bingImages && downloadedImages.length > 0) {
        // Mostrar carrusel con imágenes descargadas de Bing
        console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Mostrando carrusel con ${downloadedImages.length} imágenes de Bing`);
        console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â DEBUG - Datos de la primera imagen:`, downloadedImages[0]);
        console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG - data.imageKeywords:`, data.imageKeywords);
        console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG - data completa:`, data);
        
        // Almacenar las keywords para el botón de refresh
        if (data.imageKeywords && data.imageKeywords.length > 0) {
          currentImageKeywords = data.imageKeywords;
          console.log(`ðŸŽ¯ Keywords almacenadas para refresh (bloque principal):`, currentImageKeywords);
        } else {
          console.warn(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se recibieron keywords para refresh (bloque principal)`);
          console.warn(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â DEBUG - data.imageKeywords:`, data.imageKeywords);
          currentImageKeywords = [];
        }
        
        console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â DEBUG - Llamando a createCarousel...`);
        createCarousel(downloadedImages, section, []);
        console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â DEBUG - createCarousel ejecutado`);
        
        // Guardar datos de imágenes en la sección para navegación
        if (allSections[section - 1]) {
          allSections[section - 1].images = downloadedImages;
          allSections[section - 1].imageKeywords = data.imageKeywords || [];
          allSections[section - 1].imageMode = 'bing';
          console.log(`ðŸ’¾ Datos de imágenes Bing guardados para sección ${section}`);
        }
      } else if (!skipImages && !bingImages && !localAIImages && data.images && data.images.length > 0) {
        // Mostrar carrusel de imágenes normales
        console.log(`ðŸ“· Mostrando carrusel de imágenes normales`);
        createCarousel(data.images, section, data.imagePrompts);
        
        // Guardar datos de imágenes en la sección para navegación
        if (allSections[section - 1]) {
          allSections[section - 1].images = data.images;
          allSections[section - 1].imagePrompts = data.imagePrompts || [];
          allSections[section - 1].imageMode = 'ai';
          console.log(`ðŸ’¾ Datos de imágenes AI guardados para sección ${section}`);
        }
      } else if (bingImages && data.imagePrompts && data.imagePrompts.length > 0) {
        // Fallback: mostrar prompts si falló la descarga de Bing
        console.log(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Descarga de Bing falló, mostrando prompts como fallback`);
        addPromptsToSidebar(data.imagePrompts, section);
        
        // Guardar datos de prompts en la sección para navegación
        if (allSections[section - 1]) {
          allSections[section - 1].imagePrompts = data.imagePrompts;
          allSections[section - 1].imageMode = 'prompts';
          console.log(`ðŸ’¾ Datos de prompts guardados para sección ${section}`);
        }
      } else if (data.imagePrompts && data.imagePrompts.length > 0) {
        // Mostrar prompts de imágenes en el panel lateral
        console.log(`ðŸ“‹ Mostrando prompts en el panel lateral`);
        addPromptsToSidebar(data.imagePrompts, section);
        
        // Guardar datos de prompts en la sección para navegación
        if (allSections[section - 1]) {
          allSections[section - 1].imagePrompts = data.imagePrompts;
          allSections[section - 1].imageMode = 'prompts';
          console.log(`ðŸ’¾ Datos de prompts guardados para sección ${section}`);
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

// Función para actualizar el progreso de generación automática
function updateGenerationProgress(section, total, phase, customMessage = null) {
  const phaseText = customMessage || (phase === 'script' ? 'Generando guión e imágenes' : phase === 'audio' ? 'Generando audio' : phase === 'images' ? 'Generando imágenes' : 'Procesando...');
  
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

// Función para mostrar etapa de generación de audio
function showAudioGenerationStage(section) {
  output.innerHTML = `
    <div class="loading-stages">
      <div class="stage completed" id="stage-script">
        <div class="stage-icon"><i class="fas fa-check-circle"></i></div>
        <div class="stage-text">Guión generado - Sección ${section}</div>
      </div>
      <div class="stage completed" id="stage-images">
        <div class="stage-icon"><i class="fas fa-check-circle"></i></div>
        <div class="stage-text">Imágenes procesadas</div>
      </div>
      <div class="stage active" id="stage-audio">
        <div class="stage-icon"><i class="fas fa-spinner loading"></i></div>
        <div class="stage-text">Generando audio narración...</div>
      </div>
    </div>
  `;
}

// Función para mostrar etapa de generación de imágenes
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
        <div class="stage-text">Generando todas las imágenes...</div>
      </div>
    </div>
  `;
}

// Función para mostrar completación de generación automática
async function showAutoGenerationComplete() {
  // No mostrar mensaje de éxito si hay múltiples proyectos en progreso
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (hasMultipleProjects) {
    console.log('ðŸ”„ Múltiples proyectos en progreso - omitiendo mensaje de éxito individual');
    return;
  }
  
  generateBtn.innerHTML = `
    <i class="fas fa-check-circle"></i>
    <span>Generación Automática Completada</span>
  `;
  
  // Limpiar las etapas de loading
  const loadingStages = output.querySelector('.loading-stages');
  if (loadingStages) {
    loadingStages.remove();
    console.log("ðŸ§¹ Etapas de loading limpiadas");
  }
  
  // Mostrar mensaje de éxito
  const successMessage = document.createElement('div');
  successMessage.className = 'auto-completion-message';
  successMessage.innerHTML = `
    <div class="success-content">
      <i class="fas fa-trophy"></i>
      <h3>¡Generación Automática Completada!</h3>
      <p>Se han generado exitosamente ${totalSections} secciones con guión, imágenes y audio.</p>
      <p>Puedes generar los metadatos de YouTube cuando lo necesites desde el botón "Generar Metadatos".</p>
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
      successContent.insertAdjacentHTML('beforeend', '<p><strong>ðŸŽ¬ Iniciando generación automática de video...</strong></p>');
    }
  }

  let projectButtonsUpdated = false;

  if (window.currentProject && Array.isArray(window.currentProject.completedSections)) {
    try {
      updateProjectButtons(window.currentProject);
      projectButtonsUpdated = true;
    } catch (projectButtonsError) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error actualizando los botones del proyecto tras la generación automática:', projectButtonsError);
    }
  }

  window._isActiveGeneration = false;

  if (!projectButtonsUpdated) {
    showVideoGenerationButton();
    updateYouTubeMetadataButtonState();

    if (shouldAnnounceAutoVideo) {
      console.log('ðŸŽ¬ Generación completa - iniciando video automático (fallback)...');
      setTimeout(() => {
        generateVideoAutomatically();
      }, 2000);
    }
  }
  
  setTimeout(() => {
    generateBtn.innerHTML = `
      <i class="fas fa-video"></i>
      <span>Generar Sección 1</span>
    `;
  }, 3000);

  // Auto-trigger Video B-Roll preview after completion
  setTimeout(async () => {
    const brollBtn = document.getElementById('generateBrollVideoBtn');
    if (brollBtn && brollBtn.style.display !== 'none' && !isGeneratingVideo) {
      console.log('Auto-iniciando preview de Video B-Roll...');
      try { await generateBrollPreview(); } catch (e) { console.warn('Error auto B-Roll:', e.message); }
    }
  }, 2500);
}

// Función para habilitar/deshabilitar controles
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
  
  // También deshabilitar los botones de video
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

// Función para mostrar mensaje de carga con etapas
function showLoadingStages(sectionNum, imageCount = 5, skipImages = false, googleImages = false, localAIImages = false) {
  let imageStagesHTML = '';
  
  if (!skipImages && !googleImages && !localAIImages) {
    // Modo normal: generar imágenes
    imageStagesHTML = `
      <div class="stage" id="stage-prompt">
        <div class="stage-icon"><i class="fas fa-brain"></i></div>
        <div class="stage-text">Creando secuencia visual...</div>
      </div>
      <div class="stage" id="stage-image">
        <div class="stage-icon"><i class="fas fa-images"></i></div>
        <div class="stage-text">Generando ${imageCount} imágenes gaming...</div>
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
        <div class="stage-text">Generando ${imageCount} imágenes con Fooocus...</div>
      </div>
    `;
  }
  
  output.innerHTML = `
    <div class="loading-stages">
      <div class="stage active" id="stage-script">
        <div class="stage-icon"><i class="fas fa-spinner loading"></i></div>
        <div class="stage-text">Generando guión - Sección ${sectionNum}...</div>
      </div>
      ${imageStagesHTML}
    </div>
  `;
}

// Función para actualizar etapa
function updateStage(stageId, status) {
  const stage = document.getElementById(stageId);
  
  // Validar que el elemento existe antes de continuar
  if (!stage) {
    console.warn(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â updateStage: Elemento con ID '${stageId}' no encontrado`);
    return;
  }
  
  const icon = stage.querySelector('.stage-icon i');
  
  // Validar que el icono existe
  if (!icon) {
    console.warn(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â updateStage: Icono no encontrado en elemento '${stageId}'`);
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

// Función para crear el carrusel de imágenes cronológicas
function createCarousel(images, sectionNum, receivedPrompts = []) {
  console.log(`ðŸŽ  DEBUG - createCarousel llamada con ${images.length} imágenes para sección ${sectionNum}`);
  
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
  
  // Guardar los prompts de las imágenes - manejar múltiples variaciones
  imagePrompts = images.map((img, index) => {
    if (img.prompt) {
      return img.prompt;
    } else if (img.caption) {
      // Para imágenes de Bing, usar el caption como prompt
      return img.caption;
    } else if (img.originalPromptIndex !== undefined && receivedPrompts && receivedPrompts[img.originalPromptIndex]) {
      // Si la imagen tiene un índice de prompt original, usar ese prompt
      return receivedPrompts[img.originalPromptIndex];
    } else if (receivedPrompts && receivedPrompts[Math.floor(index / 3)]) {
      // Fallback: dividir el índice por 3 para obtener el prompt original
      return receivedPrompts[Math.floor(index / 3)];
    }
    return '';
  });
  
  console.log('Prompts guardados:', imagePrompts.length);
  
  // Actualizar títulos
  carouselSectionTitle.textContent = `Sección ${sectionNum}`;
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
      img.alt = imageData.caption || `Imagen ${index + 1} de la Sección ${sectionNum}`;
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Cargando imagen local: ${relativePath} (original: ${imageData.path})`);
    } else if (imageData.url) {
      // Imagen con URL pública (por ejemplo, Bing sin descarga local)
      img.src = imageData.url;
      img.alt = imageData.caption || `Imagen ${index + 1} de la Sección ${sectionNum}`;
      console.log(`ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â Cargando imagen externa: ${imageData.url}`);
    } else if (imageData.image) {
      // Imagen generada con IA (base64)
      img.src = "data:image/png;base64," + imageData.image;
      img.alt = `Imagen ${index + 1} de la Sección ${sectionNum}`;
      console.log(`ðŸ¤– Cargando imagen IA (base64)`);
    } else {
      // Fallback para formato no reconocido
      console.warn('Formato de imagen no reconocido:', imageData);
      img.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNiIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlbiBubyBkaXNwb25pYmxlPC90ZXh0Pjwvc3ZnPg==";
      img.alt = `Error cargando imagen ${index + 1}`;
    }
    
    img.style.opacity = "0";
    img.style.transition = "opacity 0.5s ease";
    
    // Agregar manejo de errores para imágenes de Bing
    img.onerror = function() {
      this.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNiIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkVycm9yIGNhcmdhbmRvIGltYWdlbjwvdGV4dD48L3N2Zz4=";
      this.alt = "Error cargando imagen";
    };
    
    imageContainer.appendChild(img);
    
    // Agregar botones de acción para imágenes de Bing
    if (imageData.url) {
      // Obtener keyword para esta imagen
      const imageKeyword = (currentImageKeywords && currentImageKeywords[index]) ? currentImageKeywords[index] : '';
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Ëœ [createCarousel] Imagen ${index}: keyword="${imageKeyword}"`);
      
      const actionButtons = document.createElement('div');
      actionButtons.className = 'bing-image-actions';
      actionButtons.innerHTML = `
        <div class="keyword-editor">
          <label for="keyword-${index}-${sectionNum}">Término de búsqueda:</label>
          <input type="text" id="keyword-${index}-${sectionNum}" class="keyword-input" value="${imageKeyword}" placeholder="Ingresa términos de búsqueda...">
        </div>
        <div class="action-buttons">
          <button class="btn-bing-download" onclick="downloadBingImage('${imageData.url}', '${imageData.filename || 'bing_image.jpg'}')" title="Descargar imagen">
            <i class="fas fa-download"></i>
          </button>
          <button class="btn-bing-fullscreen" onclick="showBingImageFullscreen('${imageData.url}', '${imageData.caption || 'Imagen de Bing'}')" title="Ver en tamaño completo">
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
    
    // Añadir número al indicador
    const indicatorNumber = document.createElement('span');
    indicatorNumber.textContent = index + 1;
    indicator.appendChild(indicatorNumber);
    
    carouselIndicators.appendChild(indicator);
    
    // Animación de carga de imagen
    setTimeout(() => {
      img.style.opacity = "1";
    }, index * 200);
  });
  
  // Mostrar carrusel
  console.log(`ðŸŽ  DEBUG - Mostrando carrusel: ${carouselContainer ? 'elemento encontrado' : 'elemento NO encontrado'}`);
  console.log(`ðŸŽ  DEBUG - Display antes:`, carouselContainer ? carouselContainer.style.display : 'N/A');
  
  carouselContainer.style.display = "block";
  
  console.log(`ðŸŽ  DEBUG - Display después:`, carouselContainer ? carouselContainer.style.display : 'N/A');
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

// Función para configurar controles del carrusel
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

// Función para ir a un slide específico
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

// Función para actualizar estado de botones del carrusel
function updateCarouselButtons() {
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  
  prevBtn.disabled = currentSlide === 0;
  nextBtn.disabled = currentSlide === totalSlides - 1;
}

// Función para configurar el panel de prompts de imágenes
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
  
  // Re-obtener referencias después del clonado
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
  
  // Configurar botón de editar
  newEditPromptBtn.addEventListener("click", () => {
    promptView.style.display = "none";
    promptEdit.style.display = "block";
    
    // Llenar el textarea con el prompt actual
    promptTextarea.value = imagePrompts[currentSlide] || '';
    promptTextarea.focus();
  });
  
  // Configurar botón de cancelar
  newCancelPromptBtn.addEventListener("click", () => {
    promptEdit.style.display = "none";
    promptView.style.display = "block";
  });
  
  // Configurar botón de guardar y regenerar
  newSavePromptBtn.addEventListener("click", async () => {
    const newPrompt = promptTextarea.value.trim();
    if (!newPrompt) {
      alert("El prompt no puede estar vacío");
      return;
    }
    
    await regenerateImage(currentSlide, newPrompt);
  });
  
  // Configurar botón de regenerar imagen (sin editar prompt)
  if (newRegenerateImageBtn) {
    newRegenerateImageBtn.addEventListener("click", async () => {
      const currentPrompt = imagePrompts[currentSlide];
      if (!currentPrompt) {
        alert("No hay prompt disponible para regenerar esta imagen");
        return;
      }
      
      // Mostrar estado de carga en el botón
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
        alert('Error al regenerar la imagen. Por favor, inténtalo de nuevo.');
      } finally {
        // Restaurar estado del botón
        newRegenerateImageBtn.disabled = false;
        newRegenerateImageBtn.classList.remove('loading');
        newRegenerateImageBtn.innerHTML = originalContent;
      }
    });
  }
  
  // Configurar primer prompt
  // updateImagePromptPanel(); // Comentado: Panel eliminado
}

// Función para actualizar el panel de prompt de la imagen actual
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

// Función para regenerar una imagen
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
      // Ahora el backend devuelve múltiples imágenes, usar la primera como reemplazo principal
      const primaryImage = data.images[0];
      
      // Actualizar la imagen en el carrusel con la primera variación
      const slides = document.querySelectorAll('.carousel-slide');
      const img = slides[imageIndex].querySelector('img');
      img.src = "data:image/png;base64," + primaryImage.image;
      
      // Actualizar el prompt guardado
      imagePrompts[imageIndex] = data.prompt;
      
      // Actualizar el prompt mostrado
      // updateImagePromptPanel(); // Comentado: Panel eliminado
      
      // Mostrar mensaje de éxito con información sobre las variaciones
      regenerationStatus.innerHTML = `
        <div class="regeneration-loading" style="color: #00ff7f;">
          <i class="fas fa-check-circle"></i>
          <span>¡${data.images.length} variaciones regeneradas! Se muestra la primera.</span>
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
    // Restaurar botón
    savePromptBtn.disabled = false;
    savePromptBtn.innerHTML = `
      <i class="fas fa-save"></i>
      Guardar y Regenerar
    `;
  }
}

// Función para mostrar guión (sin audio inicialmente)
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
  
  // Obtener el título del capítulo actual
  let chapterTitle = null;
  if (globalChapterStructure && globalChapterStructure.length > 0 && sectionNum <= globalChapterStructure.length) {
    chapterTitle = globalChapterStructure[sectionNum - 1];
  }
  
  // Guardar la sección completa en el array de secciones
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
  
  console.log(`Guardando sección ${sectionNum} completa:`, {
    script: script.substring(0, 100) + '...',
    chapterTitle: chapterTitle,
    tokenUsage: tokenUsage
  });
  
  // Actualizar títulos y contadores
  sectionTitle.textContent = `Sección ${sectionNum}`;
  currentSectionSpan.textContent = sectionNum;
  totalSectionsSpan.textContent = totalSections;
  
  // Actualizar título del capítulo si está disponible
  updateChapterTitle(sectionNum);
  
  // Actualizar información de tokens si está disponible
  updateTokenUsage(tokenUsage);
  
  // Crear contenido del script con información del archivo guardado
  let scriptHTML = `
    <div class="script-container">
      <div class="script-actions">
        <button class="copy-script-btn" onclick="copyScriptText()" title="Copiar texto del guión">
          <i class="fas fa-copy"></i>
        </button>
        <button class="audio-script-btn" onclick="generateSectionAudioButton()" title="Generar audio del guión">
          <i class="fas fa-microphone"></i>
        </button>
      </div>
      <div class="script-text">${script.replace(/\n/g, '<br><br>')}</div>
    </div>`;
  
  // Agregar información sobre el archivo guardado si está disponible
  if (scriptFileInfo && scriptFileInfo.saved) {
    scriptHTML += `
      <div class="script-file-info">
        <div class="file-saved-notification">
          <i class="fas fa-save"></i>
          <span>Guión guardado automáticamente como: <strong>${scriptFileInfo.filename}</strong></span>
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
  
  // Mostrar botón de generar audio
  generateAudioBtn.style.display = "inline-flex";
  
  // Actualizar estado de los botones de navegación
  updateNavigationButtons();
  
  // Reinicializar navegación para asegurar que los eventos funcionen
  initializeSectionNavigation();
  
  // Animación de escritura
  scriptContent.style.opacity = "0";
  setTimeout(() => {
    scriptContent.style.transition = "opacity 1s ease";
    scriptContent.style.opacity = "1";
  }, 100);
}

// Función para mostrar audio cuando se genere
function showAudio(audioFileName, voiceUsed) {
  const audioControls = document.getElementById("audio-controls");
  const scriptAudio = document.getElementById("scriptAudio");
  const playBtn = document.getElementById("playBtn");
  
  scriptAudio.src = audioFileName;
  audioControls.style.display = "flex";
  
  // Actualizar el texto del botón para mostrar la voz usada
  const voiceInfo = voiceUsed ? ` (${voiceUsed})` : '';
  playBtn.innerHTML = `
    <i class="fas fa-play"></i>
    <span>Escuchar Narración${voiceInfo}</span>
  `;
  
  // Ocultar botón de generar audio y campo de estilo de narración
  generateAudioBtn.style.display = "none";
  
  setupAudioControls();
}

// Función para copiar el texto del guión al portapapeles
function copyScriptText() {
  // Obtener el script de la sección actual que se está mostrando (compatible con formato nuevo y antiguo)
  const sectionData = allSections[currentSectionNumber - 1];
  const scriptText = typeof sectionData === 'string' ? sectionData : (sectionData ? sectionData.script : null);
  
  if (!scriptText) {
    console.log(`ÃƒÂ¢Ã‚ÂÃ…â€™ No hay texto del guión para la sección ${currentSectionNumber}`);
    return;
  }
  
  // Usar la API moderna del portapapeles si está disponible
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(scriptText).then(() => {
      console.log(`âœ… Texto del guión de la sección ${currentSectionNumber} copiado al portapapeles`);
      showCopyNotification();
    }).catch(err => {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error copiando al portapapeles:', err);
      fallbackCopyTextToClipboard(scriptText);
    });
  } else {
    // Fallback para navegadores más antiguos
    fallbackCopyTextToClipboard(scriptText);
  }
}

// Función fallback para copiar texto (navegadores más antiguos)
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
      console.log('âœ… Texto del guión copiado al portapapeles (fallback)');
      showCopyNotification();
    } else {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error copiando al portapapeles (fallback)');
    }
  } catch (err) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error ejecutando comando de copia:', err);
  }
  
  document.body.removeChild(textArea);
}

// Función para mostrar notificación de copiado
function showCopyNotification() {
  const button = document.querySelector('.copy-script-btn');
  if (button) {
    const originalHTML = button.innerHTML;
    button.innerHTML = `<i class="fas fa-check"></i> Sección ${currentSectionNumber}`;
    button.style.background = 'linear-gradient(135deg, #00ff7f, #00bf63)';
    
    setTimeout(() => {
      button.innerHTML = originalHTML;
      button.style.background = '';
    }, 2000);
  }
}

// Función para generar audio de la sección actual usando Applio (botón micrófono)
async function generateSectionAudioButton() {
  const audioButton = document.querySelector('.audio-script-btn');
  if (!audioButton) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Botón de audio no encontrado');
    return;
  }

  // Verificar que tenemos los datos necesarios
  if (!currentScript || !currentTopic || !currentSectionNumber) {
    showError('No hay suficientes datos para generar el audio. Asegúrate de haber generado una sección primero.');
    return;
  }

  const originalHTML = audioButton.innerHTML;
  const originalBackground = audioButton.style.background;
  
  try {
    // Mostrar estado de carga
    audioButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    audioButton.style.background = 'linear-gradient(135deg, #ff9500, #ff7b00)';
    audioButton.disabled = true;

    console.log(`ðŸŽµ Generando audio con Applio para sección ${currentSectionNumber}...`);

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
      // Mostrar éxito
      audioButton.innerHTML = '<i class="fas fa-check"></i>';
      audioButton.style.background = 'linear-gradient(135deg, #00ff7f, #00bf63)';
      
      showSuccess(`Audio generado con ${result.method || 'Applio'} para la sección ${currentSectionNumber}`);
      
      console.log(`âœ… Audio generado: ${result.audioFile}`);
      
    } else {
      throw new Error(result.error || 'Error generando audio');
    }

  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando audio:', error);
    
    // Mostrar error
    audioButton.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
    audioButton.style.background = 'linear-gradient(135deg, #e53e3e, #c53030)';
    
    // Mensajes de error más específicos
    let errorMessage = `Error generando audio: ${error.message}`;
    
    if (error.message.includes('servidor Applio no disponible') || error.message.includes('503')) {
      errorMessage = 'Servidor Applio no disponible. Ejecuta: python applio_server.py en el puerto 5004';
    } else if (error.message.includes('ECONNREFUSED')) {
      errorMessage = 'No se puede conectar al servidor Applio. Verifica que esté corriendo.';
    }
    
    showError(errorMessage);
  } finally {
    // Restaurar botón después de 3 segundos
    setTimeout(() => {
      audioButton.innerHTML = originalHTML;
      audioButton.style.background = originalBackground;
      audioButton.disabled = false;
    }, 3000);
  }
}

// Función para configurar controles de audio
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
  
  // Función para formatear tiempo
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  
  // Función para actualizar posición de la barra de progreso
  function updateProgress() {
    if (!isDragging && scriptAudio.duration) {
      const progress = (scriptAudio.currentTime / scriptAudio.duration) * 100;
      progressFill.style.width = progress + '%';
      progressHandle.style.left = progress + '%';
      currentTimeEl.textContent = formatTime(scriptAudio.currentTime);
    }
  }
  
  // Función para establecer posición del audio
  function setAudioPosition(percentage) {
    if (scriptAudio.duration) {
      scriptAudio.currentTime = (percentage / 100) * scriptAudio.duration;
      progressFill.style.width = percentage + '%';
      progressHandle.style.left = percentage + '%';
      currentTimeEl.textContent = formatTime(scriptAudio.currentTime);
    }
  }
  
  // Eventos de los botones de reproducción
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
  
  // Soporte para dispositivos táctiles
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

// Función para mostrar error
function showError(message) {
  output.innerHTML = `
    <div class="error-message">
      <i class="fas fa-exclamation-triangle"></i>
      <strong>¡Oops!</strong> ${message}
    </div>
  `;
}

// Función para mostrar éxito
function showSuccess(message) {
  output.innerHTML = `
    <div class="success-message">
      <i class="fas fa-check-circle"></i>
      <strong>¡Éxito!</strong> ${message}
    </div>
  `;
}

// Función para mostrar mensaje de finalización
function showCompletionMessage(sectionNum, totalSections, isComplete) {
  if (isComplete) {
    output.innerHTML = `
      <div class="completion-message">
        <div class="completion-icon">
          <i class="fas fa-trophy"></i>
        </div>
        <h3>¡Guión Completo de "Crónicas del Gaming"!</h3>
        <p>Has generado todas las ${totalSections} secciones del guión. Cada sección incluye su secuencia visual cronológica. Ahora puedes generar el audio de narración.</p>
        <p style="color: #00ff7f; margin-top: 15px;"><i class="fas fa-youtube"></i> Usa el botón "Generar Metadatos" cuando quieras preparar la metadata de YouTube.</p>
      </div>
    `;
      updateYouTubeMetadataButtonState();
  } else {
    output.innerHTML = `
      <div class="completion-message">
        <div class="completion-icon">
          <i class="fas fa-check-circle"></i>
        </div>
        <h3>¡Sección ${sectionNum} Completada!</h3>
        <p>Guión y secuencia visual de la Sección ${sectionNum} listos. Puedes generar el audio o continuar con la Sección ${sectionNum + 1}.</p>
      </div>
    `;
  }
}

// Event listener para el botón principal
generateBtn.addEventListener("click", async () => {
  // Feedback inmediato: spinner + texto "Iniciando..."
  generateBtn.disabled = true;
  generateBtn.classList.add('loading');

  console.log("ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG: Botón clickeado");
  
  // Generación automática está siempre activada
  const autoGenerate = true;
  console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG: autoGenerate = ${autoGenerate}`);
  
  if (autoGenerate) {
    console.log("ðŸ¤– DETECTADO: Generación automática ACTIVADA - usando sistema de lotes");
    // Pequeño delay para asegurar que el DOM esté completamente listo
    setTimeout(async () => {
      await runAutoGeneration();
    }, 100);
    return;
  }
  
  console.log("ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â DETECTADO: Generación automática DESACTIVADA - usando sistema tradicional");
  
  // Continuar con la generación normal
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
  const mainLocalModel = document.getElementById("mainLocalModel")?.value || '';
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
    console.log("Tema vacío, mostrando error");
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
  
  // Limpiar el panel de prompts al iniciar una nueva generación
  clearPromptsPanel();
  
  // Actualizar botones de navegación
  updateNavigationButtons();

  // Deshabilitar botón y mostrar estado de carga
  generateBtn.disabled = true;
  generateBtn.style.display = 'none';
  generateBtn.innerHTML = `
    <i class="fas fa-spinner loading"></i>
    <span>Generando Sección 1...</span>
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
        llmModel: selectedLlmModel === 'local' ? `ollama:${mainLocalModel}` : selectedLlmModel,
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

    // Almacenar estructura de capítulos si está disponible (función principal)
    if (data.chapterStructure) {
      storeChapterStructure(data.chapterStructure);
      console.log('ðŸ“š Estructura de capítulos recibida:', data.chapterStructure.length, 'capítulos');
    }

    if (data.script) {
      // Actualizar etapas completadas (con pequeño delay para asegurar que los elementos existen)
      setTimeout(() => {
        updateStage('stage-script', 'completed');
      }, 100);
      
      if (!skipImages && ((data.images && data.images.length > 0) || (data.downloadedImages && data.downloadedImages.length > 0) || (data.localAIImages && data.localAIImages.length > 0))) {
        // Con imágenes (IA generadas o descargadas de Bing)
        setTimeout(() => {
          updateStage('stage-prompt', 'completed');
          updateStage('stage-image', 'completed');
        }, 200);
        
        // Mostrar guión primero
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile, data.tokenUsage);
        }, 500);
        
        // Mostrar carrusel de imágenes
        setTimeout(() => {
          if (data.localAIImages && data.localAIImages.length > 0) {
            // Imágenes generadas con IA Local
            console.log(`ðŸ¤– Mostrando carrusel con ${data.localAIImages.length} imágenes de IA Local`);
            
            createCarousel(data.localAIImages, data.currentSection, data.imagePrompts || []);
            
            // Guardar datos de imágenes en la sección para navegación
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.localAIImages;
              allSections[data.currentSection - 1].imagePrompts = data.imagePrompts || [];
              allSections[data.currentSection - 1].imageMode = 'local_ai';
              allSections[data.currentSection - 1].localAIMode = true;
              console.log(`ðŸ’¾ Datos de imágenes IA Local guardados para sección ${data.currentSection}`);
            }
            
          } else if (data.downloadedImages && data.downloadedImages.length > 0) {
            // Imágenes de Bing descargadas
            console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Mostrando carrusel con ${data.downloadedImages.length} imágenes de Bing`);
            
            // âœ… IMPORTANTE: Almacenar las keywords ANTES de crear el carrusel
            if (data.imageKeywords && data.imageKeywords.length > 0) {
              currentImageKeywords = data.imageKeywords;
              console.log(`ðŸŽ¯ Keywords almacenadas para refresh (función principal):`, currentImageKeywords);
            } else {
              console.warn(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se recibieron keywords para refresh (función principal)`);
              console.warn(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â DEBUG - data.imageKeywords:`, data.imageKeywords);
              console.warn(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â DEBUG - data completa:`, data);
              currentImageKeywords = [];
            }
            
            // âœ… Crear carrusel después de asignar keywords
            createCarousel(data.downloadedImages, data.currentSection, []);
            
            // Guardar datos de imágenes en la sección para navegación (función principal)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.downloadedImages;
              allSections[data.currentSection - 1].imageKeywords = data.imageKeywords || [];
              allSections[data.currentSection - 1].imageMode = 'bing';
              console.log(`ðŸ’¾ Datos de imágenes Bing guardados para sección ${data.currentSection} (función principal)`);
            }
          } else if (data.images && data.images.length > 0) {
            // Imágenes generadas con IA
            console.log(`ðŸ“· Mostrando carrusel de imágenes IA`);
            createCarousel(data.images, data.currentSection, data.imagePrompts);
            
            // Guardar datos de imágenes en la sección para navegación (función principal)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.images;
              allSections[data.currentSection - 1].imagePrompts = data.imagePrompts || [];
              allSections[data.currentSection - 1].imageMode = 'ai';
              console.log(`ðŸ’¾ Datos de imágenes AI guardados para sección ${data.currentSection} (función principal)`);
            }
          }
        }, 1000);
      } else {
        // Sin imágenes generadas o descargadas
        // Mostrar solo el guión
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile, data.tokenUsage);
          
          // Solo ocultar el carrusel si NO hay imágenes de Bing
          if (!data.downloadedImages || data.downloadedImages.length === 0) {
            document.getElementById("carousel-container").style.display = "none";
          }
          
          // Verificar si hay imágenes descargadas de Bing o prompts tradicionales
          console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG FRONTEND - Verificando imágenes/prompts...`);
          console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG FRONTEND - data.downloadedImages:`, data.downloadedImages);
          console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG FRONTEND - data.bingImagesMode:`, data.bingImagesMode);
          console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG FRONTEND - data.imagePrompts:`, data.imagePrompts);
          console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG FRONTEND - data.googleImagesMode:`, data.googleImagesMode);
          console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG FRONTEND - data.mode:`, data.mode);
          
          // Mostrar imágenes de Bing en carrusel si están disponibles
          if (data.downloadedImages && data.downloadedImages.length > 0 && data.bingImagesMode) {
            console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Mostrando carrusel tardío con ${data.downloadedImages.length} imágenes de Bing`);
            
            // Almacenar las keywords para el botón de refresh
            if (data.imageKeywords && data.imageKeywords.length > 0) {
              currentImageKeywords = data.imageKeywords;
              console.log(`ðŸŽ¯ Keywords almacenadas para refresh:`, currentImageKeywords);
            } else {
              console.warn(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se recibieron keywords para refresh`);
              currentImageKeywords = [];
            }
            
            createCarousel(data.downloadedImages, data.currentSection, []);
          }
          // Solo mostrar en panel lateral si NO se omiten imágenes, NO hay imágenes de Bing y SÃƒÆ’Ã‚Â hay prompts tradicionales
          else if (!skipImages && data.imagePrompts && data.imagePrompts.length > 0 && !data.bingImagesMode) {
            if (data.googleImagesMode) {
              console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ DEBUG FRONTEND - Ejecutando createGoogleImageLinks con ${data.imagePrompts.length} keywords`);
              createGoogleImageLinks(data.imagePrompts, data.currentSection);
            } else {
              console.log(`ðŸ“‹ DEBUG FRONTEND - Ejecutando addPromptsToSidebar con ${data.imagePrompts.length} prompts`);
              addPromptsToSidebar(data.imagePrompts, data.currentSection);
            }
          } else {
            if (skipImages) {
              console.log(`ÃƒÂ¢Ã‚ÂÃ‚Â­ÃƒÂ¯Ã‚Â¸Ã‚Â DEBUG FRONTEND - Omitiendo prompts de imagen porque skipImages está activado`);
            } else {
              console.log(`ÃƒÂ¢Ã‚ÂÃ…â€™ DEBUG FRONTEND - No se encontraron imágenes ni prompts válidos`);
            }
          }
        }, 500);
      }
      
      // Mostrar mensaje de finalización y botones
      setTimeout(() => {
        showCompletionMessage(data.currentSection, data.totalSections, data.isComplete);
        
        // Mostrar botón correspondiente
        if (!data.isComplete) {
          continueBtn.style.display = "inline-flex";
          continueBtn.querySelector('span').textContent = `Continuar con Sección ${data.currentSection + 1}`;
        }
      }, 1500);
      
    } else {
      showError(data.error || "No se pudo generar el contenido. Intenta con un tema diferente.");
    }
  } catch (error) {
    showError("Error de conexión. Verifica tu conexión a internet e intenta nuevamente.");
    console.error("Error:", error);
  } finally {
    // Restaurar botón
    generateBtn.disabled = false;
    generateBtn.style.display = 'inline-flex';
    generateBtn.innerHTML = `
      <i class="fas fa-video"></i>
      <span>Generar Sección 1</span>
    `;
  }
});

// Event listener para el botón de generar audio
/* COMENTADO: Función del botón continueBtn eliminado
  console.log('ðŸ“Š Variables de estado actual:', {
    currentTopic,
    currentSectionNumber,
    totalSections,
    'window.currentProject?.completedSections?.length': window.currentProject?.completedSections?.length
  });

  if (!currentTopic || currentSectionNumber >= totalSections) {
    showError("No se puede continuar. Genera primero una sección o ya has completado todas las secciones.");
    return;
  }

  const nextSection = currentSectionNumber + 1;
  console.log('ðŸŽ¯ Sección que se va a generar:', nextSection);
  
  const imageCount = parseInt(document.getElementById("imagesSelect").value);
  const aspectRatio = document.getElementById("aspectRatioSelect").value;
  // ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ FIX: Usar el folderName del proyecto cargado si existe, sino el del input
  const folderName = window.currentProject ? window.currentProject.folderName : document.getElementById("folderName").value.trim();
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Usando folderName:', folderName, 'desde proyecto cargado:', !!window.currentProject);
  const selectedStyle = document.getElementById("styleSelect").value;
  const promptModifier = document.getElementById("promptModifier").value.trim();
  const selectedImageModel = getSelectedImageModel();
  const selectedLlmModel = document.getElementById("llmModelSelect").value;
  const mainLocalModel = document.getElementById("mainLocalModel")?.value || '';
  let skipImages = document.getElementById("skipImages").checked;
  let googleImages = document.getElementById("googleImages").checked;
  
  // ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ VALIDACIÃ“N: No se puede omitir imágenes Y usar Google Images al mismo tiempo
  // PERO solo aplicar esta validación si NO estamos cargando un proyecto
  if (skipImages && googleImages && !isLoadingProject) {
    console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Configuración contradictoria detectada en CONTINUAR: skipImages=true y googleImages=true');
    console.warn('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Corrigiendo: Desactivando skipImages porque googleImages tiene prioridad');
    skipImages = false;
    document.getElementById("skipImages").checked = false;
    showNotification('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Corrección automática: No puedes omitir imágenes si usas Google Images', 'warning');
  } else if (skipImages && googleImages && isLoadingProject) {
    console.log('ðŸ“‚ Continuando proyecto: Permitiendo skipImages=true y googleImages=true (solo guión + keywords)');
  }
  
  // Deshabilitar botón y mostrar estado de carga
  continueBtn.disabled = true;
  continueBtn.innerHTML = `
    <i class="fas fa-spinner loading"></i>
    <span>Generando Sección ${nextSection}...</span>
  `;
  
  generateAudioBtn.style.display = "none";
  
  showLoadingStages(nextSection, imageCount, skipImages, googleImages, localAIImages);

  try {
    console.log(`Enviando llamada API para sección ${nextSection}`);
    const skipImages = document.getElementById("skipImages").checked;
    const googleImages = document.getElementById("googleImages").checked;
    const localAIImages = document.getElementById("localAIImages").checked;
    const currentApplioVoice = document.getElementById("applioVoiceSelect").value;
    console.log(`Omitir imágenes: ${skipImages}`);
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
        llmModel: selectedLlmModel === 'local' ? `ollama:${mainLocalModel}` : selectedLlmModel,
        skipImages: skipImages,
        googleImages: googleImages,
        localAIImages: localAIImages,
        applioVoice: currentApplioVoice
      })
    });

    const data = await response.json();

    if (data.script) {
      // Actualizar etapas completadas (con pequeño delay para asegurar que los elementos existen)
      setTimeout(() => {
        updateStage('stage-script', 'completed');
      }, 100);
      
      // Usar los datos del servidor en lugar de leer los checkboxes
      const serverSkipImages = data.imagesSkipped || false;
      const serverGoogleImages = data.googleImagesMode || false;
      
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG continueGeneration - skipImages: ${skipImages}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG continueGeneration - googleImages: ${googleImages}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG continueGeneration - serverSkipImages: ${serverSkipImages}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG continueGeneration - serverGoogleImages: ${serverGoogleImages}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG continueGeneration - data.imagesSkipped: ${data.imagesSkipped}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG continueGeneration - data.googleImagesMode: ${data.googleImagesMode}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG continueGeneration - data.images: ${data.images ? data.images.length : 'null'}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG continueGeneration - data.imagePrompts: ${data.imagePrompts ? data.imagePrompts.length : 'null'}`);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG continueGeneration - data.downloadedImages: ${data.downloadedImages ? data.downloadedImages.length : 'null'}`);
      
      if (!serverSkipImages && !serverGoogleImages && ((data.images && data.images.length > 0) || (data.downloadedImages && data.downloadedImages.length > 0))) {
        // Con imágenes (IA generadas o descargadas de Bing)
        console.log(`ðŸ“· continueGeneration - Mostrando carrusel de imágenes ${data.downloadedImages ? 'Bing' : 'IA'}`);
        setTimeout(() => {
          updateStage('stage-prompt', 'completed');
          updateStage('stage-image', 'completed');
        }, 200);
        
        // Actualizar número de sección actual
        currentSectionNumber = data.currentSection;
        
        // Mostrar guión de la nueva sección
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile);
        }, 500);
        
        // Mostrar carrusel de imágenes
        setTimeout(() => {
          if (data.downloadedImages && data.downloadedImages.length > 0) {
            // Imágenes de Bing descargadas
            console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â continueGeneration - Creando carrusel con ${data.downloadedImages.length} imágenes de Bing`);
            
            // Almacenar las keywords para el botón de refresh
            if (data.imageKeywords && data.imageKeywords.length > 0) {
              currentImageKeywords = data.imageKeywords;
              console.log(`ðŸŽ¯ Keywords almacenadas para refresh (continueGeneration):`, currentImageKeywords);
            } else {
              console.warn(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se recibieron keywords para refresh (continueGeneration)`);
              currentImageKeywords = [];
            }
            
            createCarousel(data.downloadedImages, data.currentSection, []);
            
            // Guardar datos de imágenes en la sección para navegación (continueGeneration)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.downloadedImages;
              allSections[data.currentSection - 1].imageKeywords = data.imageKeywords || [];
              allSections[data.currentSection - 1].imageMode = 'bing';
              console.log(`ðŸ’¾ Datos de imágenes Bing guardados para sección ${data.currentSection} (continueGeneration)`);
            }
          } else if (data.images && data.images.length > 0) {
            // Imágenes generadas con IA
            console.log(`ðŸ“· continueGeneration - Creando carrusel con ${data.images.length} imágenes IA`);
            createCarousel(data.images, data.currentSection, data.imagePrompts);
            
            // Guardar datos de imágenes en la sección para navegación (continueGeneration)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.images;
              allSections[data.currentSection - 1].imagePrompts = data.imagePrompts || [];
              allSections[data.currentSection - 1].imageMode = 'ai';
              console.log(`ðŸ’¾ Datos de imágenes AI guardados para sección ${data.currentSection} (continueGeneration)`);
            }
          }
        }, 1000);
      } else if (!skipImages && serverGoogleImages && data.imagePrompts && data.imagePrompts.length > 0) {
        // Modo Google Images (solo si no se omiten imágenes)
        console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ continueGeneration - EJECUTANDO createGoogleImageLinks ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€`);
        setTimeout(() => {
          updateStage('stage-prompt', 'completed');
        }, 200);
        
        // Actualizar número de sección actual
        currentSectionNumber = data.currentSection;
        
        // Mostrar guión
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile);
          // Ocultar el carrusel de imágenes
          document.getElementById("carousel-container").style.display = "none";
          
          // Crear enlaces de Google Images
          createGoogleImageLinks(data.imagePrompts, data.currentSection);
        }, 500);
      } else {
        // Sin imágenes (omitidas)
        console.log(`ðŸ“‹ continueGeneration - Mostrando prompts en panel lateral (modo skipImages)`);
        // Actualizar número de sección actual
        currentSectionNumber = data.currentSection;
        
        // Mostrar solo el guión
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile);
          // Ocultar el carrusel de imágenes
          document.getElementById("carousel-container").style.display = "none";
          
          // Mostrar prompts de imágenes en el panel lateral solo si no se omiten imágenes
          if (!skipImages && data.imagePrompts && data.imagePrompts.length > 0) {
            addPromptsToSidebar(data.imagePrompts, data.currentSection);
          } else if (skipImages) {
            console.log(`ÃƒÂ¢Ã‚ÂÃ‚Â­ÃƒÂ¯Ã‚Â¸Ã‚Â DEBUG FRONTEND (continuar) - Omitiendo prompts de imagen porque skipImages está activado`);
          }
        }, 500);
      }
      
      // Mostrar mensaje de finalización
      setTimeout(() => {
        showCompletionMessage(data.currentSection, data.totalSections, data.isComplete);
        
        // Mostrar u ocultar botón de continuar
        if (data.isComplete) {
          continueBtn.style.display = "none";
        } else {
          continueBtn.style.display = "inline-flex";
          continueBtn.querySelector('span').textContent = `Continuar con Sección ${data.currentSection + 1}`;
        }
      }, 1500);
      
    } else {
      showError(data.error || "No se pudo generar la siguiente sección. Intenta nuevamente.");
    }
  } catch (error) {
    showError("Error generando la siguiente sección. Verifica tu conexión e intenta nuevamente.");
    console.error("Error:", error);
// Event listener para el botón de generar audio
*/ 
// Event listener para el botón de generar audio
generateAudioBtn.addEventListener("click", async () => {
  if (!currentScript) {
    showError("Primero genera un guión antes de crear el audio.");
    return;
  }

  const folderName = document.getElementById("folderName").value.trim();
  const narrationStyle = document.getElementById("narrationStyle").value.trim();

  // Deshabilitar botón y mostrar estado de carga
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
    showError("Error generando audio. Verifica tu conexión e intenta nuevamente.");
    console.error("Error:", error);
  } finally {
    // Restaurar botón
    generateAudioBtn.disabled = false;
    generateAudioBtn.innerHTML = `
      <i class="fas fa-microphone"></i>
      <span>Generar Audio</span>
    `;
  }
});

// Event listener para el botón de generar video simple (sin animaciones)
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
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Normalizando folderName: "${inputFolderName}" â†’ "${folderName}"`);
  }
  
  if (!allSections || allSections.length === 0) {
    showError("No hay secciones generadas para crear el video");
    return;
  }
  
  console.log(`ðŸŽ¬ Iniciando generación de video simple para proyecto: ${folderName}`);
  
  try {
    await generateSimpleProjectVideo(folderName);
  } catch (error) {
    console.error("ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando video simple:", error);
    showError(`Error generando video simple: ${error.message}`);
  }
});

// Event listener para el botón de generar/metadatos de YouTube
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

      showNotification('ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¹ÃƒÂ¯Ã‚Â¸Ã‚Â Ya existen metadatos de YouTube para este proyecto.', 'info');
      return;
    }

    if ((!Array.isArray(allSections) || allSections.length === 0) && !(window.currentProject?.completedSections?.length)) {
      showNotification('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Genera al menos una sección antes de crear metadatos.', 'warning');
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
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando metadatos desde el botón principal:', error);
      showNotification(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando metadatos: ${error.message || error}`, 'error');
    } finally {
      generateYouTubeMetadataBtn.disabled = false;
      generateYouTubeMetadataBtn.innerHTML = originalHtml;
      updateYouTubeMetadataButtonState();
    }
  });
}

// Event listener para el botón de generar clips separados por sección
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
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Normalizando folderName: "${inputFolderName}" â†’ "${folderName}"`);
  }
  
  if (!allSections || allSections.length === 0) {
    showError("No hay secciones generadas para crear los clips");
    return;
  }
  
  console.log(`ðŸŽ¬ Iniciando generación de clips separados para proyecto: ${folderName}`);
  
  try {
    await generateSeparateVideos(folderName, {
      buttonElement: event.currentTarget
    });
  } catch (error) {
    console.error("ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando clips separados:", error);
    showError(`Error generando clips separados: ${error.message}`);
  }
});

// Event listener para el botón de regenerar audios faltantes
document.getElementById("regenerateApplioAudiosBtn").addEventListener("click", async () => {
  console.log('ðŸŽ¤ Click en botón de regenerar audios faltantes');
  
  try {
    await regenerateAllAudios();
  } catch (error) {
    console.error("ÃƒÂ¢Ã‚ÂÃ…â€™ Error regenerando audios:", error);
    showError(`Error regenerando audios: ${error.message}`);
  }
});

// Event listener para el botón de regenerar guiones faltantes
document.getElementById("regenerateMissingScriptsBtn").addEventListener("click", async () => {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Click en botón de regenerar guiones faltantes');
  
  try {
    await regenerateMissingScripts();
  } catch (error) {
    console.error("ÃƒÂ¢Ã‚ÂÃ…â€™ Error regenerando guiones:", error);
    showError(`Error regenerando guiones: ${error.message}`);
  }
});

// Event listener para el botón de generar imágenes faltantes
document.getElementById("generateMissingImagesBtn").addEventListener("click", async () => {
  const btn = document.getElementById("generateMissingImagesBtn");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando Imágenes...</span>';
  
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Click en botón de generar imágenes faltantes');
  
  try {
    await generateMissingImages();
  } catch (error) {
    console.error("ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando imágenes:", error);
    showError(`Error generando imágenes: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});

document.getElementById("cancelMissingImagesBtn").addEventListener("click", async () => {
  console.log('ðŸ›‘ Click en botón de cancelar generación de imágenes');
  try {
    await cancelMissingImagesGeneration();
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cancelando la generación de imágenes:', error);
    showError(`Error cancelando la generación de imágenes: ${error.message}`);
  }
});

const attemptComfyCheckboxElement = document.getElementById('attemptComfyCheckbox');
if (attemptComfyCheckboxElement) {
  attemptComfyCheckboxElement.addEventListener('change', () => {
    updateGenerateImagesButtonState();
  });
}

// Event listener para el botón de generar solo prompts de imágenes
document.getElementById("generateMissingPromptsBtn").addEventListener("click", async () => {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Click en botón de generar solo prompts de imágenes');
  
  try {
    await generateMissingPrompts();
  } catch (error) {
    console.error("ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando prompts:", error);
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

// âš¡ Configurar eventos para los checkboxes de imágenes (manejo automático)
function setupImageCheckboxEvents() {
  const googleImagesCheckbox = document.getElementById("googleImages");
  const localAIImagesCheckbox = document.getElementById("localAIImages");
  
  // Event listeners simplificados - ahora se pueden activar ambas opciones
  if (googleImagesCheckbox) {
    googleImagesCheckbox.addEventListener("change", function() {
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Google Images:', this.checked);
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

// Función para mostrar prompts de imágenes cuando se omiten las imágenes
function showImagePrompts(prompts, sectionNumber, promptsFileInfo) {
  console.log(`ðŸŽ¨ DEBUG showImagePrompts - Iniciando función...`);
  console.log(`ðŸŽ¨ DEBUG showImagePrompts - prompts recibidos:`, prompts);
  console.log(`ðŸŽ¨ DEBUG showImagePrompts - prompts.length:`, prompts ? prompts.length : 'undefined');
  console.log(`ðŸŽ¨ DEBUG showImagePrompts - sectionNumber:`, sectionNumber);
  console.log(`ðŸŽ¨ DEBUG showImagePrompts - promptsFileInfo:`, promptsFileInfo);
  
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    console.log(`ÃƒÂ¢Ã‚ÂÃ…â€™ DEBUG showImagePrompts - Prompts inválidos o vacíos`);
    return;
  }
  
  console.log(`ðŸŽ¨ Mostrando ${prompts.length} prompts de imágenes para la sección ${sectionNumber}`);
  
  // Buscar si ya existe un contenedor de prompts y eliminarlo
  const existingContainer = document.getElementById('image-prompts-display');
  if (existingContainer) {
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ DEBUG showImagePrompts - Eliminando contenedor existente`);
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
    <span>Prompts Visuales - Sección ${sectionNumber}</span>
  `;
  
  // Agregar información sobre el archivo guardado si está disponible
  if (promptsFileInfo && promptsFileInfo.saved) {
    const fileInfo = document.createElement('div');
    fileInfo.className = 'prompts-file-info';
    fileInfo.innerHTML = `
      <div class="file-saved-notification">
        <i class="fas fa-save"></i>
        <span>Prompts guardados automáticamente como: <strong>${promptsFileInfo.filename}</strong></span>
      </div>
    `;
    header.appendChild(fileInfo);
  }
  
  // Crear la lista de prompts
  const list = document.createElement('div');
  list.className = 'image-prompts-list';
  
  prompts.forEach((prompt, index) => {
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG showImagePrompts - Procesando prompt ${index + 1}: ${prompt.substring(0, 50)}...`);
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
  let noteText = "Estos prompts describen las imágenes que se habrían generado para acompañar visualmente el guión.";
  
  if (additionalInstructions) {
    noteText += ` Las instrucciones adicionales ("${additionalInstructions}") han sido aplicadas a estos prompts.`;
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â DEBUG showImagePrompts - Instrucciones adicionales aplicadas: "${additionalInstructions}"`);
  }
  
  note.innerHTML = `
    <i class="fas fa-info-circle"></i>
    ${noteText}
  `;
  
  // Ensamblar el contenedor
  container.appendChild(header);
  container.appendChild(list);
  container.appendChild(note);
  
  // Insertar después del output del script
  const output = document.getElementById('output');
  console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG showImagePrompts - Element output encontrado:`, !!output);
  
  if (output && output.nextSibling) {
    output.parentNode.insertBefore(container, output.nextSibling);
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â DEBUG showImagePrompts - Insertado después del output (con nextSibling)`);
  } else if (output) {
    output.parentNode.appendChild(container);
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â DEBUG showImagePrompts - Insertado después del output (appendChild)`);
  } else {
    document.body.appendChild(container);
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â DEBUG showImagePrompts - Insertado en body (fallback)`);
  }
  
  // Animación de aparición
  container.style.opacity = '0';
  container.style.transform = 'translateY(20px)';
  
  setTimeout(() => {
    container.style.transition = 'all 0.5s ease';
    container.style.opacity = '1';
    container.style.transform = 'translateY(0)';
    console.log(`âœ¨ DEBUG showImagePrompts - Animación aplicada`);
  }, 100);
  
  console.log(`âœ… DEBUG showImagePrompts - Función completada exitosamente`);
}

// Event listener para controlar la casilla de audio según la generación automática
document.addEventListener('DOMContentLoaded', function() {
  console.log('ðŸš€ DOM completamente cargado');
  
  // Limpiar cualquier contenedor de prompts visuales residual
  const existingPromptsContainer = document.getElementById('image-prompts-display');
  if (existingPromptsContainer) {
    existingPromptsContainer.remove();
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€Ã¢â‚¬ËœÃƒÂ¯Ã‚Â¸Ã‚Â Contenedor de prompts visuales residual eliminado');
  }
  
  // Verificar localStorage inmediatamente
  const savedStyles = localStorage.getItem('customScriptStyles');
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â VERIFICACIÃ“N DIRECTA localStorage:', savedStyles);
  
  const autoGenerateAudioCheckbox = document.getElementById('autoGenerateAudio');
  const autoAudioContainer = document.querySelector('.auto-audio-container');
  
  // Verificar si los elementos de audio existen y habilitarlos ya que la generación automática está siempre activa
  if (autoGenerateAudioCheckbox && autoAudioContainer) {
    // Habilitar la casilla de audio ya que la generación automática está siempre activa
    autoGenerateAudioCheckbox.disabled = false;
    autoAudioContainer.style.opacity = '1';
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ…Â  Casilla de audio habilitada (generación automática siempre activa)');
  } else {
    console.log('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Algunos elementos de audio no encontrados (diseño compacto)');
  }
  
  // Inicializar sistema de estilos personalizados
  console.log('ðŸŽ¨ A punto de inicializar estilos...');
  initCustomStyles();
  
  // Inicializar sistema de estilos de miniatura
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â A punto de inicializar estilos de miniatura...');
  initThumbnailStyles();
  
  // Configurar eventos de botones manualmente como backup
  setTimeout(() => {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Configurando eventos de botones manualmente...');
    
    const createBtn = document.getElementById('createStyleBtn');
    const manageBtn = document.getElementById('manageStylesBtn');
    
    if (createBtn) {
      createBtn.addEventListener('click', function() {
        console.log('ðŸŽ¨ Botón crear estilo clickeado');
        openStyleModal();
      });
      console.log('âœ… Event listener del botón crear configurado');
    } else {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Botón crear estilo no encontrado');
    }
    
    if (manageBtn) {
      manageBtn.addEventListener('click', function() {
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Botón gestionar estilos clickeado');
        openManageStylesModal();
      });
      console.log('âœ… Event listener del botón gestionar configurado');
    } else {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Botón gestionar estilos no encontrado');
    }
    
    // Configurar eventos de botones de miniatura
    const createThumbnailBtn = document.getElementById('createThumbnailStyleFromSidebar');
    const manageThumbnailBtn = document.getElementById('manageThumbnailStylesFromSidebar');
    
    if (createThumbnailBtn) {
      createThumbnailBtn.addEventListener('click', function() {
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Botón crear estilo de miniatura clickeado');
        openThumbnailStyleModal();
      });
      console.log('âœ… Event listener del botón crear miniatura configurado');
    } else {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Botón crear estilo de miniatura no encontrado');
    }
    
    if (manageThumbnailBtn) {
      manageThumbnailBtn.addEventListener('click', function() {
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Botón gestionar estilos de miniatura clickeado desde backup manual');
        try {
          openManageThumbnailStylesModal();
        } catch (error) {
          console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error ejecutando openManageThumbnailStylesModal:', error);
        }
      });
      console.log('âœ… Event listener del botón gestionar miniatura configurado (backup manual)');
      
      // También agregar onclick como backup adicional
      manageThumbnailBtn.onclick = function() {
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Onclick backup del botón gestionar activado');
        try {
          openManageThumbnailStylesModal();
        } catch (error) {
          console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error en onclick backup:', error);
        }
      };
    } else {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Botón gestionar estilos de miniatura no encontrado');
    }
    
    // Configurar eventos de botones de modal como backup
    setTimeout(() => {
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Configurando eventos de modal como backup...');
      const saveBtn = document.getElementById('saveThumbnailStyleBtn');
      if (saveBtn && !saveBtn.onclick) {
        saveBtn.onclick = function() {
          console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Backup directo del botón guardar activado');
          saveThumbnailStyle();
        };
        console.log('âœ… Backup de botón guardar configurado');
      }
    }, 1000);
  }, 500);
  
  // Verificar el selector después de la inicialización
  setTimeout(() => {
    const styleSelect = document.getElementById('styleSelect');
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Opciones en el selector después de inicializar:', styleSelect?.innerHTML);
    console.log('ðŸ” Número de opciones:', styleSelect?.options?.length);
  }, 1000);
});

// Sistema de Estilos Personalizados
let customStyles = [];

// Cargar estilos personalizados del servidor
async function loadCustomStyles() {
  console.log('Ã°Å¸â€Â Iniciando carga de estilos personalizados desde servidor...');
  try {
    const response = await fetch('/api/custom-styles');
    if (!response.ok) throw new Error('Error al obtener estilos');
    
    const data = await response.json();
    if (data.scriptStyles) {
        customStyles = data.scriptStyles;
        console.log(`Ã°Å¸â€œÂ Cargados ${customStyles.length} estilos personalizados:`, customStyles);
    } else {
        customStyles = [];
    }
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error cargando estilos:', error);
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
       console.error('Ã¢ÂÅ’ Error guardando estilos:', error);
       alert('Error al guardar estilos en el servidor');
  }
}

// Inicializar sistema de estilos
function initCustomStyles() {
  console.log('ðŸŽ¨ Inicializando sistema de estilos personalizados...');
  loadCustomStyles();
  // updateStyleSelector(); // Se llama dentro de loadCustomStyles

  
  // Configurar eventos con un retraso para asegurar que el DOM esté listo
  setTimeout(() => {
    setupStyleModalEvents();
    setupManageStylesEvents();
    setupEditStyleEvents();
    
    // Configurar específicamente los botones del sidebar
    setupSidebarStyleButtons();
    
    console.log('âœ… Sistema de estilos inicializado correctamente');
  }, 100);
}

// Configurar botones del sidebar para estilos
function setupSidebarStyleButtons() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Configurando botones del sidebar para estilos...');
  
  const createFromSidebarBtn = document.getElementById('createStyleFromSidebar');
  if (createFromSidebarBtn) {
    // Remover event listeners previos
    const newBtn = createFromSidebarBtn.cloneNode(true);
    createFromSidebarBtn.parentNode.replaceChild(newBtn, createFromSidebarBtn);
    
    newBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('ðŸŽ¨ Botón crear estilo clickeado desde sidebar');
      openCreateStyleFromSidebar();
    });
    console.log('âœ… Event listener del botón crear desde barra lateral configurado');
  } else {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró createStyleFromSidebar');
  }
  
  const manageFromSidebarBtn = document.getElementById('manageStylesFromSidebar');
  if (manageFromSidebarBtn) {
    // Remover event listeners previos
    const newBtn = manageFromSidebarBtn.cloneNode(true);
    manageFromSidebarBtn.parentNode.replaceChild(newBtn, manageFromSidebarBtn);
    
    newBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Botón gestionar estilos clickeado desde sidebar');
      openManageStylesFromSidebar();
    });
    console.log('âœ… Event listener del botón gestionar desde barra lateral configurado');
  } else {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró manageStylesFromSidebar');
  }
}

// Función para abrir modal de crear estilo
function openStyleModal() {
  console.log('ðŸŽ¨ Abriendo modal de crear estilo...');
  const styleModal = document.getElementById('styleModal');
  if (styleModal) {
    styleModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    console.log('âœ… Modal de crear estilo abierto');
  } else {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Modal de crear estilo no encontrado');
  }
}

// Función para cerrar modal de crear estilo
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
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Configurando eventos del modal de crear estilo...');
  
  const styleModal = document.getElementById('styleModal');
  const closeModalBtn = document.getElementById('closeStyleModal');
  const cancelBtn = document.getElementById('cancelStyleBtn');
  const saveBtn = document.getElementById('saveStyleBtn');
  
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Elementos encontrados:', {
    styleModal: !!styleModal,
    closeModalBtn: !!closeModalBtn,
    cancelBtn: !!cancelBtn,
    saveBtn: !!saveBtn
  });
  
  if (!styleModal || !closeModalBtn || !cancelBtn || !saveBtn) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Algunos elementos del modal no fueron encontrados');
    return;
  }
  
  // Función para cerrar modal
  function closeModal() {
    console.log('ðŸŽ¨ Cerrando modal de crear estilo...');
    styleModal.style.display = 'none';
    document.body.style.overflow = 'auto';
    clearModalForm();
  }
  
  // Configurar event listeners
  closeModalBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‹Å“ Botón cerrar clickeado');
    closeModal();
  });
  
  cancelBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‹Å“ Botón cancelar clickeado');
    closeModal();
  });
  
  // Guardar nuevo estilo
  saveBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‹Å“ Botón guardar clickeado');
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
    alert('ÃƒÂ¢Ã‚ÂÃ…â€™ El nombre del estilo es requerido');
    return;
  }
  
  if (!instructions) {
    alert('ÃƒÂ¢Ã‚ÂÃ…â€™ Las instrucciones para la IA son requeridas');
    return;
  }
  
  // Verificar que no exista un estilo con el mismo nombre
  if (customStyles.find(style => style.name.toLowerCase() === name.toLowerCase())) {
    alert('ÃƒÂ¢Ã‚ÂÃ…â€™ Ya existe un estilo con ese nombre');
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
  
  // Mostrar confirmación
  alert(`âœ… Estilo "${name}" creado exitosamente!`);
  
  console.log(`ðŸŽ¨ Nuevo estilo creado: ${name}`);
}

// Actualizar el selector de estilos
function updateStyleSelector() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Iniciando actualización del selector...');
  
  const styleSelect = document.getElementById('styleSelect');
  if (!styleSelect) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró el elemento styleSelect');
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
  comedyOption.textContent = 'Cómico';
  styleSelect.appendChild(comedyOption);
  
  console.log('âœ… Opciones predeterminadas agregadas');
  
  // Verificar customStyles
  console.log('ðŸŽ¨ customStyles disponibles:', customStyles);
  console.log('ðŸ“Š Número de estilos personalizados:', customStyles.length);
  
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
  
  // Restaurar selección anterior si existe
  if (currentValue && styleSelect.querySelector(`option[value="${currentValue}"]`)) {
    styleSelect.value = currentValue;
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Selección restaurada: ${currentValue}`);
  } else {
    styleSelect.value = 'professional'; // Default
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Selección por defecto: professional');
  }
  
  console.log(`ðŸŽ¯ Selector actualizado - Total opciones: ${styleSelect.options.length}`);
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â HTML del selector:', styleSelect.innerHTML);
}

// Variables para gestión de estilos
let currentEditingStyle = null;

// Configurar eventos del modal de gestión de estilos
function setupManageStylesEvents() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Configurando eventos del modal de gestionar estilos...');
  
  const manageModal = document.getElementById('manageStylesModal');
  const closeManageBtn = document.getElementById('closeManageStylesModal');
  const closeManageBtnFooter = document.getElementById('closeManageStylesBtn');
  
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Elementos encontrados:', {
    manageModal: !!manageModal,
    closeManageBtn: !!closeManageBtn,
    closeManageBtnFooter: !!closeManageBtnFooter
  });
  
  if (!manageModal || !closeManageBtn || !closeManageBtnFooter) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Algunos elementos del modal de gestionar no fueron encontrados');
    return;
  }
  
  // Función para cerrar modal
  function closeModal() {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Cerrando modal de gestionar estilos...');
    manageModal.style.display = 'none';
    document.body.style.overflow = 'auto';
  }
  
  // Configurar event listeners
  closeManageBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‹Å“ Botón cerrar (X) clickeado');
    closeModal();
  });
  
  closeManageBtnFooter.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‹Å“ Botón cerrar footer clickeado');
    closeModal();
  });
  
  }

// Configurar eventos del modal de edición de estilos
function setupEditStyleEvents() {
  const editModal = document.getElementById('editStyleModal');
  const closeEditBtn = document.getElementById('closeEditStyleModal');
  const cancelEditBtn = document.getElementById('cancelEditStyleBtn');
  const saveEditBtn = document.getElementById('saveEditStyleBtn');
  
  closeEditBtn.addEventListener('click', closeEditStyleModal);
  cancelEditBtn.addEventListener('click', closeEditStyleModal);
  saveEditBtn.addEventListener('click', saveEditedStyle);
  
}

// Abrir modal de gestión de estilos
function openManageStylesModal() {
  const manageModal = document.getElementById('manageStylesModal');
  manageModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  renderStylesList();
}

// Cerrar modal de gestión de estilos
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
          <div class="style-item-description">${escapeHtml(style.description || 'Sin descripción')}</div>
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

// Función para escapar HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Editar estilo
function editStyle(styleId) {
  const style = customStyles.find(s => s.id === styleId);
  if (!style) {
    alert('ÃƒÂ¢Ã‚ÂÃ…â€™ Estilo no encontrado');
    return;
  }
  
  currentEditingStyle = style;
  
  // Llenar formulario de edición
  document.getElementById('editStyleName').value = style.name;
  document.getElementById('editStyleDescription').value = style.description || '';
  document.getElementById('editStyleInstructions').value = style.instructions;
  
  // Cerrar modal de gestión y abrir modal de edición
  closeManageStylesModal();
  
  const editModal = document.getElementById('editStyleModal');
  editModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

// Cerrar modal de edición
function closeEditStyleModal() {
  const editModal = document.getElementById('editStyleModal');
  editModal.style.display = 'none';
  document.body.style.overflow = 'auto';
  currentEditingStyle = null;
  clearEditModalForm();
}

// Limpiar formulario de edición
function clearEditModalForm() {
  document.getElementById('editStyleName').value = '';
  document.getElementById('editStyleDescription').value = '';
  document.getElementById('editStyleInstructions').value = '';
}

// Guardar estilo editado
function saveEditedStyle() {
  if (!currentEditingStyle) {
    alert('ÃƒÂ¢Ã‚ÂÃ…â€™ Error: No hay estilo seleccionado para editar');
    return;
  }
  
  const name = document.getElementById('editStyleName').value.trim();
  const description = document.getElementById('editStyleDescription').value.trim();
  const instructions = document.getElementById('editStyleInstructions').value.trim();
  
  // Validaciones
  if (!name) {
    alert('ÃƒÂ¢Ã‚ÂÃ…â€™ El nombre del estilo es requerido');
    return;
  }
  
  if (!instructions) {
    alert('ÃƒÂ¢Ã‚ÂÃ…â€™ Las instrucciones para la IA son requeridas');
    return;
  }
  
  // Verificar que no exista otro estilo con el mismo nombre
  const existingStyle = customStyles.find(style => 
    style.name.toLowerCase() === name.toLowerCase() && style.id !== currentEditingStyle.id
  );
  
  if (existingStyle) {
    alert('ÃƒÂ¢Ã‚ÂÃ…â€™ Ya existe un estilo con ese nombre');
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
    
    // Mostrar confirmación
    alert(`âœ… Estilo "${name}" actualizado exitosamente!`);
    
    console.log(`ðŸŽ¨ Estilo editado: ${name}`);
  }
}

// Eliminar estilo
function deleteStyle(styleId) {
  const style = customStyles.find(s => s.id === styleId);
  if (!style) {
    alert('ÃƒÂ¢Ã‚ÂÃ…â€™ Estilo no encontrado');
    return;
  }
  
  // Confirmar eliminación
  if (!confirm(`¿Estás seguro de que quieres eliminar el estilo "${style.name}"?\n\nEsta acción no se puede deshacer.`)) {
    return;
  }
  
  // Eliminar del array
  customStyles = customStyles.filter(s => s.id !== styleId);
  
  // Guardar en localStorage
  saveCustomStyles();
  
  // Actualizar selector
  updateStyleSelector();
  
  // Actualizar lista de estilos si el modal está abierto
  const manageModal = document.getElementById('manageStylesModal');
  if (manageModal.style.display === 'flex') {
    renderStylesList();
  }
  
  // Mostrar confirmación
  alert(`âœ… Estilo "${style.name}" eliminado exitosamente!`);
  
  console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€Ã¢â‚¬ËœÃƒÂ¯Ã‚Â¸Ã‚Â Estilo eliminado: ${style.name}`);
}

// Función de prueba para crear un estilo desde la consola
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

// Función de debug para mostrar estado actual
function debugStyles() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Estado actual de estilos:');
  console.log('ðŸ“¦ customStyles array:', customStyles);
  console.log('ðŸ’¾ localStorage:', localStorage.getItem('customScriptStyles'));
  
  const styleSelect = document.getElementById('styleSelect');
  console.log('ðŸŽ¯ Selector HTML:', styleSelect.innerHTML);
  console.log('ðŸ“Š Número de opciones:', styleSelect.options.length);
  
  return {
    customStyles,
    localStorage: localStorage.getItem('customScriptStyles'),
    selectorHTML: styleSelect.innerHTML,
    optionsCount: styleSelect.options.length
  };
}

// Funciones para la barra lateral colapsable
function toggleSidebar() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ toggleSidebar() ejecutada');
  
  const sidebar = document.getElementById('sidebar');
  const body = document.body;
  
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â sidebar element:', sidebar);
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â body element:', body);
  
  if (sidebar && body) {
    const wasExpanded = sidebar.classList.contains('expanded');
    
    sidebar.classList.toggle('expanded');
    body.classList.toggle('sidebar-expanded');
    
    const isExpanded = sidebar.classList.contains('expanded');
    console.log(`ðŸŽ¯ Barra lateral cambió de ${wasExpanded ? 'expandida' : 'colapsada'} a ${isExpanded ? 'expandida' : 'colapsada'}`);
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Clases del sidebar:', sidebar.className);
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Clases del body:', body.className);
  } else {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró el sidebar o el body');
    console.error('sidebar:', sidebar);
    console.error('body:', body);
  }
}

// Hacer la función disponible globalmente
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
  openStyleModal(); // Esta función abre el modal de CREAR estilo
  collapseSidebar();
  console.log('ðŸŽ¨ Abriendo modal de crear estilo desde barra lateral');
}

function openManageStylesFromSidebar() {
  openManageStylesModal(); // Esta función abre el modal de GESTIONAR estilos
  collapseSidebar();
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Abriendo modal de gestionar estilos desde barra lateral');
}

// Event listeners para la barra lateral
document.addEventListener('DOMContentLoaded', function() {
  // Botón de menú para expandir/colapsar barra lateral
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.getElementById('sidebar');
  
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Debug sidebar - menuToggleBtn:', menuToggleBtn);
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Debug sidebar - sidebar:', sidebar);
  
  if (menuToggleBtn) {
    console.log('âœ… Botón de menú encontrado - onclick configurado en HTML');
  } else {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró el botón menuToggleBtn');
  }
  
  if (!sidebar) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró el elemento sidebar');
  }
  
  // Botones de la barra lateral
  const createFromSidebarBtn = document.getElementById('createStyleFromSidebar');
  if (createFromSidebarBtn) {
    createFromSidebarBtn.addEventListener('click', openCreateStyleFromSidebar);
    console.log('âœ… Event listener del botón crear desde barra lateral configurado');
  }
  
  const manageFromSidebarBtn = document.getElementById('manageStylesFromSidebar');
  if (manageFromSidebarBtn) {
    manageFromSidebarBtn.addEventListener('click', openManageStylesFromSidebar);
    console.log('âœ… Event listener del botón gestionar desde barra lateral configurado');
  }
  
  // Cerrar barra lateral al hacer clic fuera de ella
  document.addEventListener('click', function(event) {
    const sidebar = document.getElementById('sidebar');
    const isClickInsideSidebar = sidebar && sidebar.contains(event.target);
    
    if (!isClickInsideSidebar && sidebar && sidebar.classList.contains('expanded')) {
      collapseSidebar();
    }
  });
  
  // Configuración adicional de eventos del modal como backup
  setTimeout(() => {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Configuración adicional de eventos del modal...');
    
    const closeModalBtn = document.getElementById('closeStyleModal');
    const cancelBtn = document.getElementById('cancelStyleBtn');
    const saveBtn = document.getElementById('saveStyleBtn');
    const styleModal = document.getElementById('styleModal');
    
    if (closeModalBtn && !closeModalBtn.hasEventListener) {
      closeModalBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‹Å“ [BACKUP] Botón cerrar clickeado');
        const modal = document.getElementById('styleModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
          clearModalForm();
        }
      });
      closeModalBtn.hasEventListener = true;
      console.log('âœ… Event listener del botón cerrar configurado (backup)');
    }
    
    if (cancelBtn && !cancelBtn.hasEventListener) {
      cancelBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‹Å“ [BACKUP] Botón cancelar clickeado');
        const modal = document.getElementById('styleModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
          clearModalForm();
        }
      });
      cancelBtn.hasEventListener = true;
      console.log('âœ… Event listener del botón cancelar configurado (backup)');
    }
    
    if (saveBtn && !saveBtn.hasEventListener) {
      saveBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‹Å“ [BACKUP] Botón guardar clickeado');
        saveNewStyle();
      });
      saveBtn.hasEventListener = true;
      console.log('âœ… Event listener del botón guardar configurado (backup)');
    }
    
    // Configuración backup para modal de gestionar estilos
    const closeManageBtn = document.getElementById('closeManageStylesModal');
    const closeManageBtnFooter = document.getElementById('closeManageStylesBtn');
    const manageModal = document.getElementById('manageStylesModal');
    
    if (closeManageBtn && !closeManageBtn.hasEventListener) {
      closeManageBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‹Å“ [BACKUP] Botón cerrar (X) gestionar clickeado');
        const modal = document.getElementById('manageStylesModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
        }
      });
      closeManageBtn.hasEventListener = true;
      console.log('âœ… Event listener del botón cerrar (X) gestionar configurado (backup)');
    }
    
    if (closeManageBtnFooter && !closeManageBtnFooter.hasEventListener) {
      closeManageBtnFooter.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‹Å“ [BACKUP] Botón cerrar footer gestionar clickeado');
        const modal = document.getElementById('manageStylesModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
        }
      });
      closeManageBtnFooter.hasEventListener = true;
      console.log('âœ… Event listener del botón cerrar footer gestionar configurado (backup)');
    }
  }, 1000);
});

// ================================
// FUNCIONALIDADES DEL PANEL LATERAL DE PROMPTS
// ================================

// Variable global para almacenar todos los prompts
let allAccumulatedPrompts = [];

// Función para inicializar el panel lateral de prompts
function initializePromptsPanel() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Iniciando inicialización del panel de prompts...');
  
  const promptsSidebar = document.getElementById('promptsSidebar');
  const toggleBtn = document.getElementById('promptsSidebarToggle');
  const headerBtn = document.getElementById('showPromptsPanel');
  
  console.log('promptsSidebar:', !!promptsSidebar);
  console.log('toggleBtn:', !!toggleBtn);
  console.log('headerBtn:', !!headerBtn);
  
  if (!promptsSidebar || !toggleBtn) {
    console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ Panel de prompts no encontrado en el DOM');
    return;
  }
  
  // Verificar si ya está inicializado
  if (toggleBtn.hasEventListener) {
    console.log('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Panel ya inicializado, saltando...');
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
  
  // Event listener para el botón toggle del panel
  const toggleHandler = function() {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‹Å“ Botón toggle del panel clickeado');
    const isActive = promptsSidebar.classList.contains('active');
    console.log('Estado actual antes del toggle:', isActive ? 'activo' : 'inactivo');
    
    if (isActive) {
      // Cerrar panel
      promptsSidebar.classList.remove('active');
      document.body.classList.remove('prompts-panel-active');
      toggleBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
      toggleBtn.title = 'Mostrar panel de prompts';
      
      // Actualizar botón del header
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
      
      // Actualizar botón del header
      if (headerBtn) {
        headerBtn.classList.add('active');
        headerBtn.innerHTML = '<i class="fas fa-eye-slash"></i><span>Ocultar</span>';
      }
      console.log('âœ… Panel abierto');
    }
  };
  
  toggleBtn.addEventListener('click', toggleHandler);
  toggleBtn.hasEventListener = true;
  
  // Event listener para el botón del header
  if (headerBtn && !headerBtn.hasEventListener) {
    const headerHandler = function() {
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‹Å“ Botón header clickeado');
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

// Función para limpiar el panel lateral de prompts
function clearPromptsSidebar() {
  console.log('ðŸ§¹ Limpiando panel lateral de prompts...');
  
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  
  if (promptsList) {
    // Limpiar todos los prompts existentes
    promptsList.innerHTML = '';
  }
  
  if (emptyState) {
    // Mostrar estado vacío
    emptyState.style.display = 'block';
  }
  
  // Limpiar array global
  allAccumulatedPrompts = [];
  
  console.log('âœ… Panel lateral limpiado');
}

// Función para añadir prompts al panel lateral
function addPromptsToSidebar(prompts, sectionNumber) {
  console.log('ðŸ“‹ðŸ“‹ðŸ“‹ INICIO addPromptsToSidebar - ESTA FUNCIÃ“N SE ESTÃƒÆ’Ã‚Â EJECUTANDO ðŸ“‹ðŸ“‹ðŸ“‹');
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ No hay prompts válidos para añadir al panel lateral');
    return;
  }
  
  console.log(`ðŸ“‹ Añadiendo ${prompts.length} prompts de la sección ${sectionNumber} al panel lateral`);
  
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  const promptsSidebar = document.getElementById('promptsSidebar');
  
  if (!promptsList || !emptyState || !promptsSidebar) {
    console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ Elementos del panel lateral no encontrados');
    return;
  }
  
  // Ocultar el estado vacío si existe
  if (emptyState.style.display !== 'none') {
    emptyState.style.display = 'none';
  }
  
  // Mostrar automáticamente el panel si no está visible
  if (!promptsSidebar.classList.contains('active')) {
    promptsSidebar.classList.add('active');
    document.body.classList.add('prompts-panel-active');
    const toggleBtn = document.getElementById('promptsSidebarToggle');
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
      toggleBtn.title = 'Ocultar panel de prompts';
    }
  }
  
  // Añadir divider si no es la primera sección
  if (sectionNumber > 1) {
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.innerHTML = `
      <div class="section-divider-text">
        <i class="fas fa-layer-group"></i>
        Sección ${sectionNumber}
      </div>
    `;
    promptsList.appendChild(divider);
  }
  
  // Añadir cada prompt al panel
  prompts.forEach((prompt, index) => {
    // Detectar si el prompt contiene HTML (enlaces de Google Images)
    const isHtmlPrompt = prompt.includes('<a href=') && prompt.includes('target="_blank"');
    const cleanText = isHtmlPrompt ? prompt.replace(/<[^>]*>/g, '').replace(/^ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€\s*/, '').replace(/^Buscar:\s*"/, '').replace(/"$/, '') : prompt.trim();
    
    // Almacenar en el array global con texto limpio
    allAccumulatedPrompts.push({
      text: cleanText,
      section: sectionNumber,
      imageNumber: index + 1
    });
    
    const promptItem = createPromptItem(prompt, sectionNumber, index + 1, isHtmlPrompt);
    promptsList.appendChild(promptItem);
    
    // Añadir animación de entrada
    setTimeout(() => {
      promptItem.classList.add('new');
    }, index * 100);
  });
  
  // Hacer scroll al último prompt añadido
  setTimeout(() => {
    const lastPrompt = promptsList.lastElementChild;
    if (lastPrompt) {
      lastPrompt.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 300);
}

// Función para crear enlaces de Google Images
function createGoogleImageLinks(prompts, sectionNumber) {
  console.log('ðŸš€ðŸš€ðŸš€ INICIO createGoogleImageLinks - ESTA FUNCIÃ“N SE ESTÃƒÆ’Ã‚Â EJECUTANDO ðŸš€ðŸš€ðŸš€');
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ prompts:', prompts);
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ sectionNumber:', sectionNumber);
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ prompts.length:', prompts ? prompts.length : 'null');
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Array.isArray(prompts):', Array.isArray(prompts));
  
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ No hay prompts válidos para crear enlaces de Google Images');
    return;
  }
  
  console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Creando ${prompts.length} enlaces de Google Images de la sección ${sectionNumber}`);
  
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  const promptsSidebar = document.getElementById('promptsSidebar');
  
  if (!promptsList || !emptyState || !promptsSidebar) {
    console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ Elementos del panel lateral no encontrados');
    return;
  }
  
  // Ocultar el estado vacío si existe
  if (emptyState.style.display !== 'none') {
    emptyState.style.display = 'none';
  }
  
  // Mostrar automáticamente el panel si no está visible
  if (!promptsSidebar.classList.contains('active')) {
    promptsSidebar.classList.add('active');
    document.body.classList.add('prompts-panel-active');
    const toggleBtn = document.getElementById('promptsSidebarToggle');
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
      toggleBtn.title = 'Ocultar panel de prompts';
    }
  }
  
  // Añadir divider si no es la primera sección
  if (sectionNumber > 1) {
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.innerHTML = `
      <div class="section-divider-text">
        <i class="fas fa-layer-group"></i>
        Sección ${sectionNumber}
      </div>
    `;
    promptsList.appendChild(divider);
  }
  
  // Añadir cada enlace de Google al panel
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Iniciando bucle para crear enlaces...');
  prompts.forEach((prompt, index) => {
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Procesando prompt ${index + 1}: "${prompt}"`);
    
    // Crear el término de búsqueda limpiando el prompt
    const searchTerm = prompt.trim()
      .replace(/[^\w\s]/g, '') // Remover caracteres especiales
      .replace(/\s+/g, '+'); // Reemplazar espacios con +
    
    const googleUrl = `https://www.google.com/search?q=${searchTerm}&tbm=isch`;
    
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ searchTerm: "${searchTerm}"`);
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ googleUrl: "${googleUrl}"`);
    
    // Almacenar en el array global (como Google link en lugar de prompt)
    allAccumulatedPrompts.push({
      text: googleUrl,
      section: sectionNumber,
      imageNumber: index + 1,
      isGoogleLink: true,
      originalPrompt: prompt.trim()
    });
    
    const linkItem = createGoogleLinkItem(prompt.trim(), googleUrl, sectionNumber, index + 1);
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ linkItem creado:`, !!linkItem);
    promptsList.appendChild(linkItem);
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ linkItem añadido al promptsList`);
    
    // Añadir animación de entrada
    setTimeout(() => {
      linkItem.classList.add('new');
    }, index * 100);
  });
  
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Bucle completado');
  
  // Hacer scroll al último enlace añadido
  setTimeout(() => {
    const lastLink = promptsList.lastElementChild;
    if (lastLink) {
      lastLink.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 300);
  
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ FIN createGoogleImageLinks');
}

// Función para crear un item de prompt individual
function createPromptItem(promptText, sectionNumber, imageNumber, isHtml = false) {
  const promptItem = document.createElement('div');
  promptItem.className = 'prompt-item';
  
  const header = document.createElement('div');
  header.className = 'prompt-item-header';
  
  const title = document.createElement('div');
  title.className = 'prompt-item-title';
  title.innerHTML = `<i class="fas fa-image"></i> Sección ${sectionNumber} - Imagen ${imageNumber}`;
  
  const copyBtn = document.createElement('button');
  copyBtn.className = 'prompt-copy-btn';
  copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
  copyBtn.title = 'Copiar prompt';
  
  // Para HTML, extraer el texto limpio para copiar
  const textToCopy = isHtml ? promptText.replace(/<[^>]*>/g, '').replace(/^ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€\s*/, '').replace(/^Buscar:\s*"/, '').replace(/"$/, '') : promptText;
  
  // Event listener para copiar
  copyBtn.addEventListener('click', async function(e) {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(textToCopy);
      
      // Cambiar el estilo del botón temporalmente
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
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error al copiar prompt:', err);
      
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
  
  // Añadir botón de expandir si el texto es largo (usar longitud del texto limpio)
  const textLength = isHtml ? textToCopy.length : promptText.length;
  if (textLength > 150) {
    const expandBtn = document.createElement('button');
    expandBtn.className = 'prompt-expand-btn';
    expandBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Ver más';
    
    expandBtn.addEventListener('click', function() {
      const isExpanded = textElement.classList.contains('expanded');
      
      if (isExpanded) {
        textElement.classList.remove('expanded');
        expandBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Ver más';
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

// Función para crear un item de enlace de Google
function createGoogleLinkItem(originalPrompt, googleUrl, sectionNumber, imageNumber) {
  const linkItem = document.createElement('div');
  linkItem.className = 'prompt-item google-link-item';
  
  const header = document.createElement('div');
  header.className = 'prompt-item-header';
  
  const title = document.createElement('div');
  title.className = 'prompt-item-title';
  title.innerHTML = `<i class="fab fa-google"></i> Sección ${sectionNumber} - Imagen ${imageNumber}`;
  
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
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Abriendo búsqueda de Google Images:', googleUrl);
  });
  
  // Event listener para copiar el enlace
  copyBtn.addEventListener('click', async function(e) {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(googleUrl);
      
      // Cambiar el estilo del botón temporalmente
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
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error al copiar enlace:', err);
      
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

// Función para limpiar el panel de prompts
function clearPromptsPanel() {
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  
  if (promptsList) {
    promptsList.innerHTML = '';
  }
  
  if (emptyState) {
    emptyState.style.display = 'block';
  }
  
  // Limpiar también el contenedor de prompts visuales antiguo si existe
  const oldPromptsContainer = document.getElementById('image-prompts-display');
  if (oldPromptsContainer) {
    oldPromptsContainer.remove();
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€Ã¢â‚¬ËœÃƒÂ¯Ã‚Â¸Ã‚Â Contenedor de prompts visuales eliminado');
  }
  
  // Limpiar el array global
  allAccumulatedPrompts = [];
  
  console.log('ðŸ§¹ Panel de prompts limpiado');
}

// Función para obtener todos los prompts acumulados
function getAllAccumulatedPrompts() {
  return allAccumulatedPrompts;
}

// Función para exportar todos los prompts como texto
function exportAllPrompts() {
  if (allAccumulatedPrompts.length === 0) {
    console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ No hay prompts para exportar');
    return;
  }
  
  let exportText = 'PROMPTS DE IMÃƒÆ’Ã‚ÂGENES GENERADOS\n';
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

// Modificar la función showImagePrompts existente para incluir el panel lateral
const originalShowImagePrompts = showImagePrompts;
showImagePrompts = function(prompts, sectionNumber, promptsFileInfo) {
  // Llamar a la función original
  originalShowImagePrompts(prompts, sectionNumber, promptsFileInfo);
  
  // Añadir prompts al panel lateral
  addPromptsToSidebar(prompts, sectionNumber);
};

// Inicializar el panel cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  console.log('ðŸŒŸ DOM Content Loaded - Iniciando inicialización del panel de prompts');
  // Esperar un poco para asegurar que todos los elementos estén cargados
  setTimeout(() => {
    initializePromptsPanel();
  }, 100);
});

// Inicializar también cuando la ventana esté completamente cargada (backup)
window.addEventListener('load', function() {
  console.log('ðŸŒŸ Window Loaded - Backup de inicialización del panel de prompts');
  setTimeout(() => {
    // Solo inicializar si no se ha hecho antes
    const toggleBtn = document.getElementById('promptsSidebarToggle');
    if (toggleBtn && !toggleBtn.hasEventListener) {
      initializePromptsPanel();
    }
  }, 500);
});

// También añadir una inicialización manual como backup adicional
setTimeout(() => {
  console.log('ðŸŒŸ Timeout backup - Verificando inicialización del panel');
  const toggleBtn = document.getElementById('promptsSidebarToggle');
  if (toggleBtn && !toggleBtn.hasEventListener) {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Ejecutando inicialización de backup');
    initializePromptsPanel();
  }
}, 2000);

// Función de test para verificar el funcionamiento del panel
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

// Funcionalidad para navegación entre secciones
function initializeSectionNavigation() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Inicializando navegación de secciones...');
  
  const prevSectionBtn = document.getElementById('prevSectionBtn');
  const nextSectionBtn = document.getElementById('nextSectionBtn');
  
  console.log('Botón anterior encontrado:', !!prevSectionBtn);
  console.log('Botón siguiente encontrado:', !!nextSectionBtn);
  
  if (!prevSectionBtn || !nextSectionBtn) {
    console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ Botones de navegación de secciones no encontrados');
    return;
  }
  
  // Remover event listeners anteriores si existen
  prevSectionBtn.replaceWith(prevSectionBtn.cloneNode(true));
  nextSectionBtn.replaceWith(nextSectionBtn.cloneNode(true));
  
  // Obtener referencias nuevas después del clonado
  const newPrevBtn = document.getElementById('prevSectionBtn');
  const newNextBtn = document.getElementById('nextSectionBtn');
  
  // Función para ir a la sección anterior
  newPrevBtn.addEventListener('click', function() {
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ CLICK ANTERIOR - Actual: ${currentSectionNumber}, Total secciones: ${allSections.length}`);
    console.log('Secciones disponibles:', allSections.map((s, i) => s ? `${i+1}: âœ…` : `${i+1}: ÃƒÂ¢Ã‚ÂÃ…â€™`).join(', '));
    
    if (currentSectionNumber > 1) {
      console.log(`âœ… Navegando a sección ${currentSectionNumber - 1}`);
      showStoredSection(currentSectionNumber - 1);
    } else {
      console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ Ya estás en la primera sección');
    }
  });
  
  // Función para ir a la sección siguiente
  newNextBtn.addEventListener('click', function() {
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ CLICK SIGUIENTE - Actual: ${currentSectionNumber}, Total secciones: ${allSections.length}`);
    console.log('Secciones disponibles:', allSections.map((s, i) => s ? `${i+1}: âœ…` : `${i+1}: ÃƒÂ¢Ã‚ÂÃ…â€™`).join(', '));
    
    if (currentSectionNumber < allSections.length) {
      console.log(`âœ… Navegando a sección ${currentSectionNumber + 1}`);
      showStoredSection(currentSectionNumber + 1);
    } else {
      console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ Ya estás en la última sección');
    }
  });
  
  console.log('âœ… Event listeners agregados correctamente');
  console.log('âœ… Navegación de secciones inicializada');
}

// Función para mostrar una sección almacenada
function showStoredSection(sectionNum) {
  console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Intentando mostrar sección ${sectionNum}`);
  console.log(`Total secciones almacenadas: ${allSections.length}`);
  console.log(`Contenido de sección ${sectionNum}:`, allSections[sectionNum - 1] ? 'Disponible' : 'No disponible');
  
  if (!allSections[sectionNum - 1]) {
    console.log(`ÃƒÂ¢Ã‚ÂÃ…â€™ Sección ${sectionNum} no disponible`);
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
    console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ Elementos DOM no encontrados');
    return;
  }
  
  // Actualizar número de sección actual
  currentSectionNumber = sectionNum;
  currentScript = script;
  
  // Actualizar títulos y contadores
  sectionTitle.textContent = `Sección ${sectionNum}`;
  currentSectionSpan.textContent = sectionNum;
  
  // Actualizar título del capítulo específico de esta sección
  if (chapterTitle) {
    const chapterTitleContainer = document.getElementById('chapter-title-container');
    const chapterTitleSpan = document.getElementById('chapter-title');
    if (chapterTitleContainer && chapterTitleSpan) {
      chapterTitleSpan.textContent = chapterTitle.trim();
      chapterTitleContainer.style.display = 'block';
    }
  } else {
    // Si no hay título específico, usar la función general
    updateChapterTitle(sectionNum);
  }
  
  // Actualizar información de tokens específica de esta sección
  updateTokenUsage(tokenUsage);
  
  // Mostrar el contenido del script
  const scriptHTML = `
    <div class="script-container">
      <div class="script-actions">
        <button class="copy-script-btn" onclick="copyScriptText()" title="Copiar texto del guión">
          <i class="fas fa-copy"></i>
        </button>
        <button class="audio-script-btn" onclick="generateSectionAudioButton()" title="Generar audio del guión">
          <i class="fas fa-microphone"></i>
        </button>
      </div>
      <div class="script-text">${script.replace(/\n/g, '<br><br>')}</div>
    </div>`;
  
  scriptContent.innerHTML = scriptHTML;
  
  // Actualizar estado de los botones de navegación
  updateNavigationButtons();
  
  // Restaurar carrusel e imágenes de esta sección
  setTimeout(() => {
    if (sectionImages && sectionImages.length > 0) {
      console.log(`ðŸŽ  Restaurando carrusel para sección ${sectionNum} con ${sectionImages.length} imágenes (modo: ${sectionImageMode})`);
      
      // Restaurar keywords globales si es Bing
      if (sectionImageMode === 'bing' && sectionImageKeywords) {
        currentImageKeywords = sectionImageKeywords;
        console.log(`ðŸŽ¯ Keywords restauradas para sección ${sectionNum}:`, currentImageKeywords);
      }
      
      // Crear carrusel con las imágenes de esta sección
      if (sectionImageMode === 'bing') {
        createCarousel(sectionImages, sectionNum, []);
      } else if (sectionImageMode === 'ai') {
        createCarousel(sectionImages, sectionNum, sectionImagePrompts || []);
      }
    } else if (sectionImagePrompts && sectionImagePrompts.length > 0 && sectionImageMode === 'prompts') {
      // Solo prompts (sin carrusel)
      console.log(`ðŸ“‹ Restaurando prompts para sección ${sectionNum}`);
      document.getElementById("carousel-container").style.display = "none";
      addPromptsToSidebar(sectionImagePrompts, sectionNum);
    } else {
      // Sin imágenes en memoria - intentar cargar desde el servidor si hay un proyecto cargado
      if (window.currentProject) {
        console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Intentando cargar imágenes desde servidor para sección ${sectionNum}...`);
        loadSectionImages(sectionNum);
      } else {
        console.log(`ÃƒÂ¢Ã‚ÂÃ…â€™ Sin imágenes para sección ${sectionNum} - ocultando carrusel`);
        document.getElementById("carousel-container").style.display = "none";
      }
    }
  }, 100);
  
  // Animación suave
  scriptContent.style.opacity = "0";
  setTimeout(() => {
    scriptContent.style.transition = "opacity 0.5s ease";
    scriptContent.style.opacity = "1";
  }, 50);
  
  console.log(`ðŸ“„ Mostrando sección ${sectionNum} almacenada`);
}

// Función para actualizar el estado de los botones de navegación
function updateNavigationButtons() {
  const prevSectionBtn = document.getElementById('prevSectionBtn');
  const nextSectionBtn = document.getElementById('nextSectionBtn');
  
  if (!prevSectionBtn || !nextSectionBtn) {
    // Si los botones no existen aún, programar un retry
    setTimeout(updateNavigationButtons, 100);
    return;
  }
  
  // Botón anterior: deshabilitado si estamos en la primera sección
  if (currentSectionNumber <= 1) {
    prevSectionBtn.disabled = true;
  } else {
    prevSectionBtn.disabled = false;
  }
  
  // Botón siguiente: deshabilitado si estamos en la última sección o no hay más secciones
  if (currentSectionNumber >= allSections.length) {
    nextSectionBtn.disabled = true;
  } else {
    nextSectionBtn.disabled = false;
  }
  
  console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Botones actualizados - Sección ${currentSectionNumber}/${allSections.length}`);
}

// Inicializar navegación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  initializeSectionNavigation();
});

// Manejar selección exclusiva de opciones de audio
document.addEventListener('DOMContentLoaded', function() {
  const autoGenerateAudio = document.getElementById('autoGenerateAudio');
  const autoGenerateApplioAudio = document.getElementById('autoGenerateApplioAudio');
  
  if (autoGenerateAudio && autoGenerateApplioAudio) {
    // Cuando se selecciona Google Audio, deseleccionar Applio
    autoGenerateAudio.addEventListener('change', function() {
      if (this.checked) {
        autoGenerateApplioAudio.checked = false;
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ…Â  Audio Google seleccionado, Applio desactivado');
      }
    });
    
    // Cuando se selecciona Applio Audio, deseleccionar Google
    autoGenerateApplioAudio.addEventListener('change', function() {
      if (this.checked) {
        autoGenerateAudio.checked = false;
        console.log('ðŸŽ¤ Audio Applio seleccionado, Google desactivado');
      }
    });
    
    console.log('âœ… Event listeners de audio configurados - selección exclusiva activada');
  }
});

// ========================================
// FUNCIONALIDAD DE EXTRACCIÃ“N DE TEXTO
// ========================================

// Función para mostrar notificaciones
function showNotification(message, type = 'info') {
  console.log(`ðŸ“¢ Notificación [${type.toUpperCase()}]:`, message);
  
  // Crear elemento de notificación
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
  
  // Estilos según el tipo
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
  
  // Remover después de 4 segundos
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
    console.log('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Extractor ya inicializado, omitiendo...');
    return;
  }
  
  console.log('ðŸŽ¤ Inicializando extractor de texto...');
  
  // Elementos del DOM
  const extractTextBtn = document.getElementById('extractTextBtn');
  const extractTextModal = document.getElementById('extractTextModal');
  const closeExtractModal = document.getElementById('closeExtractModal');
  
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Verificando elementos:', {
    extractTextBtn: !!extractTextBtn,
    extractTextModal: !!extractTextModal,
    closeExtractModal: !!closeExtractModal
  });
  
  if (!extractTextBtn) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Botón extractTextBtn no encontrado');
    return;
  }
  
  if (!extractTextModal) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Modal extractTextModal no encontrado');
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
    
    // Nuevos elementos para configuración
    transcriptionMethod: document.getElementById('transcriptionMethod'),
    localConfig: document.getElementById('localConfig'),
    whisperModel: document.getElementById('whisperModel'),
    audioLanguage: document.getElementById('audioLanguage'),
    localModelStatus: document.getElementById('localModelStatus')
  };
  
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Verificación detallada de elementos:', elements);
  
  // Verificar cada elemento
  Object.keys(elements).forEach(key => {
    if (!elements[key]) {
      console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Elemento faltante: ${key}`);
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
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Click en botón extraer texto detectado');
    extractTextModal.style.display = 'flex';
    console.log('ðŸ“‚ Modal de extracción abierto');
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
      showNotification('ðŸ“¥ Archivo detectado - suelta aquí', 'info');
    });
    
    extractDropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      extractDropzone.classList.remove('dragover');
      console.log('ðŸ“¤ Archivo salió de la zona de arrastre...');
    });
    
    extractDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      extractDropzone.classList.remove('dragover');
      console.log('ðŸŽ¯ Archivo soltado en la zona!');
      showNotification('ðŸŽ¯ Archivo recibido - procesando...', 'success');
      
      const files = e.dataTransfer.files;
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Archivos detectados:', files.length);
      
      if (files.length > 0) {
        console.log('ðŸ“„ Procesando archivo:', files[0].name, files[0].type);
        handleFileSelection(files[0]);
      } else {
        console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se detectaron archivos en el drop');
        showNotification('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se detectaron archivos', 'warning');
      }
    });
    
    // Click para seleccionar archivo
    extractDropzone.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â±ÃƒÂ¯Ã‚Â¸Ã‚Â Click en dropzone detectado');
      showNotification('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â±ÃƒÂ¯Ã‚Â¸Ã‚Â Abriendo selector de archivos...', 'info');
      if (extractFileInput) {
        extractFileInput.click();
        console.log('ðŸ“‚ Abriendo selector de archivos...');
      } else {
        console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Input de archivo no encontrado');
        showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error: Input de archivo no encontrado', 'error');
      }
    });
  } else {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Dropzone no encontrado');
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error: Zona de arrastre no encontrada', 'error');
  }
  
  if (extractFileInput) {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Configurando input de archivo...');
    extractFileInput.addEventListener('change', (e) => {
      console.log('ðŸ“„ Archivo seleccionado via input:', e.target.files.length);
      showNotification('ðŸ“„ Archivo seleccionado - procesando...', 'info');
      if (e.target.files.length > 0) {
        console.log('ðŸ“‹ Procesando archivo seleccionado:', e.target.files[0].name);
        handleFileSelection(e.target.files[0]);
      }
    });
  } else {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Input de archivo no encontrado');
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error: Input de archivo no encontrado', 'error');
  }
  
  // Botón transcribir
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
  
  // Cambio de método de transcripción
  const transcriptionMethod = elements.transcriptionMethod;
  const localConfig = elements.localConfig;
  
  if (transcriptionMethod) {
    transcriptionMethod.addEventListener('change', (e) => {
      const method = e.target.value;
      console.log(`ðŸ”§ Método de transcripción cambiado a: ${method}`);
      
      if (method === 'local') {
        localConfig.style.display = 'block';
        checkLocalModelStatus();
        showNotification('ðŸš€ Modo local activado - usando GPU', 'info');
      } else {
        localConfig.style.display = 'none';
        showNotification('ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â Modo API activado - usando OpenAI', 'info');
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
      localModelStatus.innerHTML = '<i class="fas fa-desktop"></i> ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â CPU disponible (sin GPU)';
      localModelStatus.style.background = 'rgba(245, 158, 11, 0.15)';
      localModelStatus.style.color = '#fbbf24';
    }
    
  } catch (error) {
    console.error('Error verificando estado local:', error);
    localModelStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ÃƒÂ¢Ã‚ÂÃ…â€™ Error verificando modelo local';
    localModelStatus.style.background = 'rgba(239, 68, 68, 0.15)';
    localModelStatus.style.color = '#fca5a5';
  }
}

async function handleFileSelection(file) {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â === INICIANDO PROCESAMIENTO DE ARCHIVO ===');
  console.log('ðŸ“„ Archivo seleccionado:', file.name);
  console.log('ðŸ“Š Tamaño:', (file.size / 1024 / 1024).toFixed(2), 'MB');
  console.log('ÃƒÂ°Ã…Â¸Ã‚ÂÃ‚Â·ÃƒÂ¯Ã‚Â¸Ã‚Â Tipo MIME:', file.type);
  
  // Verificar tamaño del archivo
  const fileSizeMB = file.size / 1024 / 1024;
  if (fileSizeMB > 4000) { // 4GB
    showNotification('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Archivo muy grande (>4GB). Esto puede tomar mucho tiempo.', 'warning');
  } else if (fileSizeMB > 1000) { // 1GB
    showNotification('ðŸ“Š Archivo grande detectado. La subida puede tardar unos minutos...', 'info');
  }
  
  // Validar tipo de archivo
  const validTypes = ['audio/mp3', 'audio/wav', 'audio/mpeg', 'audio/m4a', 'video/mp4', 'audio/ogg'];
  const validExtensions = ['.mp3', '.wav', '.m4a', '.mp4', '.ogg'];
  
  const isValidType = validTypes.includes(file.type) || 
                     validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
  
  console.log('âœ… Validación de tipo:', {
    mimeTypeValid: validTypes.includes(file.type),
    extensionValid: validExtensions.some(ext => file.name.toLowerCase().endsWith(ext)),
    overallValid: isValidType
  });
  
  if (!isValidType) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Formato de archivo no soportado');
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Formato de archivo no soportado. Use MP3, WAV, M4A o MP4', 'error');
    return;
  }
  
  selectedFile = file;
  console.log('ðŸ’¾ Archivo almacenado en selectedFile');
  
  // Mostrar nombre del archivo
  const extractFileName = document.getElementById('extractFileName');
  if (extractFileName) {
    extractFileName.textContent = `ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â ${file.name}`;
    extractFileName.style.display = 'block';
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Nombre de archivo mostrado');
    showNotification(`âœ… Archivo cargado: ${file.name}`, 'success');
  } else {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Elemento extractFileName no encontrado');
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error: No se pudo mostrar el nombre del archivo', 'error');
  }
  
  // Si es MP4, obtener pistas de audio
  if (file.name.toLowerCase().endsWith('.mp4')) {
    console.log('ðŸŽ¬ Archivo MP4 detectado, cargando pistas de audio...');
    try {
      await loadAudioTracks(file);
    } catch (error) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando pistas de audio:', error);
      showNotification('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Error cargando pistas, usando configuración por defecto', 'warning');
      
      // Si falla cargar las pistas, habilitar transcripción directamente
      const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
      if (extractTranscribeBtn) {
        extractTranscribeBtn.disabled = false;
        console.log('âœ… Botón habilitado como fallback');
        showNotification('âœ… Listo para transcribir', 'success');
      }
    }
  } else {
    console.log('ðŸŽµ Archivo de audio detectado, preparando para transcripción...');
    // Para archivos de audio, subir archivo y preparar para transcripción
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
        console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error subiendo archivo:', errorData);
        showNotification(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error subiendo archivo: ${errorData.error}`, 'error');
        return; // Salir si hay error
      }
    } catch (error) {
      console.error('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Error pre-subiendo archivo de audio:', error);
      showNotification(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error de conexión: ${error.message}`, 'error');
      return; // Salir si hay error
    }
    
    // Ocultar selector de pistas
    const extractAudioTrackContainer = document.getElementById('extractAudioTrackContainer');
    const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
    
    console.log('ÃƒÂ°Ã…Â¸Ã…Â½Ã¢â‚¬ÂºÃƒÂ¯Ã‚Â¸Ã‚Â Configurando interfaz para archivo de audio...');
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Elementos encontrados:', {
      extractAudioTrackContainer: !!extractAudioTrackContainer,
      extractTranscribeBtn: !!extractTranscribeBtn
    });
    
    if (extractAudioTrackContainer) {
      extractAudioTrackContainer.style.display = 'none';
      console.log('âœ… Selector de pistas ocultado');
    } else {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ extractAudioTrackContainer no encontrado');
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
      console.log('âœ… Botón de transcripción habilitado');
      showNotification('âœ… Listo para transcribir - haz click en "Transcribir Audio"', 'success');
    } else {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ extractTranscribeBtn no encontrado');
      showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error: Botón de transcripción no encontrado', 'error');
    }
  }
  
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â === PROCESAMIENTO DE ARCHIVO COMPLETADO ===');
  
  // Forzar actualización visual
  setTimeout(() => {
    const extractFileName = document.getElementById('extractFileName');
    const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
    
    if (extractFileName && extractFileName.style.display === 'none') {
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Forzando visualización del nombre del archivo...');
      extractFileName.style.display = 'block';
      extractFileName.style.visibility = 'visible';
    }
    
    if (extractTranscribeBtn && extractTranscribeBtn.disabled) {
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Forzando habilitación del botón...');
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
    
    // Habilitar transcripción cuando se seleccione una pista
    extractAudioTrackSelect.addEventListener('change', () => {
      document.getElementById('extractTranscribeBtn').disabled = !extractAudioTrackSelect.value;
    });
    
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando pistas:', error);
    showNotification('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se pudieron cargar las pistas de audio. Se usará la pista por defecto.', 'warning');
    document.getElementById('extractAudioTrackContainer').style.display = 'none';
    document.getElementById('extractTranscribeBtn').disabled = false;
  }
}

async function startTranscription() {
  if (!selectedFile) {
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ No hay archivo seleccionado', 'error');
    return;
  }
  
  console.log('ðŸŽ¤ Iniciando transcripción...');
  
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
  
  console.log(`ðŸ”§ Método: ${method} | Modelo: ${modelSize} | Idioma: ${language || 'auto'}`);
  
  // Deshabilitar botón y mostrar progreso
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
    
    // Determinar endpoint según el método
    const endpoint = method === 'local' ? '/transcribe-audio-local' : '/transcribe-audio';
    const bodyData = { 
      filePath: filePath,
      audioTrackIndex: audioTrackIndex
    };
    
    // Agregar configuraciones adicionales para método local
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
    
    // Llamar a la API de transcripción
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyData)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Error en la transcripción');
    }
    
    const data = await response.json();
    extractedText = data.transcript;
    
    // Mostrar resultado con información adicional según el método
    extractProgressBar.value = 100;
    
    if (method === 'local' && data.stats) {
      extractProgressText.textContent = `âœ… Transcripción completada (${data.stats.processing_speed.toFixed(1)}x tiempo real)`;
      
      // Mostrar información adicional en consola
      console.log(`ðŸ“Š Estadísticas de transcripción local:`, {
        modelo: data.model_info,
        estadisticas: data.stats,
        idioma: data.language,
        duracion: data.duration
      });
      
      showNotification(`âœ… Transcripción local completada - ${data.stats.processing_speed.toFixed(1)}x velocidad`, 'success');
    } else {
      extractProgressText.textContent = 'âœ… Transcripción completada';
      showNotification('âœ… Transcripción completada exitosamente');
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
    
    console.log(`âœ… Transcripción completada (${method})`);
    
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error en transcripción:', error);
    extractProgressText.textContent = `ÃƒÂ¢Ã‚ÂÃ…â€™ Error en la transcripción (${method})`;
    extractProgressText.style.color = '#fca5a5';
    extractProgressText.style.fontWeight = '600';
    extractProgressText.style.background = 'rgba(239, 68, 68, 0.15)';
    extractProgressText.style.padding = '0.5rem';
    extractProgressText.style.borderRadius = '6px';
    extractProgressText.style.border = '1px solid rgba(239, 68, 68, 0.4)';
    showNotification(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error: ${error.message}`, 'error');
  } finally {
    // Rehabilitar botón
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
  
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Formulario de extracción reiniciado');
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

// Helpers para detección de idioma del guión
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
    console.log('ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â Detección de idioma: sin secciones, se asume español');
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
  console.log('ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â Detección de idioma del guión:', {
    detectedLanguage,
    spanishScore,
    englishScore,
    asciiOnlyRatio: Number(asciiOnlyRatio.toFixed(3)),
    sectionsAnalizadas: sections.length
  });

  window.lastDetectedScriptLanguage = detectedLanguage;
  return detectedLanguage;
}

// Función para generar metadata de YouTube
async function generateYouTubeMetadata() {
  try {
    console.log("ðŸŽ¬ Iniciando generación de metadata de YouTube...");
    
  const topicField = typeof promptInput !== 'undefined' && promptInput ? promptInput : document.getElementById('prompt');
  const topic = topicField?.value?.trim();
    const folderName = document.getElementById("folderName")?.value?.trim() || '';

    const sectionsForMetadata = getSectionsForLanguageDetection();

    if (!topic || sectionsForMetadata.length === 0) {
      console.error("ÃƒÂ¢Ã‚ÂÃ…â€™ No hay tema o secciones para generar metadata");
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
        <p>Creando títulos clickbait, descripción SEO y etiquetas...</p>
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
      console.error("ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando metadata:", data.error);
      showError("Error generando metadata de YouTube: " + data.error);
      throw new Error(data.error || 'Error al generar metadata de YouTube');
    }

  } catch (error) {
    console.error("ÃƒÂ¢Ã‚ÂÃ…â€™ Error en generateYouTubeMetadata:", error);
    showError("Error generando metadata de YouTube: " + error.message);
    
    // Remover indicador de carga si existe
    const loadingIndicator = output.querySelector('.youtube-metadata-loading');
    if (loadingIndicator) {
      loadingIndicator.remove();
    }

    throw error;
  }
}

// Función para mostrar los resultados de metadata de YouTube
function showYouTubeMetadataResults(metadata, topic) {
  console.log("Mostrando resultados de metadata de YouTube");

  const metadataContainer = document.createElement('div');
  metadataContainer.className = 'youtube-metadata-container';
  
  const sections = parseMetadata(metadata);
  
  metadataContainer.innerHTML = `
    <div class="youtube-metadata-panel collapsed">
      <div class="youtube-metadata-header" onclick="toggleMainMetadataPanel(this)">
        <h3>
          <i class="fab fa-youtube" style="color:#ff4444"></i> Metadata para YouTube
          <span class="metadata-topic-inline">- ${topic}</span>
        </h3>
        <i class="fas fa-chevron-right main-toggle-icon"></i>
      </div>
      
      <div class="youtube-metadata-content">
        <div class="metadata-section collapsible">
          <div class="section-header" onclick="toggleMetadataSection(this)">
            <h3><i class="fas fa-fire"></i> Titulos Clickbait</h3>
            <i class="fas fa-chevron-down toggle-icon"></i>
          </div>
          <div class="section-content">
            <div class="titles-list">
              ${sections.titles.map((title, idx) => `
                <div class="title-item" id="titleItem${idx}">
                  <span class="title-text">${title}</span>
                  <div class="title-actions">
                    <button class="title-translate-btn" onclick="event.stopPropagation(); translateTitle(${idx}, this)" title="Traducir a 5 idiomas">
                      <i class="fas fa-globe"></i>
                    </button>
                    <button class="copy-btn" onclick="copyToClipboard('${title.replace(/'/g, "\\'")}')">
                      <i class="fas fa-copy"></i>
                    </button>
                  </div>
                  <div class="title-translations" id="titleTranslations${idx}" style="display:none"></div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        
        <div class="metadata-section collapsible">
          <div class="section-header" onclick="toggleMetadataSection(this)">
            <h3><i class="fas fa-align-left"></i> Descripcion SEO</h3>
            <i class="fas fa-chevron-down toggle-icon"></i>
          </div>
          <div class="section-content">
            <div class="description-container">
              <textarea class="description-text" readonly>${sections.description}</textarea>
              <div class="desc-actions-row">
                <div class="desc-left-btns">
                  <button class="copy-btn-large" onclick="copyToClipboard(document.querySelector('.description-text').value)">
                    <i class="fas fa-copy"></i> Copiar
                  </button>
                  <button class="copy-btn-large desc-translate-main" id="btnTranslateDesc" onclick="translateDescriptionAll(this)">
                    <i class="fas fa-globe"></i> Traducir
                  </button>
                </div>
                <div class="desc-translate-btns">
                  <button class="desc-lang-btn desc-lang-pending" data-lang="en" onclick="copyDescTranslation('en')" title="No traducido aun">EN</button>
                  <button class="desc-lang-btn desc-lang-pending" data-lang="fr" onclick="copyDescTranslation('fr')" title="No traducido aun">FR</button>
                  <button class="desc-lang-btn desc-lang-pending" data-lang="de" onclick="copyDescTranslation('de')" title="No traducido aun">DE</button>
                  <button class="desc-lang-btn desc-lang-pending" data-lang="ko" onclick="copyDescTranslation('ko')" title="No traducido aun">KO</button>
                  <button class="desc-lang-btn desc-lang-pending" data-lang="ru" onclick="copyDescTranslation('ru')" title="No traducido aun">RU</button>
                </div>
              </div>
              <div id="descTranslationResult" style="display:none"></div>
            </div>
          </div>
        </div>
        
        <div class="metadata-section collapsible">
          <div class="section-header" onclick="toggleMetadataSection(this)">
            <h3><i class="fas fa-tags"></i> Etiquetas (${sections.tags.length})</h3>
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
        
        <div class="metadata-actions">
          <button class="btn btn-primary" onclick="downloadYouTubeMetadata('${topic}', \`${metadata.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">
            <i class="fas fa-download"></i> Descargar
          </button>
        </div>
      </div>
    </div>
  `;
  
  output.appendChild(metadataContainer);
  
  const descriptionTextarea = metadataContainer.querySelector('.description-text');
  if (descriptionTextarea) {
    setTimeout(() => {
      descriptionTextarea.style.height = 'auto';
      descriptionTextarea.style.height = (descriptionTextarea.scrollHeight + 10) + 'px';
    }, 50);
  }
  
  initializeCollapsedSections();
  
  const mainPanel = output.querySelector('.youtube-metadata-panel');
  if (mainPanel) {
    mainPanel.classList.add('collapsed');
    const mainIcon = mainPanel.querySelector('.main-toggle-icon');
    if (mainIcon) {
      mainIcon.classList.remove('fa-chevron-down');
      mainIcon.classList.add('fa-chevron-right');
    }
  }
  
  if (!shouldGenerateVideoAutomatically()) {
    showVideoGenerationButton();
  }
  
  setTimeout(() => {
    metadataContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

async function translateTitle(titleIdx, btnEl) {
  const titleItem = document.getElementById('titleItem' + titleIdx);
  const translationsDiv = document.getElementById('titleTranslations' + titleIdx);
  if (!titleItem || !translationsDiv) return;

  const titleText = titleItem.querySelector('.title-text')?.textContent?.trim();
  if (!titleText) return;

  if (translationsDiv.dataset.loaded === 'true') {
    translationsDiv.style.display = translationsDiv.style.display === 'none' ? 'flex' : 'none';
    return;
  }

  btnEl.disabled = true;
  btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

  try {
    const resp = await fetch('/api/translate-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: titleText })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');

    translationsDiv.innerHTML = data.translations.map(t => `
      <div class="translation-row">
        <span class="translation-flag">${t.flag}</span>
        <span class="translation-text">${t.text}</span>
        <button class="copy-btn-sm" onclick="event.stopPropagation(); copyToClipboard('${t.text.replace(/'/g, "\\'")}')" title="Copiar"><i class="fas fa-copy"></i></button>
      </div>
    `).join('');
    translationsDiv.dataset.loaded = 'true';
    translationsDiv.style.display = 'flex';
  } catch (err) {
    translationsDiv.innerHTML = '<div class="translation-row" style="color:#ef4444">Error: ' + err.message + '</div>';
    translationsDiv.style.display = 'flex';
  } finally {
    btnEl.disabled = false;
    btnEl.innerHTML = '<i class="fas fa-globe"></i>';
  }
}

// Store translated descriptions globally
let _descTranslations = {};

async function translateDescriptionAll(btnEl) {
  const descTextarea = document.querySelector('.description-text');
  const resultDiv = document.getElementById('descTranslationResult');
  if (!descTextarea || !resultDiv) return;

  const description = descTextarea.value.trim();
  if (!description) return;

  // If already translated, toggle visibility
  if (Object.keys(_descTranslations).length > 0) {
    resultDiv.style.display = resultDiv.style.display === 'none' ? 'block' : 'none';
    return;
  }

  btnEl.disabled = true;
  btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Traduciendo...';

  try {
    const resp = await fetch('/api/translate-description', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');

    // Store translations
    _descTranslations = {};
    data.translations.forEach(t => { _descTranslations[t.code] = t.text; });

    // Update language buttons to ready state
    document.querySelectorAll('.desc-lang-btn').forEach(btn => {
      const lang = btn.dataset.lang;
      if (_descTranslations[lang]) {
        btn.classList.remove('desc-lang-pending');
        btn.classList.add('desc-lang-ready');
        btn.title = 'Click para copiar';
      }
    });

    // Show compact preview
    const previews = data.translations.map(t => {
      const preview = t.text.substring(0, 120) + (t.text.length > 120 ? '...' : '');
      return `<div class="desc-translation-box">
        <div class="desc-translation-header">
          <span class="desc-translation-lang">${t.flag} ${t.code.toUpperCase()}</span>
          <button class="copy-btn-sm" onclick="event.stopPropagation(); copyToClipboard(_descTranslations['${t.code}'])" title="Copiar"><i class="fas fa-copy"></i></button>
        </div>
        <div class="desc-translation-preview">${preview}</div>
      </div>`;
    }).join('');
    resultDiv.innerHTML = previews;
    resultDiv.style.display = 'block';
  } catch (err) {
    resultDiv.innerHTML = `<div class="desc-translation-box" style="border-color:rgba(239,68,68,0.3)"><span style="color:#ef4444">Error: ${err.message}</span></div>`;
    resultDiv.style.display = 'block';
  } finally {
    btnEl.disabled = false;
    btnEl.innerHTML = '<i class="fas fa-globe"></i> Traducir';
  }
}

function copyDescTranslation(langCode) {
  if (!_descTranslations[langCode]) {
    showNotification('Primero traduce la descripcion con el boton Traducir', 'warning');
    return;
  }
  copyToClipboard(_descTranslations[langCode]);
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

// Función para copiar al portapapeles
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    // Mostrar confirmación visual
    const event = new CustomEvent('showToast', {
      detail: { message: 'Copiado al portapapeles', type: 'success' }
    });
    document.dispatchEvent(event);
  }).catch(err => {
    console.error('Error copiando al portapapeles:', err);
    // Fallback para navegadores más antiguos
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  });
}

// Función para copiar todos los prompts de miniaturas
function copyAllThumbnailPrompts(prompts) {
  const allPrompts = prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join('\n\n');
  copyToClipboard(allPrompts);
}

// Función para descargar metadata de YouTube
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
  
  // Ocultar toast después de 3 segundos
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => document.body.removeChild(toast), 300);
  }, 3000);
});

// Función para colapsar/expandir secciones de metadata
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

// Función para inicializar secciones colapsadas
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

// Función para colapsar/expandir el panel principal de metadata
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
    
    // Ya no expandir automáticamente la primera sección
    // El usuario puede expandir manualmente la sección que desee
  }
}

// ==========================================
// SISTEMA DE ESTILOS DE MINIATURAS
// ==========================================

// Función para inicializar sistema de estilos de miniatura
function initThumbnailStyles() {
  console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Inicializando sistema de estilos de miniatura...');
  
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
    console.error('Ã¢ÂÅ’ Error inicializando estilos de miniatura:', error);
  }
}

// Función para cargar estilos de miniatura desde servidor
async function loadThumbnailStyles() {
  try {
    const response = await fetch('/api/custom-styles');
    if (!response.ok) throw new Error('Error al obtener estilos');
    
    const data = await response.json();
    if (data.thumbnailStyles) {
      customThumbnailStyles = data.thumbnailStyles;
      console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Estilos de miniatura cargados:', customThumbnailStyles);
    } else {
      customThumbnailStyles = [];
      console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â No hay estilos de miniatura guardados');
    }
  } catch (error) {
    console.error('Ã¢ÂÅ’ Error cargando estilos de miniatura:', error);
    customThumbnailStyles = [];
  }
  updateThumbnailStyleSelector();
}

// Función para guardar estilos de miniatura en servidor
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
    console.error('Ã¢ÂÅ’ Error guardando estilos de miniatura:', error);
    alert('Error al guardar estilos en el servidor');
  }
}

// Función para actualizar el selector de estilos de miniatura
function updateThumbnailStyleSelector() {
  const thumbnailStyleSelect = document.getElementById('thumbnailStyleSelect');
  if (!thumbnailStyleSelect) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Selector de estilos de miniatura no encontrado');
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

  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Selector de estilos de miniatura actualizado');
}

// Función para obtener instrucciones de estilo de miniatura
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

// Función para configurar eventos del modal de crear estilo de miniatura
function setupThumbnailStyleModalEvents() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Configurando eventos del modal de crear estilo de miniatura...');
  
  try {
    const thumbnailStyleModal = document.getElementById('thumbnailStyleModal');
    const closeModalBtn = document.getElementById('closeThumbnailStyleModal');
    const cancelBtn = document.getElementById('cancelThumbnailStyleBtn');
    const saveBtn = document.getElementById('saveThumbnailStyleBtn');
    
    // Botones de la sidebar
    const createFromSidebarBtn = document.getElementById('createThumbnailStyleFromSidebar');
    
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Elementos encontrados:', {
      thumbnailStyleModal: !!thumbnailStyleModal,
      closeModalBtn: !!closeModalBtn,
      cancelBtn: !!cancelBtn,
      saveBtn: !!saveBtn,
      createFromSidebarBtn: !!createFromSidebarBtn
    });
    
    if (!thumbnailStyleModal || !closeModalBtn || !cancelBtn || !saveBtn) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Algunos elementos del modal de miniatura no fueron encontrados');
      return;
    }
    
    // Función para cerrar modal
    function closeModal() {
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â„¢ Cerrando modal de crear miniatura...');
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
      console.log('âœ… Event listener del botón guardar configurado');
    } else {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Botón guardar no encontrado');
    }
    
    // Evento para abrir desde sidebar
    if (createFromSidebarBtn) {
      createFromSidebarBtn.addEventListener('click', () => {
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Abriendo modal desde sidebar...');
        openThumbnailStyleModal();
      });
      console.log('âœ… Event listener configurado para botón crear desde sidebar');
    } else {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Botón crear desde sidebar no encontrado');
    }
    
    // Cerrar al hacer clic fuera del modal
    thumbnailStyleModal.addEventListener('click', (e) => {
      if (e.target === thumbnailStyleModal) {
        closeModal();
      }
    });
    
    console.log('âœ… Eventos del modal de miniatura configurados correctamente');
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error configurando eventos del modal de miniatura:', error);
  }
}

// Función para abrir modal de crear estilo de miniatura
function openThumbnailStyleModal() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Abriendo modal de crear estilo de miniatura...');
  
  try {
    const thumbnailStyleModal = document.getElementById('thumbnailStyleModal');
    if (thumbnailStyleModal) {
      // Solo limpiar si está cerrado para evitar interferir mientras se escribe
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
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Modal de crear estilo de miniatura no encontrado');
    }
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error abriendo modal de crear miniatura:', error);
  }
}

// Función para limpiar formulario del modal
function clearThumbnailModalForm() {
  document.getElementById('thumbnailStyleName').value = '';
  document.getElementById('thumbnailStyleDescription').value = '';
  document.getElementById('thumbnailPrimaryColor').value = '';
  document.getElementById('thumbnailSecondaryColor').value = '';
  document.getElementById('thumbnailInstructions').value = '';
}

// Función para guardar nuevo estilo de miniatura
function saveThumbnailStyle() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Intentando guardar estilo de miniatura...');
  
  try {
    const name = document.getElementById('thumbnailStyleName').value.trim();
    const description = document.getElementById('thumbnailStyleDescription').value.trim();
    const primaryColor = document.getElementById('thumbnailPrimaryColor').value.trim();
    const secondaryColor = document.getElementById('thumbnailSecondaryColor').value.trim();
    const instructions = document.getElementById('thumbnailInstructions').value.trim();
    
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Valores del formulario:', {
      name, description, primaryColor, secondaryColor, instructions
    });
    
    if (!name || !description || !primaryColor || !secondaryColor || !instructions) {
      console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Campos incompletos');
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
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Modal no encontrado');
    }
    
    console.log('âœ… Estilo de miniatura guardado:', newStyle);
    
    // Mostrar mensaje de éxito
    try {
      showNotification('âœ… Estilo de miniatura creado exitosamente', 'success');
      console.log('âœ… Notificación mostrada');
    } catch (notifError) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error mostrando notificación:', notifError);
    }
    
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error en saveThumbnailStyle:', error);
    alert('Error guardando el estilo: ' + error.message);
  }
}

// Función para configurar eventos del modal de gestionar estilos
function setupManageThumbnailStylesEvents() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Configurando eventos del modal de gestionar estilos de miniatura...');
  
  try {
    const manageThumbnailStylesModal = document.getElementById('manageThumbnailStylesModal');
    const closeManageBtn = document.getElementById('closeManageThumbnailStylesModal');
    const closeManageFooterBtn = document.getElementById('closeManageThumbnailStylesBtn');
    
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Elementos de gestión encontrados:', {
      manageThumbnailStylesModal: !!manageThumbnailStylesModal,
      closeManageBtn: !!closeManageBtn,
      closeManageFooterBtn: !!closeManageFooterBtn
    });
    
    // Función para cerrar el modal
    function closeManageModal() {
      console.log('Ã¯¿Â½ Cerrando modal de gestionar miniaturas...');
      if (manageThumbnailStylesModal) {
        manageThumbnailStylesModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        console.log('âœ… Modal de gestión cerrado');
      }
    }
    
    // NO configurar el botón de abrir aquí (se hace manualmente)
    // Solo configurar los botones de cerrar
    
    if (closeManageBtn) {
      closeManageBtn.addEventListener('click', closeManageModal);
      console.log('âœ… Botón X de cerrar configurado');
    } else {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Botón X de cerrar no encontrado');
    }
    
    if (closeManageFooterBtn) {
      closeManageFooterBtn.addEventListener('click', closeManageModal);
      console.log('âœ… Botón Cerrar del footer configurado');
    } else {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Botón Cerrar del footer no encontrado');
    }
    
    if (manageThumbnailStylesModal) {
      manageThumbnailStylesModal.addEventListener('click', (e) => {
        if (e.target === manageThumbnailStylesModal) {
          closeManageModal();
        }
      });
      console.log('âœ… Evento de clic fuera del modal configurado');
    }
    
    console.log('âœ… Eventos de gestión de miniatura configurados correctamente');
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error configurando eventos de gestión de miniatura:', error);
  }
}

// Función para abrir modal de gestionar estilos de miniatura
function openManageThumbnailStylesModal() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Abriendo modal de gestionar estilos de miniatura...');
  
  try {
    const manageThumbnailStylesModal = document.getElementById('manageThumbnailStylesModal');
    if (manageThumbnailStylesModal) {
      console.log('âœ… Modal de gestión encontrado, cargando lista...');
      loadThumbnailStylesList();
      manageThumbnailStylesModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      console.log('âœ… Modal de gestión abierto');
    } else {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Modal de gestión no encontrado');
    }
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error abriendo modal de gestión:', error);
  }
}

// Función para cargar lista de estilos de miniatura
function loadThumbnailStylesList() {
  console.log('ðŸ“‹ Cargando lista de estilos de miniatura...');
  console.log('ðŸ“Š Estilos disponibles:', customThumbnailStyles);
  
  try {
    const thumbnailStylesList = document.getElementById('thumbnailStylesList');
    const noThumbnailStylesMessage = document.getElementById('noThumbnailStylesMessage');
    
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Elementos encontrados:', {
      thumbnailStylesList: !!thumbnailStylesList,
      noThumbnailStylesMessage: !!noThumbnailStylesMessage
    });
    
    if (!thumbnailStylesList || !noThumbnailStylesMessage) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Elementos de lista no encontrados');
      return;
    }
    
    thumbnailStylesList.innerHTML = '';
    
    if (customThumbnailStyles.length === 0) {
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â No hay estilos personalizados, mostrando mensaje');
      noThumbnailStylesMessage.style.display = 'block';
      thumbnailStylesList.style.display = 'none';
    } else {
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Mostrando ${customThumbnailStyles.length} estilos personalizados`);
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
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando lista de estilos:', error);
  }
}

// Función para eliminar estilo de miniatura
function deleteThumbnailStyle(styleId) {
  if (confirm('¿Estás seguro de que quieres eliminar este estilo de miniatura?')) {
    customThumbnailStyles = customThumbnailStyles.filter(style => style.id !== styleId);
    saveThumbnailStyles();
    updateThumbnailStyleSelector();
    loadThumbnailStylesList();
    showNotification('âœ… Estilo de miniatura eliminado', 'success');
  }
}

// Función para editar estilo de miniatura
function editThumbnailStyle(styleId) {
  const style = customThumbnailStyles.find(s => s.id === styleId);
  if (!style) return;
  
  currentEditingThumbnailStyleId = styleId;
  
  // Llenar formulario de edición
  document.getElementById('editThumbnailStyleName').value = style.name;
  document.getElementById('editThumbnailStyleDescription').value = style.description;
  document.getElementById('editThumbnailPrimaryColor').value = style.primaryColor;
  document.getElementById('editThumbnailSecondaryColor').value = style.secondaryColor;
  document.getElementById('editThumbnailInstructions').value = style.instructions;
  
  // Cerrar modal de gestionar y abrir modal de editar
  document.getElementById('manageThumbnailStylesModal').style.display = 'none';
  document.getElementById('editThumbnailStyleModal').style.display = 'flex';
}

// Función para configurar eventos del modal de editar
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

// Función para guardar cambios en estilo editado
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

// Función para obtener datos del estilo de miniatura seleccionado
function getThumbnailStyleData() {
  const thumbnailStyleSelect = document.getElementById('thumbnailStyleSelect');
  if (!thumbnailStyleSelect) {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG - thumbnailStyleSelect no encontrado, usando default');
    return 'default';
  }
  
  const selectedValue = thumbnailStyleSelect.value;
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG - selectedValue del selector:', selectedValue);
  
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
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG - Enviando estilo personalizado completo:', result);
      return result;
    }
  }
  
  // Estilo predeterminado
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG - Enviando estilo predeterminado:', selectedValue);
  return selectedValue;
}

// FALLBACK PARA SIDEBAR - Se ejecuta después de que todo esté cargado
setTimeout(function() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ FALLBACK: Verificando configuración del sidebar...');
  
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.getElementById('sidebar');
  
  if (menuToggleBtn && sidebar) {
    console.log('âœ… Elementos del sidebar encontrados - onclick ya configurado en HTML');
  } else {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ FALLBACK: Elementos del sidebar no encontrados');
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
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Inicializador de respaldo ejecutándose...');
  const saveBtn = document.getElementById('saveProjectBtn');
  const loadBtn = document.getElementById('loadProjectBtn');
  const manageBtn = document.getElementById('manageProjectsBtn');
  
  if (saveBtn && !saveBtn.onclick && !saveBtn.hasAttribute('data-initialized')) {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Configurando eventos de respaldo...');
    
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
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ RESPALDO: Click en Gestionar Proyectos');
        e.preventDefault();
        showManageProjectsModal();
      });
      manageBtn.setAttribute('data-initialized', 'true');
    }
    
    console.log('âœ… Eventos de respaldo configurados');
  } else {
    console.log('ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¹ÃƒÂ¯Ã‚Â¸Ã‚Â Eventos ya configurados o elementos no encontrados');
  }
}, 2000);

function initializeProjectSystem() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Inicializando sistema de proyectos...');
  
  const saveProjectBtn = document.getElementById('saveProjectBtn');
  const loadProjectBtn = document.getElementById('loadProjectBtn');
  const manageProjectsBtn = document.getElementById('manageProjectsBtn');

  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Elementos encontrados:', {
    saveProjectBtn: !!saveProjectBtn,
    loadProjectBtn: !!loadProjectBtn,
    manageProjectsBtn: !!manageProjectsBtn
  });

  if (saveProjectBtn) {
    console.log('âœ… Configurando evento para saveProjectBtn');
    saveProjectBtn.addEventListener('click', function(e) {
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â±ÃƒÂ¯Ã‚Â¸Ã‚Â Click en Guardar Proyecto');
      e.preventDefault();
      saveCurrentProject();
    });
  } else {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró saveProjectBtn');
  }
  
  if (loadProjectBtn) {
    console.log('âœ… Configurando evento para loadProjectBtn');
    loadProjectBtn.addEventListener('click', function(e) {
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â±ÃƒÂ¯Ã‚Â¸Ã‚Â Click en Cargar Proyecto');
      e.preventDefault();
      showLoadProjectModal();
    });
  } else {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró loadProjectBtn');
  }
  
  if (manageProjectsBtn) {
    console.log('âœ… Configurando evento para manageProjectsBtn');
    manageProjectsBtn.addEventListener('click', function(e) {
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â±ÃƒÂ¯Ã‚Â¸Ã‚Â Click en Gestionar Proyectos');
      e.preventDefault();
      showManageProjectsModal();
    });
  } else {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró manageProjectsBtn');
  }

  // Inicializar event listeners de modales
  initializeProjectModals();
  
  console.log('âœ… Sistema de proyectos inicializado');
}

// Función para guardar el proyecto actual
async function saveCurrentProject() {
  try {
    console.log('ðŸ’¾ Iniciando guardado de proyecto...');
    
    const topicElement = document.getElementById('topic');
    const folderNameElement = document.getElementById('folderName');
    const sectionsNumberElement = document.getElementById('sectionsNumber');
    
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Elementos encontrados:', {
      topic: !!topicElement,
      folderName: !!folderNameElement,
      sectionsNumber: !!sectionsNumberElement
    });
    
    if (!topicElement || !folderNameElement || !sectionsNumberElement) {
      showNotification('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se encontraron los elementos del formulario. Asegúrate de haber configurado un proyecto.', 'warning');
      return;
    }
    
    const topic = topicElement.value.trim();
    const folderName = folderNameElement.value.trim();
    const totalSections = parseInt(sectionsNumberElement.value);
    
    if (!topic) {
      showNotification('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Ingresa un tema para guardar el proyecto', 'warning');
      return;
    }

    // El proyecto se guarda automáticamente al generar contenido
    // Esta función es principalmente para mostrar confirmación manual
    showNotification('ðŸ’¾ El proyecto se guarda automáticamente al generar contenido', 'info');
    
    // Si hay contenido generado, refrescar la lista de proyectos
    if (currentSectionNumber > 0) {
      await refreshProjectsList();
      showNotification('âœ… Estado del proyecto actualizado', 'success');
    }
    
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error guardando proyecto:', error);
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error guardando el proyecto', 'error');
  }
}

// Función para mostrar modal de cargar proyecto
async function showLoadProjectModal() {
  const modal = document.getElementById('loadProjectModal');
  const container = document.getElementById('projectsListContainer');
  
  modal.style.display = 'block';
  container.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i><span>Cargando proyectos...</span></div>';
  
  try {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Haciendo fetch a /api/projects...');
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
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ API devolvió error:', data.error);
      container.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><h3>Error cargando proyectos</h3><p>${data.error || 'No se pudieron cargar los proyectos disponibles'}</p></div>`;
    }
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando proyectos:', error);
    // No usar availableProjects aquí que causa el error
    container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Error de conexión</h3><p>Error: ${error.message}</p><p>Asegúrate de que el servidor esté funcionando en http://localhost:3000</p></div>`;
  }
}

// Función para mostrar modal de gestionar proyectos
async function showManageProjectsModal() {
  const modal = document.getElementById('manageProjectsModal');
  const container = document.getElementById('manageProjectsContainer');
  
  modal.style.display = 'block';
  container.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i><span>Cargando proyectos...</span></div>';
  
  try {
    await refreshProjectsList();
    renderProjectsList(container, 'manage');
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando proyectos para gestión:', error);
    container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Error de conexión</h3><p>No se pudo conectar con el servidor</p></div>';
  }
}

// Función para refrescar lista de proyectos
async function refreshProjectsList() {
  // Verificar que availableProjects esté definido
  if (typeof window.availableProjects === 'undefined') {
    console.log('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â window.availableProjects no definido en refresh, inicializando...');
    window.availableProjects = [];
  }
  
  try {
    const response = await fetch('/api/projects');
    const data = await response.json();
    
    if (data.success) {
      window.availableProjects = data.projects;
      availableProjects = window.availableProjects; // Sincronizar variable local
      
      // Actualizar containers si están visibles
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
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error refrescando proyectos:', error);
    return false;
  }
}

// Función para renderizar lista de proyectos
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
            <span class="project-info-label">Estado de imágenes:</span>
            <span class="project-info-value">
              ${project.imagesPerSection ? project.imagesPerSection.map(s => 
                `<span class="status-square status-${s.status}" title="${s.section.replace('seccion_', 'Sección ')}: ${s.images} imágenes, ${s.prompts} prompts"></span>`
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
            <span class="project-info-label">Ãšltima modificación:</span>
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
    console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se pudo cargar el estado de proyectos completados:', error);
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
    console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se pudo guardar el estado de proyectos completados:', error);
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

// Función para inicializar el colapso del contenedor del script
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

// Función para cargar un proyecto
async function loadProject(folderName) {
  window._isActiveGeneration = false;
  try {
    // Evitar cargar el mismo proyecto múltiples veces
    if (window.currentProject && window.currentProject.folderName === folderName) {
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Proyecto "${folderName}" ya está cargado, omitiendo recarga`);
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
      
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Elementos del formulario encontrados:', {
        prompt: !!topicElement, // Cambiado de topic a prompt
        folderName: !!folderNameElement,
        sectionsNumber: !!sectionsNumberElement,
        voiceSelect: !!voiceSelectElement,
        imageModelSelect: !!imageModelSelectElement,
        llmModelSelect: !!llmModelSelectElement
      });
      
      if (topicElement) {
        topicElement.value = window.currentProject.topic;
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Tema del guión cargado:', window.currentProject.topic);
      } else {
        console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Elemento prompt (tema del guión) no encontrado');
      }
      
      if (folderNameElement) {
        folderNameElement.value = window.currentProject.folderName;
      } else {
        console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Elemento folderName no encontrado');
      }
      
      if (sectionsNumberElement) {
        sectionsNumberElement.value = window.currentProject.totalSections;
        updateSectionButtons(); // Actualizar estado de botones
      } else {
        console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Elemento sectionsNumber no encontrado');
      }
      
      if (voiceSelectElement) {
        voiceSelectElement.value = window.currentProject.voice || 'shimmer';
      } else {
        console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Elemento voiceSelect no encontrado');
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
      
      // ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ CARGAR CONFIGURACIONES ADICIONALES DEL PROYECTO
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Cargando configuraciones adicionales del proyecto...');
      
      // Cargar estilo de narración
      const styleSelectElement = document.getElementById('styleSelect');
      if (styleSelectElement && window.currentProject.scriptStyle) {
        styleSelectElement.value = window.currentProject.scriptStyle;
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Estilo de narración cargado:', window.currentProject.scriptStyle);
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
        console.log('ÃƒÂ°Ã…Â¸Ã…Â½Ã¢â‚¬ÂºÃƒÂ¯Ã‚Â¸Ã‚Â Modelo de Applio cargado:', window.currentProject.applioModel);
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
      
      // Cargar modificador de prompts (instrucciones para imágenes)
      const promptModifierElement = document.getElementById('promptModifier');
      if (promptModifierElement && window.currentProject.promptModifier) {
        promptModifierElement.value = window.currentProject.promptModifier;
        console.log('ðŸŽ¨ Modificador de prompts cargado:', window.currentProject.promptModifier);
      }
      
      // Cargar configuración de checkboxes
      const skipImagesElement = document.getElementById('skipImages');
      if (skipImagesElement && typeof window.currentProject.skipImages === 'boolean') {
        skipImagesElement.checked = window.currentProject.skipImages;
        console.log('ðŸš« Skip imágenes cargado:', window.currentProject.skipImages, 'checkbox checked:', skipImagesElement.checked);
      } else {
        console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Skip Images - elemento:', !!skipImagesElement, 'valor en proyecto:', window.currentProject.skipImages, 'tipo:', typeof window.currentProject.skipImages);
      }
      
      const googleImagesElement = document.getElementById('googleImages');
      if (googleImagesElement && typeof window.currentProject.googleImages === 'boolean') {
        googleImagesElement.checked = window.currentProject.googleImages;
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Google Images cargado:', window.currentProject.googleImages, 'checkbox checked:', googleImagesElement.checked);
      } else {
        console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Google Images - elemento:', !!googleImagesElement, 'valor en proyecto:', window.currentProject.googleImages, 'tipo:', typeof window.currentProject.googleImages);
      }
      
      // Cargar número de imágenes
      const imagesSelectElement = document.getElementById('imagesSelect');
      if (imagesSelectElement && window.currentProject.imageCount) {
        imagesSelectElement.value = window.currentProject.imageCount;
        console.log('🖼️ Número de imágenes cargado:', window.currentProject.imageCount);
      }
      
      // Cargar palabras por sección (minWords y maxWords)
      const minWordsElement = document.getElementById('minWords');
      if (minWordsElement && window.currentProject.minWords) {
        minWordsElement.value = window.currentProject.minWords;
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â MinWords cargado:', window.currentProject.minWords);
      }
      
      const maxWordsElement = document.getElementById('maxWords');
      if (maxWordsElement && window.currentProject.maxWords) {
        maxWordsElement.value = window.currentProject.maxWords;
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â MaxWords cargado:', window.currentProject.maxWords);
      }
      
      console.log('âœ… Todas las configuraciones del proyecto han sido restauradas');
      
      // Actualizar estado de la interfaz
      if (window.currentProject.completedSections.length > 0) {
        window.currentTopic = window.currentProject.topic;
        window.totalSections = window.currentProject.totalSections;
        // Para el botón continuar, currentSectionNumber debe ser el número de secciones completadas
        window.currentSectionNumber = window.currentProject.completedSections.length;
        
        // También actualizar las variables globales para compatibilidad
        currentTopic = window.currentProject.topic;
        totalSections = window.currentProject.totalSections;
        currentSectionNumber = window.currentProject.completedSections.length;
        
        console.log('ðŸ“Š Variables globales actualizadas:', {
          currentTopic,
          totalSections,
          currentSectionNumber,
          completedSections: window.currentProject.completedSections.length
        });
        
        // Mostrar la última sección completada
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
        console.log('ðŸŽ¬ Proyecto tiene metadatos de YouTube, mostrando automáticamente...');
        const isProjectComplete = window.currentProject.completedSections.length >= window.currentProject.totalSections;
        
        if (isProjectComplete) {
          // Mostrar metadatos automáticamente para proyectos completos
          isMetadataShown = true; // Marcar como mostrado INMEDIATAMENTE
          setTimeout(() => {
            showYouTubeMetadataResults(window.currentProject.youtubeMetadata.content, window.currentProject.topic);
            showNotification('ðŸŽ¬ Metadatos de YouTube cargados automáticamente', 'info');
          }, 1500); // Delay para que se complete la carga del proyecto
        } else {
          console.log('ðŸ“Š Proyecto incompleto, metadatos disponibles pero no se muestran automáticamente');
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
      
      // Actualizar estado de los botones según el progreso del proyecto
      updateProjectButtons(window.currentProject);
      
      // Cerrar modales
      closeModal('loadProjectModal');
      closeModal('manageProjectsModal');
      
      showNotification(`âœ… Proyecto "${window.currentProject.folderName}" cargado exitosamente`, 'success');
      
      // Mostrar detalles del proyecto cargado
      showProjectDetails(window.currentProject);

      // Auto-cargar status de B-Roll (resultados de búsqueda + descarga)
      if (window.loadBrollStatusForProject) {
        window.loadBrollStatusForProject(window.currentProject.folderName);
      }

      // Auto-cargar timeline de B-Roll si existe preview previo
      loadExistingBrollTimeline(window.currentProject.folderName);

      // Check for existing rendered B-Roll videos and show translate panel
      checkAndShowTranslatePanel(window.currentProject.folderName);
      
    } else {
      showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando el proyecto', 'error');
    }
    
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando proyecto:', error);
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error de conexión al cargar proyecto', 'error');
  } finally {
    isLoadingProject = false; // Desactivar bandera de carga al finalizar
  }
}

// Función para mostrar sección cargada
function showLoadedSection(section) {
  const scriptContent = document.getElementById('scriptContent');
  const sectionTitle = document.getElementById('sectionTitle');
  const currentSectionSpan = document.getElementById('currentSection');
  
  if (scriptContent && section.script) {
    // Mostrar script
    const scriptHTML = `
      <div class="script-container">
        <div class="script-actions">
          <button class="copy-script-btn" onclick="copyScriptText()" title="Copiar texto del guión">
            <i class="fas fa-copy"></i>
          </button>
          <button class="audio-script-btn" onclick="generateSectionAudioButton()" title="Generar audio del guión">
            <i class="fas fa-microphone"></i>
          </button>
        </div>
        <div class="script-text">${section.script.replace(/\n/g, '<br><br>')}</div>
      </div>`;
    
    scriptContent.innerHTML = scriptHTML;
    scriptContent.style.display = 'block';
  }
  
  if (sectionTitle) {
    sectionTitle.textContent = `Sección ${section.section}`;
  }
  
  if (currentSectionSpan) {
    currentSectionSpan.textContent = section.section;
  }
  
  // Cargar y mostrar imágenes en el carrusel si existen
  if (section.hasImages || section.imageFiles || section.googleImagesMode) {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Cargando imágenes para sección:', section.section);
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Motivo de carga:', {
      hasImages: section.hasImages,
      imageFiles: !!section.imageFiles,
      googleImagesMode: section.googleImagesMode
    });
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Datos completos de la sección:', section);
    loadSectionImages(section.section);
  } else {
    console.log('ðŸš« No se detectaron imágenes para cargar:', {
      hasImages: section.hasImages,
      imageFiles: !!section.imageFiles,
      googleImagesMode: section.googleImagesMode,
      sectionKeys: Object.keys(section)
    });
    
    // FORZAR carga de imágenes independientemente de las banderas
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Intentando cargar imágenes forzadamente...');
    loadSectionImages(section.section);
  }
}

// Función para cargar imágenes de una sección específica desde el proyecto
async function loadSectionImages(sectionNumber) {
  try {
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â [loadSectionImages] Iniciando carga para sección ${sectionNumber}`);
    
    if (!window.currentProject) {
      console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No hay proyecto cargado actualmente');
      return;
    }
    
    // ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Usar la carpeta correcta del proyecto
    const projectFolderName = window.currentProject.folderName || 
                             window.currentProject.originalFolderName || 
                             window.currentProject.topic.toLowerCase().replace(/\s+/g, '_');
    
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Buscando imágenes para sección ${sectionNumber} en proyecto: ${projectFolderName}`);
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ URL que se va a llamar: /api/project-images/${projectFolderName}/${sectionNumber}`);
    
    const response = await fetch(`/api/project-images/${projectFolderName}/${sectionNumber}`);
    console.log(`ðŸ“¡ Respuesta del servidor:`, response.status, response.statusText);
    
    const data = await response.json();
    console.log(`ðŸ“Š Datos recibidos completos:`, JSON.stringify(data, null, 2));
    
    if (data.success && data.images && data.images.length > 0) {
      console.log(`âœ… Encontradas ${data.images.length} imágenes para sección ${sectionNumber}`);
      
      // Preparar imágenes para el carrusel
      const carouselImages = data.images.map((image, index) => {
        console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Procesando imagen ${index + 1}:`, image);
        return {
          url: image.url,
          caption: image.caption || `Imagen ${index + 1} de la Sección ${sectionNumber}`,
          filename: image.filename,
          path: image.path,
          source: image.source || 'Google Images' // Añadir source para la lógica del carrusel
        };
      });
      
      console.log(`ðŸŽ  Imágenes preparadas para carrusel:`, carouselImages);
      
      // Cargar keywords si están disponibles
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â [loadSectionImages] Data.keywords recibidas:`, data.keywords);
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â [loadSectionImages] Longitud de keywords:`, data.keywords ? data.keywords.length : 0);
      if (data.keywords && data.keywords.length > 0) {
        currentImageKeywords = data.keywords;
        console.log(`ðŸ“‹ Keywords cargadas para las imágenes:`, data.keywords);
      } else {
        currentImageKeywords = [];
        console.log(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se recibieron keywords del backend`);
      }
      
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â [loadSectionImages] currentImageKeywords final:`, currentImageKeywords);
      
      // Mostrar carrusel
      createCarousel(carouselImages, sectionNumber, []);
      
      // Actualizar variables globales
      totalSlides = carouselImages.length;
      currentSlide = 0;
      
      // Almacenar prompts si están disponibles
      if (data.prompts && data.prompts.length > 0) {
        imagePrompts = data.prompts;
        console.log(`ðŸŽ¨ Prompts de imágenes cargados:`, data.prompts);
      }
      
      console.log(`ðŸŽ  Carrusel creado exitosamente para sección ${sectionNumber}`);
      
    } else {
      console.log(`ðŸ“· No se encontraron imágenes para sección ${sectionNumber}`, data);
      
      // Ocultar carrusel si no hay imágenes
      const carouselContainer = document.getElementById("carousel-container");
      if (carouselContainer) {
        carouselContainer.style.display = "none";
        console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â„¢ Carrusel ocultado para sección ${sectionNumber}`);
      }
    }
    
  } catch (error) {
    console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando imágenes para sección ${sectionNumber}:`, error);
    
    // Ocultar carrusel en caso de error
    const carouselContainer = document.getElementById("carousel-container");
    if (carouselContainer) {
      carouselContainer.style.display = "none";
    }
  }

  if (shouldRefreshSectionImageProgress()) {
    refreshSectionImageProgress().catch((error) => {
      console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Error actualizando progreso de imágenes tras cargar sección:', error);
    });
  }
}

// Función para cargar prompts del proyecto al panel lateral
function loadProjectPrompts(project) {
  console.log('ðŸ“‹ Iniciando carga de prompts del proyecto...');
  
  if (!project.completedSections || project.completedSections.length === 0) {
    console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ No hay secciones completadas con prompts');
    return;
  }
  
  // Limpiar prompts existentes
  allAccumulatedPrompts = [];
  
  // Limpiar el panel lateral
  clearPromptsSidebar();
  
  let totalPrompts = 0;
  
  // Cargar prompts de cada sección completada
  project.completedSections.forEach(section => {
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Procesando sección ${section.section}:`, {
      tienePrompts: !!(section.imagePrompts && section.imagePrompts.length > 0),
      tieneImageUrls: !!(section.imageUrls && section.imageUrls.length > 0),
      esGoogleImages: section.googleImagesMode
    });
    
    if (section.imagePrompts && section.imagePrompts.length > 0) {
      console.log(`ðŸ“‹ Cargando ${section.imagePrompts.length} prompts de la sección ${section.section}`);
      
      if (section.googleImagesMode) {
        console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Sección ${section.section} tiene keywords para Google Images`);
        
        // Para Google Images, convertir keywords en URLs clicables
        const googleImageUrls = section.imagePrompts.map((keyword, index) => {
          const encodedKeyword = encodeURIComponent(keyword.trim());
          const googleUrl = `https://www.google.com/search?q=${encodedKeyword}&tbm=isch`;
          return `ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ <a href="${googleUrl}" target="_blank" style="color: #00bfff; text-decoration: underline;">Buscar: "${keyword.trim()}"</a>`;
        });
        
        addPromptsToSidebar(googleImageUrls, section.section);
        totalPrompts += googleImageUrls.length;
      } else {
        // Prompts normales de imagen
        addPromptsToSidebar(section.imagePrompts, section.section);
        totalPrompts += section.imagePrompts.length;
      }
    } else if (section.imageUrls && section.imageUrls.length > 0) {
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Sección ${section.section} tiene ${section.imageUrls.length} URLs de imágenes generadas`);
      
      // Si tiene URLs pero no prompts, crear prompts genéricos
      const genericPrompts = section.imageUrls.map((url, index) => `Imagen ${index + 1} generada para la sección ${section.section}`);
      addPromptsToSidebar(genericPrompts, section.section);
      totalPrompts += genericPrompts.length;
    } else if (section.googleImagesMode) {
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Sección ${section.section} usa Google Images automático`);
      
      // Para Google Images, mostrar un indicador
      const googleImageIndicator = [`Sección ${section.section} configurada para usar Google Images automático`];
      addPromptsToSidebar(googleImageIndicator, section.section);
      totalPrompts += 1;
    }
  });
  
  console.log(`âœ… Total de prompts cargados en el panel: ${totalPrompts}`);
  syncSectionImageProgressFromProject(project);
}

// Función para mostrar detalles del proyecto
function showProjectDetails(project) {
  console.log('ðŸ“Š Mostrando detalles del proyecto:', project);
  
  const modal = document.getElementById('projectDetailModal');
  const title = document.getElementById('projectDetailTitle');
  const content = document.getElementById('projectDetailContent');
  
  if (!modal || !title || !content) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Elementos del modal no encontrados:', { modal: !!modal, title: !!title, content: !!content });
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
        <h4><i class="fas fa-info-circle"></i> Información General</h4>
        <div class="overview-grid">
          <div class="overview-item">
            <div class="overview-label">Tema</div>
            <div class="overview-value">${project.topic}</div>
          </div>
          <div class="overview-item">
            <div class="overview-label">Estado</div>
            <div class="overview-value">${isComplete ? 'âœ… Completo' : 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ En progreso'}</div>
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
            <div class="overview-label">Ãšltima modificación</div>
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
              (isComplete ? 'ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Disponibles para generar' : 'ÃƒÂ¢Ã‚ÂÃ…â€™ No disponibles')
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
              console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Procesando sección:', section);
              const hasScript = section.script && section.script.length > 0;
              const hasImages = section.hasImages || section.imageUrls?.length > 0 || section.googleImagesMode;
              const imageCount = section.imageUrls?.length || section.imageCount || 0;
              
              return `
              <div class="section-card">
                <div class="section-header">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="section-number">${section.section}</div>
                    <span style="color: #ffffff; font-weight: 600;">Sección ${section.section}</span>
                  </div>
                  <div class="section-status-badge completed">Completada</div>
                </div>
                <div class="section-info">
                  <div>ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Script: ${hasScript ? 'âœ… Generado' : 'ÃƒÂ¢Ã‚ÂÃ…â€™ No disponible'}</div>
                  <div>ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Imágenes: ${hasImages ? (section.googleImagesMode ? 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Google Images' : `âœ… ${imageCount} imágenes`) : 'ÃƒÂ¢Ã‚ÂÃ…â€™ Sin imágenes'}</div>
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
            <p>Genera contenido para ver las secciones aquí</p>
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
    console.log('ðŸŽ¯ Configurando event listeners para', actionButtons.length, 'botones de sección,', activateButton ? '1' : '0', 'botón de activar y', youtubeMetadataButton ? '1' : '0', 'botón de metadatos');
    
    // Event listeners para botones de sección individuales
    actionButtons.forEach(button => {
      const section = button.getAttribute('data-section');
      const folder = button.getAttribute('data-folder');
      const action = button.getAttribute('data-action');
      const projectData = button.getAttribute('data-project');
      
      button.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Click en botón:', action, 'sección:', section);
        
        let projectObj = project; // Usar el proyecto actual por defecto
        
        // Si hay datos del proyecto en el atributo, usarlos
        if (projectData) {
          try {
            projectObj = JSON.parse(projectData);
          } catch (error) {
            console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error parseando datos del proyecto:', error);
          }
        }
        
        if (action === 'details') {
          loadSectionDetailsWithProject(parseInt(section), folder, projectObj);
        }
      });
    });
    
    // Event listener para el botón de activar proyecto completo
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
            console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error parseando datos del proyecto:', error);
          }
        }
        
        activateFullProject(projectObj);
      });
    }
    
    // Event listener para el botón de abrir carpeta
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
            showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error al abrir la carpeta: ' + result.error, 'error');
          }
        } catch (error) {
          console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error al abrir carpeta:', error);
          showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error al abrir la carpeta', 'error');
        }
      });
    }
    
    // Event listener para el botón de metadatos de YouTube
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
          console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â½ÃƒÂ¯Ã‚Â¸Ã‚Â Mostrando metadatos existentes');
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
                console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando metadatos:', error);
                showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando metadatos de YouTube', 'error');
              });
            }, 1000);
          }).catch(error => {
            console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando proyecto:', error);
            showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando proyecto', 'error');
          });
        }
      });
    }
  }, 100);
  
  modal.style.display = 'block';
}

// Función para duplicar proyecto
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
      showNotification(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error: ${data.error}`, 'error');
    }
    
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error duplicando proyecto:', error);
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error de conexión', 'error');
  }
}

// Función para confirmar eliminación de proyecto
function confirmDeleteProject(folderName, projectName) {
  const modal = document.getElementById('confirmDeleteModal');
  const text = document.getElementById('deleteConfirmText');
  const confirmBtn = document.getElementById('confirmDelete');
  
  text.textContent = `¿Estás seguro de que quieres eliminar el proyecto "${projectName}"? Esta acción no se puede deshacer.`;
  
  // Limpiar event listeners anteriores
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  
  // Agregar nuevo event listener
  newConfirmBtn.addEventListener('click', () => deleteProject(folderName));
  
  modal.style.display = 'block';
}

// Función para eliminar proyecto
async function deleteProject(folderName) {
  try {
    showNotification('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€Ã¢â‚¬ËœÃƒÂ¯Ã‚Â¸Ã‚Â Eliminando proyecto...', 'info');
    
    const response = await fetch(`/api/projects/${folderName}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('âœ… Proyecto eliminado exitosamente', 'success');
      await refreshProjectsList();
      closeModal('confirmDeleteModal');
    } else {
      showNotification(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error: ${data.error}`, 'error');
    }
    
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error eliminando proyecto:', error);
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error de conexión', 'error');
  }
}

// Función para inicializar modales de proyectos
function initializeProjectModals() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Inicializando modales de proyectos...');
  
  // Event listeners para cerrar modales con múltiples métodos
  document.querySelectorAll('.close').forEach(closeBtn => {
    closeBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ Cerrando modal via botón X');
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
      console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ Cerrando modal via click fuera');
      event.target.style.display = 'none';
    }
  });
  
  // Botones específicos de cerrar para modales de proyecto
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
        console.log(`ÃƒÂ¢Ã‚ÂÃ…â€™ Cerrando modal via ${btnId}`);
        const modal = this.closest('.modal');
        if (modal) {
          modal.style.display = 'none';
        }
      });
    }
  });
  
  // Botón de cancelar eliminación
  const cancelDeleteBtn = document.getElementById('cancelDelete');
  if (cancelDeleteBtn) {
    cancelDeleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal('confirmDeleteModal');
    });
  }
  
  // Botón de refrescar proyectos
  const refreshBtn = document.getElementById('refreshProjectsList');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';
      await refreshProjectsList();
      refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Actualizar';
    });
  }
  
  // Búsqueda de proyectos
  const searchInput = document.getElementById('projectsSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      filterProjects(this.value);
    });
  }
  
  console.log('âœ… Modales de proyectos inicializados');
}

// Función para cerrar modal
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
}

// Función para filtrar proyectos
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

// Función para cargar detalles de una sección específica
function loadSectionDetails(sectionNumber) {
  if (!currentProject || !currentProject.completedSections) return;
  
  const section = currentProject.completedSections.find(s => s.section === sectionNumber);
  if (section) {
    showLoadedSection(section);
    closeModal('projectDetailModal');
    showNotification(`ðŸ“„ Sección ${sectionNumber} cargada`, 'success');
  }
}

console.log('âœ… Sistema de proyectos cargado completamente');

// INICIALIZADOR FINAL DIRECTO - FORZAR EVENTOS
setTimeout(function() {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ INICIALIZADOR FINAL: Configurando eventos directos...');
  
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
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ ONCLICK DIRECTO: Gestionar Proyectos');
      e.preventDefault();
      showManageProjectsModal();
      return false;
    };
  }
  
  // Inicializar modales de proyectos
  initializeProjectModals();
  
  // FORZAR eventos de cerrar modal específicamente
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â„¢ Configurando eventos de cerrar modal...');
  document.querySelectorAll('.close[data-modal]').forEach(closeBtn => {
    const modalId = closeBtn.getAttribute('data-modal');
    console.log(`ÃƒÂ¢Ã…¡Ã¢â€žÂ¢ÃƒÂ¯Ã‚Â¸Ã‚Â Configurando cierre para modal: ${modalId}`);
    
    closeBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log(`ÃƒÂ¢Ã‚ÂÃ…â€™ CERRANDO MODAL: ${modalId}`);
      closeModal(modalId);
      return false;
    };
  });
  
  console.log('ðŸŽ¯ Eventos onclick directos configurados');
}, 3000);

// Función para activar un proyecto completo con navegación
function activateFullProject(projectData) {
  console.log('ðŸš€ Activando proyecto completo:', projectData);
  
  if (!projectData || !projectData.completedSections) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Datos del proyecto no válidos');
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Datos del proyecto no válidos', 'error');
    return;
  }
  
  isLoadingProject = true; // Activar bandera de carga
  
  // Cargar el proyecto completo
  loadProject(projectData.folderName).then(() => {
    console.log('âœ… Proyecto cargado, configurando navegación completa');
    
    // Configurar allSections con todas las secciones completadas
    allSections = new Array(projectData.totalSections);
    // Para el botón continuar, currentSectionNumber debe ser el número de secciones completadas
    currentSectionNumber = projectData.completedSections.length;
    
    // También actualizar variables globales
    currentTopic = projectData.topic;
    totalSections = projectData.totalSections;
    
    console.log('ðŸ“Š Variables de navegación configuradas:', {
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
    
    console.log('Ã¯¿Â½ Navegación configurada:', allSections.map((s, i) => s ? `${i+1}: âœ…` : `${i+1}: ÃƒÂ¢Ã‚ÂÃ…â€™`).join(', '));
    
    // Buscar la primera sección disponible
    let firstAvailableSection = projectData.completedSections.find(s => s.script);
    if (firstAvailableSection) {
      currentSectionNumber = firstAvailableSection.section;
      
      // Mostrar la primera sección disponible
      showScript(firstAvailableSection.script, firstAvailableSection.section, projectData.totalSections);
      
      // Asegurar que la sección del script sea visible
      const scriptSection = document.getElementById("script-section");
      if (scriptSection) {
        scriptSection.style.display = 'block';
      }
      
      // Configurar navegación
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
      
      // Actualizar botones según el estado del proyecto
      updateProjectButtons(projectData);
      
      showNotification(`ðŸš€ Proyecto "${projectData.folderName}" activado. Usa â† â†’ para navegar entre secciones.`, 'success');
    } else {
      showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ No hay secciones con script disponibles', 'error');
    }
    
    isLoadingProject = false; // Desactivar bandera de carga al finalizar
  }).catch(error => {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando proyecto:', error);
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cargando proyecto', 'error');
    isLoadingProject = false; // Desactivar bandera en caso de error
  });
}

// Función para actualizar botones según el estado del proyecto
function updateProjectButtons(project) {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Actualizando botones del proyecto:', project);
  
  // Validar que el proyecto tenga la estructura esperada
  if (!project || typeof project !== 'object') {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Proyecto no válido:', project);
    return;
  }
  
  if (!project.completedSections || !Array.isArray(project.completedSections)) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ completedSections no válido:', project.completedSections);
    return;
  }
  
  if (!project.totalSections || typeof project.totalSections !== 'number') {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ totalSections no válido:', project.totalSections);
    return;
  }
  
  const generateBtn = document.getElementById("generateBtn");
  const generateAudioBtn = document.getElementById("generateAudioBtn");
  const generateImagesControls = document.getElementById('generateMissingImagesControls');
  const generateImagesBtn = document.getElementById('generateMissingImagesBtn');
  
  if (!generateBtn || !generateAudioBtn) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Botones no encontrados en el DOM');
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
  
  // ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â CRÃƒÆ’Ã‚ÂTICO: Actualizar variables globales para que coincidan con el estado del proyecto
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
    // No hay secciones completadas - mostrar botón de generar primera sección
    generateBtn.style.display = "inline-flex";
    generateBtn.innerHTML = `
      <i class="fas fa-video"></i>
      <span>Generar Sección 1</span>
    `;
  } else if (completedSections < totalSections) {
    // Hay secciones completadas pero no todas - mostrar botón de audio para la sección actual
    generateAudioBtn.style.display = "inline-flex";
  } else {
    // Todas las secciones están completadas - mostrar botón de audio y botón de video
    generateAudioBtn.style.display = "inline-flex";
    
    // Mostrar botón de generación de video manual
    showVideoGenerationButton();
    
    // ðŸŽ¬ VERIFICAR GENERACIÃ“N AUTOMÃƒÆ’Ã‚ÂTICA DE VIDEO
    // Solo generar automáticamente si no se ha generado ya y está activada la opción
    if (shouldGenerateVideoAutomatically()) {
      const folderName = document.getElementById("folderName").value.trim();
      if (folderName && !isGeneratingVideo) {
        console.log('ðŸŽ¬ Proyecto completo - iniciando generación automática de video...');
        // Delay para permitir que se complete la visualización del proyecto
        setTimeout(() => {
          generateVideoAutomatically();
        }, 2000);
      }
    }
  }
  
  // Siempre mostrar el botón de regenerar audios cuando hay un proyecto cargado
  // (independientemente del estado de completado)
  if (window.currentProject) {
    // Solo mostrar el contenedor de video si no hay múltiples proyectos paralelos
    const hasMultipleProjects = projectProgressContainers.size > 1;
    if (!hasMultipleProjects) {
      const videoContainer = document.getElementById('videoGenerationContainer');
      if (videoContainer) {
        videoContainer.style.display = 'block';
      }
    }
    
    // Actualizar visibility del botón de regenerar audios
    const regenerateAudioBtn = document.getElementById('regenerateApplioAudiosBtn');
    if (regenerateAudioBtn) {
      regenerateAudioBtn.style.display = 'flex';
      console.log('ðŸŽ¤ Botón de regenerar audios mostrado para proyecto cargado');
    }
    
    // Actualizar visibility del botón de regenerar guiones
    const regenerateScriptsBtn = document.getElementById('regenerateMissingScriptsBtn');
    if (regenerateScriptsBtn) {
      regenerateScriptsBtn.style.display = 'inline-flex';
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Botón de regenerar guiones mostrado para proyecto cargado');
    }
    
    // Actualizar visibility del botón de generar imágenes faltantes
    if (generateImagesBtn) {
      generateImagesBtn.style.display = 'inline-flex';
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Botón de generar imágenes mostrado para proyecto cargado');
    }
    if (generateImagesControls) {
      generateImagesControls.style.display = 'flex';
    }
    
    // Actualizar visibility del botón de generar solo prompts
    const generatePromptsBtn = document.getElementById('generateMissingPromptsBtn');
    if (generatePromptsBtn) {
      generatePromptsBtn.style.display = 'inline-flex';
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Botón de generar prompts mostrado para proyecto cargado');
    }

    // Actualizar visibility del botón de descargar zip (mostrar siempre que haya proyecto cargado)
    const downloadZipBtn = document.getElementById('downloadProjectZipBtn');
    if (downloadZipBtn) {
      downloadZipBtn.style.display = 'flex';
      console.log('ðŸ“¦ Botón de descargar proyecto (ZIP) mostrado para proyecto cargado');
    }

    // Mostrar botón de Descargar Contenido (B-Roll)
    const brollQuickBtn = document.getElementById('brollQuickBtn');
    if (brollQuickBtn) {
      brollQuickBtn.style.display = 'flex';
    }

    // Mostrar botón de Generar Video con B-Roll
    const generateBrollVideoBtn = document.getElementById('generateBrollVideoBtn');
    if (generateBrollVideoBtn) {
      generateBrollVideoBtn.style.display = 'flex';
    }

    // Actualizar visibility del panel de traducción
    const translationPanel = document.getElementById('translationPanel');
    if (translationPanel) {
      translationPanel.style.display = 'block';
      console.log('ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â Panel de traducción mostrado para proyecto cargado');
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
  
  console.log('âœ… Botones actualizados correctamente');
}

// Función auxiliar para cargar prompts en el sidebar
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
        <h4>ðŸŽ¨ Prompts de Sección ${sectionNumber}</h4>
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

// Función para obtener el estado actual del proyecto
function getCurrentProjectState() {
  console.log('ðŸ“‹ Obteniendo estado del proyecto actual:', window.currentProject);
  return window.currentProject;
}

// Función para cargar detalles de una sección específica con datos del proyecto
function loadSectionDetailsWithProject(sectionNumber, folderName, projectData) {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Cargando detalles de sección con proyecto:', sectionNumber, folderName, projectData);
  
  isLoadingProject = true; // Activar bandera de carga
  
  if (!projectData || !projectData.completedSections) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Datos del proyecto no válidos');
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Datos del proyecto no válidos', 'error');
    isLoadingProject = false; // Desactivar en caso de error
    return;
  }
  
  const section = projectData.completedSections.find(s => s.section === sectionNumber);
  if (!section) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Sección no encontrada:', sectionNumber);
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Sección no encontrada', 'error');
    isLoadingProject = false; // Desactivar en caso de error
    return;
  }
  
  console.log('ðŸ“‹ Datos de la sección encontrada:', section);
  
  // Crear modal para mostrar detalles de la sección
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'block';
  modal.innerHTML = `
    <div class="modal-content section-detail-modal">
      <div class="modal-header">
        <h3><i class="fas fa-file-alt"></i> Sección ${sectionNumber} - Detalles</h3>
        <span class="close" onclick="closeSectionModal()">&times;</span>
      </div>
      
      <div class="section-detail-content">
        <div class="detail-tabs">
          <button class="detail-tab active" onclick="showSectionTab(event, 'script-tab')">
            <i class="fas fa-file-text"></i> Script
          </button>
          <button class="detail-tab" onclick="showSectionTab(event, 'images-tab')">
            <i class="fas fa-images"></i> Imágenes
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
              '<p class="no-content">ÃƒÂ¢Ã‚ÂÃ…â€™ No hay script generado para esta sección</p>'
            }
          </div>
        </div>
        
        <div id="images-tab" class="tab-content">
          <h4>ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Gestión de Imágenes</h4>
          <div class="images-content">
            ${section.googleImagesMode ? `
              <div class="google-images-info">
                <p><strong>ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Modo Google Images activado</strong></p>
                <p>Las imágenes se buscarán automáticamente desde Google Images</p>
                ${section.keywords ? `<p><strong>Keywords:</strong> ${section.keywords.join(', ')}</p>` : ''}
              </div>
            ` : section.imageUrls && section.imageUrls.length > 0 ? `
              <div class="generated-images">
                <p><strong>ðŸ“Š Imágenes generadas: ${section.imageUrls.length}</strong></p>
                <div class="image-grid">
                  ${section.imageUrls.map((url, index) => `
                    <div class="image-item">
                      <img src="${url}" alt="Imagen ${index + 1}" onclick="window.open('${url}', '_blank')">
                      <div class="image-info">Imagen ${index + 1}</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : '<p class="no-content">ÃƒÂ¢Ã‚ÂÃ…â€™ No hay imágenes para esta sección</p>'}
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
            ` : '<p class="no-content">ÃƒÂ¢Ã‚ÂÃ…â€™ No hay prompts generados para esta sección</p>'}
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

// Función para cargar una sección específica en el editor con datos del proyecto
function loadProjectSectionWithProject(sectionNumber, folderNameOrProject) {
  console.log('ðŸ“¥ Cargando sección en editor:', sectionNumber, folderNameOrProject);
  
  // Si es un string, es el folderName, cargar el proyecto completo
  if (typeof folderNameOrProject === 'string') {
    console.log('ðŸ“‚ Cargando proyecto:', folderNameOrProject);
    loadProject(folderNameOrProject).then(() => {
      // Después de cargar el proyecto, cargar la sección específica
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
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Datos del proyecto no válidos');
      showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Datos del proyecto no válidos', 'error');
      return;
    }
    
    const section = projectData.completedSections.find(s => s.section === sectionNumber);
    if (!section) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Sección no encontrada:', sectionNumber);
      showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Sección no encontrada', 'error');
      return;
    }
    
    // Primero cargar el proyecto si no está activo
    if (!window.currentProject || window.currentProject.folderName !== projectData.folderName) {
      console.log('ðŸ“‚ Cargando proyecto antes de cargar sección');
      loadProject(projectData.folderName).then(() => {
        // Después de cargar el proyecto, cargar la sección
        loadProjectSectionData(sectionNumber, section);
      });
    } else {
      // Si el proyecto ya está activo, cargar directamente la sección
      loadProjectSectionData(sectionNumber, section);
    }
  }
}

// Función auxiliar para cargar datos de sección
function loadProjectSectionData(sectionNumber, section) {
  console.log('ðŸ“‹ Cargando datos de sección en interfaz:', sectionNumber, section);
  
  // Actualizar variables globales
  if (window.currentProject) {
    // Para el botón continuar, currentSectionNumber debe ser el número de secciones completadas
    currentSectionNumber = window.currentProject.completedSections.length;
    window.currentSectionNumber = window.currentProject.completedSections.length;
    window.totalSections = window.currentProject.totalSections;
    window.currentTopic = window.currentProject.topic;
    
    // También actualizar variables globales para compatibilidad
    currentTopic = window.currentProject.topic;
    totalSections = window.currentProject.totalSections;
    
    console.log('ðŸ“Š Variables actualizadas en loadProjectSectionData:', {
      currentSectionNumber,
      totalSections,
      completedSections: window.currentProject.completedSections.length,
      showingSection: sectionNumber
    });
    
    // Configurar allSections para la navegación
    allSections = new Array(window.currentProject.totalSections); // Usar variable global directa
    
    // Llenar allSections con los scripts de las secciones completadas
    window.currentProject.completedSections.forEach(completedSection => {
      if (completedSection.script) {
        allSections[completedSection.section - 1] = completedSection.script;
      }
    });
    
    console.log('ðŸ“š allSections configurado:', allSections.map((s, i) => s ? `${i+1}: âœ…` : `${i+1}: ÃƒÂ¢Ã‚ÂÃ…â€™`).join(', '));
  }
  
  // Actualizar el área del script principal usando la función existente
  if (section.script) {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Mostrando script en interfaz');
    // Usar la función existente para mostrar el script
    showScript(section.script, sectionNumber, window.totalSections || 3);
    
    // Asegurar que la sección del script sea visible
    const scriptSection = document.getElementById("script-section");
    if (scriptSection) {
      scriptSection.style.display = 'block';
    }
    
    // Inicializar navegación entre secciones
    setTimeout(() => {
      initializeSectionNavigation();
      updateNavigationButtons();
    }, 200);
  }
  
  // Actualizar el tema si existe el campo
  const promptArea = document.getElementById('prompt');
  if (promptArea && window.currentProject) {
    promptArea.value = window.currentProject.topic;
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Tema del guión actualizado en sección:', window.currentProject.topic);
  } else {
    console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se pudo actualizar el tema del guión - elemento:', !!promptArea, 'proyecto:', !!window.currentProject);
  }
  
  // Cargar configuración de checkboxes desde el proyecto actual
  if (window.currentProject) {
    const skipImagesElement = document.getElementById('skipImages');
    if (skipImagesElement && typeof window.currentProject.skipImages === 'boolean') {
      skipImagesElement.checked = window.currentProject.skipImages;
      console.log('ðŸš« Skip imágenes actualizado en sección:', window.currentProject.skipImages);
    }
    
    const googleImagesElement = document.getElementById('googleImages');
    if (googleImagesElement && typeof window.currentProject.googleImages === 'boolean') {
      googleImagesElement.checked = window.currentProject.googleImages;
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Google Images actualizado en sección:', window.currentProject.googleImages);
    }
  }
  
  // Cargar prompts en el panel lateral si existen
  if (section.imagePrompts && section.imagePrompts.length > 0) {
    console.log(`ðŸŽ¨ Cargando ${section.imagePrompts.length} prompts de la sección ${sectionNumber} en panel lateral`);
    
    // Limpiar el panel antes de cargar nuevos prompts de una sección específica
    clearPromptsSidebar();
    
    // Usar la función estándar para añadir prompts
    addPromptsToSidebar(section.imagePrompts, sectionNumber);
    
  } else if (section.imageUrls && section.imageUrls.length > 0) {
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Sección ${sectionNumber} tiene ${section.imageUrls.length} URLs de imágenes generadas`);
    
    // Si tiene URLs pero no prompts, crear prompts genéricos
    const genericPrompts = section.imageUrls.map((url, index) => `Imagen ${index + 1} - URL: ${url}`);
    clearPromptsSidebar();
    addPromptsToSidebar(genericPrompts, sectionNumber);
    
  } else if (section.googleImagesMode) {
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Sección ${sectionNumber} configurada para Google Images automático`);
    
    // Para Google Images, mostrar un indicador
    const googleImageIndicator = [`Sección ${sectionNumber} configurada para usar Google Images automático`];
    clearPromptsSidebar();
    addPromptsToSidebar(googleImageIndicator, sectionNumber);
  }
  
  // Actualizar modo de imágenes si está activado
  if (section.googleImagesMode) {
    const useGoogleImagesCheckbox = document.getElementById('useGoogleImages');
    if (useGoogleImagesCheckbox) {
      useGoogleImagesCheckbox.checked = true;
    }
  }
  
  // Mostrar información sobre las imágenes
  if (section.imageUrls && section.imageUrls.length > 0) {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Mostrando información de imágenes generadas');
    
    // Mostrar carrusel de imágenes si existe la función
    if (typeof showImageCarousel === 'function') {
      showImageCarousel(section.imageUrls, sectionNumber);
    } else {
      // Mostrar carrusel básico
      const carouselContainer = document.getElementById('carousel-container');
      if (carouselContainer) {
        carouselContainer.style.display = 'block';
        const carouselTrack = document.getElementById('carouselTrack');
        const carouselTitle = document.getElementById('carousel-section-title');
        const totalImagesSpan = document.getElementById('total-images');
        const currentImageSpan = document.getElementById('current-image');
        
        if (carouselTitle) {
          carouselTitle.textContent = `Sección ${sectionNumber}`;
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
    
    showNotification(`ðŸ“¸ Sección ${sectionNumber} tiene ${section.imageUrls.length} imágenes generadas`, 'info');
  } else if (section.googleImagesMode) {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Modo Google Images activado para esta sección');
    showNotification(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ Sección ${sectionNumber} usa Google Images automático`, 'info');
  }
  
  // Cerrar modal
  closeSectionModal();
  
  // Actualizar estado de los botones según el progreso del proyecto
  updateProjectButtons(window.currentProject);
  
  showNotification(`âœ… Sección ${sectionNumber} cargada en editor`, 'success');
}

// Función para cerrar modal de sección
function closeSectionModal() {
  const modal = document.querySelector('.section-detail-modal');
  if (modal) {
    modal.closest('.modal').remove();
  }
}

// Exponer funciones globalmente
window.loadSectionDetails = loadSectionDetails;
window.closeSectionModal = closeSectionModal;

// Función para cambiar entre tabs del detalle de sección
function showSectionTab(event, tabId) {
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Cambiando a tab:', tabId);
  // Remover clase active de todos los tabs
  document.querySelectorAll('.detail-tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  // Activar el tab seleccionado
  event.target.closest('.detail-tab').classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

// Función para cargar una sección específica en el editor
function loadProjectSection(sectionNumber) {
  console.log('ðŸ“¥ Cargando sección en editor:', sectionNumber);
  
  const projectState = getCurrentProjectState();
  if (!projectState) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No hay proyecto activo');
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ No hay proyecto activo', 'error');
    return;
  }
  
  const section = projectState.completedSections.find(s => s.section === sectionNumber);
  if (!section) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Sección no encontrada:', sectionNumber);
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Sección no encontrada', 'error');
    return;
  }
  
  // Actualizar el número de sección actual
  const sectionInput = document.getElementById('sectionNumber');
  if (sectionInput) {
    sectionInput.value = sectionNumber;
  }
  
  // Cargar el script en el área de texto
  const scriptArea = document.getElementById('script');
  if (scriptArea && section.script) {
    scriptArea.value = section.script;
    // Ajustar altura del textarea
    scriptArea.style.height = 'auto';
    scriptArea.style.height = scriptArea.scrollHeight + 'px';
  }
  
  // Actualizar modo de imágenes
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
  
  showNotification(`âœ… Sección ${sectionNumber} cargada en editor`, 'success');
}

// Función para auto-redimensionar textareas
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

// Función para actualizar el título del capítulo
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
  
  // Ocultar si no hay título disponible
  chapterTitleContainer.style.display = 'none';
}

// Función para almacenar la estructura de capítulos cuando se recibe del servidor
function storeChapterStructure(chapterStructure) {
  globalChapterStructure = chapterStructure || [];
  console.log('ðŸ“š Estructura de capítulos almacenada:', globalChapterStructure.length, 'capítulos');
}

// Función para actualizar la información de tokens
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
    
    console.log('ðŸ“Š Información de tokens actualizada:', tokenUsage);
  } else {
    tokenContainer.style.display = 'none';
  }
}

// Exponer función globalmente
window.updateTokenUsage = updateTokenUsage;

// Exponer funciones globalmente
window.updateChapterTitle = updateChapterTitle;
window.storeChapterStructure = storeChapterStructure;

// =====================================
// FUNCIONES ADICIONALES PARA IMÃƒÆ’Ã‚ÂGENES DE BING
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
  console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Mostrando imagen en pantalla completa: ${caption}`);
  
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

// Función para refrescar una imagen específica
async function refreshBingImage(imageIndex, sectionNum) {
  console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Refrescando imagen ${imageIndex} de la sección ${sectionNum}`);
  
  // Verificar que tenemos keywords para esta imagen
  if (!currentImageKeywords || !currentImageKeywords[imageIndex]) {
    console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ No hay keywords disponibles para la imagen ${imageIndex}`);
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG - currentImageKeywords:`, currentImageKeywords);
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG - imageIndex:`, imageIndex);
    alert('No se pueden obtener nuevas keywords para esta imagen. Por favor, genera el contenido nuevamente.');
    return;
  }
  
  // Obtener el nombre de la carpeta actual del proyecto cargado
  let folderName;
  if (window.currentProject && window.currentProject.folderName) {
    folderName = window.currentProject.folderName;
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    const folderNameElement = document.getElementById('folderName');
    if (!folderNameElement) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se pudo obtener el nombre del proyecto');
      alert('Error: No se pudo obtener el nombre del proyecto');
      return;
    }
    folderName = folderNameElement.value.trim();
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Usando folderName del elemento HTML: ${folderName}`);
  }
  
  // Obtener las imágenes actuales del carrusel para mantener mapeo correcto
  const currentImages = [];
  const carouselSlides = document.querySelectorAll('.carousel-slide img');
  carouselSlides.forEach(img => {
    currentImages.push({
      url: img.src.split('?')[0], // Remover query params para obtener URL limpia
      alt: img.alt
    });
  });
  
  console.log(`ðŸŽ¯ Imágenes actuales detectadas:`, currentImages.map((img, i) => `${i}: ${img.url.split('/').pop()}`));
  console.log(`ðŸŽ¯ Refrescando imagen en posición visual ${imageIndex}: ${currentImages[imageIndex]?.url.split('/').pop()}`);
  
  try {
    // Mostrar indicador de carga en el botón
    const refreshButton = document.querySelector(`[onclick="refreshBingImage(${imageIndex}, ${sectionNum})"]`);
    if (refreshButton) {
      refreshButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      refreshButton.disabled = true;
    }
    
    // Hacer petición al backend para refrescar la imagen
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
        currentImages: currentImages // Enviar mapeo actual de imágenes
      })
    });
    
    if (!response.ok) {
      throw new Error(`Error del servidor: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`âœ… Nueva imagen descargada: ${result.newImage.filename}`);
      console.log(`ðŸŽ¯ Mapeo confirmado: posición visual ${imageIndex} â†’ ${result.newImage.filename}`);
      
      // Actualizar la imagen en el carrusel con efecto visual
      const currentSlideImg = document.querySelector('.carousel-slide:nth-child(' + (imageIndex + 1) + ') img');
      if (currentSlideImg) {
        // Añadir efecto de transición suave
        currentSlideImg.style.opacity = '0.3';
        currentSlideImg.style.transition = 'opacity 0.3s ease';
        
        // Crear nueva imagen para precargar
        const newImg = new Image();
        newImg.onload = function() {
          // Una vez cargada la nueva imagen, actualizar con timestamp para evitar cache
          currentSlideImg.src = result.newImage.url + '?t=' + Date.now();
          currentSlideImg.alt = `Nueva imagen ${imageIndex + 1} de la Sección ${sectionNum}`;
          
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
      
      // Mostrar notificación de éxito
      showNotification('âœ… Imagen renovada exitosamente', 'success');
      
    } else {
      throw new Error(result.error || 'Error desconocido');
    }
    
  } catch (error) {
    console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error refrescando imagen:`, error);
    showNotification(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error renovando imagen: ${error.message}`, 'error');
  } finally {
    // Restaurar el botón
    const refreshButton = document.querySelector(`[onclick="refreshBingImage(${imageIndex}, ${sectionNum})"]`);
    if (refreshButton) {
      refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i>';
      refreshButton.disabled = false;
    }
  }
}

// Función para refrescar una imagen con keyword personalizado
async function refreshBingImageWithCustomKeyword(imageIndex, sectionNum) {
  console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Refrescando imagen ${imageIndex} de la sección ${sectionNum} con keyword personalizado`);
  
  // Obtener el keyword del input field
  const keywordInput = document.getElementById(`keyword-${imageIndex}-${sectionNum}`);
  if (!keywordInput) {
    console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ No se encontró el input de keyword para imagen ${imageIndex}`);
    alert('Error: No se pudo obtener el término de búsqueda');
    return;
  }
  
  const customKeyword = keywordInput.value.trim();
  if (!customKeyword) {
    alert('Por favor, ingresa un término de búsqueda antes de refrescar la imagen');
    return;
  }
  
  // Obtener el nombre de la carpeta actual del proyecto cargado
  let folderName;
  if (window.currentProject && window.currentProject.folderName) {
    folderName = window.currentProject.folderName;
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    const folderNameElement = document.getElementById('folderName');
    if (!folderNameElement) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ No se pudo obtener el nombre del proyecto');
      alert('Error: No se pudo obtener el nombre del proyecto');
      return;
    }
    folderName = folderNameElement.value.trim();
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Usando folderName del elemento HTML: ${folderName}`);
  }
  
  // Obtener las imágenes actuales del carrusel para mantener mapeo correcto
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
  
  console.log(`ðŸŽ¯ Imágenes actuales detectadas:`, currentImages.map((img, i) => `${i}: ${img.filename}`));
  console.log(`ðŸŽ¯ Refrescando imagen en posición visual ${imageIndex}: ${currentImages[imageIndex]?.filename}`);
  
  try {
    // Mostrar indicador de carga en el botón
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
      console.log(`ðŸŽ¯ Mapeo confirmado: posición visual ${imageIndex} â†’ ${result.filename}`);
      
      // Actualizar la imagen en el carrusel
      const currentSlide = document.querySelectorAll('.carousel-slide')[imageIndex];
      if (currentSlide) {
        const img = currentSlide.querySelector('img');
        if (img) {
          // Agregar timestamp para evitar caché
          const timestamp = new Date().getTime();
          img.src = `${result.newImageUrl}?t=${timestamp}`;
          
          // Actualizar el keyword almacenado
          if (currentImageKeywords && currentImageKeywords[imageIndex]) {
            currentImageKeywords[imageIndex] = customKeyword;
            console.log(`ðŸŽ¯ Keyword actualizado: posición ${imageIndex} â†’ "${customKeyword}"`);
          }
        }
      }
      
      showNotification(`âœ… Imagen ${imageIndex + 1} renovada exitosamente con "${customKeyword}"`, 'success');
    } else {
      throw new Error(`Error del servidor: ${response.status}`);
    }
    
  } catch (error) {
    console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error refrescando imagen:`, error);
    showNotification(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error renovando imagen: ${error.message}`, 'error');
  } finally {
    // Restaurar el botón
    const refreshButton = document.querySelector(`[onclick="refreshBingImageWithCustomKeyword(${imageIndex}, ${sectionNum})"]`);
    if (refreshButton) {
      refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i>';
      refreshButton.disabled = false;
    }
  }
}

// Exponer la nueva función globalmente
window.refreshBingImage = refreshBingImage;
window.showBingImageFullscreen = showBingImageFullscreen;
window.closeBingImageModal = closeBingImageModal;

// ================================
// FUNCIONES PARA GENERACIÃ“N DE VIDEO
// ================================

// Función para verificar si se debe generar video automáticamente
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
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error consultando progreso de clips:', error);
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
    
    // Si el proceso general está completado y el clip no tiene status de error, marcar como generated
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
        ? `ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â ${progress.error}`
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
        ? `ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando clips: ${progress.error}`
        : 'ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando clips';
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
      title.textContent = section.name || `Sección ${section.sectionNumber}`;
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

  // Si el proceso está completado, asegurar que todas las cápsulas se marquen como generated
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
      // Forzar que todas las cápsulas se muestren como generated
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
      if (progressPayload.error && !/sesión no encontrada/i.test(progressPayload.error)) {
        renderClipProgress(progressPayload);
      }
      return;
    }

    const progress = progressPayload.progress || progressPayload;
    renderClipProgress(progress);

    if (progress && (progress.status === 'completed' || progress.status === 'failed')) {
      // Hacer una consulta final para asegurar que tengamos el estado más reciente
      const finalProgressPayload = await fetchClipProgressState(clipProgressUiState.sessionId);
      if (finalProgressPayload && finalProgressPayload.success !== false) {
        const finalProgress = finalProgressPayload.progress || finalProgressPayload;
        // Forzar status completed para asegurar que las cápsulas se marquen correctamente
        finalProgress.status = progress.status;
        renderClipProgress(finalProgress);
      }
      stopClipProgressTracking({
        keepVisible: true,
        finalStatus: progress.status,
        finalMessage: progress.status === 'failed'
          ? (progress.error ? `ÃƒÂ¢Ã‚ÂÃ…â€™ ${progress.error}` : 'ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando clips')
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
      <span>Sección ${sectionNumber}</span>
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
    console.warn('âš ï¸ Número de sección inválido para generar clip:', button?.dataset);
    return;
  }

  if (isGeneratingVideo) {
    showNotification('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Ya hay una generación en progreso. Espera a que termine antes de generar otro clip.', 'info');
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

    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Normalizando folderName: "${inputFolderName}" â†’ "${folderName}"`);
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
    name.textContent = `Sección ${sectionNumber}`;

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
      button.innerHTML = `<i class="fas fa-images"></i><span>Sección ${sectionNumber}</span>`;
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
      summary.textContent = `${totalSections} secciones Â· ${totalFilled}/${totalCapsules || 1} imágenes listas`;
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
        console.warn(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se pudo actualizar progreso de imágenes para sección ${sectionNumber}:`, error);
        return fallback;
      }
    }));

    if (sectionImageProgressState.updateToken !== updateToken) {
      return;
    }

    renderSectionImageProgressColumns(resolvedStats);
  } catch (error) {
    console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Error refrescando progreso de imágenes:', error);
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
      console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Error actualizando barras de imágenes durante el polling:', error);
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
      console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Error actualizando barras de progreso de imágenes:', error);
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
    console.warn('âš ï¸ Número de sección inválido para generar imágenes:', button?.dataset);
    return;
  }

  if (isGeneratingImages) {
    showNotification('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Ya hay una generación de imágenes en progreso. Espera a que termine antes de iniciar otra.', 'info');
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

    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Normalizando folderName: "${inputFolderName}" â†’ "${folderName}"`);
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

    // Obtener imageCount del selector o proyecto o configuración por defecto
    let imageCount = parseInt(document.getElementById("imagesSelect")?.value) || projectData?.imageCount || 10;

    // Actualizar el proyecto con el nuevo imageCount si cambió
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

    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Generando prompts faltantes para proyecto: ${folderName}`);

    // Obtener configuraciones para imágenes
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
    showNotification(`âœ… Prompts generados para ${data.data.generatedPrompts.length} sección(es)`, 'success');

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
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando prompts:', error);
    throw error;
  }
}

async function handleProjectSectionImageButtonClick(event, projectKey, sectionNumber) {
  event.preventDefault();
  const btn = event.currentTarget;

  if (!Number.isInteger(sectionNumber) || sectionNumber <= 0) {
    console.warn('âš ï¸ Número de sección inválido para generar imágenes:', sectionNumber);
    return;
  }

  if (isGeneratingImages) {
    showNotification('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Ya hay una generación de imágenes en progreso. Espera a que termine antes de iniciar otra.', 'info');
    return;
  }

  const projectData = projectDataMap.get(projectKey) || window.currentProject;
  if (!projectData) {
    showError('No se encontró la información del proyecto');
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

    // Verificar si la sección ya tiene imágenes
    const hasImages = await checkIfSectionHasImages(projectKey, sectionNumber, imageCount);
    if (hasImages) {
      showNotification(`âœ… La sección ${sectionNumber} ya tiene suficientes imágenes generadas (${imageCount}).`, 'success');
      return;
    }

    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Generando ${imageCount} imágenes para sección ${sectionNumber} del proyecto ${projectKey} usando APIs gratuitas de Google...`);

    await generateMissingImagesForSection({
      folderName: projectKey,
      sectionNumber,
      projectData,
      selectedImageModel,
      imageCount
    });

    showNotification(`âœ… Imágenes generadas exitosamente para la sección ${sectionNumber}.`, 'success');
  } catch (error) {
    console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando imágenes para sección ${sectionNumber}:`, error);
    showError(`Error generando imágenes: ${error.message}`);
  } finally {
    isGeneratingImages = false;
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-images"></i><span>Sección ${sectionNumber}</span>`;
  }
}

// Función para mostrar el botón de generación manual de video
function showVideoGenerationButton() {
  // Solo mostrar el contenedor de video si hay un solo proyecto (no múltiples proyectos paralelos)
  const hasMultipleProjects = projectProgressContainers.size > 1;

  if (!hasMultipleProjects) {
    // Mostrar el contenedor principal de generación de video solo para proyectos únicos
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

  // Mostrar botón de regenerar audios solo si Applio está activado
  const regenerateAudioBtn = document.getElementById('regenerateApplioAudiosBtn');
  const applioCheckbox = document.getElementById('autoGenerateApplioAudio');
  
  // Mostrar el botón si Applio está activado O si hay un proyecto cargado (para permitir generar audios faltantes)
  if (regenerateAudioBtn && ((applioCheckbox && applioCheckbox.checked) || window.currentProject)) {
    regenerateAudioBtn.style.display = 'flex';
    console.log('ðŸŽ¤ Botón de generar audios faltantes mostrado');
  } else {
    if (regenerateAudioBtn) {
      regenerateAudioBtn.style.display = 'none';
    }
  }
  
  // Mostrar botón de regenerar guiones si hay un proyecto cargado
  const regenerateScriptsBtn = document.getElementById('regenerateMissingScriptsBtn');
  if (regenerateScriptsBtn && window.currentProject) {
    regenerateScriptsBtn.style.display = 'inline-flex';
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Botón de regenerar guiones vacíos mostrado');
  } else {
    if (regenerateScriptsBtn) {
      regenerateScriptsBtn.style.display = 'none';
    }
  }
  
  updateYouTubeMetadataButtonState();
  
  // Actualizar botones de clips por sección cuando haya información disponible
  updateSectionClipButtons();
  updateSectionImageButtons();
  
  console.log('ðŸ“¹ Botones de generación de video mostrados');
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

// Función principal para generar video automáticamente
async function generateVideoAutomatically() {
  // No generar video automáticamente si hay múltiples proyectos en progreso
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (hasMultipleProjects) {
    console.log('ðŸ”„ Múltiples proyectos en progreso - omitiendo generación automática de video');
    return;
  }
  
  if (!shouldGenerateVideoAutomatically()) {
    console.log('ðŸ“¹ Generación automática de video desactivada');
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
      console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No hay nombre de carpeta para generar video');
      return;
    }
    // Normalizar el nombre como lo hace el backend
    folderName = inputFolderName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ Normalizando folderName: "${inputFolderName}" â†’ "${folderName}"`);
  }
  
  if (!allSections || allSections.length === 0) {
    console.log("ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No hay secciones generadas para crear los clips");
    return;
  }
  
  console.log('ðŸŽ¬ Iniciando generación automática de clips separados...');
  
  try {
    // âœ… USAR LA MISMA FUNCIÃ“N QUE EL BOTÃ“N generateSeparateVideosBtn
    await generateSeparateVideos(folderName);
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error en generación automática de clips separados:', error);
    showError(`Error generando clips separados automáticamente: ${error.message}`);
  }
}

// Función principal para generar video del proyecto
async function generateProjectVideo(folderName, isAutomatic = false) {
  if (isGeneratingVideo) {
    console.log('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Ya se está generando un video');
    return;
  }
  
  isGeneratingVideo = true;
  currentVideoSession = Date.now().toString();
  
  try {
    // Obtener configuración de video
    const animationType = document.getElementById('videoAnimation')?.value || 'zoom-out';
    const quality = document.getElementById('videoQuality')?.value || 'standard';
    
    console.log(`ðŸŽ¬ Generando video para proyecto: ${folderName}`);
    console.log(`ðŸŽ¬ Configuración: animación=${animationType}, calidad=${quality}`);

    // Mostrar progreso en la parte superior del panel
    showAutomaticVideoProgress();
    updateAutomaticVideoProgress(0, 'Iniciando generación de video...');
    
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
      console.log('ðŸŽ¬ Video blob creado, tamaño:', blob.size);
      
      // Crear enlace de descarga
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folderName}_video_completo.mp4`;
      a.style.display = 'none';
      document.body.appendChild(a);
      
      // Intentar descarga automática
      try {
        a.click();
        console.log('ðŸŽ¬ Descarga de video iniciada automáticamente');
        
        showAutomaticVideoComplete();
        showSuccess('ðŸŽ¬ ¡Video generado y descargado exitosamente!');
      } catch (clickError) {
        console.log('ðŸŽ¬ Click automático falló, mostrando enlace manual');
        a.style.display = 'block';
        a.textContent = 'Hacer clic aquí para descargar el video';
        a.style.color = '#00ff7f';
        a.style.textDecoration = 'underline';
        a.style.fontSize = '1.1rem';
        a.style.padding = '10px';
        
        showAutomaticVideoComplete();
      }
      
      // Limpiar después de un tiempo
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
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando video:', error);
    
    showError(`Error generando video: ${error.message}`);
  } finally {
    isGeneratingVideo = false;
    currentVideoSession = null;
  }
}

// Función para generar video simple (sin animaciones)
async function generateSimpleProjectVideo(folderName) {
  if (isGeneratingVideo) {
    console.log('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Ya se está generando un video');
    return;
  }

  isGeneratingVideo = true;
  const button = document.getElementById('generateSimpleVideoBtn');
  
  try {
    // Deshabilitar botón y mostrar estado de carga
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando Video Simple...</span>';
    
    console.log('ðŸŽ¬ Iniciando generación de video simple para proyecto:', folderName);
    
    const response = await fetch('/generate-simple-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        folderName: folderName
        // No enviamos duration porque se calcula automáticamente basado en audio
      }),
    });

    if (response.ok) {
      // El servidor debería enviar el archivo para descarga automática
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

      showSuccess('¡Video simple generado y descargado exitosamente!');
    } else {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Error interno del servidor');
    }

  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando video simple:', error);
    showError(`Error generando video simple: ${error.message}`);
  } finally {
    // Restaurar botón
    isGeneratingVideo = false;
    button.disabled = false;
    button.innerHTML = '<i class="fas fa-images"></i><span>Video Simple (Sin Animación)</span>';
  }
}

// Función para generar clips separados por sección
async function generateSeparateVideos(folderName, options = {}) {
  const { sectionNumber = null, buttonElement = null } = options;
  const progressSessionId = options.progressSessionId || `clip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  if (isGeneratingVideo) {
    console.log('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Ya se está generando un video');
    showNotification('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Ya hay una generación de video en curso. Espera a que finalice para iniciar otra.', 'info');
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
      button.innerHTML = `<i class="fas fa-spinner fa-spin"></i><span>Sección ${sectionNumber}...</span>`;
    } else {
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando Clips Separados...</span>';
    }
    if (isSectionButton) {
      button.classList.add('section-clip-btn--generating');
    }
  }

  startClipProgressTracking(progressSessionId);

  try {
    console.log('ðŸŽ¬ Iniciando generación de clips separados para proyecto:', folderName, sectionNumber ? `â†’ Sección ${sectionNumber}` : '' );

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
      const infoMessage = result.message || 'No se generaron clips para la selección solicitada.';
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
      successMessage = `¡${generatedCount} ${clipWord} de la sección ${sectionNumber} generado${generatedCount === 1 ? '' : 's'} exitosamente!`;
      if (skippedCount > 0) {
        successMessage += ` (${skippedCount} clip${skippedCount === 1 ? '' : 's'} ya existía${skippedCount === 1 ? '' : 'n'} y se omitieron)`;
      }
    } else if (requestedSections.length === 1) {
      successMessage = `¡${generatedCount} ${clipWord} de la sección ${requestedSections[0]} generado${generatedCount === 1 ? '' : 's'} exitosamente!`;
      if (skippedCount > 0) {
        successMessage += ` (${skippedCount} clip${skippedCount === 1 ? '' : 's'} ya existía${skippedCount === 1 ? '' : 'n'} y se omitieron)`;
      }
    } else if (requestedSections.length > 1) {
      const baseMessage = result.message || `¡${generatedCount} ${clipWord} generados para las secciones ${requestedSections.join(', ')}!`;
      successMessage = skippedCount > 0
        ? `${baseMessage} (${skippedCount} clip${skippedCount === 1 ? '' : 's'} existente${skippedCount === 1 ? '' : 's'} omitido${skippedCount === 1 ? '' : 's'})`
        : baseMessage;
    } else {
      const baseMessage = result.message || `¡${generatedCount} ${clipWord} generados exitosamente en sus respectivas carpetas de sección!`;
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
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando clips separados:', error);
    showError(`Error generando clips separados: ${error.message}`);
    stopClipProgressTracking({
      keepVisible: true,
      finalStatus: 'failed',
      finalMessage: `ÃƒÂ¢Ã‚ÂÃ…â€™ ${error.message}`
    });
  } finally {
    // Restaurar botón
    isGeneratingVideo = false;
    if (button) {
      button.disabled = false;
      if (button.dataset.originalContent) {
        button.innerHTML = button.dataset.originalContent;
        delete button.dataset.originalContent;
      } else if (sectionNumber !== null && Number.isInteger(Number(sectionNumber))) {
        button.innerHTML = `<i class="fas fa-film"></i><span>Sección ${sectionNumber}</span>`;
      } else {
        button.innerHTML = '<i class="fas fa-video"></i><span>Clips Separados por Sección</span>';
      }
      if (isSectionButton) {
        button.classList.remove('section-clip-btn--generating');
      }
    }

    updateSectionClipButtons();
    updateSectionImageButtons();
  }
}

// Función para mostrar progreso de video automático
function showAutomaticVideoProgress() {
  // No mostrar progreso si hay múltiples proyectos en progreso
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (hasMultipleProjects) {
    console.log('ðŸ”„ Múltiples proyectos en progreso - omitiendo progreso de video automático');
    return;
  }
  
  const automaticMessage = document.createElement('div');
  automaticMessage.id = 'automaticVideoProgress';
  automaticMessage.className = 'auto-completion-message';
  automaticMessage.innerHTML = `
    <div class="success-content">
      <i class="fas fa-video"></i>
      <h3>Generando Video Automáticamente</h3>
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

// Función para actualizar progreso de video automático
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

// Función para mostrar completación de video automático
function showAutomaticVideoComplete() {
  // No mostrar mensaje si hay múltiples proyectos en progreso
  const hasMultipleProjects = projectProgressContainers.size > 1;
  if (hasMultipleProjects) {
    console.log('ðŸ”„ Múltiples proyectos en progreso - omitiendo mensaje de video completado');
    return;
  }
  
  const automaticProgress = document.getElementById('automaticVideoProgress');
  if (automaticProgress) {
    automaticProgress.innerHTML = `
      <div class="success-content">
        <i class="fas fa-check-circle"></i>
        <h3>¡Video Generado Automáticamente!</h3>
        <p>El video compilado se ha descargado exitosamente.</p>
      </div>
    `;
    
    // Ocultar después de unos segundos
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
  const useQwen = document.getElementById('autoGenerateQwenAudio')?.checked || false;
  const useChatterbox = document.getElementById('autoGenerateChatterboxAudio')?.checked || false;

  if (!useGoogleTTS && !useApplio && !useQwen && !useChatterbox) {
    showError('Activa al menos una opción de audio (Google, Applio, Qwen o Chatterbox) para continuar');
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

  // Configuración de estilo y rangos
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

  // Mostrar progreso y empezar polling mientras se generan audios
  const totalSec = window.currentProject?.completedSections?.length || 5;
  if (!projectProgressContainers.has(folderName)) {
    createProjectProgressContainer(folderName, totalSec, false, true, false);
  }
  startProgressPolling(folderName);

  try {
    if (useGoogleTTS) {
      console.log('ðŸŽ¤ Verificando audios faltantes para Google TTS...');
      showNotification('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Verificando audios de Google...', 'info');

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
        showNotification('âœ… Todos los audios de Google ya existían', 'info');
      }

      console.log('âœ… Resultado Google TTS:', data.message);
    }

    if (useApplio) {
      console.log('ðŸŽ¤ Verificando audios faltantes para Applio...');
      showNotification('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Verificando audios de Applio...', 'info');

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
        showNotification('âœ… Todos los audios de Applio ya existían', 'info');
      }

      console.log('âœ… Resultado Applio:', data.message);
    }

    if (useQwen) {
      console.log('🤖 Verificando audios faltantes para Qwen...');
      showNotification('🤖 Verificando audios de Qwen...', 'info');

      const selectedQwenVoice = document.getElementById('qwenVoiceSelect')?.value || '';

      const response = await fetch('/generate-missing-applio-audios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName,
          generateQwenAudio: true,
          qwenVoice: selectedQwenVoice,
          totalSections: window.currentProject.completedSections.length,
          scriptStyle,
          customStyleInstructions,
          wordsMin,
          wordsMax
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error verificando/generando audios con Qwen');
      }

      summary.applio.generated += data.data?.generatedCount || 0;

      if (data.data?.generatedCount > 0) {
        showNotification(`✅ ${data.data.generatedCount} audios Qwen generados`, 'success');
      } else {
        showNotification('✅ Todos los audios de Qwen ya existían', 'info');
      }
    }

    if (useChatterbox) {
      console.log('🗣️ Verificando audios faltantes para Chatterbox TTS...');
      showNotification('🗣️ Verificando audios de Chatterbox...', 'info');

      const chatterboxVoice = document.getElementById('chatterboxVoiceSelect')?.value || '';
      const chatterboxLanguage = document.getElementById('chatterboxLanguage')?.value || 'es';
      const chatterboxExaggeration = parseFloat(document.getElementById('chatterboxExaggeration')?.value ?? 0.5);
      const chatterboxCfgWeight = parseFloat(document.getElementById('chatterboxCfgWeight')?.value ?? 0.5);
      const chatterboxTemperature = parseFloat(document.getElementById('chatterboxTemperature')?.value ?? 0.8);

      const response = await fetch('/generate-missing-applio-audios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName,
          generateChatterboxAudio: true,
          chatterboxVoice,
          chatterboxLanguage,
          chatterboxExaggeration,
          chatterboxCfgWeight,
          chatterboxTemperature,
          totalSections: window.currentProject.completedSections.length,
          scriptStyle,
          customStyleInstructions,
          wordsMin,
          wordsMax
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error verificando/generando audios con Chatterbox');
      }

      summary.applio.generated += data.data?.generatedCount || 0;

      if (data.data?.generatedCount > 0) {
        showNotification(`✅ ${data.data.generatedCount} audios Chatterbox generados`, 'success');
      } else {
        showNotification('✅ Todos los audios de Chatterbox ya existían', 'info');
      }
    }

    const totalGenerated = summary.google.generated + summary.applio.generated;
    const methodsUsed = [
      useGoogleTTS ? `Google (${summary.google.generated})` : null,
      useApplio ? `Applio (${summary.applio.generated})` : null,
      useQwen ? 'Qwen' : null,
      useChatterbox ? 'Chatterbox' : null
    ].filter(Boolean).join(' + ');

    showNotification(`ðŸŽ‰ Regeneración completada (${methodsUsed || 'Sin métodos activos'}). Total generados: ${totalGenerated}`, 'success');

  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error verificando/generando audios:', error);
    showError(`Error verificando/generando audios: ${error.message}`);
  } finally {
    stopProgressPolling(folderName);
    if (regenerateBtn) {
      regenerateBtn.disabled = false;
      regenerateBtn.innerHTML = `
        <i class="fas fa-microphone-alt"></i>
        <span>Generar Audios Faltantes</span>
      `;
    }
  }
}

// Función para regenerar audios faltantes para un proyecto específico
async function regenerateAllAudiosForProject(folderName) {
  const useGoogleTTS = document.getElementById('autoGenerateAudio')?.checked || false;
  const useApplio = document.getElementById('autoGenerateApplioAudio')?.checked || false;
  const useQwen = document.getElementById('autoGenerateQwenAudio')?.checked || false;
  const useChatterbox = document.getElementById('autoGenerateChatterboxAudio')?.checked || false;

  if (!useGoogleTTS && !useApplio && !useQwen && !useChatterbox) {
    console.log('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No hay opciones de audio activas para verificar en proyecto:', folderName);
    return;
  }

  if (!folderName) {
    throw new Error('No se ha especificado el nombre del proyecto');
  }

  // Configuración de estilo y rangos
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

  // Mostrar progreso y empezar polling mientras se generan audios
  startProgressPolling(folderName);

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
        console.log(`âœ… Todos los audios de Google ya existían en ${folderName}`);
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
          totalSections: 5, // Asumir 5 secciones por defecto, el backend lo calculará
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
        console.log(`âœ… Todos los audios de Applio ya existían en ${folderName}`);
      }
    }

    if (useQwen) {
      console.log(`🤖 Verificando audios faltantes para Qwen en proyecto: ${folderName}`);

      const selectedQwenVoice = document.getElementById('qwenVoiceSelect')?.value || '';

      const response = await fetch('/generate-missing-applio-audios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName,
          generateQwenAudio: true,
          qwenVoice: selectedQwenVoice,
          totalSections: 5,
          scriptStyle,
          customStyleInstructions,
          wordsMin,
          wordsMax
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error verificando/generando audios con Qwen');
      }

      summary.applio.generated += data.data?.generatedCount || 0;

      if (data.data?.generatedCount > 0) {
        console.log(`✅ ${data.data.generatedCount} audios Qwen generados para ${folderName}`);
      } else {
        console.log(`✅ Todos los audios de Qwen ya existían en ${folderName}`);
      }
    }

    const totalGenerated = summary.google.generated + summary.applio.generated;
    console.log(`âœ… Verificación de audios completada para ${folderName}. Total generados: ${totalGenerated}`);
  } catch (error) {
    throw error;
  } finally {
    stopProgressPolling(folderName);
  }

}

// Función para regenerar guiones faltantes
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
    
    // Obtener configuración de estilo actual
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

    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Verificando guiones faltantes...');
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Configuración:', {
      proyecto: folderName,
      secciones: window.currentProject.completedSections.length,
      estilo: scriptStyle
    });
    
    // Deshabilitar botón durante el proceso
    const regenerateBtn = document.getElementById('regenerateMissingScriptsBtn');
    if (regenerateBtn) {
      regenerateBtn.disabled = true;
      regenerateBtn.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        <span>Verificando guiones...</span>
      `;
    }
    
    // Mostrar progreso
    showNotification('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Verificando qué guiones están vacíos...', 'info');
    
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
      console.log('âœ… Verificación y generación de guiones completada:', data.message);
      
      if (data.data.generatedCount > 0) {
        showNotification(`âœ… ${data.data.generatedCount} guiones faltantes generados exitosamente`, 'success');
        
        // Actualizar el proyecto cargado para reflejar los cambios
        if (window.currentProject) {
          // Recargar el proyecto para obtener los guiones actualizados
          setTimeout(() => {
            showNotification('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Recargando proyecto para mostrar los cambios...', 'info');
            // Aquí podrías recargar el proyecto actual si tienes esa funcionalidad
          }, 2000);
        }
      } else {
        showNotification('âœ… Todos los guiones ya tienen contenido, no se generó ninguno nuevo', 'info');
      }
      
      // Mostrar detalles si hay información adicional
      if (data.data.missingScripts && data.data.missingScripts.length > 0) {
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Secciones que tenían guiones vacíos:', data.data.missingScripts);
      }
      
    } else {
      throw new Error(data.error || 'Error desconocido regenerando guiones');
    }
    
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error regenerando guiones:', error);
    showError(`Error regenerando guiones: ${error.message}`);
  } finally {
    // Restaurar botón
    const regenerateBtn = document.getElementById('regenerateMissingScriptsBtn');
    if (regenerateBtn) {
      regenerateBtn.disabled = false;
      regenerateBtn.innerHTML = `
        <i class="fas fa-file-alt"></i>
        <span>Regenerar Guiones Vacíos</span>
      `;
    }
  }
}

// Función para regenerar guiones faltantes para un proyecto específico
async function regenerateMissingScriptsForProject(folderName) {
  try {
    if (!folderName) {
      throw new Error('No se ha especificado el nombre del proyecto');
    }
    
    // Obtener configuración de estilo actual
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

    console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Verificando guiones faltantes para proyecto: ${folderName}`);
    
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
      console.log(`âœ… Verificación y generación de guiones completada para ${folderName}:`, data.message);
      
      if (data.data.generatedCount > 0) {
        console.log(`âœ… ${data.data.generatedCount} guiones faltantes generados para ${folderName}`);
      } else {
        console.log(`âœ… Todos los guiones ya tienen contenido en ${folderName}`);
      }
    } else {
      throw new Error(data.error || 'Error desconocido regenerando guiones');
    }
    
  } catch (error) {
    console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error regenerando guiones para proyecto ${folderName}:`, error);
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

        console.log('ÃƒÂ¢Ã…¡Ã¢â€žÂ¢ÃƒÂ¯Ã‚Â¸Ã‚Â Defaults ComfyUI actualizados desde el servidor:', comfyUIDefaults);
      } else {
        console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No se pudo cargar defaults de ComfyUI desde el servidor:', data?.error || data);
      }
    } catch (error) {
      console.warn('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Error cargando defaults de ComfyUI, usando valores locales:', error);
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

// Función para generar imágenes faltantes
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

    // Obtener imageCount del selector o proyecto o configuración por defecto
    let imageCount = parseInt(document.getElementById("imagesSelect")?.value) || projectData?.imageCount || 10;

    // Actualizar el proyecto con el nuevo imageCount si cambió
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

    // Si no se especifica sectionNumber, verificar qué secciones necesitan imágenes
    if (sectionNumber === null) {
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Verificando qué secciones necesitan imágenes...');

      // Obtener todas las secciones completadas
      const completedSections = projectData.completedSections || [];
      const sectionsNeedingImages = [];

      for (let i = 0; i < completedSections.length; i++) {
        const section = completedSections[i];
        if (section && section.script) {
          // Verificar si esta sección tiene imágenes generadas
          const sectionFolder = `${folderName}/seccion_${i + 1}`;
          const hasImages = await checkIfSectionHasImages(folderName, i + 1, imageCount);

          if (!hasImages) {
            sectionsNeedingImages.push(i + 1);
            console.log(`ðŸ“‹ Sección ${i + 1} necesita imágenes (${imageCount} requeridas)`);
          } else {
            console.log(`âœ… Sección ${i + 1} ya tiene suficientes imágenes (${imageCount})`);
          }
        }
      }

      if (sectionsNeedingImages.length === 0) {
        showNotification('âœ… Todas las secciones ya tienen imágenes generadas.', 'success');
        return;
      }

      console.log(`ðŸŽ¯ Secciones que necesitan imágenes: ${sectionsNeedingImages.join(', ')}`);

      // Generar imágenes para todas las secciones en paralelo (máximo 10 concurrentes)
      // Solo usar APIs de Google gratis
      console.log('ðŸŽ¯ Generando imágenes en paralelo (máximo 10 concurrentes) usando solo APIs de Google gratis...');
      
      const imageGenerationPromises = [];
      const maxConcurrent = 10;
      let completedImages = 0;
      const totalImagesToGenerate = sectionsNeedingImages.length * imageCount;
      
      // Variables para tracking de resultados
      let successCount = 0;
      let errorCount = 0;
      const failedSections = [];
      
      // Obtener configuraciones para imágenes
      const imageInstructions = document.getElementById('promptModifier')?.value || '';
      const aspectRatio = document.getElementById('aspectRatioSelect')?.value || '9:16';
      
      // Obtener APIs de Google disponibles
      const selectedGoogleApis = getSelectedGoogleApis();
      
      // Función para procesar una sección
      const processSection = async (sectionNum) => {
        try {
          console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Generando ${imageCount} imágenes para sección ${sectionNum}...`);
          
          // Llamar al backend para generar imágenes de esta sección
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
            throw new Error(errorData?.error || `Error en sección ${sectionNum}`);
          }
          
          const data = await response.json();
          if (!data.success) {
            throw new Error(data.error || `Error desconocido en sección ${sectionNum}`);
          }
          
          console.log(`âœ… Imágenes generadas exitosamente para sección ${sectionNum}`);
          return { sectionNum, success: true };
        } catch (error) {
          console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Error en sección ${sectionNum}:`, error);
          return { sectionNum, success: false, error: error.message };
        }
      };
      
      // Procesar secciones en lotes de máximo 5 concurrentes
      for (let i = 0; i < sectionsNeedingImages.length; i += maxConcurrent) {
        const batch = sectionsNeedingImages.slice(i, i + maxConcurrent);
        console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Procesando lote ${Math.floor(i/maxConcurrent) + 1}: secciones ${batch.join(', ')}`);
        
        const batchPromises = batch.map(sectionNum => processSection(sectionNum));
        const batchResults = await Promise.all(batchPromises);
        
        // Procesar resultados del lote
        batchResults.forEach(result => {
          if (result.success) {
            successCount++;
          } else {
            errorCount++;
            failedSections.push(result.sectionNum);
            showNotification(`ÃƒÂ¢Ã‚ÂÃ…â€™ Sección ${result.sectionNum}: ${result.error}`, 'error');
          }
        });
        
        // Pequeña pausa entre lotes
        if (i + maxConcurrent < sectionsNeedingImages.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Mostrar resultado final
      if (successCount > 0) {
        const message = errorCount > 0
          ? `âœ… Se generaron imágenes para ${successCount} secciones. ${errorCount} secciones fallaron: ${failedSections.join(', ')}.`
          : `âœ… Se generaron imágenes exitosamente para todas las ${successCount} secciones que las necesitaban.`;
        showSuccess(message);
      } else {
        showError(`ÃƒÂ¢Ã‚ÂÃ…â€™ No se pudieron generar imágenes para ninguna sección. Secciones fallidas: ${failedSections.join(', ')}`);
      }

      return;
    }

    // Código original para una sección específica continúa aquí...
    // Obtener configuraciones para imágenes
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
        showError('No se pudieron cargar las APIs de Google. Intenta recargar la página.');
        return;
      }

      selectedGoogleApis = getSelectedGoogleApis();
      if (!selectedGoogleApis.length) {
        showError('Selecciona al menos una API de Google disponible antes de generar imágenes.');
        return;
      }
    } else {
      console.log('ðŸŽ¯ Modo Comfy directo activado: se omitirán las APIs de Google para esta ejecución.');
    }
    
    // Obtener configuraciones de ComfyUI si está habilitado
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
    
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Iniciando generación de imágenes faltantes...');
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Configuración:', {
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
      showNotification('ðŸŽ¨ Modo Comfy directo: las imágenes se generarán de una en una usando ComfyUI.', 'info');
    } else if (!allowComfyFallback) {
      showNotification('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Se intentará generar imágenes solo con las APIs. Si fallan por cuota, se cambiará automáticamente a ComfyUI.', 'info');
    }
    
    // Deshabilitar botón y mostrar progreso
    const generateBtn = document.getElementById('generateMissingImagesBtn');
    const cancelBtn = document.getElementById('cancelMissingImagesBtn');
    if (generateBtn) {
      generateBtn.disabled = true;
      generateBtn.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        <span>Generando Imágenes...</span>
      `;
    }
    if (cancelBtn) {
      cancelBtn.style.display = 'inline-flex';
      cancelBtn.disabled = false;
      cancelBtn.innerHTML = `
        <i class="fas fa-stop-circle"></i>
        <span>Detener Generación</span>
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

    // PRIMERA INTENTO: Con la configuración actual
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
      
      console.log('ðŸš¨ Detectado error de cuota en APIs de Google. Cambiando automáticamente a ComfyUI...');
      showNotification('ðŸš¨ Cuota de APIs gratuitas agotada. Cambiando automáticamente a ComfyUI (IA Local)...', 'warning');
      
      // Cambiar configuración para usar ComfyUI
      useLocalAI = true;
      comfyOnlyMode = true;
      allowComfyFallback = true;
      selectedGoogleApis = []; // No usar APIs de Google
      
      // Reintentar con ComfyUI
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Reintentando con ComfyUI...');
      
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
      throw new Error(data?.error || data?.message || 'Error generando imágenes');
    }

    if (data.cancelled) {
      const cancelPrefix = sectionNumber ? `Sección ${sectionNumber}` : 'Proceso completo';
      showNotification(`ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬ÂÃƒÂ¯Ã‚Â¸Ã‚Â ${cancelPrefix}: ${data.message || 'La generación de imágenes fue cancelada.'}`, 'info');
      console.log('ðŸ›‘ Generación cancelada por el usuario:', data);
      return;
    }

    if (data.success) {
      const successPrefix = sectionNumber ? `Sección ${sectionNumber}` : 'Proceso completo';
      showSuccess(`âœ… ${successPrefix}: ${data.message}`);
      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Resultados:', data.data);
      
      // Mostrar detalles si hay información adicional
      if (data.data.generatedPrompts && data.data.generatedPrompts.length > 0) {
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Prompts generados para secciones:', data.data.generatedPrompts);
      }
      
      if (data.data.generatedImages && data.data.generatedImages.length > 0) {
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€œÃ‚Â¼ÃƒÂ¯Ã‚Â¸Ã‚Â Imágenes generadas para secciones:', data.data.generatedImages);
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
      throw new Error(data.error || 'Error desconocido generando imágenes');
    }
    
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando imágenes:', error);
    if (error?.code === 'CANCELLED_BY_USER' || error?.message?.toLowerCase().includes('cancelado')) {
      showNotification(`ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬ÂÃƒÂ¯Ã‚Â¸Ã‚Â ${error.message}`, 'info');
    } else {
      showError(`Error generando imágenes: ${error.message}`);
    }
  } finally {
    isGeneratingImages = false;
    isCancellingImages = false;
    stopSectionImageProgressPolling();
    updateSectionImageButtons(projectOverride || window.currentProject);

    // Restaurar botón
    const generateBtn = document.getElementById('generateMissingImagesBtn');
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.innerHTML = `
        <i class="fas fa-image"></i>
        <span>Generar Imágenes Faltantes</span>
      `;
    }
    const cancelBtn = document.getElementById('cancelMissingImagesBtn');
    if (cancelBtn) {
      cancelBtn.style.display = 'none';
      cancelBtn.disabled = false;
      cancelBtn.innerHTML = `
        <i class="fas fa-stop-circle"></i>
        <span>Detener Generación</span>
      `;
    }
    if (buttonElement) {
      buttonElement.disabled = false;
      if (originalButtonHtml !== null) {
        buttonElement.innerHTML = originalButtonHtml;
      } else {
        buttonElement.innerHTML = `
          <i class="fas fa-images"></i>
          <span>Sección ${sectionNumber || ''}</span>
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
    showNotification('ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¹ÃƒÂ¯Ã‚Â¸Ã‚Â No hay una generación de imágenes en curso.', 'info');
    return;
  }

  if (isCancellingImages) {
    showNotification('ÃƒÂ¢Ã‚ÂÃ‚Â³ Ya se solicitó la cancelación. Espera un momento.', 'info');
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
      showNotification(data.message || 'Cancelación solicitada. El proceso se detendrá en breve.', 'info');
    } else {
      const errorMessage = data?.message || data?.error || 'No se pudo cancelar la generación de imágenes.';
      showError(errorMessage);
    }
  } catch (error) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error cancelando la generación de imágenes:', error);
    showError(`Error cancelando la generación de imágenes: ${error.message}`);
  } finally {
    isCancellingImages = false;
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.innerHTML = `
        <i class="fas fa-stop-circle"></i>
        <span>Detener Generación</span>
      `;
    }
  }
}

// Función auxiliar para verificar si una sección ya tiene imágenes generadas
async function checkIfSectionHasImages(folderName, sectionNumber, expectedCount = 1) {
  try {
    const response = await fetch(`/api/check-section-images?folderName=${encodeURIComponent(folderName)}&sectionNumber=${sectionNumber}`);
    if (response.ok) {
      const data = await response.json();
      return (data.imageCount || 0) >= expectedCount;
    }
    return false;
  } catch (error) {
    console.warn(`ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Error verificando imágenes para sección ${sectionNumber}:`, error);
    return false;
  }
}

// Función auxiliar para generar imágenes para una sección específica
async function generateMissingImagesForSection(options) {
  const { folderName, sectionNumber, projectData, selectedImageModel, imageCount: overrideImageCount } = options;

  const pollingProject = projectData || window.currentProject || null;
  startSectionImageProgressPolling(pollingProject);

  try {
    // Obtener configuraciones para imágenes
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

    // Obtener configuraciones de ComfyUI si está habilitado
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

    // PRIMERA INTENTO: Con la configuración actual
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

      console.log(`ðŸš¨ Sección ${sectionNumber} - Error detectado (${data.error}). Cambiando automáticamente a ComfyUI...`);

      // Cambiar configuración para usar ComfyUI
      useLocalAI = true;
      comfyOnlyMode = true;
      allowComfyFallback = true;
      selectedGoogleApis = []; // No usar APIs de Google

      // Reintentar con ComfyUI
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Sección ${sectionNumber} - Reintentando con ComfyUI...`);

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
      throw new Error(data?.error || data?.message || 'Error generando imágenes');
    }

    if (data.cancelled) {
      throw new Error(`Sección ${sectionNumber}: ${data.message || 'La generación fue cancelada.'}`);
    }

    if (!data.success) {
      throw new Error(data.error || 'Error desconocido generando imágenes');
    }

    return data;
  } finally {
    stopSectionImageProgressPolling();
  }
}

// Función auxiliar para verificar si una sección ya tiene imágenes generadas

// Validación para minWords y maxWords
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

  // Formateo automático para el input de duración (MM:SS)
  const targetDurationInput = document.getElementById('targetDurationInput');
  if (targetDurationInput) {
    targetDurationInput.addEventListener('input', function(e) {
      let value = e.target.value.replace(/\D/g, ''); // Eliminar no dígitos
      if (value.length > 4) value = value.slice(0, 4); // Limitar a 4 dígitos
      
      if (value.length >= 3) {
        value = value.slice(0, value.length - 2) + ':' + value.slice(value.length - 2);
      }
      
      e.target.value = value;
    });
  }

  // Configurar botones de traducción
  const translateBtns = document.querySelectorAll('.translate-btn');
  translateBtns.forEach(btn => {
    btn.addEventListener('click', async function() {
      const lang = this.getAttribute('data-lang');
      const langNames = {
        'en': 'Inglés', 'fr': 'Francés', 'de': 'Alemán', 
        'ko': 'Coreano', 'ru': 'Ruso', 'pt': 'Portugués', 'zh': 'Chino'
      };
      
      if (!window.currentProject || !window.currentProject.folderName) {
        showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ No hay un proyecto cargado para traducir', 'error');
        return;
      }

      if (confirm(`¿Estás seguro de traducir todo el proyecto al ${langNames[lang]}? Esto generará nuevos archivos de guion.`)) {
        await translateProjectScripts(lang);
      }
    });
  });

  // Configurar botón de traducir a todos
  const translateAllBtn = document.getElementById('translateAllBtn');
  if (translateAllBtn) {
    translateAllBtn.addEventListener('click', async function() {
      if (!window.currentProject || !window.currentProject.folderName) {
        showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ No hay un proyecto cargado para traducir', 'error');
        return;
      }

      if (confirm('¿Estás seguro de traducir el proyecto a TODOS los idiomas (EN, FR, DE, KO, RU, PT, ZH)?\n\nEsto se hará en paralelo para mayor velocidad.')) {
        await translateProjectAll();
      }
    });
  }

  // Configurar botón de generar audios de traducción
  const generateTranslatedAudiosBtn = document.getElementById('generateTranslatedAudiosBtn');
  if (generateTranslatedAudiosBtn) {
    generateTranslatedAudiosBtn.addEventListener('click', async function() {
      if (!window.currentProject || !window.currentProject.folderName) {
        showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ No hay un proyecto cargado', 'error');
        return;
      }

      const autoGenerateApplioAudio = document.getElementById('autoGenerateApplioAudio').checked;
      if (!autoGenerateApplioAudio) {
        showNotification('ÃƒÂ¢Ã…¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Debes activar la casilla "Incluir Audio Applio" para usar esta función', 'warning');
        return;
      }

      if (confirm('¿Generar audios para todos los guiones traducidos usando Applio?\n\nEsto puede tomar tiempo dependiendo de la cantidad de archivos.')) {
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
    
    // Obtener parámetros de Applio
    const applioVoice = document.getElementById("applioVoiceSelect").value;
    const applioModel = document.getElementById("applioModelSelect").value;
    const applioPitch = parseInt(document.getElementById("applioPitch").value) || 0;
    const applioSpeed = parseInt(document.getElementById("applioSpeed").value) || 0;
    
    // Parsear duración objetivo (MM:SS)
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

    statusText.textContent = `Iniciando generación de audios traducidos...`;
    progressBar.style.width = '2%';

    const response = await fetch('/generate-translated-audios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: folderName,
        totalSections: totalSections,
        applioVoice: applioVoice,
        applioModel: applioModel, // Este es el modelo TTS base que se usará si no hay uno específico por idioma
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
              
              // Cálculo de tiempo estimado
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
              statusText.textContent = 'âœ… Generación de audios completada';
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
    console.error('Error en generación de audios:', error);
    statusText.textContent = 'ÃƒÂ¢Ã‚ÂÃ…â€™ Error: ' + error.message;
    statusText.style.color = '#fc8181';
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error generando audios', 'error');
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
    
    statusText.textContent = `Iniciando traducción masiva paralela...`;
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
              
              // Cálculo de tiempo estimado
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
              statusText.textContent = 'âœ… Traducción masiva completada exitosamente';
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
    console.error('Error en traducción masiva:', error);
    statusText.textContent = 'ÃƒÂ¢Ã‚ÂÃ…â€™ Error: ' + error.message;
    statusText.style.color = '#fc8181';
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error durante la traducción masiva', 'error');
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
    
    statusText.textContent = `Iniciando traducción de ${totalSections} secciones...`;
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
            statusText.textContent = `Traduciendo sección ${data.current} de ${data.total}...`;
          }
          
          if (data.complete) {
            statusText.textContent = 'âœ… Traducción completada exitosamente';
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
    console.error('Error en traducción:', error);
    statusText.textContent = 'ÃƒÂ¢Ã‚ÂÃ…â€™ Error: ' + error.message;
    statusText.style.color = '#fc8181';
    showNotification('ÃƒÂ¢Ã‚ÂÃ…â€™ Error durante la traducción', 'error');
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
    
    // Funciones globales para tabs de traducción
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
                ? '<i class="fas fa-magic"></i> Generar Audios de Traducción' 
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
                else alert('Por favor, selecciona un archivo .mp4 válido.');
            } else if (allowedTypes === 'audio') {
                 if (file.type.startsWith('audio/') || file.name.toLowerCase().endsWith('.mp3') || file.name.toLowerCase().endsWith('.wav')) valid = true;
                 else alert('Por favor, selecciona un archivo de audio válido (.mp3, .wav).');
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
            // En modo manual no hay retry (por ahora), así que siempre requerimos archivo
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
    
    if (!newDir) return alert('La ruta de outputs no puede estar vacía');
    
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
            alert('Error al guardar configuración: ' + err.error);
        }
    } catch (e) {
        console.error('Error saving settings', e);
        alert('Hubo un error al guardar los ajustes.');
    }
}
// Event listener para el botón de descargar el proyecto en ZIP
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

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// B-ROLL MODULE: Buscar y descargar videos/imágenes de apoyo
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
(function initBRollModule() {
  const brollAnalyzeBtn = document.getElementById('brollAnalyzeBtn');
  const brollDownloadBtn = document.getElementById('brollDownloadBtn');
  const brollStatus = document.getElementById('brollStatus');
  const brollResults = document.getElementById('brollResults');
  const brollDownloadProgress = document.getElementById('brollDownloadProgress');
  const brollDownloadList = document.getElementById('brollDownloadList');

  if (!brollAnalyzeBtn) return;

  let brollSections = []; // Datos de la búsqueda actual

  // Botón rápido "Descargar Contenido" (fuera del details)
  let brollQuickTriggered = false;
  const brollQuickBtn = document.getElementById('brollQuickBtn');
  if (brollQuickBtn) {
    brollQuickBtn.addEventListener('click', () => {
      // Abrir el panel de B-Roll y disparar análisis
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
    const brollMode = _brollShortsMode ? 'shorts' : 'normal';
    const validations = parseInt(document.getElementById('brollValidations')?.value) ?? 1;

    if (maxVideos === 0 && maxImages === 0) {
      setBrollStatus('Debes poner al menos 1 video o 1 imagen por término.', true);
      return;
    }

    brollAnalyzeBtn.disabled = true;
    brollResults.innerHTML = '';
    brollDownloadBtn.style.display = 'none';
    brollDownloadProgress.style.display = 'none';
    brollSections = [];

    setBrollStatus('Analizando guiones de cada sección con IA...');

    try {
      // Paso 1: Analizar guiones de cada sección (el backend lee los _guion.txt)
      const projectFolder = window.currentProject.folderName || window.currentProject.projectKey || window.currentProject;
      const analyzeRes = await fetch('/api/broll/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName: projectFolder })
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok) throw new Error(analyzeData.error);

      const terms = analyzeData.terms;
      setBrollStatus(`${terms.length} secciones analizadas. Buscando en YouTube...`);

      // Paso 2: Buscar
      const searchRes = await fetch('/api/broll/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms, maxResults: maxVideos, maxDuration, mode: brollMode, maxImages, folderName: projectFolder, validations })
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
        html += `<div class="broll-term-label">Ã°Å¸â€Â ${escHtml(group.term)}</div>`;

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
        html += `<div class="broll-image-info">Ã°Å¸â€“Â¼Ã¯Â¸Â ${maxImages} imgs Ã— ${imageTerms.length} términos = ${maxImages * imageTerms.length} imágenes al descargar</div>`;
      }

      card.innerHTML = html;
      brollResults.appendChild(card);
      brollSections.push({ section: section.section, urls: sectionUrls, imageTerms, sectionNumber: section.sectionNumber });
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

    // Placeholders para imágenes
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
                <span class="broll-dl-title">Ã°Å¸â€“Â¼Ã¯Â¸Â [${escHtml(sec.section)}] "${escHtml(term)}"</span>
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
            setBrollStatus(`Ã¢Å“" B-Roll descargado Ã¢â€ ' ${data.folder}`);

            // Auto-generar video si esta activada la casilla
            const autoGenCheckbox = document.getElementById('autoGenerateBrollVideo');
            if (autoGenCheckbox && autoGenCheckbox.checked && !isGeneratingVideo) {
              console.log('Auto-generacion de video B-Roll activada, iniciando...');
              setTimeout(() => {
                const brollVideoBtn = document.getElementById('generateBrollVideoBtn');
                if (brollVideoBtn && !brollVideoBtn.disabled) {
                  brollVideoBtn.click();
                }
              }, 1500);
            }
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

  // â”€â”€ Load existing B-Roll status when opening a project â”€â”€
  async function loadBrollStatusForProject(folderName) {
    if (!folderName) return;
    try {
      // Load search results
      const searchRes = await fetch(`/api/broll-search-results/${encodeURIComponent(folderName)}`);
      let searchData = null;
      if (searchRes.ok) {
        searchData = await searchRes.json();
      }

      // Load download status
      const statusRes = await fetch(`/api/broll/status/${encodeURIComponent(folderName)}`);
      if (!statusRes.ok) return;
      const statusData = await statusRes.json();
      if (!statusData.exists) return;

      // Show the panel
      const panel = document.getElementById('brollPanel');
      if (panel) { panel.style.display = 'block'; panel.open = true; }

      // Render search results if available
      if (searchData && searchData.results) {
        renderBrollResults(searchData.results, searchData.maxImages || 0);
      }

      // Overlay download status
      if (statusData.hasStatus && statusData.status) {
        const st = statusData.status;
        brollDownloadProgress.style.display = 'block';
        brollDownloadList.innerHTML = '';

        const failedVideos = [];

        for (const v of st.videos) {
          const row = document.createElement('div');
          const statusClass = v.status === 'done' ? 'done' : v.status === 'error' ? 'error' : 'pending';
          row.className = `broll-dl-item ${statusClass}`;

          const displayTitle = v.title || v.url.replace('https://www.youtube.com/watch?v=', '');
          const statusIcon = v.status === 'done' ? 'âœ“' : v.status === 'error' ? 'âœ— ' + (v.error || 'Error') : 'â³';

          row.innerHTML = `
            <div class="broll-dl-info">
              <span class="broll-dl-title">[${escHtml(v.section || '')}] ${escHtml(displayTitle)}</span>
            </div>
            <div class="broll-dl-bar-container"><div class="broll-dl-bar-fill" style="width:${v.status === 'done' ? '100' : '0'}%"></div></div>
            <div class="broll-dl-meta"><span class="broll-dl-percent">${statusIcon}</span></div>
          `;
          brollDownloadList.appendChild(row);

          if (v.status !== 'done') {
            failedVideos.push(v);
          }
        }

        // Image tasks
        if (st.imageTasks) {
          for (const img of st.imageTasks) {
            const row = document.createElement('div');
            row.className = `broll-dl-item ${img.status === 'done' ? 'done' : 'error'}`;
            row.innerHTML = `
              <div class="broll-dl-info">
                <span class="broll-dl-title">🖼️ [${escHtml(img.section || '')}] "${escHtml(img.term)}"</span>
              </div>
              <div class="broll-dl-bar-container"><div class="broll-dl-bar-fill" style="width:${img.status === 'done' ? '100' : '0'}%"></div></div>
              <div class="broll-dl-meta"><span class="broll-dl-percent">${img.status === 'done' ? `âœ“ ${img.downloaded} imgs` : img.error || 'Error'}</span></div>
            `;
            brollDownloadList.appendChild(row);
          }
        }

        // Summary status
        const summary = st.summary || {};
        const msg = `B-Roll: ${summary.downloaded || 0}/${summary.totalVideos || 0} descargados` +
          (summary.failed > 0 ? ` (${summary.failed} fallidos)` : ' âœ“');
        setBrollStatus(msg, summary.failed > 0);

        // Retry button for failed downloads - prominent, above the list
        if (failedVideos.length > 0) {
          const retryContainer = document.createElement('div');
          retryContainer.style.cssText = 'margin: 12px 0; display: flex; gap: 10px; align-items: center;';

          const retryBtn = document.createElement('button');
          retryBtn.className = 'action-btn primary-action';
          retryBtn.style.cssText = 'flex: 1; justify-content: center; padding: 12px; font-size: 0.9rem;';
          retryBtn.innerHTML = `<i class="fas fa-download"></i> <span>Descargar ${failedVideos.length} video(s) faltantes</span>`;
          retryBtn.onclick = async () => {
            retryBtn.disabled = true;
            retryBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Descargando...</span>';

            // Build sections from failed videos grouped by section
            const grouped = {};
            for (const v of failedVideos) {
              const key = v.section || 'unknown';
              if (!grouped[key]) grouped[key] = { section: v.section, urls: [], sectionNumber: null };
              grouped[key].urls.push(v.url);
            }

            // Try to get section numbers from plan
            if (statusData.plan && statusData.plan.sections) {
              for (const planSec of statusData.plan.sections) {
                if (grouped[planSec.section]) {
                  grouped[planSec.section].sectionNumber = planSec.sectionNumber;
                }
              }
            }

            const retryFolderName = window.currentProject?.folderName || folderName;
            const resolution = document.getElementById('brollResolution')?.value || '720';

            try {
              const res = await fetch('/api/broll/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sections: Object.values(grouped), folderName: retryFolderName, maxImages: 0, resolution })
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error);

              retryBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>Descargando ${failedVideos.length} videos...</span>`;
              const jobId = data.jobId;
              const poll = setInterval(async () => {
                try {
                  const sr = await fetch(`/api/broll/download/status/${jobId}`);
                  const sd = await sr.json();
                  if (sd.done) {
                    clearInterval(poll);
                    loadBrollStatusForProject(folderName);
                  }
                } catch { clearInterval(poll); }
              }, 1500);
            } catch (err) {
              retryBtn.disabled = false;
              retryBtn.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <span>Error: ${err.message} - Click para reintentar</span>`;
            }
          };

          retryContainer.appendChild(retryBtn);
          // Insert retry button BEFORE the download list (so it's visible at top)
          brollDownloadProgress.insertBefore(retryContainer, brollDownloadList);
        }
      } else if (!searchData) {
        // No search results and no download status with details - just show plan info
        if (statusData.plan) {
          setBrollStatus(`B-Roll: ${statusData.plan.totalVideos} videos planificados`);
        }
      }
    } catch (e) {
      console.log('B-Roll status no disponible:', e.message);
    }
  }

  // Expose globally for loadProject to call
  window.loadBrollStatusForProject = loadBrollStatusForProject;
})();

// ========== Generar Video con B-Roll ==========
(function initBrollVideoGeneration() {
  const btn = document.getElementById('generateBrollVideoBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (isGeneratingVideo) {
      showNotification('Ya hay una generacion de video en curso. Espera a que finalice.', 'info');
      return;
    }

    const folderName = window.currentProject?.folderName;
    if (!folderName) {
      showNotification('No hay proyecto cargado.', 'error');
      return;
    }

    // Si auto-generate está activo, renderizar directo sin preview
    const autoGen = document.getElementById('autoGenerateBrollVideo');
    if (autoGen && autoGen.checked) {
      // If we already have a preview loaded, use it (consistent render)
      if (_brollPreviewId && _brollPreviewFolderName === folderName) {
        confirmBrollRender();
        return;
      }
      // Direct render (old flow - generates new random sequence)
      isGeneratingVideo = true;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando Video...</span>';

    const progressContainer = document.getElementById('brollVideoProgressContainer');
    const progressBar = document.getElementById('brollVideoProgressBar');
    const progressPercent = document.getElementById('brollVideoProgressPercent');
    const progressInfo = document.getElementById('brollVideoProgressInfo');
    const progressLabel = document.getElementById('brollVideoProgressLabel');

    if (progressContainer) progressContainer.style.display = 'block';

    let pollInterval = null;

    try {
      const videoConfig = {
        maxImagesPerSection: parseInt(document.getElementById('videoMaxImagesPerSection')?.value) || 1,
        imageDuration: parseInt(document.getElementById('videoImageDuration')?.value) || 5,
        minClipDuration: parseInt(document.getElementById('videoMinClipDuration')?.value) || 4,
        maxClipDuration: parseInt(document.getElementById('videoMaxClipDuration')?.value) || 10,
        minResolution: parseInt(document.getElementById('videoMinResolution')?.value) || 0,
        resolution: document.getElementById('videoOutputResolution')?.value || '1920:1080',
        crf: parseInt(document.getElementById('videoCRF')?.value) || 23,
        preset: document.getElementById('videoPreset')?.value || 'fast'
      };

      const response = await fetch('/api/generate-broll-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName, videoConfig })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error del servidor');
      }

      const sessionId = data.sessionId;

      // Poll progress
      pollInterval = setInterval(async () => {
        try {
          const progRes = await fetch(`/api/broll-video-progress/${sessionId}`);
          const progData = await progRes.json();
          if (!progData.success) return;

          const p = progData.progress;
          const pct = Math.round(p.percent || 0);

          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressPercent) progressPercent.textContent = `${pct}%`;
          if (progressLabel) progressLabel.textContent = p.message || 'Generando video...';
          if (progressInfo) progressInfo.textContent = p.detail || '';

          if (p.status === 'completed') {
            clearInterval(pollInterval);
            pollInterval = null;
            if (progressBar) progressBar.style.width = '100%';
            if (progressPercent) progressPercent.textContent = '100%';
            if (progressLabel) progressLabel.textContent = 'âœ… Video generado exitosamente';
            if (progressInfo) progressInfo.textContent = p.outputFile ? `Guardado: ${p.outputFile}` : '';

            showNotification('✅ Video con B-Roll generado exitosamente! Guardado en la carpeta del proyecto.', 'success');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-clapperboard"></i><span>Generar Video con B-Roll</span>';
            isGeneratingVideo = false;
            // Reload the editor so the user can keep editing after render
            if (folderName) loadExistingBrollTimeline(folderName);
          } else if (p.status === 'error') {
            clearInterval(pollInterval);
            pollInterval = null;
            throw new Error(p.error || 'Error durante la generación');
          }
        } catch (pollErr) {
          // Silent poll error - will retry
        }
      }, 1500);

    } catch (error) {
      if (pollInterval) clearInterval(pollInterval);
      showNotification(`Error: ${error.message}`, 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-clapperboard"></i><span>Generar Video con B-Roll</span>';
      isGeneratingVideo = false;
      if (progressContainer) progressContainer.style.display = 'none';
    }
    } else {
      // Manual mode: show preview timeline
      generateBrollPreview();
    }
  });
})();

// ========== B-Roll Timeline Preview ==========
let _brollPreviewId = null;
let _brollPreviewSections = null;
let _brollPreviewFolderName = null;
let _brollShortsMode = false; // single source of truth for shorts mode
let _brollFlatClips = []; // Flattened list: { sectionIndex, clipIndex, secNum, clip, audioOffset }
let _brollCurrentFlatIdx = -1;
let _brollImageTimer = null;
let _brollIsAutoAdvancing = false; // true when advancing within same section (don't touch audio)
let _brollAIStyleInstructions = ''; // User instructions for AI clip style
let _lastAIClipCode = '';           // TSX code of last generated AI clip (for styleContext)

// ─── AI Clip Queue System (parallel) ──────────────────────────────────────────
const AI_MAX_PARALLEL = 3;          // must match HV_SLOTS in server.ts
let _aiClipQueue = [];              // [{ sectionIndex, clipIndex }] — pending
const _aiClipsActive = new Set();   // Set<"si_ci"> — currently generating
const _aiProgressTimers = {};       // timers por clip para las fases de texto

function _clipKey(si, ci) { return `${si}_${ci}`; }

function _getClipEl(si, ci) {
  return document.querySelector(`.tl-clip[data-section="${si}"][data-clip="${ci}"]`);
}

function _setAIProgress(si, ci, state, label) {
  const el = _getClipEl(si, ci);
  if (!el) return;
  let bar = el.querySelector('.tl-clip-ai-progress');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'tl-clip-ai-progress';
    bar.innerHTML = '<div class="tl-clip-ai-progress-fill"></div><span class="tl-clip-ai-progress-label"></span>';
    el.appendChild(bar);
  }
  bar.className = 'tl-clip-ai-progress';
  bar.querySelector('.tl-clip-ai-progress-label').textContent = label;
  requestAnimationFrame(() => { bar.className = `tl-clip-ai-progress ${state}`; });

  const btn = el.querySelector('.tl-clip-ai-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = state === 'queued'
      ? '<i class="fas fa-clock"></i>'
      : '<i class="fas fa-spinner fa-spin"></i>';
  }
}

function _clearAIProgress(si, ci) {
  const key = _clipKey(si, ci);
  if (_aiProgressTimers[key]) { _aiProgressTimers[key].forEach(clearTimeout); delete _aiProgressTimers[key]; }
  const el = _getClipEl(si, ci);
  if (!el) return;
  el.querySelector('.tl-clip-ai-progress')?.remove();
  const btn = el.querySelector('.tl-clip-ai-btn');
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-robot"></i>'; }
}

function _startProgressPhases(si, ci) {
  const key = _clipKey(si, ci);
  const phases = [
    { delay: 0,     label: 'Transcribiendo...' },
    { delay: 6000,  label: 'Generando código...' },
    { delay: 18000, label: 'Renderizando...' },
  ];
  _aiProgressTimers[key] = phases.map(({ delay, label }) =>
    setTimeout(() => _setAIProgress(si, ci, 'generating', label), delay)
  );
}

function _reapplyQueueVisuals() {
  for (const key of _aiClipsActive) {
    const [si, ci] = key.split('_').map(Number);
    _setAIProgress(si, ci, 'generating', 'Generando...');
  }
  _aiClipQueue.forEach(({ sectionIndex, clipIndex }, i) => {
    _setAIProgress(sectionIndex, clipIndex, 'queued', `Cola #${i + 1}`);
  });
}

// ── Clip mix triangle control ─────────────────────────────────────────────────
// Weights always sum to 1.0: { broll, remotion, web }
let _clipMixWeights = { broll: 1/3, remotion: 1/3, web: 1/3 };
const _CLIP_MIX_KEY = 'hv_clipMixWeights';

// Triangle vertices in SVG space (matches viewBox="0 0 240 200")
const _TRI = {
  web:     { x: 120, y: 18  },  // top    — Remotion + Web
  broll:   { x: 20,  y: 185 },  // bottom-left — B-Roll
  remotion:{ x: 220, y: 185 }   // bottom-right — Remotion puro
};

function _svgToWeights(px, py) {
  const A = _TRI.web, B = _TRI.broll, C = _TRI.remotion;
  const denom = (B.y-C.y)*(A.x-C.x) + (C.x-B.x)*(A.y-C.y);
  let wA = ((B.y-C.y)*(px-C.x) + (C.x-B.x)*(py-C.y)) / denom;
  let wB = ((C.y-A.y)*(px-C.x) + (A.x-C.x)*(py-C.y)) / denom;
  let wC = 1 - wA - wB;
  wA = Math.max(0, wA); wB = Math.max(0, wB); wC = Math.max(0, wC);
  const s = wA + wB + wC || 1;
  return { web: wA/s, broll: wB/s, remotion: wC/s };
}

function _weightsToSvg(w) {
  return {
    x: w.web*_TRI.web.x + w.broll*_TRI.broll.x + w.remotion*_TRI.remotion.x,
    y: w.web*_TRI.web.y + w.broll*_TRI.broll.y + w.remotion*_TRI.remotion.y
  };
}

function _updateTriangleUI(w) {
  const pos = _weightsToSvg(w);
  const dot = document.getElementById('clipMixDot');
  if (dot) { dot.setAttribute('cx', pos.x.toFixed(1)); dot.setAttribute('cy', pos.y.toFixed(1)); }
  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = Math.round(v*100) + '%'; };
  el('triPctBroll', w.broll);
  el('triPctWeb', w.web);
  el('triPctRemotion', w.remotion);
  // Sync hidden brollRemotionEvery for settings save compat (0=all broll, 1=some remotion)
  const hiddenEvery = document.getElementById('brollRemotionEvery');
  if (hiddenEvery) hiddenEvery.value = w.broll >= 0.99 ? '0' : '1';
  // Show/hide compact asset-type panel when web vertex > 0
  const clipTypePanel = document.getElementById('clipTypePanel');
  if (clipTypePanel) clipTypePanel.style.display = w.web > 0.04 ? 'block' : 'none';
  // Legacy compat — keep hidden web toggle synced so any existing code reading it still works
  const webToggle = document.getElementById('brollAIWebImagesToggle');
  if (webToggle) webToggle.checked = w.web > 0.04;
}

function initClipMixTriangle() {
  const svg = document.getElementById('clipMixSvg');
  if (!svg) return;

  // Load saved weights
  try {
    const saved = localStorage.getItem(_CLIP_MIX_KEY);
    if (saved) { const p = JSON.parse(saved); if (p.broll != null) _clipMixWeights = p; }
  } catch {}
  _updateTriangleUI(_clipMixWeights);

  let dragging = false;

  function getSvgPoint(e) {
    const rect = svg.getBoundingClientRect();
    const touch = e.touches?.[0] || e;
    const scaleX = 240 / rect.width;
    const scaleY = 200 / rect.height;
    return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
  }

  function handleMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const pt = getSvgPoint(e);
    const w = _svgToWeights(pt.x, pt.y);
    _clipMixWeights = w;
    _updateTriangleUI(w);
    localStorage.setItem(_CLIP_MIX_KEY, JSON.stringify(w));
  }

  svg.addEventListener('mousedown', (e) => { dragging = true; handleMove(e); });
  svg.addEventListener('touchstart', (e) => { dragging = true; handleMove(e); }, { passive: false });
  window.addEventListener('mousemove', handleMove);
  window.addEventListener('touchmove', handleMove, { passive: false });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('touchend', () => { dragging = false; });
}

document.addEventListener('DOMContentLoaded', initClipMixTriangle);

// ── Web image prefetch ────────────────────────────────────────────────────────
let _webImagesPrefetched = false;
let _webImagesPrefetchedForPreviewId = null; // track which previewId was prefetched

const _WEB_IMG_TOGGLE_KEY = 'hv_webImagesToggle';

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('brollAIWebImagesToggle');
  const btn = document.getElementById('prefetchWebImagesBtn');
  if (toggle) {
    // Restore persisted state
    const saved = localStorage.getItem(_WEB_IMG_TOGGLE_KEY);
    if (saved === 'true') {
      toggle.checked = true;
      if (btn) btn.style.display = 'flex';
    }
    toggle.addEventListener('change', () => {
      localStorage.setItem(_WEB_IMG_TOGGLE_KEY, toggle.checked);
      if (btn) btn.style.display = toggle.checked ? 'flex' : 'none';
      if (!toggle.checked) { _webImagesPrefetched = false; _webImagesPrefetchedForPreviewId = null; }
    });
  }
});

async function prefetchWebImages(silent = false) {
  if (!_brollPreviewId || !_brollPreviewFolderName) {
    if (!silent) showNotification('Carga el preview primero', 'error');
    return false;
  }
  // Skip if web images switch is off
  const _webImagesOn = document.getElementById('clipTypeWebImages')?.checked !== false;
  if (!_webImagesOn) {
    console.log('[WebImg] Prefetch saltado — switch "Imágenes web" desactivado');
    return true;
  }
  // Already done for this exact previewId — skip
  if (_webImagesPrefetchedForPreviewId === _brollPreviewId) {
    console.log('[WebImg] Prefetch ya completado para este proyecto, saltando');
    return true;
  }
  const btn = document.getElementById('prefetchWebImagesBtn');
  const btnText = document.getElementById('prefetchWebImagesBtnText');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
  if (btnText) btnText.textContent = 'Buscando imágenes...';
  if (!silent) showNotification('Buscando y validando imágenes web para cada sección...', 'info');
  else showNotification('🌐 Buscando imágenes de internet antes de generar clips...', 'info');

  try {
    const res = await fetch('/api/prefetch-remotion-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewId: _brollPreviewId, folderName: _brollPreviewFolderName, useWebImages: document.getElementById('clipTypeWebImages')?.checked !== false })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error en prefetch');
    _webImagesPrefetched = true;
    _webImagesPrefetchedForPreviewId = _brollPreviewId;
    showNotification(`✅ ${data.totalImages} imagen(es) lista(s) en ${data.sections} sección(es)`, 'success');
    if (btnText) btnText.textContent = `${data.totalImages} imágenes descargadas ✓`;
    return true;
  } catch (err) {
    showNotification('Error al buscar imágenes: ' + err.message, 'error');
    if (btnText) btnText.textContent = 'Descargar imágenes ahora';
    return false;
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  }
}

async function generateAIClip(sectionIndex, clipIndex, forceWebImages = null) {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;

  const key = _clipKey(sectionIndex, clipIndex);
  if (_aiClipsActive.has(key)) return;
  if (_aiClipQueue.some(q => _clipKey(q.sectionIndex, q.clipIndex) === key)) return;

  if (_aiClipsActive.size >= AI_MAX_PARALLEL) {
    _aiClipQueue.push({ sectionIndex, clipIndex, forceWebImages });
    _setAIProgress(sectionIndex, clipIndex, 'queued', `Cola #${_aiClipQueue.length}`);
    showNotification(`Clip añadido a la cola (#${_aiClipQueue.length})`, 'info');
    return;
  }

  _runAIClipGeneration(sectionIndex, clipIndex, forceWebImages); // fire-and-forget: no await
}

async function _runAIClipGeneration(sectionIndex, clipIndex, forceWebImages = null) {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;
  const key = _clipKey(sectionIndex, clipIndex);
  _aiClipsActive.add(key);

  _setAIProgress(sectionIndex, clipIndex, 'generating', 'Transcribiendo...');
  _startProgressPhases(sectionIndex, clipIndex);
  const activeCount = _aiClipsActive.size;
  showNotification(`Generando clip con IA${activeCount > 1 ? ` (${activeCount} en paralelo)` : ''}...`, 'info');

  try {
    const modelChain = _getModelChain();
    const useStyleCtx = document.getElementById('tlStyleContextToggle')?.checked && _lastAIClipCode;
    // forceWebImages=null means use triangle weight (already determined by caller), else use explicit value
    const webImagesOn = forceWebImages !== null
      ? forceWebImages
      : (_clipMixWeights.web > 0.04);
    const response = await fetch('/api/generate-ai-clip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        previewId: _brollPreviewId,
        folderName: _brollPreviewFolderName,
        sectionIndex,
        clipIndex,
        styleInstructions: document.getElementById('brollAIStyleInput')?.value.trim() || _brollAIStyleInstructions || '',
        modelChain,
        styleContext: useStyleCtx ? _lastAIClipCode : '',
        useWebImages: webImagesOn && (document.getElementById('clipTypeWebImages')?.checked !== false),
        useStockVideo: webImagesOn && (document.getElementById('clipTypeStockVideo')?.checked || false),
        useBrollVideo: webImagesOn && (document.getElementById('clipTypeBrollVideo')?.checked || false),
        useAssets: false,
        isVertical: _brollShortsMode
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error generando AI clip');

    if (data.generatedCode) _lastAIClipCode = data.generatedCode;

    _brollPreviewSections[sectionIndex].clips[clipIndex] = data.clip;
    _brollFlatClips = buildFlatClipList(_brollPreviewSections);
    _clearAIProgress(sectionIndex, clipIndex);
    renderBrollTimeline();

    const clipEl = _getClipEl(sectionIndex, clipIndex);
    if (clipEl) {
      clipEl.style.transition = 'none';
      clipEl.style.borderColor = '#06b6d4';
      clipEl.style.boxShadow = '0 0 16px rgba(6,182,212,0.5)';
      setTimeout(() => { clipEl.style.transition = 'all 0.3s'; clipEl.style.borderColor = ''; clipEl.style.boxShadow = ''; }, 1200);
    }

    const flatIdx = _brollFlatClips.findIndex(f => f.sectionIndex === sectionIndex && f.clipIndex === clipIndex);
    if (flatIdx !== -1) {
      // Highlight the clip in the timeline but don't auto-play — user may be watching another clip or have paused
      _brollCurrentFlatIdx = flatIdx;
      document.querySelectorAll('.tl-clip.selected').forEach(e => e.classList.remove('selected'));
      const clipElSel = document.querySelector(`.tl-clip[data-flat="${flatIdx}"]`);
      if (clipElSel) {
        clipElSel.classList.add('selected');
        clipElSel.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }

    showNotification(`AI clip generado: "${(data.transcription || '').slice(0, 50)}..."`, 'success');
  } catch (error) {
    _clearAIProgress(sectionIndex, clipIndex);
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    _aiClipsActive.delete(key);
    // Drain queue: start as many pending clips as there are free slots
    while (_aiClipQueue.length > 0 && _aiClipsActive.size < AI_MAX_PARALLEL) {
      const next = _aiClipQueue.shift();
      _aiClipQueue.forEach(({ sectionIndex: si, clipIndex: ci }, i) => {
        _setAIProgress(si, ci, 'queued', `Cola #${i + 1}`);
      });
      _runAIClipGeneration(next.sectionIndex, next.clipIndex, next.forceWebImages ?? null); // fire-and-forget
    }
  }
}
let _tlEndScreenFile = null; // File object for end screen clip
let _tlEndScreenUrl = null;  // Object URL for preview
let _tlBgMusicFile = null;   // File object for background music
let _tlBgMusicUrl = null;    // Object URL for preview
let _tlBgMusicAudio = null;  // Audio element for music preview playback

function getVideoConfig() {
  return {
    maxImagesPerSection: parseInt(document.getElementById('videoMaxImagesPerSection')?.value) || 0,
    imageDuration: parseInt(document.getElementById('videoImageDuration')?.value) || 5,
    minClipDuration: parseInt(document.getElementById('videoMinClipDuration')?.value) || 4,
    maxClipDuration: parseInt(document.getElementById('videoMaxClipDuration')?.value) || 10,
    minResolution: parseInt(document.getElementById('videoMinResolution')?.value) || 0,
    resolution: _brollShortsMode ? '1080:1920' : '1920:1080',
    crf: parseInt(document.getElementById('videoCRF')?.value) || 23,
    preset: document.getElementById('videoPreset')?.value || 'slow'
  };
}

function formatSeconds(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Build flat clip list with audio offsets
function buildFlatClipList(sections) {
  const flat = [];
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    let offset = 0;
    for (let ci = 0; ci < sec.clips.length; ci++) {
      const clip = sec.clips[ci];
      // Use Whisper audioStart directly when available — it reflects the real TTS position
      // including inter-phrase silences. Fall back to accumulated sum if not present.
      const audioOffset = typeof clip.audioStart === 'number' ? clip.audioStart : offset;
      flat.push({
        sectionIndex: si,
        clipIndex: ci,
        secNum: sec.secNum,
        clip,
        audioOffset
      });
      offset += clip.duration;
    }
    // Add pause clips after section (if any)
    if (sec.pauseClips && sec.pauseClips.length > 0) {
      for (let pi = 0; pi < sec.pauseClips.length; pi++) {
        flat.push({
          sectionIndex: si,
          clipIndex: pi,
          secNum: sec.secNum,
          clip: sec.pauseClips[pi],
          audioOffset: 0,
          isPause: true
        });
      }
    }
  }
  return flat;
}

async function regenerateSectionByPhrases(sectionIndex) {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;
  const sec = _brollPreviewSections?.[sectionIndex];
  if (!sec) return;

  const btn = document.querySelector(`.tl-sec-phrases-btn[onclick*="(${sectionIndex})"]`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

  try {
    const response = await fetch('/api/regenerate-section-by-phrases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: _brollPreviewFolderName,
        previewId: _brollPreviewId,
        sectionIndex,
        minClipDuration: parseInt(document.getElementById('videoMinClipDuration')?.value) || 4
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error regenerando sección');

    // Reload preview to get updated sections
    const previewRes = await fetch(`/api/broll-preview/${encodeURIComponent(_brollPreviewFolderName)}`);
    const previewData = await previewRes.json();
    if (previewData.success && previewData.sections) {
      _brollPreviewSections = previewData.sections;
      _brollFlatClips = buildFlatClipList(previewData.sections);
    } else {
      _brollPreviewSections[sectionIndex].clips = data.clips;
      _brollFlatClips = buildFlatClipList(_brollPreviewSections);
    }

    renderBrollTimeline();
    _autoQueueRemotionClips(sectionIndex);
    showNotification(`Sección ${sec.secNum}: ${data.clipsCount} clips generados a partir de ${data.segmentsCount} frases`, 'success');
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-quote-right"></i>'; }
  }
}

async function _autoQueueRemotionClips(filterSectionIndex = null) {
  const { broll: wBroll, remotion: wRemotion, web: wWeb } = _clipMixWeights;
  const totalRemotion = wRemotion + wWeb;
  if (totalRemotion < 0.01 || !_brollFlatClips.length) return;

  // Auto-prefetch web images if web fraction is significant
  if (wWeb > 0.04 && _webImagesPrefetchedForPreviewId !== _brollPreviewId) {
    await prefetchWebImages(true);
  }

  // Apply mix PER SECTION with randomized positions so B-Roll isn't always first.
  const sections = _brollPreviewSections || [];
  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    if (filterSectionIndex !== null && sIdx !== filterSectionIndex) continue;

    const sectionClips = _brollFlatClips.filter(
      f => !f.isPause && f.sectionIndex === sIdx
    );
    const N = sectionClips.length;
    if (N === 0) continue;

    // Calculate how many clips of each type this section gets
    const nBroll    = Math.round(wBroll * N);
    const nWeb      = Math.round(wWeb * N);
    const nRemotion = N - nBroll - nWeb; // remainder avoids rounding drift

    // Build type array and shuffle it so positions are random, not sequential
    const types = [
      ...Array(nBroll).fill('broll'),
      ...Array(Math.max(0, nWeb)).fill('web'),
      ...Array(Math.max(0, nRemotion)).fill('remotion'),
    ];
    // Fisher-Yates shuffle
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }

    for (let i = 0; i < N; i++) {
      const type = types[i] || 'broll';
      if (type === 'broll') continue; // stays as B-Roll, no AI generation needed
      const useWeb = type === 'web';
      const { sectionIndex, clipIndex } = sectionClips[i];
      generateAIClip(sectionIndex, clipIndex, useWeb);
    }
  }
}

async function generateBrollPreview() {
  const folderName = window.currentProject?.folderName;
  if (!folderName) { showNotification('No hay proyecto cargado.', 'error'); return; }

  const btn = document.getElementById('generateBrollVideoBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Cargando preview...</span>'; }

  try {
    // First try loading existing preview (preserves regenerated clips)
    const existingRes = await fetch(`/api/broll-preview/${encodeURIComponent(folderName)}`);
    let data;

    if (existingRes.ok) {
      data = await existingRes.json();
      if (data.success && data.sections && data.sections.length > 0) {
        _brollPreviewId = data.previewId;
        _brollPreviewSections = data.sections;
        _brollPreviewFolderName = folderName;
        _brollFlatClips = buildFlatClipList(data.sections);
        renderBrollTimeline();
        showBrollTimelinePanel();
        return;
      }
    }

    // No existing preview - generate new one
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando preview...</span>';
    const response = await fetch('/api/generate-broll-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderName, videoConfig: getVideoConfig(), useTransitions: document.getElementById('brollUseTransitionsToggle')?.checked !== false })
    });
    data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error generando preview');

    _brollPreviewId = data.previewId;
    _brollPreviewSections = data.sections;
    _brollPreviewFolderName = folderName;
    _brollFlatClips = buildFlatClipList(data.sections);

    renderBrollTimeline();
    showBrollTimelinePanel();
    _autoQueueRemotionClips();

  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-clapperboard"></i><span>Generar Video con B-Roll</span>'; }
  }
}

// Auto-load existing B-Roll timeline when loading a project
async function loadExistingBrollTimeline(folderName) {
  if (!folderName) return;
  try {
    // First try loading existing preview
    let res = await fetch(`/api/broll-preview/${encodeURIComponent(folderName)}`);
    let data;

    if (res.ok) {
      data = await res.json();
      if (data.success && data.sections && data.sections.length > 0) {
        _brollPreviewId = data.previewId;
        _brollPreviewSections = data.sections;
        _brollPreviewFolderName = folderName;
        _brollFlatClips = buildFlatClipList(data.sections);
        renderBrollTimeline();
        showBrollTimelinePanel();
        console.log(`ðŸŽ¬ Timeline de B-Roll cargada desde preview existente (${data.sections.length} secciones)`);
        return;
      }
    }

    // No existing preview — do NOT auto-generate on project load (only on "Video B-Roll" click)
    return;

    _brollPreviewId = data.previewId;
    _brollPreviewSections = data.sections;
    _brollPreviewFolderName = folderName;
    _brollFlatClips = buildFlatClipList(data.sections);
    renderBrollTimeline();
    showBrollTimelinePanel();
    _autoQueueRemotionClips();
    console.log(`ðŸŽ¬ Timeline de B-Roll generada automaticamente (${data.sections.length} secciones)`);
  } catch (e) {
    // Silent fail - no timeline to show
    console.log('Timeline B-Roll no disponible:', e.message);
  }
}

function showBrollTimelinePanel() {
  const panel = document.getElementById('brollTimelinePanel');
  if (panel) {
    panel.style.display = 'flex';
    panel.classList.add('active');
    panel.classList.toggle('shorts-mode', _brollShortsMode);
    setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }
}

// ─── Persistent config ────────────────────────────────────────────────────────
const _CONFIG_KEY = 'brollPanelConfig_v1';

const _CONFIG_FIELDS = [
  // [id, type]  type: 'number' | 'text' | 'select' | 'checkbox' | 'textarea'
  ['brollMaxDuration',       'number'],
  ['brollSearchTerms',       'number'],
  ['brollMaxVideos',         'number'],
  ['brollMaxImages',         'number'],
  ['brollResolution',        'select'],
  ['brollValidations',       'number'],
  ['brollUseTransitionsToggle', 'checkbox'],
  ['brollRemotionEvery',     'select'],
  ['tlAIModelSelect',        'select'],
  ['tlStyleContextToggle',   'checkbox'],
  ['brollAIStyleInput',      'textarea'],
  ['clipTypeWebImages',   'checkbox'],
  ['clipTypeStockVideo',  'checkbox'],
  ['clipTypeBrollVideo',  'checkbox'],
  ['videoMinClipDuration', 'number'],
];

// ──────────────────────────────────────────────────
// Model fallback chain builder
// ──────────────────────────────────────────────────
const MODEL_CHAIN_KEY = 'hv_modelChain';

const MODEL_OPTIONS = [
  { value: '',                       label: '3.1 Lite (Gratis)',        tier: 'free'  },
  { value: 'gemini-2.5-flash',       label: '2.5 Flash (Gratis)',       tier: 'free'  },
  { value: 'gemini-3-flash-preview', label: '3 Flash Preview (Gratis)', tier: 'free'  },
  { value: 'flash',                  label: '3.5 Flash (Gratis)',       tier: 'free'  },
  { value: 'gemini-2.5-pro',         label: '2.5 Pro ($1.25/M)',        tier: 'paid'  },
  { value: 'gemini-3.1-pro-preview', label: '3.1 Pro Preview ($2/M)',   tier: 'paid'  },
  { value: 'ollama',                 label: 'Ollama (local)',            tier: 'local' },
];

const TIER_OF = (v) => MODEL_OPTIONS.find(o => o.value === v)?.tier || 'free';

const DEFAULT_MODEL_CHAIN = [
  { model: 'flash', tier: 'free' },
  { model: 'gemini-2.5-pro', tier: 'paid' },
];

function _getModelChain() {
  try {
    const raw = localStorage.getItem(MODEL_CHAIN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // back-compat: fill missing tier from model default
        return parsed.map(e => ({ ...e, tier: e.tier || TIER_OF(e.model) }));
      }
    }
  } catch {}
  return DEFAULT_MODEL_CHAIN;
}

function _saveModelChain(chain) {
  try { localStorage.setItem(MODEL_CHAIN_KEY, JSON.stringify(chain)); } catch {}
}

function _buildModelSelectHTML(selectedValue) {
  return MODEL_OPTIONS.map(o =>
    `<option value="${o.value}"${o.value === selectedValue ? ' selected' : ''}>${o.label}</option>`
  ).join('');
}

function _renderModelChain() {
  const list = document.getElementById('modelChainList');
  if (!list) return;
  const chain = _getModelChain();
  list.innerHTML = chain.map((entry, i) => {
    const tier = entry.tier || TIER_OF(entry.model);
    const tierLabel = tier === 'free' ? 'GRATIS' : tier === 'paid' ? 'PAGO' : 'LOCAL';
    return `<div class="model-chain-row" data-idx="${i}">
      <span class="chain-num">${i + 1}</span>
      <select onchange="_onChainModelChange(${i}, this.value)">${_buildModelSelectHTML(entry.model)}</select>
      <button class="chain-tier ${tier}" title="Click para cambiar entre Gratis/Pago" onclick="_toggleChainTier(${i})">${tierLabel}</button>
      <button class="chain-btn" title="Subir" onclick="_moveChainRow(${i}, -1)">&#8593;</button>
      <button class="chain-btn" title="Bajar" onclick="_moveChainRow(${i}, 1)">&#8595;</button>
      <button class="chain-btn chain-remove" title="Eliminar" onclick="_removeChainRow(${i})">&#10005;</button>
    </div>`;
  }).join('');
}

function _onChainModelChange(idx, value) {
  const chain = _getModelChain();
  if (!chain[idx]) return;
  chain[idx].model = value;
  // Auto-set tier default when model changes, but don't override if user already chose
  chain[idx].tier = TIER_OF(value);
  _saveModelChain(chain);
  _renderModelChain();
}

function _toggleChainTier(idx) {
  const chain = _getModelChain();
  if (!chain[idx]) return;
  const current = chain[idx].tier || TIER_OF(chain[idx].model);
  // Cycle: free → paid → free (skip 'local' for Ollama)
  chain[idx].tier = current === 'free' ? 'paid' : 'free';
  _saveModelChain(chain);
  _renderModelChain();
}

function _moveChainRow(idx, dir) {
  const chain = _getModelChain();
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= chain.length) return;
  [chain[idx], chain[newIdx]] = [chain[newIdx], chain[idx]];
  _saveModelChain(chain);
  _renderModelChain();
}

function _removeChainRow(idx) {
  const chain = _getModelChain();
  if (chain.length <= 1) return; // keep at least one
  chain.splice(idx, 1);
  _saveModelChain(chain);
  _renderModelChain();
}

function addModelChainRow() {
  const chain = _getModelChain();
  chain.push({ model: 'flash', tier: 'free' });
  _saveModelChain(chain);
  _renderModelChain();
}

function _saveConfig() {
  const cfg = { brollShortsMode: _brollShortsMode };
  for (const [id, type] of _CONFIG_FIELDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    cfg[id] = type === 'checkbox' ? el.checked : el.value;
  }
  try { localStorage.setItem(_CONFIG_KEY, JSON.stringify(cfg)); } catch {}
}

function _loadConfig() {
  let cfg;
  try { cfg = JSON.parse(localStorage.getItem(_CONFIG_KEY) || 'null'); } catch {}
  if (!cfg) return;
  for (const [id, type] of _CONFIG_FIELDS) {
    const el = document.getElementById(id);
    if (!el || !(id in cfg)) continue;
    if (type === 'checkbox') el.checked = !!cfg[id];
    else el.value = cfg[id];
  }
  // Sync slider labels after restoring values
  const _minClipEl = document.getElementById('videoMinClipDuration');
  const _minClipLbl = document.getElementById('videoMinClipDurationLabel');
  if (_minClipEl && _minClipLbl) _minClipLbl.textContent = _minClipEl.value + 's';

  if (cfg.brollShortsMode !== undefined) setBrollMode(cfg.brollShortsMode ? 'shorts' : 'normal');
}

function _attachConfigListeners() {
  for (const [id, type] of _CONFIG_FIELDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const evt = type === 'textarea' ? 'input' : 'change';
    el.addEventListener(evt, _saveConfig);
  }
  _renderModelChain();
}

function setBrollMode(mode) {
  _brollShortsMode = mode === 'shorts';
  const normalBtn = document.getElementById('brollModeNormal');
  const shortsBtn = document.getElementById('brollModeShorts');
  if (_brollShortsMode) {
    shortsBtn?.classList.add('active');
    normalBtn?.classList.remove('active');
  } else {
    normalBtn?.classList.add('active');
    shortsBtn?.classList.remove('active');
  }
  const panel = document.getElementById('brollTimelinePanel');
  if (panel && panel.style.display !== 'none') {
    panel.classList.toggle('shorts-mode', _brollShortsMode);
  }
  _saveConfig();
}

function closeBrollTimeline() {
  stopBrollAudio();
  const vids = document.querySelectorAll('.tl-player-video-wrap video');
  vids.forEach(v => { v.pause(); v.removeAttribute('src'); v.dataset.preloadUrl = ''; });
  const panel = document.getElementById('brollTimelinePanel');
  if (panel) { panel.style.display = 'none'; panel.classList.remove('active'); }
  _brollCurrentFlatIdx = -1;
}

function stopBrollAudio() {
  const audio = document.getElementById('tlPreviewAudio');
  if (audio) { audio.pause(); audio.currentTime = 0; }
  if (_brollImageTimer) { clearTimeout(_brollImageTimer); _brollImageTimer = null; }
  stopMusicPreview();
}

function renderBrollTimeline() {
  const container = document.getElementById('brollTimelineContainer');
  if (!container || !_brollPreviewSections) return;

  // Inject drag-drop styles once
  if (!document.getElementById('broll-dnd-styles')) {
    const style = document.createElement('style');
    style.id = 'broll-dnd-styles';
    style.textContent = `
      .tl-clip.tl-clip-dragover { outline: 2px dashed #22d3ee; outline-offset: -2px; background: rgba(34,211,238,0.1) !important; }
      .tl-clip.tl-clip-dragging { opacity: 0.4; }
    `;
    document.head.appendChild(style);
  }

  let totalClips = 0, totalDuration = 0;
  _brollPreviewSections.forEach(s => { totalClips += s.clips.length; totalDuration += s.audioDuration; });

  const tlSections = document.getElementById('tlTotalSections');
  const tlClips = document.getElementById('tlTotalClips');
  const tlDuration = document.getElementById('tlTotalDuration');
  if (tlSections) tlSections.textContent = _brollPreviewSections.length;
  if (tlClips) tlClips.textContent = totalClips;
  if (tlDuration) tlDuration.textContent = formatSeconds(totalDuration);

  // Render flat timeline with section dividers
  let html = '';
  let flatIdx = 0;

  for (let si = 0; si < _brollPreviewSections.length; si++) {
    const sec = _brollPreviewSections[si];

    // Section divider
    html += `<div class="tl-sec-divider">
      <div class="tl-sec-divider-line"></div>
      <span class="tl-sec-divider-label">SEC ${sec.secNum}</span>
      <button class="tl-sec-phrases-btn" onclick="event.stopPropagation(); regenerateSectionByPhrases(${si})" title="Regenerar sección por frases (Whisper)">
        <i class="fas fa-quote-right"></i>
      </button>
      <div class="tl-sec-divider-line"></div>
    </div>`;

    // Clips for this section
    for (let ci = 0; ci < sec.clips.length; ci++) {
      const clip = sec.clips[ci];
      // Width proportional to duration (min 80px, ~20px per second)
      const clipWidth = Math.max(80, Math.round(clip.duration * 20));
      const thumbSrc = clip.thumbnail
        ? `/api/broll-thumbnail/${_brollPreviewFolderName}/${clip.thumbnail}?t=${Date.now()}`
        : '';
      const thumbEl = clip.thumbnail
        ? `<img class="tl-clip-thumb" src="${thumbSrc}" alt="clip" loading="lazy">`
        : `<div class="tl-clip-thumb-placeholder"><i class="fas fa-image"></i></div>`;

      html += `<div class="tl-clip" data-flat="${flatIdx}" data-section="${si}" data-clip="${ci}" style="width: ${clipWidth}px;" onclick="selectBrollClip(${flatIdx})">
        <span class="tl-clip-type-badge ${clip.type}">${clip.type === 'video' ? 'VID' : 'IMG'}</span>
        <div class="tl-clip-btns">
          <button class="tl-clip-regen-btn" onclick="event.stopPropagation(); regenerateBrollClip(${si}, ${ci}, this)" title="Regenerar clip (misma secci&oacute;n)">
            <i class="fas fa-sync-alt"></i>
          </button>
          <button class="tl-clip-regen-cross-btn" onclick="event.stopPropagation(); regenerateBrollClipCross(${si}, ${ci}, this)" title="Regenerar clip (otras secciones)">
            <i class="fas fa-random"></i>
          </button>
          <button class="tl-clip-replace-img-btn" onclick="event.stopPropagation(); replaceBrollClipWithImage(${si}, ${ci}, this)" title="Forzar cambio por imagen">
            <i class="fas fa-image"></i>
          </button>
          <button class="tl-clip-ai-btn" onclick="event.stopPropagation(); generateAIClip(${si}, ${ci})" title="Generar clip con IA (Remotion)">
            <i class="fas fa-robot"></i>
          </button>
        </div>
        ${clip.type === 'video' ? `
        <button class="tl-clip-shift-btn tl-clip-shift-back-btn" onclick="event.stopPropagation(); window.shiftBrollClip(${si}, ${ci}, -5, this)" title="Atrasar 5s">
          <i class="fas fa-undo"></i>
        </button>
        <button class="tl-clip-shift-btn tl-clip-shift-fw-btn" onclick="event.stopPropagation(); window.shiftBrollClip(${si}, ${ci}, 5, this)" title="Adelantar 5s">
          <i class="fas fa-redo"></i>
        </button>
        ` : ''}
        ${thumbEl}
        <div class="tl-clip-info">
          <div class="tl-clip-duration"><i class="fas fa-clock"></i> ${clip.duration.toFixed(1)}s</div>
          <div class="tl-clip-source" title="${clip.sourceFile}">${clip.sourceFile}</div>
        </div>
      </div>`;

      // Transition badge between consecutive clips (not after last clip)
      if (ci < sec.clips.length - 1) {
        const tr = clip.transitionOut || null;
        const trLabel = tr ? _transitionLabel(tr) : '✂';
        const trClass = tr ? 'tl-transition-badge' : 'tl-transition-badge tl-transition-cut';
        html += `<button class="${trClass}" data-section="${si}" data-clip="${ci}" onclick="event.stopPropagation(); openTransitionPicker(${si}, ${ci}, this)" title="${tr ? `Transición: ${tr}` : 'Corte directo'}">${trLabel}</button>`;
      }

      flatIdx++;
    }

    // Render pause clips after section clips (if any)
    if (sec.pauseClips && sec.pauseClips.length > 0) {
      for (let pi = 0; pi < sec.pauseClips.length; pi++) {
        const pclip = sec.pauseClips[pi];
        const pWidth = Math.max(100, Math.round(pclip.duration * 20));
        const pThumbSrc = pclip.thumbnail
          ? `/api/broll-thumbnail/${_brollPreviewFolderName}/${pclip.thumbnail}?t=${Date.now()}`
          : '';
        const pThumbEl = pclip.thumbnail
          ? `<img class="tl-clip-thumb" src="${pThumbSrc}" alt="pause" loading="lazy">`
          : `<div class="tl-clip-thumb-placeholder"><i class="fas fa-music"></i></div>`;

        const isVideo = pclip.type === 'video';
        html += `<div class="tl-clip tl-clip-pause" data-flat="${flatIdx}" data-section="${si}" data-pauseclip="${pi}" style="width: ${pWidth}px;" onclick="selectBrollClip(${flatIdx})">
          <span class="tl-clip-type-badge pause"><i class="fas fa-music"></i> ${isVideo ? 'VID' : 'IMG'}</span>
          <div class="tl-clip-btns">
            <button class="tl-clip-regen-btn" onclick="event.stopPropagation(); regeneratePauseClip(${si}, ${pi}, this)" title="Regenerar clip pausa">
              <i class="fas fa-sync-alt"></i>
            </button>
            <button class="tl-clip-regen-cross-btn" onclick="event.stopPropagation(); regeneratePauseClipCross(${si}, ${pi}, this)" title="Regenerar (otras secciones)">
              <i class="fas fa-random"></i>
            </button>
            <button class="tl-clip-replace-img-btn" onclick="event.stopPropagation(); replacePauseClipWithImage(${si}, ${pi}, this)" title="Cambiar por imagen">
              <i class="fas fa-image"></i>
            </button>
          </div>
          ${isVideo ? `
          <button class="tl-clip-shift-btn tl-clip-shift-back-btn" onclick="event.stopPropagation(); window.shiftPauseClip(${si}, ${pi}, -5, this)" title="Atrasar 5s">
            <i class="fas fa-backward"></i>
          </button>
          <button class="tl-clip-shift-btn tl-clip-shift-fw-btn" onclick="event.stopPropagation(); window.shiftPauseClip(${si}, ${pi}, 5, this)" title="Adelantar 5s">
            <i class="fas fa-forward"></i>
          </button>
          ` : ''}
          ${pThumbEl}
          <div class="tl-clip-info">
            <div class="tl-clip-duration"><i class="fas fa-clock"></i> ${pclip.duration.toFixed(1)}s</div>
            <div class="tl-clip-source" title="${pclip.sourceFile || 'Pausa'}">${pclip.sourceFile || 'Pausa'}</div>
          </div>
        </div>`;
        flatIdx++;
      }
    }

    // Pause control between sections (not after the last one)
    if (si < _brollPreviewSections.length - 1) {
      const pauseVal = Math.round(sec.pauseAfter || 0);
      html += `<div class="tl-pause-divider">
        <div class="tl-pause-divider-line"></div>
        <div class="tl-pause-control">
          <button class="tl-pause-btn tl-pause-btn-minus" onclick="adjustBrollPause(${si}, -3)" title="Quitar clip de pausa (3s)">
            <i class="fas fa-minus"></i>
          </button>
          <div class="tl-pause-value-wrap">
            <span class="tl-pause-value">${pauseVal}</span>
            <span class="tl-pause-unit">PAUSA</span>
          </div>
          <button class="tl-pause-btn tl-pause-btn-plus" onclick="adjustBrollPause(${si}, 3)" title="Agregar clip de pausa (3s)">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        <div class="tl-pause-divider-line"></div>
      </div>`;
    }
  }

  container.innerHTML = html;

  // ─── Drag & Drop: continue a clip into another ───
  container.querySelectorAll('.tl-clip:not(.tl-clip-pause)').forEach(clipEl => {
    clipEl.draggable = true;

    clipEl.addEventListener('dragstart', (e) => {
      const si = clipEl.dataset.section;
      const ci = clipEl.dataset.clip;
      if (si == null || ci == null) return;
      e.dataTransfer.setData('text/plain', JSON.stringify({ sectionIndex: parseInt(si), clipIndex: parseInt(ci) }));
      e.dataTransfer.effectAllowed = 'copy';
      clipEl.classList.add('tl-clip-dragging');
    });

    clipEl.addEventListener('dragend', () => {
      clipEl.classList.remove('tl-clip-dragging');
      container.querySelectorAll('.tl-clip-dragover').forEach(el => el.classList.remove('tl-clip-dragover'));
    });

    clipEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      clipEl.classList.add('tl-clip-dragover');
    });

    clipEl.addEventListener('dragleave', () => {
      clipEl.classList.remove('tl-clip-dragover');
    });

    clipEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      clipEl.classList.remove('tl-clip-dragover');
      const toSI = parseInt(clipEl.dataset.section);
      const toCI = parseInt(clipEl.dataset.clip);
      if (isNaN(toSI) || isNaN(toCI)) return;

      // Check if this is an internal drag (from another clip or pool) vs external file drop
      let from = null;
      const plainData = e.dataTransfer.getData('text/plain');
      if (plainData) { try { from = JSON.parse(plainData); } catch {} }

      // ── File drop from system (Windows Explorer) — only if NOT an internal drag ──
      if (!from && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const validExts = ['.mp4','.webm','.mkv','.avi','.mov','.jpg','.jpeg','.png','.webp','.gif','.bmp'];
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!validExts.includes(ext)) {
          showNotification('Formato no soportado. Usa video o imagen.', 'error');
          return;
        }
        clipEl.style.opacity = '0.5';
        try {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('folderName', _brollPreviewFolderName);
          formData.append('sectionIndex', toSI);
          formData.append('clipIndex', toCI);
          formData.append('isPause', 'false');
          const resp = await fetch('/api/broll-drop-file', { method: 'POST', body: formData });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'Error');
          _brollPreviewSections[toSI].clips[toCI] = data.clip;
          _brollFlatClips = buildFlatClipList(_brollPreviewSections);
          _skipPoolReload = true;
          renderBrollTimeline();
          const flatIdx = _brollFlatClips.findIndex(f => f.sectionIndex === toSI && f.clipIndex === toCI && !f.isPause);
          if (flatIdx !== -1) selectBrollClip(flatIdx);
          showNotification(`Archivo "${file.name}" aplicado`, 'success');
        } catch (err) {
          showNotification('Error: ' + err.message, 'error');
        } finally { clipEl.style.opacity = ''; }
        return;
      }

      if (!from) return; // No valid internal drag data

      // ── Pool clip drop (from grid panel) ──
      if (from.pool) {
        clipEl.style.opacity = '0.5';
        try {
          const resp = await fetch('/api/broll-apply-pool-clip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              folderName: _brollPreviewFolderName,
              sourceSecNum: from.secNum,
              sourceFile: from.sourceFile,
              cutAt: from.cutAt || 0,
              targetSectionIndex: toSI,
              targetClipIndex: toCI,
              isPause: false
            })
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'Error');
          _brollPreviewSections[toSI].clips[toCI] = data.clip;
          _brollFlatClips = buildFlatClipList(_brollPreviewSections);
          _skipPoolReload = true;
          renderBrollTimeline();
          const flatIdx = _brollFlatClips.findIndex(f => f.sectionIndex === toSI && f.clipIndex === toCI && !f.isPause);
          if (flatIdx !== -1) selectBrollClip(flatIdx);
          showNotification('Clip aplicado desde pool', 'success');
        } catch (err) {
          showNotification('Error: ' + err.message, 'error');
        } finally { clipEl.style.opacity = ''; }
        return;
      }

      // ── Continue-clip drop (from another timeline clip) ──
      // Don't drop on itself
      if (from.sectionIndex === toSI && from.clipIndex === toCI) return;

      // Show loading on target
      clipEl.style.opacity = '0.5';
      try {
        const resp = await fetch('/api/broll-continue-clip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            previewId: _brollPreviewId,
            folderName: _brollPreviewFolderName,
            fromSectionIndex: from.sectionIndex,
            fromClipIndex: from.clipIndex,
            toSectionIndex: toSI,
            toClipIndex: toCI
          })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Error');

        _brollPreviewSections[toSI].clips[toCI] = data.clip;
        _brollFlatClips = buildFlatClipList(_brollPreviewSections);
        renderBrollTimeline();

        // Flash green on the target clip after re-render
        const newClipEl = container.querySelector(`.tl-clip[data-section="${toSI}"][data-clip="${toCI}"]`);
        if (newClipEl) {
          newClipEl.style.transition = 'none';
          newClipEl.style.borderColor = '#22c55e';
          newClipEl.style.boxShadow = '0 0 12px rgba(34,197,94,0.5)';
          setTimeout(() => { newClipEl.style.transition = 'all 0.3s'; newClipEl.style.borderColor = ''; newClipEl.style.boxShadow = ''; }, 800);
        }

        // Auto-play the updated clip in the preview
        const flatIdx = _brollFlatClips.findIndex(f => f.sectionIndex === toSI && f.clipIndex === toCI && !f.isPause);
        if (flatIdx !== -1) selectBrollClip(flatIdx);

        showNotification('Clip continuado exitosamente', 'success');
      } catch (err) {
        showNotification('Error: ' + err.message, 'error');
      } finally {
        clipEl.style.opacity = '';
      }
    });
  });

  // ── Drag & Drop from system for pause clips ──
  container.querySelectorAll('.tl-clip.tl-clip-pause').forEach(clipEl => {
    clipEl.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        clipEl.classList.add('tl-clip-dragover');
      }
    });
    clipEl.addEventListener('dragleave', () => { clipEl.classList.remove('tl-clip-dragover'); });
    clipEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      clipEl.classList.remove('tl-clip-dragover');
      if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
      const file = e.dataTransfer.files[0];
      const validExts = ['.mp4','.webm','.mkv','.avi','.mov','.jpg','.jpeg','.png','.webp','.gif','.bmp'];
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!validExts.includes(ext)) { showNotification('Formato no soportado', 'error'); return; }
      const si = parseInt(clipEl.dataset.section);
      const pi = parseInt(clipEl.dataset.pauseclip);
      if (isNaN(si) || isNaN(pi)) return;
      clipEl.style.opacity = '0.5';
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folderName', _brollPreviewFolderName);
        formData.append('sectionIndex', si);
        formData.append('clipIndex', pi);
        formData.append('isPause', 'true');
        const resp = await fetch('/api/broll-drop-file', { method: 'POST', body: formData });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Error');
        if (!_brollPreviewSections[si].pauseClips) _brollPreviewSections[si].pauseClips = [];
        _brollPreviewSections[si].pauseClips[pi] = data.clip;
        _brollFlatClips = buildFlatClipList(_brollPreviewSections);
        _skipPoolReload = true;
        renderBrollTimeline();
        showNotification(`Archivo "${file.name}" aplicado a pausa`, 'success');
      } catch (err) {
        showNotification('Error: ' + err.message, 'error');
      } finally { clipEl.style.opacity = ''; }
    });
  });

  // Reset player to placeholder state
  const placeholder = document.getElementById('tlPreviewPlaceholder');
  const video = document.getElementById('tlPreviewVideo');
  const image = document.getElementById('tlPreviewImage');
  if (placeholder) placeholder.style.display = 'flex';
  if (video) video.removeAttribute('src');
  if (image) image.style.display = 'none';

  // Load pool grids only on first render (not on clip updates)
  if (!_skipPoolReload && !document.querySelector('.tl-grid-clip')) {
    loadPoolGrids();
  }
  _skipPoolReload = false;
}

// ═══ Pool Grid System (Side Panels) ═══
let _poolCurrentSection = 0; // Track which section the left panel shows
let _skipPoolReload = false; // Skip grid reload on timeline re-render

// ═══ Resizable Panel Dividers ═══
(function initPanelResizers() {
  let activeResizer = null, startX = 0, startWidth = 0, targetPanel = null;

  function onMouseDown(e) {
    e.preventDefault();
    activeResizer = e.target;
    activeResizer.classList.add('active');
    startX = e.clientX;
    const isLeft = activeResizer.id === 'tlResizerLeft';
    targetPanel = document.getElementById(isLeft ? 'tlPoolPanelLeft' : 'tlPoolPanelRight');
    if (!targetPanel) return;
    startWidth = targetPanel.getBoundingClientRect().width;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function onMouseMove(e) {
    if (!targetPanel) return;
    const isLeft = activeResizer.id === 'tlResizerLeft';
    const delta = e.clientX - startX;
    const newWidth = isLeft ? startWidth + delta : startWidth - delta;
    const clamped = Math.max(140, Math.min(500, newWidth));
    targetPanel.style.width = clamped + 'px';
  }

  function onMouseUp() {
    if (activeResizer) activeResizer.classList.remove('active');
    activeResizer = null;
    targetPanel = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  // Attach after DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    const rl = document.getElementById('tlResizerLeft');
    const rr = document.getElementById('tlResizerRight');
    if (rl) rl.addEventListener('mousedown', onMouseDown);
    if (rr) rr.addEventListener('mousedown', onMouseDown);
  });
})();

function loadPoolGrids() {
  if (!_brollPreviewFolderName || !_brollPreviewSections || _brollPreviewSections.length === 0) return;
  // Determine current section from selected clip
  if (_brollCurrentFlatIdx >= 0 && _brollFlatClips[_brollCurrentFlatIdx]) {
    _poolCurrentSection = _brollFlatClips[_brollCurrentFlatIdx].sectionIndex;
  } else {
    _poolCurrentSection = 0;
  }
  refreshPoolGrid('section');
  refreshPoolGrid('all');
}

async function refreshPoolGrid(mode) {
  if (!_brollPreviewFolderName) return;
  const isSection = mode === 'section';
  const gridEl = document.getElementById(isSection ? 'tlPoolGridSection' : 'tlPoolGridAll');
  const regenBtn = gridEl?.closest('.tl-side-panel')?.querySelector('.tl-side-panel-regen');
  if (!gridEl) return;

  // Update left panel title with current section number
  if (isSection) {
    const titleEl = gridEl.closest('.tl-side-panel')?.querySelector('.tl-side-panel-title');
    if (titleEl && _brollPreviewSections[_poolCurrentSection]) {
      titleEl.innerHTML = `<i class="fas fa-th"></i> Clips Sec ${_brollPreviewSections[_poolCurrentSection].secNum}`;
    }
  }

  gridEl.innerHTML = '<div class="tl-clip-grid-loading"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';
  if (regenBtn) regenBtn.classList.add('spinning');

  try {
    const params = new URLSearchParams({ limit: '6', videoOnly: '1' });
    if (isSection) params.set('section', _poolCurrentSection.toString());
    const resp = await fetch(`/api/broll-pool/${encodeURIComponent(_brollPreviewFolderName)}?${params}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');

    if (!data.clips || data.clips.length === 0) {
      gridEl.innerHTML = '<div class="tl-clip-grid-empty">No hay clips disponibles</div>';
      return;
    }

    gridEl.innerHTML = '';
    for (const pc of data.clips) {
      const div = document.createElement('div');
      div.className = 'tl-grid-clip' + (pc.isUsed ? ' is-used' : '');
      div.draggable = true;
      div.title = `${pc.sourceFile} (Sec ${pc.secNum})`;

      const thumbUrl = pc.thumbnail
        ? `/api/broll-thumbnail/${encodeURIComponent(_brollPreviewFolderName)}/${pc.thumbnail}?t=${Date.now()}`
        : '';
      div.innerHTML = `
        ${thumbUrl ? `<img src="${thumbUrl}" alt="${pc.sourceFile}" loading="lazy">` : '<div class="tl-grid-clip-placeholder"><i class="fas fa-image"></i></div>'}
        <span class="tl-grid-clip-badge ${pc.type}">${pc.type === 'video' ? 'VID' : 'IMG'}</span>
        <span class="tl-grid-clip-sec">S${pc.secNum}</span>
      `;

      // Drag start: set pool data
      div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({
          pool: true,
          secNum: pc.secNum,
          sourceFile: pc.sourceFile,
          type: pc.type,
          cutAt: pc.cutAt || 0
        }));
        e.dataTransfer.effectAllowed = 'copy';
        div.classList.add('dragging');
      });
      div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
      });

      gridEl.appendChild(div);
    }
  } catch (err) {
    gridEl.innerHTML = `<div class="tl-clip-grid-empty">Error: ${err.message}</div>`;
  } finally {
    if (regenBtn) regenBtn.classList.remove('spinning');
  }
}

async function adjustBrollPause(sectionIndex, delta) {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;
  const sec = _brollPreviewSections[sectionIndex];
  if (!sec) return;
  if (!sec.pauseClips) sec.pauseClips = [];

  if (delta > 0) {
    // Add one 3-second pause clip
    try {
      const res = await fetch('/api/broll-section-pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewId: _brollPreviewId, folderName: _brollPreviewFolderName, sectionIndex, action: 'add' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error agregando clip de pausa');
      sec.pauseClips = data.pauseClips;
      sec.pauseAfter = data.pauseAfter;
    } catch (err) {
      showNotification(`Error: ${err.message}`, 'error');
      return;
    }
  } else {
    // Remove last pause clip
    if (sec.pauseClips.length === 0) return;
    try {
      const res = await fetch('/api/broll-section-pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewId: _brollPreviewId, folderName: _brollPreviewFolderName, sectionIndex, action: 'remove' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error removiendo clip de pausa');
      sec.pauseClips = data.pauseClips;
      sec.pauseAfter = data.pauseAfter;
    } catch (err) {
      showNotification(`Error: ${err.message}`, 'error');
      return;
    }
  }

  _brollFlatClips = buildFlatClipList(_brollPreviewSections);
  renderBrollTimeline();
}

// Pause clip control functions — pass isPause:true to reuse existing endpoints
async function regeneratePauseClip(sectionIndex, clipIndex, btnEl) {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;
  const video = document.getElementById('tlPreviewVideo');
  const audio = document.getElementById('tlPreviewAudio');
  if (video) video.pause();
  if (audio) audio.pause();
  if (_brollImageTimer) { clearTimeout(_brollImageTimer); _brollImageTimer = null; }
  btnEl.classList.add('spinning');
  const flatIdx = _brollFlatClips.findIndex(f => f.sectionIndex === sectionIndex && f.clipIndex === clipIndex && f.isPause);
  try {
    const response = await fetch('/api/regenerate-broll-clip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewId: _brollPreviewId, folderName: _brollPreviewFolderName, sectionIndex, clipIndex, isPause: true })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error regenerando clip de pausa');
    _brollPreviewSections[sectionIndex].pauseClips[clipIndex] = data.clip;
    _brollFlatClips = buildFlatClipList(_brollPreviewSections);
    renderBrollTimeline();
    if (flatIdx !== -1) selectBrollClip(flatIdx);
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    btnEl.classList.remove('spinning');
  }
}

async function regeneratePauseClipCross(sectionIndex, clipIndex, btnEl) {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;
  const video = document.getElementById('tlPreviewVideo');
  const audio = document.getElementById('tlPreviewAudio');
  if (video) video.pause();
  if (audio) audio.pause();
  if (_brollImageTimer) { clearTimeout(_brollImageTimer); _brollImageTimer = null; }
  btnEl.classList.add('spinning');
  const flatIdx = _brollFlatClips.findIndex(f => f.sectionIndex === sectionIndex && f.clipIndex === clipIndex && f.isPause);
  try {
    const response = await fetch('/api/regenerate-broll-clip-cross', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewId: _brollPreviewId, folderName: _brollPreviewFolderName, sectionIndex, clipIndex, isPause: true })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error regenerando clip cross');
    _brollPreviewSections[sectionIndex].pauseClips[clipIndex] = data.clip;
    _brollFlatClips = buildFlatClipList(_brollPreviewSections);
    renderBrollTimeline();
    if (flatIdx !== -1) selectBrollClip(flatIdx);
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    btnEl.classList.remove('spinning');
  }
}

window.shiftPauseClip = async function(sectionIndex, clipIndex, shiftSeconds, btnEl) {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;
  const oldIcon = btnEl.innerHTML;
  btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  btnEl.classList.add('spinning');
  btnEl.disabled = true;
  try {
    const res = await fetch('/api/shift-broll-clip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewId: _brollPreviewId, folderName: _brollPreviewFolderName, sectionIndex, clipIndex, shiftSeconds, isPause: true })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error desplazando clip');
    if (data.atLimit) {
      showNotification('No se puede mover más el clip en esa dirección', 'warning');
    } else {
      const flatIdx = _brollFlatClips.findIndex(f => f.sectionIndex === sectionIndex && f.clipIndex === clipIndex && f.isPause);
      _brollPreviewSections[sectionIndex].pauseClips[clipIndex] = data.clip;
      _brollFlatClips = buildFlatClipList(_brollPreviewSections);
      renderBrollTimeline();
      if (flatIdx !== -1) selectBrollClip(flatIdx);
    }
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    btnEl.innerHTML = oldIcon;
    btnEl.classList.remove('spinning');
    btnEl.disabled = false;
  }
};

async function replacePauseClipWithImage(sectionIndex, clipIndex, btnEl) {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;
  const video = document.getElementById('tlPreviewVideo');
  const audio = document.getElementById('tlPreviewAudio');
  if (video) video.pause();
  if (audio) audio.pause();
  if (_brollImageTimer) { clearTimeout(_brollImageTimer); _brollImageTimer = null; }
  btnEl.classList.add('spinning');
  const flatIdx = _brollFlatClips.findIndex(f => f.sectionIndex === sectionIndex && f.clipIndex === clipIndex && f.isPause);
  try {
    const response = await fetch('/api/replace-broll-clip-with-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewId: _brollPreviewId, folderName: _brollPreviewFolderName, sectionIndex, clipIndex, isPause: true })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error reemplazando clip');
    _brollPreviewSections[sectionIndex].pauseClips[clipIndex] = data.clip;
    _brollFlatClips = buildFlatClipList(_brollPreviewSections);
    renderBrollTimeline();
    if (flatIdx !== -1) selectBrollClip(flatIdx);
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    btnEl.classList.remove('spinning');
  }
}

// ─── Transition picker ────────────────────────────────────────────────────────
const _TRANSITION_LABELS = {
  fade: 'Dissolve', fadeblack: 'A negro', fadewhite: 'A blanco',
  wipeleft: 'Barrido ←', wiperight: 'Barrido →', wipeup: 'Barrido ↑', wipedown: 'Barrido ↓',
  slideleft: 'Desliz ←', slideright: 'Desliz →',
  circlecrop: 'Círculo', radial: 'Radial', zoomin: 'Zoom',
  hblur: 'Blur H', squeezeh: 'Spaghetti', pixelize: 'Píxeles', dissolve: 'Ruido'
};
const _ALL_TRANSITIONS = Object.keys(_TRANSITION_LABELS);

function _transitionLabel(t) {
  return _TRANSITION_LABELS[t] || t;
}

function openTransitionPicker(sectionIndex, clipIndex, badgeEl) {
  // Remove any existing picker
  document.querySelectorAll('.tl-transition-picker').forEach(p => p.remove());

  const picker = document.createElement('div');
  picker.className = 'tl-transition-picker';
  picker.innerHTML = `
    <div class="tl-transition-picker-header">
      <span>Transición</span>
      <button class="tl-transition-picker-close" onclick="this.closest('.tl-transition-picker').remove()">×</button>
    </div>
    <button class="tl-transition-option tl-transition-cut-opt" data-value="">✂ Corte directo</button>
    <div class="tl-transition-picker-grid">
      ${_ALL_TRANSITIONS.map(t => `<button class="tl-transition-option" data-value="${t}">${_TRANSITION_LABELS[t]}</button>`).join('')}
    </div>
    <button class="tl-transition-option tl-transition-random-opt" data-value="__random__">🎲 Aleatorio</button>
  `;

  // Highlight current
  const cur = _brollPreviewSections?.[sectionIndex]?.clips?.[clipIndex]?.transitionOut;
  picker.querySelectorAll('[data-value]').forEach(btn => {
    if (btn.dataset.value === (cur || '')) btn.classList.add('active');
  });

  picker.querySelectorAll('.tl-transition-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      let val = btn.dataset.value;
      if (val === '__random__') val = _ALL_TRANSITIONS[Math.floor(Math.random() * _ALL_TRANSITIONS.length)];
      await setClipTransition(sectionIndex, clipIndex, val || null);
      picker.remove();
    });
  });

  // Position near badge
  document.body.appendChild(picker);
  const rect = badgeEl.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.top = (rect.bottom + 6) + 'px';
  picker.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
  picker.style.zIndex = '9999';

  const close = (e) => { if (!picker.contains(e.target) && e.target !== badgeEl) { picker.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 10);
}

async function setClipTransition(sectionIndex, clipIndex, transition) {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;
  try {
    const res = await fetch('/api/set-clip-transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewId: _brollPreviewId, folderName: _brollPreviewFolderName, sectionIndex, clipIndex, transition })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    _brollPreviewSections[sectionIndex].clips[clipIndex].transitionOut = data.transitionOut;
    renderBrollTimeline();
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'error');
  }
}

async function openAssetsFolder() {
  try {
    const res = await fetch('/api/open-assets-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'error');
  }
}

function selectBrollClip(flatIdx) {
  _brollCurrentFlatIdx = flatIdx;
  document.querySelectorAll('.tl-clip.selected').forEach(e => e.classList.remove('selected'));
  const el = document.querySelector(`.tl-clip[data-flat="${flatIdx}"]`);
  if (el) {
    el.classList.add('selected');
    // Only smooth scroll when user clicks; instant during auto-advance
    el.scrollIntoView({ behavior: _brollIsAutoAdvancing ? 'instant' : 'smooth', block: 'nearest', inline: 'center' });
  }

  // Start background music on first clip selection
  if (_tlBgMusicAudio && _tlBgMusicUrl && _tlBgMusicAudio.paused) {
    startMusicPreview();
  }

  const item = _brollFlatClips[flatIdx];
  if (!item) return;

  // Update left panel if section changed
  if (item.sectionIndex !== _poolCurrentSection) {
    _poolCurrentSection = item.sectionIndex;
    refreshPoolGrid('section');
  }

  playBrollClipPreview(item);
}

function advanceToNextClip() {
  const next = _brollCurrentFlatIdx + 1;
  if (next < _brollFlatClips.length) {
    const cur = _brollFlatClips[_brollCurrentFlatIdx];
    const nxt = _brollFlatClips[next];
    const sameSection = cur && nxt && cur.secNum === nxt.secNum;

    // If switching sections AND TTS audio is still playing, wait for it to finish
    if (!sameSection && !cur?.isPause) {
      const audio = document.getElementById('tlPreviewAudio');
      if (audio && !audio.paused && audio.currentTime < audio.duration - 0.3) {
        // Keep last clip's video frame visible while audio finishes
        // Loop the video or freeze last frame
        const activeVid = getActiveVideo();
        if (activeVid && activeVid.ended) {
          // Replay last second to keep visual alive while audio finishes
          activeVid.currentTime = Math.max(0, activeVid.duration - 1);
          activeVid.play().catch(() => {});
        }
        // Audio still playing — wait for it to end before advancing
        const onAudioEnd = () => {
          audio.removeEventListener('ended', onAudioEnd);
          audio.removeEventListener('pause', onAudioEnd);
          _brollIsAutoAdvancing = true;
          selectBrollClip(next);
          _brollIsAutoAdvancing = false;
        };
        audio.addEventListener('ended', onAudioEnd);
        audio.addEventListener('pause', onAudioEnd);
        return; // Don't advance yet
      }
    }

    // Set auto-advancing flag for ALL transitions (not just same section)
    // This prevents video.onpause from killing the audio during clip swap
    _brollIsAutoAdvancing = true;
    selectBrollClip(next);
    _brollIsAutoAdvancing = false;
  } else {
    // All main clips done - play end screen if present
    if (_tlEndScreenUrl) {
      playEndScreenPreview();
    } else {
      stopBrollAudio();
    }
  }
}

function preloadNextClip(currentFlatIdx) {
  const nextIdx = currentFlatIdx + 1;
  if (nextIdx >= _brollFlatClips.length) return;
  const nextItem = _brollFlatClips[nextIdx];
  if (!nextItem || nextItem.clip.type !== 'video') return;
  // Load into the standby video element
  const standby = document.querySelector('.tl-vid-standby');
  if (!standby) return;
  const urlBase = nextItem.isPause
    ? `/api/broll-pause-preview/${_brollPreviewFolderName}/${nextItem.sectionIndex}/${nextItem.clipIndex}`
    : `/api/broll-clip-preview/${_brollPreviewFolderName}/${nextItem.sectionIndex}/${nextItem.clipIndex}`;
  const url = `${urlBase}?t=${Date.now()}`;
  if (standby.dataset.preloadUrl === url) return; // already preloading this one
  standby.dataset.preloadUrl = url;
  standby.src = url;
  standby.load();
}

function clearVideoHandlers(vid) {
  if (!vid) return;
  vid.oncanplay = null;
  vid.onended = null;
  vid.onpause = null;
  vid.onplay = null;
  vid.onerror = null;
}

function swapVideoBuffers() {
  const active = document.querySelector('.tl-vid-active');
  const standby = document.querySelector('.tl-vid-standby');
  if (!active || !standby) return false;
  if (!standby.src || standby.readyState < 2) return false;

  // Clear handlers BEFORE pausing to prevent old onpause from killing audio
  clearVideoHandlers(active);
  clearVideoHandlers(standby);
  active.pause();

  // Swap classes (z-index swap = instant visual switch)
  active.classList.remove('tl-vid-active');
  active.classList.add('tl-vid-standby');
  active.removeAttribute('controls');
  standby.classList.remove('tl-vid-standby');
  standby.classList.add('tl-vid-active');
  standby.setAttribute('controls', '');

  // Clear old (now standby) for next preload
  active.removeAttribute('src');
  active.dataset.preloadUrl = '';

  return true;
}

function getActiveVideo() {
  return document.querySelector('.tl-vid-active');
}

function bindVideoHandlers(video, audio, audioOffset, loading, isContinuous) {
  video.oncanplay = () => {
    if (loading) loading.classList.remove('active');
    video.play().catch(() => {});
    if (audio) {
      if (!isContinuous) audio.currentTime = audioOffset;
      audio.play().catch(() => {});
    }
    preloadNextClip(_brollCurrentFlatIdx);
  };
  video.onended = () => { advanceToNextClip(); };
  video.onpause = () => {
    // Only pause audio if user manually paused (not during auto-advance/swap)
    if (!_brollIsAutoAdvancing) {
      if (audio) audio.pause();
      if (_tlBgMusicAudio) _tlBgMusicAudio.pause();
    }
  };
  video.onplay = () => {
    if (audio) {
      if (!isContinuous) audio.currentTime = audioOffset + video.currentTime;
      audio.play().catch(() => {});
    }
    if (_tlBgMusicAudio && _tlBgMusicUrl) _tlBgMusicAudio.play().catch(() => {});
  };
  video.onerror = () => { if (loading) loading.classList.remove('active'); };
}

function playBrollClipPreview(item) {
  if (!_brollPreviewFolderName) return;
  const { sectionIndex, clipIndex, secNum, clip, audioOffset, isPause } = item;

  const image = document.getElementById('tlPreviewImage');
  const loading = document.getElementById('tlPreviewLoading');
  const placeholder = document.getElementById('tlPreviewPlaceholder');
  const title = document.getElementById('tlPreviewTitle');
  const meta = document.getElementById('tlPreviewMeta');
  const audio = document.getElementById('tlPreviewAudio');
  const sameSectionAutoAdvance = _brollIsAutoAdvancing;

  if (placeholder) placeholder.style.display = 'none';

  if (isPause) {
    if (title) title.textContent = `Sección ${secNum} - Pausa (solo música)`;
    if (meta) meta.textContent = `${clip.duration.toFixed(1)}s  ·  Sin narración`;
  } else {
    if (title) title.textContent = `Sección ${secNum} - Clip ${clipIndex + 1}: ${clip.sourceFile}`;
    if (meta) {
      const parts = [
        clip.type === 'video' ? 'Video' : 'Imagen',
        `${clip.duration.toFixed(1)}s`,
        clip.type === 'video' ? `Corte desde ${formatSeconds(clip.cutFrom)}` : null,
        `TTS offset: ${formatSeconds(audioOffset)}`
      ].filter(Boolean);
      meta.textContent = parts.join('  ·  ');
    }
  }

  // Pause clips: mute TTS, swell background music
  if (isPause) {
    if (audio) { audio.pause(); audio.currentTime = 0; }
    // Swell music to 70% of max
    if (_tlBgMusicAudio && _tlBgMusicUrl) {
      const baseVol = (parseInt(document.getElementById('tlMusicVolume')?.value) || 20) / 100;
      const targetVol = Math.min(0.7, baseVol * 3.5);
      _swellMusicTo(_tlBgMusicAudio, targetVol, 800);
      if (_tlBgMusicAudio.paused) _tlBgMusicAudio.play().catch(() => {});
    }
  } else {
    // Restore music to normal volume when not a pause
    if (_tlBgMusicAudio && _tlBgMusicUrl) {
      const baseVol = (parseInt(document.getElementById('tlMusicVolume')?.value) || 20) / 100;
      _swellMusicTo(_tlBgMusicAudio, baseVol, 800);
    }
  }

  // Audio: always reload on section change, let it run continuously within a section.
  const isSameSection = audio && audio.dataset.currentSec === String(secNum);
  const isContinuous = sameSectionAutoAdvance && isSameSection;
  if (!isPause && !isContinuous) {
    if (audio) {
      const audioSrc = `/api/broll-section-audio/${_brollPreviewFolderName}/${secNum}`;
      if (!isSameSection) {
        audio.src = audioSrc;
        audio.dataset.currentSec = String(secNum);
      }
      audio.currentTime = audioOffset;
    }
  }

  if (_brollImageTimer) { clearTimeout(_brollImageTimer); _brollImageTimer = null; }

  // Build preview URL: regular clips vs pause clips use different paths
  const previewUrlBase = isPause
    ? `/api/broll-pause-preview/${_brollPreviewFolderName}/${sectionIndex}/${clipIndex}`
    : `/api/broll-clip-preview/${_brollPreviewFolderName}/${sectionIndex}/${clipIndex}`;

  if (clip.type === 'image') {
    const activeVid = getActiveVideo();
    if (activeVid) { clearVideoHandlers(activeVid); activeVid.pause(); }
    image.style.display = 'block';
    image.src = `${previewUrlBase}?t=${Date.now()}`;
    if (loading) loading.classList.remove('active');
    if (!isPause && audio) audio.play().catch(() => {});
    _brollImageTimer = setTimeout(() => { _brollImageTimer = null; advanceToNextClip(); }, clip.duration * 1000);
    preloadNextClip(_brollCurrentFlatIdx);
  } else {
    image.style.display = 'none';

    // Try double-buffer swap (instant, no flash)
    const swapped = sameSectionAutoAdvance && swapVideoBuffers();
    const video = getActiveVideo();
    if (!video) return;

    // Bind fresh handlers on the current active video
    bindVideoHandlers(video, isPause ? null : audio, audioOffset, loading, isContinuous);

    if (swapped) {
      if (loading) loading.classList.remove('active');
      video.play().catch(() => {});
      if (!isPause && audio) {
        if (!isContinuous) audio.currentTime = audioOffset;
        audio.play().catch(() => {});
      }
      preloadNextClip(_brollCurrentFlatIdx);
    } else {
      if (loading) loading.classList.add('active');
      video.src = `${previewUrlBase}?t=${Date.now()}`;
      video.load();
    }
  }
}

async function regenerateBrollClip(sectionIndex, clipIndex, btnEl) {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;

  // Pause current playback immediately
  const video = document.getElementById('tlPreviewVideo');
  const audio = document.getElementById('tlPreviewAudio');
  if (video) video.pause();
  if (audio) audio.pause();
  if (_brollImageTimer) { clearTimeout(_brollImageTimer); _brollImageTimer = null; }

  btnEl.classList.add('spinning');

  // Find the flat index for this clip
  const flatIdx = _brollFlatClips.findIndex(f => f.sectionIndex === sectionIndex && f.clipIndex === clipIndex);

  try {
    const response = await fetch('/api/regenerate-broll-clip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewId: _brollPreviewId, folderName: _brollPreviewFolderName, sectionIndex, clipIndex })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error regenerando clip');

    // Update local data
    _brollPreviewSections[sectionIndex].clips[clipIndex] = data.clip;
    _brollFlatClips = buildFlatClipList(_brollPreviewSections);

    // Update thumbnail
    const clipEl = document.querySelector(`.tl-clip[data-section="${sectionIndex}"][data-clip="${clipIndex}"]`);
    if (clipEl) {
      const thumbImg = clipEl.querySelector('.tl-clip-thumb');
      const placeholder = clipEl.querySelector('.tl-clip-thumb-placeholder');
      if (data.clip.thumbnail) {
        const newSrc = `/api/broll-thumbnail/${_brollPreviewFolderName}/${data.clip.thumbnail}?t=${Date.now()}`;
        if (thumbImg) { thumbImg.src = newSrc; }
        else if (placeholder) {
          const img = document.createElement('img');
          img.className = 'tl-clip-thumb'; img.src = newSrc; img.alt = 'clip';
          placeholder.replaceWith(img);
        }
      }
      const sourceEl = clipEl.querySelector('.tl-clip-source');
      if (sourceEl) { sourceEl.textContent = data.clip.sourceFile; sourceEl.title = data.clip.sourceFile; }

      // Update type badge (may switch image→video)
      const badge = clipEl.querySelector('.tl-clip-type-badge');
      if (badge) { badge.className = `tl-clip-type-badge ${data.clip.type}`; badge.textContent = data.clip.type === 'video' ? 'VID' : 'IMG'; }

      // Flash green
      clipEl.style.transition = 'none';
      clipEl.style.borderColor = '#10b981';
      clipEl.style.boxShadow = '0 0 12px rgba(16,185,129,0.4)';
      setTimeout(() => { clipEl.style.transition = 'all 0.3s'; clipEl.style.borderColor = ''; clipEl.style.boxShadow = ''; }, 800);
    }

    // Auto-play the regenerated clip from start and continue from there
    if (flatIdx !== -1) {
      selectBrollClip(flatIdx);
    }
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    btnEl.classList.remove('spinning');
  }
}

async function regenerateBrollClipCross(sectionIndex, clipIndex, btnEl) {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;

  const video = document.getElementById('tlPreviewVideo');
  const audio = document.getElementById('tlPreviewAudio');
  if (video) video.pause();
  if (audio) audio.pause();
  if (_brollImageTimer) { clearTimeout(_brollImageTimer); _brollImageTimer = null; }

  btnEl.classList.add('spinning');

  const flatIdx = _brollFlatClips.findIndex(f => f.sectionIndex === sectionIndex && f.clipIndex === clipIndex);

  try {
    const response = await fetch('/api/regenerate-broll-clip-cross', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewId: _brollPreviewId, folderName: _brollPreviewFolderName, sectionIndex, clipIndex })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error regenerando clip cross-section');

    _brollPreviewSections[sectionIndex].clips[clipIndex] = data.clip;
    _brollFlatClips = buildFlatClipList(_brollPreviewSections);

    // If the clip type changed (e.g. image → video), do a full timeline re-render
    renderBrollTimeline();

    const clipEl = document.querySelector(`.tl-clip[data-section="${sectionIndex}"][data-clip="${clipIndex}"]`);
    if (clipEl) {
      // Flash orange for cross-section
      clipEl.style.transition = 'none';
      clipEl.style.borderColor = '#f59e0b';
      clipEl.style.boxShadow = '0 0 12px rgba(245,158,11,0.4)';
      setTimeout(() => { clipEl.style.transition = 'all 0.3s'; clipEl.style.borderColor = ''; clipEl.style.boxShadow = ''; }, 800);
    }

    if (flatIdx !== -1) {
      selectBrollClip(flatIdx);
    }
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    btnEl.classList.remove('spinning');
  }
}

window.shiftBrollClip = async function(sectionIndex, clipIndex, shiftSeconds, btnEl) {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;
  const oldIcon = btnEl.innerHTML;
  btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  btnEl.classList.add('spinning');
  btnEl.disabled = true;

  try {
    const res = await fetch('/api/shift-broll-clip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        previewId: _brollPreviewId,
        folderName: _brollPreviewFolderName,
        sectionIndex,
        clipIndex,
        shiftSeconds
      })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error desplazando clip');

    if (data.atLimit) {
      showNotification('No se puede mover más el clip en esa dirección', 'warning');
    } else {
      const flatIdx = _brollFlatClips.findIndex(f => f.sectionIndex === sectionIndex && f.clipIndex === clipIndex);
      _brollPreviewSections[sectionIndex].clips[clipIndex] = data.clip;
      _brollFlatClips = buildFlatClipList(_brollPreviewSections);
      renderBrollTimeline();
      if (flatIdx !== -1) selectBrollClip(flatIdx);
      showNotification(`Clip ajustado ${shiftSeconds > 0 ? '+5s' : '-5s'}`, 'success');
    }
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    btnEl.innerHTML = oldIcon;
    btnEl.classList.remove('spinning');
    btnEl.disabled = false;
  }
};

async function replaceBrollClipWithImage(sectionIndex, clipIndex, btnEl) {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;

  const video = document.getElementById('tlPreviewVideo');
  const audio = document.getElementById('tlPreviewAudio');
  if (video) video.pause();
  if (audio) audio.pause();
  if (_brollImageTimer) { clearTimeout(_brollImageTimer); _brollImageTimer = null; }

  btnEl.classList.add('spinning');

  const flatIdx = _brollFlatClips.findIndex(f => f.sectionIndex === sectionIndex && f.clipIndex === clipIndex);

  try {
    const response = await fetch('/api/replace-broll-clip-with-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewId: _brollPreviewId, folderName: _brollPreviewFolderName, sectionIndex, clipIndex })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error reemplazando clip');

    // Update local data
    _brollPreviewSections[sectionIndex].clips[clipIndex] = data.clip;
    _brollFlatClips = buildFlatClipList(_brollPreviewSections);

    // Update DOM clip element
    const clipEl = document.querySelector(`.tl-clip[data-section="${sectionIndex}"][data-clip="${clipIndex}"]`);
    if (clipEl) {
      // Update type badge
      const badge = clipEl.querySelector('.tl-clip-type-badge');
      if (badge) { badge.className = 'tl-clip-type-badge image'; badge.textContent = 'IMG'; }

      // Update thumbnail
      const thumbImg = clipEl.querySelector('.tl-clip-thumb');
      const placeholder = clipEl.querySelector('.tl-clip-thumb-placeholder');
      if (data.clip.thumbnail) {
        const newSrc = `/api/broll-thumbnail/${_brollPreviewFolderName}/${data.clip.thumbnail}?t=${Date.now()}`;
        if (thumbImg) { thumbImg.src = newSrc; }
        else if (placeholder) {
          const img = document.createElement('img');
          img.className = 'tl-clip-thumb'; img.src = newSrc; img.alt = 'clip';
          placeholder.replaceWith(img);
        }
      }
      const sourceEl = clipEl.querySelector('.tl-clip-source');
      if (sourceEl) { sourceEl.textContent = data.clip.sourceFile; sourceEl.title = data.clip.sourceFile; }

      // Flash purple to indicate image swap
      clipEl.style.transition = 'none';
      clipEl.style.borderColor = '#a855f7';
      clipEl.style.boxShadow = '0 0 12px rgba(168,85,247,0.5)';
      setTimeout(() => { clipEl.style.transition = 'all 0.3s'; clipEl.style.borderColor = ''; clipEl.style.boxShadow = ''; }, 800);
    }

    if (flatIdx !== -1) selectBrollClip(flatIdx);
    showNotification('Clip reemplazado con imagen', 'success');
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    btnEl.classList.remove('spinning');
  }
}

async function regenerateAllBrollClips() {
  if (!_brollPreviewFolderName) return;
  stopBrollAudio();
  const btn = document.getElementById('tlRegenerateAllBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Regenerando...'; }

  try {
    // Detect if there are Whisper timestamps to reuse
    const hasWhisperData = _brollPreviewSections?.some(s => s.clips?.some(c => typeof c.audioStart === 'number'));

    // Detect if any clip has a Remotion AI clip already (or if triangle mix includes remotion)
    const hasExistingAiClips = _brollPreviewSections?.some(s => s.clips?.some(c => c.type === 'ai_clip' || c.aiClipPath));
    const shouldRegenerateAI = (_clipMixWeights.remotion + _clipMixWeights.web) > 0.01 || hasExistingAiClips;

    // Step 1: regenerate the preview structure (reuse Whisper segments if available)
    const response = await fetch('/api/generate-broll-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: _brollPreviewFolderName,
        videoConfig: getVideoConfig(),
        keepSegments: hasWhisperData,
        useTransitions: document.getElementById('brollUseTransitionsToggle')?.checked !== false
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error regenerando');

    _brollPreviewId = data.previewId;
    _brollPreviewSections = data.sections;
    _brollFlatClips = buildFlatClipList(data.sections);
    renderBrollTimeline();
    showBrollTimelinePanel();

    // Step 2: re-queue all Remotion AI clips with current settings
    if (shouldRegenerateAI) {
      // Auto-prefetch web images if toggle is on
      const webToggle = document.getElementById('brollAIWebImagesToggle');
      if (webToggle?.checked && _webImagesPrefetchedForPreviewId !== _brollPreviewId) {
        await prefetchWebImages(true);
      }

      // Use triangle weights to distribute clips per section (not globally)
      const effectiveWeights = (_clipMixWeights.remotion + _clipMixWeights.web) > 0.01
        ? _clipMixWeights
        : { broll: 0.5, remotion: 0.5, web: 0 };
      let totalQueued = 0;
      for (let sIdx = 0; sIdx < (_brollPreviewSections || []).length; sIdx++) {
        const sectionClips = _brollFlatClips.filter(f => !f.isPause && f.sectionIndex === sIdx);
        const N = sectionClips.length;
        if (N === 0) continue;

        const nBroll    = Math.round(effectiveWeights.broll * N);
        const nWeb      = Math.round(effectiveWeights.web * N);
        const nRemotion = N - nBroll - nWeb;
        const types = [
          ...Array(nBroll).fill('broll'),
          ...Array(Math.max(0, nWeb)).fill('web'),
          ...Array(Math.max(0, nRemotion)).fill('remotion'),
        ];
        for (let i = types.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [types[i], types[j]] = [types[j], types[i]];
        }
        for (let i = 0; i < N; i++) {
          const type = types[i] || 'broll';
          if (type === 'broll') continue;
          const { sectionIndex, clipIndex } = sectionClips[i];
          generateAIClip(sectionIndex, clipIndex, type === 'web');
          totalQueued++;
        }
      }
      showNotification(`Timeline regenerado — generando ${totalQueued} clips Remotion IA...`, 'success');
    } else {
      showNotification('Timeline regenerado', 'success');
    }
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt"></i> Regenerar Todo'; }
  }
}

async function confirmBrollRender() {
  if (!_brollPreviewId || !_brollPreviewFolderName) return;
  closeBrollTimeline();

  const btn = document.getElementById('generateBrollVideoBtn');
  isGeneratingVideo = true;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Renderizando...</span>'; }

  const progressContainer = document.getElementById('brollVideoProgressContainer');
  const progressBar = document.getElementById('brollVideoProgressBar');
  const progressPercent = document.getElementById('brollVideoProgressPercent');
  const progressInfo = document.getElementById('brollVideoProgressInfo');
  const progressLabel = document.getElementById('brollVideoProgressLabel');
  if (progressContainer) progressContainer.style.display = 'block';

  let pollInterval = null;

  try {
    // Upload end screen clip and background music if present
    let endScreenPath = null;
    let bgMusicPath = null;
    const musicVolume = parseInt(document.getElementById('tlMusicVolume')?.value) || 13;

    if (_tlEndScreenFile || _tlBgMusicFile) {
      const formData = new FormData();
      formData.append('folderName', _brollPreviewFolderName);
      if (_tlEndScreenFile) formData.append('endScreenClip', _tlEndScreenFile);
      if (_tlBgMusicFile) formData.append('bgMusic', _tlBgMusicFile);

      const uploadRes = await fetch('/api/broll-upload-assets', { method: 'POST', body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Error subiendo archivos');
      endScreenPath = uploadData.endScreenPath || null;
      bgMusicPath = uploadData.bgMusicPath || null;
    }

    const response = await fetch('/api/render-broll-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        previewId: _brollPreviewId,
        folderName: _brollPreviewFolderName,
        videoConfig: getVideoConfig(),
        endScreenPath,
        bgMusicPath,
        bgMusicVolume: musicVolume / 100
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error del servidor');

    pollInterval = setInterval(async () => {
      try {
        const progRes = await fetch(`/api/broll-video-progress/${data.sessionId}`);
        const progData = await progRes.json();
        if (!progData.success) return;
        const p = progData.progress;
        const pct = Math.round(p.percent || 0);

        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressPercent) progressPercent.textContent = `${pct}%`;
        if (progressLabel) progressLabel.textContent = p.message || 'Renderizando...';
        if (progressInfo) progressInfo.textContent = p.detail || '';

        if (p.status === 'completed') {
          clearInterval(pollInterval);
          if (progressBar) progressBar.style.width = '100%';
          if (progressPercent) progressPercent.textContent = '100%';
          if (progressLabel) progressLabel.textContent = 'Video generado exitosamente';
          if (progressInfo) progressInfo.textContent = p.outputFile ? `Guardado: ${p.outputFile}` : '';
          showNotification('Video con B-Roll generado!', 'success');
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-clapperboard"></i><span>Generar Video con B-Roll</span>'; }
          isGeneratingVideo = false;
          showBrollTranslatePanel(p.outputFile, _brollPreviewFolderName, p.bgMusicFile, p.bgMusicVolume);
          // Reload the editor so user can keep editing after render
          if (_brollPreviewFolderName) loadExistingBrollTimeline(_brollPreviewFolderName);
        } else if (p.status === 'error') {
          clearInterval(pollInterval);
          throw new Error(p.error || 'Error durante el renderizado');
        }
      } catch (pollErr) { /* retry */ }
    }, 1500);

  } catch (error) {
    if (pollInterval) clearInterval(pollInterval);
    showNotification(`Error: ${error.message}`, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-clapperboard"></i><span>Generar Video con B-Roll</span>'; }
    isGeneratingVideo = false;
    if (progressContainer) progressContainer.style.display = 'none';
  }
}

// ===== TRANSLATE BROLL VIDEO =====

let _brollTranslateData = { videoFile: null, folderName: null, bgMusicFile: null, bgMusicVolume: 0.13 };

async function checkAndShowTranslatePanel(folderName) {
  try {
    const resp = await fetch(`/api/projects/${folderName}/rendered-videos`);
    const data = await resp.json();
    if (!data.success || !data.videos || data.videos.length === 0) return;

    // Prefer the video saved in project_state (last rendered), else pick the latest file
    const targetVideo = data.lastRenderedVideo || data.videos[data.videos.length - 1];
    const musicSlider = document.getElementById('bgMusicVolume');
    const vol = musicSlider ? parseInt(musicSlider.value) / 100 : 0.13;
    showBrollTranslatePanel(targetVideo, folderName, data.bgMusicFile, vol);
  } catch (e) { /* ignore */ }
}

function showBrollTranslatePanel(videoFile, folderName, bgMusicFile, bgMusicVolume) {
  _brollTranslateData = { videoFile, folderName, bgMusicFile, bgMusicVolume: bgMusicVolume || 0.13 };
  const panel = document.getElementById('brollTranslatePanel');
  if (panel) {
    panel.style.display = 'block';
    loadTranslateApplioVoices().then(() => restoreBrollTranslatePrefs());
  }
  // Show YouTube upload panel for this rendered video
  showYouTubeUploadPanel(videoFile, folderName);
}

function onTranslateTtsChange() {
  const provider = document.querySelector('input[name="brollTtsProvider"]:checked')?.value || 'applio';
  const applioDiv = document.getElementById('translateApplioVoiceDiv');
  const googleDiv = document.getElementById('translateGoogleVoiceDiv');
  const cloudDiv = document.getElementById('translateCloudVoiceDiv');
  if (applioDiv) applioDiv.style.display = provider === 'applio' ? '' : 'none';
  if (googleDiv) googleDiv.style.display = (provider === 'google' || provider === 'google_pro') ? '' : 'none';
  if (cloudDiv) cloudDiv.style.display = (provider === 'google_cloud' || provider === 'google_wavenet') ? '' : 'none';
}

async function loadTranslateApplioVoices() {
  try {
    const resp = await fetch('/api/applio-voices');
    const data = await resp.json();
    const sel = document.getElementById('translateApplioVoice');
    if (!sel || !data.voices) return;
    sel.innerHTML = '';
    data.voices.forEach(voice => {
      const opt = document.createElement('option');
      opt.value = voice.path || voice;
      opt.textContent = voice.displayName || voice;
      sel.appendChild(opt);
    });
  } catch (e) { console.error('Error loading Applio voices:', e); }
}

function saveBrollTranslatePrefs() {
  try {
    const prefs = {
      ttsProvider: document.querySelector('input[name="brollTtsProvider"]:checked')?.value,
      translationModel: document.querySelector('input[name="brollTranslationModel"]:checked')?.value,
      transcriptionMethod: document.querySelector('input[name="brollTranscription"]:checked')?.value,
      applioVoice: document.getElementById('translateApplioVoice')?.value,
      applioGender: document.querySelector('input[name="brollApplioGender"]:checked')?.value,
      googleVoice: document.getElementById('translateGoogleVoice')?.value,
      cloudVoice: document.querySelector('input[name="brollCloudVoice"]:checked')?.value,
      groupSize: document.getElementById('brollGroupSize')?.value,
      podcastStyle: document.getElementById('brollPodcastStyle')?.checked,
      keepTemp: document.getElementById('brollKeepTemp')?.checked,
      endScreenSeconds: document.getElementById('brollEndScreenSeconds')?.value,
      localModel: document.getElementById('brollLocalModel')?.value,
      languages: Array.from(document.querySelectorAll('#translateLangChecks input[type="checkbox"]')).map(cb => ({ value: cb.value, checked: cb.checked })),
    };
    localStorage.setItem('brollTranslatePrefs', JSON.stringify(prefs));
  } catch (e) {}
}

function restoreBrollTranslatePrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem('brollTranslatePrefs'));
    if (!prefs) return;

    // TTS Provider
    if (prefs.ttsProvider) {
      const r = document.querySelector(`input[name="brollTtsProvider"][value="${prefs.ttsProvider}"]`);
      if (r) { r.checked = true; onTranslateTtsChange(); }
    }
    // Translation Model
    if (prefs.translationModel) {
      const r = document.querySelector(`input[name="brollTranslationModel"][value="${prefs.translationModel}"]`);
      if (r) r.checked = true;
    }
    // Transcription Method
    if (prefs.transcriptionMethod) {
      const r = document.querySelector(`input[name="brollTranscription"][value="${prefs.transcriptionMethod}"]`);
      if (r) r.checked = true;
    }
    // Applio Voice
    if (prefs.applioVoice) {
      const sel = document.getElementById('translateApplioVoice');
      if (sel) {
        const match = Array.from(sel.options).find(o => o.value === prefs.applioVoice);
        if (match) match.selected = true;
      }
    }
    // Applio Gender
    if (prefs.applioGender) {
      const r = document.querySelector(`input[name="brollApplioGender"][value="${prefs.applioGender}"]`);
      if (r) r.checked = true;
    }
    // Google Voice
    if (prefs.googleVoice) {
      const sel = document.getElementById('translateGoogleVoice');
      if (sel) sel.value = prefs.googleVoice;
    }
    // Cloud Voice
    if (prefs.cloudVoice) {
      const r = document.querySelector(`input[name="brollCloudVoice"][value="${prefs.cloudVoice}"]`);
      if (r) r.checked = true;
    }
    // Group Size
    if (prefs.groupSize) {
      const slider = document.getElementById('brollGroupSize');
      const label = document.getElementById('brollGroupSizeVal');
      if (slider) { slider.value = prefs.groupSize; if (label) label.textContent = prefs.groupSize; }
    }
    // Checkboxes
    if (prefs.podcastStyle !== undefined) {
      const el = document.getElementById('brollPodcastStyle');
      if (el) el.checked = prefs.podcastStyle;
    }
    if (prefs.keepTemp !== undefined) {
      const el = document.getElementById('brollKeepTemp');
      if (el) el.checked = prefs.keepTemp;
    }
    // End Screen
    if (prefs.endScreenSeconds !== undefined) {
      const el = document.getElementById('brollEndScreenSeconds');
      if (el) el.value = prefs.endScreenSeconds;
    }
    // Languages
    if (prefs.languages && Array.isArray(prefs.languages)) {
      prefs.languages.forEach(lang => {
        const cb = document.querySelector(`#translateLangChecks input[value="${lang.value}"]`);
        if (cb) cb.checked = lang.checked;
      });
    }
    // Local Model
    if (prefs.localModel) {
      const sel = document.getElementById('brollLocalModel');
      if (sel) {
        const match = Array.from(sel.options).find(o => o.value === prefs.localModel);
        if (match) match.selected = true;
      }
    }
    // Trigger LLM change to show/hide local model selector
    onBrollLlmChange();
  } catch (e) { console.error('Error restoring translate prefs:', e); }
}

// Ollama local LLM controls
let _ollamaModelsCache = null;

async function loadOllamaModels(selectId = 'brollLocalModel', statusId = 'brollOllamaStatus') {
  const sel = document.getElementById(selectId);
  const statusEl = document.getElementById(statusId);
  if (!sel) return;

  if (_ollamaModelsCache) {
    renderOllamaModels(_ollamaModelsCache, sel);
    if (statusEl) statusEl.textContent = `✅ ${_ollamaModelsCache.length} modelo(s) disponible(s)`;
    return;
  }

  try {
    const resp = await fetch('/api/ollama/status');
    const data = await resp.json();
    if (!data.connected) {
      sel.innerHTML = '<option value="">Ollama no detectado</option>';
      if (statusEl) statusEl.innerHTML = '❌ Ollama no está corriendo. <a href="https://ollama.com" target="_blank" style="color:#06b6d4;">Instalar</a>';
      return;
    }
    _ollamaModelsCache = data.models;
    renderOllamaModels(data.models, sel);
    if (statusEl) {
      if (data.models.length === 0) {
        statusEl.textContent = 'No hay modelos. Corre: ollama pull gemma3:4b';
      } else {
        statusEl.textContent = `✅ ${data.models.length} modelo(s) disponible(s)`;
      }
    }
  } catch (e) {
    sel.innerHTML = '<option value="">Error conectando</option>';
    if (statusEl) statusEl.textContent = '❌ ' + e.message;
  }
}

function renderOllamaModels(models, sel) {
  sel.innerHTML = '';
  if (models.length === 0) {
    sel.innerHTML = '<option value="">Sin modelos</option>';
    return;
  }
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = `${m.name} (${m.sizeGB}GB, ${m.quantization})`;
    sel.appendChild(opt);
  });
}

function onBrollLlmChange() {
  const selected = document.querySelector('input[name="brollTranslationModel"]:checked')?.value;
  const localDiv = document.getElementById('brollLocalModelDiv');
  if (localDiv) {
    localDiv.style.display = selected === 'local' ? 'block' : 'none';
    if (selected === 'local') loadOllamaModels('brollLocalModel', 'brollOllamaStatus');
  }
}

function onMainLlmChange() {
  const selected = document.getElementById('llmModelSelect')?.value;
  const localDiv = document.getElementById('mainLocalModelDiv');
  if (localDiv) {
    localDiv.style.display = selected === 'local' ? 'block' : 'none';
    if (selected === 'local') loadOllamaModels('mainLocalModel', 'mainOllamaStatus');
  }
}

async function startBrollTranslation() {
  const { videoFile, folderName, bgMusicFile, bgMusicVolume } = _brollTranslateData;
  if (!videoFile || !folderName) {
    showNotification('No hay video renderizado para traducir', 'error');
    return;
  }

  // Get selected languages
  const langChecks = document.querySelectorAll('#translateLangChecks input[type="checkbox"]:checked');
  const targetLanguages = Array.from(langChecks).map(cb => cb.value);
  if (targetLanguages.length === 0) {
    showNotification('Selecciona al menos un idioma', 'warning');
    return;
  }

  const ttsProvider = document.querySelector('input[name="brollTtsProvider"]:checked')?.value || 'applio';
  const googleVoice = document.getElementById('translateGoogleVoice')?.value || 'Kore';
  const applioVoice = document.getElementById('translateApplioVoice')?.value || 'logs\\VOCES\\RemyOriginal.pth';
  const cloudVoice = document.querySelector('input[name="brollCloudVoice"]:checked')?.value || 'male';
  const translationModel = document.querySelector('input[name="brollTranslationModel"]:checked')?.value || 'gemini-3.1-flash-lite';
  const transcriptionMethod = document.querySelector('input[name="brollTranscription"]:checked')?.value || 'whisper';
  const groupSize = document.getElementById('brollGroupSize')?.value || '3';
  const podcastStyle = document.getElementById('brollPodcastStyle')?.checked || false;
  const keepTemp = document.getElementById('brollKeepTemp')?.checked || false;
  const endScreenSeconds = parseInt(document.getElementById('brollEndScreenSeconds')?.value) || 0;
  const applioGender = document.querySelector('input[name="brollApplioGender"]:checked')?.value || 'male';
  const applioTtsModel = applioGender === 'female' ? 'en-US-AvaMultilingualNeural' : 'fr-FR-RemyMultilingualNeural';

  // Guardar preferencias
  saveBrollTranslatePrefs();

  const btn = document.getElementById('btnStartTranslateVideo');
  const progressDiv = document.getElementById('translateVideoProgress');
  const statusEl = document.getElementById('translateVideoStatus');
  const percentEl = document.getElementById('translateVideoPercent');
  const barEl = document.getElementById('translateVideoBar');

  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Traduciendo...'; }
  if (progressDiv) progressDiv.style.display = 'block';

  try {
    const formData = new FormData();
    formData.append('projectFolderName', folderName);
    formData.append('projectVideoFile', videoFile);
    if (bgMusicFile) {
      formData.append('projectMusicFile', bgMusicFile);
    }
    formData.append('musicVolume', bgMusicVolume.toString());
    formData.append('targetLanguages', JSON.stringify(targetLanguages));
    formData.append('ttsProvider', ttsProvider);
    formData.append('translationModel', translationModel === 'local' ? '' : translationModel);
    formData.append('llmProvider', translationModel === 'local' ? 'local' : 'gemini');
    formData.append('localModel', document.getElementById('brollLocalModel')?.value || '');
    formData.append('transcriptionMethod', transcriptionMethod);
    formData.append('googleVoice', googleVoice);
    formData.append('applioVoice', applioVoice);
    formData.append('cloudVoice', cloudVoice);
    formData.append('applioTtsModel', applioTtsModel);
    formData.append('applioVoicePath', applioVoice);
    formData.append('applioSpeed', '0');
    formData.append('applioPitch', '0');
    formData.append('groupSize', groupSize);
    formData.append('endScreenSeconds', endScreenSeconds);
    if (podcastStyle) formData.append('podcastStyle', 'true');
    if (keepTemp) formData.append('keepTemp', 'true');

    const response = await fetch('/api/translate-video', {
      method: 'POST',
      body: formData
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.substring(6));
          if (statusEl) statusEl.textContent = evt.status || '';
          if (evt.progress !== null && evt.progress !== undefined) {
            const pct = Math.round(evt.progress);
            if (percentEl) percentEl.textContent = pct + '%';
            if (barEl) barEl.style.width = pct + '%';
          }
          if (evt.completed) {
            showNotification('Traduccion completada! Archivos guardados en la carpeta del proyecto.', 'success');
          }
          if (evt.error) {
            showNotification('Error en traduccion: ' + evt.error, 'error');
          }
        } catch (e) { /* ignore parse errors */ }
      }
    }
  } catch (err) {
    showNotification('Error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Traducir'; }
  }
}

// ===== END SCREEN & BACKGROUND MUSIC =====

function handleEndScreenDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('video/')) {
    showNotification('Solo se aceptan archivos de video para la pantalla final', 'error');
    return;
  }
  _tlEndScreenFile = file;
  if (_tlEndScreenUrl) URL.revokeObjectURL(_tlEndScreenUrl);
  _tlEndScreenUrl = URL.createObjectURL(file);

  const zone = document.getElementById('tlEndScreenZone');
  const placeholder = document.getElementById('tlEndScreenPlaceholder');
  const preview = document.getElementById('tlEndScreenPreview');
  const video = document.getElementById('tlEndScreenVideo');
  const nameEl = document.getElementById('tlEndScreenName');
  const durEl = document.getElementById('tlEndScreenDur');

  if (zone) zone.classList.add('has-clip');
  if (placeholder) placeholder.style.display = 'none';
  if (preview) preview.style.display = 'flex';
  if (video) { video.src = _tlEndScreenUrl; video.load(); }
  if (nameEl) nameEl.textContent = file.name;

  // Get duration
  const tempVid = document.createElement('video');
  tempVid.preload = 'metadata';
  tempVid.src = _tlEndScreenUrl;
  tempVid.onloadedmetadata = () => {
    if (durEl) durEl.textContent = formatSeconds(tempVid.duration);
    // Update total timeline duration
    updateTimelineTotalDuration();
  };
}

function removeEndScreen() {
  _tlEndScreenFile = null;
  if (_tlEndScreenUrl) { URL.revokeObjectURL(_tlEndScreenUrl); _tlEndScreenUrl = null; }
  const zone = document.getElementById('tlEndScreenZone');
  const placeholder = document.getElementById('tlEndScreenPlaceholder');
  const preview = document.getElementById('tlEndScreenPreview');
  const video = document.getElementById('tlEndScreenVideo');
  if (zone) zone.classList.remove('has-clip');
  if (placeholder) placeholder.style.display = 'flex';
  if (preview) preview.style.display = 'none';
  if (video) video.removeAttribute('src');
  updateTimelineTotalDuration();
}

function handleMusicDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('audio/')) {
    showNotification('Solo se aceptan archivos de audio para la musica de fondo', 'error');
    return;
  }
  _tlBgMusicFile = file;
  if (_tlBgMusicUrl) URL.revokeObjectURL(_tlBgMusicUrl);
  _tlBgMusicUrl = URL.createObjectURL(file);

  const dropZone = document.getElementById('tlMusicDropZone');
  const label = document.getElementById('tlMusicLabel');
  const removeBtn = document.getElementById('tlMusicRemoveBtn');
  if (dropZone) dropZone.classList.add('has-music');
  if (label) label.textContent = file.name;
  if (removeBtn) removeBtn.style.display = 'inline-flex';

  // Create or update audio element for preview playback
  if (!_tlBgMusicAudio) {
    _tlBgMusicAudio = new Audio();
    _tlBgMusicAudio.loop = true;
  }
  _tlBgMusicAudio.src = _tlBgMusicUrl;
  _tlBgMusicAudio.volume = (parseInt(document.getElementById('tlMusicVolume')?.value) || 13) / 100;
}

function removeBackgroundMusic() {
  if (_tlBgMusicAudio) { _tlBgMusicAudio.pause(); _tlBgMusicAudio.src = ''; }
  _tlBgMusicFile = null;
  if (_tlBgMusicUrl) { URL.revokeObjectURL(_tlBgMusicUrl); _tlBgMusicUrl = null; }

  const dropZone = document.getElementById('tlMusicDropZone');
  const label = document.getElementById('tlMusicLabel');
  const removeBtn = document.getElementById('tlMusicRemoveBtn');
  if (dropZone) dropZone.classList.remove('has-music');
  if (label) label.textContent = 'Arrastra musica de fondo aqui';
  if (removeBtn) removeBtn.style.display = 'none';
}

function updateMusicVolume(val) {
  const label = document.getElementById('tlMusicVolumeLabel');
  if (label) label.textContent = val + '%';
  if (_tlBgMusicAudio) _tlBgMusicAudio.volume = parseInt(val) / 100;
}

function updateTimelineTotalDuration() {
  let totalDuration = 0;
  if (_brollPreviewSections) {
    _brollPreviewSections.forEach(s => { totalDuration += s.audioDuration; });
  }
  // Add end screen duration
  const endVid = document.getElementById('tlEndScreenVideo');
  if (endVid && endVid.duration && isFinite(endVid.duration)) {
    totalDuration += endVid.duration;
  }
  const tlDuration = document.getElementById('tlTotalDuration');
  if (tlDuration) tlDuration.textContent = formatSeconds(totalDuration);
}

// Start/stop music during preview playback
function startMusicPreview() {
  if (_tlBgMusicAudio && _tlBgMusicUrl) {
    _tlBgMusicAudio.currentTime = 0;
    _tlBgMusicAudio.play().catch(() => {});
  }
}

function stopMusicPreview() {
  if (_tlBgMusicAudio) _tlBgMusicAudio.pause();
}

let _swellAnimFrame = null;
function _swellMusicTo(audioEl, targetVol, durationMs) {
  if (_swellAnimFrame) cancelAnimationFrame(_swellAnimFrame);
  const startVol = audioEl.volume;
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / durationMs);
    audioEl.volume = startVol + (targetVol - startVol) * t;
    if (t < 1) _swellAnimFrame = requestAnimationFrame(step);
    else _swellAnimFrame = null;
  }
  _swellAnimFrame = requestAnimationFrame(step);
}

function playEndScreenPreview() {
  // Stop TTS audio, stop music (end screen has its own audio)
  const audio = document.getElementById('tlPreviewAudio');
  if (audio) { audio.pause(); audio.currentTime = 0; }
  stopMusicPreview();

  const image = document.getElementById('tlPreviewImage');
  const placeholder = document.getElementById('tlPreviewPlaceholder');
  const title = document.getElementById('tlPreviewTitle');
  const meta = document.getElementById('tlPreviewMeta');
  if (image) image.style.display = 'none';
  if (placeholder) placeholder.style.display = 'none';
  if (title) title.textContent = 'Pantalla Final';
  if (meta) meta.textContent = 'Clip de despedida (con audio original)';

  const video = getActiveVideo();
  if (!video) return;
  clearVideoHandlers(video);
  video.muted = false; // End screen plays WITH audio
  video.src = _tlEndScreenUrl;
  video.load();
  video.oncanplay = () => { video.play().catch(() => {}); };
  video.onended = () => { video.muted = true; stopBrollAudio(); };
}

// ===== QWEN LOGIC GLOBALS =====
let availableQwenVoices = [];

async function loadQwenVoices() {
  try {
    const response = await fetch('/api/qwen-voices');
    const data = await response.json();
    if (data.success && data.voices) {
      availableQwenVoices = data.voices;
      const select = document.getElementById('qwenVoiceSelect');
      if (select) {
        select.innerHTML = '';
        data.voices.forEach(voice => {
          const option = document.createElement('option');
          option.value = voice.path;
          option.textContent = voice.displayName;
          select.appendChild(option);
        });
      }
      return true;
    }
  } catch (error) {
    console.error('Error cargando voces de Qwen:', error);
    return false;
  }
}

function toggleQwenVoiceDropdown() {
  const checkbox = document.getElementById('autoGenerateQwenAudio');
  const voiceGroup = document.getElementById('qwenVoiceGroup');
  const applioCheckbox = document.getElementById('autoGenerateApplioAudio');
  
  if (checkbox && voiceGroup) {
    if (checkbox.checked) {
      voiceGroup.style.display = 'block';
      if (availableQwenVoices.length === 0) loadQwenVoices();
      
      // Mutually exclusive with Applio
      if (applioCheckbox && applioCheckbox.checked) {
        applioCheckbox.checked = false;
        if (typeof toggleApplioVoiceDropdown === 'function') toggleApplioVoiceDropdown();
      }
    } else {
      voiceGroup.style.display = 'none';
    }
  }
}

// ── Chatterbox TTS ────────────────────────────────────────────────────────
let _chatterboxVoices = [];

async function loadChatterboxVoices() {
  try {
    const res = await fetch('/api/chatterbox-voices');
    const data = await res.json();
    if (data.success && data.voices) {
      _chatterboxVoices = data.voices;
      const sel = document.getElementById('chatterboxVoiceSelect');
      if (sel) {
        sel.innerHTML = '<option value="">Sin muestra (voz por defecto)</option>';
        data.voices.forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.file;
          opt.textContent = v.name;
          sel.appendChild(opt);
        });
      }
    }
  } catch (e) { console.error('Error cargando voces Chatterbox:', e); }
}

function toggleChatterboxPanel() {
  const cb = document.getElementById('autoGenerateChatterboxAudio');
  const panel = document.getElementById('chatterboxVoiceGroup');
  if (!cb || !panel) return;
  panel.style.display = cb.checked ? 'block' : 'none';
  if (cb.checked) {
    if (_chatterboxVoices.length === 0) loadChatterboxVoices();
    // Mutually exclusive with Applio and Qwen
    const aplio = document.getElementById('autoGenerateApplioAudio');
    const qwen  = document.getElementById('autoGenerateQwenAudio');
    if (aplio?.checked) { aplio.checked = false; if (typeof toggleApplioVoiceDropdown === 'function') toggleApplioVoiceDropdown(); }
    if (qwen?.checked)  { qwen.checked  = false; toggleQwenVoiceDropdown(); }
  }
}

// ── Per-voice settings persistence ──────────────────────────────────────────
const _CB_VOICE_PREFS_KEY = 'chatterbox_voice_prefs';

function _cbLoadVoicePrefs() {
  try { return JSON.parse(localStorage.getItem(_CB_VOICE_PREFS_KEY) || '{}'); }
  catch { return {}; }
}

function _cbSaveCurrentVoicePrefs() {
  const voice = document.getElementById('chatterboxVoiceSelect')?.value;
  if (!voice) return;
  const prefs = _cbLoadVoicePrefs();
  prefs[voice] = {
    exaggeration:  parseFloat(document.getElementById('chatterboxExaggeration')?.value ?? 0.5),
    cfgWeight:     parseFloat(document.getElementById('chatterboxCfgWeight')?.value ?? 0.5),
    temperature:   parseFloat(document.getElementById('chatterboxTemperature')?.value ?? 0.8),
  };
  localStorage.setItem(_CB_VOICE_PREFS_KEY, JSON.stringify(prefs));
}

function _cbApplyVoicePrefs(voice) {
  if (!voice) return;
  const prefs = _cbLoadVoicePrefs();
  const p = prefs[voice];
  if (!p) return;
  const exEl  = document.getElementById('chatterboxExaggeration');
  const exLbl = document.getElementById('chatterboxExaggerationLabel');
  const cfEl  = document.getElementById('chatterboxCfgWeight');
  const cfLbl = document.getElementById('chatterboxCfgWeightLabel');
  const tmpEl  = document.getElementById('chatterboxTemperature');
  const tmpLbl = document.getElementById('chatterboxTemperatureLabel');
  if (exEl)  { exEl.value  = p.exaggeration;          if (exLbl)  exLbl.textContent  = p.exaggeration.toFixed(2); }
  if (cfEl)  { cfEl.value  = p.cfgWeight;              if (cfLbl)  cfLbl.textContent  = p.cfgWeight.toFixed(2); }
  if (tmpEl) { tmpEl.value = p.temperature ?? 0.8;     if (tmpLbl) tmpLbl.textContent = (p.temperature ?? 0.8).toFixed(2); }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('autoGenerateChatterboxAudio')?.addEventListener('change', toggleChatterboxPanel);
  loadChatterboxVoices();

  // Save prefs when sliders change
  document.getElementById('chatterboxExaggeration')?.addEventListener('input', _cbSaveCurrentVoicePrefs);
  document.getElementById('chatterboxCfgWeight')?.addEventListener('input', _cbSaveCurrentVoicePrefs);
  document.getElementById('chatterboxTemperature')?.addEventListener('input', _cbSaveCurrentVoicePrefs);

  // Load prefs when voice changes
  document.getElementById('chatterboxVoiceSelect')?.addEventListener('change', (e) => {
    _cbApplyVoicePrefs(e.target.value);
  });
});

const originalToggleApplio = window.toggleApplioVoiceDropdown;
window.toggleApplioVoiceDropdown = function() {
  if (originalToggleApplio) originalToggleApplio();
  const qCheckbox = document.getElementById('autoGenerateQwenAudio');
  const aCheckbox = document.getElementById('autoGenerateApplioAudio');
  if (aCheckbox && aCheckbox.checked && qCheckbox && qCheckbox.checked) {
    qCheckbox.checked = false;
    toggleQwenVoiceDropdown();
  }
};
// ==============================

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE UPLOAD PANEL
// ─────────────────────────────────────────────────────────────────────────────

let _ytVideoPath      = null;
let _ytFolderName     = null;
let _ytSelectedChannel = null;   // { id, name, thumbnail }
let _ytChannels        = [];     // all connected channels

// Called from showBrollTranslatePanel after render completes
async function showYouTubeUploadPanel(videoFile, folderName) {
  const panel = document.getElementById('youtubeUploadPanel');
  if (!panel) return;

  _ytVideoPath  = videoFile;
  _ytFolderName = folderName;

  // Reset upload state
  document.getElementById('ytUploadProgress').style.display = 'none';
  document.getElementById('ytUploadResult').style.display = 'none';
  document.getElementById('ytUploadBar').style.width = '0%';
  document.getElementById('ytUploadBtn').disabled = false;
  document.getElementById('ytUploadBtn').style.opacity = '1';

  // Pre-fill from existing YouTube metadata if available
  _ytPrefillMetadata();

  panel.style.display = 'block';

  // Load channels
  _ytLoadChannels();
}

function _ytPrefillMetadata() {
  const meta = window.lastGeneratedYouTubeMetadata?.content
    || window.currentProject?.youtubeMetadata?.content;

  const titleOptions = document.getElementById('ytTitleOptions');
  titleOptions.innerHTML = '';

  if (meta) {
    const parsed = _ytParseMetadata(meta);

    // Title radio buttons
    parsed.titles.forEach((t, i) => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex; align-items:flex-start; gap:8px; cursor:pointer; padding:6px 10px; border-radius:7px; border:1px solid rgba(255,255,255,0.07); background:#111827; transition:background 0.15s;';
      row.onmouseenter = () => row.style.background = '#1e293b';
      row.onmouseleave = () => { if (!row.querySelector('input').checked) row.style.background = '#111827'; };
      row.innerHTML = `<input type="radio" name="ytTitle" value="${_ytEscape(t)}" style="margin-top:2px; accent-color:#ff4444;"
          onchange="document.getElementById('ytCustomTitle').value=''; document.querySelectorAll('#ytTitleOptions label').forEach(l=>l.style.background='#111827'); this.closest('label').style.background='#1a2a1a';">
        <span style="font-size:0.8rem; color:#cbd5e1; line-height:1.4;">${_ytEscape(t)}</span>`;
      titleOptions.appendChild(row);
    });

    // Auto-select first title
    const firstRadio = titleOptions.querySelector('input[type="radio"]');
    if (firstRadio) {
      firstRadio.checked = true;
      firstRadio.closest('label').style.background = '#1a2a1a';
    }

    // Description
    document.getElementById('ytDescription').value = parsed.description;

    // Tags
    document.getElementById('ytTags').value = parsed.tags.join(', ');
  } else {
    titleOptions.innerHTML = '<p style="color:#64748b; font-size:0.8rem; padding:6px 0;">Genera los metadatos de YouTube primero para ver títulos sugeridos.</p>';
  }
}

// Minimal metadata parser (re-uses same logic as parseMetadata in script.js)
function _ytParseMetadata(metadata) {
  const lines = metadata.split('\n');
  let section = '';
  const titles = [], tags = [];
  let description = '';
  const normalize = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  for (let line of lines) {
    line = line.trim();
    const N = normalize(line);
    if (N.includes('TITULOS CLICKBAIT') || N.includes('CLICKBAIT TITLES')) { section = 'titles'; continue; }
    if (N.includes('DESCRIPCION') || N.includes('DESCRIPTION')) { section = 'desc'; continue; }
    if (N.includes('ETIQUETAS') || N.includes('TAGS')) { section = 'tags'; continue; }
    if (N.includes('MINIATURA') || N.includes('THUMBNAIL')) { section = 'thumb'; continue; }

    if (!line || line.startsWith('**')) continue;
    if (section === 'titles') { const c = line.replace(/^\d+\.\s*/, ''); if (c) titles.push(c); }
    else if (section === 'desc') description += line + '\n';
    else if (section === 'tags') tags.push(...line.split(',').map(t => t.trim()).filter(Boolean));
  }
  return { titles: titles.slice(0, 10), description: description.trim(), tags: tags.slice(0, 25) };
}

function _ytEscape(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function ytDeselectAllTitles() {
  document.querySelectorAll('#ytTitleOptions input[type="radio"]').forEach(r => {
    r.checked = false;
    r.closest('label').style.background = '#111827';
  });
}

function ytToggleSchedule() {
  const val = document.getElementById('ytPrivacy').value;
  const block = document.getElementById('ytScheduleBlock');
  block.style.display = val === 'scheduled' ? 'block' : 'none';
}

async function _ytLoadChannels() {
  const list = document.getElementById('ytChannelList');
  if (!list) return;
  list.innerHTML = '<div style="color:#64748b;font-size:0.78rem;padding:6px;">Cargando...</div>';
  try {
    const r = await fetch('/youtube/channels');
    const d = await r.json();
    if (d.missingCredentials) {
      list.innerHTML = '<div style="color:#f59e0b;font-size:0.78rem;padding:6px;"><i class="fas fa-exclamation-triangle"></i> Falta youtube_client_secrets.json</div>';
      return;
    }
    _ytChannels = d.channels || [];
    _ytRenderChannelList();
    // Auto-select first channel
    if (_ytChannels.length > 0 && !_ytSelectedChannel) {
      _ytSelectChannel(_ytChannels[0]);
    }
    // Update header badge
    _ytUpdateBadge();
  } catch (e) {
    list.innerHTML = `<div style="color:#ef4444;font-size:0.78rem;padding:6px;">Error: ${e.message}</div>`;
  }
}

function _ytRenderChannelList() {
  const list = document.getElementById('ytChannelList');
  if (!list) return;
  if (_ytChannels.length === 0) {
    list.innerHTML = '<div style="color:#64748b;font-size:0.78rem;padding:6px;">No hay canales conectados. Añade uno abajo.</div>';
    return;
  }
  list.innerHTML = '';
  _ytChannels.forEach(ch => {
    const isSelected = _ytSelectedChannel?.id === ch.id;
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;border:1px solid ${isSelected ? 'rgba(255,68,68,0.5)' : 'rgba(255,255,255,0.07)'};background:${isSelected ? 'rgba(255,68,68,0.08)' : '#111827'};transition:all 0.15s;`;
    row.onclick = () => _ytSelectChannel(ch);
    const thumb = ch.thumbnail
      ? `<img src="${ch.thumbnail}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;">`
      : `<div style="width:30px;height:30px;border-radius:50%;background:#1e293b;display:flex;align-items:center;justify-content:center;"><i class="fab fa-youtube" style="color:#ff4444;font-size:0.8rem;"></i></div>`;
    const subs = parseInt(ch.subscribers || 0);
    const subsLabel = subs >= 1000000 ? (subs/1000000).toFixed(1)+'M' : subs >= 1000 ? (subs/1000).toFixed(1)+'K' : subs;
    row.innerHTML = `${thumb}
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.82rem;color:#e2e8f0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ch.name}</div>
        <div style="font-size:0.7rem;color:#64748b;">${subsLabel} suscriptores</div>
      </div>
      ${isSelected ? '<i class="fas fa-check-circle" style="color:#ff4444;font-size:0.9rem;flex-shrink:0;"></i>' : ''}`;
    list.appendChild(row);
  });
}

function _ytSelectChannel(ch) {
  _ytSelectedChannel = ch;
  _ytRenderChannelList();
  _ytUpdateBadge();
}

function _ytUpdateBadge() {
  const dot   = document.getElementById('ytAuthDot');
  const label = document.getElementById('ytAuthLabel');
  if (!dot || !label) return;
  if (_ytSelectedChannel) {
    dot.style.background = '#4ade80';
    label.textContent = `✓ ${_ytSelectedChannel.name}`;
    label.style.color = '#4ade80';
  } else {
    dot.style.background = '#64748b';
    label.textContent = 'Sin canal';
    label.style.color = '#94a3b8';
  }
}

function ytAddChannel() {
  fetch('/youtube/auth-url').then(r => r.json()).then(d => {
    if (d.error) { alert('Error: ' + d.error); return; }
    const popup = window.open(d.url, 'yt_auth', 'width=550,height=700');
    const onMsg = (e) => {
      if (e.data?.type === 'youtube_auth_ok') {
        window.removeEventListener('message', onMsg);
        if (popup && !popup.closed) popup.close();
        _ytLoadChannels();
      }
    };
    window.addEventListener('message', onMsg);
    const poll = setInterval(() => {
      if (popup?.closed) { clearInterval(poll); window.removeEventListener('message', onMsg); _ytLoadChannels(); }
    }, 1200);
  }).catch(e => alert('Error: ' + e.message));
}

async function ytStartUpload() {
  const selectedRadio = document.querySelector('#ytTitleOptions input[type="radio"]:checked');
  const customTitle = document.getElementById('ytCustomTitle').value.trim();
  const title = selectedRadio ? selectedRadio.value : customTitle;

  if (!title) { alert('Selecciona o escribe un título.'); return; }
  if (!_ytVideoPath) { alert('No hay video para subir.'); return; }
  if (!_ytSelectedChannel) {
    const ok = confirm('No hay canal seleccionado. ¿Conectar uno ahora?');
    if (ok) ytAddChannel();
    return;
  }

  const description = document.getElementById('ytDescription').value;
  const tagsRaw = document.getElementById('ytTags').value;
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  const privacy = document.getElementById('ytPrivacy').value;
  const publishAt = privacy === 'scheduled' ? document.getElementById('ytPublishAt').value : null;

  if (privacy === 'scheduled' && !publishAt) { alert('Selecciona fecha y hora para programar el video.'); return; }

  // UI: show progress
  const btn = document.getElementById('ytUploadBtn');
  btn.disabled = true;
  btn.style.opacity = '0.5';
  document.getElementById('ytUploadProgress').style.display = 'block';
  document.getElementById('ytUploadResult').style.display = 'none';
  document.getElementById('ytUploadStatus').textContent = 'Subiendo video... puede tardar varios minutos.';
  document.getElementById('ytUploadPercent').textContent = '';

  // Animate bar indeterminately until response
  let barW = 0;
  const barEl = document.getElementById('ytUploadBar');
  barEl.style.transition = 'none';
  barEl.style.width = '0%';
  const barTimer = setInterval(() => {
    barW = Math.min(barW + (barW < 40 ? 1.2 : barW < 70 ? 0.5 : 0.15), 90);
    barEl.style.width = barW + '%';
  }, 400);

  try {
    const privacyStatus = privacy === 'scheduled' ? 'scheduled' : privacy;
    const publishAtISO = publishAt ? new Date(publishAt).toISOString() : null;

    const res = await fetch('/youtube/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPath: _ytVideoPath, folderName: _ytFolderName, channelId: _ytSelectedChannel?.id, title, description, tags, privacyStatus, publishAt: publishAtISO }),
    });
    const data = await res.json();

    clearInterval(barTimer);
    barEl.style.transition = 'width 0.4s ease';
    barEl.style.width = '100%';

    if (data.success) {
      document.getElementById('ytUploadStatus').textContent = '¡Subido!';
      document.getElementById('ytUploadPercent').textContent = '100%';
      const result = document.getElementById('ytUploadResult');
      result.style.display = 'block';
      result.innerHTML = `<i class="fab fa-youtube"></i> Video publicado exitosamente —
        <a href="${data.url}" target="_blank" style="color:#4ade80; text-decoration:underline;">${data.url}</a>`;
    } else {
      throw new Error(data.error || 'Error desconocido');
    }
  } catch (e) {
    clearInterval(barTimer);
    barEl.style.background = '#ef4444';
    barEl.style.width = '100%';
    document.getElementById('ytUploadStatus').textContent = 'Error: ' + e.message;
    document.getElementById('ytUploadPercent').textContent = '';
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}


