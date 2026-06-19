import express from "express";
import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const PROJECT_ROOT = path.join(__dirname, "..");

// ── Render slot pool ──────────────────────────────────────────────────────────
// Each slot has its own Composition_sN / Root_sN / index_sN files so that
// multiple renders can run concurrently without overwriting shared source files.
const MAX_SLOTS: number = parseInt(process.env.HV_SLOTS || "3");
const _freeSlots = new Set<number>(Array.from({ length: MAX_SLOTS }, (_, i) => i));
const _slotWaiters: Array<(slot: number) => void> = [];

function acquireSlot(): Promise<number> {
  const iter = _freeSlots.values();
  const first = iter.next();
  if (!first.done) { _freeSlots.delete(first.value); return Promise.resolve(first.value); }
  return new Promise(res => _slotWaiters.push(res));
}
function releaseSlot(slot: number) {
  const next = _slotWaiters.shift();
  if (next) next(slot); else _freeSlots.add(slot);
}

// Cargar .env desde el directorio raíz del proyecto principal
const envPath = path.join(PROJECT_ROOT, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    process.env[key.trim()] = rest.join("=").trim();
  }
}

const FREE_KEYS = [
  process.env.GOOGLE_API_KEY_GRATIS,
  process.env.GOOGLE_API_KEY_GRATIS2,
  process.env.GOOGLE_API_KEY_GRATIS3,
  process.env.GOOGLE_API_KEY_GRATIS4,
  process.env.GOOGLE_API_KEY_GRATIS5,
].filter(Boolean) as string[];

const PAID_KEY = process.env.GOOGLE_API_KEY;

const MODEL_FLASH       = "gemini-3.5-flash";
const MODEL_LITE        = "gemini-3.1-flash-lite";
const MODEL_3_FLASH     = "gemini-3-flash-preview";
const MODEL_25_FLASH    = "gemini-2.5-flash";
const MODEL_25_PRO      = "gemini-2.5-pro";
const MODEL_31_PRO      = "gemini-3.1-pro-preview";

const SYSTEM_PROMPT = `Eres un experto en Remotion (framework de video con React).
El usuario te dará una descripción de un video y tú generarás SOLO el código TypeScript/React del componente.

REGLAS ESTRICTAS:
- Exporta el componente principal como: export const MyComposition = () => { ... }
- Usa SOLO estas imports de remotion: AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, Easing
- Para animaciones usa useCurrentFrame() + interpolate(). NUNCA CSS transitions/animations.
- El video es 1280x720 a 30fps. La duración se indica abajo. Usa useVideoConfig() para obtener fps y durationInFrames, y distribuye las animaciones en toda la duración.
- No uses librerías externas que no estén instaladas.
- No uses Tailwind classes para animaciones.
- Responde SOLO con el código, sin explicaciones, sin markdown fences.
- El código debe ser un archivo .tsx completo y válido.
- Usa colores vibrantes y animaciones fluidas.
- Usa Easing.bezier() para movimientos suaves.
- PROHIBIDO usar Img, staticFile, o cualquier imagen/archivo externo. No existen imágenes en el proyecto.
- Dibuja TODO con divs, CSS (bordes, degradados, border-radius, box-shadow), SVG inline o emojis.
- Para representar objetos, animales o personas usa emojis grandes, formas geométricas o SVG paths simples.
- CRÍTICO: NUNCA uses interpolate() directamente. Usa siempre el helper si() que defines al inicio del componente — ordena y deduplica el inputRange automáticamente para evitar errores fatales de render.

PATRONES DE ANIMACIÓN — úsalos según lo que pida el prompt:

▸ LÍNEA PARABÓLICA SVG (conectar dos elementos con trazo que se dibuja):
  const lineProgress = interpolate(frame, [20, 80], [0, 1], { extrapolateRight: 'clamp' });
  const pathLen = 500; // ajusta según distancia real
  // JSX:
  <svg style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',overflow:'visible'}}>
    <path d="M 200,500 Q 640,150 1080,500" fill="none" stroke="#00ffff" strokeWidth={3}
      strokeDasharray={pathLen} strokeDashoffset={pathLen*(1-lineProgress)} />
    <circle cx={200} cy={500} r={8} fill="#00ffff" />
    <circle cx={1080} cy={500} r={8} fill="#ff4444" opacity={lineProgress>0.9?1:0} />
  </svg>

▸ CAMERA PAN (mover la escena entera para ir de elemento a elemento):
  const camX = interpolate(frame, [0, 60, 150, 210], [0, 0, -400, -400], { extrapolateRight: 'clamp' });
  const camScale = interpolate(frame, [0, 60, 150, 210], [1, 1.2, 1.2, 1], { extrapolateRight: 'clamp' });
  // Wrap toda la escena:
  <div style={{transform:\`translate(\${camX}px,0) scale(\${camScale})\`, transformOrigin:'center center', width:'100%', height:'100%'}}>
    {/* elementos de la escena */}
  </div>

▸ TYPEWRITER (texto que aparece carácter a carácter con cursor):
  const text = "El sujeto fue visto por última vez...";
  const charsVisible = Math.floor(interpolate(frame, [20, 90], [0, text.length], { extrapolateRight: 'clamp' }));
  // JSX:
  <div style={{fontFamily:'monospace', color:'#fff', fontSize:32}}>
    {text.slice(0, charsVisible)}<span style={{opacity: frame%20<10?1:0}}>|</span>
  </div>

▸ RADAR PING (círculos expansivos desde un punto — marcar ubicación en mapa):
  const ping1 = interpolate(frame%60, [0,60], [0,1], { extrapolateRight: 'clamp' });
  const ping2 = interpolate((frame+20)%60, [0,60], [0,1], { extrapolateRight: 'clamp' });
  // JSX dentro de <svg>:
  <circle cx={640} cy={360} r={ping1*80} fill="none" stroke="#00ffff" strokeWidth={2} opacity={1-ping1} />
  <circle cx={640} cy={360} r={ping2*80} fill="none" stroke="#00ffff" strokeWidth={2} opacity={1-ping2} />
  <circle cx={640} cy={360} r={7} fill="#00ffff" />

▸ CONTADOR NUMÉRICO (número que sube hasta un valor — fechas, estadísticas):
  const value = Math.floor(interpolate(frame, [30, 120], [0, 1847], { extrapolateRight: 'clamp' }));
  // JSX:
  <div style={{fontSize:120, fontWeight:900, color:'#ff4444', fontVariantNumeric:'tabular-nums'}}>
    {value.toLocaleString()}
  </div>

▸ STAGGER ENTRANCE (lista de elementos aparecen uno tras otro):
  {['Elemento A','Elemento B','Elemento C'].map((item,i) => {
    const op = interpolate(frame,[i*20, i*20+15],[0,1],{extrapolateRight:'clamp'});
    const ty = interpolate(frame,[i*20, i*20+15],[30,0],{extrapolateRight:'clamp'});
    return <div key={i} style={{opacity:op, transform:\`translateY(\${ty}px)\`}}>{item}</div>;
  })}

▸ SPOTLIGHT SWEEP (overlay oscuro con círculo de luz que se mueve y revela):
  const spotX = interpolate(frame, [0, 90, 180], [200, 640, 1080], { extrapolateRight: 'clamp' });
  const spotR = interpolate(frame, [0, 30], [0, 260], { extrapolateRight: 'clamp' });
  // JSX (encima de todo):
  <div style={{position:'absolute',inset:0,background:\`radial-gradient(circle \${spotR}px at \${spotX}px 360px, transparent 0%, rgba(0,0,0,0.93) 100%)\`,pointerEvents:'none'}} />

▸ GLITCH FLICKER (aparición con ruido digital y desplazamiento lateral):
  const gPhase = Math.floor(frame/2)%5;
  const gOp = frame<20 ? (gPhase<3?1:0) : 1;
  const gX  = frame<20 ? (gPhase===1?-4:gPhase===3?3:0) : 0;
  // JSX:
  <div style={{opacity:gOp, transform:\`translateX(\${gX}px)\`, filter:frame<20?'hue-rotate(90deg)':'none'}}>
    {/* contenido */}
  </div>

▸ ESCENAS EN MÚLTIPLES ACTOS (cuando el prompt empieza con "ACTOS: N"):
  El prompt indica el número de actos con el prefijo "ACTOS: N" (N = 1, 2 o 3).
  Lee N del prompt y divide durationInFrames en N zonas iguales con transiciones suaves.

  SIEMPRE usa este helper al inicio del componente para evitar errores de interpolate con rangos inválidos:
  const si = (f: number, inp: number[], out: number[], opts?: any) => {
    if (typeof f !== 'number' || !isFinite(f)) return out[0] ?? 0;
    const pairs = inp.map((v, i) => [v, out[i]] as [number, number]);
    pairs.sort((a, b) => a[0] - b[0]);
    const deduped = pairs.filter((p, i) => i === 0 || p[0] > pairs[i-1][0]);
    return interpolate(f, deduped.map(p => p[0]), deduped.map(p => p[1]), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', ...opts });
  };
  REGLA CRÍTICA ANTI-CRASH: El primer argumento de si() SIEMPRE debe ser frame, frame % N, o una expresión aritmética de frame. NUNCA pases una variable de objeto, prop, o resultado de array.find() como primer argumento — puede ser undefined y crashea el render.

  // Para N=1 (un solo acto): anima todo el clip sin zonas
  // Para N=2:
  const T = 18;
  const z1 = Math.floor(durationInFrames / 2);
  const act1Op = si(frame, [0, T, Math.max(T+1, z1-T), z1], [0,1,1,0], { extrapolateRight:'clamp' });
  const act2Op = si(frame, [z1, z1+T, Math.max(z1+T+1, durationInFrames-8), durationInFrames], [0,1,1,0], { extrapolateRight:'clamp' });
  // Para N=3:
  const z1_3 = Math.floor(durationInFrames / 3);
  const z2_3 = Math.floor(2 * durationInFrames / 3);
  const act1Op3 = si(frame, [0, T, Math.max(T+1, z1_3-T), z1_3], [0,1,1,0], { extrapolateRight:'clamp' });
  const act2Op3 = si(frame, [z1_3, z1_3+T, Math.max(z1_3+T+1, z2_3-T), z2_3], [0,1,1,0], { extrapolateRight:'clamp' });
  const act3Op3 = si(frame, [z2_3, z2_3+T, Math.max(z2_3+T+1, durationInFrames-8), durationInFrames], [0,1,1,0], { extrapolateRight:'clamp' });
  // Cada acto es un <div style={{position:'absolute',inset:0,opacity:actXOp}}> con su propio contenido.
  // Las animaciones internas de cada acto TAMBIÉN usan si() en lugar de interpolate() para evitar el error.
  // NUNCA uses interpolate() directamente — siempre si() que garantiza inputRange creciente.

TEXTOS — REGLA OBLIGATORIA:
- Todos los textos visibles en la animación DEBEN estar en ESPAÑOL
- Labels, títulos, subtítulos y fechas siempre en español (ej: "ALIANZA ROTA", "MUERTA EN 24 HORAS", no "ALLIANCE DISSOLVED")
- Si el prompt dice un texto en inglés, tradúcelo al español en el código

EJEMPLOS COMPLETOS — modela tu código según estos:

EJEMPLO 1 (escena de acción — hombre en callejón):
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const NEON = '#00ffff';
  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 15, durationInFrames - 2], [1, 0], { extrapolateRight: 'clamp' });
  const gPhase = Math.floor(frame / 2) % 6;
  const isGlitch = frame < 30;
  const gX = isGlitch ? (gPhase === 1 ? -5 : gPhase === 3 ? 4 : 0) : 0;
  const gOp = isGlitch ? (gPhase < 4 ? 1 : 0) : 1;
  const titleScale = interpolate(frame, [8, 35], [1.1, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const subOp = interpolate(frame, [38, 58], [0, 1], { extrapolateRight: 'clamp' });
  const lineW = interpolate(frame, [50, 80], [0, 70], { extrapolateRight: 'clamp' });
  const footerOp = interpolate(frame, [65, 85], [0, 1], { extrapolateRight: 'clamp' });
  const scanY = (frame * 5) % 720;
  const grain = Math.floor(frame / 3) % 3;
  const bgGrain = grain === 0 ? 'rgba(255,255,255,0.015)' : grain === 1 ? 'rgba(0,0,0,0.02)' : 'transparent';
  return (
    <AbsoluteFill style={{ backgroundColor: '#040810', opacity: fadeIn * fadeOut, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 90% 60% at 50% 50%, ' + NEON + '08 0%, transparent 70%)' }} />
      <div style={{ position: 'absolute', inset: 0, backgroundColor: bgGrain }} />
      <div style={{ position: 'absolute', top: scanY, left: 0, right: 0, height: 2, background: NEON + '18', pointerEvents: 'none' }} />
      <div style={{ opacity: gOp, transform: 'translateX(' + gX + 'px) scale(' + titleScale + ')', textAlign: 'center' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 80, fontWeight: 900, letterSpacing: 6, color: NEON, textShadow: '0 0 30px ' + NEON + ', 0 0 60px ' + NEON + '55', lineHeight: 1 }}>EL CALLEJÓN</div>
      </div>
      <div style={{ height: 3, width: lineW + '%', background: 'linear-gradient(90deg, transparent, ' + NEON + ', #ff4444, transparent)', boxShadow: '0 0 10px ' + NEON, margin: '20px auto' }} />
      <div style={{ opacity: subOp, fontFamily: 'monospace', fontSize: 22, letterSpacing: 3, color: '#ccc', textAlign: 'center' }}>Un hombre camina solo en la oscuridad</div>
      <div style={{ position: 'absolute', bottom: 55, left: 0, right: 0, textAlign: 'center', opacity: footerOp, fontFamily: 'monospace', fontSize: 13, letterSpacing: 5, color: '#ff4444aa' }}>SUJETO NO IDENTIFICADO</div>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.07) 3px, rgba(0,0,0,0.07) 4px)', pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};

EJEMPLO 2 (presentar personaje con ruta geográfica):
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const NEON = '#00ffff';
  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 15, durationInFrames - 2], [1, 0], { extrapolateRight: 'clamp' });
  const siloOp = interpolate(frame, [10, 40], [0, 1], { extrapolateRight: 'clamp' });
  const siloScale = interpolate(frame, [10, 45], [0.82, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const glow = 0.5 + 0.5 * Math.sin(frame / 18);
  const lineP = interpolate(frame, [30, 90], [0, 1], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad) });
  const pathLen = 600;
  const nameChars = Math.floor(interpolate(frame, [50, 90], [0, 5], { extrapolateRight: 'clamp' }));
  const labelOp = interpolate(frame, [88, 108], [0, 1], { extrapolateRight: 'clamp' });
  const ping1 = interpolate(frame % 45, [0, 45], [0, 1], { extrapolateRight: 'clamp' });
  const ping2 = interpolate((frame + 18) % 45, [0, 45], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: '#030c14', opacity: fadeIn * fadeOut }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 55% 50% at 28% 50%, ' + NEON + '0f 0%, transparent 65%)' }} />
      <div style={{ position: 'absolute', left: 90, top: '50%', transform: 'translateY(-55%)', opacity: siloOp }}>
        <div style={{ width: 130, height: 185, background: 'linear-gradient(180deg, ' + NEON + '44 0%, #000 100%)', borderRadius: '46% 54% 28% 32% / 42% 38% 62% 58%', transform: 'scale(' + siloScale + ')', boxShadow: '0 0 ' + Math.round(25 * glow) + 'px ' + NEON + '55', border: '2px solid ' + NEON }} />
        <div style={{ marginTop: 14, fontFamily: 'monospace', fontSize: 26, fontWeight: 900, letterSpacing: 5, color: NEON, textShadow: '0 0 15px ' + NEON }}>{'THRALL'.slice(0, nameChars)}</div>
      </div>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
        <path d="M 500,360 Q 760,160 1100,360" fill="none" stroke={NEON} strokeWidth={2} strokeDasharray={pathLen} strokeDashoffset={pathLen * (1 - lineP)} strokeLinecap="round" />
        <circle cx={500} cy={360} r={7} fill={NEON} opacity={lineP > 0.05 ? 1 : 0} />
        <circle cx={1100} cy={360} r={ping1 * 50} fill="none" stroke={NEON} strokeWidth={1.5} opacity={(1 - ping1) * labelOp} />
        <circle cx={1100} cy={360} r={ping2 * 50} fill="none" stroke={NEON} strokeWidth={1.5} opacity={(1 - ping2) * labelOp} />
        <circle cx={1100} cy={360} r={7} fill="#ff4444" opacity={labelOp} />
      </svg>
      <div style={{ position: 'absolute', right: 90, top: '50%', transform: 'translateY(-50%)', textAlign: 'right', opacity: labelOp }}>
        <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: '#ff4444', letterSpacing: 3, textShadow: '0 0 10px #ff4444' }}>KALIMDOR</div>
        <div style={{ width: 50, height: 2, background: '#ff4444', marginTop: 8, marginLeft: 'auto', boxShadow: '0 0 6px #ff4444' }} />
      </div>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.07) 3px, rgba(0,0,0,0.07) 4px)', pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};
`;

