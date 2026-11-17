import 'package:flutter/material.dart';

class SlidingPillItem {
  final Widget child;
  const SlidingPillItem({required this.child});
}

class SlidingPillBar extends StatefulWidget {
  final List<SlidingPillItem> items;
  final int selectedIndex;
  final ValueChanged<int> onChanged;
  final EdgeInsetsGeometry itemPadding;
  final double borderRadius;
  final double spacing;

  const SlidingPillBar({
    super.key,
    required this.items,
    required this.selectedIndex,
    required this.onChanged,
    this.itemPadding = const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
    this.borderRadius = 18,
    this.spacing = 4,
  });

  @override
  State<SlidingPillBar> createState() => _SlidingPillBarState();
}

class _SlidingPillBarState extends State<SlidingPillBar> {
  final GlobalKey _stackKey = GlobalKey();
  late List<GlobalKey> _itemKeys;
  double _pillLeft = 0;
  double _pillWidth = 0;
  double _pillHeight = 0;
  bool _hasMeasured = false;
  int? _hoveredIndex;

  @override
  void initState() {
    super.initState();
    _initKeys();
    WidgetsBinding.instance.addPostFrameCallback((_) => _measure());
  }

  void _initKeys() {
    _itemKeys = List.generate(widget.items.length, (_) => GlobalKey());
  }

  @override
  void didUpdateWidget(covariant SlidingPillBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.items.length != widget.items.length) {
      _initKeys();
      _hasMeasured = false;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _measure());
  }

  void _measure() {
    if (!mounted) return;
    if (widget.selectedIndex < 0 || widget.selectedIndex >= _itemKeys.length) return;
    final stackBox = _stackKey.currentContext?.findRenderObject() as RenderBox?;
    final itemBox = _itemKeys[widget.selectedIndex].currentContext?.findRenderObject() as RenderBox?;
    if (stackBox == null || itemBox == null || !stackBox.hasSize || !itemBox.hasSize) return;

    final offset = itemBox.localToGlobal(Offset.zero, ancestor: stackBox);
    if (!_hasMeasured ||
        (_pillLeft - offset.dx).abs() > 0.2 ||
        (_pillWidth - itemBox.size.width).abs() > 0.2 ||
        (_pillHeight - itemBox.size.height).abs() > 0.2) {
      setState(() {
        _pillLeft = offset.dx;
        _pillWidth = itemBox.size.width;
        _pillHeight = itemBox.size.height;
        _hasMeasured = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      key: _stackKey,
      clipBehavior: Clip.none,
      children: [
        if (_hasMeasured)
          AnimatedPositioned(
            duration: const Duration(milliseconds: 135),
            curve: Curves.easeOutQuart,
            left: _pillLeft,
            top: 0,
            width: _pillWidth,
            height: _pillHeight,
            child: Container(
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.72),
                borderRadius: BorderRadius.circular(widget.borderRadius),
                border: Border.all(color: Colors.black.withOpacity(0.04), width: 0.5),
              ),
            ),
          ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(widget.items.length, (i) {
            final isHovered = _hoveredIndex == i && widget.selectedIndex != i;
            return Padding(
              padding: EdgeInsets.only(right: i == widget.items.length - 1 ? 0 : widget.spacing),
              child: MouseRegion(
                cursor: SystemMouseCursors.click,
                onEnter: (_) => setState(() => _hoveredIndex = i),
                onExit: (_) => setState(() => _hoveredIndex = null),
                child: GestureDetector(
                  key: _itemKeys[i],
                  behavior: HitTestBehavior.opaque,
                  onTap: () => widget.onChanged(i),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 90),
                    curve: Curves.easeOutCubic,
                    padding: widget.itemPadding,
                    decoration: BoxDecoration(
                      color: isHovered ? Colors.white.withOpacity(0.42) : Colors.transparent,
                      borderRadius: BorderRadius.circular(widget.borderRadius),
                    ),
                    child: widget.items[i].child,
                  ),
                ),
              ),
            );
          }),
        ),
      ],
    );
  }
}
