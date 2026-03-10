# 📺 Lector de Comentarios en Vivo de YouTube - Guía de Configuración

## 🎯 Descripción General

Se ha implementado una nueva funcionalidad para leer comentarios en tiempo real de transmisiones en vivo de YouTube. La característica incluye:

- **Frontend**: Página web elegante en `youtube-live-comments.html`
- **Backend**: Endpoints Express con WebSocket para streaming real-time
- **Script Python**: `youtube_live_reader.py` para extraer comentarios usando pytchat

## ⚙️ Instalación de Dependencias

### 1. Instalar pytchat (Python)

Abre una terminal/PowerShell en la carpeta del proyecto y ejecuta:

```bash
pip install pytchat
```

O si usas Python 3:
```bash
pip3 install pytchat
```

**Verificar instalación:**
```bash
python -c "import pytchat; print('pytchat instalado correctamente')"
```

### 2. Dependencias Node.js (ya instaladas)

El proyecto ya tiene las dependencias necesarias:
- `ws` - Servidor WebSocket
- `express` - Framework web

## 🚀 Cómo Usar

### 1. Iniciar el Servidor

```bash
npm start
# o
node index.js
```

Deberías ver en la consola:
```
🔌 Inicializando servidor WebSocket para comentarios en vivo...
✅ Servidor WebSocket inicializado
🚀 Servidor corriendo en http://localhost:3000
```

### 2. Acceder a la Página

- **Desde navegador local**: http://localhost:3000
- **Desde el mismo WiFi (móvil/tablet)**: http://[TU_IP_LOCAL]:3000

### 3. Usar el Lector de Comentarios

1. Haz clic en el botón **"Comentarios del Live"** en la barra lateral
2. Se abrirá una nueva pestaña con la interfaz
3. Ingresa la URL o ID del video de YouTube
4. Haz clic en **"Iniciar Lectura"**
5. Los comentarios aparecerán en tiempo real

## 📝 Archivos Creados/Modificados

### Nuevos Archivos

| Archivo | Descripción |
|---------|-------------|
| `public/youtube-live-comments.html` | Interfaz web principal (357 líneas) |
| `public/youtube-live-comments.js` | Lógica del cliente WebSocket (347 líneas) |
| `youtube_live_reader.py` | Script Python para pytchat (145 líneas) |

### Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `index.js` | Agregados endpoints `/api/youtube-comments/:videoId` y WebSocket `/live-comments` |
| `public/index.html` | Agregado botón "Comentarios del Live" en la barra lateral |

## 🔌 Endpoints Disponibles

### HTTP (Polling - Alternativa)

```
GET /api/youtube-comments/:videoId
```

**Parámetro:**
- `videoId`: ID del video (11 caracteres) o URL completa

**Respuesta:**
```json
{
  "success": true,
  "videoId": "dQw4w9WgXcQ",
  "totalComments": 42,
  "comments": [
    {
      "author": "Usuario",
      "message": "Comentario aquí",
      "timestamp": "14:32:15"
    }
  ]
}
```

### WebSocket (Real-time - Recomendado)

**Conexión:**
```
ws://localhost:3000/live-comments
```

**Enviar (Iniciar lectura):**
```json
{
  "action": "start",
  "videoId": "dQw4w9WgXcQ"
}
```

**Recibir:**
```json
{
  "type": "comment",
  "author": "Usuario",
  "text": "Comentario",
  "timestamp": "14:32:15",
  "superchat": false,
  "authorImage": "https://..."
}
```

## 🎨 Características de la Interfaz

### Configuración
- Entrada de URL o ID de video
- Intervalo de refresco ajustable
- Limite de comentarios mostrados

### Estadísticas en Vivo
- Total de comentarios capturados
- Usuarios únicos
- Comentarios por minuto

### Visualización
- Lista de comentarios con autor y timestamp
- Indicador de estado de conexión
- Auto-scroll cuando llegan nuevos comentarios
- Protección XSS en mensajes

## 🐛 Solución de Problemas

### Error: "pytchat no encontrado"

```
ModuleNotFoundError: No module named 'pytchat'
```

**Solución:**
```bash
pip install pytchat
```

### Error: "No hay comentarios disponibles"

Posibles causas:
1. El video no es una transmisión en vivo activa
2. YouTube bloqueó la conexión (cambios en su API)
3. Timeout muy corto

**Solución:**
Intenta con otro video en vivo o aumenta el timeout en `youtube_live_reader.py`

### WebSocket se desconecta

**Verificar:**
1. El servidor está corriendo: `npm start`
2. Desde móvil, verifica que estés en el mismo WiFi
3. Revisa que el puerto 3000 no esté bloqueado

### Error: "ID de video inválido"

El sistema acepta:
- URLs: `https://youtube.com/watch?v=...` o `https://youtu.be/...`
- IDs directos: `dQw4w9WgXcQ` (11 caracteres)

## 📊 Monitoreo

Abre la consola (F12) para ver logs en tiempo real:
- Conexiones WebSocket
- Comentarios capturados
- Errores y excepciones
- Proceso Python

## 🔒 Seguridad

- Los mensajes se escapan HTML para prevenir XSS
- Los comentarios se validan antes de mostrarse
- Las conexiones WebSocket se cierran al salir
- Los procesos Python se terminan automáticamente

## 📚 Limitaciones Actuales

1. **YouTube API**: pytchat usa métodos de scraping, sujeto a cambios de YouTube
2. **Rate Limiting**: YouTube puede limitar conexiones frecuentes
3. **WebSocket**: Actualmente sin encriptación (ws, no wss)
4. **Móvil**: El audio/video se reproduce desde el navegador

## 🔮 Mejoras Futuras

- [ ] Usar wss:// para secure WebSocket
- [ ] Guardar comentarios a archivo JSON
- [ ] Exportar a CSV
- [ ] Análisis de sentimiento
- [ ] Subprocesos para múltiples lives simultáneos
- [ ] Autenticación para acceso restringido

## 📖 Documentación Adicional

- [pytchat GitHub](https://github.com/taizan-hokaze/pytchat)
- [WebSocket API MDN](https://developer.mozilla.org/es/docs/Web/API/WebSocket)
- [Express.js Docs](https://expressjs.com/)

---

**Versión:** 1.0  
**Última actualización:** Enero 2026  
**Autor:** GitHub Copilot AI Assistant
