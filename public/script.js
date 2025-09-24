// Función simple para verificar que el script se carga
console.log('🚀 Script.js cargado correctamente - VERSIÓN CON FIX DE KEYWORDS v2');

// Variable global para almacenar la estructura de capítulos
let globalChapterStructure = [];

// Variable global para almacenar las keywords de cada imagen para el botón de refresh
let currentImageKeywords = [];

// ================================
// VARIABLES GLOBALES PARA GENERACIÓN DE VIDEO
// ================================
let isGeneratingVideo = false;
let currentVideoSession = null;

// ================================
// FUNCIÓN PARA MANEJAR SELECTOR NUMÉRICO DE SECCIONES
// ================================
function changeSectionCount(change) {
  const input = document.getElementById('sectionsNumber');
  if (!input) {
    console.error('❌ No se encontró el campo sectionsNumber');
    return;
  }
  
  // Si el campo está vacío, usar valor por defecto
  const currentValue = parseInt(input.value) || 3;
  const newValue = currentValue + change;
  
  // Verificar límites
  if (newValue < 1 || newValue > 150) {
    console.log(`⚠️ Valor fuera de rango: ${newValue}. Rango permitido: 1-150`);
    return;
  }
  
  // Actualizar valor
  input.value = newValue;
  console.log(`📊 Secciones actualizadas via botones: ${newValue}`);
  
  // Actualizar estado de botones
  updateSectionButtons();
}

function updateSectionButtons() {
  const input = document.getElementById('sectionsNumber');
  const decreaseBtn = document.querySelector('.decrease-btn');
  const increaseBtn = document.querySelector('.increase-btn');
  
  if (!input || !decreaseBtn || !increaseBtn) {
    console.error('❌ No se encontraron elementos del selector numérico');
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
  console.log('🎯 Inicializando selector numérico de secciones...');
  updateSectionButtons();
  
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
        console.log('⚠️ Valor corregido a mínimo: 1');
        this.value = 1;
        value = 1;
      } else if (value > 150) {
        console.log('⚠️ Valor corregido a máximo: 150');
        this.value = 150;
        value = 150;
      }
      
      updateSectionButtons();
      console.log(`📊 Secciones actualizadas via input: ${value}`);
    });
    
    // Evento para manejar cuando el usuario sale del campo
    input.addEventListener('blur', function(e) {
      // Si el campo está vacío al salir, establecer valor por defecto
      if (this.value === '' || isNaN(parseInt(this.value))) {
        console.log('⚠️ Campo vacío, estableciendo valor por defecto: 3');
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
    
    console.log('✅ Selector numérico de secciones inicializado');
  }
});

// ========================================
// SISTEMA DE BARRA DE PROGRESO
// ========================================

// Declarar todas las variables primero
let progressStartTime = null;
let progressInterval = null;
let progressPollingInterval = null;
let currentProjectKey = null;

// Mostrar la barra de progreso
function showProgressBar() {
  const progressContainer = document.getElementById('progressContainer');
  const generateBtn = document.getElementById('generateBtn');
  
  if (progressContainer) {
    progressContainer.style.display = 'block';
    progressStartTime = Date.now();
    updateElapsedTime();
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
  }
  
  // Restaurar el botón de generación
  if (generateBtn) {
    generateBtn.style.display = 'inline-flex';
    generateBtn.innerHTML = `
      <i class="fas fa-magic"></i>
      <span>Generar Todo</span>
    `;
  }
  
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  if (progressPollingInterval) {
    clearInterval(progressPollingInterval);
    progressPollingInterval = null;
  }
}

// Iniciar polling del progreso desde el servidor
function startProgressPolling(projectKey) {
  currentProjectKey = projectKey;
  
  // Limpiar polling anterior si existe
  if (progressPollingInterval) {
    clearInterval(progressPollingInterval);
  }
  
  // Hacer polling cada 2 segundos
  progressPollingInterval = setInterval(async () => {
    try {
      console.log(`📊 Polling progreso para proyecto: ${projectKey}`);
      const response = await fetch(`/progress/${projectKey}`);
      const data = await response.json();
      
      console.log('📊 Respuesta del servidor:', data);
      
      if (data.success && data.progress) {
        const progressData = data.progress;
        
        console.log(`📊 Datos de progreso recibidos:`, {
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
        
        // Actualizar la barra de progreso
        updateProgressBar({
          percentage: progressData.percentage,
          phase: currentPhase,
          currentStep: progressData.currentStep,
          totalSteps: progressData.totalSteps,
          estimatedTimeRemaining: progressData.estimatedTimeRemaining,
          currentTask: currentTask
        });
      } else {
        console.warn('⚠️ No se recibieron datos de progreso válidos:', data);
      }
    } catch (error) {
      console.error('❌ Error obteniendo progreso del servidor:', error);
    }
  }, 2000);
}

// Detener polling del progreso
function stopProgressPolling() {
  if (progressPollingInterval) {
    clearInterval(progressPollingInterval);
    progressPollingInterval = null;
  }
  currentProjectKey = null;
}

// Actualizar la barra de progreso
function updateProgressBar(data) {
  const { percentage, phase, currentStep, totalSteps, estimatedTimeRemaining, currentTask } = data;
  
  // Actualizar porcentaje
  const progressFill = document.getElementById('progressFill');
  const progressPercentage = document.getElementById('progressPercentage');
  if (progressFill && progressPercentage) {
    progressFill.style.width = `${percentage}%`;
    progressPercentage.textContent = `${Math.round(percentage)}%`;
  }
  
  // Actualizar fase actual
  const currentPhaseElement = document.getElementById('currentPhase');
  if (currentPhaseElement) {
    const phaseNames = {
      'script': 'Generando Textos',
      'audio': 'Generando Audios', 
      'images': 'Generando Imágenes'
    };
    currentPhaseElement.textContent = phaseNames[phase] || 'Procesando...';
  }
  
  // Actualizar progreso actual
  const currentProgress = document.getElementById('currentProgress');
  if (currentProgress) {
    currentProgress.textContent = `${currentStep} / ${totalSteps}`;
  }
  
  // Actualizar tiempo estimado
  const estimatedTime = document.getElementById('estimatedTime');
  if (estimatedTime) {
    estimatedTime.textContent = estimatedTimeRemaining || 'Calculando...';
  }
  
  // Actualizar tarea actual
  const currentTaskElement = document.getElementById('currentTask');
  if (currentTaskElement) {
    currentTaskElement.textContent = currentTask || 'Procesando...';
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
  updateProgressBar({
    percentage: 0,
    phase: 'script',
    currentStep: 0,
    totalSteps: 0,
    estimatedTimeRemaining: 'Calculando...',
    currentTask: 'Preparando generación...'
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
    estimatedTimeRemaining: '0:00',
    currentTask: message
  });
  
  // Detener polling
  stopProgressPolling();
  
  // Ocultar después de 3 segundos
  setTimeout(() => {
    hideProgressBar();
  }, 3000);
}

// Mostrar error en la barra de progreso
function showProgressError(error) {
  const currentTaskElement = document.getElementById('currentTask');
  if (currentTaskElement) {
    currentTaskElement.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Error: ${error}`;
    currentTaskElement.style.color = '#ff4757';
  }
  
  // Detener polling
  stopProgressPolling();
  
  // Ocultar después de 5 segundos
  setTimeout(() => {
    hideProgressBar();
  }, 5000);
}

// ================================
// FUNCIONES PARA MANEJO DE VOCES DE APPLIO
// ================================

// Variable global para almacenar las voces disponibles
let availableApplioVoices = [];

// Función para cargar las voces disponibles de Applio
async function loadApplioVoices() {
  try {
    console.log('🎤 Cargando voces de Applio...');
    const response = await fetch('/api/applio-voices');
    const data = await response.json();
    
    if (data.success && data.voices) {
      availableApplioVoices = data.voices;
      console.log(`✅ Cargadas ${data.voices.length} voces de Applio`);
      
      // Actualizar el dropdown
      updateApplioVoicesDropdown();
      
      return true;
    } else {
      console.error('❌ Error en respuesta de voces:', data);
      return false;
    }
  } catch (error) {
    console.error('❌ Error cargando voces de Applio:', error);
    return false;
  }
}

// Función para actualizar el dropdown de voces
function updateApplioVoicesDropdown() {
  const select = document.getElementById('applioVoiceSelect');
  if (!select) {
    console.error('❌ No se encontró el dropdown de voces de Applio');
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
    console.log(`📝 Dropdown actualizado con ${availableApplioVoices.length} voces`);
  } else {
    // Opción por defecto si no hay voces
    const option = document.createElement('option');
    option.value = 'logs\\VOCES\\RemyOriginal.pth';
    option.textContent = 'RemyOriginal (Default)';
    select.appendChild(option);
    console.log('📝 Dropdown con voz por defecto');
  }
}

// Función para mostrar/ocultar el dropdown de voces según la casilla de Applio
function toggleApplioVoiceDropdown() {
  const checkbox = document.getElementById('autoGenerateApplioAudio');
  const voiceGroup = document.getElementById('applioVoiceGroup');
  
  if (!checkbox || !voiceGroup) {
    console.error('❌ No se encontraron elementos de Applio');
    return;
  }
  
  if (checkbox.checked) {
    console.log('🎤 Activando selector de voces de Applio...');
    voiceGroup.style.display = 'flex';
    
    // Cargar voces si no se han cargado aún
    if (availableApplioVoices.length === 0) {
      loadApplioVoices();
    }
  } else {
    console.log('🔇 Ocultando selector de voces de Applio...');
    voiceGroup.style.display = 'none';
  }
}

// Función para mostrar/ocultar las configuraciones de voz Google según la casilla correspondiente
function toggleGoogleVoiceDropdown() {
  const checkbox = document.getElementById('autoGenerateAudio');
  const voiceGroup = document.getElementById('googleVoiceGroup');
  
  if (!checkbox || !voiceGroup) {
    console.error('❌ No se encontraron elementos de Google Voice');
    return;
  }
  
  if (checkbox.checked) {
    console.log('🎵 Activando configuraciones de voz Google...');
    voiceGroup.style.display = 'block';
  } else {
    console.log('🔇 Ocultando configuraciones de voz Google...');
    voiceGroup.style.display = 'none';
  }
}

// Inicializar eventos para Applio cuando se carga la página
document.addEventListener('DOMContentLoaded', function() {
  console.log('🎤 Inicializando controles de Applio...');
  
  const applioCheckbox = document.getElementById('autoGenerateApplioAudio');
  if (applioCheckbox) {
    // Agregar evento para mostrar/ocultar dropdown
    applioCheckbox.addEventListener('change', toggleApplioVoiceDropdown);
    
    // Verificar estado inicial
    toggleApplioVoiceDropdown();
    
    console.log('✅ Controles de Applio inicializados');
  } else {
    console.error('❌ No se encontró la casilla de Applio');
  }

  // Inicializar control de pitch
  const pitchSlider = document.getElementById('applioPitch');
  const pitchValue = document.getElementById('pitchValue');
  
  if (pitchSlider && pitchValue) {
    pitchSlider.addEventListener('input', function() {
      pitchValue.textContent = this.value;
      console.log(`🎵 Pitch ajustado a: ${this.value}`);
    });
    
    console.log('✅ Control de pitch inicializado');
  } else {
    console.error('❌ No se encontraron elementos del pitch slider');
  }

  // Inicializar controles de Google Voice
  console.log('🎵 Inicializando controles de Google Voice...');
  
  const googleCheckbox = document.getElementById('autoGenerateAudio');
  if (googleCheckbox) {
    // Agregar evento para mostrar/ocultar configuraciones de voz Google
    googleCheckbox.addEventListener('change', toggleGoogleVoiceDropdown);
    
    // Verificar estado inicial
    toggleGoogleVoiceDropdown();
    
    console.log('✅ Controles de Google Voice inicializados');
  } else {
    console.error('❌ No se encontró la casilla de Google Audio');
  }
});

// ================================
// VARIABLES GLOBALES PARA PROYECTOS - INICIALIZACIÓN INMEDIATA
// ================================
if (typeof window.currentProject === 'undefined') {
  window.currentProject = null;
}
if (typeof window.availableProjects === 'undefined') {
  window.availableProjects = [];
}

// ================================
// VARIABLES GLOBALES PARA PROYECTOS - INICIALIZACIÓN ÚNICA
// ================================
if (typeof window.currentProject === 'undefined') {
  window.currentProject = null;
}
if (typeof window.availableProjects === 'undefined') {
  window.availableProjects = [];
}

console.log('✅ Variables globales de proyectos inicializadas:', {
  currentProject: window.currentProject,
  availableProjects: window.availableProjects
});

// DEBUG: Verificar elementos de miniatura al cargar
setTimeout(() => {
  console.log('🔍 DEBUG: Verificando elementos de miniatura...');
  const createBtn = document.getElementById('createThumbnailStyleFromSidebar');
  const manageBtn = document.getElementById('manageThumbnailStylesFromSidebar');
  
  console.log('createThumbnailStyleFromSidebar:', createBtn);
  console.log('manageThumbnailStylesFromSidebar:', manageBtn);
  
  if (createBtn) {
    console.log('✅ Botón crear miniatura encontrado, agregando click manual...');
    createBtn.onclick = function() {
      console.log('🖼️ Click en crear miniatura detectado');
      openThumbnailStyleModal();
    };
  }
  
  if (manageBtn) {
    console.log('✅ Botón gestionar miniatura encontrado, agregando click manual...');
    manageBtn.onclick = function() {
      console.log('🔧 Click en gestionar miniatura detectado');
      openManageThumbnailStylesModal();
    };
  }
}, 2000);

// Variables globales para el extractor de texto
let selectedFile = null;
let extractedText = '';

// Inicializar funcionalidad de extracción de texto tan pronto como sea posible
document.addEventListener('DOMContentLoaded', function() {
  console.log('🌐 DOM cargado - iniciando extractor de texto...');
  initializeTextExtractor();
});

// También intentar inicializar después de que todo se cargue
setTimeout(() => {
  console.log('⏰ Timeout - verificando si el extractor necesita inicialización...');
  if (!window.extractorInitialized) {
    console.log('🔄 Inicializando extractor de texto desde timeout...');
    initializeTextExtractor();
  }
}, 1000);

// Verificar que elementos existen al cargar
window.addEventListener('load', function() {
  console.log('🌐 Ventana cargada completamente');
  
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
  
  console.log('🔍 Verificación de elementos:', elements);
  
  // Verificar si faltan elementos
  Object.keys(elements).forEach(key => {
    if (!elements[key]) {
      console.error(`❌ Elemento faltante: ${key}`);
    } else {
      console.log(`✅ Elemento encontrado: ${key}`);
    }
  });
  
  // Intentar inicializar el extractor de texto nuevamente si no se hizo antes
  if (document.getElementById('extractTextBtn') && !window.extractorInitialized) {
    console.log('🔄 Inicializando extractor de texto desde window.load...');
    initializeTextExtractor();
  }
});

const generateBtn = document.getElementById("generateBtn");
const continueBtn = document.getElementById("continueBtn");
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
  console.log("🤖 Iniciando generación automática completa");
  
  // Verificar que los elementos del DOM estén disponibles
  const requiredElements = [
    'maxWords', 'styleSelect', 'imagesSelect', 'aspectRatioSelect', 
    'promptModifier', 'llmModelSelect', 
    'googleImages', 'localAIImages'
  ];
  
  const missingElements = requiredElements.filter(id => !document.getElementById(id));
  if (missingElements.length > 0) {
    console.error("❌ Elementos del DOM faltantes:", missingElements);
    showError(`Error: No se encontraron los siguientes elementos: ${missingElements.join(', ')}`);
    return;
  }
  
  isAutoGenerating = true;
  
  const topic = promptInput.value.trim();
  const folderName = document.getElementById("folderName").value.trim();
  const selectedVoice = document.getElementById("voiceSelect").value;
  const selectedSections = document.getElementById("sectionsNumber").value;
  const minWords = parseInt(document.getElementById("minWords").value) || 800;
  const maxWords = parseInt(document.getElementById("maxWords")?.value) || 1100;
  const selectedStyle = document.getElementById("styleSelect")?.value || 'default';
  const imageCount = parseInt(document.getElementById("imagesSelect")?.value) || 5;
  const aspectRatio = document.getElementById("aspectRatioSelect")?.value || '16:9';
  const promptModifier = document.getElementById("promptModifier")?.value?.trim() || '';
  const selectedLlmModel = document.getElementById("llmModelSelect")?.value || 'gemini';
  let googleImages = document.getElementById("googleImages")?.checked || false;
  let localAIImages = document.getElementById("localAIImages")?.checked || false;
  
  // Para imágenes generadas por Gemini: solo generar si el usuario quiere IA (localAIImages checkbox)
  // o si quiere imágenes de Google (que requiere prompts generados por IA)
  let geminiGeneratedImages = localAIImages; // Solo si seleccionó "Generar imágenes con IA"
  
  console.log("🖼️ Configuración de imágenes:");
  console.log("  - Google Images:", googleImages);
  console.log("  - Local AI Images (ComfyUI):", localAIImages);
  console.log("  - Gemini Generated Images:", geminiGeneratedImages);
  
  // Calcular automáticamente skipImages: true si NO hay opciones de imágenes activas
  let skipImages = !googleImages && !localAIImages && !geminiGeneratedImages;
  console.log("  - Skip Images:", skipImages);
  
  const generateAudio = document.getElementById("autoGenerateAudio").checked;
  const generateApplioAudio = document.getElementById("autoGenerateApplioAudio").checked;
  const selectedApplioVoice = document.getElementById("applioVoiceSelect").value;
  const selectedApplioModel = document.getElementById("applioModelSelect").value;
  const applioPitch = parseInt(document.getElementById("applioPitch").value) || 0;
  
  // 🔧 VALIDACIÓN: Solo una opción de imagen puede estar activa
  if (!isLoadingProject) {
    let activeImageOptions = [googleImages, localAIImages, geminiGeneratedImages].filter(Boolean).length;
    if (activeImageOptions > 1) {
      console.warn('⚠️ Configuración contradictoria detectada: múltiples opciones de imagen activas');
      // Prioridad: LocalAI > Gemini > GoogleImages
      if (localAIImages) {
        googleImages = false;
        geminiGeneratedImages = false;
        document.getElementById("googleImages").checked = false;
        document.getElementById("geminiGeneratedImages").checked = false;
        console.warn('🔧 Corrigiendo: Desactivando otras opciones porque IA Local tiene prioridad');
        showNotification('⚠️ Corrección automática: Solo IA Local activa', 'warning');
      } else if (geminiGeneratedImages) {
        googleImages = false;
        document.getElementById("googleImages").checked = false;
        console.warn('🔧 Corrigiendo: Desactivando Google Images porque Gemini tiene prioridad');
        showNotification('⚠️ Corrección automática: Solo Gemini Images activa', 'warning');
      }
    }
    // Recalcular skipImages después de la validación
    skipImages = !googleImages && !localAIImages && !geminiGeneratedImages;
  }
  
  console.log(`🔊 Generación de audio Google: ${generateAudio ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`🎤 Generación de audio Applio: ${generateApplioAudio ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`🖼️ Imágenes de Google: ${googleImages ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`🧠 Imágenes IA Local: ${localAIImages ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`✨ Imágenes Gemini/Imagen 4: ${geminiGeneratedImages ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`🚫 Omitir imágenes (auto): ${skipImages ? 'ACTIVADA' : 'DESACTIVADA'}`);
  
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
    console.log('\n' + '🚀'.repeat(50));
    console.log('🚀 USANDO NUEVO SISTEMA DE GENERACIÓN POR LOTES');
    console.log('🚀'.repeat(50));
    
    // 📊 INICIALIZAR BARRA DE PROGRESO
    showProgressBar();
    startElapsedTimeCounter();
    resetProgressBar();
    
    updateProgressBar({
      percentage: 0,
      phase: 'script',
      currentStep: 0,
      totalSteps: totalSections,
      estimatedTimeRemaining: 'Calculando...',
      currentTask: 'Iniciando generación automática...'
    });
    
    // Obtener configuración de ComfyUI si está habilitada
    let comfyUISettings = null;
    if (localAIImages) {
      comfyUISettings = getComfyUISettings();
      console.log('🎨 Configuración ComfyUI obtenida del frontend:', comfyUISettings);
    }
    
    const customStyleInstructions = getCustomStyleInstructions(selectedStyle);
    
    // ===============================================================
    // FASE 1: GENERAR TODOS LOS GUIONES Y PROMPTS DE IMÁGENES
    // ===============================================================
    console.log('\n📝 INICIANDO FASE 1: Generación de guiones y prompts...');
    // updateGenerationProgress(1, 3, 'script', 'Generando todos los guiones...');
    
    updateProgressBar({
      percentage: 5,
      phase: 'script',
      currentStep: 0,
      totalSteps: totalSections,
      estimatedTimeRemaining: 'Calculando...',
      currentTask: 'Generando guiones y prompts de imágenes...'
    });

    // 📊 INICIAR POLLING DEL PROGRESO EN TIEMPO REAL ANTES DE LA GENERACIÓN
    function createSafeFolderName(topic) {
      return topic
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // Remover caracteres especiales
        .replace(/\s+/g, '_') // Reemplazar espacios con guiones bajos
        .substring(0, 50); // Limitar longitud
    }
    
    // Usar folderName si está disponible, si no usar topic (igual que en backend)
    const projectKey = folderName ? createSafeFolderName(folderName) : createSafeFolderName(topic);
    console.log('📊 Iniciando seguimiento de progreso ANTES de la generación para proyecto:', projectKey);
    console.log('🔑 Generando projectKey desde:', folderName ? `folderName: "${folderName}"` : `topic: "${topic}"`);
    startProgressPolling(projectKey);
    
    const phase1Response = await fetch("/generate-batch-automatic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: topic,
        folderName: folderName,
        voice: selectedVoice,
        totalSections: totalSections,
        minWords: minWords,
        maxWords: maxWords,
        imageCount: imageCount,
        aspectRatio: aspectRatio,
        promptModifier: promptModifier,
        imageModel: 'gemini', // Usar Gemini por defecto
        llmModel: selectedLlmModel,
        skipImages: skipImages,
        googleImages: googleImages,
        localAIImages: localAIImages,
        geminiGeneratedImages: geminiGeneratedImages,
        comfyUISettings: comfyUISettings,
        scriptStyle: selectedStyle,
        customStyleInstructions: customStyleInstructions,
        applioVoice: selectedApplioVoice,
        applioModel: selectedApplioModel,
        applioPitch: applioPitch,
        useApplio: generateApplioAudio
      })
    });

    const phase1Data = await phase1Response.json();
    
    if (!phase1Data.success) {
      throw new Error(`Fase 1 falló: ${phase1Data.error}`);
    }
    
    console.log('✅ FASE 1 COMPLETADA:', phase1Data.message);
    const projectData = phase1Data.data;
    
    // El polling ya se inició antes de la generación
    console.log('📊 Polling ya activo para proyecto:', projectData.projectKey);
    
    // Mostrar los guiones generados en la UI
    allSections = projectData.sections.map(section => section.script);
    for (let i = 0; i < projectData.sections.length; i++) {
      const sectionData = {
        script: projectData.sections[i].script,
        imagePrompts: projectData.imagePrompts.find(ip => ip.section === i + 1)?.prompts || []
      };
      await displaySectionContent(sectionData, i + 1);
      
      // Si hay prompts, agregarlos al panel lateral inmediatamente
      if (sectionData.imagePrompts.length > 0) {
        console.log(`🎨 Agregando ${sectionData.imagePrompts.length} prompts al panel lateral para sección ${i + 1}`);
        addPromptsToSidebar(sectionData.imagePrompts, i + 1);
      }
    }
    
    // ===============================================================
    // FASE 2: GENERAR TODOS LOS ARCHIVOS DE AUDIO
    // ===============================================================
    if (generateAudio || generateApplioAudio) {
      console.log('\n🎵 INICIANDO FASE 2: Generación de audio...');
      // updateGenerationProgress(2, 3, 'audio', 'Generando todos los audios...');
      
      const phase2Response = await fetch("/generate-batch-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectData: projectData,
          useApplio: generateApplioAudio,
          voice: selectedVoice,
          applioVoice: selectedApplioVoice,
          applioModel: selectedApplioModel,
          applioPitch: applioPitch,
          folderName: projectData.projectKey  // Usar el projectKey del backend que ya está normalizado
        })
      });

      const phase2Data = await phase2Response.json();
      
      if (!phase2Data.success) {
        throw new Error(`Fase 2 falló: ${phase2Data.error}`);
      }
      
      console.log('✅ FASE 2 COMPLETADA:', phase2Data.message);
    } else {
      console.log('⏭️ FASE 2 OMITIDA: No se solicitó generación de audio');
    }
    
    // ===============================================================
    // FASE 3: GENERAR TODAS LAS IMÁGENES
    // ===============================================================
    if (!skipImages) {
      console.log('\n🎨 INICIANDO FASE 3: Generación de imágenes...');
      // updateGenerationProgress(3, 3, 'images', 'Generando todas las imágenes...');
      
      const phase3Response = await fetch("/generate-batch-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectData: projectData,
          skipImages: skipImages,
          googleImages: googleImages,
          localAIImages: localAIImages,
          geminiGeneratedImages: geminiGeneratedImages,
          imageModel: 'gemini', // Usar Gemini por defecto
          aspectRatio: aspectRatio,
          comfyUISettings: comfyUISettings,
          folderName: projectData.projectKey  // Usar el projectKey del backend que ya está normalizado
        })
      });

      const phase3Data = await phase3Response.json();
      
      if (!phase3Data.success) {
        throw new Error(`Fase 3 falló: ${phase3Data.error}`);
      }
      
      console.log('✅ FASE 3 COMPLETADA:', phase3Data.message);
      
      // 🎨 PROCESAR LAS IMÁGENES GENERADAS PARA MOSTRAR CARRUSEL
      if (phase3Data.data && phase3Data.data.imageResults) {
        console.log('🖼️ Procesando imágenes generadas para mostrar carrusel...');
        console.log('🖼️ Datos de imágenes:', phase3Data.data.imageResults);
        
        // Procesar cada sección y mostrar sus imágenes
        phase3Data.data.imageResults.forEach((sectionResult, index) => {
          const sectionNum = sectionResult.section;
          const images = sectionResult.images;
          
          if (images && images.length > 0) {
            console.log(`🖼️ Mostrando carrusel para sección ${sectionNum} con ${images.length} imágenes`);
            
            // Preparar datos de imágenes para el carrusel
            const imageData = images.map(img => ({
              path: img.path,
              filename: img.filename,
              url: img.url,
              source: img.source || 'Google Images',
              keywords: img.keywords,
              caption: img.caption || img.keywords
            }));
            
            // Guardar en allSections para navegación entre secciones
            if (allSections[sectionNum - 1]) {
              allSections[sectionNum - 1].images = imageData;
              allSections[sectionNum - 1].imageMode = 'bing';
              allSections[sectionNum - 1].bingImagesMode = true;
              
              // Guardar keywords para botones de refrescar
              const keywords = images.map(img => img.keywords).filter(k => k);
              allSections[sectionNum - 1].imageKeywords = keywords;
              
              console.log(`💾 Datos de imágenes guardados en allSections[${sectionNum - 1}] con ${keywords.length} keywords`);
            }
            
            // Mostrar el carrusel para esta sección
            try {
              createCarousel(imageData, sectionNum, []);
              console.log(`✅ Carrusel creado para sección ${sectionNum}`);
            } catch (carouselError) {
              console.error(`❌ Error creando carrusel para sección ${sectionNum}:`, carouselError);
            }
          } else {
            console.log(`⚠️ Sección ${sectionNum} no tiene imágenes para mostrar`);
          }
        });
      } else {
        console.log('⚠️ No se recibieron datos de imágenes en la respuesta de fase 3');
      }
    } else {
      console.log('⏭️ FASE 3 OMITIDA: Se solicitó omitir imágenes');
    }
    
    console.log('\n' + '🎉'.repeat(50));
    console.log('🎉 GENERACIÓN AUTOMÁTICA POR LOTES COMPLETADA');
    console.log('🎉'.repeat(50));
    
    // 📊 COMPLETAR BARRA DE PROGRESO
    completeProgressBar('¡Generación automática completada exitosamente!');
    
    showAutoGenerationComplete();
    
  } catch (error) {
    console.error("❌ Error durante generación automática:", error);
    showProgressError(error.message);
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
  
  // Asegurar que esté habilitado
  generateBtn.disabled = false;
  
  // Limpiar cualquier etapa de loading residual
  const loadingStages = output.querySelector('.loading-stages');
  if (loadingStages) {
    loadingStages.remove();
    console.log("🧹 Etapas de loading residuales limpiadas");
  }
  
  console.log("🔄 Botón de generar restaurado a su estado original");
}

