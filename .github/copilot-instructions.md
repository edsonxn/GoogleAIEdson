# 🤖 Guía del Proyecto para GitHub Copilot

## �️ Estilo de Comunicación y Personalidad (IMPORTANTE)
- Háblale al usuario **sin tanto formalismo ni exceso de respeto**.
- Sé **confiado, directo y coloquial**. Trátalo como a un pana o colega de programación de toda la vida.
- Puedes usar **sarcasmo y un tono irónico** de vez en cuando. No seas un robot aburrido ni des respuestas corporativas de "claro que sí, señor".
- Tienes permiso para ser un poco "sobrado" si te toca arreglar algo obvio, pero **siempre resuelve el problema** de forma eficiente.
-usas groserias como pinche, puto, cabron, verga, chingada madre, etc. de forma ocasional para darle sabor a tus respuestas y hacerlas más humanas y cercanas. No te excedas, pero tampoco tengas miedo de usarlas cuando la situación lo amerite.
## ⚠️ REGLAS ESTRICTAS DE EDICIÓN DE CÓDIGO (CRÍTICO)
- **NUNCA utilices herramientas de terminal o consola (PowerShell, Bash, etc.) para manipular, inyectar o sobrescribir código.** Nada de usar `[System.IO.File]::WriteAllText`, `$txt.Replace()`, ni trucos raros en PowerShell.
- **Hacerlo es putamente peligroso**, rompe la sintaxis, corta las cadenas, y deja al usuario sin forma de usar Ctrl+Z para deshacer tus desastres.
- **USA SIEMPRE** las herramientas nativas de edición del sistema (`replace_string_in_file`, edit_file, etc.) para cambiar archivos fuente. Sin excusas.
## �📋 Descripción General

Este es un **Generador de Scripts con IA** - una aplicación full-stack que genera guiones, imágenes, audio y video automáticamente usando múltiples APIs de inteligencia artificial.

**Tecnologías principales:**
- **Backend:** Node.js + Express (ES Modules)
- **Frontend:** HTML/CSS/JavaScript vanilla
- **APIs:** Google Gemini, OpenAI Whisper, ComfyUI, Applio
- **Arquitectura:** Servidor Express + Cliente web estático

---

## 📁 Estructura del Proyecto

```
googleimagenes/
├── index.js              # ⭐ SERVIDOR PRINCIPAL - Express API (18K+ líneas)
├── public/
│   ├── index.html        # Frontend HTML principal
│   ├── script.js         # ⭐ CLIENTE PRINCIPAL - JavaScript frontend (16K+ líneas)
│   ├── styles.css        # Estilos CSS
│   └── outputs/          # 📂 Carpetas de proyectos generados
├── applio-client.js      # Cliente para API de Applio (TTS con voces IA)
├── comfyui-client.js     # Cliente para ComfyUI (generación de imágenes Flux)
├── transcriber.js        # Transcripción de audio con OpenAI Whisper
├── performance-configs.js # Configuraciones de rendimiento
├── styles.json           # Estilos de escritura personalizados
├── .env                  # Variables de entorno (API keys)
├── package.json          # Dependencias npm
└── whisper_local.py      # Script Python para Whisper local
```

---


## 📝 Registro Histórico y Cambios Recientes

**📌 INSTRUCCIÓN PARA COPILOT:**  
> Cuando el usuario indique que está cómodo o conforme con los cambios realizados en una sesión de trabajo, **deberás actualizar obligatoriamente esta sección del archivo** para documentar las nuevas características implementadas, los archivos afectados y cómo funciona la nueva lógica, para que en siguientes sesiones el modelo no tarde en encontrar y entender el flujo.

