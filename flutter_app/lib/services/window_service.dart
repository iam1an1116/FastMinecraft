import 'dart:io';
import 'package:flutter/services.dart';

class WindowService {
  static const _channel = MethodChannel('com.fastminecraft/window');

  static String get monoFont => Platform.isMacOS ? 'Menlo' : 'Consolas';

  static String fileName(String path) => path.split(RegExp(r'[/\\]')).last;

  static Future<void> startDragging() async {
    try {
      await _channel.invokeMethod('startDragging');
    } catch (_) {}
  }

  static Future<void> zoomWindow() async {
    try {
      await _channel.invokeMethod('zoomWindow');
    } catch (_) {}
  }

  static Future<void> minimizeWindow() async {
    try {
      await _channel.invokeMethod('minimizeWindow');
    } catch (_) {}
  }

  static Future<void> closeWindow() async {
    try {
      await _channel.invokeMethod('closeWindow');
    } catch (_) {}
  }

  static Future<String?> pickFile({List<String> extensions = const []}) async {
    try {
      String method = 'pickFile';
      if (extensions.contains('jar') && extensions.contains('zip')) {
        method = 'pickJarZip';
      } else if (extensions.contains('jar')) {
        method = 'pickJar';
      }
      final path = await _channel.invokeMethod<String>(method);
      return path;
    } catch (_) {
      return null;
    }
  }
}
