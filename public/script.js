// Función simple para verificar que el script se carga
console.log('🚀 Script.js cargado correctamente');

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
    'createStyleBtn': document.getElementById('createStyleBtn'),
    'manageStylesBtn': document.getElementById('manageStylesBtn'),
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
let allSections = []; // Almacenar todas las secciones generadas (solo texto del guión)
let imagePrompts = []; // Almacenar los prompts de las imágenes
let isAutoGenerating = false; // Bandera para la generación automática

// Función para la generación automática completa
async function runAutoGeneration() {
  console.log("🤖 Iniciando generación automática completa");
  isAutoGenerating = true;
  
  const topic = promptInput.value.trim();
  const folderName = document.getElementById("folderName").value.trim();
  const selectedVoice = document.getElementById("voiceSelect").value;
  const selectedSections = document.getElementById("sectionsSelect").value;
  const selectedStyle = document.getElementById("styleSelect").value;
  const imageCount = parseInt(document.getElementById("imagesSelect").value);
  const promptModifier = document.getElementById("promptModifier").value.trim();
  const selectedImageModel = document.getElementById("modelSelect").value;
  const skipImages = document.getElementById("skipImages").checked;
  const generateAudio = document.getElementById("autoGenerateAudio").checked;
  const generateApplioAudio = document.getElementById("autoGenerateApplioAudio").checked;
  
  console.log(`🔊 Generación de audio Google: ${generateAudio ? 'ACTIVADA' : 'DESACTIVADA'}`);
  console.log(`🎤 Generación de audio Applio: ${generateApplioAudio ? 'ACTIVADA' : 'DESACTIVADA'}`);
  
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
    // Generar todas las secciones una por una
    for (let section = 1; section <= totalSections; section++) {
      console.log(`🤖 Generando sección ${section} de ${totalSections}`);
      
      // Actualizar UI para mostrar la sección actual
      updateGenerationProgress(section, totalSections, 'script');
      
      // Generar guión e imágenes
      const scriptResult = await generateSectionContent(section, {
        topic, folderName, selectedVoice, selectedStyle, 
        imageCount, promptModifier, selectedImageModel, skipImages
      });
      
      if (!scriptResult.success) {
        throw new Error(scriptResult.error || `Error generando sección ${section}`);
      }
      
      // Mostrar contenido generado
      await displaySectionContent(scriptResult.data, section);
      
      // Generar audio automáticamente si alguna opción está activada
      if (generateAudio || generateApplioAudio) {
        const audioMethod = generateApplioAudio ? 'Applio' : 'Google';
        console.log(`🤖 Generando audio con ${audioMethod} para sección ${section}`);
        console.log(`🔍 DEBUG: generateAudio=${generateAudio}, generateApplioAudio=${generateApplioAudio}`);
        updateGenerationProgress(section, totalSections, 'audio');
        
        let audioResult;
        if (generateApplioAudio) {
          // Usar Applio para generar audio
          console.log(`🎤 Llamando a generateSectionApplioAudio(${section})`);
          audioResult = await generateSectionApplioAudio(section);
        } else {
          // Usar Google TTS
          console.log(`🔊 Llamando a generateSectionAudio(${section}, ${selectedVoice})`);
          audioResult = await generateSectionAudio(section, selectedVoice);
        }
        
        console.log(`🔍 DEBUG: audioResult =`, audioResult);
        
        if (!audioResult || !audioResult.success) {
          console.warn(`⚠️ Error generando audio con ${audioMethod} para sección ${section}:`, audioResult?.error || 'audioResult es undefined');
          // Continúa con la siguiente sección aunque falle el audio
        } else {
          console.log(`✅ Audio generado exitosamente con ${audioMethod} para sección ${section}`);
        }
      } else {
        console.log(`⏭️ Omitiendo generación de audio para sección ${section} (ninguna opción de audio activada)`);
      }
      
      // Pequeña pausa entre secciones
      if (section < totalSections) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log("🎉 Generación automática completada exitosamente!");
    showAutoGenerationComplete();
    
  } catch (error) {
    console.error("❌ Error durante generación automática:", error);
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
        skipImages: params.skipImages,
        allSections: allSections
      })
    });

    const data = await response.json();
    
    if (data.script) {
      // Guardar la sección en el historial
      allSections.push(data.script);
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
    
    const response = await fetch("/generate-section-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: allSections[section - 1], // Usar el guión de la sección actual
        topic: currentTopic,
        folderName: document.getElementById("folderName").value.trim(),
        currentSection: section,
        voice: "fr-FR-RemyMultilingualNeural" // Voz fija de Applio
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
    
    const response = await fetch("/generate-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voice: voice,
        currentSection: section,
        topic: currentTopic,
        folderName: document.getElementById("folderName").value.trim(),
        script: allSections[section - 1], // Usar el guión de la sección actual
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
    // Mostrar guión
    showScript(data.script, section, totalSections, data.voice, data.scriptFile);
    
    setTimeout(() => {
      if (!document.getElementById("skipImages").checked && data.images && data.images.length > 0) {
        // Mostrar carrusel de imágenes
        createCarousel(data.images, section, data.imagePrompts);
      } else if (data.imagePrompts && data.imagePrompts.length > 0) {
        // Mostrar prompts de imágenes en el panel lateral
        addPromptsToSidebar(data.imagePrompts, section);
      }
      resolve();
    }, 500);
  });
}

