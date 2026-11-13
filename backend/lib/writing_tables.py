"""Bounded rectangular table validation; used by storage and portable exporters."""
from fastapi import HTTPException


def cell_attributes(attrs):
    out = {}
    for name, maximum in [("colspan", 20), ("rowspan", 100)]:
        value = attrs.get(name, 1)
        if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= maximum:
            raise HTTPException(422, "invalid_document_table")
        out[name] = value
    widths = attrs.get("colwidth")
    if widths is not None:
        if (not isinstance(widths, list) or len(widths) != out["colspan"]
                or any(not isinstance(w, int) or isinstance(w, bool) or not (w == 0 or 80 <= w <= 1600) for w in widths)):
            raise HTTPException(422, "invalid_document_table")
        out["colwidth"] = widths
    if isinstance(attrs.get("align"), str) and attrs["align"] in {"left", "center", "right", "justify"}:
        out["align"] = attrs["align"]
    return out


def table_grid(node):
    rows = node.get("content", [])
    if not 1 <= len(rows) <= 100:
        raise HTTPException(422, "invalid_document_table")
    occupied, placements, widths = set(), [], {}
    columns = 0
    for r, row in enumerate(rows):
        c = 0
        for cell in row.get("content", []):
            while (r, c) in occupied:
                c += 1
            attrs = cell_attributes(cell.get("attrs", {}))
            cs, rs = attrs["colspan"], attrs["rowspan"]
            if c + cs > 20 or r + rs > len(rows):
                raise HTTPException(422, "invalid_document_table")
            for y in range(r, r + rs):
                for x in range(c, c + cs):
                    if (y, x) in occupied:
                        raise HTTPException(422, "invalid_document_table")
                    occupied.add((y, x))
            for i, width in enumerate(attrs.get("colwidth") or []):
                if width and c + i not in widths:
                    widths[c + i] = width
            placements.append((cell, r, c))
            c += cs
            columns = max(columns, c)
    if not columns or any((r, c) not in occupied for r in range(len(rows)) for c in range(columns)):
        raise HTTPException(422, "invalid_document_table")
    return len(rows), columns, placements, [widths.get(c, 120) for c in range(columns)]
