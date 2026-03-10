# 🧪 Guía de Prueba - Lector de Comentarios YouTube Live

## ✅ Checklist Pre-Inicio

Antes de comenzar, verifica que tengas:

- [ ] Node.js instalado (`node -v`)
- [ ] npm instalado (`npm -v`)
- [ ] Python 3 instalado (`python -v` o `python3 -v`)
- [ ] FFmpeg instalado (`ffmpeg -version`)
- [ ] `pytchat` instalado (`pip install pytchat`)
- [ ] Todos los archivos nuevos creados

## 🚀 Pasos de Prueba

### 1. Verificar Instalación de pytchat

```powershell
# En PowerShell o Terminal
python -m pip list | findstr pytchat

# O directamente:
python -c "import pytchat; print('✅ pytchat está listo')"
```

**Resultado esperado:**
```
pytchat (versión 2.x.x)
✅ pytchat está listo
```

### 2. Iniciar el Servidor

```powershell
npm start
```

**Verificar en la consola:**
```
🔌 Inicializando servidor WebSocket para comentarios en vivo...
✅ Servidor WebSocket inicializado
🚀 Servidor corriendo en http://localhost:3000
📱 Para acceder desde tu celular en la misma red WiFi, usa: http://[TU_IP]:3000
```

### 3. Abrir la Página Principal

- Abre tu navegador: http://localhost:3000
- Verifica que el botón **"Comentarios del Live"** esté en la barra lateral

### 4. Test 1: Verificar Archivo HTML

```bash
# Verificar que el archivo existe
ls -la public/youtube-live-comments.html

# Búsqueda rápida para confirmar el elemento
findstr "id=\"startBtn\"" public/youtube-live-comments.html
```

**Resultado esperado:**
- Archivo debe tener ~357 líneas
- Debe contener controles para inicio/parada

### 5. Test 2: Verificar Archivo JavaScript

```bash
# Verificar el archivo
ls -la public/youtube-live-comments.js

# Verificar que contiene WebSocket
findstr "new WebSocket" public/youtube-live-comments.js
```

**Resultado esperado:**
- Archivo ~347 líneas
- Debe contener referencia a WebSocket

### 6. Test 3: Probar Panel de Control (HTTP)

Desde PowerShell o terminal:

```powershell
# Test con un video ID válido (ejemplo: un video popular)
$videoId = "dQw4w9WgXcQ"  # Ejemplo de ID
Invoke-WebRequest -Uri "http://localhost:3000/api/youtube-comments/$videoId" | ConvertTo-Json

# O con curl:
curl http://localhost:3000/api/youtube-comments/dQw4w9WgXcQ
```

**Resultado esperado:**
```json
{
  "success": true,
  "videoId": "dQw4w9WgXcQ",
  "totalComments": 0,
  "message": "..."
}
```

### 7. Test 4: Interface Web Interactiva

1. Haz clic en **"Comentarios del Live"** (abre en nueva pestaña)
2. Verifica que se cargue la página
3. Prueba con un video ID o URL:
   - Formato URL: `https://youtube.com/watch?v=dQw4w9WgXcQ`
   - Formato ID: `dQw4w9WgXcQ`
4. Haz clic en **"Iniciar Lectura"**
5. Observa la consola del navegador (F12 → Console)

### 8. Test 5: WebSocket Connection (Consola del Navegador)

En la consola del navegador (F12):

```javascript
// Conectar a WebSocket manualmente
const ws = new WebSocket('ws://localhost:3000/live-comments');

ws.onopen = () => {
  console.log('✅ WebSocket conectado');
  // Enviar solicitud
  ws.send(JSON.stringify({
    action: 'start',
    videoId: 'dQw4w9WgXcQ'  // Reemplaza con un video ID válido
  }));
};

ws.onmessage = (event) => {
  console.log('📨 Mensaje recibido:', event.data);
};

ws.onerror = (error) => {
  console.error('❌ Error WebSocket:', error);
};

ws.onclose = () => {
  console.log('🔌 WebSocket desconectado');
};
```

### 9. Test 6: Video con Live Chat Activo

Para una prueba real, necesitas un video que esté transmitiendo en vivo:

1. Ve a YouTube en vivo
2. Copia la URL o el ID del video
3. Pega en la interfaz de "Comentarios del Live"
4. Haz clic en iniciar

