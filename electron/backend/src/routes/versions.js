import { Router } from 'express';
import { getVersions } from '../modules/version/VersionDownloader.js';

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

export { router as versionRoutes };
