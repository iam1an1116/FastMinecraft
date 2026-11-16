import { Router } from 'express';
import { getVersions, searchModpacks, getModpackVersions } from '../modules/version/VersionDownloader.js';

const router = Router();

// Get versions for a server type
router.get('/', async (req, res) => {
  try {
    const type = req.query.type || 'vanilla';
    const versions = await getVersions(type);
    res.json(versions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search Modrinth modpacks
router.get('/modpacks', async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const limit = Number(req.query.limit) || 24;
    const list = await searchModpacks(q, limit);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Modrinth modpack versions
router.get('/modpacks/:id/versions', async (req, res) => {
  try {
    const list = await getModpackVersions(req.params.id);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { router as versionRoutes };
