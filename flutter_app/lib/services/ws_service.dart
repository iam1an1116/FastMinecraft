import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';

class WsService {
  WebSocketChannel? _channel;
  final _logController = StreamController<String>.broadcast();
  final _statusController = StreamController<String>.broadcast();
  final _statsController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<String> get logStream => _logController.stream;
  Stream<String> get statusStream => _statusController.stream;
  Stream<Map<String, dynamic>> get statsStream => _statsController.stream;

  String? _currentServerId;

  void connect(String serverId) {
    if (_currentServerId == serverId && _channel != null) return;
    disconnect();
    _currentServerId = serverId;

    try {
      final uri = Uri.parse('ws://127.0.0.1:3001/ws');
      _channel = WebSocketChannel.connect(uri);

      _channel?.sink.add(jsonEncode({
        'type': 'subscribe',
        'serverId': serverId,
      }));

      _channel?.stream.listen(
        (message) {
          try {
            final msg = jsonDecode(message.toString());
            if (msg is! Map<String, dynamic>) return;
            if (msg['serverId'] != _currentServerId) return;

            final event = msg['event']?.toString();
            final payload = msg['data'];

            if (event == 'log' && payload is Map) {
              final line = payload['line']?.toString() ?? '';
              if (line.isNotEmpty) _logController.add(line);
            } else if (event == 'status' && payload is Map) {
              final status = payload['status']?.toString();
              if (status != null) _statusController.add(status);
            } else if (event == 'stats' && payload is Map<String, dynamic>) {
              _statsController.add(payload);
            }
          } catch (_) {}
        },
        onError: (_) {},
      );
    } catch (_) {}
  }

  void sendCommand(String command) {
    if (_currentServerId == null || _channel == null) return;
    _channel?.sink.add(jsonEncode({
      'type': 'command',
      'serverId': _currentServerId,
      'command': command,
    }));
  }

  void disconnect() {
    if (_currentServerId != null && _channel != null) {
      try {
        _channel?.sink.add(jsonEncode({
          'type': 'unsubscribe',
          'serverId': _currentServerId,
        }));
      } catch (_) {}
    }
    _channel?.sink.close();
    _channel = null;
    _currentServerId = null;
  }

  void dispose() {
    disconnect();
    _logController.close();
    _statusController.close();
    _statsController.close();
  }
}