// Función para obtener las instrucciones del estilo personalizado
function getCustomStyleInstructions(styleId) {
  console.log(`🎨 DEBUG - getCustomStyleInstructions llamada con styleId: "${styleId}"`);
  console.log(`🎨 DEBUG - customStyles array:`, customStyles);
  
  if (!styleId || !styleId.startsWith('custom_')) {
    console.log(`🎨 DEBUG - No es un estilo personalizado: ${styleId}`);
    return null;
  }
  
  const customStyle = customStyles.find(style => style.id === styleId);
  console.log(`🎨 DEBUG - Estilo encontrado:`, customStyle);
  
  if (customStyle) {
    console.log(`🎨 DEBUG - Instrucciones del estilo: ${customStyle.instructions}`);
    return customStyle.instructions;
  }
  
  console.log(`🎨 DEBUG - No se encontró el estilo personalizado`);
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
      console.log('🎨 Configuración ComfyUI obtenida del frontend:', comfyUISettings);
      
      // Debug extra para verificar valores específicos
      console.log('🔍 Valores específicos:', {
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
        geminiGeneratedImages: params.geminiGeneratedImages,
        comfyUISettings: comfyUISettings, // Agregar configuración ComfyUI
        applioVoice: params.selectedApplioVoice,
        applioModel: params.selectedApplioModel,
        applioPitch: params.applioPitch,
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
    console.log(`🎤 Iniciando generación de audio con Applio para sección ${section}...`);
    
    if (!allSections[section - 1]) {
      throw new Error(`No hay guión disponible para la sección ${section}`);
    }
    
    // Obtener el script de la sección (compatible con formato nuevo y antiguo)
    const sectionData = allSections[section - 1];
    const script = typeof sectionData === 'string' ? sectionData : sectionData.script;
    
    const selectedApplioVoice = document.getElementById("applioVoiceSelect").value;
    const selectedApplioModel = document.getElementById("applioModelSelect").value;
    const applioPitch = parseInt(document.getElementById("applioPitch").value) || 0;
    console.log(`🎤 Usando voz de Applio: ${selectedApplioVoice}`);
    console.log(`🎛️ Usando modelo de Applio: ${selectedApplioModel}`);
    console.log(`🎵 Usando pitch: ${applioPitch}`);
    
    const response = await fetch("/generate-section-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: script, // Usar el guión de la sección actual
        topic: currentTopic,
        folderName: document.getElementById("folderName").value.trim(),
        currentSection: section,
        voice: "fr-FR-RemyMultilingualNeural", // Voz de TTS (se mantiene)
        applioVoice: selectedApplioVoice, // Voz del modelo de Applio
        applioModel: selectedApplioModel, // Modelo TTS de Applio
        applioPitch: applioPitch // Pitch para Applio
      })
    });

    const data = await response.json();
    
    if (data.success && data.audioFile) {
      console.log(`✅ Audio Applio generado exitosamente para sección ${section}: ${data.audioFile}`);
      console.log(`📊 Tamaño: ${(data.size / 1024).toFixed(1)} KB con ${data.method}`);
      
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
    console.error(`❌ Error generando audio Applio para sección ${section}:`, error);
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
    console.log(`🎵 Iniciando generación de audio para sección ${section}...`);
    
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
      console.log(`✅ Audio generado exitosamente para sección ${section}: ${data.audio}`);
      
      // Esperar un momento adicional para asegurar que el archivo se escribió completamente
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      console.log(`🎵 Audio completamente procesado para sección ${section}`);
      return { success: true, data };
    } else {
      return { success: false, error: data.error || "Error generando audio" };
    }
  } catch (error) {
    console.error(`❌ Error generando audio para sección ${section}:`, error);
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
      
      console.log(`🔍 DEBUG displaySectionContent - skipImages: ${skipImages}`);
      console.log(`🔍 DEBUG displaySectionContent - bingImages: ${bingImages}`);
      console.log(`🔍 DEBUG displaySectionContent - localAIImages: ${localAIImages}`);
      console.log(`🔍 DEBUG displaySectionContent - downloadedImages.length: ${downloadedImages.length}`);
      console.log(`🔍 DEBUG displaySectionContent - localAIImagesData.length: ${localAIImagesData.length}`);
      console.log(`🔍 DEBUG displaySectionContent - data.imagesSkipped: ${data.imagesSkipped}`);
      console.log(`🔍 DEBUG displaySectionContent - data.bingImagesMode: ${data.bingImagesMode}`);
      console.log(`🔍 DEBUG displaySectionContent - data.localAIMode: ${data.localAIMode}`);
      console.log(`🔍 DEBUG displaySectionContent - data.images: ${data.images ? data.images.length : 'null'}`);
      console.log(`🔍 DEBUG displaySectionContent - data.imagePrompts: ${data.imagePrompts ? data.imagePrompts.length : 'null'}`);
      
      console.log(`🔍 DEBUG displaySectionContent - EVALUANDO CONDICIONES:`);
      console.log(`🔍 DEBUG - Condición 1 (IA Local): localAIImages=${localAIImages} && localAIImagesData.length=${localAIImagesData.length} > 0 = ${localAIImages && localAIImagesData.length > 0}`);
      console.log(`🔍 DEBUG - Condición 2 (Bing): bingImages=${bingImages} && downloadedImages.length=${downloadedImages.length} > 0 = ${bingImages && downloadedImages.length > 0}`);
      console.log(`🔍 DEBUG - Condición 3 (Normal): !skipImages=${!skipImages} && !bingImages=${!bingImages} && !localAIImages=${!localAIImages} && data.images=${data.images ? 'exists' : 'null'} = ${!skipImages && !bingImages && !localAIImages && data.images && data.images.length > 0}`);
      
      if (localAIImages && localAIImagesData.length > 0) {
        // Mostrar carrusel con imágenes generadas por IA Local
        console.log(`🤖 Mostrando carrusel con ${localAIImagesData.length} imágenes de IA Local`);
        console.log(`🤖 DEBUG - Datos de la primera imagen IA Local:`, localAIImagesData[0]);
        
        createCarousel(localAIImagesData, section, []);
        
        // Almacenar imágenes de IA Local en allSections
        if (allSections[section - 1]) {
          allSections[section - 1].images = localAIImagesData;
          allSections[section - 1].localAIMode = true;
          console.log(`📂 Imágenes de IA Local almacenadas en allSections[${section - 1}]`);
        }
        
      } else if (bingImages && downloadedImages.length > 0) {
        // Mostrar carrusel con imágenes descargadas de Bing
        console.log(`🖼️ Mostrando carrusel con ${downloadedImages.length} imágenes de Bing`);
        console.log(`🖼️ DEBUG - Datos de la primera imagen:`, downloadedImages[0]);
        console.log(`🔍 DEBUG - data.imageKeywords:`, data.imageKeywords);
        console.log(`🔍 DEBUG - data completa:`, data);
        
        // Almacenar las keywords para el botón de refresh
        if (data.imageKeywords && data.imageKeywords.length > 0) {
          currentImageKeywords = data.imageKeywords;
          console.log(`🎯 Keywords almacenadas para refresh (bloque principal):`, currentImageKeywords);
        } else {
          console.warn(`⚠️ No se recibieron keywords para refresh (bloque principal)`);
          console.warn(`⚠️ DEBUG - data.imageKeywords:`, data.imageKeywords);
          currentImageKeywords = [];
        }
        
        console.log(`🖼️ DEBUG - Llamando a createCarousel...`);
        createCarousel(downloadedImages, section, []);
        console.log(`🖼️ DEBUG - createCarousel ejecutado`);
        
        // Guardar datos de imágenes en la sección para navegación
        if (allSections[section - 1]) {
          allSections[section - 1].images = downloadedImages;
          allSections[section - 1].imageKeywords = data.imageKeywords || [];
          allSections[section - 1].imageMode = 'bing';
          console.log(`💾 Datos de imágenes Bing guardados para sección ${section}`);
        }
      } else if (!skipImages && !bingImages && !localAIImages && data.images && data.images.length > 0) {
        // Mostrar carrusel de imágenes normales
        console.log(`📷 Mostrando carrusel de imágenes normales`);
        createCarousel(data.images, section, data.imagePrompts);
        
        // Guardar datos de imágenes en la sección para navegación
        if (allSections[section - 1]) {
          allSections[section - 1].images = data.images;
          allSections[section - 1].imagePrompts = data.imagePrompts || [];
          allSections[section - 1].imageMode = 'ai';
          console.log(`💾 Datos de imágenes AI guardados para sección ${section}`);
        }
      } else if (bingImages && data.imagePrompts && data.imagePrompts.length > 0) {
        // Fallback: mostrar prompts si falló la descarga de Bing
        console.log(`⚠️ Descarga de Bing falló, mostrando prompts como fallback`);
        addPromptsToSidebar(data.imagePrompts, section);
        
        // Guardar datos de prompts en la sección para navegación
        if (allSections[section - 1]) {
          allSections[section - 1].imagePrompts = data.imagePrompts;
          allSections[section - 1].imageMode = 'prompts';
          console.log(`💾 Datos de prompts guardados para sección ${section}`);
        }
      } else if (data.imagePrompts && data.imagePrompts.length > 0) {
        // Mostrar prompts de imágenes en el panel lateral
        console.log(`📋 Mostrando prompts en el panel lateral`);
        addPromptsToSidebar(data.imagePrompts, section);
        
        // Guardar datos de prompts en la sección para navegación
        if (allSections[section - 1]) {
          allSections[section - 1].imagePrompts = data.imagePrompts;
          allSections[section - 1].imageMode = 'prompts';
          console.log(`💾 Datos de prompts guardados para sección ${section}`);
        }
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
  generateBtn.innerHTML = `
    <i class="fas fa-check-circle"></i>
    <span>Generación Automática Completada</span>
  `;
  
  // Limpiar las etapas de loading
  const loadingStages = output.querySelector('.loading-stages');
  if (loadingStages) {
    loadingStages.remove();
    console.log("🧹 Etapas de loading limpiadas");
  }
  
  // Mostrar mensaje de éxito
  const successMessage = document.createElement('div');
  successMessage.className = 'auto-completion-message';
  successMessage.innerHTML = `
    <div class="success-content">
      <i class="fas fa-trophy"></i>
      <h3>¡Generación Automática Completada!</h3>
      <p>Se han generado exitosamente ${totalSections} secciones con guión, imágenes y audio.</p>
      <p>Generando metadata para YouTube...</p>
    </div>
  `;
  
  output.insertBefore(successMessage, output.firstChild);
  
  // Generar metadata de YouTube
  await generateYouTubeMetadata();
  
  // Mostrar botón de generación de video
  showVideoGenerationButton();
  
  // 🎬 VERIFICAR Y GENERAR VIDEO AUTOMÁTICAMENTE
  if (shouldGenerateVideoAutomatically()) {
    const folderName = document.getElementById("folderName").value.trim();
    if (folderName && !isGeneratingVideo) {
      console.log('🎬 Generación completa - iniciando video automático...');
      
      // Actualizar mensaje de éxito para incluir video
      successMessage.innerHTML = `
        <div class="success-content">
          <i class="fas fa-trophy"></i>
          <h3>¡Generación Automática Completada!</h3>
          <p>Se han generado exitosamente ${totalSections} secciones con guión, imágenes y audio.</p>
          <p>Metadata de YouTube completada.</p>
          <p><strong>🎬 Iniciando generación automática de video...</strong></p>
        </div>
      `;
      
      // Delay para que se vea el mensaje actualizado antes de iniciar el video
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
}

// Función para habilitar/deshabilitar controles
function disableControls(disable) {
  const controls = [
    'prompt', 'folderName', 'voiceSelect', 'sectionsNumber', 
    'styleSelect', 'imagesSelect', 'aspectRatioSelect', 'promptModifier', 'modelSelect', 'llmModelSelect',
    'autoGenerateAudio', 'autoGenerateApplioAudio', 'googleImages', 'localAIImages', 'geminiGeneratedImages'
  ];
  
  controls.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.disabled = disable;
    }
  });
  
  generateBtn.disabled = disable;
  continueBtn.disabled = disable;
  generateAudioBtn.disabled = disable;
  
  // También deshabilitar los botones de video
  const generateVideoBtn = document.getElementById("generateVideoBtn");
  if (generateVideoBtn) {
    generateVideoBtn.disabled = disable;
  }
  
  const generateSimpleVideoBtn = document.getElementById("generateSimpleVideoBtn");
  if (generateSimpleVideoBtn) {
    generateSimpleVideoBtn.disabled = disable;
  }
  
  const generateSeparateVideosBtn = document.getElementById("generateSeparateVideosBtn");
  if (generateSeparateVideosBtn) {
    generateSeparateVideosBtn.disabled = disable;
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
    console.warn(`⚠️ updateStage: Elemento con ID '${stageId}' no encontrado`);
    return;
  }
  
  const icon = stage.querySelector('.stage-icon i');
  
  // Validar que el icono existe
  if (!icon) {
    console.warn(`⚠️ updateStage: Icono no encontrado en elemento '${stageId}'`);
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
  console.log(`🎠 DEBUG - createCarousel llamada con ${images.length} imágenes para sección ${sectionNum}`);
  
  const carouselContainer = document.getElementById("carousel-container");
  const carouselTrack = document.getElementById("carouselTrack");
  const carouselIndicators = document.getElementById("carouselIndicators");
  const currentImageSpan = document.getElementById("current-image");
  const totalImagesSpan = document.getElementById("total-images");
  const carouselSectionTitle = document.getElementById("carousel-section-title");
  
  console.log(`🎠 DEBUG - Elementos encontrados:`, {
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
    if (imageData.path && (imageData.source === 'Google Images' || imageData.source === 'bing')) {
      // Imagen descargada de Google Images/Bing (usar ruta local del servidor)
      // Convertir la ruta absoluta a una ruta relativa del servidor web
      let relativePath = imageData.path.replace(/\\/g, '/');
      
      // Buscar la parte que viene después de 'public/'
      const publicIndex = relativePath.indexOf('/public/');
      if (publicIndex !== -1) {
        relativePath = relativePath.substring(publicIndex + 7); // +7 para saltar '/public'
      } else {
        // Fallback: buscar 'outputs/'
        const outputsIndex = relativePath.indexOf('outputs/');
        if (outputsIndex !== -1) {
          relativePath = '/' + relativePath.substring(outputsIndex);
        }
      }
      
      // Asegurar que empiece con '/'
      if (!relativePath.startsWith('/')) {
        relativePath = '/' + relativePath;
      }
      
      img.src = relativePath;
      img.alt = imageData.caption || `Imagen ${index + 1} de la Sección ${sectionNum}`;
      console.log(`🖼️ Cargando imagen local: ${relativePath} (original: ${imageData.path})`);
    } else if (imageData.url && !imageData.path) {
      // Imagen externa (URL directa de Bing - para casos sin descarga)
      img.src = imageData.url;
      img.alt = imageData.caption || `Imagen ${index + 1} de la Sección ${sectionNum}`;
      console.log(`🌐 Cargando imagen externa: ${imageData.url}`);
    } else if (imageData.image) {
      // Imagen generada con IA (base64)
      img.src = "data:image/png;base64," + imageData.image;
      img.alt = `Imagen ${index + 1} de la Sección ${sectionNum}`;
      console.log(`🤖 Cargando imagen IA (base64)`);
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
      console.log(`🔑 [createCarousel] Imagen ${index}: keyword="${imageKeyword}"`);
      
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
  console.log(`🎠 DEBUG - Mostrando carrusel: ${carouselContainer ? 'elemento encontrado' : 'elemento NO encontrado'}`);
  console.log(`🎠 DEBUG - Display antes:`, carouselContainer ? carouselContainer.style.display : 'N/A');
  
  carouselContainer.style.display = "block";
  
  console.log(`🎠 DEBUG - Display después:`, carouselContainer ? carouselContainer.style.display : 'N/A');
  console.log(`🎠 DEBUG - Computed display:`, carouselContainer ? getComputedStyle(carouselContainer).display : 'N/A');
  console.log(`🎠 DEBUG - Visibility:`, carouselContainer ? getComputedStyle(carouselContainer).visibility : 'N/A');
  console.log(`🎠 DEBUG - OffsetHeight:`, carouselContainer ? carouselContainer.offsetHeight : 'N/A');
  
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
    const selectedImageModel = 'gemini'; // Usar Gemini por defecto
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
    console.log(`❌ No hay texto del guión para la sección ${currentSectionNumber}`);
    return;
  }
  
  // Usar la API moderna del portapapeles si está disponible
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(scriptText).then(() => {
      console.log(`✅ Texto del guión de la sección ${currentSectionNumber} copiado al portapapeles`);
      showCopyNotification();
    }).catch(err => {
      console.error('❌ Error copiando al portapapeles:', err);
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
      console.log('✅ Texto del guión copiado al portapapeles (fallback)');
      showCopyNotification();
    } else {
      console.error('❌ Error copiando al portapapeles (fallback)');
    }
  } catch (err) {
    console.error('❌ Error ejecutando comando de copia:', err);
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
    console.error('❌ Botón de audio no encontrado');
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

    console.log(`🎵 Generando audio con Applio para sección ${currentSectionNumber}...`);

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
      
      console.log(`✅ Audio generado: ${result.audioFile}`);
      
    } else {
      throw new Error(result.error || 'Error generando audio');
    }

  } catch (error) {
    console.error('❌ Error generando audio:', error);
    
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
        <p style="color: #00ff7f; margin-top: 15px;"><i class="fas fa-youtube"></i> Generando metadatos de YouTube automáticamente...</p>
      </div>
    `;
    
    // 🎬 GENERAR METADATOS DE YOUTUBE AUTOMÁTICAMENTE CUANDO SE COMPLETA EL PROYECTO
    console.log('🎬 Proyecto completado! Generando metadatos de YouTube automáticamente...');
    setTimeout(() => {
      generateYouTubeMetadata().then(() => {
        console.log('✅ Metadatos de YouTube generados automáticamente al completar proyecto');
        showNotification('🎬 Metadatos de YouTube generados automáticamente', 'success');
      }).catch(error => {
        console.error('❌ Error generando metadatos automáticos:', error);
        showNotification('⚠️ Error generando metadatos automáticos', 'warning');
      });
    }, 2000); // Delay para que se muestre el mensaje de completación primero
    
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
  console.log("🔍 DEBUG: Botón clickeado");
  
  // Generación automática está siempre activada
  const autoGenerate = true;
  console.log(`🔍 DEBUG: autoGenerate = ${autoGenerate}`);
  
  if (autoGenerate) {
    console.log("🤖 DETECTADO: Generación automática ACTIVADA - usando sistema de lotes");
    // Pequeño delay para asegurar que el DOM esté completamente listo
    setTimeout(async () => {
      await runAutoGeneration();
    }, 100);
    return;
  }
  
  console.log("📝 DETECTADO: Generación automática DESACTIVADA - usando sistema tradicional");
  
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
  const selectedImageModel = 'gemini'; // Usar Gemini por defecto
  const selectedLlmModel = document.getElementById("llmModelSelect").value;
  const skipImages = document.getElementById("skipImages").checked;
  const googleImages = document.getElementById("googleImages").checked;
  const localAIImages = document.getElementById("localAIImages").checked;
  const selectedApplioVoice = document.getElementById("applioVoiceSelect").value;
  const selectedApplioModel = document.getElementById("applioModelSelect").value;
  const applioPitch = parseInt(document.getElementById("applioPitch").value) || 0;
  
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
  generateBtn.innerHTML = `
    <i class="fas fa-spinner loading"></i>
    <span>Generando Sección 1...</span>
  `;
  
  // Ocultar contenido anterior
  document.getElementById("script-section").style.display = "none";
  document.getElementById("carousel-container").style.display = "none";
  // document.getElementById("imagePromptPanel").style.display = "none"; // Comentado: Panel eliminado
  generateAudioBtn.style.display = "none";
  continueBtn.style.display = "none";
  
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
        geminiGeneratedImages: geminiGeneratedImages,
        applioVoice: selectedApplioVoice,
        applioModel: selectedApplioModel,
        applioPitch: applioPitch
      })
    });

    const data = await response.json();

    // Almacenar estructura de capítulos si está disponible (función principal)
    if (data.chapterStructure) {
      storeChapterStructure(data.chapterStructure);
      console.log('📚 Estructura de capítulos recibida:', data.chapterStructure.length, 'capítulos');
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
            console.log(`🤖 Mostrando carrusel con ${data.localAIImages.length} imágenes de IA Local`);
            
            createCarousel(data.localAIImages, data.currentSection, data.imagePrompts || []);
            
            // Guardar datos de imágenes en la sección para navegación
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.localAIImages;
              allSections[data.currentSection - 1].imagePrompts = data.imagePrompts || [];
              allSections[data.currentSection - 1].imageMode = 'local_ai';
              allSections[data.currentSection - 1].localAIMode = true;
              console.log(`💾 Datos de imágenes IA Local guardados para sección ${data.currentSection}`);
            }
            
          } else if (data.downloadedImages && data.downloadedImages.length > 0) {
            // Imágenes de Bing descargadas
            console.log(`🖼️ Mostrando carrusel con ${data.downloadedImages.length} imágenes de Bing`);
            
            // ✅ IMPORTANTE: Almacenar las keywords ANTES de crear el carrusel
            if (data.imageKeywords && data.imageKeywords.length > 0) {
              currentImageKeywords = data.imageKeywords;
              console.log(`🎯 Keywords almacenadas para refresh (función principal):`, currentImageKeywords);
            } else {
              console.warn(`⚠️ No se recibieron keywords para refresh (función principal)`);
              console.warn(`⚠️ DEBUG - data.imageKeywords:`, data.imageKeywords);
              console.warn(`⚠️ DEBUG - data completa:`, data);
              currentImageKeywords = [];
            }
            
            // ✅ Crear carrusel después de asignar keywords
            createCarousel(data.downloadedImages, data.currentSection, []);
            
            // Guardar datos de imágenes en la sección para navegación (función principal)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.downloadedImages;
              allSections[data.currentSection - 1].imageKeywords = data.imageKeywords || [];
              allSections[data.currentSection - 1].imageMode = 'bing';
              console.log(`💾 Datos de imágenes Bing guardados para sección ${data.currentSection} (función principal)`);
            }
          } else if (data.images && data.images.length > 0) {
            // Imágenes generadas con IA
            console.log(`📷 Mostrando carrusel de imágenes IA`);
            createCarousel(data.images, data.currentSection, data.imagePrompts);
            
            // Guardar datos de imágenes en la sección para navegación (función principal)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.images;
              allSections[data.currentSection - 1].imagePrompts = data.imagePrompts || [];
              allSections[data.currentSection - 1].imageMode = 'ai';
              console.log(`💾 Datos de imágenes AI guardados para sección ${data.currentSection} (función principal)`);
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
          console.log(`🔍 DEBUG FRONTEND - Verificando imágenes/prompts...`);
          console.log(`🔍 DEBUG FRONTEND - data.downloadedImages:`, data.downloadedImages);
          console.log(`🔍 DEBUG FRONTEND - data.bingImagesMode:`, data.bingImagesMode);
          console.log(`🔍 DEBUG FRONTEND - data.imagePrompts:`, data.imagePrompts);
          console.log(`🔍 DEBUG FRONTEND - data.googleImagesMode:`, data.googleImagesMode);
          console.log(`🔍 DEBUG FRONTEND - data.mode:`, data.mode);
          
          // Mostrar imágenes de Bing en carrusel si están disponibles
          if (data.downloadedImages && data.downloadedImages.length > 0 && data.bingImagesMode) {
            console.log(`🖼️ Mostrando carrusel tardío con ${data.downloadedImages.length} imágenes de Bing`);
            
            // Almacenar las keywords para el botón de refresh
            if (data.imageKeywords && data.imageKeywords.length > 0) {
              currentImageKeywords = data.imageKeywords;
              console.log(`🎯 Keywords almacenadas para refresh:`, currentImageKeywords);
            } else {
              console.warn(`⚠️ No se recibieron keywords para refresh`);
              currentImageKeywords = [];
            }
            
            createCarousel(data.downloadedImages, data.currentSection, []);
          }
          // Solo mostrar en panel lateral si NO se omiten imágenes, NO hay imágenes de Bing y SÍ hay prompts tradicionales
          else if (!skipImages && data.imagePrompts && data.imagePrompts.length > 0 && !data.bingImagesMode) {
            if (data.googleImagesMode) {
              console.log(`🔗 DEBUG FRONTEND - Ejecutando createGoogleImageLinks con ${data.imagePrompts.length} keywords`);
              createGoogleImageLinks(data.imagePrompts, data.currentSection);
            } else {
              console.log(`📋 DEBUG FRONTEND - Ejecutando addPromptsToSidebar con ${data.imagePrompts.length} prompts`);
              addPromptsToSidebar(data.imagePrompts, data.currentSection);
            }
          } else {
            if (skipImages) {
              console.log(`⏭️ DEBUG FRONTEND - Omitiendo prompts de imagen porque skipImages está activado`);
            } else {
              console.log(`❌ DEBUG FRONTEND - No se encontraron imágenes ni prompts válidos`);
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
    generateBtn.innerHTML = `
      <i class="fas fa-video"></i>
      <span>Generar Sección 1</span>
    `;
  }
});

// Event listener para el botón de continuar
continueBtn.addEventListener("click", async () => {
  console.log('🚀 CONTINUAR BUTTON CLICKED');
  console.log('📊 Variables de estado actual:', {
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
  console.log('🎯 Sección que se va a generar:', nextSection);
  
  const imageCount = parseInt(document.getElementById("imagesSelect").value);
  const aspectRatio = document.getElementById("aspectRatioSelect").value;
  // 🔧 FIX: Usar el folderName del proyecto cargado si existe, sino el del input
  const folderName = window.currentProject ? window.currentProject.folderName : document.getElementById("folderName").value.trim();
  console.log('📁 Usando folderName:', folderName, 'desde proyecto cargado:', !!window.currentProject);
  const selectedStyle = document.getElementById("styleSelect").value;
  const promptModifier = document.getElementById("promptModifier").value.trim();
  const selectedImageModel = 'gemini'; // Usar Gemini por defecto
  const selectedLlmModel = document.getElementById("llmModelSelect").value;
  let skipImages = document.getElementById("skipImages").checked;
  let googleImages = document.getElementById("googleImages").checked;
  
  // 🔧 VALIDACIÓN: No se puede omitir imágenes Y usar Google Images al mismo tiempo
  // PERO solo aplicar esta validación si NO estamos cargando un proyecto
  if (skipImages && googleImages && !isLoadingProject) {
    console.warn('⚠️ Configuración contradictoria detectada en CONTINUAR: skipImages=true y googleImages=true');
    console.warn('🔧 Corrigiendo: Desactivando skipImages porque googleImages tiene prioridad');
    skipImages = false;
    document.getElementById("skipImages").checked = false;
    showNotification('⚠️ Corrección automática: No puedes omitir imágenes si usas Google Images', 'warning');
  } else if (skipImages && googleImages && isLoadingProject) {
    console.log('📂 Continuando proyecto: Permitiendo skipImages=true y googleImages=true (solo guión + keywords)');
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
        llmModel: selectedLlmModel,
        skipImages: skipImages,
        googleImages: googleImages,
        localAIImages: localAIImages,
        geminiGeneratedImages: geminiGeneratedImages,
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
      
      console.log(`🔍 DEBUG continueGeneration - skipImages: ${skipImages}`);
      console.log(`🔍 DEBUG continueGeneration - googleImages: ${googleImages}`);
      console.log(`🔍 DEBUG continueGeneration - serverSkipImages: ${serverSkipImages}`);
      console.log(`🔍 DEBUG continueGeneration - serverGoogleImages: ${serverGoogleImages}`);
      console.log(`🔍 DEBUG continueGeneration - data.imagesSkipped: ${data.imagesSkipped}`);
      console.log(`🔍 DEBUG continueGeneration - data.googleImagesMode: ${data.googleImagesMode}`);
      console.log(`🔍 DEBUG continueGeneration - data.images: ${data.images ? data.images.length : 'null'}`);
      console.log(`🔍 DEBUG continueGeneration - data.imagePrompts: ${data.imagePrompts ? data.imagePrompts.length : 'null'}`);
      console.log(`🔍 DEBUG continueGeneration - data.downloadedImages: ${data.downloadedImages ? data.downloadedImages.length : 'null'}`);
      
      if (!serverSkipImages && !serverGoogleImages && ((data.images && data.images.length > 0) || (data.downloadedImages && data.downloadedImages.length > 0))) {
        // Con imágenes (IA generadas o descargadas de Bing)
        console.log(`📷 continueGeneration - Mostrando carrusel de imágenes ${data.downloadedImages ? 'Bing' : 'IA'}`);
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
            console.log(`🖼️ continueGeneration - Creando carrusel con ${data.downloadedImages.length} imágenes de Bing`);
            
            // Almacenar las keywords para el botón de refresh
            if (data.imageKeywords && data.imageKeywords.length > 0) {
              currentImageKeywords = data.imageKeywords;
              console.log(`🎯 Keywords almacenadas para refresh (continueGeneration):`, currentImageKeywords);
            } else {
              console.warn(`⚠️ No se recibieron keywords para refresh (continueGeneration)`);
              currentImageKeywords = [];
            }
            
            createCarousel(data.downloadedImages, data.currentSection, []);
            
            // Guardar datos de imágenes en la sección para navegación (continueGeneration)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.downloadedImages;
              allSections[data.currentSection - 1].imageKeywords = data.imageKeywords || [];
              allSections[data.currentSection - 1].imageMode = 'bing';
              console.log(`💾 Datos de imágenes Bing guardados para sección ${data.currentSection} (continueGeneration)`);
            }
          } else if (data.images && data.images.length > 0) {
            // Imágenes generadas con IA
            console.log(`📷 continueGeneration - Creando carrusel con ${data.images.length} imágenes IA`);
            createCarousel(data.images, data.currentSection, data.imagePrompts);
            
            // Guardar datos de imágenes en la sección para navegación (continueGeneration)
            if (allSections[data.currentSection - 1]) {
              allSections[data.currentSection - 1].images = data.images;
              allSections[data.currentSection - 1].imagePrompts = data.imagePrompts || [];
              allSections[data.currentSection - 1].imageMode = 'ai';
              console.log(`💾 Datos de imágenes AI guardados para sección ${data.currentSection} (continueGeneration)`);
            }
          }
        }, 1000);
      } else if (!skipImages && serverGoogleImages && data.imagePrompts && data.imagePrompts.length > 0) {
        // Modo Google Images (solo si no se omiten imágenes)
        console.log(`🔗🔗🔗 continueGeneration - EJECUTANDO createGoogleImageLinks 🔗🔗🔗`);
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
        console.log(`📋 continueGeneration - Mostrando prompts en panel lateral (modo skipImages)`);
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
            console.log(`⏭️ DEBUG FRONTEND (continuar) - Omitiendo prompts de imagen porque skipImages está activado`);
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
  } finally {
    // Restaurar botón
    continueBtn.disabled = false;
    continueBtn.innerHTML = `
      <i class="fas fa-forward"></i>
      <span>Continuar con Sección ${nextSection}</span>
    `;
  }
});

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

// Event listener para el botón de generar video
document.getElementById("generateVideoBtn").addEventListener("click", async () => {
  // ✅ CORREGIDO: Usar folderName del proyecto actual, no del input original
  let folderName;
  
  if (window.currentProject && window.currentProject.folderName) {
    // Si hay proyecto cargado, usar su folderName normalizado
    folderName = window.currentProject.folderName;
    console.log(`🎯 Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    // Fallback: usar el input y normalizarlo
    const inputFolderName = document.getElementById("folderName").value.trim();
    if (!inputFolderName) {
      showError("Por favor, especifica el nombre de la carpeta del proyecto");
      return;
    }
    // Normalizar el nombre como lo hace el backend
    folderName = inputFolderName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    console.log(`🔧 Normalizando folderName: "${inputFolderName}" → "${folderName}"`);
  }
  
  if (!allSections || allSections.length === 0) {
    showError("No hay secciones generadas para crear el video");
    return;
  }
  
  console.log(`🎬 Iniciando generación de video para proyecto: ${folderName}`);
  
  try {
    await generateProjectVideo(folderName, false); // false = manual
  } catch (error) {
    console.error("❌ Error generando video:", error);
    showError(`Error generando video: ${error.message}`);
  }
});

// Event listener para el botón de generar video simple (sin animaciones)
document.getElementById("generateSimpleVideoBtn").addEventListener("click", async () => {
  // ✅ CORREGIDO: Usar folderName del proyecto actual, no del input original
  let folderName;
  
  if (window.currentProject && window.currentProject.folderName) {
    // Si hay proyecto cargado, usar su folderName normalizado
    folderName = window.currentProject.folderName;
    console.log(`🎯 Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    // Fallback: usar el input y normalizarlo
    const inputFolderName = document.getElementById("folderName").value.trim();
    if (!inputFolderName) {
      showError("Por favor, especifica el nombre de la carpeta del proyecto");
      return;
    }
    // Normalizar el nombre como lo hace el backend
    folderName = inputFolderName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    console.log(`🔧 Normalizando folderName: "${inputFolderName}" → "${folderName}"`);
  }
  
  if (!allSections || allSections.length === 0) {
    showError("No hay secciones generadas para crear el video");
    return;
  }
  
  console.log(`🎬 Iniciando generación de video simple para proyecto: ${folderName}`);
  
  try {
    await generateSimpleProjectVideo(folderName);
  } catch (error) {
    console.error("❌ Error generando video simple:", error);
    showError(`Error generando video simple: ${error.message}`);
  }
});

// Event listener para el botón de generar clips separados por sección
document.getElementById("generateSeparateVideosBtn").addEventListener("click", async () => {
  // ✅ CORREGIDO: Usar folderName del proyecto actual, no del input original
  let folderName;
  
  if (window.currentProject && window.currentProject.folderName) {
    // Si hay proyecto cargado, usar su folderName normalizado
    folderName = window.currentProject.folderName;
    console.log(`🎯 Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    // Fallback: usar el input y normalizarlo
    const inputFolderName = document.getElementById("folderName").value.trim();
    if (!inputFolderName) {
      showError("Por favor, especifica el nombre de la carpeta del proyecto");
      return;
    }
    // Normalizar el nombre como lo hace el backend
    folderName = inputFolderName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    console.log(`🔧 Normalizando folderName: "${inputFolderName}" → "${folderName}"`);
  }
  
  if (!allSections || allSections.length === 0) {
    showError("No hay secciones generadas para crear los clips");
    return;
  }
  
  console.log(`🎬 Iniciando generación de clips separados para proyecto: ${folderName}`);
  
  try {
    await generateSeparateVideos(folderName);
  } catch (error) {
    console.error("❌ Error generando clips separados:", error);
    showError(`Error generando clips separados: ${error.message}`);
  }
});

// Event listener para el botón de regenerar audios con Applio
document.getElementById("regenerateApplioAudiosBtn").addEventListener("click", async () => {
  console.log('🎤 Click en botón de regenerar audios con Applio');
  
  try {
    await regenerateAllApplioAudios();
  } catch (error) {
    console.error("❌ Error regenerando audios:", error);
    showError(`Error regenerando audios: ${error.message}`);
  }
});

// Event listener para el botón de regenerar guiones faltantes
document.getElementById("regenerateMissingScriptsBtn").addEventListener("click", async () => {
  console.log('📝 Click en botón de regenerar guiones faltantes');
  
  try {
    await regenerateMissingScripts();
  } catch (error) {
    console.error("❌ Error regenerando guiones:", error);
    showError(`Error regenerando guiones: ${error.message}`);
  }
});

// Event listener para el botón de generar imágenes faltantes
document.getElementById("generateMissingImagesBtn").addEventListener("click", async () => {
  console.log('🖼️ Click en botón de generar imágenes faltantes');
  
  try {
    await generateMissingImages();
  } catch (error) {
    console.error("❌ Error generando imágenes:", error);
    showError(`Error generando imágenes: ${error.message}`);
  }
});

// Event listener para el botón de generar solo prompts de imágenes
document.getElementById("generateMissingPromptsBtn").addEventListener("click", async () => {
  console.log('📝 Click en botón de generar solo prompts de imágenes');
  
  try {
    await generateMissingPrompts();
  } catch (error) {
    console.error("❌ Error generando prompts:", error);
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

// ⚡ Configurar eventos para los checkboxes de imágenes (manejo automático)
function setupImageCheckboxEvents() {
  const googleImagesCheckbox = document.getElementById("googleImages");
  const localAIImagesCheckbox = document.getElementById("localAIImages");
  const geminiImagesCheckbox = document.getElementById("geminiGeneratedImages");
  
  // Event listeners para mantener solo una opción activa
  if (googleImagesCheckbox) {
    googleImagesCheckbox.addEventListener("change", function() {
      if (this.checked) {
        if (localAIImagesCheckbox) localAIImagesCheckbox.checked = false;
        if (geminiImagesCheckbox) geminiImagesCheckbox.checked = false;
      }
    });
  }
  
  if (localAIImagesCheckbox) {
    localAIImagesCheckbox.addEventListener("change", function() {
      if (this.checked) {
        if (googleImagesCheckbox) googleImagesCheckbox.checked = false;
        if (geminiImagesCheckbox) geminiImagesCheckbox.checked = false;
      }
    });
  }
  
  if (geminiImagesCheckbox) {
    geminiImagesCheckbox.addEventListener("change", function() {
      if (this.checked) {
        if (googleImagesCheckbox) googleImagesCheckbox.checked = false;
        if (localAIImagesCheckbox) localAIImagesCheckbox.checked = false;
      }
    });
  }
}

// Inicializar eventos de checkboxes
document.addEventListener('DOMContentLoaded', function() {
  setupImageCheckboxEvents();
});

// Función para mostrar prompts de imágenes cuando se omiten las imágenes
function showImagePrompts(prompts, sectionNumber, promptsFileInfo) {
  console.log(`🎨 DEBUG showImagePrompts - Iniciando función...`);
  console.log(`🎨 DEBUG showImagePrompts - prompts recibidos:`, prompts);
  console.log(`🎨 DEBUG showImagePrompts - prompts.length:`, prompts ? prompts.length : 'undefined');
  console.log(`🎨 DEBUG showImagePrompts - sectionNumber:`, sectionNumber);
  console.log(`🎨 DEBUG showImagePrompts - promptsFileInfo:`, promptsFileInfo);
  
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    console.log(`❌ DEBUG showImagePrompts - Prompts inválidos o vacíos`);
    return;
  }
  
  console.log(`🎨 Mostrando ${prompts.length} prompts de imágenes para la sección ${sectionNumber}`);
  
  // Buscar si ya existe un contenedor de prompts y eliminarlo
  const existingContainer = document.getElementById('image-prompts-display');
  if (existingContainer) {
    console.log(`🔄 DEBUG showImagePrompts - Eliminando contenedor existente`);
    existingContainer.remove();
  }
  
  // Crear el contenedor principal
  const container = document.createElement('div');
  container.id = 'image-prompts-display';
  container.className = 'image-prompts-container';
  console.log(`📦 DEBUG showImagePrompts - Contenedor creado`);
  
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
    console.log(`🔍 DEBUG showImagePrompts - Procesando prompt ${index + 1}: ${prompt.substring(0, 50)}...`);
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
    console.log(`📝 DEBUG showImagePrompts - Instrucciones adicionales aplicadas: "${additionalInstructions}"`);
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
  console.log(`🔍 DEBUG showImagePrompts - Element output encontrado:`, !!output);
  
  if (output && output.nextSibling) {
    output.parentNode.insertBefore(container, output.nextSibling);
    console.log(`📍 DEBUG showImagePrompts - Insertado después del output (con nextSibling)`);
  } else if (output) {
    output.parentNode.appendChild(container);
    console.log(`📍 DEBUG showImagePrompts - Insertado después del output (appendChild)`);
  } else {
    document.body.appendChild(container);
    console.log(`📍 DEBUG showImagePrompts - Insertado en body (fallback)`);
  }
  
  // Animación de aparición
  container.style.opacity = '0';
  container.style.transform = 'translateY(20px)';
  
  setTimeout(() => {
    container.style.transition = 'all 0.5s ease';
    container.style.opacity = '1';
    container.style.transform = 'translateY(0)';
    console.log(`✨ DEBUG showImagePrompts - Animación aplicada`);
  }, 100);
  
  console.log(`✅ DEBUG showImagePrompts - Función completada exitosamente`);
}

// Event listener para controlar la casilla de audio según la generación automática
document.addEventListener('DOMContentLoaded', function() {
  console.log('🚀 DOM completamente cargado');
  
  // Limpiar cualquier contenedor de prompts visuales residual
  const existingPromptsContainer = document.getElementById('image-prompts-display');
  if (existingPromptsContainer) {
    existingPromptsContainer.remove();
    console.log('🗑️ Contenedor de prompts visuales residual eliminado');
  }
  
  // Verificar localStorage inmediatamente
  const savedStyles = localStorage.getItem('customScriptStyles');
  console.log('🔍 VERIFICACIÓN DIRECTA localStorage:', savedStyles);
  
  const autoGenerateAudioCheckbox = document.getElementById('autoGenerateAudio');
  const autoAudioContainer = document.querySelector('.auto-audio-container');
  
  // Verificar si los elementos de audio existen y habilitarlos ya que la generación automática está siempre activa
  if (autoGenerateAudioCheckbox && autoAudioContainer) {
    // Habilitar la casilla de audio ya que la generación automática está siempre activa
    autoGenerateAudioCheckbox.disabled = false;
    autoAudioContainer.style.opacity = '1';
    console.log('🔊 Casilla de audio habilitada (generación automática siempre activa)');
  } else {
    console.log('⚠️ Algunos elementos de audio no encontrados (diseño compacto)');
  }
  
  // Inicializar sistema de estilos personalizados
  console.log('🎨 A punto de inicializar estilos...');
  initCustomStyles();
  
  // Inicializar sistema de estilos de miniatura
  console.log('🖼️ A punto de inicializar estilos de miniatura...');
  initThumbnailStyles();
  
  // Configurar eventos de botones manualmente como backup
  setTimeout(() => {
    console.log('🔧 Configurando eventos de botones manualmente...');
    
    const createBtn = document.getElementById('createStyleBtn');
    const manageBtn = document.getElementById('manageStylesBtn');
    
    if (createBtn) {
      createBtn.addEventListener('click', function() {
        console.log('🎨 Botón crear estilo clickeado');
        openStyleModal();
      });
      console.log('✅ Event listener del botón crear configurado');
    } else {
      console.error('❌ Botón crear estilo no encontrado');
    }
    
    if (manageBtn) {
      manageBtn.addEventListener('click', function() {
        console.log('🔧 Botón gestionar estilos clickeado');
        openManageStylesModal();
      });
      console.log('✅ Event listener del botón gestionar configurado');
    } else {
      console.error('❌ Botón gestionar estilos no encontrado');
    }
    
    // Configurar eventos de botones de miniatura
    const createThumbnailBtn = document.getElementById('createThumbnailStyleFromSidebar');
    const manageThumbnailBtn = document.getElementById('manageThumbnailStylesFromSidebar');
    
    if (createThumbnailBtn) {
      createThumbnailBtn.addEventListener('click', function() {
        console.log('🖼️ Botón crear estilo de miniatura clickeado');
        openThumbnailStyleModal();
      });
      console.log('✅ Event listener del botón crear miniatura configurado');
    } else {
      console.error('❌ Botón crear estilo de miniatura no encontrado');
    }
    
    if (manageThumbnailBtn) {
      manageThumbnailBtn.addEventListener('click', function() {
        console.log('🔧 Botón gestionar estilos de miniatura clickeado desde backup manual');
        try {
          openManageThumbnailStylesModal();
        } catch (error) {
          console.error('❌ Error ejecutando openManageThumbnailStylesModal:', error);
        }
      });
      console.log('✅ Event listener del botón gestionar miniatura configurado (backup manual)');
      
      // También agregar onclick como backup adicional
      manageThumbnailBtn.onclick = function() {
        console.log('🔄 Onclick backup del botón gestionar activado');
        try {
          openManageThumbnailStylesModal();
        } catch (error) {
          console.error('❌ Error en onclick backup:', error);
        }
      };
    } else {
      console.error('❌ Botón gestionar estilos de miniatura no encontrado');
    }
    
    // Configurar eventos de botones de modal como backup
    setTimeout(() => {
      console.log('🔄 Configurando eventos de modal como backup...');
      const saveBtn = document.getElementById('saveThumbnailStyleBtn');
      if (saveBtn && !saveBtn.onclick) {
        saveBtn.onclick = function() {
          console.log('🔄 Backup directo del botón guardar activado');
          saveThumbnailStyle();
        };
        console.log('✅ Backup de botón guardar configurado');
      }
    }, 1000);
  }, 500);
  
  // Verificar el selector después de la inicialización
  setTimeout(() => {
    const styleSelect = document.getElementById('styleSelect');
    console.log('🔍 Opciones en el selector después de inicializar:', styleSelect?.innerHTML);
    console.log('🔍 Número de opciones:', styleSelect?.options?.length);
  }, 1000);
});

// Sistema de Estilos Personalizados
let customStyles = [];

// Cargar estilos personalizados del localStorage
function loadCustomStyles() {
  console.log('🔍 Iniciando carga de estilos personalizados...');
  const saved = localStorage.getItem('customScriptStyles');
  console.log('🔍 Datos en localStorage:', saved);
  
  if (saved) {
    try {
      customStyles = JSON.parse(saved);
      console.log(`📝 Cargados ${customStyles.length} estilos personalizados:`, customStyles);
    } catch (error) {
      console.error('❌ Error cargando estilos:', error);
      customStyles = [];
    }
  } else {
    console.log('📝 No hay estilos personalizados guardados');
    customStyles = [];
  }
}

// Guardar estilos en localStorage
function saveCustomStyles() {
  localStorage.setItem('customScriptStyles', JSON.stringify(customStyles));
  console.log(`💾 Guardados ${customStyles.length} estilos personalizados`);
}

// Inicializar sistema de estilos
function initCustomStyles() {
  console.log('🎨 Inicializando sistema de estilos personalizados...');
  loadCustomStyles();
  updateStyleSelector();
  
  // Configurar eventos con un retraso para asegurar que el DOM esté listo
  setTimeout(() => {
    setupStyleModalEvents();
    setupManageStylesEvents();
    setupEditStyleEvents();
    
    // Configurar específicamente los botones del sidebar
    setupSidebarStyleButtons();
    
    console.log('✅ Sistema de estilos inicializado correctamente');
  }, 100);
}

// Configurar botones del sidebar para estilos
function setupSidebarStyleButtons() {
  console.log('🔧 Configurando botones del sidebar para estilos...');
  
  const createFromSidebarBtn = document.getElementById('createStyleFromSidebar');
  if (createFromSidebarBtn) {
    // Remover event listeners previos
    const newBtn = createFromSidebarBtn.cloneNode(true);
    createFromSidebarBtn.parentNode.replaceChild(newBtn, createFromSidebarBtn);
    
    newBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('🎨 Botón crear estilo clickeado desde sidebar');
      openCreateStyleFromSidebar();
    });
    console.log('✅ Event listener del botón crear desde barra lateral configurado');
  } else {
    console.error('❌ No se encontró createStyleFromSidebar');
  }
  
  const manageFromSidebarBtn = document.getElementById('manageStylesFromSidebar');
  if (manageFromSidebarBtn) {
    // Remover event listeners previos
    const newBtn = manageFromSidebarBtn.cloneNode(true);
    manageFromSidebarBtn.parentNode.replaceChild(newBtn, manageFromSidebarBtn);
    
    newBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('🔧 Botón gestionar estilos clickeado desde sidebar');
      openManageStylesFromSidebar();
    });
    console.log('✅ Event listener del botón gestionar desde barra lateral configurado');
  } else {
    console.error('❌ No se encontró manageStylesFromSidebar');
  }
}

