document.addEventListener('DOMContentLoaded', () => {
    console.log('Video Translator Loaded');

// --- Persistent State DB System ---
window.InitTranslatorDB = function() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('TranslatorCacheDB', 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('files')) {
                db.createObjectStore('files');
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
};

window.saveToDB = async function(storeName, key, value) {
    // 🔴 RESTRICCIÓN: Solo guardaremos textos en cache, evitamos audios/videos pesados.
    if (key !== 'textMarkersInput') return;
    
    try {
        const db = await window.InitTranslatorDB();
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        return tx.complete;
    } catch(e) { console.error('DB Save error', e); }
};

window.getFromDB = async function(storeName, key) {
    try {
        const db = await window.InitTranslatorDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    } catch(e) { console.error('DB Get error', e); }
};

window.saveTimestampsState = function() {
    const inputs = Array.from(document.querySelectorAll('.promoTimeInput')).map(i => i.value);
    console.warn('SETTING TIMESTAMPS CACHE: ', JSON.stringify(inputs), new Error().stack); localStorage.setItem('vt_timestamps', JSON.stringify(inputs));
};

window.loadTimestampsState = function() { console.log('LOADING TIMESTAMPS: ', localStorage.getItem('vt_timestamps')); 
    try {
        const inputs = JSON.parse(localStorage.getItem('vt_timestamps') || '[]');
        if (inputs.length === 0) return;
        
        const container = document.getElementById('promoMarkersContainer');
        container.innerHTML = '';
        
        inputs.forEach(timeStr => {
            const div = document.createElement('div');
            div.className = 'promo-marker-row';
            div.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-top: 5px;';
            div.innerHTML = `
                 <input type="text" class="promoTimeInput" value="${timeStr}" placeholder="Min:Seg (ej: 01:00)" 
                        style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 6px 10px; border-radius: 4px; flex: 1; text-align: center;">
                 <button class="remove-marker-btn" type="button" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 4px; padding: 6px 10px; cursor: pointer;">
                     <i class="fas fa-trash"></i>
                 </button>
            `;
            
            // Setup events
            div.querySelector('.promoTimeInput').addEventListener('input', (e) => {
                let value = e.target.value.replace(/\D/g, '');
                if (value.length > 4) value = value.slice(0, 4);
                if (value.length > 2) value = value.slice(0, 2) + ':' + value.slice(2);
                e.target.value = value;
                window.saveTimestampsState();
            });
            
            div.querySelector('.remove-marker-btn').onclick = () => { div.remove(); window.saveTimestampsState(); };
            container.appendChild(div);
        });
    } catch(e) { console.error('Error loading timestamps', e); }
};

window.restoreFilesState = async function() {
    try {
        const idsToRestore = ['textMarkersInput']; // 🔴 Solo restauramos TXTs

        for (const inputId of idsToRestore) {
            const files = await window.getFromDB('files', inputId);
            if (files && files.length > 0) {
                const input = document.getElementById(inputId);
                if (input) {
                    const dt = new DataTransfer();
                    for(let i=0; i<files.length; i++) {
                        dt.items.add(new File([files[i]], files[i].name, {type: files[i].type, lastModified: files[i].lastModified}));
                    }
                    input.files = dt.files;
                    
                    // Dispatch change to trigger validation UI
                    if(inputId === 'textMarkersInput' || inputId === 'audioMarkersInput') {
                         input.dispatchEvent(new Event('change'));
                    } else {
                         // Call custom validate handler logic directly for simple dropzones
                         const dropZoneId = inputId === 'videoUpload' ? 'videoDropZone' : 
                                            inputId === 'musicUpload' ? 'musicDropZone' : null; // simplified logic below
                         const displayId = inputId === 'videoUpload' ? 'videoFileName' : 
                                           inputId === 'musicUpload' ? 'musicFileName' : 
                                           inputId === 'videoUploadManual' ? 'fileName_manual_video' :
                                           inputId === 'musicUploadManual' ? 'fileName_manual_music' :
                                           inputId.startsWith('manual_audio_') ? inputId.replace('manual_audio_', 'fileName_manual_') : null;
                         if (displayId) {
                             const display = document.getElementById(displayId);
                             if (display) display.textContent = files[0].name;
                         }
                    }
                }
            }
        }
    } catch(e) { console.error('Error restoring files', e); }
};


    window.loadTimestampsState();
    window.restoreFilesState();


    // Inicializar estado
    window.switchTab('auto');
    window.toggleVoiceSelect();
    loadApplioVoices();
    loadPreferences();

    // Setup Dropzones for Auto Mode
    setupDropZone('videoDropZone', 'videoUpload', 'videoFileName', 'video', () => updateGenerateButton());
    setupDropZone('musicDropZone', 'musicUpload', 'musicFileName', 'audio');

    // Setup Dropzones for Manual Mode
    setupDropZone('dropZone_manual_video', 'videoUploadManual', 'fileName_manual_video', 'video', () => updateGenerateButton());
    setupDropZone('dropZone_manual_music', 'musicUploadManual', 'fileName_manual_music', 'audio');

    ['es', 'en', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ko', 'ja'].forEach(lang => {
        setupDropZone(`dropZone_manual_${lang}`, `manual_audio_${lang}`, `fileName_manual_${lang}`, 'audio', () => updateGenerateButton());
    });

    // Setup Generate Button
    const generateBtn = document.getElementById('generateTranslatedVideoBtn');
    if (generateBtn) {
        generateBtn.addEventListener('click', () => window.startVideoTranslation());
    }

    // Setup Close/Cancel Button
    const cancelBtn = document.getElementById('cancelTranslateVideoBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
             if(confirm('¿Deseas cerrar esta página?')) {
                 window.close();
             }
        });
    }

    // Setup Promo Markers
    const addMarkerBtn = document.getElementById('addPromoMarkerBtn');
    const markersContainer = document.getElementById('promoMarkersContainer');

    function setupPromoInput(input) {
        input.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, ''); // Solo números
            if (value.length > 4) value = value.slice(0, 4); // Max 4 dígitos
            
            if (value.length > 2) {
                value = value.slice(0, 2) + ':' + value.slice(2);
            }
            e.target.value = value;
            window.saveTimestampsState(); // 🔴 Siempre guardar al teclear
            console.log('SAVING TIMESTAMPS: ', localStorage.getItem('vt_timestamps'));
        });
    }

    // Inicializar inputs existentes
    if (markersContainer) {
        markersContainer.querySelectorAll('.promoTimeInput').forEach(setupPromoInput);
    }

    if (addMarkerBtn) {
        addMarkerBtn.addEventListener('click', (e) => {
             e.preventDefault();
             const container = document.getElementById('promoMarkersContainer');
             const div = document.createElement('div');
             div.className = 'promo-marker-row';
             div.style.cssText = 'display: flex; gap: 8px; align-items: center;';
             div.innerHTML = `
                  <input type="text" class="promoTimeInput" placeholder="Min:Seg (ej: 01:00)" 
                         style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 6px 10px; border-radius: 4px; flex: 1; text-align: center;">
                  <button class="remove-marker-btn" type="button" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 4px; padding: 6px 10px; cursor: pointer;">
                      <i class="fas fa-trash"></i>
                  </button>
             `;
             
             // Configurar el nuevo input
             setupPromoInput(div.querySelector('.promoTimeInput'));
             
             div.querySelector('.remove-marker-btn').onclick = () => { div.remove(); window.saveTimestampsState(); };
             container.appendChild(div);
             window.saveTimestampsState();
        });
    }

    const addMinuteBtn = document.getElementById('addMinuteMarkerBtn');
    let nextMinute = 1;

    if (addMinuteBtn) {
        addMinuteBtn.addEventListener('click', (e) => {
             e.preventDefault();
             const container = document.getElementById('promoMarkersContainer');
             
             // Format time
             const timeStr = `${nextMinute.toString().padStart(2, '0')}:00`;
             nextMinute++;

             const div = document.createElement('div');
             div.className = 'promo-marker-row';
             div.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-top: 5px;';
             div.innerHTML = `
                  <input type="text" class="promoTimeInput" value="${timeStr}" placeholder="Min:Seg (ej: 01:00)" 
                         style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 6px 10px; border-radius: 4px; flex: 1; text-align: center;">
                  <button class="remove-marker-btn" type="button" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 4px; padding: 6px 10px; cursor: pointer;">
                      <i class="fas fa-trash"></i>
                  </button>
             `;
             
             // Configure new input
             setupPromoInput(div.querySelector('.promoTimeInput'));
             
             div.querySelector('.remove-marker-btn').onclick = () => { div.remove(); window.saveTimestampsState(); };
             container.appendChild(div);
             window.saveTimestampsState();
        });
    }

    // Setup Text Markers Drag and Drop
      const textDropzone = document.getElementById('textMarkersDropzone');
      const textInput = document.getElementById('textMarkersInput');
      const browseTextBtn = document.getElementById('browseTextMarkersBtn');
      const clearTextBtn = document.getElementById('clearTextMarkersBtn');

      if (clearTextBtn) {
          clearTextBtn.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (confirm('¿Eliminar todos los textos subidos?')) {
                  if (textInput) textInput.value = '';
                  const listDiv = document.getElementById('textMarkersContainerList');
                  if (listDiv) listDiv.innerHTML = '';
                  window.loadedPromoTexts = undefined;
                  try {
                      const db = await window.InitTranslatorDB();
                      const tx = db.transaction('files', 'readwrite');
                      tx.objectStore('files').delete('textMarkersInput');
                      await tx.complete;
                  } catch (err) { console.error('Error clearing TXTs DB', err); }
              }
          });
      }

      if (textDropzone && textInput && browseTextBtn) {
          browseTextBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              textInput.click();
          });

          textDropzone.addEventListener('dragover', (e) => {
              e.preventDefault();
              e.stopPropagation();
              textDropzone.style.background = 'rgba(74, 222, 128, 0.15)';
          });

          textDropzone.addEventListener('dragleave', (e) => {
              e.preventDefault();
              e.stopPropagation();
              textDropzone.style.background = 'rgba(74, 222, 128, 0.05)';
          });

          textDropzone.addEventListener('drop', (e) => {
              e.preventDefault();
              e.stopPropagation();
              textDropzone.style.background = 'rgba(74, 222, 128, 0.05)';
              if (e.dataTransfer.files.length > 0) {
                  document.getElementById('textMarkersInput').files = e.dataTransfer.files;
                  window.saveToDB('files', 'textMarkersInput', Array.from(e.dataTransfer.files));
                  handleTextMarkerFiles(Array.from(e.dataTransfer.files));
              }
          });

          textInput.addEventListener('change', (e) => {
              if (e.target.files.length > 0) {
                  window.saveToDB('files', 'textMarkersInput', Array.from(e.target.files));
                  handleTextMarkerFiles(Array.from(e.target.files));
              }
          });
          
          textDropzone.addEventListener('click', (e) => {
             if (e.target !== browseTextBtn && e.target !== textInput && e.target !== clearTextBtn && !e.target.closest('#clearTextMarkersBtn')) {
                 textInput.click();
             }
          });
      }

      function handleTextMarkerFiles(files) {
          const textFiles = files.filter(f => f.name.match(/\.txt$/i));
          if (textFiles.length === 0) return;
          
          textFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
          
          Promise.all(textFiles.map(file => {
              return new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onload = (e) => resolve({ name: file.name, text: e.target.result });
                  reader.readAsText(file);
              });
          })).then(results => {
              window.loadedPromoTexts = results.map(r => r.text);
              const listDiv = document.getElementById('textMarkersContainerList');
              if (listDiv) {
                  listDiv.innerHTML = '<strong>' + results.length + ' Texto(s) cargado(s):</strong><br>' + 
                                      results.map(r => '<span style="display:block; margin: 2px 0;"><i class="fas fa-check-circle" style="color:#4ade80;"></i> ' + r.name + '</span>').join('');
              }
          });
      }

    // Setup Audio Markers Drag and Drop
    const audioDropzone = document.getElementById('audioMarkersDropzone');
    const audioInput = document.getElementById('audioMarkersInput');
    const browseAudioBtn = document.getElementById('browseAudioMarkersBtn');

    if (audioDropzone && audioInput && browseAudioBtn) {
        browseAudioBtn.addEventListener('click', (e) => {
            e.preventDefault();
            audioInput.click();
        });

        audioDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            audioDropzone.style.background = 'rgba(129, 140, 248, 0.15)';
        });

        audioDropzone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            audioDropzone.style.background = 'rgba(129, 140, 248, 0.05)';
        });

        audioDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            audioDropzone.style.background = 'rgba(129, 140, 248, 0.05)';
            if (e.dataTransfer.files.length > 0) {
                handleAudioMarkerFiles(Array.from(e.dataTransfer.files));
            }
        });

        audioInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleAudioMarkerFiles(Array.from(e.target.files));
            }
        });
    }

    async function handleAudioMarkerFiles(files) {
        // Find only audio files
        const audioFiles = files.filter(f => f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|ogg|m4a|aac)$/i));
        
        if (audioFiles.length === 0) {
            alert("No se encontraron archivos de audio válidos.");
            return;
        }

        // Sort files alphabetically by name
        audioFiles.sort((a, b) => a.name.localeCompare(b.name));

        const container = document.getElementById('promoMarkersContainer');
        container.innerHTML = ''; // Clear existing markers

        let cumulativeDuration = 0;

        for (let i = 0; i < audioFiles.length - 1; i++) { // Ignore the last one because the last point is EOF
            const file = audioFiles[i];
            const duration = await getAudioDuration(file);
            cumulativeDuration += duration;

            // Format mm:ss
            const minutes = Math.floor(cumulativeDuration / 60);
            const seconds = Math.floor(cumulativeDuration % 60);
            const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            // Add marker input
            const div = document.createElement('div');
            div.className = 'promo-marker-row';
            div.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-top: 5px;';
            div.innerHTML = `
                 <input type="text" class="promoTimeInput" value="${timeStr}" placeholder="Min:Seg (ej: 01:00)" 
                        style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 6px 10px; border-radius: 4px; flex: 1; text-align: center;">
                 <button class="remove-marker-btn" type="button" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 4px; padding: 6px 10px; cursor: pointer;">
                     <i class="fas fa-trash"></i>
                 </button>
            `;
            
            setupPromoInput(div.querySelector('.promoTimeInput'));
            div.querySelector('.remove-marker-btn').onclick = () => { div.remove(); window.saveTimestampsState(); };
            container.appendChild(div);
        }
        window.saveTimestampsState();

        alert(`Se han asignado ${audioFiles.length - 1} marcas de tiempo basadas en la duración de los audios.`);
    }

    function getAudioDuration(file) {
        return new Promise((resolve) => {
            const audio = new Audio();
            audio.src = URL.createObjectURL(file);
            audio.onloadedmetadata = () => {
                const duration = audio.duration;
                URL.revokeObjectURL(audio.src);
                resolve(duration);
            };
            audio.onerror = () => {
                console.error("Error cargando el archivo para medir duración:", file.name);
                URL.revokeObjectURL(audio.src);
                resolve(0); // fallback if it fails
            };
        });
    }
});

