import https from 'https';
import http from 'http';
import { URL } from 'url';

export async function safeFetch(url, options = {}) {
  const isHttps = url.startsWith('https');
  const mod = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false, // Allow self-signed / proxy certificates (local tool)
    };

    const req = mod.request(reqOptions, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return safeFetch(res.headers.location, options).then(resolve).catch(reject);
      }

      const chunks = [];
      let totalSize = parseInt(res.headers['content-length'] || '0');
      let downloaded = 0;

      res.on('data', chunk => {
        chunks.push(chunk);
        downloaded += chunk.length;

        // Report progress if callback provided
        if (options.onProgress && totalSize > 0) {
          options.onProgress(downloaded, totalSize);
        }
      });

      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          json: () => Promise.resolve(JSON.parse(body.toString())),
          text: () => Promise.resolve(body.toString()),
          arrayBuffer: () => Promise.resolve(body),
          contentLength: totalSize
        });
      });

      res.on('error', reject);
    });

    req.on('error', reject);

    // Write body if provided
    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}