// Función para abrir modal de crear estilo
function openStyleModal() {
  console.log('🎨 Abriendo modal de crear estilo...');
  const styleModal = document.getElementById('styleModal');
  if (styleModal) {
    styleModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    console.log('✅ Modal de crear estilo abierto');
  } else {
    console.error('❌ Modal de crear estilo no encontrado');
  }
}

// Función para cerrar modal de crear estilo
function closeStyleModal() {
  console.log('🎨 Cerrando modal de crear estilo...');
  const styleModal = document.getElementById('styleModal');
  if (styleModal) {
    styleModal.style.display = 'none';
    document.body.style.overflow = 'auto';
    clearModalForm();
    console.log('✅ Modal de crear estilo cerrado');
  }
}

// Configurar eventos del modal
function setupStyleModalEvents() {
  console.log('🔧 Configurando eventos del modal de crear estilo...');
  
  const styleModal = document.getElementById('styleModal');
  const closeModalBtn = document.getElementById('closeStyleModal');
  const cancelBtn = document.getElementById('cancelStyleBtn');
  const saveBtn = document.getElementById('saveStyleBtn');
  
  console.log('🔍 Elementos encontrados:', {
    styleModal: !!styleModal,
    closeModalBtn: !!closeModalBtn,
    cancelBtn: !!cancelBtn,
    saveBtn: !!saveBtn
  });
  
  if (!styleModal || !closeModalBtn || !cancelBtn || !saveBtn) {
    console.error('❌ Algunos elementos del modal no fueron encontrados');
    return;
  }
  
  // Función para cerrar modal
  function closeModal() {
    console.log('🎨 Cerrando modal de crear estilo...');
    styleModal.style.display = 'none';
    document.body.style.overflow = 'auto';
    clearModalForm();
  }
  
  // Configurar event listeners
  closeModalBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('🔘 Botón cerrar clickeado');
    closeModal();
  });
  
  cancelBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('🔘 Botón cancelar clickeado');
    closeModal();
  });
  
  // Cerrar modal al hacer clic fuera
  styleModal.addEventListener('click', (e) => {
    if (e.target === styleModal) {
      console.log('🔘 Click fuera del modal');
      closeModal();
    }
  });
  
  // Guardar nuevo estilo
  saveBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('🔘 Botón guardar clickeado');
    saveNewStyle();
  });
  
  console.log('✅ Eventos del modal configurados correctamente');
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
    alert('❌ El nombre del estilo es requerido');
    return;
  }
  
  if (!instructions) {
    alert('❌ Las instrucciones para la IA son requeridas');
    return;
  }
  
  // Verificar que no exista un estilo con el mismo nombre
  if (customStyles.find(style => style.name.toLowerCase() === name.toLowerCase())) {
    alert('❌ Ya existe un estilo con ese nombre');
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
  alert(`✅ Estilo "${name}" creado exitosamente!`);
  
  console.log(`🎨 Nuevo estilo creado: ${name}`);
}

// Actualizar el selector de estilos
function updateStyleSelector() {
  console.log('🔄 Iniciando actualización del selector...');
  
  const styleSelect = document.getElementById('styleSelect');
  if (!styleSelect) {
    console.error('❌ No se encontró el elemento styleSelect');
    return;
  }
  
  // Guardar el valor actualmente seleccionado
  const currentValue = styleSelect.value;
  console.log('💾 Valor actual seleccionado:', currentValue);
  
  // Limpiar y recrear todas las opciones
  styleSelect.innerHTML = '';
  console.log('🧹 Selector limpiado');
  
  // Agregar opciones predeterminadas
  const professionalOption = document.createElement('option');
  professionalOption.value = 'professional';
  professionalOption.textContent = 'Profesional';
  styleSelect.appendChild(professionalOption);
  
  const comedyOption = document.createElement('option');
  comedyOption.value = 'comedy';
  comedyOption.textContent = 'Cómico';
  styleSelect.appendChild(comedyOption);
  
  console.log('✅ Opciones predeterminadas agregadas');
  
  // Verificar customStyles
  console.log('🎨 customStyles disponibles:', customStyles);
  console.log('📊 Número de estilos personalizados:', customStyles.length);
  
  // Agregar estilos personalizados
  customStyles.forEach((style, index) => {
    console.log(`🎨 Procesando estilo ${index + 1}:`, style);
    
    const option = document.createElement('option');
    option.value = style.id;
    option.textContent = `${style.name} (Personalizado)`;
    option.title = style.description || '';
    styleSelect.appendChild(option);
    
    console.log(`✅ Estilo agregado: ${style.name}`);
  });
  
  // Restaurar selección anterior si existe
  if (currentValue && styleSelect.querySelector(`option[value="${currentValue}"]`)) {
    styleSelect.value = currentValue;
    console.log(`🔄 Selección restaurada: ${currentValue}`);
  } else {
    styleSelect.value = 'professional'; // Default
    console.log('🔄 Selección por defecto: professional');
  }
  
  console.log(`🎯 Selector actualizado - Total opciones: ${styleSelect.options.length}`);
  console.log('🔍 HTML del selector:', styleSelect.innerHTML);
}

