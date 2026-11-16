const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3001/api' : '/api';

async function request(path: string, options: RequestInit = {}) {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    'x-fm-token': 'fm-local-token',
    ...((options.headers as Record<string, string>) || {})
  };

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return res.json();
}

export const api = {
  // Servers
  getServers: () => request('/servers'),
  getServer: (id: string) => request(`/servers/${id}`),
  getDownloadStatus: (id: string) => request(`/servers/${id}/download-status`),
  getLanIp: () => request('/servers/lan-ip'),
  getIpv6: () => request('/servers/ipv6'),
  createServer: (data: any) => request('/servers', { method: 'POST', body: JSON.stringify(data) }),
  startServer: (id: string) => request(`/servers/${id}/start`, { method: 'POST' }),
  stopServer: (id: string) => request(`/servers/${id}/stop`, { method: 'POST' }),
  forceStopServer: (id: string) => request(`/servers/${id}/force-stop`, { method: 'POST' }),
  restartServer: (id: string) => request(`/servers/${id}/restart`, { method: 'POST' }),
  deleteServer: (id: string) => request(`/servers/${id}`, { method: 'DELETE' }),
  updateServerConfig: (id: string, data: any) => request(`/servers/${id}/config`, { method: 'PATCH', body: JSON.stringify(data) }),
  getServerProperties: (id: string) => request(`/servers/${id}/properties`),
  updateServerProperties: (id: string, data: any) => request(`/servers/${id}/properties`, { method: 'PUT', body: JSON.stringify(data) }),

  // Versions
  getVersions: (type: string) => request(`/versions?type=${type}`),

  // Mods
  getMods: (id: string) => request(`/servers/${id}/mods`),
  uploadMod: (id: string, formData: FormData) => request(`/servers/${id}/mods`, { method: 'POST', body: formData }),
  toggleMod: (id: string, mid: string, enabled: boolean) => request(`/servers/${id}/mods/${mid}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  deleteMod: (id: string, mid: string) => request(`/servers/${id}/mods/${mid}`, { method: 'DELETE' }),

  // Backups
  getBackups: (id: string) => request(`/servers/${id}/backups`),
  createBackup: (id: string, type: string) => request(`/servers/${id}/backups`, { method: 'POST', body: JSON.stringify({ type }) }),
  restoreBackup: (id: string, bid: string) => request(`/servers/${id}/backups/${bid}/restore`, { method: 'POST' }),
  deleteBackup: (id: string, bid: string) => request(`/servers/${id}/backups/${bid}`, { method: 'DELETE' }),

  // Stats
  getStats: (id: string) => request(`/servers/${id}/stats`),

  // Players
  getPlayers: (id: string) => request(`/servers/${id}/players`),
  kickPlayer: (id: string, player: string, reason?: string) => request(`/servers/${id}/players/kick`, { method: 'POST', body: JSON.stringify({ player, reason }) }),
  banPlayer: (id: string, player: string, reason?: string) => request(`/servers/${id}/players/ban`, { method: 'POST', body: JSON.stringify({ player, reason }) }),
  opPlayer: (id: string, player: string) => request(`/servers/${id}/players/op`, { method: 'POST', body: JSON.stringify({ player }) }),

  // Network
  getProviders: () => request('/network/providers'),
  startTunnel: (id: string, provider: string, port: number, options?: any) => request(`/network/tunnel/${id}/start`, { method: 'POST', body: JSON.stringify({ provider, port, ...options }) }),
  stopTunnel: (id: string) => request(`/network/tunnel/${id}/stop`, { method: 'POST' }),
  getTunnelStatus: (id: string) => request(`/network/tunnel/${id}/status`),

  // Sakura Frp
  saveNatfrpToken: (token: string) => request('/network/natfrp/token', { method: 'POST', body: JSON.stringify({ token }) }),
  getNatfrpTokenStatus: () => request('/network/natfrp/token'),
  getNatfrpNodes: () => request('/network/natfrp/nodes'),
  getSakuraStatus: () => request('/network/sakura-status'),
  setFrpcPath: (path: string) => request('/network/frpc-path', { method: 'POST', body: JSON.stringify({ path }) }),

  // Java
  getJavaRuntimes: () => request('/java/runtimes'),
  scanLocalJava: () => request('/java/scan', { method: 'POST' }),
  getCustomJavaPath: () => request('/java/custom-path'),
  setCustomJavaPath: (path: string) => request('/java/custom-path', { method: 'POST', body: JSON.stringify({ path }) }),
  testJavaPath: (path: string) => request('/java/test', { method: 'POST', body: JSON.stringify({ path }) }),
  getJavaDownloadProgress: () => request('/java/download-progress'),
  downloadJava: (version: number) => request(`/java/download/${version}`, { method: 'POST' })
};
