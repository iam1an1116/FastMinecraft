import 'package:flutter/material.dart';

class RippleButton extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  final bool isSelected;
  final EdgeInsetsGeometry padding;
  final BorderRadius? borderRadius;
  final Color? activeColor;

  const RippleButton({
    super.key,
    required this.child,
    this.onTap,
    this.isSelected = false,
    this.padding = const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
    this.borderRadius,
    this.activeColor,
  });

  @override
  State<RippleButton> createState() => _RippleButtonState();
}

class _RippleButtonState extends State<RippleButton> {
  bool _isHovered = false;
  bool _isPressed = false;

  @override
  Widget build(BuildContext context) {
    final radius = widget.borderRadius ?? BorderRadius.circular(18);
    final activeBg = widget.activeColor ?? Colors.white.withOpacity(0.68);

    Color bgColor = Colors.transparent;
    if (widget.isSelected) {
      bgColor = activeBg;
    } else if (_isHovered) {
      bgColor = Colors.white.withOpacity(0.42);
    }

    return MouseRegion(
      cursor: widget.onTap != null ? SystemMouseCursors.click : SystemMouseCursors.basic,
      onEnter: (_) => setState(() => _isHovered = true),
      onExit: (_) => setState(() => _isHovered = false),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: widget.onTap != null ? (_) => setState(() => _isPressed = true) : null,
        onTapUp: widget.onTap != null ? (_) => setState(() => _isPressed = false) : null,
        onTapCancel: () => setState(() => _isPressed = false),
        onTap: widget.onTap,
        child: AnimatedScale(
          scale: _isPressed ? 0.975 : 1.0,
          duration: const Duration(milliseconds: 70),
          curve: Curves.easeOutCubic,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 95),
            curve: Curves.easeOutCubic,
            padding: widget.padding,
            decoration: BoxDecoration(
              color: bgColor,
              borderRadius: radius,
            ),
            child: widget.child,
          ),
        ),
      ),
    );
  }
}