### Cambios Recientes Implementados (Bypass y Emparejamiento Manual .TXT/.WAV)
- **Generación Directa con Guiones (.txt) y Duraciones (.wav):**
  - Archivo modificado: `index.js`.
  - Se interceptó por completo el proceso de transcripción de Whisper. Cuando el cliente envía la lista de archivos de texto (`promoTexts`) y la lista de duraciones de audios base (`promoStartTimes`), el backend crea una estructura sintética con los textos ordenados, asignándoles el intervalo de tiempo (duración) exacto definido por tus archivos `.wav`.
  - El sistema traduce orgánicamente estos textos mediante Gemini hacia cada idioma y finalmente despacha a Applio o Google para convertir tu `txt` a audio. Al generarse el audio, el backend usa FFmpeg (`atempo`) para estirar o comprimir el audio hasta que empate exactamente con la duración que extrajo del archivo `.wav` subido. Se acabó el desperdicio de memoria y tiempo en Whisper.

### Cambios Recientes Implementados (Descarga de Proyecto en ZIP)
- **Botón de Descarga Global:**
  - Archivos: `index.js`, `public/index.html`, `public/script.js`, `public/styles.css`.
  - Se instaló la dependencia `archiver` en el backend para permitir la compresión sobre la marcha sin guardar archivos residuales.
  - Se agregó el endpoint `/api/projects/:folderName/download` en `index.js` que zippea la carpeta al instante y la transmite al cliente.
  - En la interfaz, se añadió el botón "Descargar Proyecto (ZIP)" debajo de Generar Metadatos en el panel principal que se muestra cuando el proyecto está listo. El propio botón realiza el disparo de la descarga mediante un enlace invisible forzando la bajada web.

### Cambios Recientes Implementados (Actualización de Modelos)
- **Migración a Gemini 3.1 Pro Preview y Variables de Entorno:**
  - Archivos: `index.js`, `.env`.
  - Se modularizaron los modelos por defecto. El modelo de texto principal ha sido centralizado apuntando a `gemini-3.1-pro-preview` vía entorno (`process.env.GEMINI_TEXT_MODEL`).
  - Se agregaron las variables de control (`GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_TTS_MODEL_FLASH`, `GEMINI_TTS_MODEL_PRO`) al principio de `index.js` garantizando que puedan modificarse desde `.env` sin tener que tocar el código fuente, optimizando el mantenimiento.

### Cambios Recientes Implementados (Módulo YouTube Live Comments & TTS)
- **Modo Continuo (TTS al Instante/Sin cola):**
  - Archivos: public/youtube-live-comments.html, public/youtube-live-comments.js.
  - Se implementó la modalidad Continua (casilla dedicada en el panel) que desactiva los conteos de tiempo fijos (	tsBatchTimer) y lee automáticamente un comentario en cuanto llega si no hay audio reproduciéndose. Si actualmente se está dictando un audio, en lugar de bloquearse, la IA agrupa todos los mensajes ocurridos durante el discurso y los envía al LLM en cuanto finalice de hablar.

- **Corrección de Conexión WebSocket Pytchat:**
  - Archivos: `index.js`, `youtube_live_reader.py`.
  - Se diagnosticó y reparó un error que bloqueaba Express por el stream de subprocess. Se actualizó la manera de crear la instancia de pytchat a `pytchat.create()` y se implementó un tag delimitador `---COMMENT---` que WebSocket parsea y envía al panel sin crashear el JSON.
- **Filtro LLM "Secretaria" con Gemini para Comentarios:**
  - Archivos: `index.js`, `public/youtube-live-comments.html`, `public/youtube-live-comments.js`.
  - Se agregó una casilla y un campo de personalidad para que Gemini procese un batch de comentarios en vivo.
  - El backend intercepta `/api/live-comments-tts`, valida `useLlm: true` y genera una respuesta actuada ("Secretaria sarcástica", etc.) antes de mandar el texto final a Applio TTS.
