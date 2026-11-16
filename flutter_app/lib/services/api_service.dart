import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/server_model.dart';

class ApiService {
  static const String baseUrl = 'http://127.0.0.1:3001/api';
  static const Map<String, String> defaultHeaders = {
    'x-fm-token': 'fm-local-token',
    'Content-Type': 'application/json',
  };

  static Future<bool> pingBackend() async {
    try {
      final res = await http
          .get(Uri.parse('$baseUrl/servers'), headers: defaultHeaders)
          .timeout(const Duration(milliseconds: 600));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // Servers
  static Future<List<ServerInfo>> getServers() async {
    try {
      final res = await http
          .get(Uri.parse('$baseUrl/servers'), headers: defaultHeaders)
          .timeout(const Duration(seconds: 4));
      if (res.statusCode == 200) {
        final List data = jsonDecode(res.body);
        return data.map((e) => ServerInfo.fromJson(e)).toList();
      }
    } catch (_) {}
    return [];
  }

  static Future<ServerInfo?> getServer(String id) async {
    try {
      final res = await http
          .get(Uri.parse('$baseUrl/servers/$id'), headers: defaultHeaders)
          .timeout(const Duration(seconds: 4));
      if (res.statusCode == 200) {
        return ServerInfo.fromJson(jsonDecode(res.body));
      }
    } catch (_) {}
    return null;
  }

  static Future<List<String>> getServerLogs(String id, {int limit = 500}) async {
    try {
      final res = await http
          .get(Uri.parse('$baseUrl/servers/$id/logs?limit=$limit'), headers: defaultHeaders)
          .timeout(const Duration(seconds: 4));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final List logs = data['logs'] ?? [];
        return logs.map((e) => e.toString()).toList();
      }
    } catch (_) {}
    return [];
  }

  static Future<bool> updateServerConfig(String id, Map<String, dynamic> config) async {
    try {
      final res = await http.patch(
        Uri.parse('$baseUrl/servers/$id/config'),
        headers: defaultHeaders,
        body: jsonEncode(config),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<String> getLanIp() async {
    try {
      final res = await http
          .get(Uri.parse('$baseUrl/servers/lan-ip'), headers: defaultHeaders)
          .timeout(const Duration(seconds: 3));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return data['ip']?.toString() ?? '127.0.0.1';
      }
    } catch (_) {}
    return '127.0.0.1';
  }

  static Future<Map<String, dynamic>> diagnoseIpv6({int port = 25565, String? serverId}) async {
    try {
      final query = serverId != null ? 'port=$port&serverId=$serverId' : 'port=$port';
      final res = await http
          .get(Uri.parse('$baseUrl/network/ipv6-diagnose?$query'), headers: defaultHeaders)
          .timeout(const Duration(seconds: 6));
      if (res.statusCode == 200) {
        return jsonDecode(res.body);
      }
    } catch (_) {}
    return {'ip': null, 'address': null, 'checks': []};
  }

  // P2P Host & Player
  static Future<Map<String, dynamic>> startP2pHost(String serverId, int port) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/network/p2p/host/start'),
        headers: defaultHeaders,
        body: jsonEncode({'serverId': serverId, 'port': port}),
      );
      if (res.statusCode == 200) return jsonDecode(res.body);
    } catch (_) {}
    return {'active': false, 'status': 'error', 'error': '请求失败'};
  }

  static Future<void> stopP2pHost(String serverId) async {
    try {
      await http.post(
        Uri.parse('$baseUrl/network/p2p/host/stop'),
        headers: defaultHeaders,
        body: jsonEncode({'serverId': serverId}),
      );
    } catch (_) {}
  }

  static Future<Map<String, dynamic>> getP2pHostStatus(String serverId) async {
    try {
      final res = await http
          .get(Uri.parse('$baseUrl/network/p2p/host/status?serverId=$serverId'), headers: defaultHeaders)
          .timeout(const Duration(seconds: 3));
      if (res.statusCode == 200) return jsonDecode(res.body);
    } catch (_) {}
    return {'active': false, 'status': 'idle'};
  }

