import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { initDatabase } from './database/init.js';
import { setupWebSocket } from './websocket/handler.js';
import { securityMiddleware } from './middleware/security.js';
import { errorHandler } from './middleware/errorHandler.js';
import { ServerManager } from './modules/server/ServerManager.js';
import { SchedulerManager } from './modules/scheduler/SchedulerManager.js';
import { NetworkManager } from './modules/network/NetworkManager.js';
import { serverRoutes } from './routes/servers.js';
import { versionRoutes } from './routes/versions.js';
import { javaRoutes } from './routes/java.js';
import { pluginRoutes } from './routes/plugins.js';
import { modRoutes } from './routes/mods.js';
import { backupRoutes } from './routes/backups.js';
import { fileRoutes } from './routes/files.js';
import { taskRoutes } from './routes/tasks.js';
import { statsRoutes } from './routes/stats.js';
import { playerRoutes } from './routes/players.js';
import { networkRoutes } from './routes/network.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(securityMiddleware);

// Serve frontend static files
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use(express.static(join(__dirname, '../../frontend/dist')));

// API Routes
app.use('/api/servers', serverRoutes);
app.use('/api/versions', versionRoutes);
app.use('/api/java', javaRoutes);
app.use('/api/servers', pluginRoutes);
app.use('/api/servers', modRoutes);
app.use('/api/servers', backupRoutes);
app.use('/api/servers', fileRoutes);
app.use('/api/servers', taskRoutes);
app.use('/api/servers', statsRoutes);
app.use('/api/servers', playerRoutes);
app.use('/api/network', networkRoutes);

// SPA fallback — only for non-API routes
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(join(__dirname, '../../frontend/dist/index.html'));
});

// Error handler
app.use(errorHandler);

// Initialize
async function start() {
  await initDatabase();

  // Re-attach to any running servers
  await ServerManager.initExistingServers();

  // Restore scheduled tasks
  SchedulerManager.initAll();

  // Restore network tunnels from database
  await NetworkManager.restoreTunnels();

  setupWebSocket(server);

  server.listen(PORT, () => {
    console.log(`FM Backend running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

// Graceful shutdown — stop all running MC servers before exit
async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  const servers = ServerManager.getAll();
  for (const s of servers) {
    if (ServerManager.processes.has(s.id)) {
      console.log(`Stopping server: ${s.name}`);
      try {
        await ServerManager.stop(s.id);
      } catch (err) {
        console.error(`Failed to stop ${s.name}:`, err.message);
      }
    }
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, server };