const SYSTEM_PROMPT_WITH_IMAGES = SYSTEM_PROMPT
  .replace(
    '- PROHIBIDO usar Img, staticFile, o cualquier imagen/archivo externo. No existen imágenes en el proyecto.\n- Dibuja TODO con divs, CSS (bordes, degradados, border-radius, box-shadow), SVG inline o emojis.\n- Para representar objetos, animales o personas usa emojis grandes, formas geométricas o SVG paths simples.',
    '- Tienes imágenes reales disponibles vía staticFile() — úsalas como parte central de la animación.\n- Importa: import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing } from \'remotion\';\n- Usa <Img> de remotion (NO <img> HTML). Combina las imágenes con overlays CSS, texto animado y efectos de opacidad/zoom/posición.\n- Dibuja elementos adicionales con divs, CSS, SVG inline o emojis encima de las imágenes.\n- ANTI-CRASH CRÍTICO: staticFile() SOLO acepta string literal — NUNCA variables. Escribe staticFile(\'nombre-exacto.png\') con el nombre del asset directamente. NUNCA staticFile(variable) ni staticFile(props.src) ni staticFile(asset?.filename).'
  );

const OLLAMA_SYSTEM_PROMPT = `Eres un experto en Remotion (framework de video con React).
Genera SOLO código TypeScript/React válido para un componente Remotion. Sin explicaciones, sin markdown, solo código.

REGLAS CRÍTICAS — ERRORES QUE DEBES EVITAR:

1. EXPORT: Solo UNA definición del componente principal. Escríbelo directamente exportado:
   CORRECTO:   export const MyComposition = () => { return <AbsoluteFill>...</AbsoluteFill>; };
   INCORRECTO: const MyComposition = () => {...}; export const MyComposition = () => <MyComposition />;

2. JSX: Cierra SIEMPRE todos los tags. En .map() verifica que cada elemento tenga su cierre:
   CORRECTO:   {items.map((_, i) => <div key={i}>contenido</div>)}
   INCORRECTO: {items.map((_, i) => <div key={i}>contenido)}

3. NUNCA uses interpolate() directamente — usa siempre el helper si() definido en el componente.
   si() garantiza que el inputRange sea creciente incluso si los valores calculados se solapan.
   CORRECTO:   si(frame, [0, 30, 60], [0, 1, 0], { extrapolateRight: 'clamp' })
   INCORRECTO: interpolate(frame, [z2, z2+T, dur-T, dur], ...)  ← puede romper si z2+T > dur-T
   Solo acepta estas opciones: extrapolateLeft, extrapolateRight, easing.

4. Easing: Solo usa Easing.bezier(x1,y1,x2,y2), Easing.linear, Easing.ease, Easing.in(Easing.quad), Easing.out(Easing.quad), Easing.inOut(Easing.quad).
   CORRECTO:   Easing.out(Easing.quad)
   INCORRECTO: Easing.outQuad

5. Valores numéricos: interpolate() trabaja con números, no strings.
   CORRECTO:   interpolate(frame, [0, 30], [0, 100])  → resultado en px
   INCORRECTO: interpolate(frame, [0, 30], ['0px', '100px'])

6. Imports: SOLO estas de remotion: AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, Easing
   Agrega: import React from 'react';

7. NO uses: CSS transitions, CSS animations, Img, staticFile, imágenes externas, Math.random() fuera de useMemo.

8. PATRONES DISPONIBLES — aplícalos según el prompt:
   - Línea parabólica SVG: <path d="M x1,y1 Q cx,cy x2,y2"> con strokeDashoffset animado para trazar la línea
   - Camera pan: wrapper <div> con transform:translate/scale interpolado para mover la escena
   - Typewriter: text.slice(0, Math.floor(interpolate(frame,...))) + cursor parpadeante
   - Radar ping: <circle r={interpolate(frame%60,...)*80} opacity={1-interpolate(...)}> en SVG
   - Contador: Math.floor(interpolate(frame,[a,b],[0,target])) mostrado como número
   - Stagger: items.map((x,i) => interpolate(frame,[i*20,i*20+15],[0,1])) para entrada en cascada
   - Spotlight: radial-gradient overlay oscuro con radio animado que revela la zona iluminada
   - Glitch flicker: opacity y translateX alternando en los primeros frames + hue-rotate

EJEMPLO MÍNIMO VÁLIDO:
import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate, Easing } from 'remotion';

export const MyComposition = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ color: '#fff', fontSize: 80, opacity }}>Hola</div>
    </AbsoluteFill>
  );
};
`;

