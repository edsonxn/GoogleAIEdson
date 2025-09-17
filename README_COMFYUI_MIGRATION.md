# Migración de Fooocus a ComfyUI + Flux

## ¿Qué cambió?

Tu proyecto ahora usa **ComfyUI con el modelo Flux** en lugar de Fooocus para la generación de imágenes locales. Esto te da:

- ✅ **Mejor calidad de imagen** con el modelo Flux
- ✅ **Mayor control** sobre los parámetros de generación
- ✅ **Mejor estabilidad** y rendimiento
- ✅ **Más opciones de personalización**

## Requisitos previos

### 1. Instalar ComfyUI
```bash
# Clona ComfyUI
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI

# Instala dependencias
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

### 2. Descargar modelo Flux
Descarga el modelo Flux y colócalo en la carpeta `models/checkpoints/` de ComfyUI:
- **Modelo recomendado**: `flux1-dev-fp8.safetensors`
- **Ubicación**: `C:\comfy\ComfyUI\models\checkpoints\flux1-dev-fp8.safetensors`

### 3. Iniciar ComfyUI
```bash
cd ComfyUI
python main.py --listen 127.0.0.1 --port 8188
```

ComfyUI debe estar ejecutándose en `http://127.0.0.1:8188`

## Nuevas funcionalidades

### 1. Endpoint de prueba directo
```bash
# Probar generación de imagen directa
curl -X POST http://localhost:3000/generate-comfyui-image \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a beautiful sunset over mountains, digital art",
    "options": {
      "width": 1280,
      "height": 720,
      "steps": 20,
      "guidance": 3.5
    }
  }'
```

### 2. Verificar estado de ComfyUI
```bash
# Verificar conexión y modelos disponibles
curl http://localhost:3000/comfyui-status
```

### 3. Parámetros configurables
El nuevo sistema te permite ajustar:
- **Resolución**: width/height
- **Calidad**: steps (más pasos = mejor calidad)
- **Velocidad**: steps (menos pasos = más rápido)
- **Guidance**: control de adherencia al prompt
- **Sampler**: método de muestreo
- **Negative prompt**: qué evitar en la imagen

## Configuración en el cliente ComfyUI

### Archivos modificados:
- `comfyui-client.js` - Nuevo cliente para ComfyUI
- `index.js` - Función `generateLocalAIImages()` actualizada
- Endpoints nuevos: `/generate-comfyui-image`, `/comfyui-status`

### Configuración de rendimiento:
```javascript
// Para máxima velocidad (en generateLocalAIImages)
const options = {
  steps: 10,        // Menos pasos
  cfg: 1,           // CFG bajo
  guidance: 2.5     // Guidance menor
};

// Para máxima calidad
const options = {
  steps: 30,        // Más pasos
  cfg: 1,           // CFG standard
  guidance: 4.0     // Guidance mayor
};
```

## Resolución de problemas

### Error: "No se puede conectar a ComfyUI"
1. Verifica que ComfyUI esté ejecutándose en el puerto 8188
2. Ejecuta: `curl http://127.0.0.1:8188/system_stats`
3. Si no responde, reinicia ComfyUI

### Error: "Modelo Flux no encontrado"
1. Verifica que `flux1-dev-fp8.safetensors` esté en `models/checkpoints/`
2. Reinicia ComfyUI después de agregar el modelo
3. Verifica disponibilidad en: `http://localhost:3000/comfyui-status`

### Error: "Timeout en generación"
1. Reduce los `steps` en las opciones
2. Aumenta el `timeout` en la configuración
3. Verifica que tu GPU tenga suficiente VRAM

## Migración desde Fooocus

| Fooocus | ComfyUI + Flux |
|---------|----------------|
| Puerto 3006 | Puerto 8188 |
| WebSocket | HTTP API |
| Configuración limitada | Control total |
| Modelos Fooocus | Modelos Flux |

## Performance esperado

- **Generación típica**: 15-30 segundos por imagen
- **Resolución recomendada**: 1280x720 para balance velocidad/calidad
- **VRAM requerida**: Mínimo 8GB para Flux

## Comandos útiles

```bash
# Iniciar tu aplicación
npm start

# Verificar logs de ComfyUI
tail -f ComfyUI/logs/comfyui.log

# Probar conexión manual
curl http://127.0.0.1:8188/system_stats
```

¡El sistema está listo para generar imágenes de mayor calidad con ComfyUI + Flux! 🎨