- **Sistema de Lotes (Batching) para Comentarios TTS:**
  - Archivos: `public/youtube-live-comments.js`, `public/youtube-live-comments.html`
  - Se configuró la captura de comentarios por bloques usando un timer en el cliente (`ttsBatchTimer`, default: 3s). Así se agrupan varios mensajes antes de pasarlos por Gemini/Applio para que suene más orgánico y fluido.
  - Se implementó un parche RegEx al momento de leer para limpiar emoticones de YouTube crudos tipo `:face_with_rolling_eyes:` antes de llegar a la IA.
- **Implementación TTS (Applio) en Vivo para Comentarios:**
  - Archivos: `index.js`, `public/youtube-live-comments.html`, `public/youtube-live-comments.js`.
  - Se creó el endpoint `/api/live-comments-tts` que invoca `applioClient.textToSpeech` sin la lógica estricta de traducción.
  - En el panel frontend, se añadió un toggle para activar la lectura por voz de Applio, con selector de voz local, y limitador de longitud de espera en fila (`maxTtsQueue`).
  - Lógica JavaScript asíncrona dedicada (`ytlcTTS`) para despachar promesas en cascada, encolar audios y reproducirlos secuencialmente (evitando cacofonía).
  
### Cambios Recientes Implementados (Módulo Traducción de Video)
- **Corrección de "Echo" en Textos de Traducción:**
  - Archivo modificado: `index.js`.
  - En la generación y traducción por secciones, Gemini estaba repitiendo la frase "SCRIPT PART X/Y:" dentro del texto final. Se añadió a la instrucción `OUTPUT ONLY THE TRANSLATED TEXT. DO NOT INCLUDE ANY LABELS OR PREFIXES (LIKE "SCRIPT PART:")` y se implementó una expresión regular post-procesamiento (`txt.replace(/SCRIPT PART \d+\/\d+:?\s*/gi, '').trim()`) para limpiarlo garantizando audios pulcros sin basura del prompt.
- **Auto-Cálculo de Marcas de Tiempo con Audios:**
  - Archivos modificados: `public/translate-video.html`, `public/translate-video.js`.
  - Se agregó una sub-sección de dropzone para que el usuario pueda arrastrar/cargar múltiples archivos de audio. El sistema los ordena alfabéticamente y extrae su duración sumándola progresivamente para autocompletar el panel de "Marcas de Sección / Promo".
- **Optimización de Texto para Applio TTS:**
  - Archivo modificado: `index.js`.
  - Se agregó una instrucción (`specialInstruction`) al crear los prompts de traducción para Gemini. Si el proveedor de audio es "Applio", se le ordena estrictamente a la IA escribir todos los números con letras (en lugar de dígitos) y remover caracteres especiales indeseados como apóstrofes entre letras de una misma palabra (ej. de "yog'saron" a "yogsaron").
- **Soporte de Applio en Modo Multi-Sección (Marcas de Tiempo):**
  - Archivo modificado: `index.js` (en `app.post('/api/translate-video')`).
  - Se extendió la función interna `generatePartTTS` que antes solo soportaba Google TTS. Ahora, si el usuario seleccionó "Applio", el sistema utilizará `applioClient.textToSpeech` pasándole la voz correspondiente para crear los audios por cada "marca de sección" o "promo" dividida.
- **Implementación de Listado de Voces Dinámico de Applio:**
  - Archivos modificados: `public/translate-video.html`, `public/translate-video.js`, `index.js`.
  - Ahora se llama al endpoint `/api/applio-voices` desde el cliente para poblar dinámicamente el selector `<select id="applioVoiceSelect">`.
  - El color de fondo del selector se actualizó (`#1e293b`) para hacerlo legible en el modo oscuro.
- **Optimización en Flujo de Generación de Audio TTS:**
  - Archivo modificado: `index.js` (en `app.post('/api/translate-video')`).
  - Se agregó una validación fundamental con `if (fs.existsSync(audioOutputPath))` para **saltar la generación** a través de Google o Applio TTS si el archivo de audio ya existe localmente. Esto reduce de manera drástica los tiempos de espera en re-procesos.
