const fs = require('fs');
const code = 
let availableQwenVoices = [];
async function loadQwenVoices() {
  try {
    const response = await fetch('/api/qwen-voices');
    const data = await response.json();
    if (data.success && data.voices) {
      availableQwenVoices = data.voices;
      const select = document.getElementById('qwenVoiceSelect');
      if (select) {
        select.innerHTML = '';
        data.voices.forEach(voice => {
          const option = document.createElement('option');
          option.value = voice.path;
          option.textContent = voice.displayName;
          select.appendChild(option);
        });
      }
      return true;
    }
  } catch (error) {
    console.error('Error cargando voces de Qwen:', error);
    return false;
  }
}

function toggleQwenVoiceDropdown() {
  const checkbox = document.getElementById('autoGenerateQwenAudio');
  const voiceGroup = document.getElementById('qwenVoiceGroup');
  const applioCheckbox = document.getElementById('autoGenerateApplioAudio');
  
  if (checkbox && voiceGroup) {
    if (checkbox.checked) {
      voiceGroup.style.display = 'block';
      if (availableQwenVoices.length === 0) loadQwenVoices();
      
      if (applioCheckbox && applioCheckbox.checked) {
        applioCheckbox.checked = false;
        if (typeof toggleApplioVoiceDropdown === 'function') toggleApplioVoiceDropdown();
      }
    } else {
      voiceGroup.style.display = 'none';
    }
  }
}

// Hook original Toggle Applio
const originalToggleApplio = window.toggleApplioVoiceDropdown;
window.toggleApplioVoiceDropdown = function() {
  if (originalToggleApplio) originalToggleApplio();
  const qCheckbox = document.getElementById('autoGenerateQwenAudio');
  const aCheckbox = document.getElementById('autoGenerateApplioAudio');
  if (aCheckbox && aCheckbox.checked && qCheckbox && qCheckbox.checked) {
    qCheckbox.checked = false;
    toggleQwenVoiceDropdown();
  }
};

fs.appendFileSync('public/script.js', code, 'utf8');

