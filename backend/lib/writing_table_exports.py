"""Small exporters for the table/image layouts that the editor can preserve."""
from html import escape
from lib.writing_tables import table_grid


def image_display_width(attrs, natural, available):
    mode = attrs.get("displayMode")
    if mode == "fit":
        return available
    if mode == "custom":
        return min(attrs.get("displayWidth") or 560, available)
    if mode == "original":
        return min(natural, available)
    if mode == "auto":
        return min(natural, 560, available)
    return min(natural, available)


def table_html(node):
    def render(item):
        kind = item["type"]
        attrs = item.get("attrs", {})
        if kind == "text":
            text = escape(item.get("text", ""))
            for mark in item.get("marks", []):
                tag = {"bold": "strong", "italic": "em", "underline": "u", "strike": "s"}.get(mark["type"])
                if tag:
                    text = f"<{tag}>{text}</{tag}>"
                elif mark["type"] == "link":
                    text = f'<a href="{escape(mark["attrs"]["href"], quote=True)}">{text}</a>'
            return text
        if kind == "hardBreak":
            return "<br>"
        content = "".join(render(child) for child in item.get("content", []))
        if kind in {"tableCell", "tableHeader"}:
            tag = "th" if kind == "tableHeader" else "td"
            return f'<{tag} colspan="{attrs.get("colspan", 1)}" rowspan="{attrs.get("rowspan", 1)}">{content}</{tag}>'
        if kind == "image":
            return f'<figure><img src="{escape(attrs["src"],quote=True)}" alt="{escape(attrs.get("alt", ""),quote=True)}"><figcaption>{content}</figcaption></figure>'
        tag = {"table": "table", "tableRow": "tr", "paragraph": "p", "blockquote": "blockquote", "bulletList": "ul", "orderedList": "ol", "listItem": "li", "taskList": "ul", "taskItem": "li"}.get(kind)
        if kind == "heading":
            tag = f'h{attrs.get("level", 1)}'
        if kind == "horizontalRule":
            return "<hr>"
        if kind == "taskItem":
            content = ("[x] " if attrs.get("checked") else "[ ] ") + content
        return f"<{tag}>{content}</{tag}>" if tag else content
    return render(node)


def docx_table(node, container, block, Inches, OxmlElement, qn):
    rows, columns, placements, widths = table_grid(node)
    table = container.add_table(rows=rows, cols=columns)
    table.style = "Table Grid"
    table.autofit = False
    total = sum(widths)
    section = container.sections[0]
    available_inches = (section.page_width - section.left_margin - section.right_margin) / 914400
    for column, width in zip(table.columns, widths):
        column.width = Inches(available_inches * width / total)
    for cell, r, c in placements:
        attrs = cell.get("attrs", {})
        target = table.cell(r, c)
        if attrs.get("colspan", 1) > 1 or attrs.get("rowspan", 1) > 1:
            target = target.merge(table.cell(r + attrs.get("rowspan", 1) - 1, c + attrs.get("colspan", 1) - 1))
        target.width = Inches(available_inches * sum(widths[c:c + attrs.get("colspan", 1)]) / total)
        for child in cell.get("content", []):
            if attrs.get("align") and child["type"] in {"paragraph", "heading"} and not child.get("attrs", {}).get("textAlign"):
                child = {**child, "attrs": {**child.get("attrs", {}), "textAlign": attrs["align"]}}
            block(child, container=target)
        if len(target.paragraphs) > 1 and not target.paragraphs[0].text:
            first = target.paragraphs[0]._p
            first.getparent().remove(first)
        if cell["type"] == "tableHeader":
            for paragraph in target.paragraphs:
                for run in paragraph.runs:
                    run.bold = True
    if all(cell["type"] == "tableHeader" for cell in node["content"][0]["content"]):
        table.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
    return table


def pdf_table(node, block, available):
    from reportlab.platypus import LongTable
    from reportlab.lib import colors
    rows, columns, placements, widths = table_grid(node)
    total = sum(widths)
    widths = [available * width / total for width in widths]
    data = [["" for _ in range(columns)] for _ in range(rows)]
    commands = [("GRID", (0, 0), (-1, -1), .5, colors.HexColor("#d3dce8")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]
    for cell, r, c in placements:
        attrs = cell.get("attrs", {})
        cs, rs = attrs.get("colspan", 1), attrs.get("rowspan", 1)
        flowables = []
        for child in cell.get("content", []):
            if attrs.get("align") and child["type"] in {"paragraph", "heading"} and not child.get("attrs", {}).get("textAlign"):
                child = {**child, "attrs": {**child.get("attrs", {}), "textAlign": attrs["align"]}}
            block(child, target=flowables, available=max(6, sum(widths[c:c + cs]) - 12))
        data[r][c] = flowables
        if cs > 1 or rs > 1:
            commands.append(("SPAN", (c, r), (c + cs - 1, r + rs - 1)))
        if cell["type"] == "tableHeader":
            commands.append(("BACKGROUND", (c, r), (c + cs - 1, r + rs - 1), colors.HexColor("#f0f4fa")))
    header = all(cell["type"] == "tableHeader" for cell in node["content"][0]["content"])
    return LongTable(data, colWidths=widths, style=commands, repeatRows=1 if header else 0, splitByRow=1, splitInRow=1, hAlign="LEFT")


def table_markdown(node, render):
    rows, columns, placements, _ = table_grid(node)
    simple = all(cell.get("attrs", {}).get("colspan", 1) == 1 and cell.get("attrs", {}).get("rowspan", 1) == 1
                 and len(cell.get("content", [])) == 1 and cell["content"][0]["type"] == "paragraph"
                 for cell, _, _ in placements)
    if not simple:
        return table_html(node) + "\n"
    values = [["" for _ in range(columns)] for _ in range(rows)]
    for cell, r, c in placements:
        values[r][c] = render(cell["content"][0]).strip().replace("|", "\\|").replace("\n", "<br>")
    header = all(cell["type"] == "tableHeader" for cell in node["content"][0]["content"])
    first = values.pop(0) if header else ["" for _ in range(columns)]
    lines = ["| " + " | ".join(first) + " |", "| " + " | ".join("---" for _ in range(columns)) + " |"]
    lines.extend("| " + " | ".join(row) + " |" for row in values)
    return "\n".join(lines) + "\n"