const TOKEN_PRICES: Record<string, { input: number; output: number }> = {
  [MODEL_FLASH]:    { input: 1.50, output: 9.00  },
  [MODEL_LITE]:     { input: 0.25, output: 1.50  },
  [MODEL_3_FLASH]:  { input: 0.50, output: 3.00  },
  [MODEL_25_FLASH]: { input: 0.30, output: 2.50  },
  [MODEL_25_PRO]:   { input: 1.25, output: 10.00 },
  [MODEL_31_PRO]:   { input: 2.00, output: 12.00 },
};

const USD_TO_MXN = 17;

function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = TOKEN_PRICES[model] ?? TOKEN_PRICES[MODEL_LITE];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000 * USD_TO_MXN;
}

function buildDimNote(width: number, height: number): string {
  if (width === 1280 && height === 720) return '';
  const orient = height > width
    ? ' Formato VERTICAL (9:16 portrait): aprovecha toda la altura, centra el contenido en el ancho reducido.'
    : '';
  return `\n\nIMPORTANTE: Las dimensiones reales del video son ${width}x${height} (NO 1280x720). Diseña el layout para estas dimensiones exactas.${orient}`;
}

async function tryWithKey(
  apiKey: string, model: string, prompt: string, durationSeconds: number, timeoutMs = 30000, width = 1280, height = 720, systemPrompt = SYSTEM_PROMPT
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const ai = new GoogleGenAI({ apiKey });
  const durationPrompt = `${systemPrompt}${buildDimNote(width, height)}\n\nDuración del video: ${durationSeconds} segundos (${durationSeconds * 30} frames a 30fps). Distribuye las animaciones en toda la duración.\n\nDescripción del video:\n${prompt}`;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), timeoutMs)
  );
  const response = await Promise.race([
    ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: durationPrompt }] }],
    }),
    timeout,
  ]);
  return {
    text: response.text ?? "",
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

async function tryWithOllama(prompt: string, durationSeconds: number, width = 1280, height = 720, ollamaModel = "gemma4"): Promise<string> {
  const durationPrompt = `${OLLAMA_SYSTEM_PROMPT}${buildDimNote(width, height)}\n\nDuración del video: ${durationSeconds} segundos (${durationSeconds * 30} frames a 30fps). Distribuye TODAS las animaciones usando interpolate() con frame como variable, desde frame 0 hasta frame ${durationSeconds * 30}.\n\nDescripción del video:\n${prompt}`;
  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      messages: [{ role: "user", content: durationPrompt }],
      stream: false,
    }),
    signal: AbortSignal.timeout(600000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json() as any;
  return data.message?.content ?? "";
}

// ─── Template System ──────────────────────────────────────────────────────────

interface RTemplate {
  id: string;
  name: string;
  description: string;
  vars: Array<{ name: string; hint: string }>;
  code: string;
}

