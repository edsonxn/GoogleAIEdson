document.addEventListener('DOMContentLoaded', () => {
    console.log('Video Translator Loaded');

    // Inicializar estado
    window.switchTab('auto');
    window.toggleVoiceSelect();

    // Setup Dropzones for Auto Mode
    setupDropZone('videoDropZone', 'videoUpload', 'videoFileName', 'video', () => updateGenerateButton());
    setupDropZone('musicDropZone', 'musicUpload', 'musicFileName', 'audio');

    // Setup Dropzones for Manual Mode
    setupDropZone('dropZone_manual_video', 'videoUploadManual', 'fileName_manual_video', 'video', () => updateGenerateButton());
    setupDropZone('dropZone_manual_music', 'musicUploadManual', 'fileName_manual_music', 'audio');

    ['en', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ko', 'ja'].forEach(lang => {
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
    const container = document.getElementById('googleVoiceSelectContainer');
    if (container) {
        container.style.display = (selectedProvider === 'google' || selectedProvider === 'google_pro') ? 'block' : 'none';
    }
};

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

function updateGenerateButton() {
    // Basic check, could be more robust
    const btn = document.getElementById('generateTranslatedVideoBtn');
    // For now we just enable it if interaction happened, validation happens on click
    if(btn) btn.disabled = false; 
}

window.startVideoTranslation = async function(isRetry = false) {
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
    }

    // Start Process
    if (generateBtn) generateBtn.disabled = true;
    progressContainer.style.display = 'block';
    statusText.textContent = isRetry ? 'Reanudando proceso...' : 'Iniciando subida...';
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

        const googleVoice = document.getElementById('googleVoiceSelect')?.value || 'Kore';
        formData.append('googleVoice', googleVoice);

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