- **Correcciones en el Procesamiento con FFmpeg:**
  - Archivo modificado: `index.js` (en la etapa de duración/stretching).
  - Se corrigió la cadena de comandos del filtro complejo de FFmpeg; se agregó una coma faltante para separar los filtros (ej. `aresample=48000,atempo=...`), evitando el error `Option not found`.

### Cambios Recientes Implementados (Sistema de Preferencias de Usuario y Correcciones Applio)
- **Persistencia de Preferencias (LocalStorage):**
  - Archivo modificado: `public/translate-video.js`.
  - Se implementó un sistema de guardado automático (`savePreferences`) al iniciar una traducción. Se guardan en `localStorage`: Idiomas destino, Modelo de Traducción (Gemini 3 Pro/Flash), Proveedor TTS y Voz de Applio.
  - Al cargar la página (`loadPreferences`), se restauran estos valores automáticamente.
- **Corrección en Carga de Voces Applio:**
  - Archivo modificado: `public/translate-video.js`.
  - Se modificó `loadApplioVoices` para priorizar la voz guardada en preferencias sobre la selección por defecto ("Remy"), permitiendo al usuario mantener su selección entre sesiones.
- **Corrección de Lógica Applio en Backend:**
  - Archivo modificado: `index.js`.
  - Se solucionó un bug donde la función `processVideoWithMultiSectionSync` ignoraba la selección `ttsProvider === 'applio'` debido a un bloque lógico faltante.
- **Manejo de Errores de Cuota (429):**
  - Archivo modificado: `index.js`. 
  - Se implementó lógica de `retry` con *fallback* automático: si Gemini 3.1 Pro falla (error 429), el sistema reintenta usando Gemini 2.5 Flash automáticamente para evitar interrupciones.
- **Limpieza de Texto IA:**
  - Archivo modificado: `index.js`.
  - Se añadió limpieza de patrones tipo "SCRIPT PART X/Y:" en la respuesta final de traducción para evitar que la voz IA lea los metadatos del prompt.

### Cambios Recientes Implementados (Módulo de Interfaz y Prevención de Bugs)
- **Bloqueo Anti-Duplicación de Audios Applio (Mutex Lock):**
  - Archivo modificado: `index.js`.
  - Se detectó un problema en navegadores móviles donde al refrescarse la página en segundo plano se disparaban solicitudes GET/POST en paralelo, causando que Applio generara las mismas secciones dos veces.
  - Se implementó un Set global `activeApplioGenerationLocks` que atrapa repeticiones usando el `folderName` y rechaza con `HTTP 202` aquellas solicitudes que lleguen para un proyecto que ya está procesándose.
- **Diseño Móvil Receptivo (Responsividad Global):**
  - Archivos: `public/styles.css`, `public/translate-video.html`, `public/youtube-live-comments.html`.
  - Se inyectó una gran capa `@media (max-width: 768px)` con `!important` para quebrar las columnas de CSS Grid en bloques Flex de 1 columna. 
  - La barra lateral se adaptó como un menú extraíble (drawer slide-in) y se reposicionó el botón de hamburguesa estilo Floating Action Button (FAB).
- **Corrección de Perspectiva IA (Guión en 1ª Persona vs Narrador):**
  - Archivo modificado: `index.js` (en `generateChapterStructure`).
  - Se removió la directriz forzada de "vida diaria/rutina de un youtuber" limitándola exclusivamente al estilo predeterminado. Cuando se usa un estilo propio (ej. crónicas de warcraft), Gemini ahora narra como documentalista sin hablar en primera persona.