const TEMPLATES: RTemplate[] = [
  {
    id: 'silhouette_reveal',
    name: 'Silueta con Typewriter',
    description: 'Silueta oscura de un personaje/sujeto con glow de neón y texto typewriter. Ideal para presentar a una persona, personaje o figura clave.',
    vars: [
      { name: 'SUBJECT', hint: 'Nombre del personaje en MAYÚSCULAS, máx 20 chars' },
      { name: 'SUBTITLE', hint: 'Rol o descripción breve, máx 30 chars, en MAYÚSCULAS' },
      { name: 'NEON_COLOR', hint: 'Color hex del glow, ej: #00ffff o #ff4444 o #00ff88' },
      { name: 'ACCENT_COLOR', hint: 'Color hex de contraste, ej: #ff4444' },
    ],
    code: `import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const NEON = '{{NEON_COLOR}}';
  const ACCENT = '{{ACCENT_COLOR}}';
  const subject = '{{SUBJECT}}';
  const subtitle = '{{SUBTITLE}}';
  const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 15, durationInFrames - 2], [1, 0], { extrapolateRight: 'clamp' });
  const totalOp = fadeIn * fadeOut;
  const siloScale = interpolate(frame, [10, 50], [0.82, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const siloOp = interpolate(frame, [10, 45], [0, 1], { extrapolateRight: 'clamp' });
  const glow = 0.5 + 0.5 * Math.sin(frame / 20);
  const chars = Math.floor(interpolate(frame, [45, 90], [0, subject.length], { extrapolateRight: 'clamp' }));
  const cursor = Math.floor(frame / 8) % 2;
  const subOp = interpolate(frame, [85, 105], [0, 1], { extrapolateRight: 'clamp' });
  const lineW = interpolate(frame, [88, 118], [0, 80], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: '#050912', opacity: totalOp }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 55% at 50% 45%, ' + NEON + '1a 0%, transparent 70%)', opacity: glow }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -60%) scale(' + siloScale + ')', opacity: siloOp, width: 160, height: 220, background: 'linear-gradient(180deg, ' + NEON + '33 0%, #000 100%)', borderRadius: '48% 52% 28% 32% / 42% 38% 62% 58%', boxShadow: '0 0 ' + Math.round(28 * glow) + 'px ' + Math.round(12 * glow) + 'px ' + NEON + '55', border: '2px solid ' + NEON }} />
      <div style={{ position: 'absolute', bottom: '40%', left: 0, right: 0, textAlign: 'center', fontFamily: 'monospace', fontSize: 48, fontWeight: 900, letterSpacing: 8, color: NEON, textShadow: '0 0 20px ' + NEON + ', 0 0 40px ' + NEON + '88', opacity: siloOp }}>
        {subject.slice(0, chars)}{chars < subject.length ? (cursor ? '_' : '') : ''}
      </div>
      <div style={{ position: 'absolute', bottom: 'calc(40% - 14px)', left: '50%', transform: 'translateX(-50%)', height: 2, width: lineW + '%', background: 'linear-gradient(90deg, transparent, ' + NEON + ', ' + ACCENT + ', transparent)', boxShadow: '0 0 8px ' + NEON }} />
      <div style={{ position: 'absolute', bottom: '31%', left: 0, right: 0, textAlign: 'center', fontFamily: 'monospace', fontSize: 17, letterSpacing: 5, color: ACCENT, opacity: subOp, textTransform: 'uppercase' }}>{subtitle}</div>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.07) 3px, rgba(0,0,0,0.07) 4px)', pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};`,
  },
  {
    id: 'map_route',
    name: 'Ruta en Mapa',
    description: 'Mapa oscuro minimalista con línea parabólica animada entre dos puntos y radar ping en el destino. Ideal para viajes, movimientos geográficos, rutas.',
    vars: [
      { name: 'LOCATION_FROM', hint: 'Nombre del punto de origen, máx 20 chars' },
      { name: 'LOCATION_TO', hint: 'Nombre del destino, máx 20 chars' },
      { name: 'DATE_LABEL', hint: 'Fecha o contexto temporal, ej: 14 SEP 1998' },
      { name: 'NEON_COLOR', hint: 'Color de la ruta, ej: #00ffff' },
    ],
    code: `import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const NEON = '{{NEON_COLOR}}';
  const fromLabel = '{{LOCATION_FROM}}';
  const toLabel = '{{LOCATION_TO}}';
  const dateLabel = '{{DATE_LABEL}}';
  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 15, durationInFrames - 2], [1, 0], { extrapolateRight: 'clamp' });
  const lineProgress = interpolate(frame, [25, 95], [0, 1], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad) });
  const pathLen = 680;
  const fromOp = interpolate(frame, [15, 35], [0, 1], { extrapolateRight: 'clamp' });
  const toOp = interpolate(frame, [90, 110], [0, 1], { extrapolateRight: 'clamp' });
  const dateOp = interpolate(frame, [100, 120], [0, 1], { extrapolateRight: 'clamp' });
  const ping1 = interpolate(frame % 45, [0, 45], [0, 1], { extrapolateRight: 'clamp' });
  const ping2 = interpolate((frame + 18) % 45, [0, 45], [0, 1], { extrapolateRight: 'clamp' });
  const pingOp = toOp;
  const gridOp = interpolate(frame, [0, 30], [0, 0.15], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: '#020b14', opacity: fadeIn * fadeOut }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: gridOp }}>
        {Array.from({ length: 12 }).map((_, i) => <line key={'h' + i} x1="0" y1={i * 60} x2="1280" y2={i * 60} stroke={NEON} strokeWidth="0.5" />)}
        {Array.from({ length: 22 }).map((_, i) => <line key={'v' + i} x1={i * 62} y1="0" x2={i * 62} y2="720" stroke={NEON} strokeWidth="0.5" />)}
      </svg>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
        <path d="M 180,380 Q 640,120 1100,380" fill="none" stroke={NEON} strokeWidth={2.5} strokeDasharray={pathLen} strokeDashoffset={pathLen * (1 - lineProgress)} strokeLinecap="round" />
        <circle cx={180} cy={380} r={7} fill={NEON} opacity={fromOp} />
        <circle cx={1100} cy={380} r={7} fill={NEON} opacity={toOp} />
        <circle cx={1100} cy={380} r={ping1 * 55} fill="none" stroke={NEON} strokeWidth={1.5} opacity={(1 - ping1) * pingOp} />
        <circle cx={1100} cy={380} r={ping2 * 55} fill="none" stroke={NEON} strokeWidth={1.5} opacity={(1 - ping2) * pingOp} />
      </svg>
      <div style={{ position: 'absolute', left: 80, top: '50%', transform: 'translateY(-50%)', opacity: fromOp }}>
        <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: NEON, letterSpacing: 3, textShadow: '0 0 12px ' + NEON }}>{fromLabel}</div>
        <div style={{ width: 40, height: 2, background: NEON, marginTop: 6, boxShadow: '0 0 6px ' + NEON }} />
      </div>
      <div style={{ position: 'absolute', right: 80, top: '50%', transform: 'translateY(-50%)', textAlign: 'right', opacity: toOp }}>
        <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: '#ff4444', letterSpacing: 3, textShadow: '0 0 12px #ff4444' }}>{toLabel}</div>
        <div style={{ width: 40, height: 2, background: '#ff4444', marginTop: 6, marginLeft: 'auto', boxShadow: '0 0 6px #ff4444' }} />
      </div>
      <div style={{ position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', opacity: dateOp, fontFamily: 'monospace', fontSize: 16, color: '#aaa', letterSpacing: 4, textTransform: 'uppercase' }}>{dateLabel}</div>
    </AbsoluteFill>
  );
};`,
  },
  {
    id: 'data_counter',
    name: 'Contador de Datos',
    description: 'Número grande que cuenta hasta un valor, con label y lista de hechos en cascada. Ideal para estadísticas, cifras, montos, cantidades.',
    vars: [
      { name: 'STAT_NUMBER', hint: 'Número final a mostrar, solo dígitos, ej: 42000' },
      { name: 'STAT_LABEL', hint: 'Qué representa el número, ej: VÍCTIMAS o DÓLARES' },
      { name: 'FACT_1', hint: 'Primer hecho, máx 40 chars' },
      { name: 'FACT_2', hint: 'Segundo hecho, máx 40 chars' },
      { name: 'FACT_3', hint: 'Tercer hecho, máx 40 chars' },
    ],
    code: `import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const target = {{STAT_NUMBER}};
  const label = '{{STAT_LABEL}}';
  const facts = ['{{FACT_1}}', '{{FACT_2}}', '{{FACT_3}}'];
  const fadeIn = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 12, durationInFrames - 2], [1, 0], { extrapolateRight: 'clamp' });
  const countEnd = Math.min(90, durationInFrames - 30);
  const value = Math.floor(interpolate(frame, [20, countEnd], [0, target], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) }));
  const counterScale = interpolate(frame, [20, countEnd + 10], [0.8, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const labelOp = interpolate(frame, [30, 50], [0, 1], { extrapolateRight: 'clamp' });
  const lineW = interpolate(frame, [45, 75], [0, 60], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: '#060a0f', opacity: fadeIn * fadeOut, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 70% 50% at 50% 40%, #ff000011 0%, transparent 70%)' }} />
      <div style={{ transform: 'scale(' + counterScale + ')', textAlign: 'center' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 130, fontWeight: 900, color: '#ff4444', textShadow: '0 0 30px #ff4444, 0 0 60px #ff444466', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {value.toLocaleString()}
        </div>
      </div>
      <div style={{ opacity: labelOp, marginTop: 8, textAlign: 'center' }}>
        <div style={{ height: 3, width: lineW + '%', background: 'linear-gradient(90deg, transparent, #ff4444, transparent)', boxShadow: '0 0 10px #ff4444', margin: '0 auto 14px' }} />
        <div style={{ fontFamily: 'monospace', fontSize: 22, letterSpacing: 8, color: '#ff8888', textTransform: 'uppercase' }}>{label}</div>
      </div>
      <div style={{ position: 'absolute', bottom: 60, left: 80, right: 80 }}>
        {facts.map((fact, i) => {
          const op = interpolate(frame, [70 + i * 18, 88 + i * 18], [0, 1], { extrapolateRight: 'clamp' });
          const tx = interpolate(frame, [70 + i * 18, 88 + i * 18], [30, 0], { extrapolateRight: 'clamp' });
          return <div key={i} style={{ opacity: op, transform: 'translateX(' + tx + 'px)', fontFamily: 'monospace', fontSize: 15, color: '#88aacc', marginBottom: 10, paddingLeft: 16, borderLeft: '2px solid #334' }}>{'▸ ' + fact}</div>;
        })}
      </div>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)', pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};`,
  },
  {
    id: 'glitch_title',
    name: 'Título con Glitch',
    description: 'Título dramático que aparece con efecto glitch digital. Subtítulo y etiqueta de categoría. Uso general para cualquier tema sin elemento claro.',
    vars: [
      { name: 'TITLE', hint: 'Título principal en MAYÚSCULAS, máx 25 chars' },
      { name: 'SUBTITLE', hint: 'Subtítulo, máx 40 chars' },
      { name: 'TAG', hint: 'Etiqueta corta tipo categoría, ej: CASO #447 o CLASIFICADO' },
      { name: 'NEON_COLOR', hint: 'Color principal, ej: #00ffff o #ff4444' },
    ],
    code: `import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const NEON = '{{NEON_COLOR}}';
  const title = '{{TITLE}}';
  const subtitle = '{{SUBTITLE}}';
  const tag = '{{TAG}}';
  const fadeIn = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 15, durationInFrames - 2], [1, 0], { extrapolateRight: 'clamp' });
  const gPhase = Math.floor(frame / 2) % 6;
  const isGlitching = frame < 35;
  const gOp = isGlitching ? (gPhase < 4 ? 1 : 0) : 1;
  const gX = isGlitching ? (gPhase === 1 ? -5 : gPhase === 3 ? 4 : 0) : 0;
  const gFilter = isGlitching && gPhase === 2 ? 'hue-rotate(120deg)' : 'none';
  const titleScale = interpolate(frame, [10, 40], [1.08, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const subOp = interpolate(frame, [40, 60], [0, 1], { extrapolateRight: 'clamp' });
  const tagOp = interpolate(frame, [15, 30], [0, 1], { extrapolateRight: 'clamp' });
  const lineW = interpolate(frame, [55, 85], [0, 70], { extrapolateRight: 'clamp' });
  const scanY = (frame * 4) % 720;
  return (
    <AbsoluteFill style={{ backgroundColor: '#040810', opacity: fadeIn * fadeOut, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 60% at 50% 50%, ' + NEON + '0d 0%, transparent 70%)' }} />
      <div style={{ position: 'absolute', top: scanY, left: 0, right: 0, height: 2, background: NEON + '22', pointerEvents: 'none' }} />
      <div style={{ opacity: tagOp, fontFamily: 'monospace', fontSize: 13, letterSpacing: 6, color: NEON + 'aa', textTransform: 'uppercase', marginBottom: 20 }}>{tag}</div>
      <div style={{ opacity: gOp * fadeIn, transform: 'translateX(' + gX + 'px) scale(' + titleScale + ')', filter: gFilter, textAlign: 'center' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 72, fontWeight: 900, letterSpacing: 6, color: NEON, textShadow: '0 0 25px ' + NEON + ', 0 0 50px ' + NEON + '55', lineHeight: 1.1 }}>{title}</div>
      </div>
      <div style={{ height: 3, width: lineW + '%', background: 'linear-gradient(90deg, transparent, ' + NEON + ', transparent)', boxShadow: '0 0 10px ' + NEON, margin: '18px auto' }} />
      <div style={{ opacity: subOp, fontFamily: 'monospace', fontSize: 20, letterSpacing: 3, color: '#ccc', textAlign: 'center', maxWidth: 700 }}>{subtitle}</div>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 3px)', pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};`,
  },
  {
    id: 'classified_doc',
    name: 'Documento Clasificado',
    description: 'Documento secreto/oficial con líneas de texto que aparecen progresivamente y sello de clasificación. Ideal para información secreta, expedientes, investigaciones.',
    vars: [
      { name: 'TITLE', hint: 'Título del documento en MAYÚSCULAS, ej: EXPEDIENTE 44-B' },
      { name: 'LINE_1', hint: 'Primera línea de datos, máx 45 chars' },
      { name: 'LINE_2', hint: 'Segunda línea de datos, máx 45 chars' },
      { name: 'LINE_3', hint: 'Tercera línea de datos, máx 45 chars' },
      { name: 'STAMP', hint: 'Texto del sello, ej: CLASIFICADO o CONFIDENCIAL' },
    ],
    code: `import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const lines = ['{{LINE_1}}', '{{LINE_2}}', '{{LINE_3}}'];
  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 15, durationInFrames - 2], [1, 0], { extrapolateRight: 'clamp' });
  const titleOp = interpolate(frame, [15, 35], [0, 1], { extrapolateRight: 'clamp' });
  const dividerW = interpolate(frame, [30, 55], [0, 100], { extrapolateRight: 'clamp' });
  const stampOp = interpolate(frame, [20, 40], [0, 1], { extrapolateRight: 'clamp' });
  const stampRot = interpolate(frame, [20, 40], [-8, -6], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: '#070a06', opacity: fadeIn * fadeOut, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 28px, rgba(255,255,255,0.02) 28px, rgba(255,255,255,0.02) 29px)' }} />
      <div style={{ position: 'relative', width: 680, padding: '40px 50px', border: '1px solid #334', background: 'rgba(0,8,0,0.85)' }}>
        <div style={{ position: 'absolute', top: -1, left: -1, right: -1, height: 3, background: 'linear-gradient(90deg, #ff4444, #ff8800)' }} />
        <div style={{ opacity: titleOp }}>
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#556', letterSpacing: 3, marginBottom: 10 }}>ARCHIVO CONFIDENCIAL — REF. {{TITLE}}</div>
          <div style={{ height: dividerW / 100 > 0 ? 1 : 0, width: dividerW + '%', background: '#ff4444', marginBottom: 24, boxShadow: '0 0 6px #ff4444' }} />
        </div>
        {lines.map((line, i) => {
          const op = interpolate(frame, [50 + i * 22, 68 + i * 22], [0, 1], { extrapolateRight: 'clamp' });
          const chars = Math.floor(interpolate(frame, [50 + i * 22, 72 + i * 22], [0, line.length], { extrapolateRight: 'clamp' }));
          return (
            <div key={i} style={{ opacity: op, marginBottom: 16, display: 'flex', gap: 12 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#ff4444', minWidth: 20 }}>{String(i + 1).padStart(2, '0')}.</span>
              <span style={{ fontFamily: 'monospace', fontSize: 15, color: '#c8d8c0', letterSpacing: 1 }}>{line.slice(0, chars)}{chars < line.length ? '▮' : ''}</span>
            </div>
          );
        })}
        <div style={{ position: 'absolute', top: 30, right: 40, opacity: stampOp, transform: 'rotate(' + stampRot + 'deg)', border: '3px solid #ff4444', padding: '6px 14px', fontFamily: 'monospace', fontSize: 18, fontWeight: 900, color: '#ff4444', letterSpacing: 4, textShadow: '0 0 8px #ff4444', boxShadow: '0 0 10px #ff444455, inset 0 0 10px #ff444522' }}>{'{{STAMP}}'}</div>
      </div>
    </AbsoluteFill>
  );
};`,
  },
  {
    id: 'location_pin',
    name: 'Revelación de Ubicación',
    description: 'Nombre de ciudad/lugar con ping de radar y coordenadas. Ideal para revelar una ubicación, lugar del crimen, escena, destino.',
    vars: [
      { name: 'CITY_NAME', hint: 'Nombre de la ciudad en MAYÚSCULAS, ej: CIUDAD DE MÉXICO' },
      { name: 'COUNTRY', hint: 'País o región, ej: MEXICO o TERRITORIO ORC' },
      { name: 'DATE', hint: 'Fecha del evento, ej: 14 SEP 1998 — 03:00 HRS' },
      { name: 'COORDINATES', hint: 'Coordenadas ficticias o reales, ej: 19.4326° N, 99.1332° W' },
    ],
    code: `import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const city = '{{CITY_NAME}}';
  const country = '{{COUNTRY}}';
  const date = '{{DATE}}';
  const coords = '{{COORDINATES}}';
  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 15, durationInFrames - 2], [1, 0], { extrapolateRight: 'clamp' });
  const ping1 = interpolate(frame % 50, [0, 50], [0, 1], { extrapolateRight: 'clamp' });
  const ping2 = interpolate((frame + 22) % 50, [0, 50], [0, 1], { extrapolateRight: 'clamp' });
  const pinScale = interpolate(frame, [10, 40], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const cityOp = interpolate(frame, [30, 55], [0, 1], { extrapolateRight: 'clamp' });
  const countryOp = interpolate(frame, [50, 70], [0, 1], { extrapolateRight: 'clamp' });
  const dateOp = interpolate(frame, [65, 85], [0, 1], { extrapolateRight: 'clamp' });
  const coordOp = interpolate(frame, [75, 95], [0, 1], { extrapolateRight: 'clamp' });
  const lineW = interpolate(frame, [55, 85], [0, 50], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: '#040c0c', opacity: fadeIn * fadeOut, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 50% 50% at 50% 40%, #00ffff0d 0%, transparent 60%)' }} />
      <svg style={{ position: 'absolute', width: '100%', height: '100%' }}>
        <circle cx="640" cy="300" r={ping1 * 100} fill="none" stroke="#00ffff" strokeWidth="1.5" opacity={(1 - ping1) * pinScale} />
        <circle cx="640" cy="300" r={ping2 * 100} fill="none" stroke="#00ffff" strokeWidth="1.5" opacity={(1 - ping2) * pinScale} />
        <circle cx="640" cy="300" r={8} fill="#00ffff" opacity={pinScale} />
        <line x1="640" y1="308" x2="640" y2="340" stroke="#00ffff" strokeWidth="2" opacity={pinScale} />
      </svg>
      <div style={{ marginTop: 80, textAlign: 'center' }}>
        <div style={{ opacity: countryOp, fontFamily: 'monospace', fontSize: 14, letterSpacing: 6, color: '#00ffff88', textTransform: 'uppercase', marginBottom: 8 }}>{country}</div>
        <div style={{ opacity: cityOp, fontFamily: 'monospace', fontSize: 58, fontWeight: 900, letterSpacing: 5, color: '#00ffff', textShadow: '0 0 20px #00ffff, 0 0 40px #00ffff55', lineHeight: 1 }}>{city}</div>
        <div style={{ height: 2, width: lineW + '%', background: 'linear-gradient(90deg, transparent, #00ffff, transparent)', margin: '14px auto', boxShadow: '0 0 8px #00ffff' }} />
        <div style={{ opacity: dateOp, fontFamily: 'monospace', fontSize: 16, color: '#ff4444', letterSpacing: 4, marginBottom: 10 }}>{date}</div>
        <div style={{ opacity: coordOp, fontFamily: 'monospace', fontSize: 13, color: '#556677', letterSpacing: 2 }}>{coords}</div>
      </div>
    </AbsoluteFill>
  );
};`,
  },
  {
    id: 'timeline_event',
    name: 'Evento en Línea de Tiempo',
    description: 'Línea de tiempo horizontal con marcador de evento y descripción. Ideal para secuencias cronológicas, eventos históricos, fechas clave.',
    vars: [
      { name: 'DATE', hint: 'Fecha del evento, ej: 14 SEPTIEMBRE 1998' },
      { name: 'EVENT_TITLE', hint: 'Título del evento en MAYÚSCULAS, máx 30 chars' },
      { name: 'DESC_1', hint: 'Primera línea de descripción, máx 50 chars' },
      { name: 'DESC_2', hint: 'Segunda línea de descripción, máx 50 chars' },
    ],
    code: `import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const date = '{{DATE}}';
  const eventTitle = '{{EVENT_TITLE}}';
  const desc1 = '{{DESC_1}}';
  const desc2 = '{{DESC_2}}';
  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 15, durationInFrames - 2], [1, 0], { extrapolateRight: 'clamp' });
  const lineW = interpolate(frame, [15, 65], [0, 100], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const dotScale = interpolate(frame, [60, 80], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const dotGlow = 0.5 + 0.5 * Math.sin(frame / 15);
  const dateOp = interpolate(frame, [65, 85], [0, 1], { extrapolateRight: 'clamp' });
  const titleOp = interpolate(frame, [75, 95], [0, 1], { extrapolateRight: 'clamp' });
  const titleY = interpolate(frame, [75, 95], [15, 0], { extrapolateRight: 'clamp' });
  const desc1Op = interpolate(frame, [90, 108], [0, 1], { extrapolateRight: 'clamp' });
  const desc2Op = interpolate(frame, [102, 120], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: '#050810', opacity: fadeIn * fadeOut, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 40% at 50% 50%, #00ffff08 0%, transparent 70%)' }} />
      <div style={{ position: 'relative', width: 900 }}>
        <div style={{ position: 'relative', height: 3, background: '#111', marginBottom: 0 }}>
          <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: lineW + '%', background: 'linear-gradient(90deg, #00ffff55, #00ffff)', boxShadow: '0 0 8px #00ffff' }} />
        </div>
        <div style={{ position: 'absolute', top: -9, left: lineW + '%', transform: 'translateX(-50%) scale(' + dotScale + ')', width: 22, height: 22, borderRadius: '50%', background: '#00ffff', boxShadow: '0 0 ' + Math.round(20 * dotGlow) + 'px ' + Math.round(8 * dotGlow) + 'px #00ffff88' }} />
        <div style={{ position: 'absolute', top: 24, left: lineW + '%', transform: 'translateX(-50%)', minWidth: 200, opacity: dateOp, textAlign: 'center' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#00ffff', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>{date}</div>
        </div>
        <div style={{ marginTop: 80, opacity: titleOp, transform: 'translateY(' + titleY + 'px)' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 42, fontWeight: 900, color: '#fff', letterSpacing: 3, textShadow: '0 0 15px rgba(255,255,255,0.3)', marginBottom: 16 }}>{eventTitle}</div>
        </div>
        <div style={{ marginTop: 8, paddingLeft: 4 }}>
          <div style={{ opacity: desc1Op, fontFamily: 'monospace', fontSize: 18, color: '#8899bb', marginBottom: 10, paddingLeft: 14, borderLeft: '2px solid #00ffff44' }}>{desc1}</div>
          <div style={{ opacity: desc2Op, fontFamily: 'monospace', fontSize: 18, color: '#8899bb', paddingLeft: 14, borderLeft: '2px solid #00ffff44' }}>{desc2}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};`,
  },
  {
    id: 'confrontation',
    name: 'Confrontación / VS',
    description: 'Dos elementos/entidades enfrentadas con línea de tensión central. Ideal para conflictos, disputas, comparaciones, dos bandos o partes opuestas.',
    vars: [
      { name: 'LEFT_NAME', hint: 'Nombre del lado izquierdo en MAYÚSCULAS, máx 18 chars' },
      { name: 'RIGHT_NAME', hint: 'Nombre del lado derecho en MAYÚSCULAS, máx 18 chars' },
      { name: 'LEFT_COLOR', hint: 'Color hex del lado izquierdo, ej: #00ffff' },
      { name: 'RIGHT_COLOR', hint: 'Color hex del lado derecho, ej: #ff4444' },
      { name: 'CONTEXT', hint: 'Texto de contexto central, ej: TRAICIÓN o EN CONFLICTO' },
    ],
    code: `import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const leftName = '{{LEFT_NAME}}';
  const rightName = '{{RIGHT_NAME}}';
  const leftColor = '{{LEFT_COLOR}}';
  const rightColor = '{{RIGHT_COLOR}}';
  const context = '{{CONTEXT}}';
  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 15, durationInFrames - 2], [1, 0], { extrapolateRight: 'clamp' });
  const leftX = interpolate(frame, [10, 45], [-320, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const rightX = interpolate(frame, [10, 45], [320, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const centerOp = interpolate(frame, [50, 70], [0, 1], { extrapolateRight: 'clamp' });
  const contextOp = interpolate(frame, [65, 85], [0, 1], { extrapolateRight: 'clamp' });
  const pulse = 0.6 + 0.4 * Math.sin(frame / 12);
  const lineH = interpolate(frame, [50, 70], [0, 200], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: '#050508', opacity: fadeIn * fadeOut, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, ' + leftColor + '0a 0%, transparent 50%, ' + rightColor + '0a 100%)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, width: '100%', padding: '0 80px', justifyContent: 'space-between' }}>
        <div style={{ transform: 'translateX(' + leftX + 'px)', textAlign: 'left', flex: 1 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 50, fontWeight: 900, color: leftColor, letterSpacing: 4, textShadow: '0 0 20px ' + leftColor + ', 0 0 40px ' + leftColor + '55', lineHeight: 1 }}>{leftName}</div>
          <div style={{ height: 3, width: 80, background: leftColor, marginTop: 10, boxShadow: '0 0 10px ' + leftColor }} />
        </div>
        <div style={{ opacity: centerOp, display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 160px' }}>
          <div style={{ width: 2, height: lineH, background: 'linear-gradient(180deg, ' + leftColor + ', ' + rightColor + ')', boxShadow: '0 0 12px rgba(255,255,255,0.3)', marginBottom: 12 }} />
          <div style={{ fontFamily: 'monospace', fontSize: 28, fontWeight: 900, color: '#fff', opacity: pulse, textShadow: '0 0 15px #fff' }}>VS</div>
          <div style={{ width: 2, height: lineH, background: 'linear-gradient(180deg, ' + rightColor + ', ' + leftColor + ')', boxShadow: '0 0 12px rgba(255,255,255,0.3)', marginTop: 12 }} />
        </div>
        <div style={{ transform: 'translateX(' + rightX + 'px)', textAlign: 'right', flex: 1 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 50, fontWeight: 900, color: rightColor, letterSpacing: 4, textShadow: '0 0 20px ' + rightColor + ', 0 0 40px ' + rightColor + '55', lineHeight: 1 }}>{rightName}</div>
          <div style={{ height: 3, width: 80, background: rightColor, marginTop: 10, marginLeft: 'auto', boxShadow: '0 0 10px ' + rightColor }} />
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 80, left: 0, right: 0, textAlign: 'center', opacity: contextOp, fontFamily: 'monospace', fontSize: 16, letterSpacing: 6, color: '#666', textTransform: 'uppercase' }}>{context}</div>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)', pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};`,
  },
];