// Función para actualizar el progreso de generación automática
function updateGenerationProgress(section, total, phase) {
  const phaseText = phase === 'script' ? 'Generando guión e imágenes' : 'Generando audio';
  
  generateBtn.innerHTML = `
    <i class="fas fa-magic"></i>
    <span>Auto: Sección ${section}/${total} - ${phaseText}...</span>
  `;
  
  // Actualizar etapas de carga
  if (phase === 'script') {
    showLoadingStages(section, parseInt(document.getElementById("imagesSelect").value), document.getElementById("skipImages").checked);
  } else {
    showAudioGenerationStage(section);
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
    'prompt', 'folderName', 'voiceSelect', 'sectionsSelect', 
    'styleSelect', 'imagesSelect', 'promptModifier', 'modelSelect', 
    'skipImages', 'autoGenerate', 'autoGenerateAudio', 'autoGenerateApplioAudio'
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
}

// Función para mostrar mensaje de carga con etapas
function showLoadingStages(sectionNum, imageCount = 5, skipImages = false) {
  const imageStagesHTML = skipImages ? '' : `
    <div class="stage" id="stage-prompt">
      <div class="stage-icon"><i class="fas fa-brain"></i></div>
      <div class="stage-text">Creando secuencia visual...</div>
    </div>
    <div class="stage" id="stage-image">
      <div class="stage-icon"><i class="fas fa-images"></i></div>
      <div class="stage-text">Generando ${imageCount} imágenes gaming...</div>
    </div>
  `;
  
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
  const icon = stage.querySelector('.stage-icon i');
  
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
  const carouselContainer = document.getElementById("carousel-container");
  const carouselTrack = document.getElementById("carouselTrack");
  const carouselIndicators = document.getElementById("carouselIndicators");
  const currentImageSpan = document.getElementById("current-image");
  const totalImagesSpan = document.getElementById("total-images");
  const carouselSectionTitle = document.getElementById("carousel-section-title");
  
  // Limpiar contenido anterior
  carouselTrack.innerHTML = '';
  carouselIndicators.innerHTML = '';
  
  totalSlides = images.length;
  currentSlide = 0;
  
  // Guardar los prompts de las imágenes - manejar múltiples variaciones
  imagePrompts = images.map((img, index) => {
    if (img.prompt) {
      return img.prompt;
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
    img.src = "data:image/png;base64," + imageData.image;
    img.alt = `Imagen ${index + 1} de la Sección ${sectionNum}`;
    img.style.opacity = "0";
    img.style.transition = "opacity 0.5s ease";
    
    imageContainer.appendChild(img);
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
  carouselContainer.style.display = "block";
  
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
    const selectedImageModel = document.getElementById("modelSelect").value;
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
function showScript(script, sectionNum, totalSections, voiceUsed = null, scriptFileInfo = null) {
  const scriptSection = document.getElementById("script-section");
  const scriptContent = document.getElementById("script-content");
  const audioControls = document.getElementById("audio-controls");
  const sectionTitle = document.getElementById("section-title");
  const currentSectionSpan = document.getElementById("current-section");
  const totalSectionsSpan = document.getElementById("total-sections");
  
  currentScript = script;
  currentVoice = voiceUsed || document.getElementById("voiceSelect").value;
  currentSectionNumber = sectionNum;
  
  // Guardar la sección en el array de secciones
  allSections[sectionNum - 1] = script;
  
  console.log(`Guardando sección ${sectionNum}:`, script.substring(0, 100) + '...');
  
  // Actualizar títulos y contadores
  sectionTitle.textContent = `Sección ${sectionNum}`;
  currentSectionSpan.textContent = sectionNum;
  totalSectionsSpan.textContent = totalSections;
  
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
  // Obtener el script de la sección actual que se está mostrando
  const scriptText = allSections[currentSectionNumber - 1];
  
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
      </div>
    `;
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
  console.log("Botón clickeado");
  
  // Verificar si la generación automática está activada
  const autoGenerate = document.getElementById("autoGenerate").checked;
  
  if (autoGenerate) {
    console.log("🤖 Iniciando generación automática");
    await runAutoGeneration();
    return;
  }
  
  // Continuar con la generación normal
  const topic = promptInput.value.trim();
  const folderName = document.getElementById("folderName").value.trim();
  const selectedVoice = document.getElementById("voiceSelect").value;
  const selectedSections = document.getElementById("sectionsSelect").value;
  const selectedStyle = document.getElementById("styleSelect").value;
  const imageCount = parseInt(document.getElementById("imagesSelect").value);
  const promptModifier = document.getElementById("promptModifier").value.trim();
  const selectedImageModel = document.getElementById("modelSelect").value;
  const skipImages = document.getElementById("skipImages").checked;
  
  console.log("Topic:", topic);
  console.log("Folder Name:", folderName);
  console.log("Voice:", selectedVoice);
  console.log("Sections:", selectedSections);
  console.log("Style:", selectedStyle);
  console.log("Images:", imageCount);
  console.log("Prompt Modifier:", promptModifier);
  console.log("Image Model:", selectedImageModel);
  console.log("Skip Images:", skipImages);
  
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
  
  showLoadingStages(1, imageCount, skipImages);

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
        scriptStyle: selectedStyle,
        customStyleInstructions: customStyleInstructions,
        imageCount: imageCount,
        promptModifier: promptModifier,
        imageModel: selectedImageModel,
        skipImages: skipImages
      })
    });

    const data = await response.json();

    if (data.script) {
      // Actualizar etapas completadas
      updateStage('stage-script', 'completed');
      
      if (!skipImages && data.images && data.images.length > 0) {
        // Con imágenes
        updateStage('stage-prompt', 'completed');
        updateStage('stage-image', 'completed');
        
        // Mostrar guión primero
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile);
        }, 500);
        
        // Mostrar carrusel de imágenes
        setTimeout(() => {
          createCarousel(data.images, data.currentSection, data.imagePrompts);
        }, 1000);
      } else {
        // Sin imágenes (omitidas)
        // Mostrar solo el guión
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile);
          // Ocultar el carrusel de imágenes
          document.getElementById("carousel-container").style.display = "none";
          
          // Mostrar prompts de imágenes si están disponibles
          console.log(`🔍 DEBUG FRONTEND - Verificando prompts de imágenes...`);
          console.log(`🔍 DEBUG FRONTEND - data.imagePrompts:`, data.imagePrompts);
          console.log(`🔍 DEBUG FRONTEND - data.imagePrompts existe:`, !!data.imagePrompts);
          console.log(`🔍 DEBUG FRONTEND - data.imagePrompts.length:`, data.imagePrompts ? data.imagePrompts.length : 'undefined');
          console.log(`🔍 DEBUG FRONTEND - data.imagesSkipped:`, data.imagesSkipped);
          
          if (data.imagePrompts && data.imagePrompts.length > 0) {
            console.log(`✅ DEBUG FRONTEND - Añadiendo ${data.imagePrompts.length} prompts al panel lateral`);
            addPromptsToSidebar(data.imagePrompts, data.currentSection);
          } else {
            console.log(`❌ DEBUG FRONTEND - No se encontraron prompts de imágenes válidos`);
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
  if (!currentTopic || currentSectionNumber >= totalSections) {
    showError("No se puede continuar. Genera primero una sección o ya has completado todas las secciones.");
    return;
  }

  const nextSection = currentSectionNumber + 1;
  const imageCount = parseInt(document.getElementById("imagesSelect").value);
  const folderName = document.getElementById("folderName").value.trim();
  const selectedStyle = document.getElementById("styleSelect").value;
  const promptModifier = document.getElementById("promptModifier").value.trim();
  const selectedImageModel = document.getElementById("modelSelect").value;
  
  // Deshabilitar botón y mostrar estado de carga
  continueBtn.disabled = true;
  continueBtn.innerHTML = `
    <i class="fas fa-spinner loading"></i>
    <span>Generando Sección ${nextSection}...</span>
  `;
  
  generateAudioBtn.style.display = "none";
  
  showLoadingStages(nextSection, imageCount, skipImages);

  try {
    console.log(`Enviando llamada API para sección ${nextSection}`);
    const skipImages = document.getElementById("skipImages").checked;
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
        promptModifier: promptModifier,
        imageModel: selectedImageModel,
        skipImages: skipImages
      })
    });

    const data = await response.json();

    if (data.script) {
      // Actualizar etapas completadas
      updateStage('stage-script', 'completed');
      
      if (!skipImages && data.images && data.images.length > 0) {
        // Con imágenes
        updateStage('stage-prompt', 'completed');
        updateStage('stage-image', 'completed');
        
        // Actualizar número de sección actual
        currentSectionNumber = data.currentSection;
        
        // Mostrar guión de la nueva sección
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile);
        }, 500);
        
        // Mostrar carrusel de imágenes
        setTimeout(() => {
          createCarousel(data.images, data.currentSection, data.imagePrompts);
        }, 1000);
      } else {
        // Sin imágenes (omitidas)
        // Actualizar número de sección actual
        currentSectionNumber = data.currentSection;
        
        // Mostrar solo el guión
        setTimeout(() => {
          showScript(data.script, data.currentSection, data.totalSections, data.voice, data.scriptFile);
          // Ocultar el carrusel de imágenes
          document.getElementById("carousel-container").style.display = "none";
          
          // Mostrar prompts de imágenes en el panel lateral
          if (data.imagePrompts && data.imagePrompts.length > 0) {
            addPromptsToSidebar(data.imagePrompts, data.currentSection);
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

// Manejar checkbox de omitir imágenes
document.getElementById("skipImages").addEventListener("change", function() {
  const imageRelatedFields = [
    // Solo deshabilitar el selector de modelo, no el de cantidad de imágenes
    document.getElementById("modelSelect").closest('.model-selector-container')
    // El selector de cantidad de imágenes sigue siendo útil para determinar cuántos prompts mostrar
  ];
  
  const isChecked = this.checked;
  
  // Actualizar campos relacionados solo con la generación de imágenes
  imageRelatedFields.forEach(field => {
    if (field) {
      if (isChecked) {
        field.style.opacity = "0.5";
        field.style.pointerEvents = "none";
        field.style.transition = "opacity 0.3s ease";
      } else {
        field.style.opacity = "1";
        field.style.pointerEvents = "auto";
      }
    }
  });
  
  // Manejar el selector de cantidad de imágenes de manera especial (siempre habilitado)
  const imagesSelectContainer = document.getElementById("imagesSelect").closest('.images-selector-container');
  if (imagesSelectContainer) {
    if (isChecked) {
      // Solo atenuar ligeramente pero mantener habilitado
      imagesSelectContainer.style.opacity = "0.8";
      imagesSelectContainer.style.pointerEvents = "auto";
      imagesSelectContainer.style.transition = "opacity 0.3s ease";
      
      // Actualizar etiqueta para clarificar su propósito
      const label = imagesSelectContainer.querySelector('.images-label');
      if (label) {
        label.innerHTML = '<i class="fas fa-images"></i> Cantidad de Prompts:';
      }
    } else {
      imagesSelectContainer.style.opacity = "1";
      imagesSelectContainer.style.pointerEvents = "auto";
      
      // Restaurar etiqueta original
      const label = imagesSelectContainer.querySelector('.images-label');
      if (label) {
        label.innerHTML = '<i class="fas fa-images"></i> Cantidad de Imágenes:';
      }
    }
  }
  
  // Manejar el campo de instrucciones adicionales de manera especial
  const promptModifierContainer = document.getElementById("promptModifier").closest('.prompt-modifier-container');
  if (promptModifierContainer) {
    if (isChecked) {
      // Solo atenuar ligeramente y actualizar el texto de ayuda
      promptModifierContainer.style.opacity = "0.8";
      promptModifierContainer.style.pointerEvents = "auto"; // Mantener habilitado
      promptModifierContainer.style.transition = "opacity 0.3s ease";
      
      // Actualizar el texto de ayuda
      const helpText = promptModifierContainer.querySelector('.prompt-modifier-help span');
      if (helpText) {
        helpText.textContent = "Estas instrucciones se aplicarán a los prompts de imágenes mostrados";
      }
    } else {
      promptModifierContainer.style.opacity = "1";
      promptModifierContainer.style.pointerEvents = "auto";
      
      // Restaurar el texto de ayuda original
      const helpText = promptModifierContainer.querySelector('.prompt-modifier-help span');
      if (helpText) {
        helpText.textContent = "Estas instrucciones se aplicarán a todas las imágenes generadas";
      }
    }
  }
  
  // Actualizar texto del botón
  const generateBtnText = generateBtn.querySelector('span');
  const continueBtnText = continueBtn.querySelector('span');
  
  if (isChecked) {
    if (generateBtnText) generateBtnText.textContent = "Generar Guión Sección 1";
    if (continueBtnText) continueBtnText.textContent = `Continuar con Guión Sección ${currentSectionNumber + 1}`;
  } else {
    if (generateBtnText) generateBtnText.textContent = "Generar Sección 1";
    if (continueBtnText) continueBtnText.textContent = `Continuar con Sección ${currentSectionNumber + 1}`;
  }
});

// Inicializar el estado de la casilla de omitir imágenes al cargar la página
document.addEventListener('DOMContentLoaded', function() {
  // Simular el evento change para aplicar el estado inicial
  const skipImagesCheckbox = document.getElementById("skipImages");
  if (skipImagesCheckbox && skipImagesCheckbox.checked) {
    skipImagesCheckbox.dispatchEvent(new Event('change'));
  }
});

// Función para mostrar prompts de imágenes cuando se omiten las imágenes
// COMENTADA: Ya no se usa porque ahora se usa el panel lateral
/*
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
*/

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
  
  const autoGenerateCheckbox = document.getElementById('autoGenerate');
  const autoGenerateAudioCheckbox = document.getElementById('autoGenerateAudio');
  const autoAudioContainer = document.querySelector('.auto-audio-container');
  
  // Verificar si los elementos de audio existen
  if (autoGenerateCheckbox && autoGenerateAudioCheckbox && autoAudioContainer) {
    // Inicialmente deshabilitar la casilla de audio
    autoGenerateAudioCheckbox.disabled = true;
    autoAudioContainer.style.opacity = '0.5';
    
    autoGenerateCheckbox.addEventListener('change', function() {
      if (this.checked) {
        // Habilitar la casilla de audio cuando se active la generación automática
        autoGenerateAudioCheckbox.disabled = false;
        autoAudioContainer.style.opacity = '1';
        console.log('🔊 Casilla de audio habilitada');
      } else {
        // Deshabilitar y desmarcar la casilla de audio cuando se desactive la generación automática
        autoGenerateAudioCheckbox.disabled = true;
        autoGenerateAudioCheckbox.checked = false;
        autoAudioContainer.style.opacity = '0.5';
        console.log('🔇 Casilla de audio deshabilitada');
      }
    });
  } else {
    console.log('⚠️ Algunos elementos de audio no encontrados (diseño compacto)');
  }
  
  // Inicializar sistema de estilos personalizados
  console.log('🎨 A punto de inicializar estilos...');
  initCustomStyles();
  
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
    console.log('✅ Sistema de estilos inicializado correctamente');
  }, 100);
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
  const sidebar = document.getElementById('sidebar');
  const body = document.body;
  
  if (sidebar && body) {
    sidebar.classList.toggle('expanded');
    body.classList.toggle('sidebar-expanded');
    
    const isExpanded = sidebar.classList.contains('expanded');
    console.log(`🎯 Barra lateral ${isExpanded ? 'expandida' : 'colapsada'}`);
  }
}

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
  if (menuToggleBtn) {
    menuToggleBtn.addEventListener('click', toggleSidebar);
    console.log('✅ Event listener del botón menú configurado');
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

// Función para añadir prompts al panel lateral
function addPromptsToSidebar(prompts, sectionNumber) {
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
    // Almacenar en el array global
    allAccumulatedPrompts.push({
      text: prompt.trim(),
      section: sectionNumber,
      imageNumber: index + 1
    });
    
    const promptItem = createPromptItem(prompt.trim(), sectionNumber, index + 1);
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

// Función para crear un item de prompt individual
function createPromptItem(promptText, sectionNumber, imageNumber) {
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
  
  // Event listener para copiar
  copyBtn.addEventListener('click', async function(e) {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(promptText);
      
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
      textArea.value = promptText;
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
  textElement.textContent = promptText;
  
  // Añadir botón de expandir si el texto es largo
  if (promptText.length > 150) {
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
  
  const script = allSections[sectionNum - 1];
  const sectionTitle = document.getElementById("section-title");
  const currentSectionSpan = document.getElementById("current-section");
  const scriptContent = document.getElementById("script-content");
  
  if (!sectionTitle || !currentSectionSpan || !scriptContent) {
    console.log('❌ Elementos DOM no encontrados');
    return;
  }
  
  // Actualizar número de sección actual
  currentSectionNumber = sectionNum;
  
  // Actualizar títulos y contadores
  sectionTitle.textContent = `Sección ${sectionNum}`;
  currentSectionSpan.textContent = sectionNum;
  
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
        folderName: folderName
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
    <div class="youtube-metadata-header">
      <h2><i class="fas fa-youtube"></i> Metadata para YouTube</h2>
      <p class="metadata-topic">Tema: <strong>${topic}</strong></p>
    </div>
    
    <div class="metadata-section">
      <h3><i class="fas fa-fire"></i> Títulos Clickbait</h3>
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
    
    <div class="metadata-section">
      <h3><i class="fas fa-file-text"></i> Descripción SEO</h3>
      <div class="description-container">
        <textarea class="description-text" readonly>${sections.description}</textarea>
        <button class="copy-btn-large" onclick="copyToClipboard(\`${sections.description.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">
          <i class="fas fa-copy"></i> Copiar Descripción
        </button>
      </div>
    </div>
    
    <div class="metadata-section">
      <h3><i class="fas fa-tags"></i> Etiquetas (25)</h3>
      <div class="tags-container">
        <div class="tags-display">
          ${sections.tags.map(tag => `<span class="tag-item">${tag}</span>`).join('')}
        </div>
        <button class="copy-btn-large" onclick="copyToClipboard('${sections.tagsString.replace(/'/g, "\\'")}')">
          <i class="fas fa-copy"></i> Copiar Etiquetas
        </button>
      </div>
    </div>
    
    <div class="metadata-section">
      <h3><i class="fas fa-image"></i> Prompts para Miniaturas (5)</h3>
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
    
    <div class="metadata-actions">
      <button class="btn btn-primary" onclick="downloadYouTubeMetadata('${topic}', \`${metadata.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">
        <i class="fas fa-download"></i> Descargar Metadata
      </button>
    </div>
  `;
  
  output.appendChild(metadataContainer);
  
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
