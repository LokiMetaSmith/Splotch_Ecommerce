/**
 * chunkedUpload.js
 * 
 * Handles streaming/chunked multipart uploads for large canvas prints, high-res artwork,
 * and cutlines. Slices assets into 5MB chunks to bypass Cloudflare's 100MB body payload limit,
 * supports retry on spotty connections, and provides real-time progress callbacks.
 */

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const DEFAULT_MAX_RETRIES = 3;

/**
 * Uploads an arbitrary File or Blob in sequential chunks with retry and progress tracking.
 * 
 * @param {Blob|File} fileOrBlob - The file or blob to upload
 * @param {Object} options - Configuration options
 * @param {string} [options.serverUrl=''] - Base URL of the backend API
 * @param {string} [options.token=''] - JWT Bearer auth token
 * @param {string} [options.csrfToken=''] - CSRF protection token
 * @param {string} [options.filename='design.png'] - Target filename
 * @param {boolean} [options.isCutLine=false] - Whether this file is a cutline (SVG)
 * @param {number} [options.chunkSize=5242880] - Size of each chunk in bytes (default 5MB)
 * @param {number} [options.maxRetries=3] - Maximum retry attempts per chunk
 * @param {Function} [options.onProgress] - Callback ({ percent, currentChunk, totalChunks, loadedBytes, totalBytes })
 * @returns {Promise<{ filePath: string, isCutLine: boolean, success: boolean }>}
 */