window.switchTab = function(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    document.getElementById(tabName === 'auto' ? 'tabBtnAuto' : 'tabBtnManual').classList.add('active');
    document.getElementById('tabContentAuto').style.display = tabName === 'auto' ? 'block' : 'none';
    document.getElementById('tabContentManual').style.display = tabName === 'manual' ? 'block' : 'none';
    
    // Toggle sidebar settings visibility
    const autoSettings = document.getElementById('autoSettingsPanel');
    if(autoSettings) {
        autoSettings.style.display = tabName === 'auto' ? 'block' : 'none';
    }

    updateGenerateButtonText(tabName);
};

function updateGenerateButtonText(tabName) {
    const btn = document.getElementById('generateTranslatedVideoBtn');
    if (btn) {
        btn.innerHTML = tabName === 'auto' 
            ? '<i class="fas fa-magic"></i> Generar Audios de Traducción (IA)' 
            : '<i class="fas fa-hammer"></i> Procesar Videos Manualmente';
    }
}

window.toggleVoiceSelect = function() {
    const selectedProvider = document.querySelector('input[name="ttsProvider"]:checked')?.value;
    const googleContainer = document.getElementById('googleVoiceSelectContainer');
    const applioContainer = document.getElementById('applioVoiceSelectContainer');
    
    if (googleContainer) {
        googleContainer.style.display = (selectedProvider === 'google' || selectedProvider === 'google_pro') ? 'block' : 'none';
    }
    
    if (applioContainer) {
        applioContainer.style.display = (selectedProvider === 'applio') ? 'block' : 'none';
    }
};

