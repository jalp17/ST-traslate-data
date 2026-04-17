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
  const apiUrlInput = document.getElementById('apiUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const apiKeyLoadButton = document.getElementById('apiKeyLoadButton');
  const useProfileProviderCheckbox = document.getElementById('useProfileProvider');
  const apiKeyProfileSelect = document.getElementById('apiKeyProfileSelect');
  const progressBar = document.getElementById('translationProgress');
  const statusText = document.getElementById('statusText');
  const batchDelayInput = document.getElementById('batchDelay');

  if (!pngInput || !translatePngButton || !translateImageBatchButton || !translateLorebookButton || !translateSelectedCharactersButton || !refreshCharacterListButton || !characterBatchSelect || !sourceLangSelect || !targetLangSelect || !providerSelect || !apiUrlInput || !apiKeyInput || !apiKeyLoadButton || !useProfileProviderCheckbox || !apiKeyProfileSelect || !progressBar || !statusText || !batchDelayInput) {
    return;
  }

  window.STTranslatorSettingsAttached = true;

  let savedConnectionProfiles = [];

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
    const name = profile.name || profile.label || profile.title || profile.id || profile.uuid || 'Perfil desconocido';

    if (!apiKey && !apiUrl && !provider) {
      return null;
    }

    return { name, apiKey, apiUrl, provider };
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
  });

  updateApiSettingsForProvider(providerSelect.value);

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
      const translatedBlob = await window.STUniversalTranslator.translateCharacterCard(
        translatorSelectedFile,
        sourceLangSelect.value,
        targetLangSelect.value,
        {
          provider: providerSelect.value,
          apiUrl: apiUrlInput.value.trim() || undefined,
          apiKey: apiKeyInput.value.trim() || undefined,
        }
      );

      updateProgress(100, 'Traducción completada. Descargando archivo.');
      const url = URL.createObjectURL(translatedBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `translated-${translatorSelectedFile.name}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      statusText.textContent = `Error: ${error.message}`;
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
      const results = await window.STUniversalTranslator.translateImageBatch(
        files,
        sourceLangSelect.value,
        targetLangSelect.value,
        outputFolderInput.value.trim(),
        {
          provider: providerSelect.value,
          apiUrl: apiUrlInput.value.trim() || undefined,
          apiKey: apiKeyInput.value.trim() || undefined,
        },
        Number(batchDelayInput.value || 500)
      );

      statusText.textContent = `Traducción de lote completada (${results.length} imágenes).`;
      console.log('Image batch results:', results);
      updateProgress(100);
    } catch (error) {
      statusText.textContent = `Error: ${error.message}`;
      updateProgress(0);
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
      const translatedLorebook = await window.STUniversalTranslator.translateLorebook(
        currentLorebook,
        sourceLangSelect.value,
        targetLangSelect.value,
        Number(batchDelayInput.value || 500),
        {
          provider: providerSelect.value,
          apiUrl: apiUrlInput.value.trim() || undefined,
          apiKey: apiKeyInput.value.trim() || undefined,
        }
      );

      statusText.textContent = 'Lorebook traducido correctamente.';
      console.log('Translated lorebook:', translatedLorebook);
      updateProgress(100);
    } catch (error) {
      statusText.textContent = `Error: ${error.message}`;
      updateProgress(0);
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
      const translatedCharacters = await window.STUniversalTranslator.translateCharacters(
        selectedItems,
        sourceLangSelect.value,
        targetLangSelect.value,
        Number(batchDelayInput.value || 500),
        {
          provider: providerSelect.value,
          apiUrl: apiUrlInput.value.trim() || undefined,
          apiKey: apiKeyInput.value.trim() || undefined,
        }
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
      statusText.textContent = `Error: ${error.message}`;
      updateProgress(0);
    }
  });

  if (typeof window.STUniversalTranslator?.getAvailableCharacters === 'function') {
    refreshCharacterList();
  } else {
    statusText.textContent = 'Listo';
  }
}
