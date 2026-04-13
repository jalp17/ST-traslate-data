# ST-Universal-Translator

Extensión para SillyTavern que traduce contenido de lorebooks y tarjetas de personaje.

## Funcionalidad

- Traducción de lorebooks JSON (`world_info.entries`) con preservación de placeholders.
- Traducción de tarjetas de personaje PNG que almacenan metadatos en el chunk `chara`.
- Soporta múltiples proveedores de traducción:
  - OpenAI
  - KoboldCPP (local)
  - llama.cpp
  - Ollama
  - LLM Studio
  - OpenRouter
  - Electron Hub
  - Google AI Studio
  - Google Translate básico
- Batch de traducción con delay configurable para evitar rate limiting.

## Archivos principales

- `script.js`: lógica principal de la extensión, parsing PNG, preservación de variables y rutas de traducción.
- `settings.html`: panel de configuración con selectores de idioma, proveedor, API URL, API key y barra de progreso.

## Uso

1. Abre `settings.html` dentro de SillyTavern o en el contexto de la extensión.
2. Selecciona el idioma origen y destino.
3. Elige el proveedor de traducción y configura `API URL` / `API key` según el proveedor.
4. Sube un PNG de tarjeta de personaje y pulsa `Traducir tarjeta PNG`.
5. Para lorebooks, pulsa `Procesar lorebook actual`.

## Configuración de proveedores

- `openai`: usa el endpoint de OpenAI o uno personalizado en `apiUrl`.
- `local_koboldcpp`, `llama_cpp`, `ollama`, `llm_studio`, `openrouter`, `electron_hub`: soportan endpoint local o remoto.
- `google_aistudio`: se puede usar con `apiKey` o `apiUrl` personalizado.
- `google_translate`: requiere `apiKey` o `apiUrl` personalizado para Google Translate.

## Advertencias

- La implementación actual asume que los datos de la imagen PNG en el chunk `chara` son Base64 de JSON.
- Debes probar cada proveedor con su endpoint y opciones específicas de configuración.

## Licencia

MIT License. Consulta el archivo `LICENSE` para más detalles.
