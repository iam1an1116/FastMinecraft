import https from 'https';
import http from 'http';
import { URL } from 'url';

export async function safeFetch(url, options = {}) {
  const redirectsLeft = options._redirectsLeft ?? 8;
  const timeoutMs = options.timeout ?? 25000;
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const mod = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false, // Allow self-signed / proxy certificates (local tool)
    };

    const req = mod.request(reqOptions, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects fetching ${url}`));
          return;
        }
        const nextUrl = new URL(res.headers.location, url).toString();
        safeFetch(nextUrl, { ...options, _redirectsLeft: redirectsLeft - 1 })
          .then(resolve)
          .catch(reject);
        return;
      }

      const chunks = [];
      const totalSize = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;

      res.on('data', (chunk) => {
        chunks.push(chunk);
        downloaded += chunk.length;
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
          json: () => Promise.resolve(JSON.parse(body.toString('utf8'))),
          text: () => Promise.resolve(body.toString('utf8')),
          arrayBuffer: () => Promise.resolve(body),
          contentLength: totalSize,
        });
      });

      res.on('error', reject);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timeout (${timeoutMs}ms): ${url}`));
    });
    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}