  static Future<Map<String, dynamic>> joinP2pRoom(String roomCode, {int localPort = 25565}) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/network/p2p/player/join'),
        headers: defaultHeaders,
        body: jsonEncode({'roomCode': roomCode, 'localPort': localPort}),
      );
      if (res.statusCode == 200) return jsonDecode(res.body);
      final err = jsonDecode(res.body);
      return {'status': 'error', 'error': err['error'] ?? '加入失败'};
    } catch (_) {}
    return {'status': 'error', 'error': '无法连接本地服务'};
  }

  static Future<void> leaveP2pRoom() async {
    try {
      await http.post(Uri.parse('$baseUrl/network/p2p/player/leave'), headers: defaultHeaders);
    } catch (_) {}
  }

  static Future<Map<String, dynamic>> getP2pPlayerStatus() async {
    try {
      final res = await http
          .get(Uri.parse('$baseUrl/network/p2p/player/status'), headers: defaultHeaders)
          .timeout(const Duration(seconds: 3));
      if (res.statusCode == 200) return jsonDecode(res.body);
    } catch (_) {}
    return {'status': 'idle'};
  }

  static Future<bool> startServer(String id) async {
    try {
      final res = await http.post(Uri.parse('$baseUrl/servers/$id/start'), headers: defaultHeaders);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> stopServer(String id) async {
    try {
      final res = await http.post(Uri.parse('$baseUrl/servers/$id/stop'), headers: defaultHeaders);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> forceStopServer(String id) async {
    try {
      final res = await http.post(Uri.parse('$baseUrl/servers/$id/force-stop'), headers: defaultHeaders);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> restartServer(String id) async {
    try {
      final res = await http.post(Uri.parse('$baseUrl/servers/$id/restart'), headers: defaultHeaders);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> deleteServer(String id) async {
    try {
      final res = await http.delete(Uri.parse('$baseUrl/servers/$id'), headers: defaultHeaders);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> createServer({
    required String name,
    required String version,
    required String serverType,
    required int maxMemory,
    String? gamemode,
    bool? onlineMode,
  }) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/servers'),
        headers: defaultHeaders,
        body: jsonEncode({
          'name': name,
          'version': version,
          'serverType': serverType,
          'maxMemory': maxMemory,
          if (gamemode != null) 'gamemode': gamemode,
          if (onlineMode != null) 'onlineMode': onlineMode,
        }),
      );
      return res.statusCode == 200 || res.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> uploadCustomServer({
    required String filePath,
    required String name,
    required int maxMemory,
    String? gamemode,
    bool? onlineMode,
  }) async {
    try {
      final req = http.MultipartRequest('POST', Uri.parse('$baseUrl/servers/upload'));
      req.headers['x-fm-token'] = 'fm-local-token';
      req.fields['name'] = name;
      req.fields['maxMemory'] = maxMemory.toString();
      if (gamemode != null) req.fields['gamemode'] = gamemode;
      if (onlineMode != null) req.fields['onlineMode'] = onlineMode.toString();
      req.files.add(await http.MultipartFile.fromPath('serverJar', filePath));
      final streamed = await req.send();
      return streamed.statusCode == 200 || streamed.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  static Map<String, dynamic>? _cachedSysInfo;
  static Future<Map<String, dynamic>> getSystemInfo() async {
    if (_cachedSysInfo != null) return _cachedSysInfo!;
    try {
      final res = await http
          .get(Uri.parse('$baseUrl/servers/system-info'), headers: defaultHeaders)
          .timeout(const Duration(seconds: 3));
      if (res.statusCode == 200) {
        _cachedSysInfo = jsonDecode(res.body);
        return _cachedSysInfo!;
      }
    } catch (_) {}
    return {'totalMemoryMB': 16384, 'maxAllocatableMB': 12288};
  }

  static Future<Map<String, String>> getServerProperties(String id) async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/servers/$id/properties'), headers: defaultHeaders);
      if (res.statusCode == 200) {
        final Map data = jsonDecode(res.body);
        return data.map((k, v) => MapEntry(k.toString(), v?.toString() ?? ''));
      }
    } catch (_) {}
    return {};
  }

  static Future<bool> updateServerProperties(String id, Map<String, String> props) async {
    try {
      final res = await http.put(
        Uri.parse('$baseUrl/servers/$id/properties'),
        headers: defaultHeaders,
        body: jsonEncode(props),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // Versions & Modpacks
  static Future<List<String>> getVersions(String type) async {
    try {
      final res = await http
          .get(Uri.parse('$baseUrl/versions?type=$type'), headers: defaultHeaders)
          .timeout(const Duration(seconds: 6));
      if (res.statusCode == 200) {
        final List data = jsonDecode(res.body);
        final list = data.map((e) => e['version']?.toString() ?? '').where((s) => s.isNotEmpty).toList();
        if (list.isNotEmpty) return list;
      }
    } catch (_) {}
    return ['1.21.4', '1.21.1', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2'];
  }

  static Future<List<Map<String, dynamic>>> searchModpacks({String query = ''}) async {
    try {
      final q = Uri.encodeQueryComponent(query);
      final res = await http
          .get(Uri.parse('$baseUrl/versions/modpacks?q=$q&limit=20'), headers: defaultHeaders)
          .timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) {
        final List data = jsonDecode(res.body);
        return data.cast<Map<String, dynamic>>();
      }
    } catch (_) {}
    return [];
  }

  static Future<List<Map<String, dynamic>>> getModpackVersions(String projectId) async {
    try {
      final res = await http
          .get(Uri.parse('$baseUrl/versions/modpacks/$projectId/versions'), headers: defaultHeaders)
          .timeout(const Duration(seconds: 6));
      if (res.statusCode == 200) {
        final List data = jsonDecode(res.body);
        return data.cast<Map<String, dynamic>>();
      }
    } catch (_) {}
    return [];
  }

  static Future<bool> deployModpack({
    required String projectId,
    String? versionId,
    required String name,
    String? gameVersion,
    required int maxMemory,
    String? gamemode,
    bool? onlineMode,
  }) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/servers/modpack'),
        headers: defaultHeaders,
        body: jsonEncode({
          'projectId': projectId,
          'versionId': versionId,
          'name': name,
          'gameVersion': gameVersion,
          'maxMemory': maxMemory,
          if (gamemode != null) 'gamemode': gamemode,
          if (onlineMode != null) 'onlineMode': onlineMode,
        }),
      );
      return res.statusCode == 200 || res.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  // Stats
  static Future<Map<String, dynamic>?> getStats(String id) async {
    try {
      final res = await http
          .get(Uri.parse('$baseUrl/servers/$id/stats'), headers: defaultHeaders)
          .timeout(const Duration(seconds: 3));
      if (res.statusCode == 200) return jsonDecode(res.body);
    } catch (_) {}
    return null;
  }

  // Players
  static Future<List<dynamic>> getPlayers(String id) async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/servers/$id/players'), headers: defaultHeaders);
      if (res.statusCode == 200) return jsonDecode(res.body);
    } catch (_) {}
    return [];
  }

  static Future<bool> kickPlayer(String id, String player, [String? reason]) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/servers/$id/players/kick'),
        headers: defaultHeaders,
        body: jsonEncode({'player': player, 'reason': reason}),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> banPlayer(String id, String player, [String? reason]) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/servers/$id/players/ban'),
        headers: defaultHeaders,
        body: jsonEncode({'player': player, 'reason': reason}),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> opPlayer(String id, String player) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/servers/$id/players/op'),
        headers: defaultHeaders,
        body: jsonEncode({'player': player}),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // Mods
  static Future<List<dynamic>> getMods(String id) async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/servers/$id/mods'), headers: defaultHeaders);
      if (res.statusCode == 200) return jsonDecode(res.body);
    } catch (_) {}
    return [];
  }

  static Future<bool> uploadMod(String id, String filePath) async {
    try {
      final req = http.MultipartRequest('POST', Uri.parse('$baseUrl/servers/$id/mods'));
      req.headers['x-fm-token'] = 'fm-local-token';
      req.files.add(await http.MultipartFile.fromPath('file', filePath));
      final streamed = await req.send();
      return streamed.statusCode == 200 || streamed.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> toggleMod(String id, String mid, bool enabled) async {
    try {
      final res = await http.patch(
        Uri.parse('$baseUrl/servers/$id/mods/$mid'),
        headers: defaultHeaders,
        body: jsonEncode({'enabled': enabled}),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> deleteMod(String id, String mid) async {
    try {
      final res = await http.delete(Uri.parse('$baseUrl/servers/$id/mods/$mid'), headers: defaultHeaders);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // Backups
  static Future<List<dynamic>> getBackups(String id) async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/servers/$id/backups'), headers: defaultHeaders);
      if (res.statusCode == 200) return jsonDecode(res.body);
    } catch (_) {}
    return [];
  }

  static Future<bool> createBackup(String id, String type) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/servers/$id/backups'),
        headers: defaultHeaders,
        body: jsonEncode({'type': type}),
      );
      return res.statusCode == 200 || res.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> restoreBackup(String id, String bid) async {
    try {
      final res = await http.post(Uri.parse('$baseUrl/servers/$id/backups/$bid/restore'), headers: defaultHeaders);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> deleteBackup(String id, String bid) async {
    try {
      final res = await http.delete(Uri.parse('$baseUrl/servers/$id/backups/$bid'), headers: defaultHeaders);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // Java
  static Future<List<dynamic>> getJavaRuntimes() async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/java/runtimes'), headers: defaultHeaders);
      if (res.statusCode == 200) return jsonDecode(res.body);
    } catch (_) {}
    return [];
  }

  static Future<bool> scanJava() async {
    try {
      final res = await http.post(Uri.parse('$baseUrl/java/scan'), headers: defaultHeaders);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> downloadJava(int version) async {
    try {
      final res = await http.post(Uri.parse('$baseUrl/java/download/$version'), headers: defaultHeaders);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<Map<String, dynamic>> getJavaDownloadProgress(int version) async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/java/download-progress?version=$version'), headers: defaultHeaders);
      if (res.statusCode == 200) return jsonDecode(res.body);
    } catch (_) {}
    return {'status': 'idle', 'percent': 0};
  }
}
