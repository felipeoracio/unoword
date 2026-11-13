"""Bounded formatting vocabulary shared by document validation and exporters."""
import re

FONTS = {"serif", "sans", "mono"}
SIZES = {12, 14, 16, 17, 18, 20, 22, 24, 28, 32, 36, 48, 64}
LEADING = {1.2, 1.4, 1.5, 1.6, 1.7, 1.75, 2}
SPACING = {0, 0.5, 0.9, 1, 1.5, 2}
DEFAULTS = {"fontFamily": "serif", "fontSize": 18, "lineHeight": 1.7, "paragraphSpacing": 0.9}


def member(value, allowed):
    return not isinstance(value, bool) and isinstance(value, (int, float, str)) and value in allowed


def color(value):
    return value.lower() if isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value) else None


def text_style(attrs):
    if not isinstance(attrs, dict):
        return {}
    out = {}
    if member(attrs.get("fontFamily"), FONTS):
        out["fontFamily"] = attrs["fontFamily"]
    if member(attrs.get("fontSize"), SIZES):
        out["fontSize"] = attrs["fontSize"]
    if color(attrs.get("color")):
        out["color"] = color(attrs["color"])
    return out


def typography(attrs):
    if not isinstance(attrs, dict):
        return dict(DEFAULTS)
    return {key: attrs[key] if member(attrs.get(key), allowed) else DEFAULTS[key]
            for key, allowed in [("fontFamily", FONTS), ("fontSize", SIZES),
                                 ("lineHeight", LEADING), ("paragraphSpacing", SPACING)]}


def paragraph_style(attrs):
    out = {}
    for key, allowed in [("lineHeight", LEADING), ("paragraphSpacing", SPACING),
                         ("styleVariant", {"title", "subtitle"})]:
        if member(attrs.get(key), allowed):
            out[key] = attrs[key]
    indent = attrs.get("indent")
    if isinstance(indent, int) and not isinstance(indent, bool) and 0 <= indent <= 6:
        out["indent"] = indent
    return out
