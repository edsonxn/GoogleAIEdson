// Estado global
const ytlcState = {
    isReading: false,
    socket: null,
    commentCount: 0,
    uniqueUsers: new Set(),
    commentsPerMinute: 0,
    lastMinuteCount: 0,
    startTime: null,
    comments: [],
    maxComments: 100
};

// Utilidades
const ytlcUtils = {
    getStatus: (type) => {
        if (type === 'connecting') return 'Conectando...';
        if (type === 'connected') return 'Conectado - Leyendo comentarios...';
        if (type === 'disconnected') return 'Desconectado';
        if (type === 'error') return 'Error en la conexión';
        return 'Listo';
    },

    updateStatus: (message, type = 'default') => {
        const statusEl = document.getElementById('status');
        if (!statusEl) return;

        statusEl.innerHTML = `
            <span class="ytlc-status-dot"></span>
            <span>${message}</span>
        `;
        statusEl.className = 'ytlc-status';
        if (type === 'connected') statusEl.classList.add('connected');
        if (type === 'error') statusEl.classList.add('error');
    },

    formatTime: (date = new Date()) => {
        return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    },

    extractVideoId: (url) => {
        const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/;
        const match = url.match(regex);
        return match ? match[1] : null;
    },

    updateStats: () => {
        document.getElementById('totalComments').textContent = ytlcState.commentCount;
        document.getElementById('uniqueUsers').textContent = ytlcState.uniqueUsers.size;

        if (ytlcState.startTime) {
            const elapsedMinutes = (Date.now() - ytlcState.startTime) / 60000;
            ytlcState.commentsPerMinute = elapsedMinutes > 0 ? Math.round(ytlcState.commentCount / elapsedMinutes) : 0;
        }
        document.getElementById('commentsPerMin').textContent = ytlcState.commentsPerMinute;
    }
};

// Manejo de comentarios
const ytlcComments = {
    addComment: (author, text, timestamp = null) => {
        const now = new Date();
        const comment = {
            author,
            text,
            timestamp: timestamp || ytlcUtils.formatTime(now),
            id: `${Date.now()}-${Math.random()}`
        };

        // Agregar a la fila de TTS
        ytlcTTS.add(author, text);

        // Agregar a comentarios e información de usuarios
        ytlcState.comments.unshift(comment);
        if (!ytlcState.uniqueUsers.has(author)) {
            ytlcState.uniqueUsers.add(author);
        }
        ytlcState.commentCount++;

        // Limitar cantidad de comentarios en memoria
        if (ytlcState.comments.length > ytlcState.maxComments * 2) {
            ytlcState.comments = ytlcState.comments.slice(0, ytlcState.maxComments);
        }

        ytlcComments.renderComments();
        ytlcUtils.updateStats();
    },

    renderComments: () => {
        const container = document.getElementById('commentsList');
        if (!container) return;

        if (ytlcState.comments.length === 0) {
            container.innerHTML = `
                <div class="ytlc-empty">
                    <i class="fas fa-hourglass"></i>
                    <div>Esperando comentarios...</div>
                </div>
            `;
            return;
        }

        const maxDisplay = parseInt(document.getElementById('maxComments').value) || 100;
        const commentsToDisplay = ytlcState.comments.slice(0, maxDisplay);

        container.innerHTML = commentsToDisplay.map(comment => `
            <div class="ytlc-comment">
                <div class="ytlc-comment-author">
                    <i class="fas fa-user-circle"></i> ${ytlcUtils.htmlEscape(comment.author)}
                </div>
                <div class="ytlc-comment-text">${ytlcUtils.htmlEscape(comment.text)}</div>
                <div class="ytlc-comment-time">${comment.timestamp}</div>
            </div>
        `).join('');

        // Auto-scroll al tope
        container.parentElement.scrollTop = 0;
    },
};

ytlcUtils.htmlEscape = (text) => {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
};