async function loadApplioVoices() {
    try {
        const response = await fetch('/api/applio-voices');
        const data = await response.json();
        const select = document.getElementById('applioVoiceSelect');
        
        if (!select) return;

        select.innerHTML = '';
        
        let savedVoice = null;
        try {
            const prefs = JSON.parse(localStorage.getItem('videoTranslatorPrefs'));
            if (prefs && prefs.applioVoice) savedVoice = prefs.applioVoice;
        } catch (e) {}

        if (data.voices && data.voices.length > 0) {
            let foundSaved = false;
            
            data.voices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.path || voice;
                option.textContent = voice.displayName || voice;
                select.appendChild(option);
            });

            // Logic to select saved voice or fallback to Remy
            if (savedVoice) {
                const optionToSelect = Array.from(select.options).find(o => o.value === savedVoice);
                if (optionToSelect) {
                    optionToSelect.selected = true;
                    foundSaved = true;
                }
            }

            if (!foundSaved) {
                // Return to default Remy logic
                const remyOption = Array.from(select.options).find(o => o.textContent.toLowerCase().includes('remy'));
                if (remyOption) remyOption.selected = true;
            }

        } else {
            select.innerHTML = '<option value="logs\\\\VOCES\\\\RemyOriginal.pth">Remy (Por defecto)</option>';
        }
    } catch (error) {
        console.error('Error loading Applio voices:', error);
        const select = document.getElementById('applioVoiceSelect');
        if (select) {
            select.innerHTML = '<option value="logs\\\\VOCES\\\\RemyOriginal.pth">Remy (Por defecto)</option>';
        }
    }
}