export async function uploadFileInChunks(fileOrBlob, options = {}) {
  const {
    serverUrl = '',
    token = '',
    csrfToken = '',
    filename = fileOrBlob.name || (options.isCutLine ? 'cutline.svg' : 'design.png'),
    isCutLine = false,
    chunkSize = DEFAULT_CHUNK_SIZE,
    maxRetries = DEFAULT_MAX_RETRIES,
    onProgress = null
  } = options;

  const totalSize = fileOrBlob.size;
  if (totalSize === 0) {
    throw new Error('Cannot upload an empty file');
  }

  const totalChunks = Math.ceil(totalSize / chunkSize);
  const mimeType = fileOrBlob.type || (isCutLine ? 'image/svg+xml' : 'application/octet-stream');

  const authHeaders = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
  };

  // 1. Initialize Chunked Upload Session
  const initRes = await fetch(`${serverUrl}/api/upload-chunk/init`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders
    },
    body: JSON.stringify({
      filename,
      totalSize,
      totalChunks,
      mimeType,
      isCutLine
    })
  });

  if (!initRes.ok) {
    const errorData = await initRes.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to initialize chunked upload (${initRes.status})`);
  }

  const initData = await initRes.json();
  const uploadId = initData.uploadId;

  // 2. Upload Chunks Sequentially with Retries
  let uploadedBytes = 0;

  for (let chunkIndex = 1; chunkIndex <= totalChunks; chunkIndex++) {
    const start = (chunkIndex - 1) * chunkSize;
    const end = Math.min(start + chunkSize, totalSize);
    const chunkBlob = fileOrBlob.slice(start, end);

    let attempt = 0;
    let success = false;
    let lastError = null;

    while (attempt < maxRetries && !success) {
      attempt++;
      try {
        const formData = new FormData();
        formData.append('uploadId', uploadId);
        formData.append('chunkIndex', chunkIndex.toString());
        formData.append('chunk', chunkBlob, `${filename}.part${chunkIndex}`);

        const chunkRes = await fetch(`${serverUrl}/api/upload-chunk`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            ...authHeaders
          },
          body: formData
        });

        if (!chunkRes.ok) {
          const errBody = await chunkRes.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${chunkRes.status}`);
        }

        success = true;
        uploadedBytes += (end - start);

        if (typeof onProgress === 'function') {
          const percent = Math.min(100, Math.round((uploadedBytes / totalSize) * 100));
          onProgress({
            percent,
            currentChunk: chunkIndex,
            totalChunks,
            loadedBytes: uploadedBytes,
            totalBytes: totalSize
          });
        }
      } catch (err) {
        lastError = err;
        console.warn(`[CHUNKED] Chunk ${chunkIndex}/${totalChunks} attempt ${attempt} failed:`, err.message);
        if (attempt < maxRetries) {
          // Exponential backoff: 500ms, 1000ms, 2000ms
          await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 500));
        }
      }
    }

    if (!success) {
      // Best-effort cleanup on failure
      try {
        await fetch(`${serverUrl}/api/upload-chunk/abort`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders
          },
          body: JSON.stringify({ uploadId })
        });
      } catch (abortErr) {
        console.warn('[CHUNKED] Failed to abort failed session:', abortErr.message);
      }

      throw new Error(`Upload failed on chunk ${chunkIndex}/${totalChunks}: ${lastError?.message || 'Network error'}`);
    }
  }

  // 3. Complete and Reassemble Upload Session
  const completeRes = await fetch(`${serverUrl}/api/upload-chunk/complete`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders
    },
    body: JSON.stringify({ uploadId })
  });

  if (!completeRes.ok) {
    const errorData = await completeRes.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to complete chunked upload (${completeRes.status})`);
  }

  const completeData = await completeRes.json();
  return {
    success: true,
    filePath: completeData.filePath,
    isCutLine: completeData.isCutLine
  };
}

/**
 * Unified asset uploader for checkout and creator products.
 * Seamlessly chooses chunked streaming upload for files exceeding threshold,
 * or standard multipart upload for small files.
 * 
 * @param {Object} params
 * @param {Blob|File} params.designBlob - Design image raster/canvas blob
 * @param {Blob|File} [params.cutLineBlob] - Optional SVG cutline blob or file
 * @param {string} [params.serverUrl=''] - Base backend URL
 * @param {string} [params.token=''] - JWT Bearer token
 * @param {string} [params.csrfToken=''] - CSRF Token
 * @param {number} [params.chunkThreshold=5242880] - Byte threshold above which chunking is used (default 5MB)
 * @param {Function} [params.onProgress] - Progress reporting ({ phase, percent, detail })
 * @returns {Promise<{ designImagePath: string, cutLinePath?: string }>}
 */
export async function uploadDesignAssets({
  designBlob,
  cutLineBlob = null,
  serverUrl = '',
  token = '',
  csrfToken = '',
  chunkThreshold = DEFAULT_CHUNK_SIZE,
  onProgress = null
}) {
  const isDesignLarge = designBlob && designBlob.size > chunkThreshold;
  const isCutLineLarge = cutLineBlob && cutLineBlob.size > chunkThreshold;
  const shouldChunk = isDesignLarge || isCutLineLarge;

  if (shouldChunk) {
    console.log(`[CLIENT] Using chunked upload (design: ${(designBlob.size / 1024 / 1024).toFixed(2)} MB, cutline: ${cutLineBlob ? (cutLineBlob.size / 1024 / 1024).toFixed(2) : 0} MB)`);
    
    // Upload design image
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'design', percent: 0, detail: 'Starting artwork upload...' });
    }

    const designResult = await uploadFileInChunks(designBlob, {
      serverUrl,
      token,
      csrfToken,
      filename: designBlob.name || 'design.png',
      isCutLine: false,
      onProgress: (p) => {
        if (typeof onProgress === 'function') {
          const scaledPercent = cutLineBlob ? Math.round(p.percent * 0.85) : p.percent;
          onProgress({
            phase: 'design',
            percent: scaledPercent,
            detail: `Uploading artwork: ${p.percent}% (chunk ${p.currentChunk} of ${p.totalChunks})`
          });
        }
      }
    });

    let cutLinePath = undefined;
    if (cutLineBlob) {
      if (typeof onProgress === 'function') {
        onProgress({ phase: 'cutline', percent: 85, detail: 'Uploading cutline...' });
      }

      const cutLineResult = await uploadFileInChunks(cutLineBlob, {
        serverUrl,
        token,
        csrfToken,
        filename: cutLineBlob.name || 'generated-cutline.svg',
        isCutLine: true,
        onProgress: (p) => {
          if (typeof onProgress === 'function') {
            const scaledPercent = 85 + Math.round(p.percent * 0.15);
            onProgress({
              phase: 'cutline',
              percent: scaledPercent,
              detail: `Uploading cutline: ${p.percent}%`
            });
          }
        }
      });
      cutLinePath = cutLineResult.filePath;
    }

    if (typeof onProgress === 'function') {
      onProgress({ phase: 'complete', percent: 100, detail: 'Upload complete!' });
    }

    return {
      designImagePath: designResult.filePath,
      cutLinePath
    };
  }

  // Fallback / standard path for small files: single multipart request
  const uploadFormData = new FormData();
  uploadFormData.append('designImage', designBlob, designBlob.name || 'design.png');
  if (cutLineBlob) {
    uploadFormData.append('cutLineFile', cutLineBlob, cutLineBlob.name || 'generated-cutline.svg');
  }

  const uploadResponse = await fetch(`${serverUrl}/api/upload-design`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
    },
    body: uploadFormData
  });

  const uploadData = await uploadResponse.json();
  if (!uploadResponse.ok) {
    throw new Error(uploadData.error || 'Failed to upload design.');
  }

  return {
    designImagePath: uploadData.designImagePath,
    cutLinePath: uploadData.cutLinePath
  };
}