// Manejo de TTS Applio
const ytlcTTS = {
    queue: [],
    pendingBatch: [],
    batchTimer: null,
    isPlaying: false,
    
    add: (author, text) => {
        const checkbox = document.getElementById('enableApplioTTS');
        if (!checkbox || !checkbox.checked) return;
        
        const maxQueue = parseInt(document.getElementById('maxTtsQueue').value) || 10;
        if (ytlcTTS.queue.length >= maxQueue) {
            return; // Ignorar si la fila alcanzó su máximo permitido
        }

        // Formatear texto a leer (remover emoticones solo si NO usamos la IA Gemini, ya que ella sí los entiende)
        const cleanAuthor = author.replace('@', '').split(' ')[0]; // Solo primer nombre
        const useLlm = document.getElementById('enableLlmFilter')?.checked;
        const cleanText = useLlm ? text.trim() : text.replace(/:[a-zA-Z0-9_\-]+:/g, '').trim(); 
        const textToRead = `${cleanAuthor} dice: ${cleanText}`;
        
        ytlcTTS.pendingBatch.push(textToRead);

        const continuousMode = document.getElementById('enableContinuousTTS')?.checked;
        if (continuousMode) {
            if (!ytlcTTS.isPlaying) {
                ytlcTTS.processNext();
            }
            return;
        }

        if (!ytlcTTS.batchTimer) {
            const waitSeconds = parseInt(document.getElementById('ttsBatchTimer')?.value) || 3;
            ytlcTTS.batchTimer = setTimeout(() => {
                const combinedText = ytlcTTS.pendingBatch.join('. ');
                ytlcTTS.pendingBatch = [];
                ytlcTTS.batchTimer = null;
                
                ytlcTTS.queue.push(combinedText);
                ytlcTTS.updateUI();
                ytlcTTS.processNext();
            }, waitSeconds * 1000);
        }
    },

    clearQueue: () => {
        if (ytlcTTS.batchTimer) {
            clearTimeout(ytlcTTS.batchTimer);
            ytlcTTS.batchTimer = null;
        }
        ytlcTTS.pendingBatch = [];
        ytlcTTS.queue = [];
        ytlcTTS.updateUI();
    },

    updateUI: () => {
        const countEl = document.getElementById('ttsQueueCount');
        if (countEl) countEl.textContent = ytlcTTS.queue.length;
    },

    processNext: async () => {
        const continuousMode = document.getElementById('enableContinuousTTS')?.checked;
        if (continuousMode && ytlcTTS.pendingBatch.length > 0) {
            const combinedText = ytlcTTS.pendingBatch.join('. ');
            ytlcTTS.pendingBatch = [];
            if (ytlcTTS.batchTimer) {
                clearTimeout(ytlcTTS.batchTimer);
                ytlcTTS.batchTimer = null;
            }
            ytlcTTS.queue.push(combinedText);
            ytlcTTS.updateUI();
        }

        if (ytlcTTS.isPlaying || ytlcTTS.queue.length === 0) return;
        
        ytlcTTS.isPlaying = true;
        const text = ytlcTTS.queue.shift();
        ytlcTTS.updateUI();
        
        const voicePath = document.getElementById('applioVoiceSelect').value;
        
        try {
            const response = await fetch('/api/live-comments-tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                      text,
                      voicePath,
                      useLlm: document.getElementById('enableLlmFilter')?.checked || false,
                      llmPersona: document.getElementById('llmPersona')?.value || '',
                      history: ytlcTTS.llmHistory
                  })
              });

              if (response.ok) {
                  // Guardar el contexto en el historial si usamos LLM
                  if (document.getElementById('enableLlmFilter')?.checked) {
                      const base64Response = response.headers.get('X-AI-Response');
                      if (base64Response) {
                          try {
                              const decodedAiText = atob(base64Response);
                              ytlcTTS.llmHistory.push({ role: 'user', content: text });
                              ytlcTTS.llmHistory.push({ role: 'assistant', content: decodedAiText });
                              
                              // Mantener solo los últimos 6 intercambios (12 mensajes) para no explotar el prompt
                              if (ytlcTTS.llmHistory.length > 12) {
                                  ytlcTTS.llmHistory = ytlcTTS.llmHistory.slice(-12);
                              }
                          } catch(err) { console.error('Error parseando historial AI:', err); }
                      }
                  }

                  const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                
                audio.onended = () => {
                    URL.revokeObjectURL(url);
                    ytlcTTS.isPlaying = false;
                    ytlcTTS.processNext();
                };
                
                audio.onerror = () => {
                    URL.revokeObjectURL(url);
                    ytlcTTS.isPlaying = false;
                    ytlcTTS.processNext();
                };

                await audio.play();
            } else {
                ytlcTTS.isPlaying = false;
                ytlcTTS.processNext();
            }
        } catch (e) {
            console.error('Error in TTS generation:', e);
            ytlcTTS.isPlaying = false;
            ytlcTTS.processNext();
        }
    }
};