function setupDropZone(dropZoneId, inputId, displayId, allowedTypes, onFileSelect) {
    const dropZone = document.getElementById(dropZoneId);
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);

    if (!dropZone || !input) return;

    dropZone.addEventListener('click', (e) => {
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
            window.saveToDB('files', inputId, Array.from(input.files));
            validateAndHandle(input.files[0]);
        }
    });

    input.addEventListener('change', () => {
        if (input.files.length) {
            window.saveToDB('files', inputId, Array.from(input.files));
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

function updateGenerateButton() {
    // Basic check, could be more robust
    const btn = document.getElementById('generateTranslatedVideoBtn');
    // For now we just enable it if interaction happened, validation happens on click
    if(btn) btn.disabled = false; 
}

window.startVideoTranslation = async function(isRetry = false) {      if (!isRetry) savePreferences(); // Save preferences on fresh start
    const isManualMode = document.getElementById('tabContentManual').style.display !== 'none';
    const generateBtn = document.getElementById('generateTranslatedVideoBtn');
    
    // UI Elements
    const progressContainer = document.getElementById('translateVideoProgress');
    const statusText = document.getElementById('translateVideoStatus');
    const progressBar = document.getElementById('translateVideoProgressBar');
    const percentText = document.getElementById('translateVideoPercent');
    const timeRemainingText = document.getElementById('translateVideoTimeRemaining');

    let file, musicFile;

    if (isManualMode) {
        const vIn = document.getElementById('videoUploadManual');
        const mIn = document.getElementById('musicUploadManual');
        file = vIn ? vIn.files[0] : null;
        musicFile = mIn && mIn.files.length ? mIn.files[0] : null;

        if (!file) {
            alert("Por favor selecciona un archivo de video para el modo manual.");
            return;
        }
    } else {
        const fileInput = document.getElementById('videoUpload');
        const musicInput = document.getElementById('musicUpload');
        file = fileInput ? fileInput.files[0] : null;
        musicFile = musicInput && musicInput.files.length ? musicInput.files[0] : null;

        if (!file && !isRetry) {
             alert("Por favor selecciona un archivo de video.");
             return;
        }

        // Check if video already exists on server
        if (file && !isRetry) {
            try {
                const checkRes = await fetch(`/api/check-video-exists?videoName=${file.name}`);
                const checkData = await checkRes.json();
                
                if (checkData.exists) {
                    const useExisting = confirm(`El video "${file.name}" ya existe en el servidor.\n¿Deseas usar la versión existente para ahorrar tiempo de subida?`);
                    if (useExisting) {
                        isRetry = true;
                    }
                }
            } catch (e) {
                console.warn('Could not check if video exists:', e);
            }
        }
    }

    // Start Process
    if (generateBtn) generateBtn.disabled = true;
    progressContainer.style.display = 'block';
    statusText.textContent = isRetry ? 'Reanudando proceso (usando archivo existente)...' : 'Iniciando subida...';
    progressBar.style.width = '0%';
    if (percentText) percentText.textContent = '0%';

    const formData = new FormData();
    const isShortVideo = document.getElementById('isShortVideo')?.checked || false;
    formData.append('isShortVideo', isShortVideo);

    let endpoint = '/api/translate-video';

    if (isManualMode) {
        endpoint = '/api/manual-translate-video';
        if (file) formData.append('video', file);
        if (musicFile) formData.append('music', musicFile);

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
            if (generateBtn) generateBtn.disabled = false;
            progressContainer.style.display = 'none';
            return;
        }
    } else {
        // Auto Mode logic
        if (isRetry) {
            formData.append('retryVideoName', file ? file.name : ''); // Send name if available
        } else {
            formData.append('video', file);
        }
        if (musicFile) formData.append('music', musicFile);

        const ttsProvider = document.querySelector('input[name="ttsProvider"]:checked')?.value || 'applio';
        formData.append('ttsProvider', ttsProvider);

        const selectedLanguages = Array.from(document.querySelectorAll('input[name="targetLanguages"]:checked'))
            .map(cb => cb.value);
        formData.append('targetLanguages', JSON.stringify(selectedLanguages));

        const applioVoice = document.getElementById('applioVoiceSelect')?.value || 'logs\\\\VOCES\\\\RemyOriginal.pth';
        formData.append('applioVoice', applioVoice);

        const applioGender = document.querySelector('input[name="applioGender"]:checked')?.value || 'male';
        formData.append('applioGender', applioGender);

        const googleVoice = document.getElementById('googleVoiceSelect')?.value || 'Kore';
        formData.append('googleVoice', googleVoice);

        const useRandomVoice = document.getElementById('randomVoiceCheckbox')?.checked || false;
        formData.append('randomVoice', useRandomVoice);

        const usePodcastStyle = document.getElementById('podcastStyleCheckbox')?.checked || false;
        formData.append('podcastStyle', usePodcastStyle);

        const keepTempFiles = document.getElementById('keepTempCheckbox')?.checked || false;
        formData.append('keepTempFiles', keepTempFiles);

        // Collect all promo markers
        const promoInputs = document.querySelectorAll('.promoTimeInput');
        const promoStartTimes = [];
        promoInputs.forEach(input => {
            if (input.value && input.value.trim()) {
                promoStartTimes.push(input.value.trim());
            }
        });

        
          if (window.loadedPromoTexts && window.loadedPromoTexts.length > 0) {
              formData.append('promoTexts', JSON.stringify(window.loadedPromoTexts));
          }
          
          if (promoStartTimes.length > 0) {
            formData.append('promoStartTimes', JSON.stringify(promoStartTimes));
        }

        const translationModel = document.querySelector('input[name="translationModel"]:checked')?.value || 'gemini-3-flash-preview';
        formData.append('translationModel', translationModel);
    }

    const startTime = Date.now();

    try {
        const response = await fetch(endpoint, { method: 'POST', body: formData });
        if (!response.ok) throw new Error('Error en la solicitud');

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
                        const data = JSON.parse(line.slice(6));
                        
                        if (data.status) statusText.textContent = data.status;
                        
                        if (data.progress) {
                            const p = parseFloat(data.progress);
                            progressBar.style.width = `${p}%`;
                            if (percentText) percentText.textContent = `${Math.round(p)}%`;
                            
                            // Time estimation
                            if (p > 0) {
                                const elapsed = Date.now() - startTime;
                                const total = (elapsed / p) * 100;
                                const remaining = Math.max(0, (total - elapsed) / 1000);
                                const m = Math.floor(remaining / 60);
                                const s = Math.floor(remaining % 60);
                                timeRemainingText.textContent = `Restante: ${m}:${s.toString().padStart(2, '0')}`;
                            }
                        }

                        if (data.completed) {
                            statusText.textContent = '¡Completado!';
                            progressBar.style.width = '100%';
                            alert('Proceso completado correctamente. Revisa la carpeta "outputs".');
                            if (generateBtn) generateBtn.disabled = false;
                        }

                        if (data.error) throw new Error(data.error);

                    } catch (e) {
                        console.error("Parse error", e);
                    }
                }
            }
        }
    } catch (error) {
        console.error(error);
        statusText.textContent = 'Error: ' + error.message;
        progressBar.style.background = '#e53e3e';
        if (generateBtn) generateBtn.disabled = false;
    }
};