**Dentro de 5-10 segundos deberían aparecer comentarios en vivo.**

## 🔍 Verificaciones de Errores Comunes

### Error: "pytchat no encontrado"

**Solución:**
```powershell
pip install --upgrade pytchat
```

### Error: "WebSocket connection failed"

1. Verifica que el servidor esté corriendo: `npm start`
2. Revisa el puerto: http://localhost:3000 debe cargar
3. Verifica la consola del servidor para errores
4. Intenta en otra pestaña del navegador

### Error: "No hay comentarios"

Causas posibles:
- El video no está en vivo (necesita ser una transmisión activa)
- YouTube bloqueó la conexión
- Timeout muy corto

**Solución:**
- Prueba con un video en vivo diferente
- Aumenta timeout en youtube_live_reader.py (línea 77-78)

### Error: "ID de video inválido"

Asegúrate de:
- Usar URL completa: `https://youtube.com/watch?v=ID`
- O ID directo de 11 caracteres: `dQw4w9WgXcQ`
- No incluir `/` o caracteres especiales en ID directo

## 📊 Logs Esperados

### En Servidor (Terminal)

```
✅ Nueva conexión WebSocket: 1704038400000-abc123def
🎬 Iniciando lectura de comentarios para: dQw4w9WgXcQ
[dQw4w9WgXcQ] Conectando a pytchat...
[dQw4w9WgXcQ] Leyendo consideraciones...
```

### En Navegador (Consola)

```
WebSocket connected to ws://localhost:3000/live-comments
Message sent: {"action":"start","videoId":"..."}
Received comment from: Usuario123 - "¡Excelente!"
```

## 🎯 Casos de Prueba Exitosos

| Prueba | Resultado Esperado |
|--------|-------------------|
| Página carga sin errores | ✅ Se ve la interfaz completa |
| WebSocket conecta | ✅ Logs en consola del navegador |
| Envía video ID | ✅ No error en validación |
| Script Python se ejecuta | ✅ No error "pytchat no encontrado" |
| Comentarios recibidos (con live activo) | ✅ Aparecen en la lista |
| Estadísticas actualizan | ✅ Contador y rate/min suben |
| Desconectar | ✅ WebSocket se cierra gracefully |

## 🔧 Debugging Avanzado

### Desde PowerShell

```powershell
# Ver si servidor está escuchando en puerto 3000
netstat -ano | findstr :3000

# Ver procesos de Python activos
Get-Process python* | Select-Object Name, Id, Handles, Memory

# Ver si pytchat funciona directamente
python youtube_live_reader.py "dQw4w9WgXcQ" 5

# Ver logs del servidor en tiempo real
npm start | Tee-Object -FilePath server-logs.txt
```

### Monitoreo en Vivo

Abre dos PowerShells:

**Terminal 1 - Servidor:**
```powershell
npm start
```

**Terminal 2 - Monitor:**
```powershell
# Monitorear conexiones WebSocket
netstat -ano | findstr :3000 | findstr ESTABLISHED

# Monitorear procesos Python
while($true) {
  Get-Process python* | Select-Object Name, Id
  Start-Sleep 2
}
```

## 🎬 Video Tutorial (Pasos Manuales)

1. Abre terminal en `c:\googleimagenes`
2. Ejecuta `npm start`
3. Abre navegador: http://localhost:3000
4. Busca botón "Comentarios del Live"
5. Click para abrir nueva pestaña  
6. Ingresa URL de YouTube Live
7. Click "Iniciar Lectura"
8. Espera 5-10 segundos
9. Comentarios deberían aparecer

## 📝 Reporte de Problemas

Si encuentras algún error, proporciona:

1. Stack trace completo
2. Versión de Node.js: `node -v`
3. Versión de Python: `python -v`
4. Versión de pytchat: `pip show pytchat`
5. Navigador y versión
6. URL o ID del video YouTube (si aplica)
7. Logs de consola (F12)
8. Logs del servidor (terminal)

## ✨ Pruebas Exitosas = Próximos Pasos

Si todo funciona:

- ✅ La característica está lista para usar
- ✅ Puedes guardar comentarios a archivo
- ✅ Puedes analizar comentarios
- ✅ Puedes usarla en producción (con wss://)

---

**Fecha última actualización:** Enero 2026