// API de lectura de comentarios
const ytlcAPI = {
    startReading: async (videoUrl) => {
        try {
            ytlcUtils.updateStatus('Conectando...', 'connecting');
            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;

            const videoId = ytlcUtils.extractVideoId(videoUrl);
            if (!videoId) {
                throw new Error('URL de YouTube no válida');
            }

            // Establecer WebSocket con el servidor
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/live-comments`;

            ytlcState.socket = new WebSocket(wsUrl);

            ytlcState.socket.onopen = () => {
                console.log('✅ WebSocket conectado');
                ytlcUtils.updateStatus(ytlcUtils.getStatus('connected'), 'connected');
                
                // Enviar video ID al servidor
                ytlcState.socket.send(JSON.stringify({
                    action: 'start',
                    videoId,
                    videoUrl
                }));

                ytlcState.isReading = true;
                ytlcState.startTime = Date.now();
            };

            ytlcState.socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'comment') {
                        ytlcComments.addComment(data.author, data.text, data.timestamp);
                    } else if (data.type === 'status') {
                        console.log('📊 Status:', data.message);
                    } else if (data.type === 'error') {
                        console.error('Error del servidor:', data.message);
                        ytlcUtils.updateStatus(`Error: ${data.message}`, 'error');
                    }
                } catch (error) {
                    console.error('Error procesando mensaje:', error);
                }
            };

            ytlcState.socket.onerror = (error) => {
                console.error('❌ Error WebSocket:', error);
                ytlcUtils.updateStatus('Error de conexión', 'error');
            };

            ytlcState.socket.onclose = () => {
                console.log('WebSocket cerrado');
                if (ytlcState.isReading) {
                    ytlcUtils.updateStatus('Desconectado', 'disconnected');
                }
                ytlcState.isReading = false;
                document.getElementById('startBtn').disabled = false;
                document.getElementById('stopBtn').disabled = true;
            };

        } catch (error) {
            console.error('Error iniciando lectura:', error);
            ytlcUtils.updateStatus(`Error: ${error.message}`, 'error');
            document.getElementById('startBtn').disabled = false;
            document.getElementById('stopBtn').disabled = true;
        }
    },

    stopReading: () => {
        if (ytlcState.socket) {
            ytlcState.socket.close();
        }
        ytlcState.isReading = false;
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        ytlcUtils.updateStatus('Detenido', 'disconnected');
    }
};

// Funciones globales
window.startReadingComments = () => {
    const videoUrl = document.getElementById('videoUrl').value.trim();
    const maxComments = document.getElementById('maxComments').value;

    if (!videoUrl) {
        alert('Por favor ingresa una URL válida de YouTube');
        return;
    }

    ytlcState.maxComments = parseInt(maxComments) || 100;
    
    // Limpiar comentarios anteriores
    ytlcState.comments = [];
    ytlcState.commentCount = 0;
    ytlcState.uniqueUsers.clear();
    ytlcComments.renderComments();
    ytlcUtils.updateStats();

    ytlcAPI.startReading(videoUrl);
};

window.stopReadingComments = () => {
    if (confirm('¿Deseas detener la lectura de comentarios?')) {
        ytlcAPI.stopReading();
    }
};

// Inicializar event listeners al cargar
document.addEventListener('DOMContentLoaded', () => {
    // Tecla Enter para URL
    if (document.getElementById('videoUrl')) {
        document.getElementById('videoUrl').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !document.getElementById('startBtn').disabled) {
                window.startReadingComments();
            }
        });
    }

    // Cambio límite de comentarios mostrados
    if (document.getElementById('maxComments')) {
        document.getElementById('maxComments').addEventListener('change', (e) => {
            ytlcState.maxComments = parseInt(e.target.value) || 100;
            ytlcComments.renderComments();
        });
    }

    // Llenar selector de voces Applio
    fetch('/api/applio-voices').then(r => r.json()).then(d => {
        if (d.success && d.voices) {
            const s = document.getElementById('applioVoiceSelect');
            if (s) s.innerHTML = d.voices.map(v => `<option value="${v.path.replace(/\\\\/g, '\\\\\\\\')}">${v.name}</option>`).join('');
        }
    }).catch(console.error);

    // Eventos UI Filtro LLM
    const llmCheckbox = document.getElementById('enableLlmFilter');
    const llmOptions = document.getElementById('llmOptions');
    if (llmCheckbox && llmOptions) {
        llmCheckbox.addEventListener('change', (e) => {
            llmOptions.style.display = e.target.checked ? 'flex' : 'none';
        });
        // Set initial state in case browser cached the form input
        llmOptions.style.display = llmCheckbox.checked ? 'flex' : 'none';
    }

    // Eventos UI del TTS
    const ttsCheckbox = document.getElementById('enableApplioTTS');
    const ttsOptions = document.getElementById('applioOptions');
    if (ttsCheckbox && ttsOptions) {
        ttsCheckbox.addEventListener('change', (e) => {
            ttsOptions.style.display = e.target.checked ? 'flex' : 'none';
            ttsOptions.style.flexDirection = 'column';
            if (!e.target.checked) ytlcTTS.clearQueue();
        });
    }

    const clearBtn = document.getElementById('clearTtsQueueBtn');
    if (clearBtn) clearBtn.addEventListener('click', () => ytlcTTS.clearQueue());

    // Renderizado inicial
    ytlcComments.renderComments();
    ytlcUtils.updateStats();
});
