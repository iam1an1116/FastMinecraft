class ServerInfo {
  final String id;
  final String name;
  final String version;
  final String serverType;
  final int port;
  final String status;
  final int maxMemory;

  ServerInfo({
    required this.id,
    required this.name,
    required this.version,
    required this.serverType,
    required this.port,
    required this.status,
    required this.maxMemory,
  });

  factory ServerInfo.fromJson(Map<String, dynamic> json) {
    return ServerInfo(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '未命名服务器',
      version: json['version']?.toString() ?? '1.21.4',
      serverType: json['server_type']?.toString() ?? 'paper',
      port: json['port'] is int ? json['port'] : int.tryParse(json['port']?.toString() ?? '25565') ?? 25565,
      status: json['status']?.toString() ?? 'stopped',
      maxMemory: json['max_memory'] is int ? json['max_memory'] : int.tryParse(json['max_memory']?.toString() ?? '4096') ?? 4096,
    );
  }

  bool get isRunning => status == 'running';
  bool get isStarting => status == 'starting';
  bool get isStopped => status == 'stopped';
}
