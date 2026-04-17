import { DEFAULT_ENDPOINTS } from './translateProviders.js';

export async function initializeExtensionPanel() {
  const tryRenderSettings = async () => {
    const ST = globalThis.SillyTavern;
    if (!ST?.getContext) {
      return false;
    }

    const context = ST.getContext();
    if (!context || typeof context.renderExtensionTemplateAsync !== 'function') {
      return false;
    }

    const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!target) {
      return false;
    }

    try {
      let settingsHtml = await context.renderExtensionTemplateAsync('third-party/ST-traslate-data', 'settings');
      if (!settingsHtml) {
        const currentScript = document.currentScript || document.querySelector('script[src*="script.js"]');
        const baseUrl = currentScript?.src ? currentScript.src.replace(/\/[^/]*$/, '/') : null;
        const candidates = [];

        if (baseUrl) {
          candidates.push(new URL('settings.html', baseUrl).href);
          candidates.push(new URL('../settings.html', baseUrl).href);
        }

        for (const url of candidates) {
          try {
            const settingsResponse = await fetch(url);
            if (settingsResponse.ok) {
              settingsHtml = await settingsResponse.text();
              break;
            }
          } catch {
            // ignore failed candidate
          }
        }
      }

      if (settingsHtml) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = settingsHtml;
        while (wrapper.firstChild) {
          target.appendChild(wrapper.firstChild);
        }
        attachTranslatorSettingsEvents();
      }
    } catch (error) {
      console.warn('ST-Universal-Translator: error al cargar el panel de configuración', error);
    }

    return true;
  };

  const init = async () => {
    const ready = await tryRenderSettings();
    if (!ready) {
      setTimeout(init, 1000);
    }
  };

  init();
}