// Variables para gestión de estilos
let currentEditingStyle = null;

// Configurar eventos del modal de gestión de estilos
function setupManageStylesEvents() {
  console.log('🔧 Configurando eventos del modal de gestionar estilos...');
  
  const manageModal = document.getElementById('manageStylesModal');
  const closeManageBtn = document.getElementById('closeManageStylesModal');
  const closeManageBtnFooter = document.getElementById('closeManageStylesBtn');
  
  console.log('🔍 Elementos encontrados:', {
    manageModal: !!manageModal,
    closeManageBtn: !!closeManageBtn,
    closeManageBtnFooter: !!closeManageBtnFooter
  });
  
  if (!manageModal || !closeManageBtn || !closeManageBtnFooter) {
    console.error('❌ Algunos elementos del modal de gestionar no fueron encontrados');
    return;
  }
  
  // Función para cerrar modal
  function closeModal() {
    console.log('🔧 Cerrando modal de gestionar estilos...');
    manageModal.style.display = 'none';
    document.body.style.overflow = 'auto';
  }
  
  // Configurar event listeners
  closeManageBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('🔘 Botón cerrar (X) clickeado');
    closeModal();
  });
  
  closeManageBtnFooter.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('🔘 Botón cerrar footer clickeado');
    closeModal();
  });
  
  // Cerrar modal al hacer clic fuera
  manageModal.addEventListener('click', (e) => {
    if (e.target === manageModal) {
      console.log('🔘 Click fuera del modal de gestionar');
      closeModal();
    }
  });
  
  console.log('✅ Eventos del modal de gestionar configurados correctamente');
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
  
  // Cerrar modal al hacer clic fuera
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) {
      closeEditStyleModal();
    }
  });
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
    alert('❌ Estilo no encontrado');
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
    alert('❌ Error: No hay estilo seleccionado para editar');
    return;
  }
  
  const name = document.getElementById('editStyleName').value.trim();
  const description = document.getElementById('editStyleDescription').value.trim();
  const instructions = document.getElementById('editStyleInstructions').value.trim();
  
  // Validaciones
  if (!name) {
    alert('❌ El nombre del estilo es requerido');
    return;
  }
  
  if (!instructions) {
    alert('❌ Las instrucciones para la IA son requeridas');
    return;
  }
  
  // Verificar que no exista otro estilo con el mismo nombre
  const existingStyle = customStyles.find(style => 
    style.name.toLowerCase() === name.toLowerCase() && style.id !== currentEditingStyle.id
  );
  
  if (existingStyle) {
    alert('❌ Ya existe un estilo con ese nombre');
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
    alert(`✅ Estilo "${name}" actualizado exitosamente!`);
    
    console.log(`🎨 Estilo editado: ${name}`);
  }
}

// Eliminar estilo
function deleteStyle(styleId) {
  const style = customStyles.find(s => s.id === styleId);
  if (!style) {
    alert('❌ Estilo no encontrado');
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
  alert(`✅ Estilo "${style.name}" eliminado exitosamente!`);
  
  console.log(`🗑️ Estilo eliminado: ${style.name}`);
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
  
  console.log('✅ Estilo de prueba creado:', testStyle);
  return testStyle;
}

// Función de debug para mostrar estado actual
function debugStyles() {
  console.log('🔍 Estado actual de estilos:');
  console.log('📦 customStyles array:', customStyles);
  console.log('💾 localStorage:', localStorage.getItem('customScriptStyles'));
  
  const styleSelect = document.getElementById('styleSelect');
  console.log('🎯 Selector HTML:', styleSelect.innerHTML);
  console.log('📊 Número de opciones:', styleSelect.options.length);
  
  return {
    customStyles,
    localStorage: localStorage.getItem('customScriptStyles'),
    selectorHTML: styleSelect.innerHTML,
    optionsCount: styleSelect.options.length
  };
}

// Funciones para la barra lateral colapsable
function toggleSidebar() {
  console.log('🔄 toggleSidebar() ejecutada');
  
  const sidebar = document.getElementById('sidebar');
  const body = document.body;
  
  console.log('🔍 sidebar element:', sidebar);
  console.log('🔍 body element:', body);
  
  if (sidebar && body) {
    const wasExpanded = sidebar.classList.contains('expanded');
    
    sidebar.classList.toggle('expanded');
    body.classList.toggle('sidebar-expanded');
    
    const isExpanded = sidebar.classList.contains('expanded');
    console.log(`🎯 Barra lateral cambió de ${wasExpanded ? 'expandida' : 'colapsada'} a ${isExpanded ? 'expandida' : 'colapsada'}`);
    console.log('🔍 Clases del sidebar:', sidebar.className);
    console.log('🔍 Clases del body:', body.className);
  } else {
    console.error('❌ No se encontró el sidebar o el body');
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
    console.log('🎯 Barra lateral colapsada');
  }
}

// Funciones para abrir modales desde la barra lateral
function openCreateStyleFromSidebar() {
  openStyleModal(); // Esta función abre el modal de CREAR estilo
  collapseSidebar();
  console.log('🎨 Abriendo modal de crear estilo desde barra lateral');
}

function openManageStylesFromSidebar() {
  openManageStylesModal(); // Esta función abre el modal de GESTIONAR estilos
  collapseSidebar();
  console.log('🔧 Abriendo modal de gestionar estilos desde barra lateral');
}

// Event listeners para la barra lateral
document.addEventListener('DOMContentLoaded', function() {
  // Botón de menú para expandir/colapsar barra lateral
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.getElementById('sidebar');
  
  console.log('🔍 Debug sidebar - menuToggleBtn:', menuToggleBtn);
  console.log('🔍 Debug sidebar - sidebar:', sidebar);
  
  if (menuToggleBtn) {
    console.log('✅ Botón de menú encontrado - onclick configurado en HTML');
  } else {
    console.error('❌ No se encontró el botón menuToggleBtn');
  }
  
  if (!sidebar) {
    console.error('❌ No se encontró el elemento sidebar');
  }
  
  // Botones de la barra lateral
  const createFromSidebarBtn = document.getElementById('createStyleFromSidebar');
  if (createFromSidebarBtn) {
    createFromSidebarBtn.addEventListener('click', openCreateStyleFromSidebar);
    console.log('✅ Event listener del botón crear desde barra lateral configurado');
  }
  
  const manageFromSidebarBtn = document.getElementById('manageStylesFromSidebar');
  if (manageFromSidebarBtn) {
    manageFromSidebarBtn.addEventListener('click', openManageStylesFromSidebar);
    console.log('✅ Event listener del botón gestionar desde barra lateral configurado');
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
    console.log('🔧 Configuración adicional de eventos del modal...');
    
    const closeModalBtn = document.getElementById('closeStyleModal');
    const cancelBtn = document.getElementById('cancelStyleBtn');
    const saveBtn = document.getElementById('saveStyleBtn');
    const styleModal = document.getElementById('styleModal');
    
    if (closeModalBtn && !closeModalBtn.hasEventListener) {
      closeModalBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('🔘 [BACKUP] Botón cerrar clickeado');
        const modal = document.getElementById('styleModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
          clearModalForm();
        }
      });
      closeModalBtn.hasEventListener = true;
      console.log('✅ Event listener del botón cerrar configurado (backup)');
    }
    
    if (cancelBtn && !cancelBtn.hasEventListener) {
      cancelBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('🔘 [BACKUP] Botón cancelar clickeado');
        const modal = document.getElementById('styleModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
          clearModalForm();
        }
      });
      cancelBtn.hasEventListener = true;
      console.log('✅ Event listener del botón cancelar configurado (backup)');
    }
    
    if (saveBtn && !saveBtn.hasEventListener) {
      saveBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('🔘 [BACKUP] Botón guardar clickeado');
        saveNewStyle();
      });
      saveBtn.hasEventListener = true;
      console.log('✅ Event listener del botón guardar configurado (backup)');
    }
    
    // Configuración backup para modal de gestionar estilos
    const closeManageBtn = document.getElementById('closeManageStylesModal');
    const closeManageBtnFooter = document.getElementById('closeManageStylesBtn');
    const manageModal = document.getElementById('manageStylesModal');
    
    if (closeManageBtn && !closeManageBtn.hasEventListener) {
      closeManageBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('🔘 [BACKUP] Botón cerrar (X) gestionar clickeado');
        const modal = document.getElementById('manageStylesModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
        }
      });
      closeManageBtn.hasEventListener = true;
      console.log('✅ Event listener del botón cerrar (X) gestionar configurado (backup)');
    }
    
    if (closeManageBtnFooter && !closeManageBtnFooter.hasEventListener) {
      closeManageBtnFooter.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('🔘 [BACKUP] Botón cerrar footer gestionar clickeado');
        const modal = document.getElementById('manageStylesModal');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
        }
      });
      closeManageBtnFooter.hasEventListener = true;
      console.log('✅ Event listener del botón cerrar footer gestionar configurado (backup)');
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
  console.log('🔍 Iniciando inicialización del panel de prompts...');
  
  const promptsSidebar = document.getElementById('promptsSidebar');
  const toggleBtn = document.getElementById('promptsSidebarToggle');
  const headerBtn = document.getElementById('showPromptsPanel');
  
  console.log('promptsSidebar:', !!promptsSidebar);
  console.log('toggleBtn:', !!toggleBtn);
  console.log('headerBtn:', !!headerBtn);
  
  if (!promptsSidebar || !toggleBtn) {
    console.log('❌ Panel de prompts no encontrado en el DOM');
    return;
  }
  
  // Verificar si ya está inicializado
  if (toggleBtn.hasEventListener) {
    console.log('⚠️ Panel ya inicializado, saltando...');
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
    console.log('🔘 Botón toggle del panel clickeado');
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
      console.log('✅ Panel cerrado');
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
      console.log('✅ Panel abierto');
    }
  };
  
  toggleBtn.addEventListener('click', toggleHandler);
  toggleBtn.hasEventListener = true;
  
  // Event listener para el botón del header
  if (headerBtn && !headerBtn.hasEventListener) {
    const headerHandler = function() {
      console.log('🔘 Botón header clickeado');
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
        console.log('✅ Panel cerrado desde header');
      } else {
        // Abrir panel
        promptsSidebar.classList.add('active');
        document.body.classList.add('prompts-panel-active');
        toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
        toggleBtn.title = 'Ocultar panel de prompts';
        headerBtn.classList.add('active');
        headerBtn.innerHTML = '<i class="fas fa-eye-slash"></i><span>Ocultar</span>';
        console.log('✅ Panel abierto desde header');
      }
    };
    
    headerBtn.addEventListener('click', headerHandler);
    headerBtn.hasEventListener = true;
  }
  
  console.log('✅ Panel lateral de prompts inicializado correctamente');
}

// Función para limpiar el panel lateral de prompts
function clearPromptsSidebar() {
  console.log('🧹 Limpiando panel lateral de prompts...');
  
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
  
  console.log('✅ Panel lateral limpiado');
}

// Función para añadir prompts al panel lateral
function addPromptsToSidebar(prompts, sectionNumber) {
  console.log('📋📋📋 INICIO addPromptsToSidebar - ESTA FUNCIÓN SE ESTÁ EJECUTANDO 📋📋📋');
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    console.log('❌ No hay prompts válidos para añadir al panel lateral');
    return;
  }
  
  console.log(`📋 Añadiendo ${prompts.length} prompts de la sección ${sectionNumber} al panel lateral`);
  
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  const promptsSidebar = document.getElementById('promptsSidebar');
  
  if (!promptsList || !emptyState || !promptsSidebar) {
    console.log('❌ Elementos del panel lateral no encontrados');
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
    const cleanText = isHtmlPrompt ? prompt.replace(/<[^>]*>/g, '').replace(/^🔗\s*/, '').replace(/^Buscar:\s*"/, '').replace(/"$/, '') : prompt.trim();
    
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
  console.log('🚀🚀🚀 INICIO createGoogleImageLinks - ESTA FUNCIÓN SE ESTÁ EJECUTANDO 🚀🚀🚀');
  console.log('🔗 prompts:', prompts);
  console.log('🔗 sectionNumber:', sectionNumber);
  console.log('🔗 prompts.length:', prompts ? prompts.length : 'null');
  console.log('🔗 Array.isArray(prompts):', Array.isArray(prompts));
  
  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    console.log('❌ No hay prompts válidos para crear enlaces de Google Images');
    return;
  }
  
  console.log(`🔗 Creando ${prompts.length} enlaces de Google Images de la sección ${sectionNumber}`);
  
  const promptsList = document.getElementById('promptsList');
  const emptyState = document.getElementById('promptsEmptyState');
  const promptsSidebar = document.getElementById('promptsSidebar');
  
  if (!promptsList || !emptyState || !promptsSidebar) {
    console.log('❌ Elementos del panel lateral no encontrados');
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
  console.log('🔗 Iniciando bucle para crear enlaces...');
  prompts.forEach((prompt, index) => {
    console.log(`🔗 Procesando prompt ${index + 1}: "${prompt}"`);
    
    // Crear el término de búsqueda limpiando el prompt
    const searchTerm = prompt.trim()
      .replace(/[^\w\s]/g, '') // Remover caracteres especiales
      .replace(/\s+/g, '+'); // Reemplazar espacios con +
    
    const googleUrl = `https://www.google.com/search?q=${searchTerm}&tbm=isch`;
    
    console.log(`🔗 searchTerm: "${searchTerm}"`);
    console.log(`🔗 googleUrl: "${googleUrl}"`);
    
    // Almacenar en el array global (como Google link en lugar de prompt)
    allAccumulatedPrompts.push({
      text: googleUrl,
      section: sectionNumber,
      imageNumber: index + 1,
      isGoogleLink: true,
      originalPrompt: prompt.trim()
    });
    
    const linkItem = createGoogleLinkItem(prompt.trim(), googleUrl, sectionNumber, index + 1);
    console.log(`🔗 linkItem creado:`, !!linkItem);
    promptsList.appendChild(linkItem);
    console.log(`🔗 linkItem añadido al promptsList`);
    
    // Añadir animación de entrada
    setTimeout(() => {
      linkItem.classList.add('new');
    }, index * 100);
  });
  
  console.log('🔗 Bucle completado');
  
  // Hacer scroll al último enlace añadido
  setTimeout(() => {
    const lastLink = promptsList.lastElementChild;
    if (lastLink) {
      lastLink.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 300);
  
  console.log('🔗 FIN createGoogleImageLinks');
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
  const textToCopy = isHtml ? promptText.replace(/<[^>]*>/g, '').replace(/^🔗\s*/, '').replace(/^Buscar:\s*"/, '').replace(/"$/, '') : promptText;
  
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
      
      console.log('📋 Prompt copiado al portapapeles');
    } catch (err) {
      console.error('❌ Error al copiar prompt:', err);
      
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
    console.log('🔗 Abriendo búsqueda de Google Images:', googleUrl);
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
      
      console.log('📋 Enlace de Google copiado al portapapeles');
    } catch (err) {
      console.error('❌ Error al copiar enlace:', err);
      
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
    console.log('🗑️ Contenedor de prompts visuales eliminado');
  }
  
  // Limpiar el array global
  allAccumulatedPrompts = [];
  
  console.log('🧹 Panel de prompts limpiado');
}

// Función para obtener todos los prompts acumulados
function getAllAccumulatedPrompts() {
  return allAccumulatedPrompts;
}

// Función para exportar todos los prompts como texto
function exportAllPrompts() {
  if (allAccumulatedPrompts.length === 0) {
    console.log('❌ No hay prompts para exportar');
    return;
  }
  
  let exportText = 'PROMPTS DE IMÁGENES GENERADOS\n';
  exportText += '================================\n\n';
  
  let currentSection = 0;
  
  allAccumulatedPrompts.forEach((prompt, index) => {
    if (prompt.section !== currentSection) {
      currentSection = prompt.section;
      exportText += `SECCIÓN ${currentSection}\n`;
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
  
  console.log('📄 Prompts exportados como archivo de texto');
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
  console.log('🌟 DOM Content Loaded - Iniciando inicialización del panel de prompts');
  // Esperar un poco para asegurar que todos los elementos estén cargados
  setTimeout(() => {
    initializePromptsPanel();
  }, 100);
});

// Inicializar también cuando la ventana esté completamente cargada (backup)
window.addEventListener('load', function() {
  console.log('🌟 Window Loaded - Backup de inicialización del panel de prompts');
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
  console.log('🌟 Timeout backup - Verificando inicialización del panel');
  const toggleBtn = document.getElementById('promptsSidebarToggle');
  if (toggleBtn && !toggleBtn.hasEventListener) {
    console.log('🔄 Ejecutando inicialización de backup');
    initializePromptsPanel();
  }
}, 2000);

// Función de test para verificar el funcionamiento del panel
window.testPromptsPanel = function() {
  console.log('🧪 TESTING PROMPTS PANEL');
  
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
  console.log('🔧 Inicializando navegación de secciones...');
  
  const prevSectionBtn = document.getElementById('prevSectionBtn');
  const nextSectionBtn = document.getElementById('nextSectionBtn');
  
  console.log('Botón anterior encontrado:', !!prevSectionBtn);
  console.log('Botón siguiente encontrado:', !!nextSectionBtn);
  
  if (!prevSectionBtn || !nextSectionBtn) {
    console.log('❌ Botones de navegación de secciones no encontrados');
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
    console.log(`🔄 CLICK ANTERIOR - Actual: ${currentSectionNumber}, Total secciones: ${allSections.length}`);
    console.log('Secciones disponibles:', allSections.map((s, i) => s ? `${i+1}: ✅` : `${i+1}: ❌`).join(', '));
    
    if (currentSectionNumber > 1) {
      console.log(`✅ Navegando a sección ${currentSectionNumber - 1}`);
      showStoredSection(currentSectionNumber - 1);
    } else {
      console.log('❌ Ya estás en la primera sección');
    }
  });
  
  // Función para ir a la sección siguiente
  newNextBtn.addEventListener('click', function() {
    console.log(`🔄 CLICK SIGUIENTE - Actual: ${currentSectionNumber}, Total secciones: ${allSections.length}`);
    console.log('Secciones disponibles:', allSections.map((s, i) => s ? `${i+1}: ✅` : `${i+1}: ❌`).join(', '));
    
    if (currentSectionNumber < allSections.length) {
      console.log(`✅ Navegando a sección ${currentSectionNumber + 1}`);
      showStoredSection(currentSectionNumber + 1);
    } else {
      console.log('❌ Ya estás en la última sección');
    }
  });
  
  console.log('✅ Event listeners agregados correctamente');
  console.log('✅ Navegación de secciones inicializada');
}

// Función para mostrar una sección almacenada
function showStoredSection(sectionNum) {
  console.log(`🔍 Intentando mostrar sección ${sectionNum}`);
  console.log(`Total secciones almacenadas: ${allSections.length}`);
  console.log(`Contenido de sección ${sectionNum}:`, allSections[sectionNum - 1] ? 'Disponible' : 'No disponible');
  
  if (!allSections[sectionNum - 1]) {
    console.log(`❌ Sección ${sectionNum} no disponible`);
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
    console.log('❌ Elementos DOM no encontrados');
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
      console.log(`🎠 Restaurando carrusel para sección ${sectionNum} con ${sectionImages.length} imágenes (modo: ${sectionImageMode})`);
      
      // Restaurar keywords globales si es Bing
      if (sectionImageMode === 'bing' && sectionImageKeywords) {
        currentImageKeywords = sectionImageKeywords;
        console.log(`🎯 Keywords restauradas para sección ${sectionNum}:`, currentImageKeywords);
      }
      
      // Crear carrusel con las imágenes de esta sección
      if (sectionImageMode === 'bing') {
        createCarousel(sectionImages, sectionNum, []);
      } else if (sectionImageMode === 'ai') {
        createCarousel(sectionImages, sectionNum, sectionImagePrompts || []);
      }
    } else if (sectionImagePrompts && sectionImagePrompts.length > 0 && sectionImageMode === 'prompts') {
      // Solo prompts (sin carrusel)
      console.log(`📋 Restaurando prompts para sección ${sectionNum}`);
      document.getElementById("carousel-container").style.display = "none";
      addPromptsToSidebar(sectionImagePrompts, sectionNum);
    } else {
      // Sin imágenes en memoria - intentar cargar desde el servidor si hay un proyecto cargado
      if (window.currentProject) {
        console.log(`🔄 Intentando cargar imágenes desde servidor para sección ${sectionNum}...`);
        loadSectionImages(sectionNum);
      } else {
        console.log(`❌ Sin imágenes para sección ${sectionNum} - ocultando carrusel`);
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
  
  console.log(`📄 Mostrando sección ${sectionNum} almacenada`);
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
  
  console.log(`🔄 Botones actualizados - Sección ${currentSectionNumber}/${allSections.length}`);
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
        console.log('🔊 Audio Google seleccionado, Applio desactivado');
      }
    });
    
    // Cuando se selecciona Applio Audio, deseleccionar Google
    autoGenerateApplioAudio.addEventListener('change', function() {
      if (this.checked) {
        autoGenerateAudio.checked = false;
        console.log('🎤 Audio Applio seleccionado, Google desactivado');
      }
    });
    
    console.log('✅ Event listeners de audio configurados - selección exclusiva activada');
  }
});

// ========================================
// FUNCIONALIDAD DE EXTRACCIÓN DE TEXTO
// ========================================

