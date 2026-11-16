import { HashRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ServersOverview } from './pages/ServersOverview';
import { MarketPage } from './pages/MarketPage';
import { NetworkPage } from './pages/NetworkPage';
import { Settings } from './pages/Settings';
import { PlayerModePage } from './pages/PlayerModePage';
import { ServerConsole } from './pages/ServerConsole';
import { PlayerManager } from './pages/PlayerManager';
import { ModStore } from './pages/ModStore';
import { BackupManager } from './pages/BackupManager';
import { ServerSettings } from './pages/ServerSettings';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<ServersOverview />} />
          <Route path="market" element={<MarketPage />} />
          <Route path="network" element={<NetworkPage />} />
          <Route path="settings" element={<Settings />} />
          <Route path="player" element={<PlayerModePage />} />

          {/* Server-specific routes */}
          <Route path="server/:id" element={<ServerConsole />} />
          <Route path="server/:id/players" element={<PlayerManager />} />
          <Route path="server/:id/mods" element={<ModStore />} />
          <Route path="server/:id/backup" element={<BackupManager />} />
          <Route path="server/:id/network" element={<NetworkPage />} />
          <Route path="server/:id/settings" element={<ServerSettings />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