function fillTemplate(templateId: string, variables: Record<string, string>, durationSeconds: number, width: number, height: number): string | null {
  const template = TEMPLATES.find(t => t.id === templateId);
  if (!template) { console.log(`  ⚠️ Template no encontrado: "${templateId}"`); return null; }
  let code = template.code;
  for (const [key, val] of Object.entries(variables)) {
    const safe = String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ').slice(0, 60);
    code = code.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), safe);
  }
  // Remove any unfilled placeholders with sensible defaults
  code = code.replace(/\{\{NEON_COLOR\}\}/g, '#00ffff').replace(/\{\{ACCENT_COLOR\}\}/g, '#ff4444').replace(/\{\{[A-Z_]+\}\}/g, '???');
  // Adjust Root.tsx dimensions externally; embed a comment with metadata
  code = `// Template: ${templateId} | ${width}x${height} | ${durationSeconds}s\n` + code;
  return code;
}

const TEMPLATE_LIST_FOR_PROMPT = TEMPLATES.map((t, i) =>
  `${i + 1}. id="${t.id}" — ${t.name}\n   Usar cuando: ${t.description}\n   Variables: ${t.vars.map(v => `${v.name} (${v.hint})`).join(' | ')}`
).join('\n\n');

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function pickAndFillTemplate(
  prompt: string, durationSeconds: number, width: number, height: number
): Promise<{ success: boolean; code?: string; templateId?: string }> {
  const sysPrompt = `Eres un selector de templates de animación para videos documentales oscuros. Analiza el clip y elige el template más adecuado. Responde SOLO con JSON válido, sin markdown ni explicaciones.`;
  const userPrompt = `TEMPLATES DISPONIBLES:\n\n${TEMPLATE_LIST_FOR_PROMPT}\n\nCLIP (${durationSeconds}s):\n"${prompt.slice(0, 400)}"\n\nElige el template más adecuado y rellena TODAS sus variables. Recuerda: colores neón oscuros, texto MAYÚSCULAS, máx 25 chars por variable de texto.\n\nFormato de respuesta:\n{"templateId":"id_aqui","variables":{"VAR1":"valor","VAR2":"valor"}}`;

  for (const key of FREE_KEYS) {
    try {
      const result = await tryWithKey(key, MODEL_LITE, userPrompt, durationSeconds, 15000, width, height, sysPrompt);
      const cleaned = result.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned) as { templateId: string; variables: Record<string, string> };
      if (!parsed.templateId || !parsed.variables) continue;
      const code = fillTemplate(parsed.templateId, parsed.variables, durationSeconds, width, height);
      if (code) {
        console.log(`  📋 Template elegido: "${parsed.templateId}" — vars: ${JSON.stringify(parsed.variables).slice(0, 120)}`);
        return { success: true, code, templateId: parsed.templateId };
      }
    } catch (err: any) {
      console.log(`  ⚠️ Template picker falló (${key.slice(0,8)}...): ${err?.message?.slice(0, 60)}`);
    }
  }
  return { success: false };
}