// --- Preference Management System ---
function savePreferences() {
    try {
        const prefs = {
            targetLangs: Array.from(document.querySelectorAll('input[name="targetLanguages"]:checked')).map(el => el.value),
            translationModel: document.querySelector('input[name="translationModel"]:checked')?.value,
            ttsProvider: document.querySelector('input[name="ttsProvider"]:checked')?.value,
            applioVoice: document.getElementById('applioVoiceSelect')?.value,
            applioGender: document.querySelector('input[name="applioGender"]:checked')?.value
        };
        localStorage.setItem('videoTranslatorPrefs', JSON.stringify(prefs));
        console.log('Preferences saved:', prefs);
    } catch (e) {
        console.error('Error saving preferences:', e);
    }
}

function loadPreferences() {
    try {
        const prefs = JSON.parse(localStorage.getItem('videoTranslatorPrefs'));
        if (!prefs) return;

        // Restore Languages
        if (prefs.targetLangs && Array.isArray(prefs.targetLangs)) {
            // Uncheck all first
            document.querySelectorAll('input[name="targetLanguages"]').forEach(el => el.checked = false);
            // Check saved ones
            prefs.targetLangs.forEach(lang => {
                const el = document.querySelector(`input[name='targetLanguages'][value='${lang}']`);
                if (el) el.checked = true;
            });
        }

        // Restore Translation Model
        if (prefs.translationModel) {
            const radio = document.querySelector(`input[name='translationModel'][value='${prefs.translationModel}']`);
            if (radio) radio.checked = true;
        }

        // Restore TTS Provider
        if (prefs.ttsProvider) {
            const radio = document.querySelector(`input[name='ttsProvider'][value='${prefs.ttsProvider}']`);
            if (radio) {
                radio.checked = true;
                if (window.toggleVoiceSelect) window.toggleVoiceSelect();
            }
        }

        if (prefs.applioGender) {
            const radio = document.querySelector(`input[name='applioGender'][value='${prefs.applioGender}']`);
            if (radio) radio.checked = true;
        }

        console.log('Preferences loaded:', prefs);
    } catch (e) {
        console.error('Error loading preferences', e);
    }
}