// Función para mostrar notificaciones
function showNotification(message, type = 'info') {
  console.log(`📢 Notificación [${type.toUpperCase()}]:`, message);
  
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
    console.log('⚠️ Extractor ya inicializado, omitiendo...');
    return;
  }
  
  console.log('🎤 Inicializando extractor de texto...');
  
  // Elementos del DOM
  const extractTextBtn = document.getElementById('extractTextBtn');
  const extractTextModal = document.getElementById('extractTextModal');
  const closeExtractModal = document.getElementById('closeExtractModal');
  
  console.log('🔍 Verificando elementos:', {
    extractTextBtn: !!extractTextBtn,
    extractTextModal: !!extractTextModal,
    closeExtractModal: !!closeExtractModal
  });
  
  if (!extractTextBtn) {
    console.error('❌ Botón extractTextBtn no encontrado');
    return;
  }
  
  if (!extractTextModal) {
    console.error('❌ Modal extractTextModal no encontrado');
    return;
  }
  
  console.log('✅ Elementos principales encontrados, configurando eventos...');
  
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
  
  console.log('🔍 Verificación detallada de elementos:', elements);
  
  // Verificar cada elemento
  Object.keys(elements).forEach(key => {
    if (!elements[key]) {
      console.error(`❌ Elemento faltante: ${key}`);
    } else {
      console.log(`✅ Elemento encontrado: ${key}`);
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
    console.log('🔧 Click en botón extraer texto detectado');
    extractTextModal.style.display = 'flex';
    console.log('📂 Modal de extracción abierto');
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
    console.log('🎯 Configurando drag & drop en dropzone...');
    showNotification('🎯 Drag & Drop configurado correctamente', 'success');
    
    extractDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      extractDropzone.classList.add('dragover');
      console.log('📥 Archivo siendo arrastrado sobre la zona...');
      showNotification('📥 Archivo detectado - suelta aquí', 'info');
    });
    
    extractDropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      extractDropzone.classList.remove('dragover');
      console.log('📤 Archivo salió de la zona de arrastre...');
    });
    
    extractDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      extractDropzone.classList.remove('dragover');
      console.log('🎯 Archivo soltado en la zona!');
      showNotification('🎯 Archivo recibido - procesando...', 'success');
      
      const files = e.dataTransfer.files;
      console.log('📁 Archivos detectados:', files.length);
      
      if (files.length > 0) {
        console.log('📄 Procesando archivo:', files[0].name, files[0].type);
        handleFileSelection(files[0]);
      } else {
        console.warn('⚠️ No se detectaron archivos en el drop');
        showNotification('⚠️ No se detectaron archivos', 'warning');
      }
    });
    
    // Click para seleccionar archivo
    extractDropzone.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('🖱️ Click en dropzone detectado');
      showNotification('🖱️ Abriendo selector de archivos...', 'info');
      if (extractFileInput) {
        extractFileInput.click();
        console.log('📂 Abriendo selector de archivos...');
      } else {
        console.error('❌ Input de archivo no encontrado');
        showNotification('❌ Error: Input de archivo no encontrado', 'error');
      }
    });
  } else {
    console.error('❌ Dropzone no encontrado');
    showNotification('❌ Error: Zona de arrastre no encontrada', 'error');
  }
  
  if (extractFileInput) {
    console.log('📁 Configurando input de archivo...');
    extractFileInput.addEventListener('change', (e) => {
      console.log('📄 Archivo seleccionado via input:', e.target.files.length);
      showNotification('📄 Archivo seleccionado - procesando...', 'info');
      if (e.target.files.length > 0) {
        console.log('📋 Procesando archivo seleccionado:', e.target.files[0].name);
        handleFileSelection(e.target.files[0]);
      }
    });
  } else {
    console.error('❌ Input de archivo no encontrado');
    showNotification('❌ Error: Input de archivo no encontrado', 'error');
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
        showNotification('✅ Texto copiado al portapapeles');
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
        showNotification('✅ Texto insertado como tema principal');
        promptInput.focus();
      }
    });
  }
  
  // === NUEVOS EVENT LISTENERS PARA CONFIGURACIÓN ===
  
  // Cambio de método de transcripción
  const transcriptionMethod = elements.transcriptionMethod;
  const localConfig = elements.localConfig;
  
  if (transcriptionMethod) {
    transcriptionMethod.addEventListener('change', (e) => {
      const method = e.target.value;
      console.log(`🔧 Método de transcripción cambiado a: ${method}`);
      
      if (method === 'local') {
        localConfig.style.display = 'block';
        checkLocalModelStatus();
        showNotification('🚀 Modo local activado - usando GPU', 'info');
      } else {
        localConfig.style.display = 'none';
        showNotification('🌐 Modo API activado - usando OpenAI', 'info');
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
  
  console.log('✅ Extractor de texto inicializado correctamente');
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
        ✅ GPU: ${info.gpu_name} | 
        Modelo ${info.is_loaded ? 'cargado' : 'disponible'}: ${info.model_size || 'ninguno'}
      `;
      localModelStatus.style.background = 'rgba(16, 185, 129, 0.15)';
      localModelStatus.style.color = '#00ff7f';
    } else {
      localModelStatus.innerHTML = '<i class="fas fa-desktop"></i> ⚠️ CPU disponible (sin GPU)';
      localModelStatus.style.background = 'rgba(245, 158, 11, 0.15)';
      localModelStatus.style.color = '#fbbf24';
    }
    
  } catch (error) {
    console.error('Error verificando estado local:', error);
    localModelStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ❌ Error verificando modelo local';
    localModelStatus.style.background = 'rgba(239, 68, 68, 0.15)';
    localModelStatus.style.color = '#fca5a5';
  }
}

async function handleFileSelection(file) {
  console.log('📁 === INICIANDO PROCESAMIENTO DE ARCHIVO ===');
  console.log('📄 Archivo seleccionado:', file.name);
  console.log('📊 Tamaño:', (file.size / 1024 / 1024).toFixed(2), 'MB');
  console.log('🏷️ Tipo MIME:', file.type);
  
  // Verificar tamaño del archivo
  const fileSizeMB = file.size / 1024 / 1024;
  if (fileSizeMB > 4000) { // 4GB
    showNotification('⚠️ Archivo muy grande (>4GB). Esto puede tomar mucho tiempo.', 'warning');
  } else if (fileSizeMB > 1000) { // 1GB
    showNotification('📊 Archivo grande detectado. La subida puede tardar unos minutos...', 'info');
  }
  
  // Validar tipo de archivo
  const validTypes = ['audio/mp3', 'audio/wav', 'audio/mpeg', 'audio/m4a', 'video/mp4'];
  const validExtensions = ['.mp3', '.wav', '.m4a', '.mp4'];
  
  const isValidType = validTypes.includes(file.type) || 
                     validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
  
  console.log('✅ Validación de tipo:', {
    mimeTypeValid: validTypes.includes(file.type),
    extensionValid: validExtensions.some(ext => file.name.toLowerCase().endsWith(ext)),
    overallValid: isValidType
  });
  
  if (!isValidType) {
    console.error('❌ Formato de archivo no soportado');
    showNotification('❌ Formato de archivo no soportado. Use MP3, WAV, M4A o MP4', 'error');
    return;
  }
  
  selectedFile = file;
  console.log('💾 Archivo almacenado en selectedFile');
  
  // Mostrar nombre del archivo
  const extractFileName = document.getElementById('extractFileName');
  if (extractFileName) {
    extractFileName.textContent = `📁 ${file.name}`;
    extractFileName.style.display = 'block';
    console.log('📝 Nombre de archivo mostrado');
    showNotification(`✅ Archivo cargado: ${file.name}`, 'success');
  } else {
    console.error('❌ Elemento extractFileName no encontrado');
    showNotification('❌ Error: No se pudo mostrar el nombre del archivo', 'error');
  }
  
  // Si es MP4, obtener pistas de audio
  if (file.name.toLowerCase().endsWith('.mp4')) {
    console.log('🎬 Archivo MP4 detectado, cargando pistas de audio...');
    try {
      await loadAudioTracks(file);
    } catch (error) {
      console.error('❌ Error cargando pistas de audio:', error);
      showNotification('⚠️ Error cargando pistas, usando configuración por defecto', 'warning');
      
      // Si falla cargar las pistas, habilitar transcripción directamente
      const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
      if (extractTranscribeBtn) {
        extractTranscribeBtn.disabled = false;
        console.log('✅ Botón habilitado como fallback');
        showNotification('✅ Listo para transcribir', 'success');
      }
    }
  } else {
    console.log('🎵 Archivo de audio detectado, preparando para transcripción...');
    // Para archivos de audio, subir archivo y preparar para transcripción
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      console.log('📤 Subiendo archivo de audio...');
      showNotification('📤 Subiendo archivo...', 'info');
      
      const uploadResponse = await fetch('/upload-audio', {
        method: 'POST',
        body: formData
      });
      
      if (uploadResponse.ok) {
        const uploadData = await uploadResponse.json();
        selectedFile.serverPath = uploadData.filePath;
        console.log('✅ Archivo subido correctamente:', uploadData.filePath);
        showNotification('✅ Archivo subido correctamente', 'success');
      } else {
        const errorData = await uploadResponse.json();
        console.error('❌ Error subiendo archivo:', errorData);
        showNotification(`❌ Error subiendo archivo: ${errorData.error}`, 'error');
        return; // Salir si hay error
      }
    } catch (error) {
      console.error('⚠️ Error pre-subiendo archivo de audio:', error);
      showNotification(`❌ Error de conexión: ${error.message}`, 'error');
      return; // Salir si hay error
    }
    
    // Ocultar selector de pistas
    const extractAudioTrackContainer = document.getElementById('extractAudioTrackContainer');
    const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
    
    console.log('🎛️ Configurando interfaz para archivo de audio...');
    console.log('🔍 Elementos encontrados:', {
      extractAudioTrackContainer: !!extractAudioTrackContainer,
      extractTranscribeBtn: !!extractTranscribeBtn
    });
    
    if (extractAudioTrackContainer) {
      extractAudioTrackContainer.style.display = 'none';
      console.log('✅ Selector de pistas ocultado');
    } else {
      console.error('❌ extractAudioTrackContainer no encontrado');
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
      console.log('✅ Botón de transcripción habilitado');
      showNotification('✅ Listo para transcribir - haz click en "Transcribir Audio"', 'success');
    } else {
      console.error('❌ extractTranscribeBtn no encontrado');
      showNotification('❌ Error: Botón de transcripción no encontrado', 'error');
    }
  }
  
  console.log('📁 === PROCESAMIENTO DE ARCHIVO COMPLETADO ===');
  
  // Forzar actualización visual
  setTimeout(() => {
    const extractFileName = document.getElementById('extractFileName');
    const extractTranscribeBtn = document.getElementById('extractTranscribeBtn');
    
    if (extractFileName && extractFileName.style.display === 'none') {
      console.log('🔄 Forzando visualización del nombre del archivo...');
      extractFileName.style.display = 'block';
      extractFileName.style.visibility = 'visible';
    }
    
    if (extractTranscribeBtn && extractTranscribeBtn.disabled) {
      console.log('🔄 Forzando habilitación del botón...');
      extractTranscribeBtn.disabled = false;
    }
  }, 100);
}

async function loadAudioTracks(file) {
  console.log('🎵 Cargando pistas de audio del MP4...');
  
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
    console.error('❌ Error cargando pistas:', error);
    showNotification('⚠️ No se pudieron cargar las pistas de audio. Se usará la pista por defecto.', 'warning');
    document.getElementById('extractAudioTrackContainer').style.display = 'none';
    document.getElementById('extractTranscribeBtn').disabled = false;
  }
}

async function startTranscription() {
  if (!selectedFile) {
    showNotification('❌ No hay archivo seleccionado', 'error');
    return;
  }
  
  console.log('🎤 Iniciando transcripción...');
  
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
  
  console.log(`🔧 Método: ${method} | Modelo: ${modelSize} | Idioma: ${language || 'auto'}`);
  
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
    
    console.log(`📡 Enviando a: ${endpoint}`, bodyData);
    
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
      extractProgressText.textContent = `✅ Transcripción completada (${data.stats.processing_speed.toFixed(1)}x tiempo real)`;
      
      // Mostrar información adicional en consola
      console.log(`📊 Estadísticas de transcripción local:`, {
        modelo: data.model_info,
        estadísticas: data.stats,
        idioma: data.language,
        duración: data.duration
      });
      
      showNotification(`✅ Transcripción local completada - ${data.stats.processing_speed.toFixed(1)}x velocidad`, 'success');
    } else {
      extractProgressText.textContent = '✅ Transcripción completada';
      showNotification('✅ Transcripción completada exitosamente');
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
    
    console.log(`✅ Transcripción completada (${method})`);
    
  } catch (error) {
    console.error('❌ Error en transcripción:', error);
    extractProgressText.textContent = `❌ Error en la transcripción (${method})`;
    extractProgressText.style.color = '#fca5a5';
    extractProgressText.style.fontWeight = '600';
    extractProgressText.style.background = 'rgba(239, 68, 68, 0.15)';
    extractProgressText.style.padding = '0.5rem';
    extractProgressText.style.borderRadius = '6px';
    extractProgressText.style.border = '1px solid rgba(239, 68, 68, 0.4)';
    showNotification(`❌ Error: ${error.message}`, 'error');
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
  
  console.log('🔄 Formulario de extracción reiniciado');
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
  
  showNotification('✅ Archivo descargado exitosamente');
}

// Función para generar metadata de YouTube
async function generateYouTubeMetadata() {
  try {
    console.log("🎬 Iniciando generación de metadata de YouTube...");
    
    const topic = promptInput.value.trim();
    const folderName = document.getElementById("folderName")?.value?.trim() || '';
    
    if (!topic || allSections.length === 0) {
      console.error("❌ No hay tema o secciones para generar metadata");
      return;
    }

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
        allSections: allSections,
        folderName: folderName,
        thumbnailStyle: getThumbnailStyleData()
      })
    });

    const data = await response.json();

    // Remover indicador de carga
    loadingIndicator.remove();

    if (data.success) {
      console.log("✅ Metadata de YouTube generada exitosamente");
      showYouTubeMetadataResults(data.metadata, topic);
    } else {
      console.error("❌ Error generando metadata:", data.error);
      showError("Error generando metadata de YouTube: " + data.error);
    }

  } catch (error) {
    console.error("❌ Error en generateYouTubeMetadata:", error);
    showError("Error generando metadata de YouTube: " + error.message);
    
    // Remover indicador de carga si existe
    const loadingIndicator = output.querySelector('.youtube-metadata-loading');
    if (loadingIndicator) {
      loadingIndicator.remove();
    }
  }
}

// Función para mostrar los resultados de metadata de YouTube
function showYouTubeMetadataResults(metadata, topic) {
  console.log("📺 Mostrando resultados de metadata de YouTube");

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
            <h3><i class="fas fa-fire"></i> Títulos Clickbait</h3>
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
          <h3><i class="fas fa-file-text"></i> Descripción SEO</h3>
          <i class="fas fa-chevron-down toggle-icon"></i>
        </div>
        <div class="section-content">
          <div class="description-container">
            <textarea class="description-text" readonly>${sections.description}</textarea>
            <button class="copy-btn-large" onclick="copyToClipboard(\`${sections.description.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">
              <i class="fas fa-copy"></i> Copiar Descripción
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
  
  // Ajustar altura del textarea de descripción al contenido
  const descriptionTextarea = metadataContainer.querySelector('.description-text');
  if (descriptionTextarea) {
    // Función para ajustar altura automáticamente
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
  
  // 🎬 MOSTRAR BOTÓN DE GENERACIÓN DE VIDEO DESPUÉS DE METADATOS
  // Solo mostrar si no se ha habilitado la generación automática
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
  
  for (let line of lines) {
    line = line.trim();
    
    if (line.includes('TÍTULOS CLICKBAIT') || line.includes('TITULOS CLICKBAIT')) {
      currentSection = 'titles';
      continue;
    } else if (line.includes('DESCRIPCIÓN')) {
      currentSection = 'description';
      continue;
    } else if (line.includes('ETIQUETAS')) {
      currentSection = 'tags';
      continue;
    } else if (line.includes('PROMPTS PARA MINIATURAS') || line.includes('MINIATURA')) {
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
  console.log('🖼️ Inicializando sistema de estilos de miniatura...');
  
  try {
    loadThumbnailStyles();
    updateThumbnailStyleSelector();
    
    setTimeout(() => {
      setupThumbnailStyleModalEvents();
      setupManageThumbnailStylesEvents(); // Reactivado y arreglado
      setupEditThumbnailStyleEvents();
      console.log('✅ Sistema de estilos de miniatura inicializado correctamente');
    }, 100);
  } catch (error) {
    console.error('❌ Error inicializando estilos de miniatura:', error);
  }
}

// Función para cargar estilos de miniatura desde localStorage
function loadThumbnailStyles() {
  try {
    const savedStyles = localStorage.getItem('customThumbnailStyles');
    if (savedStyles) {
      customThumbnailStyles = JSON.parse(savedStyles);
      console.log('🖼️ Estilos de miniatura cargados:', customThumbnailStyles);
    } else {
      customThumbnailStyles = [];
      console.log('🖼️ No hay estilos de miniatura guardados');
    }
  } catch (error) {
    console.error('❌ Error cargando estilos de miniatura:', error);
    customThumbnailStyles = [];
  }
}

// Función para guardar estilos de miniatura en localStorage
function saveThumbnailStyles() {
  try {
    localStorage.setItem('customThumbnailStyles', JSON.stringify(customThumbnailStyles));
    console.log('💾 Estilos de miniatura guardados exitosamente');
  } catch (error) {
    console.error('❌ Error guardando estilos de miniatura:', error);
  }
}

// Función para actualizar el selector de estilos de miniatura
function updateThumbnailStyleSelector() {
  const thumbnailStyleSelect = document.getElementById('thumbnailStyleSelect');
  if (!thumbnailStyleSelect) {
    console.error('❌ Selector de estilos de miniatura no encontrado');
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

  console.log('🖼️ Selector de estilos de miniatura actualizado');
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
  console.log('🔧 Configurando eventos del modal de crear estilo de miniatura...');
  
  try {
    const thumbnailStyleModal = document.getElementById('thumbnailStyleModal');
    const closeModalBtn = document.getElementById('closeThumbnailStyleModal');
    const cancelBtn = document.getElementById('cancelThumbnailStyleBtn');
    const saveBtn = document.getElementById('saveThumbnailStyleBtn');
    
    // Botones de la sidebar
    const createFromSidebarBtn = document.getElementById('createThumbnailStyleFromSidebar');
    
    console.log('🔍 Elementos encontrados:', {
      thumbnailStyleModal: !!thumbnailStyleModal,
      closeModalBtn: !!closeModalBtn,
      cancelBtn: !!cancelBtn,
      saveBtn: !!saveBtn,
      createFromSidebarBtn: !!createFromSidebarBtn
    });
    
    if (!thumbnailStyleModal || !closeModalBtn || !cancelBtn || !saveBtn) {
      console.error('❌ Algunos elementos del modal de miniatura no fueron encontrados');
      return;
    }
    
    // Función para cerrar modal
    function closeModal() {
      console.log('🔒 Cerrando modal de crear miniatura...');
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
      console.log('✅ Event listener del botón guardar configurado');
    } else {
      console.error('❌ Botón guardar no encontrado');
    }
    
    // Evento para abrir desde sidebar
    if (createFromSidebarBtn) {
      createFromSidebarBtn.addEventListener('click', () => {
        console.log('🖼️ Abriendo modal desde sidebar...');
        openThumbnailStyleModal();
      });
      console.log('✅ Event listener configurado para botón crear desde sidebar');
    } else {
      console.error('❌ Botón crear desde sidebar no encontrado');
    }
    
    // Cerrar al hacer clic fuera del modal
    thumbnailStyleModal.addEventListener('click', (e) => {
      if (e.target === thumbnailStyleModal) {
        closeModal();
      }
    });
    
    console.log('✅ Eventos del modal de miniatura configurados correctamente');
  } catch (error) {
    console.error('❌ Error configurando eventos del modal de miniatura:', error);
  }
}

// Función para abrir modal de crear estilo de miniatura
function openThumbnailStyleModal() {
  console.log('🖼️ Abriendo modal de crear estilo de miniatura...');
  
  try {
    const thumbnailStyleModal = document.getElementById('thumbnailStyleModal');
    if (thumbnailStyleModal) {
      // Solo limpiar si está cerrado para evitar interferir mientras se escribe
      if (thumbnailStyleModal.style.display !== 'flex') {
        clearThumbnailModalForm();
      }
      
      thumbnailStyleModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      console.log('✅ Modal de crear estilo de miniatura abierto');
      
      // Enfocar el primer campo
      setTimeout(() => {
        const nameField = document.getElementById('thumbnailStyleName');
        if (nameField) {
          nameField.focus();
        }
      }, 100);
    } else {
      console.error('❌ Modal de crear estilo de miniatura no encontrado');
    }
  } catch (error) {
    console.error('❌ Error abriendo modal de crear miniatura:', error);
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
  console.log('🖼️ Intentando guardar estilo de miniatura...');
  
  try {
    const name = document.getElementById('thumbnailStyleName').value.trim();
    const description = document.getElementById('thumbnailStyleDescription').value.trim();
    const primaryColor = document.getElementById('thumbnailPrimaryColor').value.trim();
    const secondaryColor = document.getElementById('thumbnailSecondaryColor').value.trim();
    const instructions = document.getElementById('thumbnailInstructions').value.trim();
    
    console.log('📝 Valores del formulario:', {
      name, description, primaryColor, secondaryColor, instructions
    });
    
    if (!name || !description || !primaryColor || !secondaryColor || !instructions) {
      console.warn('⚠️ Campos incompletos');
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
    
    console.log('💾 Guardando nuevo estilo:', newStyle);
    
    customThumbnailStyles.push(newStyle);
    saveThumbnailStyles();
    updateThumbnailStyleSelector();
    
    console.log('✅ Estilo agregado al array, cerrando modal...');
    
    // Cerrar modal
    const modal = document.getElementById('thumbnailStyleModal');
    if (modal) {
      modal.style.display = 'none';
      document.body.style.overflow = 'auto';
      clearThumbnailModalForm();
      console.log('✅ Modal cerrado');
    } else {
      console.error('❌ Modal no encontrado');
    }
    
    console.log('✅ Estilo de miniatura guardado:', newStyle);
    
    // Mostrar mensaje de éxito
    try {
      showNotification('✅ Estilo de miniatura creado exitosamente', 'success');
      console.log('✅ Notificación mostrada');
    } catch (notifError) {
      console.error('❌ Error mostrando notificación:', notifError);
    }
    
  } catch (error) {
    console.error('❌ Error en saveThumbnailStyle:', error);
    alert('Error guardando el estilo: ' + error.message);
  }
}

// Función para configurar eventos del modal de gestionar estilos
function setupManageThumbnailStylesEvents() {
  console.log('🔧 Configurando eventos del modal de gestionar estilos de miniatura...');
  
  try {
    const manageThumbnailStylesModal = document.getElementById('manageThumbnailStylesModal');
    const closeManageBtn = document.getElementById('closeManageThumbnailStylesModal');
    const closeManageFooterBtn = document.getElementById('closeManageThumbnailStylesBtn');
    
    console.log('🔍 Elementos de gestión encontrados:', {
      manageThumbnailStylesModal: !!manageThumbnailStylesModal,
      closeManageBtn: !!closeManageBtn,
      closeManageFooterBtn: !!closeManageFooterBtn
    });
    
    // Función para cerrar el modal
    function closeManageModal() {
      console.log('� Cerrando modal de gestionar miniaturas...');
      if (manageThumbnailStylesModal) {
        manageThumbnailStylesModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        console.log('✅ Modal de gestión cerrado');
      }
    }
    
    // NO configurar el botón de abrir aquí (se hace manualmente)
    // Solo configurar los botones de cerrar
    
    if (closeManageBtn) {
      closeManageBtn.addEventListener('click', closeManageModal);
      console.log('✅ Botón X de cerrar configurado');
    } else {
      console.error('❌ Botón X de cerrar no encontrado');
    }
    
    if (closeManageFooterBtn) {
      closeManageFooterBtn.addEventListener('click', closeManageModal);
      console.log('✅ Botón Cerrar del footer configurado');
    } else {
      console.error('❌ Botón Cerrar del footer no encontrado');
    }
    
    if (manageThumbnailStylesModal) {
      manageThumbnailStylesModal.addEventListener('click', (e) => {
        if (e.target === manageThumbnailStylesModal) {
          closeManageModal();
        }
      });
      console.log('✅ Evento de clic fuera del modal configurado');
    }
    
    console.log('✅ Eventos de gestión de miniatura configurados correctamente');
  } catch (error) {
    console.error('❌ Error configurando eventos de gestión de miniatura:', error);
  }
}

// Función para abrir modal de gestionar estilos de miniatura
function openManageThumbnailStylesModal() {
  console.log('🔧 Abriendo modal de gestionar estilos de miniatura...');
  
  try {
    const manageThumbnailStylesModal = document.getElementById('manageThumbnailStylesModal');
    if (manageThumbnailStylesModal) {
      console.log('✅ Modal de gestión encontrado, cargando lista...');
      loadThumbnailStylesList();
      manageThumbnailStylesModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      console.log('✅ Modal de gestión abierto');
    } else {
      console.error('❌ Modal de gestión no encontrado');
    }
  } catch (error) {
    console.error('❌ Error abriendo modal de gestión:', error);
  }
}

// Función para cargar lista de estilos de miniatura
function loadThumbnailStylesList() {
  console.log('📋 Cargando lista de estilos de miniatura...');
  console.log('📊 Estilos disponibles:', customThumbnailStyles);
  
  try {
    const thumbnailStylesList = document.getElementById('thumbnailStylesList');
    const noThumbnailStylesMessage = document.getElementById('noThumbnailStylesMessage');
    
    console.log('🔍 Elementos encontrados:', {
      thumbnailStylesList: !!thumbnailStylesList,
      noThumbnailStylesMessage: !!noThumbnailStylesMessage
    });
    
    if (!thumbnailStylesList || !noThumbnailStylesMessage) {
      console.error('❌ Elementos de lista no encontrados');
      return;
    }
    
    thumbnailStylesList.innerHTML = '';
    
    if (customThumbnailStyles.length === 0) {
      console.log('📝 No hay estilos personalizados, mostrando mensaje');
      noThumbnailStylesMessage.style.display = 'block';
      thumbnailStylesList.style.display = 'none';
    } else {
      console.log(`📝 Mostrando ${customThumbnailStyles.length} estilos personalizados`);
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
    
    console.log('✅ Lista de estilos cargada correctamente');
  } catch (error) {
    console.error('❌ Error cargando lista de estilos:', error);
  }
}

// Función para eliminar estilo de miniatura
function deleteThumbnailStyle(styleId) {
  if (confirm('¿Estás seguro de que quieres eliminar este estilo de miniatura?')) {
    customThumbnailStyles = customThumbnailStyles.filter(style => style.id !== styleId);
    saveThumbnailStyles();
    updateThumbnailStyleSelector();
    loadThumbnailStylesList();
    showNotification('✅ Estilo de miniatura eliminado', 'success');
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
    
    showNotification('✅ Estilo de miniatura actualizado', 'success');
    currentEditingThumbnailStyleId = null;
  }
}

// Función para obtener datos del estilo de miniatura seleccionado
function getThumbnailStyleData() {
  const thumbnailStyleSelect = document.getElementById('thumbnailStyleSelect');
  if (!thumbnailStyleSelect) {
    console.log('🔍 DEBUG - thumbnailStyleSelect no encontrado, usando default');
    return 'default';
  }
  
  const selectedValue = thumbnailStyleSelect.value;
  console.log('🔍 DEBUG - selectedValue del selector:', selectedValue);
  
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
      console.log('🔍 DEBUG - Enviando estilo personalizado completo:', result);
      return result;
    }
  }
  
  // Estilo predeterminado
  console.log('🔍 DEBUG - Enviando estilo predeterminado:', selectedValue);
  return selectedValue;
}

// FALLBACK PARA SIDEBAR - Se ejecuta después de que todo esté cargado
setTimeout(function() {
  console.log('🔄 FALLBACK: Verificando configuración del sidebar...');
  
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.getElementById('sidebar');
  
  if (menuToggleBtn && sidebar) {
    console.log('✅ Elementos del sidebar encontrados - onclick ya configurado en HTML');
  } else {
    console.error('❌ FALLBACK: Elementos del sidebar no encontrados');
    console.error('menuToggleBtn:', menuToggleBtn);
    console.error('sidebar:', sidebar);
  }
}, 3000);

// ================================
// SISTEMA DE PROYECTOS
// ================================

// Inicializar sistema de proyectos
document.addEventListener('DOMContentLoaded', function() {
  console.log('🚀 DOM cargado, inicializando sistema de proyectos...');
  initializeProjectSystem();
});

// Fallback con delay para asegurar que se inicialice
setTimeout(function() {
  console.log('🔄 Inicializador de respaldo ejecutándose...');
  const saveBtn = document.getElementById('saveProjectBtn');
  const loadBtn = document.getElementById('loadProjectBtn');
  const manageBtn = document.getElementById('manageProjectsBtn');
  
  if (saveBtn && !saveBtn.onclick && !saveBtn.hasAttribute('data-initialized')) {
    console.log('🔧 Configurando eventos de respaldo...');
    
    saveBtn.addEventListener('click', function(e) {
      console.log('💾 RESPALDO: Click en Guardar Proyecto');
      e.preventDefault();
      saveCurrentProject();
    });
    saveBtn.setAttribute('data-initialized', 'true');
    
    if (loadBtn) {
      loadBtn.addEventListener('click', function(e) {
        console.log('📂 RESPALDO: Click en Cargar Proyecto');
        e.preventDefault();
        showLoadProjectModal();
      });
      loadBtn.setAttribute('data-initialized', 'true');
    }
    
    if (manageBtn) {
      manageBtn.addEventListener('click', function(e) {
        console.log('🔧 RESPALDO: Click en Gestionar Proyectos');
        e.preventDefault();
        showManageProjectsModal();
      });
      manageBtn.setAttribute('data-initialized', 'true');
    }
    
    console.log('✅ Eventos de respaldo configurados');
  } else {
    console.log('ℹ️ Eventos ya configurados o elementos no encontrados');
  }
}, 2000);

function initializeProjectSystem() {
  console.log('🔧 Inicializando sistema de proyectos...');
  
  const saveProjectBtn = document.getElementById('saveProjectBtn');
  const loadProjectBtn = document.getElementById('loadProjectBtn');
  const manageProjectsBtn = document.getElementById('manageProjectsBtn');

  console.log('🔍 Elementos encontrados:', {
    saveProjectBtn: !!saveProjectBtn,
    loadProjectBtn: !!loadProjectBtn,
    manageProjectsBtn: !!manageProjectsBtn
  });

  if (saveProjectBtn) {
    console.log('✅ Configurando evento para saveProjectBtn');
    saveProjectBtn.addEventListener('click', function(e) {
      console.log('🖱️ Click en Guardar Proyecto');
      e.preventDefault();
      saveCurrentProject();
    });
  } else {
    console.error('❌ No se encontró saveProjectBtn');
  }
  
  if (loadProjectBtn) {
    console.log('✅ Configurando evento para loadProjectBtn');
    loadProjectBtn.addEventListener('click', function(e) {
      console.log('🖱️ Click en Cargar Proyecto');
      e.preventDefault();
      showLoadProjectModal();
    });
  } else {
    console.error('❌ No se encontró loadProjectBtn');
  }
  
  if (manageProjectsBtn) {
    console.log('✅ Configurando evento para manageProjectsBtn');
    manageProjectsBtn.addEventListener('click', function(e) {
      console.log('🖱️ Click en Gestionar Proyectos');
      e.preventDefault();
      showManageProjectsModal();
    });
  } else {
    console.error('❌ No se encontró manageProjectsBtn');
  }

  // Inicializar event listeners de modales
  initializeProjectModals();
  
  console.log('✅ Sistema de proyectos inicializado');
}

// Función para guardar el proyecto actual
async function saveCurrentProject() {
  try {
    console.log('💾 Iniciando guardado de proyecto...');
    
    const topicElement = document.getElementById('topic');
    const folderNameElement = document.getElementById('folderName');
    const sectionsNumberElement = document.getElementById('sectionsNumber');
    
    console.log('🔍 Elementos encontrados:', {
      topic: !!topicElement,
      folderName: !!folderNameElement,
      sectionsNumber: !!sectionsNumberElement
    });
    
    if (!topicElement || !folderNameElement || !sectionsNumberElement) {
      showNotification('⚠️ No se encontraron los elementos del formulario. Asegúrate de haber configurado un proyecto.', 'warning');
      return;
    }
    
    const topic = topicElement.value.trim();
    const folderName = folderNameElement.value.trim();
    const totalSections = parseInt(sectionsNumberElement.value);
    
    if (!topic) {
      showNotification('⚠️ Ingresa un tema para guardar el proyecto', 'warning');
      return;
    }

    // El proyecto se guarda automáticamente al generar contenido
    // Esta función es principalmente para mostrar confirmación manual
    showNotification('💾 El proyecto se guarda automáticamente al generar contenido', 'info');
    
    // Si hay contenido generado, refrescar la lista de proyectos
    if (currentSectionNumber > 0) {
      await refreshProjectsList();
      showNotification('✅ Estado del proyecto actualizado', 'success');
    }
    
  } catch (error) {
    console.error('❌ Error guardando proyecto:', error);
    showNotification('❌ Error guardando el proyecto', 'error');
  }
}

// Función para mostrar modal de cargar proyecto
async function showLoadProjectModal() {
  const modal = document.getElementById('loadProjectModal');
  const container = document.getElementById('projectsListContainer');
  
  modal.style.display = 'block';
  container.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i><span>Cargando proyectos...</span></div>';
  
  try {
    console.log('🔍 Haciendo fetch a /api/projects...');
    const response = await fetch('/api/projects');
    console.log('📡 Respuesta recibida:', response.status, response.statusText);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('📊 Datos recibidos:', data);
    
    if (data.success) {
      window.availableProjects = data.projects || [];
      console.log('✅ Proyectos cargados en window.availableProjects:', window.availableProjects.length);
      renderProjectsList(container, 'load');
    } else {
      console.error('❌ API devolvió error:', data.error);
      container.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><h3>Error cargando proyectos</h3><p>${data.error || 'No se pudieron cargar los proyectos disponibles'}</p></div>`;
    }
  } catch (error) {
    console.error('❌ Error cargando proyectos:', error);
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
    console.error('❌ Error cargando proyectos para gestión:', error);
    container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Error de conexión</h3><p>No se pudo conectar con el servidor</p></div>';
  }
}

// Función para refrescar lista de proyectos
async function refreshProjectsList() {
  // Verificar que availableProjects esté definido
  if (typeof window.availableProjects === 'undefined') {
    console.log('⚠️ window.availableProjects no definido en refresh, inicializando...');
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
    console.error('❌ Error refrescando proyectos:', error);
    return false;
  }
}

// Función para renderizar lista de proyectos
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
    
    return `
      <div class="project-card" data-project="${project.folderName}">
        <div class="project-card-header">
          <h3 class="project-title">${project.folderName}</h3>
          <span class="project-status">${isComplete ? 'Completo' : 'En progreso'}</span>
        </div>
        
        <div class="project-info">
          <div class="project-info-item">
            <span class="project-info-label">Tema:</span>
            <span class="project-info-value">${project.topic}</span>
          </div>
          <div class="project-info-item">
            <span class="project-info-label">Secciones:</span>
            <span class="project-info-value">${project.sectionsCompleted}/${project.totalSections}</span>
          </div>
          <div class="project-info-item">
            <span class="project-info-label">Última modificación:</span>
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
}

// Función para cargar un proyecto
async function loadProject(folderName) {
  try {
    // Evitar cargar el mismo proyecto múltiples veces
    if (window.currentProject && window.currentProject.folderName === folderName) {
      console.log(`🔄 Proyecto "${folderName}" ya está cargado, omitiendo recarga`);
      return;
    }
    
    isLoadingProject = true; // Activar bandera de carga
    isMetadataShown = false; // Resetear bandera de metadatos solo si es un proyecto diferente
    showNotification('📂 Cargando proyecto...', 'info');
    
    const response = await fetch(`/api/projects/${folderName}`);
    const data = await response.json();
    
    if (data.success) {
      window.currentProject = data.project;
      
      // Verificar y llenar formulario con datos del proyecto
      const topicElement = document.getElementById('prompt'); // Cambiado de 'topic' a 'prompt'
      const folderNameElement = document.getElementById('folderName');
      const sectionsNumberElement = document.getElementById('sectionsNumber');
      const voiceSelectElement = document.getElementById('voiceSelect');
      const modelSelectElement = document.getElementById('modelSelect');
      const llmModelSelectElement = document.getElementById('llmModelSelect');
      
      console.log('🔍 Elementos del formulario encontrados:', {
        prompt: !!topicElement, // Cambiado de topic a prompt
        folderName: !!folderNameElement,
        sectionsNumber: !!sectionsNumberElement,
        voiceSelect: !!voiceSelectElement,
        modelSelect: !!modelSelectElement,
        llmModelSelect: !!llmModelSelectElement
      });
      
      if (topicElement) {
        topicElement.value = window.currentProject.topic;
        console.log('📝 Tema del guión cargado:', window.currentProject.topic);
      } else {
        console.warn('⚠️ Elemento prompt (tema del guión) no encontrado');
      }
      
      if (folderNameElement) {
        folderNameElement.value = window.currentProject.folderName;
      } else {
        console.warn('⚠️ Elemento folderName no encontrado');
      }
      
      if (sectionsNumberElement) {
        sectionsNumberElement.value = window.currentProject.totalSections;
        updateSectionButtons(); // Actualizar estado de botones
      } else {
        console.warn('⚠️ Elemento sectionsNumber no encontrado');
      }
      
      if (voiceSelectElement) {
        voiceSelectElement.value = window.currentProject.voice || 'shimmer';
      } else {
        console.warn('⚠️ Elemento voiceSelect no encontrado');
      }
      
      if (modelSelectElement && window.currentProject.imageModel) {
        modelSelectElement.value = window.currentProject.imageModel;
      }
      
      // Cargar modelo LLM
      if (llmModelSelectElement && window.currentProject.llmModel) {
        llmModelSelectElement.value = window.currentProject.llmModel;
        console.log('🧠 Modelo LLM cargado:', window.currentProject.llmModel);
      }
      
      // 🔧 CARGAR CONFIGURACIONES ADICIONALES DEL PROYECTO
      console.log('🔧 Cargando configuraciones adicionales del proyecto...');
      
      // Cargar estilo de narración
      const styleSelectElement = document.getElementById('styleSelect');
      if (styleSelectElement && window.currentProject.scriptStyle) {
        styleSelectElement.value = window.currentProject.scriptStyle;
        console.log('📝 Estilo de narración cargado:', window.currentProject.scriptStyle);
      }
      
      // Cargar voz de Applio
      const applioVoiceSelectElement = document.getElementById('applioVoiceSelect');
      if (applioVoiceSelectElement && window.currentProject.applioVoice) {
        applioVoiceSelectElement.value = window.currentProject.applioVoice;
        console.log('🎤 Voz de Applio cargada:', window.currentProject.applioVoice);
      }
      
      // Cargar modelo de Applio
      const applioModelSelectElement = document.getElementById('applioModelSelect');
      if (applioModelSelectElement && window.currentProject.applioModel) {
        applioModelSelectElement.value = window.currentProject.applioModel;
        console.log('🎛️ Modelo de Applio cargado:', window.currentProject.applioModel);
      }
      
      // Cargar pitch de Applio
      const applioPitchElement = document.getElementById('applioPitch');
      const pitchValueElement = document.getElementById('pitchValue');
      if (applioPitchElement && typeof window.currentProject.applioPitch !== 'undefined') {
        applioPitchElement.value = window.currentProject.applioPitch;
        if (pitchValueElement) {
          pitchValueElement.textContent = window.currentProject.applioPitch;
        }
        console.log('🎵 Pitch de Applio cargado:', window.currentProject.applioPitch);
      }
      
      // Cargar modificador de prompts (instrucciones para imágenes)
      const promptModifierElement = document.getElementById('promptModifier');
      if (promptModifierElement && window.currentProject.promptModifier) {
        promptModifierElement.value = window.currentProject.promptModifier;
        console.log('🎨 Modificador de prompts cargado:', window.currentProject.promptModifier);
      }
      
      // Cargar configuración de checkboxes
      const skipImagesElement = document.getElementById('skipImages');
      if (skipImagesElement && typeof window.currentProject.skipImages === 'boolean') {
        skipImagesElement.checked = window.currentProject.skipImages;
        console.log('🚫 Skip imágenes cargado:', window.currentProject.skipImages, 'checkbox checked:', skipImagesElement.checked);
      } else {
        console.warn('⚠️ Skip Images - elemento:', !!skipImagesElement, 'valor en proyecto:', window.currentProject.skipImages, 'tipo:', typeof window.currentProject.skipImages);
      }
      
      const googleImagesElement = document.getElementById('googleImages');
      if (googleImagesElement && typeof window.currentProject.googleImages === 'boolean') {
        googleImagesElement.checked = window.currentProject.googleImages;
        console.log('🔗 Google Images cargado:', window.currentProject.googleImages, 'checkbox checked:', googleImagesElement.checked);
      } else {
        console.warn('⚠️ Google Images - elemento:', !!googleImagesElement, 'valor en proyecto:', window.currentProject.googleImages, 'tipo:', typeof window.currentProject.googleImages);
      }
      
      // Cargar número de imágenes
      const imagesSelectElement = document.getElementById('imagesSelect');
      if (imagesSelectElement && window.currentProject.imageCount) {
        imagesSelectElement.value = window.currentProject.imageCount;
        console.log('🖼️ Número de imágenes cargado:', window.currentProject.imageCount);
      }
      
      // Cargar palabras por sección (minWords y maxWords)
      const minWordsElement = document.getElementById('minWords');
      if (minWordsElement && window.currentProject.minWords) {
        minWordsElement.value = window.currentProject.minWords;
        console.log('📝 MinWords cargado:', window.currentProject.minWords);
      }
      
      const maxWordsElement = document.getElementById('maxWords');
      if (maxWordsElement && window.currentProject.maxWords) {
        maxWordsElement.value = window.currentProject.maxWords;
        console.log('📝 MaxWords cargado:', window.currentProject.maxWords);
      }
      
      console.log('✅ Todas las configuraciones del proyecto han sido restauradas');
      
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
        
        console.log('📊 Variables globales actualizadas:', {
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
      
      // 🎬 VERIFICAR Y MOSTRAR METADATOS DE YOUTUBE SI EXISTEN
      if (window.currentProject.youtubeMetadata && !isMetadataShown) {
        console.log('🎬 Proyecto tiene metadatos de YouTube, mostrando automáticamente...');
        const isProjectComplete = window.currentProject.completedSections.length >= window.currentProject.totalSections;
        
        if (isProjectComplete) {
          // Mostrar metadatos automáticamente para proyectos completos
          isMetadataShown = true; // Marcar como mostrado INMEDIATAMENTE
          setTimeout(() => {
            showYouTubeMetadataResults(window.currentProject.youtubeMetadata.content, window.currentProject.topic);
            showNotification('🎬 Metadatos de YouTube cargados automáticamente', 'info');
          }, 1500); // Delay para que se complete la carga del proyecto
        } else {
          console.log('📊 Proyecto incompleto, metadatos disponibles pero no se muestran automáticamente');
          showNotification('📊 Este proyecto tiene metadatos de YouTube generados anteriormente', 'info');
        }
      } else if (window.currentProject.youtubeMetadata && isMetadataShown) {
        console.log('🎬 Metadatos ya mostrados, omitiendo duplicado');
      } else {
        const isProjectComplete = window.currentProject.completedSections.length >= window.currentProject.totalSections;
        if (isProjectComplete) {
          console.log('🎬 Proyecto completo sin metadatos, se pueden generar manualmente');
          showNotification('🎬 Proyecto completo. Puedes generar metadatos de YouTube en el extractor de texto.', 'info');
        }
      }
      
      // Actualizar estado de los botones según el progreso del proyecto
      updateProjectButtons(window.currentProject);
      
      // Cerrar modales
      closeModal('loadProjectModal');
      closeModal('manageProjectsModal');
      
      showNotification(`✅ Proyecto "${window.currentProject.folderName}" cargado exitosamente`, 'success');
      
      // Mostrar detalles del proyecto cargado
      showProjectDetails(window.currentProject);
      
    } else {
      showNotification('❌ Error cargando el proyecto', 'error');
    }
    
  } catch (error) {
    console.error('❌ Error cargando proyecto:', error);
    showNotification('❌ Error de conexión al cargar proyecto', 'error');
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
    console.log('🖼️ Cargando imágenes para sección:', section.section);
    console.log('🔍 Motivo de carga:', {
      hasImages: section.hasImages,
      imageFiles: !!section.imageFiles,
      googleImagesMode: section.googleImagesMode
    });
    console.log('🔍 Datos completos de la sección:', section);
    loadSectionImages(section.section);
  } else {
    console.log('🚫 No se detectaron imágenes para cargar:', {
      hasImages: section.hasImages,
      imageFiles: !!section.imageFiles,
      googleImagesMode: section.googleImagesMode,
      sectionKeys: Object.keys(section)
    });
    
    // FORZAR carga de imágenes independientemente de las banderas
    console.log('🔧 Intentando cargar imágenes forzadamente...');
    loadSectionImages(section.section);
  }
}

// Función para cargar imágenes de una sección específica desde el proyecto
async function loadSectionImages(sectionNumber) {
  try {
    console.log(`🔍 [loadSectionImages] Iniciando carga para sección ${sectionNumber}`);
    
    if (!window.currentProject) {
      console.warn('⚠️ No hay proyecto cargado actualmente');
      return;
    }
    
    // 🔍 Usar la carpeta correcta del proyecto
    const projectFolderName = window.currentProject.folderName || 
                             window.currentProject.originalFolderName || 
                             window.currentProject.topic.toLowerCase().replace(/\s+/g, '_');
    
    console.log(`🖼️ Buscando imágenes para sección ${sectionNumber} en proyecto: ${projectFolderName}`);
    console.log(`🔗 URL que se va a llamar: /api/project-images/${projectFolderName}/${sectionNumber}`);
    
    const response = await fetch(`/api/project-images/${projectFolderName}/${sectionNumber}`);
    console.log(`📡 Respuesta del servidor:`, response.status, response.statusText);
    
    const data = await response.json();
    console.log(`📊 Datos recibidos completos:`, JSON.stringify(data, null, 2));
    
    if (data.success && data.images && data.images.length > 0) {
      console.log(`✅ Encontradas ${data.images.length} imágenes para sección ${sectionNumber}`);
      
      // Preparar imágenes para el carrusel
      const carouselImages = data.images.map((image, index) => {
        console.log(`🖼️ Procesando imagen ${index + 1}:`, image);
        return {
          url: image.url,
          caption: image.caption || `Imagen ${index + 1} de la Sección ${sectionNumber}`,
          filename: image.filename,
          path: image.path,
          source: image.source || 'Google Images' // Añadir source para la lógica del carrusel
        };
      });
      
      console.log(`🎠 Imágenes preparadas para carrusel:`, carouselImages);
      
      // Cargar keywords si están disponibles
      console.log(`🔍 [loadSectionImages] Data.keywords recibidas:`, data.keywords);
      console.log(`🔍 [loadSectionImages] Longitud de keywords:`, data.keywords ? data.keywords.length : 0);
      if (data.keywords && data.keywords.length > 0) {
        currentImageKeywords = data.keywords;
        console.log(`📋 Keywords cargadas para las imágenes:`, data.keywords);
      } else {
        currentImageKeywords = [];
        console.log(`⚠️ No se recibieron keywords del backend`);
      }
      
      console.log(`🔍 [loadSectionImages] currentImageKeywords final:`, currentImageKeywords);
      
      // Mostrar carrusel
      createCarousel(carouselImages, sectionNumber, []);
      
      // Actualizar variables globales
      totalSlides = carouselImages.length;
      currentSlide = 0;
      
      // Almacenar prompts si están disponibles
      if (data.prompts && data.prompts.length > 0) {
        imagePrompts = data.prompts;
        console.log(`🎨 Prompts de imágenes cargados:`, data.prompts);
      }
      
      console.log(`🎠 Carrusel creado exitosamente para sección ${sectionNumber}`);
      
    } else {
      console.log(`📷 No se encontraron imágenes para sección ${sectionNumber}`, data);
      
      // Ocultar carrusel si no hay imágenes
      const carouselContainer = document.getElementById("carousel-container");
      if (carouselContainer) {
        carouselContainer.style.display = "none";
        console.log(`🔒 Carrusel ocultado para sección ${sectionNumber}`);
      }
    }
    
  } catch (error) {
    console.error(`❌ Error cargando imágenes para sección ${sectionNumber}:`, error);
    
    // Ocultar carrusel en caso de error
    const carouselContainer = document.getElementById("carousel-container");
    if (carouselContainer) {
      carouselContainer.style.display = "none";
    }
  }
}

// Función para cargar prompts del proyecto al panel lateral
function loadProjectPrompts(project) {
  console.log('📋 Iniciando carga de prompts del proyecto...');
  
  if (!project.completedSections || project.completedSections.length === 0) {
    console.log('❌ No hay secciones completadas con prompts');
    return;
  }
  
  // Limpiar prompts existentes
  allAccumulatedPrompts = [];
  
  // Limpiar el panel lateral
  clearPromptsSidebar();
  
  let totalPrompts = 0;
  
  // Cargar prompts de cada sección completada
  project.completedSections.forEach(section => {
    console.log(`🔍 Procesando sección ${section.section}:`, {
      tienePrompts: !!(section.imagePrompts && section.imagePrompts.length > 0),
      tieneImageUrls: !!(section.imageUrls && section.imageUrls.length > 0),
      esGoogleImages: section.googleImagesMode
    });
    
    if (section.imagePrompts && section.imagePrompts.length > 0) {
      console.log(`📋 Cargando ${section.imagePrompts.length} prompts de la sección ${section.section}`);
      
      if (section.googleImagesMode) {
        console.log(`🔗 Sección ${section.section} tiene keywords para Google Images`);
        
        // Para Google Images, convertir keywords en URLs clicables
        const googleImageUrls = section.imagePrompts.map((keyword, index) => {
          const encodedKeyword = encodeURIComponent(keyword.trim());
          const googleUrl = `https://www.google.com/search?q=${encodedKeyword}&tbm=isch`;
          return `🔗 <a href="${googleUrl}" target="_blank" style="color: #00bfff; text-decoration: underline;">Buscar: "${keyword.trim()}"</a>`;
        });
        
        addPromptsToSidebar(googleImageUrls, section.section);
        totalPrompts += googleImageUrls.length;
      } else {
        // Prompts normales de imagen
        addPromptsToSidebar(section.imagePrompts, section.section);
        totalPrompts += section.imagePrompts.length;
      }
    } else if (section.imageUrls && section.imageUrls.length > 0) {
      console.log(`🖼️ Sección ${section.section} tiene ${section.imageUrls.length} URLs de imágenes generadas`);
      
      // Si tiene URLs pero no prompts, crear prompts genéricos
      const genericPrompts = section.imageUrls.map((url, index) => `Imagen ${index + 1} generada para la sección ${section.section}`);
      addPromptsToSidebar(genericPrompts, section.section);
      totalPrompts += genericPrompts.length;
    } else if (section.googleImagesMode) {
      console.log(`🔗 Sección ${section.section} usa Google Images automático`);
      
      // Para Google Images, mostrar un indicador
      const googleImageIndicator = [`Sección ${section.section} configurada para usar Google Images automático`];
      addPromptsToSidebar(googleImageIndicator, section.section);
      totalPrompts += 1;
    }
  });
  
  console.log(`✅ Total de prompts cargados en el panel: ${totalPrompts}`);
}

