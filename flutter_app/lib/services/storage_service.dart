import 'dart:convert';
import 'dart:io';

class StorageService {
  static File _getFile() {
    final home = Platform.environment['HOME'] ??
        Platform.environment['USERPROFILE'] ??
        Platform.environment['APPDATA'] ??
        '.';
    final sep = Platform.pathSeparator;
    final dir = Directory('$home$sep.fastminecraft');
    if (!dir.existsSync()) {
      dir.createSync(recursive: true);
    }
    return File('${dir.path}${sep}app_state.json');
  }

  static String? getRole() {
    try {
      final file = _getFile();
      if (file.existsSync()) {
        final data = jsonDecode(file.readAsStringSync());
        return data['role']?.toString();
      }
    } catch (_) {}
    return null;
  }

  static void setRole(String role) {
    try {
      final file = _getFile();
      final Map<String, dynamic> data = file.existsSync()
          ? jsonDecode(file.readAsStringSync())
          : {};
      data['role'] = role;
      file.writeAsStringSync(jsonEncode(data));
    } catch (_) {}
  }
}
