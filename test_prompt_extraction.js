// Test para verificar la extracción de prompts
const fs = require('fs');

// Simular el contenido del archivo de prompts
const promptsContent = `=== PROMPT 1 ===
Close-up on a weathered, leather-bound book lying open on a dark wooden table

=== PROMPT 2 ===
Wide shot of a deserted, fog-shrouded highway at night

=== PROMPT 3 ===
Medium shot inside the taxi, focusing on the back seat

=== PROMPT 4 ===
Extreme close-up on the taxi driver's face

=== PROMPT 5 ===
Medium shot of the taxi parked on the side of the desolate road`;

// Probar la extracción con el nuevo patrón
console.log('🧪 PROBANDO EXTRACCIÓN DE PROMPTS...\n');

const prompts = promptsContent
  .split(/===\s*PROMPT\s+\d+\s*===/i)
  .slice(1)
  .map(p => p.trim())
  .filter(p => p);

console.log(`✅ Prompts extraídos: ${prompts.length}`);
console.log('\n📝 PROMPTS ENCONTRADOS:');
prompts.forEach((prompt, index) => {
  console.log(`${index + 1}. ${prompt.substring(0, 60)}...`);
});

// Probar también con el contenido real del archivo
try {
  const realContent = fs.readFileSync('./public/outputs/uber2/seccion_1/seccion_1_prompts_imagenes.txt', 'utf8');
  console.log('\n🔍 PROBANDO CON ARCHIVO REAL...');
  
  const realPrompts = realContent
    .split(/===\s*PROMPT\s+\d+\s*===/i)
    .slice(1)
    .map(p => p.trim())
    .filter(p => p);
    
  console.log(`✅ Prompts extraídos del archivo real: ${realPrompts.length}`);
  realPrompts.forEach((prompt, index) => {
    console.log(`${index + 1}. ${prompt.substring(0, 60)}...`);
  });
} catch (error) {
  console.log('⚠️ No se pudo leer el archivo real:', error.message);
}