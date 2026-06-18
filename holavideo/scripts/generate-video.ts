import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// Cargar .env manualmente
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    process.env[key.trim()] = rest.join("=").trim();
  }
}

// Keys separadas
const FREE_KEYS = [
  process.env.GOOGLE_API_KEY_GRATIS,
  process.env.GOOGLE_API_KEY_GRATIS2,
  process.env.GOOGLE_API_KEY_GRATIS3,
  process.env.GOOGLE_API_KEY_GRATIS4,
  process.env.GOOGLE_API_KEY_GRATIS5,
].filter(Boolean) as string[];

const PAID_KEY = process.env.GOOGLE_API_KEY;

const MODEL_FLASH = "gemini-3.5-flash";
const MODEL_LITE = "gemini-3.1-flash-lite";

const SYSTEM_PROMPT = `Eres un experto en Remotion (framework de video con React).
El usuario te dará una descripción de un video y tú generarás SOLO el código TypeScript/React del componente.

REGLAS ESTRICTAS:
- Exporta el componente principal como: export const MyComposition = () => { ... }
- Usa SOLO estas imports de remotion: AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, Easing
- Para animaciones usa useCurrentFrame() + interpolate(). NUNCA CSS transitions/animations.
- El video es 1280x720 a 30fps, duración de 10 segundos (300 frames). Usa toda la duración para las animaciones.
- No uses librerías externas que no estén instaladas.
- No uses Tailwind classes para animaciones.
- Responde SOLO con el código, sin explicaciones, sin markdown fences.
- El código debe ser un archivo .tsx completo y válido.
- Usa colores vibrantes y animaciones fluidas.
- Usa Easing.bezier() para movimientos suaves.
- PROHIBIDO usar Img, staticFile, o cualquier imagen/archivo externo. No existen imágenes en el proyecto.
- Dibuja TODO con divs, CSS (bordes, degradados, border-radius, box-shadow), SVG inline o emojis.
- Para representar objetos, animales o personas usa emojis grandes, formas geométricas o SVG paths simples.
`;

async function tryWithKey(apiKey: string, model: string, prompt: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: `${SYSTEM_PROMPT}\n\nDescripción del video:\n${prompt}` }],
      },
    ],
  });
  return response.text ?? "";
}

// Estrategia de fallback:
// 1. Gratis + gemini-3.5-flash
// 2. Gratis + gemini-3.1-flash-lite
// 3. De pago + gemini-3.1-flash-lite
async function generateCode(prompt: string): Promise<{ code: string; keyUsed: string; model: string }> {
  const attempts: { keys: string[]; model: string; label: string }[] = [
    { keys: FREE_KEYS, model: MODEL_FLASH, label: "gratis + flash" },
    { keys: FREE_KEYS, model: MODEL_LITE, label: "gratis + lite" },
    { keys: PAID_KEY ? [PAID_KEY] : [], model: MODEL_LITE, label: "de pago + lite" },
  ];

  for (const attempt of attempts) {
    if (attempt.keys.length === 0) continue;
    console.log(`\n🔄 Ronda: ${attempt.label} (modelo: ${attempt.model})`);

    for (let i = 0; i < attempt.keys.length; i++) {
      const keyNum = attempt.keys.length === 1 ? "pago" : `#${i + 1}`;
      console.log(`  ⏳ Key ${keyNum}...`);
      try {
        const code = await tryWithKey(attempt.keys[i], attempt.model, prompt);
        console.log(`  ✅ Respuesta obtenida (key ${keyNum}, ${attempt.model})`);
        return { code, keyUsed: keyNum, model: attempt.model };
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (msg.includes("429") || msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED")) {
          console.log(`  ⚠️  Key ${keyNum} agotada`);
        } else {
          console.log(`  ⚠️  Error: ${msg.slice(0, 100)}`);
        }
        continue;
      }
    }
  }

  throw new Error("Todas las API keys y modelos fallaron");
}

async function main() {
  const prompt = process.argv.slice(2).join(" ");

  if (!prompt) {
    console.error("Uso: npm run generate -- <descripción del video>");
    console.error('Ejemplo: npm run generate -- "un contador del 1 al 10 con fondo azul"');
    process.exit(1);
  }

  if (API_KEYS.length === 0) {
    console.error("Error: No se encontraron API keys. Revisa el archivo .env");
    process.exit(1);
  }

  console.log(`🎬 Generando video: "${prompt}"`);
  console.log(`🔑 Keys gratis: ${FREE_KEYS.length} | Key de pago: ${PAID_KEY ? "sí" : "no"}`);
  console.log(`🤖 Estrategia: gratis+flash → gratis+lite → pago+lite`);

  let code = "";
  try {
    const result = await generateCode(prompt);
    code = result.code;
  } catch {
    console.error("\n❌ Todas las API keys y modelos fallaron.");
    process.exit(1);
  }

  // Limpiar posibles markdown fences
  code = code.replace(/^```(?:tsx?|javascript|jsx)?\n?/gm, "").replace(/```$/gm, "").trim();

  // Escribir el código generado
  const compositionPath = path.join(__dirname, "..", "src", "Composition.tsx");
  fs.writeFileSync(compositionPath, code, "utf-8");
  console.log("\n📝 Código generado en src/Composition.tsx");

  // Renderizar
  console.log("🎞️  Renderizando video...");
  const projectRoot = path.join(__dirname, "..");
  const cachePath = path.join(projectRoot, "node_modules", ".cache");
  
  // Limpiar cache de webpack para evitar errores de hash
  if (fs.existsSync(cachePath)) {
    fs.rmSync(cachePath, { recursive: true, force: true });
  }

  try {
    execSync("npx remotion render MyComp out/video.mp4 --overwrite", {
      cwd: projectRoot,
      stdio: "inherit",
    });
    console.log("\n🎉 Video listo en out/video.mp4");
  } catch {
    console.error("❌ Error al renderizar. Revisa src/Composition.tsx para ver el código generado.");
    process.exit(1);
  }
}

main();
