import { initializeTranslator, initializeExtensionPanel, onActivate } from './index.js';

initializeTranslator()
  .then(() => initializeExtensionPanel())
  .catch((error) => console.warn('ST-Universal-Translator: error al inicializar el módulo', error));

window.onActivate = onActivate;
window.STUniversalTranslatorModule = { initializeTranslator, initializeExtensionPanel, onActivate };