async function generateVideo(prompt: string, durationSeconds: number, styleContext?: string, preferredModel?: string, outputFilename?: string, width = 1280, height = 720, allowImages = false, injectedCode?: string, slotId = 0): Promise<{ success: boolean; modelUsed?: string; cost?: number; inputTokens?: number; outputTokens?: number; isPaid?: boolean; error?: string }> {
  const styleNote = styleContext
    ? `\n\nIMPORTANTE: Usa el MISMO estilo visual (colores, degradados, tipo de animaciones, formas) que el siguiente código de referencia. Adapta el contenido al nuevo prompt pero mantén la misma estética:\n\n${styleContext.slice(0, 2000)}`
    : '';

  let code = injectedCode || "";
  let modelUsed = injectedCode ? "template (lite)" : "";
  let inputTokens = 0;
  let outputTokens = 0;
  let isPaid = false;
  let successModel = "";

  const activeSystemPrompt = allowImages ? SYSTEM_PROMPT_WITH_IMAGES : SYSTEM_PROMPT;

  if (injectedCode) {
    // Skip LLM — go straight to render with pre-filled template code
  } else if (preferredModel === "ollama" || preferredModel.startsWith("ollama:")) {
    const ollamaModel = preferredModel.startsWith("ollama:") ? preferredModel.slice(7) : "gemma4";
    console.log(`  🦙 Usando Ollama (${ollamaModel})...`);
    try {
      code = await tryWithOllama(prompt + styleNote, durationSeconds, width, height, ollamaModel);
      modelUsed = `ollama (${ollamaModel})`;
      console.log("  ✅ OK (ollama)");
    } catch (err: any) {
      return { success: false, error: "Ollama falló: " + (err?.message || err) };
    }
  } else {

  type Attempt = { keys: string[]; model: string; label: string; isPaid: boolean };
  const paid = PAID_KEY ? [PAID_KEY] : [];
  let attempts: Attempt[];

  if (preferredModel === "flash") {
    attempts = [
      { keys: FREE_KEYS, model: MODEL_FLASH,    label: "gratis + flash",        isPaid: false },
      { keys: paid,       model: MODEL_FLASH,    label: "pago + flash",          isPaid: true  },
    ];
  } else if (preferredModel === MODEL_3_FLASH || preferredModel === "3-flash-preview") {
    attempts = [
      { keys: FREE_KEYS, model: MODEL_3_FLASH,  label: "gratis + 3-flash",      isPaid: false },
      { keys: paid,       model: MODEL_3_FLASH,  label: "pago + 3-flash",        isPaid: true  },
    ];
  } else if (preferredModel === MODEL_25_FLASH || preferredModel === "2.5-flash") {
    attempts = [
      { keys: FREE_KEYS, model: MODEL_25_FLASH, label: "gratis + 2.5-flash",    isPaid: false },
      { keys: paid,       model: MODEL_25_FLASH, label: "pago + 2.5-flash",      isPaid: true  },
    ];
  } else if (preferredModel === MODEL_25_PRO || preferredModel === "2.5-pro") {
    // 2.5 Pro has limit:0 free tier in most projects — go straight to paid
    attempts = [
      { keys: paid,       model: MODEL_25_PRO,   label: "pago + 2.5-pro",        isPaid: true  },
    ];
  } else if (preferredModel === MODEL_31_PRO || preferredModel === "3.1-pro-preview") {
    // 3.1 Pro Preview is paid-only (no free tier)
    attempts = [
      { keys: paid,       model: MODEL_31_PRO,   label: "pago + 3.1-pro",        isPaid: true  },
    ];
  } else {
    // Default: Lite (free) → Flash (free) → Lite (paid)
    attempts = [
      { keys: FREE_KEYS, model: MODEL_LITE,     label: "gratis + lite",         isPaid: false },
      { keys: FREE_KEYS, model: MODEL_FLASH,    label: "gratis + flash",        isPaid: false },
      { keys: paid,       model: MODEL_LITE,     label: "pago + lite",           isPaid: true  },
    ];
  }

  for (const attempt of attempts) {
    if (attempt.keys.length === 0) continue;
    console.log(`  🔄 Ronda: ${attempt.label}`);

    for (let i = 0; i < attempt.keys.length; i++) {
      try {
        const timeoutMs = attempt.model === MODEL_LITE ? 5000 : 300000;
        const result = await tryWithKey(attempt.keys[i], attempt.model, prompt + styleNote, durationSeconds, timeoutMs, width, height, activeSystemPrompt);
        code = result.text;
        inputTokens = result.inputTokens;
        outputTokens = result.outputTokens;
        isPaid = attempt.isPaid;
        successModel = attempt.model;
        modelUsed = attempt.label;
        console.log(`  ✅ OK (${attempt.label}) — tokens: ${inputTokens} in / ${outputTokens} out`);
        break;
      } catch (err: any) {
        console.log(`    ❌ Key #${i + 1} falló: ${err?.message || err}`);
        continue;
      }
    }
    if (code) break;
  }

  } // end else (non-ollama / non-injected)

  if (!code) {
    return { success: false, error: "Todas las API keys y modelos fallaron" };
  }

  // Limpiar markdown fences
  code = code.replace(/^```(?:tsx?|javascript|jsx)?\n?/gm, "").replace(/```$/gm, "").trim();

  // Escribir código en el archivo del slot asignado
  const compositionPath = path.join(PROJECT_ROOT, "src", `Composition_s${slotId}.tsx`);
  fs.writeFileSync(compositionPath, code, "utf-8");

  // Escribir Root del slot con duración y dimensiones correctas
  const rootPath = path.join(PROJECT_ROOT, "src", `Root_s${slotId}.tsx`);
  fs.writeFileSync(rootPath,
    `import "./index.css";\nimport { Composition } from "remotion";\nimport { MyComposition } from "./Composition_s${slotId}";\nexport const RemotionRoot: React.FC = () => (\n  <><Composition id="MyComp" component={MyComposition} durationInFrames={${durationSeconds * 30}} fps={30} width={${width}} height={${height}} /></>\n);\n`);

  // Asegurar directorio out/
  const outDir = path.join(PROJECT_ROOT, "out");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  // ── Auto-fix imports ───────────────────────────────────────────────────────
  // If the code uses a Remotion symbol but the import line is missing it, patch it.
  const remotionImportLine = code.match(/import\s*\{([^}]+)\}\s*from\s*['"]remotion['"]/);
  if (remotionImportLine) {
    const imported = remotionImportLine[1].split(',').map((s: string) => s.trim());
    const remotionSymbols: Record<string, string> = {
      staticFile: 'staticFile',
      Img: 'Img',
      Sequence: 'Sequence',
      Audio: 'Audio',
      Video: 'Video',
      spring: 'spring',
      measureSpring: 'measureSpring',
    };
    const toAdd: string[] = [];
    for (const [sym] of Object.entries(remotionSymbols)) {
      const usedInCode = new RegExp(`\\b${sym}\\s*[\\(\\<]`).test(code);
      if (usedInCode && !imported.includes(sym)) toAdd.push(sym);
    }
    if (toAdd.length > 0) {
      const newImport = `import { ${[...imported, ...toAdd].join(', ')} } from 'remotion';`;
      code = code.replace(/import\s*\{[^}]+\}\s*from\s*['"]remotion['"].*/, newImport);
      fs.writeFileSync(compositionPath, code, "utf-8");
      console.log(`🔧 Auto-import añadido: ${toAdd.join(', ')}`);
    }
  }

  // Verify all staticFile() references exist in public/ before rendering
  const staticFileRefs = [...code.matchAll(/staticFile\(['"`]([^'"`]+)['"`]\)/g)].map(m => m[1]);
  for (const ref of staticFileRefs) {
    const filePath = path.join(PROJECT_ROOT, 'public', ref);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ staticFile('${ref}') no existe en public/ — abortando render con imágenes`);
      return { success: false, error: `Asset no encontrado: ${ref}` };
    }
    console.log(`✅ Asset verificado: ${ref} (${Math.round(fs.statSync(filePath).size / 1024)}KB)`);
  }

  // Renderizar — con retry automático si el código tiene errores
  const outFile = outputFilename || "video.mp4";
  const renderOnce = () => execSync(
    `npx remotion render src/index_s${slotId}.ts MyComp out/${outFile} --overwrite`,
    { cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"], timeout: 300000, maxBuffer: 50 * 1024 * 1024 }
  );

  const isCodeError = (msg: string) =>
    /ReferenceError|SyntaxError|TypeError|is not defined|Cannot read prop|Unexpected token|is not a function|can not be undefined|inputRange can not|outputRange can not|is not iterable|Cannot destructure|passed to the `component` prop|value of `undefined` was passed|Transform failed|Unexpected "="/i.test(msg);

  const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*[mGKHFABCDJST]/g, '');

  try {
    renderOnce();
    const cost = isPaid ? calcCost(successModel, inputTokens, outputTokens) : 0;
    return { success: true, modelUsed, cost, inputTokens, outputTokens, isPaid };
  } catch (firstErr: any) {
    const stderr1 = stripAnsi(firstErr.stderr?.toString() || "").slice(0, 2000);
    const errMsg1 = stderr1 || firstErr.message || "";
    console.error("❌ Render error (intento 1):\n" + errMsg1.slice(0, 400));

    if (!isCodeError(errMsg1)) {
      return { success: false, error: "Error al renderizar: " + errMsg1 };
    }

    // Extraer el mensaje de error limpio para el LLM
    const errorLine = errMsg1.match(/(ReferenceError|SyntaxError|TypeError|Transform failed|ERROR: Unexpected|Error[^\n]{0,80}(?:can not be undefined|passed to the `component` prop))[^\n]*/)?.[0] || errMsg1.slice(0, 200);
    console.log(`  🔁 Error de código detectado ("${errorLine.slice(0, 80)}") — reintentando con fix...`);

    // Pedir al LLM que corrija el código
    const undefinedHint = /can not be undefined/i.test(errMsg1)
      ? '\n\nEste error ocurre cuando interpolate() o si() recibe `undefined` como primer argumento. Revisa TODAS las llamadas a si()/interpolate() y asegúrate de que el primer argumento sea siempre `frame` o una expresión aritmética de frame (ej: frame%60, frame/2), NUNCA una variable que pueda ser undefined. Si el helper si() no existe en el código, añádelo:\nconst si = (f:number,inp:number[],out:number[],opts?:any)=>{if(typeof f!=="number"||!isFinite(f))return out[0]??0;const pairs=inp.map((v,i)=>[v,out[i]]as[number,number]);pairs.sort((a,b)=>a[0]-b[0]);const d=pairs.filter((p,i)=>i===0||p[0]>pairs[i-1][0]);return interpolate(f,d.map(p=>p[0]),d.map(p=>p[1]),{extrapolateLeft:"clamp",extrapolateRight:"clamp",...opts});};'
      : /passed to the `component` prop|value of `undefined` was passed/i.test(errMsg1)
      ? '\n\nEste error ocurre cuando el archivo Composition.tsx no exporta el componente con el nombre exacto `MyComposition`. Asegúrate de que el código contenga exactamente: export const MyComposition: React.FC = () => { ... }. No uses export default, no cambies el nombre del componente.'
      : /Transform failed|Unexpected "="/i.test(errMsg1)
      ? '\n\nEste error es de sintaxis incompatible con el compilador esbuild de Remotion. REGLAS ESTRICTAS: (1) NO uses operadores de asignación lógica: ??= ||= &&= — reemplázalos por: a = a ?? b, a = a || b, a = a && b. (2) NO uses optional chaining en el lado izquierdo de una asignación. (3) NO uses sintaxis de ES2022+ como class fields con #. Usa solo sintaxis ES2019 o anterior.'
      : '';
    const fixPrompt = `El siguiente código Remotion tiene un error de JavaScript que impide renderizarse:\n\nERROR: ${errorLine}${undefinedHint}\n\nCÓDIGO CON ERROR:\n${code.slice(0, 3000)}\n\nCorrige ÚNICAMENTE el error. Devuelve el código completo corregido sin explicaciones ni markdown.`;
    const fixKey = (PAID_KEY || FREE_KEYS[0]);
    if (!fixKey) return { success: false, error: "Error al renderizar: " + errMsg1 };

    try {
      const fixModel = successModel || MODEL_LITE;
      const fixResult = await tryWithKey(fixKey, fixModel, fixPrompt, durationSeconds, 120000, width, height, SYSTEM_PROMPT);
      let fixedCode = fixResult.text.replace(/^```(?:tsx?|javascript|jsx)?\n?/gm, "").replace(/```$/gm, "").trim();
      console.log(`  ✅ Código corregido por LLM (${fixResult.outputTokens} tokens out)`);
      fs.writeFileSync(compositionPath, fixedCode, "utf-8");
      renderOnce();
      const cost = isPaid ? calcCost(successModel, inputTokens + fixResult.inputTokens, outputTokens + fixResult.outputTokens) : 0;
      return { success: true, modelUsed: modelUsed + ' (auto-fix)', cost, inputTokens: inputTokens + fixResult.inputTokens, outputTokens: outputTokens + fixResult.outputTokens, isPaid };
    } catch (secondErr: any) {
      const stderr2 = stripAnsi(secondErr.stderr?.toString() || secondErr.message || "").slice(0, 1000);
      console.error("❌ Render error (intento 2 tras fix):\n" + stderr2.slice(0, 300));
      return { success: false, error: "Error al renderizar (tras auto-fix): " + stderr2 };
    }
  }
}

// ── Initialize per-slot source files ─────────────────────────────────────────
{
  const srcDir = path.join(PROJECT_ROOT, "src");
  for (let i = 0; i < MAX_SLOTS; i++) {
    const indexSlot  = path.join(srcDir, `index_s${i}.ts`);
    const rootSlot   = path.join(srcDir, `Root_s${i}.tsx`);
    const compSlot   = path.join(srcDir, `Composition_s${i}.tsx`);

    if (!fs.existsSync(indexSlot))
      fs.writeFileSync(indexSlot,
        `import { registerRoot } from "remotion";\nimport { RemotionRoot } from "./Root_s${i}";\nregisterRoot(RemotionRoot);\n`);

    if (!fs.existsSync(rootSlot))
      fs.writeFileSync(rootSlot,
        `import "./index.css";\nimport { Composition } from "remotion";\nimport { MyComposition } from "./Composition_s${i}";\nexport const RemotionRoot: React.FC = () => (\n  <><Composition id="MyComp" component={MyComposition} durationInFrames={300} fps={30} width={1280} height={720} /></>\n);\n`);

    if (!fs.existsSync(compSlot))
      fs.writeFileSync(compSlot,
        `import React from 'react';\nimport { AbsoluteFill } from 'remotion';\nexport const MyComposition: React.FC = () => <AbsoluteFill style={{background:'#000'}} />;\n`);
  }
  console.log(`🎬 HolaVideo: ${MAX_SLOTS} slot(s) de render paralelo inicializados`);
}

// Clean up old non-deterministic asset files from public/ on startup
const publicDir = path.join(PROJECT_ROOT, 'public');
if (fs.existsSync(publicDir)) {
  for (const f of fs.readdirSync(publicDir)) {
    if (/^(asset_|ai_img_)\d/.test(f)) {
      try { fs.unlinkSync(path.join(publicDir, f)); } catch {}
    }
  }
}

// --- Servidor ---
const app = express();
app.use(express.json());

app.use("/out", express.static(path.join(PROJECT_ROOT, "out")));
app.use("/public", express.static(path.join(PROJECT_ROOT, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "ui", "index.html"));
});

app.post("/api/generate", async (req, res) => {
  const { prompt, duration, model, styleContext, styleName, width, height, assets } = req.body;
  const vidWidth = (typeof width === 'number' && width > 0) ? width : 1280;
  const vidHeight = (typeof height === 'number' && height > 0) ? height : 720;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    res.status(400).json({ error: "El prompt es requerido" });
    return;
  }

  const durationSeconds = Math.min(Math.max(parseInt(duration) || 10, 3), 120);

  if (prompt.length > 1200) {
    res.status(400).json({ error: "El prompt es demasiado largo (máx 1200 caracteres)" });
    return;
  }

  // Cola de slots: hasta MAX_QUEUE esperando, resto rechazado
  const MAX_QUEUE = 20;
  if (_slotWaiters.length >= MAX_QUEUE) {
    res.status(429).json({ error: `Cola llena (${_slotWaiters.length} en espera). Intenta más tarde.` });
    return;
  }

  const slot = await acquireSlot();
  const activeSlots = MAX_SLOTS - _freeSlots.size;
  const timestamp = Date.now();
  const filename = `video-${timestamp}.mp4`;
  const modelLabel = model === "flash" ? "3.5 Flash"
    : model === MODEL_3_FLASH  ? "3 Flash Preview"
    : model === MODEL_25_FLASH ? "2.5 Flash"
    : model === MODEL_25_PRO   ? "2.5 Pro"
    : model === MODEL_31_PRO   ? "3.1 Pro Preview"
    : (model === "ollama" || model.startsWith("ollama:")) ? (model.startsWith("ollama:") ? model.slice(7) : "gemma4") + " (local)"
    : "3.1 Lite";
  console.log(`🎬 [slot ${slot}] Generando (${durationSeconds}s) [${modelLabel}] — ${activeSlots}/${MAX_SLOTS} activos: "${prompt.slice(0, 60)}..."`);

  // Build multi-asset instructions
  const assetList: any[] = Array.isArray(assets) ? assets : [];
  let imageNote = '';
  if (assetList.length) {
    console.log(`🖼️ Con ${assetList.length} asset(s): ${assetList.map((a: any) => a.filename).join(', ')}`);

    const positionCSS: Record<string, string> = {
      fullscreen:     'position:"absolute", top:0, left:0, width:"100%", height:"100%", objectFit:"cover"',
      center:         'position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)"',
      'bottom-right': 'position:"absolute", bottom:20, right:20',
      'bottom-left':  'position:"absolute", bottom:20, left:20',
      'bottom-center':'position:"absolute", bottom:20, left:"50%", transform:"translateX(-50%)"',
      'top-right':    'position:"absolute", top:20, right:20',
      'top-left':     'position:"absolute", top:20, left:20',
      left:           'position:"absolute", top:"50%", left:20, transform:"translateY(-50%)"',
      right:          'position:"absolute", top:"50%", right:20, transform:"translateY(-50%)"',
    };

    const animDesc: Record<string, string> = {
      'slow-zoom-in':      'zoom suave (scale: 1 → 1.08 durante toda la duración, usando interpolate)',
      'fade-in':           'fade-in (opacity: 0 → 1 en los primeros 20 frames)',
      'slide-from-left':   'entra deslizándose desde la izquierda (translateX: -400px → 0 en 25 frames con Easing.out(Easing.cubic))',
      'slide-from-right':  'entra deslizándose desde la derecha (translateX: 400px → 0 en 25 frames con Easing.out(Easing.cubic))',
      'slide-from-bottom': 'entra desde abajo (translateY: 300px → 0 en 25 frames con Easing.out(Easing.cubic))',
      'float':             'flotación vertical suave (translateY oscilando ±8px usando Math.sin(frame/15))',
      'scale-pulse':       'pulsación de escala (1 → 1.06 → 1 cíclicamente cada 30 frames con Math.sin)',
      'parallax':          'parallax sutil (translateY: 0 → -30px durante toda la duración, más lento que el fondo)',
      'none':              'sin animación (estático)',
    };

    const descriptions = assetList.map((a: any, i: number) => {
      const pos = positionCSS[a.position] || positionCSS.center;
      const anim = animDesc[a.animation] || animDesc['fade-in'];
      const sizeStyle = a.use === 'background' ? '' : `width: "${a.size || '40%'}"`;
      const overlayNote = a.use === 'background'
        ? 'Pon un div semitransparente encima (background: "rgba(0,0,0,0.4)") para que el texto sea legible.'
        : a.use === 'icon'
        ? 'Tamaño compacto (120-200px). Si es PNG con fondo transparente se integra directamente.'
        : `Es el elemento protagonista. CSS OBLIGATORIO para el <Img>: objectFit: "contain", height: "auto", maxHeight: "85%", maxWidth: "${a.size || '38%'}", width: "auto" — NUNCA uses overflow:"hidden" en el contenedor. Aplica: filter: "drop-shadow(0 0 18px rgba(0,200,255,0.5))".`;
      return `ASSET ${i + 1}: staticFile('${a.filename}') — "${a.label}"
  Rol: ${a.use} | Posición: { ${pos} }
  Animación: ${anim}
  ${overlayNote}`;
    }).join('\n\n');

    const elementAssets = assetList.filter((a: any) => a.use === 'element');
    const hasRealImage = elementAssets.length > 0;
    let overrideNote = '';
    if (elementAssets.length >= 2) {
      const names = elementAssets.map((a: any) => `"${a.filename}"`).join(' y ');
      overrideNote = `\n\n🚨 REGLA ABSOLUTA — 2 IMÁGENES REALES DISPONIBLES: ${names}. USA AMBAS — primera a la izquierda, segunda a la derecha. Entre ellas puedes poner un símbolo de su relación (alianza "+", vs "⚔", flecha, etc.) animado en el centro. NUNCA ignores una de las dos. NO dibujes siluetas ni reemplaces con SVG.\n`;
    } else if (hasRealImage) {
      overrideNote = `\n\n🚨 REGLA ABSOLUTA — IMAGEN REAL DISPONIBLE: Aunque el prompt mencione "silueta", "SVG", "figura abstracta" o "ícono" para representar al sujeto, DEBES mostrar la IMAGEN REAL con <Img src={staticFile('...')} />. Esto aplica a personas, logos de marcas e imágenes de productos. NO dibujes siluetas ni formas geométricas como sustituto — usa el asset real.\n`;
    }
    imageNote = `\n\n${overrideNote}TIENES ${assetList.length} IMAGEN(ES) REAL(ES) — DEBES USARLAS TODAS EN LA ANIMACIÓN:

${descriptions}

REGLAS DE COMPOSICIÓN:
- Los assets de tipo "background" van en la capa más baja (z-index bajo o primero en el JSX).
- Los assets de tipo "element" van encima del fondo, posicionados según su rol en la escena.
- Los assets de tipo "icon" van en la capa superior, pequeños y flotando.
- Combina las imágenes con texto animado, overlays de color y efectos CSS para crear una composición dinámica.
- Cada imagen DEBE estar visible y animada — no las omitas.

Importa: import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
Usa <Img src={staticFile('filename')} style={{...}} /> (NO <img> HTML).`;
  }

  try {
    const result = await generateVideo(prompt.trim() + imageNote, durationSeconds, styleContext, model, filename, vidWidth, vidHeight, assetList.length > 0, undefined, slot);
    if (result.success) {
      console.log(`✅ Video generado [slot ${slot}]`);

      // Guardar en historial
      const historyPath = path.join(PROJECT_ROOT, "out", "history.json");
      const history = fs.existsSync(historyPath)
        ? JSON.parse(fs.readFileSync(historyPath, "utf-8"))
        : [];
      if (result.isPaid) {
        console.log(`💰 Costo: $${result.cost!.toFixed(4)} MXN (${result.inputTokens} in / ${result.outputTokens} out tokens)`);
      }
      history.unshift({
        id: timestamp,
        timestamp: new Date(timestamp).toISOString(),
        prompt: prompt.trim(),
        model: model || "lite",
        modelUsed: result.modelUsed,
        duration: durationSeconds,
        filename,
        cost: result.cost ?? 0,
        inputTokens: result.inputTokens ?? 0,
        outputTokens: result.outputTokens ?? 0,
        isPaid: result.isPaid ?? false,
        styleName: (styleName as string) || '',
      });
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

      const code = fs.readFileSync(path.join(PROJECT_ROOT, "src", `Composition_s${slot}.tsx`), "utf-8");
      res.json({ success: true, videoUrl: `/out/${filename}`, code,
        cost: result.cost ?? 0, inputTokens: result.inputTokens ?? 0,
        outputTokens: result.outputTokens ?? 0, isPaid: result.isPaid ?? false,
        modelUsed: result.modelUsed ?? '' });
    } else {
      console.error(`❌ [slot ${slot}]`, result.error);
      res.status(500).json({ error: result.error });
    }
  } finally {
    releaseSlot(slot);
  }
});

app.get("/api/history", (_req, res) => {
  const historyPath = path.join(PROJECT_ROOT, "out", "history.json");
  if (!fs.existsSync(historyPath)) {
    res.json([]);
    return;
  }
  res.json(JSON.parse(fs.readFileSync(historyPath, "utf-8")));
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`\n🚀 HolaVideo corriendo en http://localhost:${PORT}\n`);
});
