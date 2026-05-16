import { execSync } from 'child_process';
import { platform } from 'os';

function run(cmd, label) {
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkAndInstall() {
  const isWindows = platform() === 'win32';
  let missing = [];

  // Check yt-dlp
  const hasYtdlp = run('yt-dlp --version', 'yt-dlp');
  if (!hasYtdlp) {
    console.log('⚠️  yt-dlp no encontrado. Instalando...');
    if (isWindows) {
      const installed = run('winget install --id yt-dlp.yt-dlp --accept-package-agreements --accept-source-agreements', 'yt-dlp');
      if (!installed) {
        missing.push('yt-dlp → instalar manualmente: https://github.com/yt-dlp/yt-dlp/releases');
      }
    } else {
      const installed = run('pip install yt-dlp', 'yt-dlp');
      if (!installed) missing.push('yt-dlp → pip install yt-dlp');
    }
  } else {
    console.log('✅ yt-dlp instalado');
  }

  // Check Python
  const pythonCmd = isWindows ? 'python --version' : 'python3 --version';
  const hasPython = run(pythonCmd, 'Python');
  if (!hasPython) {
    missing.push('Python 3 → https://python.org/downloads');
  } else {
    console.log('✅ Python instalado');
    // Install duckduckgo-search
    const pipCmd = isWindows ? 'pip install duckduckgo-search' : 'pip3 install duckduckgo-search';
    const hasDdgs = run(pipCmd, 'duckduckgo-search');
    if (hasDdgs) {
      console.log('✅ duckduckgo-search instalado');
    } else {
      missing.push('duckduckgo-search → pip install duckduckgo-search');
    }
  }

  if (missing.length > 0) {
    console.log('\n⚠️  Dependencias faltantes (instalar manualmente):');
    missing.forEach(m => console.log(`   - ${m}`));
  } else {
    console.log('\n✅ Todas las dependencias externas están listas.');
  }
}

checkAndInstall();