// Función para mostrar detalles del proyecto
function showProjectDetails(project) {
  console.log('📊 Mostrando detalles del proyecto:', project);
  
  const modal = document.getElementById('projectDetailModal');
  const title = document.getElementById('projectDetailTitle');
  const content = document.getElementById('projectDetailContent');
  
  if (!modal || !title || !content) {
    console.error('❌ Elementos del modal no encontrados:', { modal: !!modal, title: !!title, content: !!content });
    return;
  }
  
  title.innerHTML = `<i class="fas fa-folder"></i> ${project.folderName}`;
  
  const progress = (project.completedSections.length / project.totalSections) * 100;
  const isComplete = project.completedSections.length >= project.totalSections;
  
  console.log('📈 Progreso del proyecto:', {
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
            <div class="overview-value">${isComplete ? '✅ Completo' : '🔄 En progreso'}</div>
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
            <div class="overview-label">Última modificación</div>
            <div class="overview-value">${project.lastModified ? new Date(project.lastModified).toLocaleString() : 'No disponible'}</div>
          </div>
          <div class="overview-item">
            <div class="overview-label">Voz</div>
            <div class="overview-value">${project.voice || 'No especificada'}</div>
          </div>
          ${project.imageModel ? `
          <div class="overview-item">
            <div class="overview-label">Modelo de IA</div>
            <div class="overview-value">${project.imageModel}</div>
          </div>
          ` : ''}
          <div class="overview-item">
            <div class="overview-label">Metadatos YouTube</div>
            <div class="overview-value">${project.youtubeMetadata ? 
              `✅ Generados ${project.youtubeMetadata.generatedAt ? 
                `(${new Date(project.youtubeMetadata.generatedAt).toLocaleDateString()})` : ''
              }` : 
              (isComplete ? '⚠️ Disponibles para generar' : '❌ No disponibles')
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
              console.log('🔍 Procesando sección:', section);
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
                  <div>📝 Script: ${hasScript ? '✅ Generado' : '❌ No disponible'}</div>
                  <div>🖼️ Imágenes: ${hasImages ? (section.googleImagesMode ? '🔗 Google Images' : `✅ ${imageCount} imágenes`) : '❌ Sin imágenes'}</div>
                  <div>📅 ${section.completedAt ? new Date(section.completedAt).toLocaleDateString() : 'Fecha no disponible'}</div>
                  ${section.prompts?.length > 0 ? `<div>🎨 Prompts: ${section.prompts.length}</div>` : ''}
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
    console.log('🎯 Configurando event listeners para', actionButtons.length, 'botones de sección,', activateButton ? '1' : '0', 'botón de activar y', youtubeMetadataButton ? '1' : '0', 'botón de metadatos');
    
    // Event listeners para botones de sección individuales
    actionButtons.forEach(button => {
      const section = button.getAttribute('data-section');
      const folder = button.getAttribute('data-folder');
      const action = button.getAttribute('data-action');
      const projectData = button.getAttribute('data-project');
      
      button.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('🔄 Click en botón:', action, 'sección:', section);
        
        let projectObj = project; // Usar el proyecto actual por defecto
        
        // Si hay datos del proyecto en el atributo, usarlos
        if (projectData) {
          try {
            projectObj = JSON.parse(projectData);
          } catch (error) {
            console.error('❌ Error parseando datos del proyecto:', error);
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
        console.log('🚀 Activando proyecto completo:', folder);
        
        let projectObj = project;
        if (projectData) {
          try {
            projectObj = JSON.parse(projectData);
          } catch (error) {
            console.error('❌ Error parseando datos del proyecto:', error);
          }
        }
        
        activateFullProject(projectObj);
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
        console.log('🎬 Click en metadatos YouTube:', { folder, topic, hasMetadata });
        
        if (hasMetadata && project.youtubeMetadata) {
          // Mostrar metadatos existentes
          console.log('📽️ Mostrando metadatos existentes');
          closeModal('projectDetailModal');
          showYouTubeMetadataResults(project.youtubeMetadata.content, topic);
          showNotification('🎬 Metadatos de YouTube cargados', 'success');
        } else {
          // Generar nuevos metadatos
          console.log('🎬 Generando nuevos metadatos de YouTube');
          closeModal('projectDetailModal');
          showNotification('🎬 Generando metadatos de YouTube...', 'info');
          
          // Establecer el tema en el campo para que generateYouTubeMetadata funcione
          const promptElement = document.getElementById('prompt');
          if (promptElement) {
            promptElement.value = topic;
          }
          
          // Cargar el proyecto primero para tener acceso a todas las secciones
          loadProject(folder).then(() => {
            setTimeout(() => {
              generateYouTubeMetadata().then(() => {
                showNotification('✅ Metadatos de YouTube generados exitosamente', 'success');
              }).catch(error => {
                console.error('❌ Error generando metadatos:', error);
                showNotification('❌ Error generando metadatos de YouTube', 'error');
              });
            }, 1000);
          }).catch(error => {
            console.error('❌ Error cargando proyecto:', error);
            showNotification('❌ Error cargando proyecto', 'error');
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
    showNotification('📋 Duplicando proyecto...', 'info');
    
    const response = await fetch(`/api/projects/${folderName}/duplicate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ newName: newName.trim() })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('✅ Proyecto duplicado exitosamente', 'success');
      await refreshProjectsList();
    } else {
      showNotification(`❌ Error: ${data.error}`, 'error');
    }
    
  } catch (error) {
    console.error('❌ Error duplicando proyecto:', error);
    showNotification('❌ Error de conexión', 'error');
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
    showNotification('🗑️ Eliminando proyecto...', 'info');
    
    const response = await fetch(`/api/projects/${folderName}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('✅ Proyecto eliminado exitosamente', 'success');
      await refreshProjectsList();
      closeModal('confirmDeleteModal');
    } else {
      showNotification(`❌ Error: ${data.error}`, 'error');
    }
    
  } catch (error) {
    console.error('❌ Error eliminando proyecto:', error);
    showNotification('❌ Error de conexión', 'error');
  }
}

// Función para inicializar modales de proyectos
function initializeProjectModals() {
  console.log('🔧 Inicializando modales de proyectos...');
  
  // Event listeners para cerrar modales con múltiples métodos
  document.querySelectorAll('.close').forEach(closeBtn => {
    closeBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('❌ Cerrando modal via botón X');
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
      console.log('❌ Cerrando modal via click fuera');
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
        console.log(`❌ Cerrando modal via ${btnId}`);
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
  
  console.log('✅ Modales de proyectos inicializados');
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
    showNotification(`📄 Sección ${sectionNumber} cargada`, 'success');
  }
}

console.log('✅ Sistema de proyectos cargado completamente');

// INICIALIZADOR FINAL DIRECTO - FORZAR EVENTOS
setTimeout(function() {
  console.log('🔧 INICIALIZADOR FINAL: Configurando eventos directos...');
  
  // Configurar eventos directos como onclick
  const saveBtn = document.getElementById('saveProjectBtn');
  const loadBtn = document.getElementById('loadProjectBtn');
  const manageBtn = document.getElementById('manageProjectsBtn');
  
  if (saveBtn) {
    console.log('✅ Configurando saveProjectBtn con onclick directo');
    saveBtn.onclick = function(e) {
      console.log('💾 ONCLICK DIRECTO: Guardar Proyecto');
      e.preventDefault();
      saveCurrentProject();
      return false;
    };
  }
  
  if (loadBtn) {
    console.log('✅ Configurando loadProjectBtn con onclick directo');
    loadBtn.onclick = function(e) {
      console.log('📂 ONCLICK DIRECTO: Cargar Proyecto');
      e.preventDefault();
      showLoadProjectModal();
      return false;
    };
  }
  
  if (manageBtn) {
    console.log('✅ Configurando manageProjectsBtn con onclick directo');
    manageBtn.onclick = function(e) {
      console.log('🔧 ONCLICK DIRECTO: Gestionar Proyectos');
      e.preventDefault();
      showManageProjectsModal();
      return false;
    };
  }
  
  // Inicializar modales de proyectos
  initializeProjectModals();
  
  // FORZAR eventos de cerrar modal específicamente
  console.log('🔒 Configurando eventos de cerrar modal...');
  document.querySelectorAll('.close[data-modal]').forEach(closeBtn => {
    const modalId = closeBtn.getAttribute('data-modal');
    console.log(`⚙️ Configurando cierre para modal: ${modalId}`);
    
    closeBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log(`❌ CERRANDO MODAL: ${modalId}`);
      closeModal(modalId);
      return false;
    };
  });
  
  console.log('🎯 Eventos onclick directos configurados');
}, 3000);

// Función para activar un proyecto completo con navegación
function activateFullProject(projectData) {
  console.log('🚀 Activando proyecto completo:', projectData);
  
  if (!projectData || !projectData.completedSections) {
    console.error('❌ Datos del proyecto no válidos');
    showNotification('❌ Datos del proyecto no válidos', 'error');
    return;
  }
  
  isLoadingProject = true; // Activar bandera de carga
  
  // Cargar el proyecto completo
  loadProject(projectData.folderName).then(() => {
    console.log('✅ Proyecto cargado, configurando navegación completa');
    
    // Configurar allSections con todas las secciones completadas
    allSections = new Array(projectData.totalSections);
    // Para el botón continuar, currentSectionNumber debe ser el número de secciones completadas
    currentSectionNumber = projectData.completedSections.length;
    
    // También actualizar variables globales
    currentTopic = projectData.topic;
    totalSections = projectData.totalSections;
    
    console.log('📊 Variables de navegación configuradas:', {
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
    
    console.log('� Navegación configurada:', allSections.map((s, i) => s ? `${i+1}: ✅` : `${i+1}: ❌`).join(', '));
    
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
      
      showNotification(`🚀 Proyecto "${projectData.folderName}" activado. Usa ← → para navegar entre secciones.`, 'success');
    } else {
      showNotification('❌ No hay secciones con script disponibles', 'error');
    }
    
    isLoadingProject = false; // Desactivar bandera de carga al finalizar
  }).catch(error => {
    console.error('❌ Error cargando proyecto:', error);
    showNotification('❌ Error cargando proyecto', 'error');
    isLoadingProject = false; // Desactivar bandera en caso de error
  });
}

// Función para actualizar botones según el estado del proyecto
function updateProjectButtons(project) {
  console.log('🔄 Actualizando botones del proyecto:', project);
  
  // Validar que el proyecto tenga la estructura esperada
  if (!project || typeof project !== 'object') {
    console.error('❌ Proyecto no válido:', project);
    return;
  }
  
  if (!project.completedSections || !Array.isArray(project.completedSections)) {
    console.error('❌ completedSections no válido:', project.completedSections);
    return;
  }
  
  if (!project.totalSections || typeof project.totalSections !== 'number') {
    console.error('❌ totalSections no válido:', project.totalSections);
    return;
  }
  
  const generateBtn = document.getElementById("generateBtn");
  const continueBtn = document.getElementById("continueBtn");
  const generateAudioBtn = document.getElementById("generateAudioBtn");
  
  if (!generateBtn || !continueBtn || !generateAudioBtn) {
    console.error('❌ Botones no encontrados en el DOM');
    return;
  }
  
  const completedSections = project.completedSections.length;
  const totalSections = project.totalSections;
  const nextSection = completedSections + 1;
  
  // ⚠️ CRÍTICO: Actualizar variables globales para que coincidan con el estado del proyecto
  currentSectionNumber = completedSections;
  currentTopic = project.topic;
  window.totalSections = totalSections;
  window.currentSectionNumber = completedSections;
  window.currentTopic = project.topic;
  
  console.log('📊 Estado del proyecto:', {
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
  continueBtn.style.display = "none";
  generateAudioBtn.style.display = "none";
  
  if (completedSections === 0) {
    // No hay secciones completadas - mostrar botón de generar primera sección
    generateBtn.style.display = "inline-flex";
    generateBtn.innerHTML = `
      <i class="fas fa-video"></i>
      <span>Generar Sección 1</span>
    `;
  } else if (completedSections < totalSections) {
    // Hay secciones completadas pero no todas - mostrar botón de continuar
    continueBtn.style.display = "inline-flex";
    continueBtn.innerHTML = `
      <i class="fas fa-forward"></i>
      <span>Continuar con Sección ${nextSection}</span>
    `;
    
    // También mostrar botón de audio para la sección actual
    generateAudioBtn.style.display = "inline-flex";
  } else {
    // Todas las secciones están completadas - mostrar botón de audio y botón de video
    generateAudioBtn.style.display = "inline-flex";
    
    // Mostrar botón de generación de video manual
    showVideoGenerationButton();
    
    // 🎬 VERIFICAR GENERACIÓN AUTOMÁTICA DE VIDEO
    // Solo generar automáticamente si no se ha generado ya y está activada la opción
    if (shouldGenerateVideoAutomatically()) {
      const folderName = document.getElementById("folderName").value.trim();
      if (folderName && !isGeneratingVideo) {
        console.log('🎬 Proyecto completo - iniciando generación automática de video...');
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
    const videoContainer = document.getElementById('videoGenerationContainer');
    if (videoContainer) {
      videoContainer.style.display = 'block';
    }
    
    // Actualizar visibility del botón de regenerar audios
    const regenerateAudioBtn = document.getElementById('regenerateApplioAudiosBtn');
    if (regenerateAudioBtn) {
      regenerateAudioBtn.style.display = 'inline-flex';
      console.log('🎤 Botón de regenerar audios mostrado para proyecto cargado');
    }
    
    // Actualizar visibility del botón de regenerar guiones
    const regenerateScriptsBtn = document.getElementById('regenerateMissingScriptsBtn');
    if (regenerateScriptsBtn) {
      regenerateScriptsBtn.style.display = 'inline-flex';
      console.log('📝 Botón de regenerar guiones mostrado para proyecto cargado');
    }
    
    // Actualizar visibility del botón de generar imágenes faltantes
    const generateImagesBtn = document.getElementById('generateMissingImagesBtn');
    if (generateImagesBtn) {
      generateImagesBtn.style.display = 'inline-flex';
      console.log('🖼️ Botón de generar imágenes mostrado para proyecto cargado');
    }
    
    // Actualizar visibility del botón de generar solo prompts
    const generatePromptsBtn = document.getElementById('generateMissingPromptsBtn');
    if (generatePromptsBtn) {
      generatePromptsBtn.style.display = 'inline-flex';
      console.log('📝 Botón de generar prompts mostrado para proyecto cargado');
    }
  }
  
  console.log('✅ Botones actualizados correctamente');
}

// Función auxiliar para cargar prompts en el sidebar
function loadPromptsInSidebar(prompts, sectionNumber) {
  console.log('🎨 Cargando prompts en panel lateral');
  
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
        <h4>🎨 Prompts de Sección ${sectionNumber}</h4>
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
  console.log('📋 Obteniendo estado del proyecto actual:', window.currentProject);
  return window.currentProject;
}

// Función para cargar detalles de una sección específica con datos del proyecto
function loadSectionDetailsWithProject(sectionNumber, folderName, projectData) {
  console.log('🔍 Cargando detalles de sección con proyecto:', sectionNumber, folderName, projectData);
  
  isLoadingProject = true; // Activar bandera de carga
  
  if (!projectData || !projectData.completedSections) {
    console.error('❌ Datos del proyecto no válidos');
    showNotification('❌ Datos del proyecto no válidos', 'error');
    isLoadingProject = false; // Desactivar en caso de error
    return;
  }
  
  const section = projectData.completedSections.find(s => s.section === sectionNumber);
  if (!section) {
    console.error('❌ Sección no encontrada:', sectionNumber);
    showNotification('❌ Sección no encontrada', 'error');
    isLoadingProject = false; // Desactivar en caso de error
    return;
  }
  
  console.log('📋 Datos de la sección encontrada:', section);
  
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
          <h4>🎬 Script Generado</h4>
          <div class="script-content">
            ${section.script ? 
              `<pre class="script-text">${section.script}</pre>` : 
              '<p class="no-content">❌ No hay script generado para esta sección</p>'
            }
          </div>
        </div>
        
        <div id="images-tab" class="tab-content">
          <h4>🖼️ Gestión de Imágenes</h4>
          <div class="images-content">
            ${section.googleImagesMode ? `
              <div class="google-images-info">
                <p><strong>🔗 Modo Google Images activado</strong></p>
                <p>Las imágenes se buscarán automáticamente desde Google Images</p>
                ${section.keywords ? `<p><strong>Keywords:</strong> ${section.keywords.join(', ')}</p>` : ''}
              </div>
            ` : section.imageUrls && section.imageUrls.length > 0 ? `
              <div class="generated-images">
                <p><strong>📊 Imágenes generadas: ${section.imageUrls.length}</strong></p>
                <div class="image-grid">
                  ${section.imageUrls.map((url, index) => `
                    <div class="image-item">
                      <img src="${url}" alt="Imagen ${index + 1}" onclick="window.open('${url}', '_blank')">
                      <div class="image-info">Imagen ${index + 1}</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : '<p class="no-content">❌ No hay imágenes para esta sección</p>'}
          </div>
        </div>
        
        <div id="prompts-tab" class="tab-content">
          <h4>🎨 Prompts de Imagen</h4>
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
            ` : '<p class="no-content">❌ No hay prompts generados para esta sección</p>'}
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
  console.log('📥 Cargando sección en editor:', sectionNumber, folderNameOrProject);
  
  // Si es un string, es el folderName, cargar el proyecto completo
  if (typeof folderNameOrProject === 'string') {
    console.log('📂 Cargando proyecto:', folderNameOrProject);
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
      console.error('❌ Datos del proyecto no válidos');
      showNotification('❌ Datos del proyecto no válidos', 'error');
      return;
    }
    
    const section = projectData.completedSections.find(s => s.section === sectionNumber);
    if (!section) {
      console.error('❌ Sección no encontrada:', sectionNumber);
      showNotification('❌ Sección no encontrada', 'error');
      return;
    }
    
    // Primero cargar el proyecto si no está activo
    if (!window.currentProject || window.currentProject.folderName !== projectData.folderName) {
      console.log('📂 Cargando proyecto antes de cargar sección');
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
  console.log('📋 Cargando datos de sección en interfaz:', sectionNumber, section);
  
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
    
    console.log('📊 Variables actualizadas en loadProjectSectionData:', {
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
    
    console.log('📚 allSections configurado:', allSections.map((s, i) => s ? `${i+1}: ✅` : `${i+1}: ❌`).join(', '));
  }
  
  // Actualizar el área del script principal usando la función existente
  if (section.script) {
    console.log('📝 Mostrando script en interfaz');
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
    console.log('📝 Tema del guión actualizado en sección:', window.currentProject.topic);
  } else {
    console.warn('⚠️ No se pudo actualizar el tema del guión - elemento:', !!promptArea, 'proyecto:', !!window.currentProject);
  }
  
  // Cargar configuración de checkboxes desde el proyecto actual
  if (window.currentProject) {
    const skipImagesElement = document.getElementById('skipImages');
    if (skipImagesElement && typeof window.currentProject.skipImages === 'boolean') {
      skipImagesElement.checked = window.currentProject.skipImages;
      console.log('🚫 Skip imágenes actualizado en sección:', window.currentProject.skipImages);
    }
    
    const googleImagesElement = document.getElementById('googleImages');
    if (googleImagesElement && typeof window.currentProject.googleImages === 'boolean') {
      googleImagesElement.checked = window.currentProject.googleImages;
      console.log('🔗 Google Images actualizado en sección:', window.currentProject.googleImages);
    }
  }
  
  // Cargar prompts en el panel lateral si existen
  if (section.imagePrompts && section.imagePrompts.length > 0) {
    console.log(`🎨 Cargando ${section.imagePrompts.length} prompts de la sección ${sectionNumber} en panel lateral`);
    
    // Limpiar el panel antes de cargar nuevos prompts de una sección específica
    clearPromptsSidebar();
    
    // Usar la función estándar para añadir prompts
    addPromptsToSidebar(section.imagePrompts, sectionNumber);
    
  } else if (section.imageUrls && section.imageUrls.length > 0) {
    console.log(`🖼️ Sección ${sectionNumber} tiene ${section.imageUrls.length} URLs de imágenes generadas`);
    
    // Si tiene URLs pero no prompts, crear prompts genéricos
    const genericPrompts = section.imageUrls.map((url, index) => `Imagen ${index + 1} - URL: ${url}`);
    clearPromptsSidebar();
    addPromptsToSidebar(genericPrompts, sectionNumber);
    
  } else if (section.googleImagesMode) {
    console.log(`🔗 Sección ${sectionNumber} configurada para Google Images automático`);
    
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
    console.log('🖼️ Mostrando información de imágenes generadas');
    
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
    
    showNotification(`📸 Sección ${sectionNumber} tiene ${section.imageUrls.length} imágenes generadas`, 'info');
  } else if (section.googleImagesMode) {
    console.log('🔗 Modo Google Images activado para esta sección');
    showNotification(`🔗 Sección ${sectionNumber} usa Google Images automático`, 'info');
  }
  
  // Cerrar modal
  closeSectionModal();
  
  // Actualizar estado de los botones según el progreso del proyecto
  updateProjectButtons(window.currentProject);
  
  showNotification(`✅ Sección ${sectionNumber} cargada en editor`, 'success');
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
  console.log('🔄 Cambiando a tab:', tabId);
  // Remover clase active de todos los tabs
  document.querySelectorAll('.detail-tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  // Activar el tab seleccionado
  event.target.closest('.detail-tab').classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

// Función para copiar texto al portapapeles
function copyToClipboard(text) {
  console.log('📋 Copiando al portapapeles:', text.substring(0, 50) + '...');
  navigator.clipboard.writeText(text).then(() => {
    showNotification('✅ Copiado al portapapeles', 'success');
  }).catch(err => {
    console.error('Error al copiar:', err);
    showNotification('❌ Error al copiar', 'error');
  });
}

// Función para cargar una sección específica en el editor
function loadProjectSection(sectionNumber) {
  console.log('📥 Cargando sección en editor:', sectionNumber);
  
  const projectState = getCurrentProjectState();
  if (!projectState) {
    console.error('❌ No hay proyecto activo');
    showNotification('❌ No hay proyecto activo', 'error');
    return;
  }
  
  const section = projectState.completedSections.find(s => s.section === sectionNumber);
  if (!section) {
    console.error('❌ Sección no encontrada:', sectionNumber);
    showNotification('❌ Sección no encontrada', 'error');
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
  
  showNotification(`✅ Sección ${sectionNumber} cargada en editor`, 'success');
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
  console.log('📚 Estructura de capítulos almacenada:', globalChapterStructure.length, 'capítulos');
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
    
    console.log('📊 Información de tokens actualizada:', tokenUsage);
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
// FUNCIONES ADICIONALES PARA IMÁGENES DE BING
// =====================================

function downloadBingImage(imageUrl, filename) {
  console.log(`📥 Descargando imagen: ${filename}`);
  
  const link = document.createElement('a');
  link.href = imageUrl;
  link.download = filename || 'bing_image.jpg';
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function showBingImageFullscreen(imageUrl, caption) {
  console.log(`🖼️ Mostrando imagen en pantalla completa: ${caption}`);
  
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
  console.log(`🔄 Refrescando imagen ${imageIndex} de la sección ${sectionNum}`);
  
  // Verificar que tenemos keywords para esta imagen
  if (!currentImageKeywords || !currentImageKeywords[imageIndex]) {
    console.error(`❌ No hay keywords disponibles para la imagen ${imageIndex}`);
    console.log(`🔍 DEBUG - currentImageKeywords:`, currentImageKeywords);
    console.log(`🔍 DEBUG - imageIndex:`, imageIndex);
    alert('No se pueden obtener nuevas keywords para esta imagen. Por favor, genera el contenido nuevamente.');
    return;
  }
  
  // Obtener el nombre de la carpeta actual del proyecto cargado
  let folderName;
  if (window.currentProject && window.currentProject.folderName) {
    folderName = window.currentProject.folderName;
    console.log(`📁 Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    const folderNameElement = document.getElementById('folderName');
    if (!folderNameElement) {
      console.error('❌ No se pudo obtener el nombre del proyecto');
      alert('Error: No se pudo obtener el nombre del proyecto');
      return;
    }
    folderName = folderNameElement.value.trim();
    console.log(`📁 Usando folderName del elemento HTML: ${folderName}`);
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
  
  console.log(`🎯 Imágenes actuales detectadas:`, currentImages.map((img, i) => `${i}: ${img.url.split('/').pop()}`));
  console.log(`🎯 Refrescando imagen en posición visual ${imageIndex}: ${currentImages[imageIndex]?.url.split('/').pop()}`);
  
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
      console.log(`✅ Nueva imagen descargada: ${result.newImage.filename}`);
      console.log(`🎯 Mapeo confirmado: posición visual ${imageIndex} → ${result.newImage.filename}`);
      
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
      showNotification('✅ Imagen renovada exitosamente', 'success');
      
    } else {
      throw new Error(result.error || 'Error desconocido');
    }
    
  } catch (error) {
    console.error(`❌ Error refrescando imagen:`, error);
    showNotification(`❌ Error renovando imagen: ${error.message}`, 'error');
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
  console.log(`🔄 Refrescando imagen ${imageIndex} de la sección ${sectionNum} con keyword personalizado`);
  
  // Obtener el keyword del input field
  const keywordInput = document.getElementById(`keyword-${imageIndex}-${sectionNum}`);
  if (!keywordInput) {
    console.error(`❌ No se encontró el input de keyword para imagen ${imageIndex}`);
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
    console.log(`📁 Usando folderName del proyecto cargado: ${folderName}`);
  } else {
    const folderNameElement = document.getElementById('folderName');
    if (!folderNameElement) {
      console.error('❌ No se pudo obtener el nombre del proyecto');
      alert('Error: No se pudo obtener el nombre del proyecto');
      return;
    }
    folderName = folderNameElement.value.trim();
    console.log(`📁 Usando folderName del elemento HTML: ${folderName}`);
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
  
  console.log(`🎯 Imágenes actuales detectadas:`, currentImages.map((img, i) => `${i}: ${img.filename}`));
  console.log(`🎯 Refrescando imagen en posición visual ${imageIndex}: ${currentImages[imageIndex]?.filename}`);
  
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
      console.log(`✅ Nueva imagen descargada: ${result.filename}`);
      console.log(`🎯 Mapeo confirmado: posición visual ${imageIndex} → ${result.filename}`);
      
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
            console.log(`🎯 Keyword actualizado: posición ${imageIndex} → "${customKeyword}"`);
          }
        }
      }
      
      showNotification(`✅ Imagen ${imageIndex + 1} renovada exitosamente con "${customKeyword}"`, 'success');
    } else {
      throw new Error(`Error del servidor: ${response.status}`);
    }
    
  } catch (error) {
    console.error(`❌ Error refrescando imagen:`, error);
    showNotification(`❌ Error renovando imagen: ${error.message}`, 'error');
  } finally {
    // Restaurar el botón
    const refreshButton = document.querySelector(`[onclick="refreshBingImageWithCustomKeyword(${imageIndex}, ${sectionNum})"]`);
    if (refreshButton) {
      refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i>';
      refreshButton.disabled = false;
    }
  }
}

// Función para mostrar notificaciones
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  
  // Estilos inline para la notificación
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    border-radius: 5px;
    color: white;
    font-weight: bold;
    z-index: 10000;
    animation: slideInRight 0.3s ease;
    max-width: 400px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  
  // Colores según el tipo
  if (type === 'success') {
    notification.style.backgroundColor = '#4CAF50';
  } else if (type === 'error') {
    notification.style.backgroundColor = '#f44336';
  } else {
    notification.style.backgroundColor = '#2196F3';
  }
  
  document.body.appendChild(notification);
  
  // Eliminar automáticamente después de 4 segundos
  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 4000);
}

// Exponer la nueva función globalmente
window.refreshBingImage = refreshBingImage;
window.showBingImageFullscreen = showBingImageFullscreen;
window.closeBingImageModal = closeBingImageModal;

// ================================
// FUNCIONES PARA GENERACIÓN DE VIDEO
// ================================

// Función para verificar si se debe generar video automáticamente
function shouldGenerateVideoAutomatically() {
  const generateVideoCheckbox = document.getElementById('generateVideo');
  return generateVideoCheckbox && generateVideoCheckbox.checked;
}

// Función para mostrar el botón de generación manual de video
function showVideoGenerationButton() {
  // Mostrar el contenedor principal de generación de video
  const videoContainer = document.getElementById('videoGenerationContainer');
  if (videoContainer) {
    videoContainer.style.display = 'block';
  }
  
  const videoBtn = document.getElementById('generateVideoBtn');
  if (videoBtn) {
    videoBtn.style.display = 'inline-flex';
  }
  
  const simpleVideoBtn = document.getElementById('generateSimpleVideoBtn');
  if (simpleVideoBtn) {
    simpleVideoBtn.style.display = 'inline-flex';
  }
  
  // Mostrar botón de regenerar audios solo si Applio está activado
  const regenerateAudioBtn = document.getElementById('regenerateApplioAudiosBtn');
  const applioCheckbox = document.getElementById('autoGenerateApplioAudio');
  
  // Mostrar el botón si Applio está activado O si hay un proyecto cargado (para permitir generar audios faltantes)
  if (regenerateAudioBtn && ((applioCheckbox && applioCheckbox.checked) || window.currentProject)) {
    regenerateAudioBtn.style.display = 'inline-flex';
    console.log('🎤 Botón de generar audios faltantes mostrado');
  } else {
    if (regenerateAudioBtn) {
      regenerateAudioBtn.style.display = 'none';
    }
  }
  
  // Mostrar botón de regenerar guiones si hay un proyecto cargado
  const regenerateScriptsBtn = document.getElementById('regenerateMissingScriptsBtn');
  if (regenerateScriptsBtn && window.currentProject) {
    regenerateScriptsBtn.style.display = 'inline-flex';
    console.log('📝 Botón de regenerar guiones vacíos mostrado');
  } else {
    if (regenerateScriptsBtn) {
      regenerateScriptsBtn.style.display = 'none';
    }
  }
  
  // Mostrar todas las configuraciones por defecto (para video completo)
  showVideoSettings();
  
  console.log('📹 Botones de generación de video mostrados');
}

// Función para mostrar/ocultar configuraciones de video
function showVideoSettings() {
  const animationSetting = document.getElementById('videoAnimationSetting');
  const qualitySetting = document.getElementById('videoQualitySetting');
  
  if (animationSetting) animationSetting.style.display = 'block';
  if (qualitySetting) qualitySetting.style.display = 'block';
}

// Función para ocultar configuraciones que no aplican para video simple
function hideVideoSettingsForSimple() {
  const animationSetting = document.getElementById('videoAnimationSetting');
  const qualitySetting = document.getElementById('videoQualitySetting');
  
  if (animationSetting) animationSetting.style.display = 'none';
  if (qualitySetting) qualitySetting.style.display = 'none';
}

// Función principal para generar video automáticamente
async function generateVideoAutomatically() {
  if (!shouldGenerateVideoAutomatically()) {
    console.log('📹 Generación automática de video desactivada');
    return;
  }
  
  const folderName = document.getElementById("folderName").value.trim();
  if (!folderName) {
    console.warn('⚠️ No hay nombre de carpeta para generar video');
    return;
  }
  
  console.log('🎬 Iniciando generación automática de video...');
  
  try {
    await generateProjectVideo(folderName, true); // true = automático
  } catch (error) {
    console.error('❌ Error en generación automática de video:', error);
    showError(`Error generando video automáticamente: ${error.message}`);
  }
}

// Función principal para generar video del proyecto
async function generateProjectVideo(folderName, isAutomatic = false) {
  if (isGeneratingVideo) {
    console.log('⚠️ Ya se está generando un video');
    return;
  }
  
  isGeneratingVideo = true;
  currentVideoSession = Date.now().toString();
  
  try {
    // Obtener configuración de video
    const animationType = document.getElementById('videoAnimation')?.value || 'zoom-out';
    const quality = document.getElementById('videoQuality')?.value || 'standard';
    
    console.log(`🎬 Generando video para proyecto: ${folderName}`);
    console.log(`🎬 Configuración: animación=${animationType}, calidad=${quality}`);
    
    // Mostrar progreso
    if (!isAutomatic) {
      showVideoProgress();
      updateVideoProgress(0, 'Iniciando generación de video...');
    } else {
      // Para automático, mostrar en el output principal
      showAutomaticVideoProgress();
    }
    
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
          
          if (!isAutomatic) {
            updateVideoProgress(progressData.percent, progressData.message);
          } else {
            updateAutomaticVideoProgress(progressData.percent, progressData.message);
          }
          
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
      console.log('🎬 Respuesta de video recibida, descargando...');
      
      const blob = await response.blob();
      console.log('🎬 Video blob creado, tamaño:', blob.size);
      
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
        console.log('🎬 Descarga de video iniciada automáticamente');
        
        if (!isAutomatic) {
          showSuccess('🎬 ¡Video generado y descargado exitosamente!');
          hideVideoProgress(); // Restaurar botón después del éxito
        } else {
          showAutomaticVideoComplete();
        }
      } catch (clickError) {
        console.log('🎬 Click automático falló, mostrando enlace manual');
        a.style.display = 'block';
        a.textContent = 'Hacer clic aquí para descargar el video';
        a.style.color = '#00ff7f';
        a.style.textDecoration = 'underline';
        a.style.fontSize = '1.1rem';
        a.style.padding = '10px';
        
        if (!isAutomatic) {
          const progressInfo = document.getElementById('videoProgressInfo');
          if (progressInfo) {
            progressInfo.appendChild(document.createElement('br'));
            progressInfo.appendChild(a);
          }
          hideVideoProgress(); // Restaurar botón incluso si falla el click automático
        }
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
    console.error('❌ Error generando video:', error);
    
    if (!isAutomatic) {
      hideVideoProgress();
      showError(`Error generando video: ${error.message}`);
    } else {
      showError(`Error generando video automáticamente: ${error.message}`);
    }
  } finally {
    isGeneratingVideo = false;
    currentVideoSession = null;
    
    // Asegurarse de que el botón se restaure en todos los casos
    if (!isAutomatic) {
      setTimeout(() => {
        const generateBtn = document.getElementById('generateVideoBtn');
        if (generateBtn && generateBtn.disabled) {
          console.log('🔄 Restaurando botón de video desde finally');
          hideVideoProgress();
        }
      }, 1000);
    }
  }
}

// Función para generar video simple (sin animaciones)
async function generateSimpleProjectVideo(folderName) {
  if (isGeneratingVideo) {
    console.log('⚠️ Ya se está generando un video');
    return;
  }

  isGeneratingVideo = true;
  const button = document.getElementById('generateSimpleVideoBtn');
  
  try {
    // Deshabilitar botón y mostrar estado de carga
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando Video Simple...</span>';
    
    console.log('🎬 Iniciando generación de video simple para proyecto:', folderName);
    
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
    console.error('❌ Error generando video simple:', error);
    showError(`Error generando video simple: ${error.message}`);
  } finally {
    // Restaurar botón
    isGeneratingVideo = false;
    button.disabled = false;
    button.innerHTML = '<i class="fas fa-images"></i><span>Video Simple (Sin Animación)</span>';
  }
}

// Función para generar clips separados por sección
async function generateSeparateVideos(folderName) {
  if (isGeneratingVideo) {
    console.log('⚠️ Ya se está generando un video');
    return;
  }

  isGeneratingVideo = true;
  const button = document.getElementById('generateSeparateVideosBtn');
  
  try {
    // Deshabilitar botón y mostrar estado de carga
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Generando Clips Separados...</span>';
    
    console.log('🎬 Iniciando generación de clips separados para proyecto:', folderName);
    
    const response = await fetch('/generate-separate-videos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        folderName: folderName
      }),
    });

    if (response.ok) {
      const result = await response.json();
      
      if (result.success) {
        showSuccess(`¡${result.videosGenerated} clips separados generados exitosamente en sus respectivas carpetas de sección!`);
        console.log('✅ Clips separados generados:', result.videos);
      } else {
        throw new Error(result.error || 'Error interno del servidor');
      }
    } else {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Error interno del servidor');
    }

  } catch (error) {
    console.error('❌ Error generando clips separados:', error);
    showError(`Error generando clips separados: ${error.message}`);
  } finally {
    // Restaurar botón
    isGeneratingVideo = false;
    button.disabled = false;
    button.innerHTML = '<i class="fas fa-video"></i><span>Clips Separados por Sección</span>';
  }
}

// Función para mostrar progreso de video manual
function showVideoProgress() {
  const progressContainer = document.getElementById('videoProgressContainer');
  const generateBtn = document.getElementById('generateVideoBtn');
  
  if (progressContainer && generateBtn) {
    progressContainer.style.display = 'block';
    generateBtn.disabled = true;
    generateBtn.innerHTML = `
      <i class="fas fa-spinner fa-spin"></i>
      <span>Generando Video...</span>
    `;
  }
}

// Función para ocultar progreso de video manual
function hideVideoProgress() {
  const progressContainer = document.getElementById('videoProgressContainer');
  const generateBtn = document.getElementById('generateVideoBtn');
  
  if (progressContainer && generateBtn) {
    // Ocultar inmediatamente el progreso y restaurar el botón
    setTimeout(() => {
      progressContainer.style.display = 'none';
    }, 2000); // Reducido a 2 segundos
    
    // Restaurar el botón inmediatamente
    generateBtn.disabled = false;
    generateBtn.innerHTML = `
      <i class="fas fa-play-circle"></i>
      <span>Generar Video Completo</span>
    `;
    
    console.log('🎬 Botón de video restaurado');
  }
}

// Función para actualizar progreso de video manual
function updateVideoProgress(percent, message) {
  const progressFill = document.getElementById('videoProgressFill');
  const progressText = document.getElementById('videoProgressText');
  const progressInfo = document.getElementById('videoProgressInfo');
  const progressLabel = document.querySelector('.video-progress-label');
  
  if (progressFill) {
    progressFill.style.width = percent + '%';
  }
  
  if (progressText) {
    progressText.textContent = Math.round(percent) + '%';
  }
  
  if (progressInfo) {
    progressInfo.textContent = message;
  }
  
  if (progressLabel) {
    progressLabel.textContent = percent >= 100 ? '¡Video Completado!' : 'Generando video...';
  }
}

// Función para mostrar progreso de video automático
function showAutomaticVideoProgress() {
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

// Event listener para el botón de generación manual de video
document.addEventListener('DOMContentLoaded', function() {
  const generateVideoBtn = document.getElementById('generateVideoBtn');
  
  if (generateVideoBtn) {
    generateVideoBtn.addEventListener('click', async function() {
      const folderName = document.getElementById("folderName").value.trim();
      
      if (!folderName) {
        showError('Por favor, especifica el nombre de la carpeta del proyecto');
        return;
      }
      
      await generateProjectVideo(folderName, false); // false = manual
    });
    
    console.log('📹 Event listener para generación manual de video agregado');
  }
});

// =====================================
// FUNCIONALIDAD REGENERAR AUDIOS APPLIO
// =====================================

// Función principal para generar audios faltantes con Applio
async function regenerateAllApplioAudios() {
  try {
    // Verificar que haya un proyecto cargado
    if (!window.currentProject || !window.currentProject.completedSections) {
      showError('No hay un proyecto cargado con secciones completadas');
      return;
    }
    
    // Verificar que Applio esté activado
    const applioCheckbox = document.getElementById('autoGenerateApplioAudio');
    if (!applioCheckbox || !applioCheckbox.checked) {
      showError('Applio debe estar activado para generar audios');
      return;
    }
    
    // Obtener configuración actual de Applio
    const selectedApplioVoice = document.getElementById("applioVoiceSelect").value;
    const selectedApplioModel = document.getElementById("applioModelSelect").value;
    const applioPitch = parseInt(document.getElementById("applioPitch").value) || 0;
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
      console.log(`🎨 Estilo personalizado detectado: ${selectedStyleValue}`);
      console.log(`🎨 Instrucciones: ${customStyleInstructions.substring(0, 100)}...`);
    } else {
      scriptStyle = selectedStyleValue;
    }
    
    const wordsMin = parseInt(document.getElementById('wordsMin')?.value) || 800;
    const wordsMax = parseInt(document.getElementById('wordsMax')?.value) || 1100;

    console.log('🎤 Verificando audios faltantes y generando con Applio...');
    console.log('🎤 Configuración:', {
      voz: selectedApplioVoice,
      modelo: selectedApplioModel,
      pitch: applioPitch,
      proyecto: folderName,
      secciones: window.currentProject.completedSections.length,
      estilo: scriptStyle
    });
    
    // Deshabilitar botón durante el proceso
    const regenerateBtn = document.getElementById('regenerateApplioAudiosBtn');
    if (regenerateBtn) {
      regenerateBtn.disabled = true;
      regenerateBtn.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        <span>Verificando audios...</span>
      `;
    }
    
    // Mostrar progreso
    showNotification('🔍 Verificando qué audios faltan...', 'info');
    
    // Llamar al backend para verificar y generar solo los audios faltantes
    const response = await fetch('/generate-missing-applio-audios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: folderName,
        applioVoice: selectedApplioVoice,
        applioModel: selectedApplioModel,
        applioPitch: applioPitch,
        totalSections: window.currentProject.completedSections.length,
        scriptStyle: scriptStyle,
        customStyleInstructions: customStyleInstructions,
        wordsMin: wordsMin,
        wordsMax: wordsMax
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Verificación y generación completada:', data.message);
      
      if (data.data.generatedCount > 0) {
        showNotification(`✅ ${data.data.generatedCount} audios faltantes generados exitosamente`, 'success');
      } else {
        showNotification('✅ Todos los audios ya existen, no se generó ninguno nuevo', 'info');
      }
    } else {
      throw new Error(data.error || 'Error desconocido verificando/generando audios');
    }
    
  } catch (error) {
    console.error('❌ Error verificando/generando audios:', error);
    showError(`Error verificando/generando audios: ${error.message}`);
  } finally {
    // Restaurar botón
    const regenerateBtn = document.getElementById('regenerateApplioAudiosBtn');
    if (regenerateBtn) {
      regenerateBtn.disabled = false;
      regenerateBtn.innerHTML = `
        <i class="fas fa-microphone-alt"></i>
        <span>Generar Audios Faltantes</span>
      `;
    }
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
      console.log(`🎨 Estilo personalizado detectado: ${selectedStyleValue}`);
      console.log(`🎨 Instrucciones: ${customStyleInstructions.substring(0, 100)}...`);
    } else {
      scriptStyle = selectedStyleValue;
    }
    
    const wordsMin = parseInt(document.getElementById('wordsMin')?.value) || 800;
    const wordsMax = parseInt(document.getElementById('wordsMax')?.value) || 1100;

    console.log('📝 Verificando guiones faltantes...');
    console.log('📝 Configuración:', {
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
    showNotification('🔍 Verificando qué guiones están vacíos...', 'info');
    
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
      console.log('✅ Verificación y generación de guiones completada:', data.message);
      
      if (data.data.generatedCount > 0) {
        showNotification(`✅ ${data.data.generatedCount} guiones faltantes generados exitosamente`, 'success');
        
        // Actualizar el proyecto cargado para reflejar los cambios
        if (window.currentProject) {
          // Recargar el proyecto para obtener los guiones actualizados
          setTimeout(() => {
            showNotification('🔄 Recargando proyecto para mostrar los cambios...', 'info');
            // Aquí podrías recargar el proyecto actual si tienes esa funcionalidad
          }, 2000);
        }
      } else {
        showNotification('✅ Todos los guiones ya tienen contenido, no se generó ninguno nuevo', 'info');
      }
      
      // Mostrar detalles si hay información adicional
      if (data.data.missingScripts && data.data.missingScripts.length > 0) {
        console.log('📝 Secciones que tenían guiones vacíos:', data.data.missingScripts);
      }
      
    } else {
      throw new Error(data.error || 'Error desconocido regenerando guiones');
    }
    
  } catch (error) {
    console.error('❌ Error regenerando guiones:', error);
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

// Función para generar imágenes faltantes
async function generateMissingImages() {
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
    
    // Obtener configuraciones para imágenes
    const imageInstructions = document.getElementById('promptModifier')?.value || '';
    const imageCount = parseInt(document.getElementById('imagesSelect')?.value) || 5;
    const aspectRatio = document.getElementById('aspectRatioSelect')?.value || '9:16';
    
    // Verificar si se debe usar IA local (ComfyUI)
    const useLocalAI = document.getElementById('localAIImages')?.checked || false;
    
    // Obtener configuraciones de ComfyUI si está habilitado
    let comfyUIConfig = {};
    if (useLocalAI) {
      comfyUIConfig = {
        steps: parseInt(document.getElementById('comfyUISteps')?.value) || 15,
        guidance: parseFloat(document.getElementById('comfyUIGuidance')?.value) || 3.5,
        width: parseInt(document.getElementById('comfyUIWidth')?.value) || 1280,
        height: parseInt(document.getElementById('comfyUIHeight')?.value) || 720,
        model: document.getElementById('comfyUIModel')?.value || 'flux1-dev-fp8.safetensors',
        sampler: document.getElementById('comfyUISampler')?.value || 'euler',
        scheduler: document.getElementById('comfyUIScheduler')?.value || 'simple'
      };
    }
    
    console.log('🖼️ Iniciando generación de imágenes faltantes...');
    console.log('🖼️ Configuración:', {
      proyecto: folderName,
      instrucciones: imageInstructions.substring(0, 50) + '...',
      cantidadImagenes: imageCount,
      cantidadImagenesElemento: document.getElementById('imagesSelect')?.value,
      usarIALocal: useLocalAI,
      configComfyUI: useLocalAI ? comfyUIConfig : 'No aplicable'
    });
    
    // Deshabilitar botón y mostrar progreso
    const generateBtn = document.getElementById('generateMissingImagesBtn');
    if (generateBtn) {
      generateBtn.disabled = true;
      generateBtn.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        <span>Generando Imágenes...</span>
      `;
    }
    
    console.log('📤 ENVIANDO AL SERVIDOR:', {
      folderName: folderName,
      imageInstructions: imageInstructions,
      imageCount: imageCount,
      aspectRatio: aspectRatio,
      useLocalAI: useLocalAI,
      comfyUIConfig: comfyUIConfig
    });

    // Hacer solicitud al servidor
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
        useLocalAI: useLocalAI,
        comfyUIConfig: comfyUIConfig
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showSuccess(`✅ Proceso completado: ${data.message}`);
      console.log('🖼️ Resultados:', data.data);
      
      // Mostrar detalles si hay información adicional
      if (data.data.generatedPrompts && data.data.generatedPrompts.length > 0) {
        console.log('🖼️ Prompts generados para secciones:', data.data.generatedPrompts);
      }
      
      if (data.data.generatedImages && data.data.generatedImages.length > 0) {
        console.log('🖼️ Imágenes generadas para secciones:', data.data.generatedImages);
      }
      
    } else {
      throw new Error(data.error || 'Error desconocido generando imágenes');
    }
    
  } catch (error) {
    console.error('❌ Error generando imágenes:', error);
    showError(`Error generando imágenes: ${error.message}`);
  } finally {
    // Restaurar botón
    const generateBtn = document.getElementById('generateMissingImagesBtn');
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.innerHTML = `
        <i class="fas fa-image"></i>
        <span>Generar Imágenes Faltantes</span>
      `;
    }
  }
}

// Función para generar solo prompts de imágenes (sin generar imágenes)
async function generateMissingPrompts() {
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
    
    // Obtener configuraciones para imágenes
    const imageInstructions = document.getElementById('promptModifier')?.value || '';
    const imageCount = parseInt(document.getElementById('imagesSelect')?.value) || 5;
    
    console.log('📝 Iniciando generación de prompts de imágenes...');
    console.log('📝 Configuración:', {
      proyecto: folderName,
      instrucciones: imageInstructions.substring(0, 50) + '...',
      cantidadImagenes: imageCount
    });
    
    // Deshabilitar botón y mostrar progreso
    const generateBtn = document.getElementById('generateMissingPromptsBtn');
    if (generateBtn) {
      generateBtn.disabled = true;
      generateBtn.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        <span>Generando Prompts...</span>
      `;
    }
    
    console.log('📤 ENVIANDO AL SERVIDOR:', {
      folderName: folderName,
      imageInstructions: imageInstructions,
      imageCount: imageCount
    });

    // Hacer solicitud al servidor
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
    
    const data = await response.json();
    
    if (data.success) {
      showSuccess(`✅ Prompts generados: ${data.message}`);
      console.log('📝 Resultados:', data.data);
      
      // Mostrar detalles de prompts generados
      if (data.data.generatedPrompts && data.data.generatedPrompts.length > 0) {
        console.log('📝 Prompts generados para secciones:', data.data.generatedPrompts);
      }
      
    } else {
      throw new Error(data.error || 'Error desconocido generando prompts');
    }
    
  } catch (error) {
    console.error('❌ Error generando prompts:', error);
    showError(`Error generando prompts: ${error.message}`);
  } finally {
    // Restaurar botón
    const generateBtn = document.getElementById('generateMissingPromptsBtn');
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.innerHTML = `
        <i class="fas fa-file-text"></i>
        <span>Generar Prompts de Imágenes Faltantes</span>
      `;
    }
  }
}

// =====================================
// FUNCIONALIDAD COMFYUI CONTROLS
// =====================================

document.addEventListener('DOMContentLoaded', function() {
  console.log('🎯 DOM cargado - Inicializando controles ComfyUI...');
  
  // Esperar un poco para asegurar que todo esté cargado
  setTimeout(() => {
    initializeComfyUIControls();
    checkComfyUIStatus();
  }, 500);
});

// También agregar al final por si acaso
window.addEventListener('load', function() {
  console.log('🎯 Window cargado - Verificando controles ComfyUI...');
  if (!document.getElementById('comfyUIConfig')?.hasAttribute('data-initialized')) {
    initializeComfyUIControls();
  }
});

function initializeComfyUIControls() {
  console.log('🎨 Inicializando controles de ComfyUI...');
  
  // Toggle de configuración ComfyUI cuando se marque la casilla
  const localAICheckbox = document.getElementById('localAIImages');
  const comfyUIConfig = document.getElementById('comfyUIConfig');
  
  console.log('🔍 Elementos encontrados:', {
    localAICheckbox: !!localAICheckbox,
    comfyUIConfig: !!comfyUIConfig
  });
  
  if (localAICheckbox && comfyUIConfig) {
    // Marcar como inicializado
    comfyUIConfig.setAttribute('data-initialized', 'true');
    
    // Limpiar listeners previos
    localAICheckbox.removeEventListener('change', toggleComfyUIConfig);
    localAICheckbox.addEventListener('change', toggleComfyUIConfig);
    
    console.log('✅ Event listener agregado a checkbox localAIImages');
    
    // Verificar estado inicial
    if (localAICheckbox.checked) {
      comfyUIConfig.style.display = 'block';
      console.log('✅ Checkbox ya estaba marcado - mostrando controles');
    }
  } else {
    console.error('❌ No se encontraron elementos necesarios:', {
      localAICheckbox: localAICheckbox ? 'encontrado' : 'NO ENCONTRADO',
      comfyUIConfig: comfyUIConfig ? 'encontrado' : 'NO ENCONTRADO'
    });
  }

  // Controles de sliders con valores en tiempo real
  const stepsSlider = document.getElementById('comfyUISteps');
  const stepsValue = document.getElementById('stepsValue');
  const guidanceSlider = document.getElementById('comfyUIGuidance');
  const guidanceValue = document.getElementById('guidanceValue');
  const widthSlider = document.getElementById('comfyUIWidth');
  const widthValue = document.getElementById('widthValue');
  const heightSlider = document.getElementById('comfyUIHeight');
  const heightValue = document.getElementById('heightValue');

  if (stepsSlider && stepsValue) {
    stepsSlider.addEventListener('input', function() {
      stepsValue.textContent = this.value;
      console.log(`🔧 Pasos actualizados: ${this.value}`);
    });
  }

  if (guidanceSlider && guidanceValue) {
    guidanceSlider.addEventListener('input', function() {
      guidanceValue.textContent = this.value;
      console.log(`🧭 Guidance actualizados: ${this.value}`);
    });
  }

  if (widthSlider && widthValue) {
    widthSlider.addEventListener('input', function() {
      widthValue.textContent = this.value + 'px';
      console.log(`📐 Ancho actualizado: ${this.value}px`);
    });
  }

  if (heightSlider && heightValue) {
    heightSlider.addEventListener('input', function() {
      heightValue.textContent = this.value + 'px';
      console.log(`📏 Alto actualizado: ${this.value}px`);
    });
  }

  // Presets rápidos para diferentes calidades
  addQualityPresets();
}

// Función separada para el toggle
function toggleComfyUIConfig() {
  const comfyUIConfig = document.getElementById('comfyUIConfig');
  console.log('🎛️ Toggle ComfyUI ejecutado - checkbox checked:', this.checked);
  
  if (this.checked) {
    comfyUIConfig.style.display = 'block';
    console.log('✅ Controles ComfyUI mostrados');
    
    // Establecer valores por defecto: 15 pasos y 800px ancho (16:9)
    const stepsSlider = document.getElementById('comfyUISteps');
    const stepsValue = document.getElementById('stepsValue');
    const widthSlider = document.getElementById('comfyUIWidth');
    const widthValue = document.getElementById('widthValue');
    const heightSlider = document.getElementById('comfyUIHeight');
    const heightValue = document.getElementById('heightValue');
    
    if (stepsSlider && stepsValue) {
      stepsSlider.value = 15;
      stepsValue.textContent = '15';
    }
    
    if (widthSlider && widthValue) {
      const defaultWidth = 800;
      const defaultHeight = Math.round(defaultWidth / 16 * 9); // 450px
      
      widthSlider.value = defaultWidth;
      widthValue.textContent = defaultWidth + 'px';
      
      if (heightSlider && heightValue) {
        heightSlider.value = defaultHeight;
        heightValue.textContent = defaultHeight + 'px';
      }
      
      console.log('🎯 Valores por defecto establecidos: 15 pasos, ' + defaultWidth + 'x' + defaultHeight + ' (16:9)');
    }
  } else {
    comfyUIConfig.style.display = 'none';
    console.log('❌ Controles ComfyUI ocultados');
  }
}

function addQualityPresets() {
  // Agregar botones de presets si no existen
  const comfyUIConfig = document.getElementById('comfyUIConfig');
  if (!comfyUIConfig) return;

  // Crear sección de presets si no existe
  let presetsSection = document.getElementById('comfyUIPresets');
  if (!presetsSection) {
    presetsSection = document.createElement('div');
    presetsSection.id = 'comfyUIPresets';
    presetsSection.innerHTML = `
      <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(0, 255, 127, 0.2);">
        <h5 style="color: #00bfff; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
          <i class="fas fa-rocket"></i> Presets Rápidos
        </h5>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button class="preset-btn" onclick="applyComfyUIPreset('fast')" style="background: linear-gradient(145deg, #ff6b6b, #ee5a52); color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.8rem;">
            ⚡ Rápido
          </button>
          <button class="preset-btn" onclick="applyComfyUIPreset('balanced')" style="background: linear-gradient(145deg, #4ecdc4, #44a08d); color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.8rem;">
            ⚖️ Equilibrado
          </button>
          <button class="preset-btn" onclick="applyComfyUIPreset('quality')" style="background: linear-gradient(145deg, #45b7d1, #96c93d); color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.8rem;">
            🎨 Calidad
          </button>
        </div>
      </div>
    `;
    comfyUIConfig.appendChild(presetsSection);
  }
}

function applyComfyUIPreset(preset) {
  console.log(`🎯 Aplicando preset: ${preset}`);
  
  const stepsSlider = document.getElementById('comfyUISteps');
  const stepsValue = document.getElementById('stepsValue');
  const guidanceSlider = document.getElementById('comfyUIGuidance');
  const guidanceValue = document.getElementById('guidanceValue');
  const widthSlider = document.getElementById('comfyUIWidth');
  const widthValue = document.getElementById('widthValue');
  const heightSlider = document.getElementById('comfyUIHeight');
  const heightValue = document.getElementById('heightValue');

  switch(preset) {
    case 'fast':
      if (stepsSlider) { stepsSlider.value = 10; stepsValue.textContent = '10'; }
      if (guidanceSlider) { guidanceSlider.value = 2.5; guidanceValue.textContent = '2.5'; }
      if (widthSlider) { widthSlider.value = 1024; widthValue.textContent = '1024px'; }
      if (heightSlider) { heightSlider.value = 720; heightValue.textContent = '720px'; }
      break;
    case 'balanced':
      if (stepsSlider) { stepsSlider.value = 25; stepsValue.textContent = '25'; }
      if (guidanceSlider) { guidanceSlider.value = 3.5; guidanceValue.textContent = '3.5'; }
      if (widthSlider) { widthSlider.value = 1280; widthValue.textContent = '1280px'; }
      if (heightSlider) { heightSlider.value = 720; heightValue.textContent = '720px'; }
      break;
    case 'quality':
      if (stepsSlider) { stepsSlider.value = 40; stepsValue.textContent = '40'; }
      if (guidanceSlider) { guidanceSlider.value = 4.5; guidanceValue.textContent = '4.5'; }
      if (widthSlider) { widthSlider.value = 1536; widthValue.textContent = '1536px'; }
      if (heightSlider) { heightSlider.value = 1024; heightValue.textContent = '1024px'; }
      break;
  }
  
  console.log(`✅ Preset ${preset} aplicado`);
}

async function checkComfyUIStatus() {
  const statusElement = document.getElementById('comfyUIStatus');
  const statusIcon = statusElement?.querySelector('.status-icon');
  const statusText = statusElement?.querySelector('.status-text');
  
  if (!statusElement) return;
  
  try {
    // Actualizar a estado "verificando"
    statusIcon.className = 'fas fa-circle status-icon checking';
    statusText.textContent = 'Verificando conexión con ComfyUI...';
    
    const response = await fetch('/comfyui-status');
    const data = await response.json();
    
    if (data.success && data.connected) {
      statusIcon.className = 'fas fa-circle status-icon connected';
      statusText.textContent = `✅ ComfyUI conectado - ${data.models.length} modelos${data.fluxAvailable ? ' (Flux disponible)' : ''}`;
      console.log('🟢 ComfyUI conectado exitosamente');
    } else {
      statusIcon.className = 'fas fa-circle status-icon disconnected';
      statusText.textContent = `❌ ComfyUI desconectado: ${data.error || 'Error desconocido'}`;
      console.warn('🔴 ComfyUI no disponible:', data.error);
    }
  } catch (error) {
    statusIcon.className = 'fas fa-circle status-icon disconnected';
    statusText.textContent = '❌ Error verificando ComfyUI - ¿Está ejecutándose?';
    console.error('🔴 Error verificando ComfyUI:', error);
  }
}

function getComfyUISettings() {
  return {
    steps: document.getElementById('comfyUISteps')?.value || 25,
    guidance: document.getElementById('comfyUIGuidance')?.value || 3.5,
    width: document.getElementById('comfyUIWidth')?.value || 1280,
    height: document.getElementById('comfyUIHeight')?.value || 720,
    sampler: document.getElementById('comfyUISampler')?.value || 'euler',
    scheduler: document.getElementById('comfyUIScheduler')?.value || 'simple',
    negativePrompt: document.getElementById('comfyUINegativePrompt')?.value || 'low quality, blurry, distorted'
  };
}

// Exponer funciones globalmente
window.generateProjectVideo = generateProjectVideo;
window.generateVideoAutomatically = generateVideoAutomatically;
window.showVideoGenerationButton = showVideoGenerationButton;
window.regenerateAllApplioAudios = regenerateAllApplioAudios;
window.applyComfyUIPreset = applyComfyUIPreset;
window.checkComfyUIStatus = checkComfyUIStatus;
window.getComfyUISettings = getComfyUISettings;
window.initializeComfyUIControls = initializeComfyUIControls;
window.toggleComfyUIConfig = toggleComfyUIConfig;

// Exponer funciones de la barra de progreso globalmente
window.showProgressBar = showProgressBar;
window.hideProgressBar = hideProgressBar;
window.updateProgressBar = updateProgressBar;
window.resetProgressBar = resetProgressBar;
window.completeProgressBar = completeProgressBar;
window.showProgressError = showProgressError;
window.startElapsedTimeCounter = startElapsedTimeCounter;
window.startProgressPolling = startProgressPolling;
window.stopProgressPolling = stopProgressPolling;

// Validación para campos de palabras por sección
document.addEventListener('DOMContentLoaded', function() {
  const minWordsInput = document.getElementById('minWords');
  const maxWordsInput = document.getElementById('maxWords');
  
  if (minWordsInput && maxWordsInput) {
    // Validar campo mínimo
    minWordsInput.addEventListener('input', function() {
      let minValue = parseInt(this.value);
      let maxValue = parseInt(maxWordsInput.value);
      
      
      // Si mínimo es mayor que máximo, ajustar máximo
      if (maxValue && minValue > maxValue) {
        maxWordsInput.value = minValue + 100;
      }
    });
    
    // Validar campo máximo
    maxWordsInput.addEventListener('input', function() {
      let maxValue = parseInt(this.value);
      let minValue = parseInt(minWordsInput.value);
      
    });
    
    console.log('✅ Validación de palabras por sección configurada');
  }
});
