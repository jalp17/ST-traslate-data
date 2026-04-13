const currentScript = document.currentScript || document.querySelector('script[src*="script.js"]');
const baseUrl = currentScript?.src ? currentScript.src.replace(/\/[^/]*$/, '/') : window.location.href.replace(/\/[^/]*$/, '/');
const modulePath = new URL('./src/index.js', baseUrl).href;

let modulePromise = null;

function loadModule() {
  if (!modulePromise) {
    modulePromise = import(modulePath).catch((error) => {
      console.warn('ST-Universal-Translator: error al importar el módulo', error);
      throw error;
    });
  }
  return modulePromise;
}

loadModule()
  .then((module) => module.initializeTranslator())
  .then(() => loadModule().then((module) => module.initializeExtensionPanel()))
  .catch((error) => console.warn('ST-Universal-Translator: error al inicializar el módulo', error));

export async function onActivate() {
  const module = await loadModule();
  return module.onActivate?.();
}
