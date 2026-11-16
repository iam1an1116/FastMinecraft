import { Router } from 'express';
import { execSync } from 'child_process';
import { getInstalledRuntimes, getJavaPath, downloadJava, setCustomJavaPath, getCustomJavaPath, scanLocalJava, getJavaVersionFromPath } from '../modules/java/JavaManager.js';

const router = Router();

// Get installed Java runtimes
router.get('/runtimes', (req, res) => {
  const runtimes = getInstalledRuntimes();
  res.json(runtimes);
});

// Scan local system for Java
router.post('/scan', (req, res) => {
  try {
    const found = scanLocalJava();
    const runtimes = getInstalledRuntimes();
    res.json({ scanned: found.length, runtimes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get/set custom Java path
router.get('/custom-path', (req, res) => {
  res.json({ path: getCustomJavaPath() });
});

router.post('/custom-path', (req, res) => {
  const { path } = req.body;
  setCustomJavaPath(path || null);
  res.json({ path: getCustomJavaPath() });
});

// Test Java path
router.post('/test', (req, res) => {
  try {
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: 'Path required' });

    const output = execSync(`"${path}" -version 2>&1`, { encoding: 'utf-8' });
    const version = getJavaVersionFromPath(path);
    if (version) {
      res.json({ valid: true, version: String(version), output });
    } else {
      res.json({ valid: false, output });
    }
  } catch (err) {
    res.json({ valid: false, error: err.message });
  }
});

// Download Java with progress
const javaDownloadProgress = new Map(); // version -> { percent, downloaded, total, status }

router.get('/download-progress', (req, res) => {
  const version = parseInt(req.query.version || '21');
  res.json(javaDownloadProgress.get(version) || { percent: 0, downloaded: 0, total: 0, status: 'idle' });
});

router.post('/download/:version', async (req, res) => {
  try {
    const version = parseInt(req.params.version);
    javaDownloadProgress.set(version, { percent: 0, downloaded: 0, total: 0, status: 'downloading' });

    const path = await downloadJava(version, (progress) => {
      javaDownloadProgress.set(version, { ...progress, status: 'downloading' });
    });

    javaDownloadProgress.set(version, { percent: 100, downloaded: 0, total: 0, status: 'complete' });
    res.json({ path, version });
  } catch (err) {
    javaDownloadProgress.set(version, { percent: 0, downloaded: 0, total: 0, status: 'error', error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export { router as javaRoutes };
