// Перевірка статусів та завантаження JSON
export async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status} for ${url}`);
  }
  return await response.json();
}

// Повтор запиту з exponential backoff та jitter (не повторюємо 4xx помилки)
export async function withRetry(fn, { attempts = 3, baseMs = 300, signal } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return await fn();
    } catch (error) {
      // Якщо це помилка клієнта 4xx або запит скасовано — не робимо ретрай
      if (error.message.includes('status: 4') || error.name === 'AbortError') {
        throw error;
      }
      if (i === attempts - 1) throw error;
      
      const delay = baseMs * Math.pow(2, i) + Math.random() * 100;
      await new Promise((resolve, setTimeoutRef = setTimeout) => {
        const timer = setTimeoutRef(resolve, delay);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
  }
}

export async function loadImage(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const onAbort = () => {
      img.src = '';
      reject(new DOMException('Image load aborted', 'AbortError'));
    };

    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });

    img.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(img);
    };
    img.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`Failed to load image: ${url}`));
    };
    img.src = url;
  });
}

export async function loadAudio(audioCtx, url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to load audio: ${url} (status ${response.status})`);
  const arrayBuffer = await response.arrayBuffer();
  return await audioCtx.decodeAudioData(arrayBuffer);
}

// Паралельне завантаження всього маніфесту через Promise.all з відстеженням прогресу
export async function loadAll(manifestUrl, audioCtx, { onProgress, signal } = {}) {
  const manifest = await withRetry(() => fetchJson(manifestUrl, { signal }), { signal });
  
  const spriteEntries = Object.entries(manifest.sprites || {});
  const audioEntries = Object.entries(manifest.audio || {});
  
  const totalItems = spriteEntries.length + audioEntries.length;
  let loadedCount = 0;

  const updateProgress = (promise) => {
    return promise.then((res) => {
      loadedCount++;
      if (onProgress) onProgress(loadedCount / totalItems);
      return res;
    });
  };

  const spritePromises = spriteEntries.map(([key, url]) => 
    updateProgress(withRetry(() => loadImage(url, signal), { signal }))
      .then(img => [key, img])
      .catch(err => {
        console.warn(`Skipping missing sprite: ${url}`, err);
        return [key, null]; // Якщо картинка бита, повертаємо null замість падіння
      })
  );

  const audioPromises = audioEntries.map(([key, url]) => 
    updateProgress(withRetry(() => loadAudio(audioCtx, url, signal), { signal }))
      .then(buffer => [key, buffer])
      .catch(err => {
        console.warn(`Skipping missing audio: ${url}`, err);
        return [key, null]; // Якщо звук битий, повертаємо null
      })
  );

  const [spriteResults, audioResults] = await Promise.all([
    Promise.all(spritePromises),
    Promise.all(audioPromises)
  ]);

  return {
    sprites: Object.fromEntries(spriteResults.filter(([_, v]) => v !== null)),
    audioBuffers: Object.fromEntries(audioResults.filter(([_, v]) => v !== null)),
    rooms: manifest.rooms || []
  };
}