### Cambios Recientes Implementados (Ajustes Globales y Optimización de Voz)
- **Directorio de Outputs Dinámico (Ajustes Generales):**
  - Archivos modificados: `index.js`, `public/index.html`, `public/script.js`.
  - Se implementó un modal de Ajustes Generales que permite al usuario configurar la carpeta global de proyectos (`settings.json`). 
  - Expreso se encarga ahora de servir la ruta estática hacia esta carpeta de manera dinámica (usando `globalOutputDir`), refactorizando más de 50 lugares en el código backend para desacoplarlos de la carpeta `./public/outputs` literal.
- **Voz Base Modificada (Applio):**
  - Archivo modificado: `index.js`.
  - Se modificó la voz default en español en los audios base del proyecto a `fr-FR-RemyMultilingualNeural` sustituyendo a "Alvaro Neural", y se corrigió el pase de variable `voicePath` en Applio para respetar la decisión inicial de voz del usuario.

---

*Última actualización: Marzo 2026*

### Cambios Recientes Implementados (Persistencia Total en Modo Traducción)
- **Persistencia de Archivos y Marcas al Recargar la Página:**
  - Archivos modificados: `public/translate-video.js`.
  - Se implementó un Wrapper ligero para `IndexedDB` (`TranslatorCacheDB`) que intercepta cada arrastre o selección de archivos (video, música, txt de guiones o audios de marcas) y guarda una copia local de los *blobs* en el navegador.
  - Se agregó también `localStorage` para respaldar las marcas de tiempo `vt_timestamps` introducidas a mano.
  - Al recargar la página (F5), ahora el sistema de inmediato repara el DOM de las cajitas de marcas de tiempo y rehidrata los campos `input type="file"` insertándoles de vuelta sus archivos clonados usando un objeto `DataTransfer`, evitando así la pérdida de trabajo y archivos pesados durante los refrescos.
  
### Cambios Recientes Implementados (Ajuste Silencio Audio Final)
- **Reubicación de Silencio de 20s en Audio Multi-sección:**
  - Archivo modificado: index.js.
  - Se movió la lógica que inyectaba 20 segundos de silencio exclusivamente en la última sección (lo que provocaba que la velocidad del TTS se distorsionara/acelerara para compensar). Ahora, la duración de la última sección permanece intacta y los 20 segundos de silencio se concatenan silenciosamente al final del archivo de audio maestro ya fusionado.


### Cambios Recientes Implementados (Compresión Proporcional de Audio para Silencio)
- **Distribución de Silencio Global:** Se detectó que al no reducir el tiempo de la pista maestra, el audio de traducción terminaba sobrando 20 segundos por el silencio inyectado. Ahora, en el bloque paralelo de generación TTS, el sistema usa el factor (videoDuration - 20) / videoDuration sobre sec.duration. Esto **acelera levemente todas las secciones de manera proporcional y equitativa** (en lugar de concentrar toda la aceleración en la última), dejando exactamente los 20 segundos libres al final para que el total sumado encaje a la perfección con la duración de video original.

### Cambios Recientes Implementados (Sincronización Exacta de Tiempos Manuales)
- **Corrección en la Distribución del Silencio:** Se detectó que al aplicar la compresión proporcional a TODAS las secciones, los tiempos de corte manuales introducidos por el usuario en la interfaz se desincronizaban (ej. un corte en 1:06 pasaba a 1:04). Se revirtió el factor de manera que el descuento de 20s para el silencio final se aplique **ÚNICAMENTE a la última sección**. Esto garantiza que las marcas de tiempo anteriores (secciones intermedias) mantengan exactamente su duración original (sin recorrerse a la izquierda) y conserven una perfecta sincronización con el video.
S e   r e s o l v i o   e l   p r o b l e m a   q u e   i m p e d � a   q u e   l o s   t i m e s t a m p s   r e c i � n   a � a d i d o s   a l   D O M   s e   g u a r d a r a n   d e   i n m e d i a t o   e n   e l   l o c a l S t o r a g e ,   c a u s a n d o   s u   b o r r a d o   a l   r e f r e s c a r   c o n   F 5 . 
 
 