export function attachTranslatorSettingsEvents() {
  if (window.STTranslatorSettingsAttached) {
    return;
  }

  const pngInput = document.getElementById('pngInput');
  const translatePngButton = document.getElementById('translatePngButton');
  const translateImageBatchButton = document.getElementById('translateImageBatchButton');
  const translateLorebookButton = document.getElementById('translateLorebookButton');
  const translateSelectedCharactersButton = document.getElementById('translateSelectedCharactersButton');
  const refreshCharacterListButton = document.getElementById('refreshCharacterListButton');
  const pngBatchInput = document.getElementById('pngBatchInput');
  const outputFolderInput = document.getElementById('outputFolder');
  const characterBatchSelect = document.getElementById('characterBatchSelect');
  const sourceLangSelect = document.getElementById('sourceLang');
  const targetLangSelect = document.getElementById('targetLang');
  const providerSelect = document.getElementById('providerSelect');
  const modelInput = document.getElementById('modelInput');
  const apiUrlInput = document.getElementById('apiUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const apiKeyLoadButton = document.getElementById('apiKeyLoadButton');
  const useProfileProviderCheckbox = document.getElementById('useProfileProvider');
  const apiKeyProfileSelect = document.getElementById('apiKeyProfileSelect');
  const progressBar = document.getElementById('translationProgress');
  const statusText = document.getElementById('statusText');
  const batchDelayInput = document.getElementById('batchDelay');

  if (!pngInput || !translatePngButton || !translateImageBatchButton || !translateLorebookButton || !translateSelectedCharactersButton || !refreshCharacterListButton || !characterBatchSelect || !sourceLangSelect || !targetLangSelect || !providerSelect || !modelInput || !apiUrlInput || !apiKeyInput || !apiKeyLoadButton || !useProfileProviderCheckbox || !apiKeyProfileSelect || !progressBar || !statusText || !batchDelayInput) {
    return;
  }

  window.STTranslatorSettingsAttached = true;

  let savedConnectionProfiles = [];
  const MODEL_SUGGESTIONS = {
    openai: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gpt-3.5-turbo-0613', 'gpt-4-0613'],
    local_koboldcpp: ['llama', 'llama2', 'mistral', 'kobold-70b'],
    llama_cpp: ['llama', 'llama2', 'meta-llama/Llama-2-7b-chat', 'llama-3'],
    ollama: ['llama2', 'mistral', 'gpt-4o', 'gpt-4'],
    llm_studio: ['text-davinci-003', 'gpt-4', 'gpt-4o'],
    openrouter: ['gpt-4', 'gpt-3.5-turbo', 'gpt-4o'],
    electron_hub: ['default'],
    google_aistudio: ['models/text-bison-001', 'models/chat-bison-001'],
    google_translate: [],
  };

  function updateModelSuggestionList(provider) {
    const suggestions = MODEL_SUGGESTIONS[provider] || [];
    const listElement = document.getElementById('modelSuggestions');
    if (!listElement) {
      return;
    }

    listElement.innerHTML = '';
    suggestions.forEach((model) => {
      const option = document.createElement('option');
      option.value = model;
      listElement.appendChild(option);
    });

    if (!modelInput.value.trim()) {
      modelInput.placeholder = suggestions.length ? `Ej: ${suggestions[0]}` : 'Escriba el modelo';
    }
  }

  function buildProviderConfig() {
    const provider = providerSelect.value;
    const config = {
      provider,
      apiKey: apiKeyInput.value.trim() || undefined,
      apiUrl: apiUrlInput.value.trim() || undefined,
      model: modelInput.value.trim() || undefined,
    };

    if (useProfileProviderCheckbox.checked) {
      const profileIndex = apiKeyProfileSelect.value;
      if (profileIndex) {
        const profile = savedConnectionProfiles[Number(profileIndex)];
        if (profile) {
          if (profile.apiKey) config.apiKey = profile.apiKey;
          if (profile.apiUrl) config.apiUrl = profile.apiUrl;
          if (profile.provider) config.provider = profile.provider;
          if (profile.model) config.model = profile.model;
        }
      }
    }

    return config;
  }

  function validateProviderConfig(config) {
    if (!config.provider) {
      throw new Error('Debe seleccionar un proveedor de traducción.');
    }

    if (config.provider === 'openai' && !config.apiKey) {
      throw new Error('OpenAI requiere una API key válida en el campo correspondiente o desde el perfil de conexión.');
    }

    if (config.provider === 'google_translate' && !config.apiKey && !config.apiUrl) {
      throw new Error('Google Translate requiere clave API o un endpoint personalizado.');
    }

    return config;
  }

  function handleTranslationError(error, fallbackMessage) {
    console.error('Traducción fallida:', error);
    statusText.textContent = error?.message || fallbackMessage || 'Error desconocido durante la traducción.';
    updateProgress(0);
  }

  function setCharacterList(characters) {
    characterBatchSelect.innerHTML = '';
    if (!characters?.length) {
      const option = document.createElement('option');
      option.textContent = 'No se encontraron personajes disponibles';
      option.disabled = true;
      characterBatchSelect.appendChild(option);
      return;
    }

    characters.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      characterBatchSelect.appendChild(option);
    });
  }

  async function refreshCharacterList() {
    const characters = window.STUniversalTranslator?.getAvailableCharacters?.() || [];
    setCharacterList(characters);
    statusText.textContent = characters.length
      ? `${characters.length} personajes disponibles` : 'No hay personajes disponibles';
  }

  function updateProgress(value, message) {
    progressBar.style.width = `${value}%`;
    if (message) {
      statusText.textContent = message;
    }
  }

  function normalizeProfile(profile) {
    if (!profile || typeof profile !== 'object') {
      return null;
    }

    const apiKey = profile.apiKey || profile.key || profile.token || profile.accessToken || profile.secret || profile.secretKey;
    const apiUrl = profile.apiUrl || profile.endpoint || profile.baseUrl || profile.url || profile.api_url;
    const provider = profile.provider || profile.service || profile.type || profile.backend || profile.engine || profile.modelProvider;
    const model = profile.model || profile.modelName || profile.model_id || profile.modelId;
    const name = profile.name || profile.label || profile.title || profile.id || profile.uuid || 'Perfil desconocido';

    if (!apiKey && !apiUrl && !provider) {
      return null;
    }

    return { name, apiKey, apiUrl, provider, model };
  }

  async function findSavedApiKeyProfiles() {
    const candidates = [];
    const sources = [
      window.SillyTavern?.getConnectionProfiles,
      window.SillyTavern?.getConnections,
      window.SillyTavern?.connectionProfiles,
      window.SillyTavern?.connections,
      window.getConnectionProfiles,
      window.getConnections,
      window.connectionProfiles,
      window.connections,
    ];

    for (const source of sources) {
      try {
        let value;
        if (typeof source === 'function') {
          const boundSource = source.bind(window.SillyTavern || window);
          value = await boundSource();
        } else {
          value = source;
        }

        if (!value) continue;
        if (Array.isArray(value)) {
          candidates.push(...value);
          continue;
        }
        if (typeof value === 'object') {
          candidates.push(value);
          continue;
        }
      } catch {
        // ignore unsupported source
      }
    }

    return candidates
      .map(normalizeProfile)
      .filter((profile) => profile && (profile.apiKey || profile.apiUrl));
  }

  function populateApiKeyProfiles(profiles) {
    savedConnectionProfiles = profiles;
    apiKeyProfileSelect.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = profiles.length ? 'Seleccione un perfil de conexión' : 'No hay perfiles de conexión guardados';
    defaultOption.disabled = !profiles.length;
    defaultOption.selected = true;
    apiKeyProfileSelect.appendChild(defaultOption);

    profiles.forEach((profile, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = profile.name;
      apiKeyProfileSelect.appendChild(option);
    });

    apiKeyProfileSelect.disabled = !profiles.length;
    apiKeyLoadButton.disabled = !profiles.length;
  }

  function applyProfileProviderSettings(profile) {
    if (profile.provider && Array.from(providerSelect.options).some((option) => option.value === profile.provider)) {
      providerSelect.value = profile.provider;
    }
    if (profile.apiUrl) {
      apiUrlInput.value = profile.apiUrl;
    }
    if (profile.model) {
      modelInput.value = profile.model;
    }
    updateModelSuggestionList(providerSelect.value);
  }

  function applyProfileSelection() {
    const profileIndex = apiKeyProfileSelect.value;
    if (!profileIndex) {
      return;
    }

    const profile = savedConnectionProfiles[Number(profileIndex)];
    if (!profile) {
      return;
    }

    if (profile.apiKey) {
      apiKeyInput.value = profile.apiKey;
    }

    if (useProfileProviderCheckbox.checked) {
      applyProfileProviderSettings(profile);
    }

    updateModelSuggestionList(providerSelect.value);
  }

  apiKeyProfileSelect.addEventListener('change', applyProfileSelection);
  useProfileProviderCheckbox.addEventListener('change', applyProfileSelection);
  apiKeyLoadButton.addEventListener('click', () => {
    const profileIndex = apiKeyProfileSelect.value;
    if (!profileIndex) {
      statusText.textContent = 'Seleccione primero un perfil de conexión para cargar la clave.';
      return;
    }

    const profile = savedConnectionProfiles[Number(profileIndex)];
    if (!profile?.apiKey) {
      statusText.textContent = 'El perfil seleccionado no tiene una API key guardada.';
      return;
    }

    apiKeyInput.value = profile.apiKey;
    statusText.textContent = 'Clave API cargada desde el perfil seleccionado.';

    if (useProfileProviderCheckbox.checked) {
      applyProfileProviderSettings(profile);
    }
  });

  function updateApiSettingsForProvider(provider) {
    const defaultUrl = DEFAULT_ENDPOINTS[provider] || '';
    apiUrlInput.placeholder = defaultUrl;
    if (!apiUrlInput.value.trim()) {
      apiUrlInput.value = defaultUrl;
    }
  }

  providerSelect.addEventListener('change', () => {
    updateApiSettingsForProvider(providerSelect.value);
    updateModelSuggestionList(providerSelect.value);
    console.log('Proveedor seleccionado:', providerSelect.value);
  });

  updateApiSettingsForProvider(providerSelect.value);
  updateModelSuggestionList(providerSelect.value);

  let translatorSelectedFile = null;

  findSavedApiKeyProfiles().then(populateApiKeyProfiles).catch(() => {
    populateApiKeyProfiles([]);
  });
  pngInput.addEventListener('change', (event) => {
    translatorSelectedFile = event.target.files?.[0] || null;
    statusText.textContent = translatorSelectedFile ? `Archivo seleccionado: ${translatorSelectedFile.name}` : 'Listo';
  });

  translatePngButton.addEventListener('click', async () => {
    if (!translatorSelectedFile) {
      statusText.textContent = 'Seleccione primero un PNG válido.';
      return;
    }

    updateProgress(10, 'Preparando traducción del PNG...');

    try {
      const providerConfig = validateProviderConfig(buildProviderConfig());
      console.log('Iniciando traducción de PNG con configuración:', providerConfig);
      const translatedBlob = await window.STUniversalTranslator.translateCharacterCard(
        translatorSelectedFile,
        sourceLangSelect.value,
        targetLangSelect.value,
        providerConfig
      );

      updateProgress(100, 'Traducción completada. Descargando archivo.');
      const url = URL.createObjectURL(translatedBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `translated-${translatorSelectedFile.name}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      handleTranslationError(error, 'Error durante la traducción del PNG.');
    }
  });

  translateImageBatchButton.addEventListener('click', async () => {
    const files = Array.from(pngBatchInput.files || []);
    if (!files.length) {
      statusText.textContent = 'Seleccione al menos una imagen PNG para el lote.';
      return;
    }

    updateProgress(10, 'Iniciando traducción de lote de imágenes...');

    try {
      const providerConfig = validateProviderConfig(buildProviderConfig());
      console.log('Iniciando traducción de lote de imágenes con configuración:', providerConfig);
      const results = await window.STUniversalTranslator.translateImageBatch(
        files,
        sourceLangSelect.value,
        targetLangSelect.value,
        outputFolderInput.value.trim(),
        providerConfig,
        Number(batchDelayInput.value || 500)
      );

      statusText.textContent = `Traducción de lote completada (${results.length} imágenes).`;
      console.log('Image batch results:', results);
      updateProgress(100);
    } catch (error) {
      handleTranslationError(error, 'Error durante la traducción de lote.');
    }
  });

  translateLorebookButton.addEventListener('click', async () => {
    updateProgress(5, 'Iniciando traducción de lorebook...');
    const currentLorebook = window.getCurrentLorebook?.();

    if (!currentLorebook) {
      statusText.textContent = 'No se encontró el lorebook actual en el entorno.';
      updateProgress(0);
      return;
    }

    try {
      const providerConfig = validateProviderConfig(buildProviderConfig());
      console.log('Iniciando traducción de lorebook con configuración:', providerConfig);
      const translatedLorebook = await window.STUniversalTranslator.translateLorebook(
        currentLorebook,
        sourceLangSelect.value,
        targetLangSelect.value,
        Number(batchDelayInput.value || 500),
        providerConfig
      );

      statusText.textContent = 'Lorebook traducido correctamente.';
      console.log('Translated lorebook:', translatedLorebook);
      updateProgress(100);
    } catch (error) {
      handleTranslationError(error, 'Error durante la traducción del lorebook.');
    }
  });

  translateSelectedCharactersButton.addEventListener('click', async () => {
    updateProgress(5, 'Iniciando traducción de personajes seleccionados...');

    const selectedIds = Array.from(characterBatchSelect.selectedOptions).map((option) => option.value);
    if (!selectedIds.length) {
      statusText.textContent = 'Seleccione al menos un personaje de la lista.';
      updateProgress(0);
      return;
    }

    const availableCharacters = window.STUniversalTranslator?.getAvailableCharacters?.() || [];
    const selectedItems = availableCharacters
      .filter((item) => selectedIds.includes(item.id))
      .map((item) => item.data);

    if (!selectedItems.length) {
      statusText.textContent = 'No se encontraron los personajes seleccionados.';
      updateProgress(0);
      return;
    }

    try {
      const providerConfig = validateProviderConfig(buildProviderConfig());
      console.log('Iniciando traducción de personajes con configuración:', providerConfig);
      const translatedCharacters = await window.STUniversalTranslator.translateCharacters(
        selectedItems,
        sourceLangSelect.value,
        targetLangSelect.value,
        Number(batchDelayInput.value || 500),
        providerConfig
      );

      if (window.setCurrentCharacters) {
        window.setCurrentCharacters(translatedCharacters);
      } else if (window.setCurrentCharacter) {
        window.setCurrentCharacter(translatedCharacters);
      }

      statusText.textContent = 'Personajes seleccionados traducidos correctamente.';
      console.log('Translated characters:', translatedCharacters);
      updateProgress(100);
    } catch (error) {
      handleTranslationError(error, 'Error durante la traducción de personajes seleccionados.');
    }
  });

  if (typeof window.STUniversalTranslator?.getAvailableCharacters === 'function') {
    refreshCharacterList();
  } else {
    statusText.textContent = 'Listo';
  }
}
