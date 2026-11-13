"""Bounded Tiptap JSON validation and safe portable document representations."""

import json
import re
from html import escape
from io import BytesIO
from urllib.parse import urlsplit

from fastapi import HTTPException
from lib.writing_formatting import text_style, paragraph_style, typography, color
from lib.writing_tables import cell_attributes, table_grid
from lib.writing_image import image_attributes, png_image, import_image

EMPTY = {"type": "doc", "content": [{"type": "paragraph"}]}
NODES = {
    "doc",
    "paragraph",
    "heading",
    "text",
    "bulletList",
    "orderedList",
    "listItem",
    "taskList",
    "taskItem",
    "blockquote",
    "horizontalRule",
    "pageBreak",
    "hardBreak",
    "image",
    "table",
    "tableRow",
    "tableCell",
    "tableHeader",
}
MARKS = {"bold", "italic", "underline", "strike", "link", "sessionCredit", "textStyle", "highlight"}


def safe_link(value):
    try:
        url = urlsplit(str(value))
        return (
            str(value)
            if url.scheme in {"https", "http", "mailto"}
            and not re.search(r"[\x00-\x20]", str(value))
            else None
        )
    except ValueError:
        return None


def clean_document(value):
    count = 0

    def visit(node, depth=0, inside_table=False):
        nonlocal count
        count += 1
        if (
            depth > 30
            or count > 15000
            or not isinstance(node, dict)
            or node.get("type") not in NODES
        ):
            raise HTTPException(422, "unsupported_document_structure")
        kind = node["type"]
        if kind == "table" and inside_table:
            raise HTTPException(422, "invalid_document_table")
        out = {"type": kind}
        if kind == "image":
            out["attrs"] = image_attributes(node.get("attrs") or {})
            if "content" in node:
                if not isinstance(node["content"], list):
                    raise HTTPException(422, "invalid_document_structure")
                out["content"] = [visit(child, depth + 1, inside_table or kind == "table") for child in node["content"]]
                if any(child["type"] not in {"text", "hardBreak"} for child in out["content"]) or len(plain_text(out)) > 2000:
                    raise HTTPException(422, "invalid_document_image_caption")
            return out
        if kind == "text":
            out["text"] = str(node.get("text", ""))
            marks = []
            for mark in node.get("marks", [])[:10]:
                if not isinstance(mark, dict) or mark.get("type") not in MARKS:
                    continue
                if mark["type"] == "textStyle":
                    attrs = text_style(mark.get("attrs"))
                    if attrs:
                        marks.append({"type": "textStyle", "attrs": attrs})
                elif mark["type"] == "highlight":
                    attrs = mark.get("attrs")
                    shade = color(attrs.get("color")) if isinstance(attrs, dict) else None
                    if shade:
                        marks.append({"type": "highlight", "attrs": {"color": shade}})
                elif mark["type"] == "sessionCredit":
                    attrs = mark.get("attrs")
                    if not isinstance(attrs, dict):
                        continue
                    session = attrs.get("session")
                    if (isinstance(session, str)
                            and re.fullmatch(r"[a-zA-Z0-9-]{1,64}", session)
                            and isinstance(attrs.get("kind"), str)
                            and attrs["kind"] in {"typed", "pasted"}):
                        marks.append({"type": "sessionCredit", "attrs": {
                            "session": session, "kind": attrs["kind"],
                        }})
                elif mark["type"] == "link":
                    href = safe_link(mark.get("attrs", {}).get("href", ""))
                    if href:
                        marks.append(
                            {
                                "type": "link",
                                "attrs": {
                                    "href": href,
                                    "target": "_blank",
                                    "rel": "noopener noreferrer",
                                },
                            }
                        )
                else:
                    marks.append({"type": mark["type"]})
            if marks:
                out["marks"] = marks
        else:
            attrs = node.get("attrs") or {}
            allowed = {}
            if kind == "doc" and "subtitle" in attrs:
                subtitle = attrs["subtitle"]
                if subtitle is not None and (not isinstance(subtitle, str) or len(subtitle) > 500 or "\x00" in subtitle):
                    raise HTTPException(422, "invalid_document_subtitle")
                allowed["subtitle"] = subtitle
            if kind == "doc" and attrs.get("printLayout") is not None:
                layout = attrs["printLayout"]
                if (not isinstance(layout, dict) or layout.get("size") not in {"letter", "a4"}
                        or layout.get("margin") not in {"normal", "narrow", "wide"}):
                    raise HTTPException(422, "invalid_document_print_layout")
                allowed["printLayout"] = {"size": layout["size"], "margin": layout["margin"]}
            if kind == "doc" and attrs.get("typography") is not None:
                if not isinstance(attrs["typography"], dict):
                    raise HTTPException(422, "invalid_document_typography")
                allowed["typography"] = typography(attrs["typography"])
            if kind in {"paragraph", "heading"}:
                allowed.update(paragraph_style(attrs))
            if kind in {"tableCell", "tableHeader"}:
                allowed.update(cell_attributes(attrs))
            if kind == "taskItem":
                allowed["checked"] = attrs.get("checked") is True
            if kind == "heading":
                allowed["level"] = max(1, min(3, int(attrs.get("level", 1))))
            if kind in {"heading", "paragraph"} and attrs.get("textAlign") in {
                "left",
                "center",
                "right",
                "justify",
            }:
                allowed["textAlign"] = attrs["textAlign"]
            if kind == "orderedList":
                allowed["start"] = max(1, min(10000, int(attrs.get("start", 1))))
            if allowed:
                out["attrs"] = allowed
            if "content" in node:
                if not isinstance(node["content"], list):
                    raise HTTPException(422, "invalid_document")
                out["content"] = [visit(child, depth + 1, inside_table or kind == "table") for child in node["content"]]
                blocks = {
                    "paragraph",
                    "heading",
                    "bulletList",
                    "orderedList",
                    "taskList",
                    "blockquote",
                    "horizontalRule",
                    "image",
                    "table",
                }
                allowed_children = {
                    "doc": blocks | {"pageBreak"},
                    "blockquote": blocks,
                    "listItem": blocks,
                    "paragraph": {"text", "hardBreak"},
                    "heading": {"text", "hardBreak"},
                    "bulletList": {"listItem"},
                    "orderedList": {"listItem"},
                    "taskList": {"taskItem"},
                    "taskItem": blocks,
                    "table": {"tableRow"},
                    "tableRow": {"tableCell", "tableHeader"},
                    "tableCell": blocks - {"table"},
                    "tableHeader": blocks - {"table"},
                }
                if any(
                    child["type"] not in allowed_children.get(kind, set())
                    for child in out["content"]
                ):
                    raise HTTPException(422, "invalid_document_structure")
        if kind in {"table", "tableRow", "tableCell", "tableHeader"} and "content" not in out:
            raise HTTPException(422, "invalid_document_table")
        if kind in {"tableCell", "tableHeader"} and not out.get("content"):
            raise HTTPException(422, "invalid_document_table")
        if kind == "table":
            table_grid(out)
        return out

    try:
        if not isinstance(value, dict) or value.get("type") != "doc":
            raise HTTPException(422, "invalid_document")
        if len(json.dumps(value).encode()) > 1048576:
            raise HTTPException(413, "document_too_large")
        cleaned = visit(value)
        if len(plain_text(cleaned)) > 200000:
            raise HTTPException(413, "document_too_large")
        return cleaned
    except (TypeError, ValueError, AttributeError, RecursionError) as error:
        raise HTTPException(422, "invalid_document") from error


def plain_text(node):
    if node.get("type") == "text":
        return node.get("text", "")
    if node.get("type") == "hardBreak":
        return "\n"
    if node.get("type") == "tableRow":
        return "\t".join(plain_text(child) for child in node.get("content", []))
    sep = (
        "\n"
        if node.get("type")
        in {"doc", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "blockquote", "table", "tableCell", "tableHeader"}
        else ""
    )
    return sep.join(plain_text(child) for child in node.get("content", []))


def document_subtitle(content):
    return content.get("attrs", {}).get("subtitle") or ""


def export_text(content):
    subtitle = document_subtitle(content)
    body = plain_text(content)
    return subtitle + "\n\n" + body if subtitle else body


def markdown(node, depth=0):
    kind = node["type"]
    if kind == "doc":
        from lib.writing_portable_markdown import portable_markdown
        return portable_markdown(node, markdown)
    if kind == "text":
        text = re.sub(r"([\\`*_\[\]<>])", r"\\\1", node.get("text", ""))
        for mark in node.get("marks", []):
            name = mark["type"]
            if name == "link":
                text = f'[{text}]({mark["attrs"]["href"].replace(")","%29")})'
            elif name in {"bold", "italic", "strike"}:
                wrapper = {"bold": "**", "italic": "*", "strike": "~~"}[name]
                text = wrapper + text + wrapper
        return text
    if kind == "table":
        from lib.writing_table_exports import table_markdown
        return table_markdown(node, markdown)
    if kind == "image":
        alt = re.sub(r"([\\`*_\[\]<>])", r"\\\1", node["attrs"].get("alt", ""))
        caption = "".join(markdown(child) for child in node.get("content", []))
        return f'![{alt}]({node["attrs"]["src"]})' + ("\n\n" + caption if caption else "")
    if kind == "hardBreak":
        return "  \n"
    if kind == "pageBreak":
        return '\n<div data-page-break="true"></div>\n'
    if kind == "horizontalRule":
        return "\n---\n"
    children = node.get("content", [])
    if kind in {"bulletList", "orderedList", "taskList"}:
        start = node.get("attrs", {}).get("start", 1)
        return (
            "\n".join(
                ("  " * depth)
                + (f"{start+i}. " if kind == "orderedList" else ("- [x] " if child.get("attrs", {}).get("checked") else "- [ ] ") if kind == "taskList" else "- ")
                + markdown(child, depth + 1).strip()
                for i, child in enumerate(children)
            )
            + "\n"
        )
    text = ("\n\n" if kind in {"doc", "listItem", "taskItem", "blockquote"} else "").join(
        markdown(child, depth) for child in children
    )
    if kind == "doc" and document_subtitle(node):
        return markdown({"type": "text", "text": document_subtitle(node)}) + "\n\n" + text
    if kind == "heading":
        return "#" * node.get("attrs", {}).get("level", 1) + " " + text
    if kind == "blockquote":
        return "\n".join("> " + line for line in text.splitlines())
    return text


def to_docx(content, title):
    from docx import Document
    from docx.shared import Inches, Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.opc.constants import RELATIONSHIP_TYPE

    document = Document()
    layout = content.get("attrs", {}).get("printLayout") or {"size": "letter", "margin": "normal"}
    if layout:
        section = document.sections[0]
        section.page_width = Inches(8.27 if layout["size"] == "a4" else 8.5)
        section.page_height = Inches(11.69 if layout["size"] == "a4" else 11)
        margin = Inches({"normal": 1, "narrow": .5, "wide": 1.25}[layout["margin"]])
        section.top_margin = section.bottom_margin = section.left_margin = section.right_margin = margin
    available_pixels = (document.sections[0].page_width - document.sections[0].left_margin - document.sections[0].right_margin) / 914400 * 96
    defaults = typography(content.get("attrs", {}).get("typography"))
    font_names = {"serif": "Georgia", "sans": "Arial", "mono": "Courier New"}
    # Explicit and default editor typography share the same portable styles.
    normal = document.styles["Normal"]
    for style_name in ["Normal", "Title", "Subtitle", "Caption", "Heading 1", "Heading 2", "Heading 3"]:
        style = document.styles[style_name]
        style.font.name = font_names[defaults["fontFamily"]]
        if style.font.element.rPr is not None and style.font.element.rPr.rFonts is not None:
            for key in ["asciiTheme", "hAnsiTheme", "eastAsiaTheme", "csTheme"]:
                style.font.element.rPr.rFonts.attrib.pop(qn("w:"+key), None)
    for level, factor in [(1,1.667),(2,1.389),(3,1.167)]:
        document.styles[f"Heading {level}"].font.size = Pt(defaults["fontSize"] * .75 * factor)
    document.styles["Title"].font.size = Pt(defaults["fontSize"] * 1.5)
    document.styles["Subtitle"].font.size = Pt(defaults["fontSize"] * .9)
    document.styles["Caption"].font.size = Pt(defaults["fontSize"] * .75 * .85)
    normal.font.size = Pt(defaults["fontSize"] * .75)
    normal.paragraph_format.line_spacing = defaults["lineHeight"]
    normal.paragraph_format.space_after = Pt(defaults["paragraphSpacing"] * defaults["fontSize"] * .75)
    document.styles["Caption"].font.italic = False
    if document_subtitle(content):
        document.add_paragraph(document_subtitle(content), style="Subtitle")

    from docx.enum.style import WD_STYLE_TYPE
    for name, base in [("UnoWord Document Title", "Title"), ("UnoWord List Continuation", "Normal"), ("UnoWord Checklist", "Normal")]:
        if name not in document.styles:
            document.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH).base_style = document.styles[base]
    document.add_paragraph(title, style="UnoWord Document Title")

    def numbering(kind, start):
        root = document.part.numbering_part.element
        abstract_id = max([int(item.get(qn("w:abstractNumId"))) for item in root.findall(qn("w:abstractNum"))] + [-1]) + 1
        abstract = OxmlElement("w:abstractNum"); abstract.set(qn("w:abstractNumId"), str(abstract_id))
        for level in range(7):
            item = OxmlElement("w:lvl"); item.set(qn("w:ilvl"), str(level))
            for tag, value in [("start", str(start)), ("numFmt", "bullet" if kind == "bulletList" else "decimal"), ("lvlText", "•" if kind == "bulletList" else f"%{level+1}."), ("lvlJc", "left")]:
                element = OxmlElement("w:"+tag); element.set(qn("w:val"), value); item.append(element)
            props=OxmlElement("w:pPr"); indent=OxmlElement("w:ind"); indent.set(qn("w:left"),str(360*(level+1)));indent.set(qn("w:hanging"),"240");props.append(indent);item.append(props);abstract.append(item)
        root.append(abstract)
        return root.add_num(abstract_id).numId

    def block(node, list_style=None, task_marker=None, container=None, list_info=None, depth=0):
        container = document if container is None else container
        kind = node["type"]
        if kind in {"bulletList", "orderedList"}:
            info = (numbering(kind,node.get("attrs",{}).get("start",1)), min(depth,6))
            for child in node.get("content",[]): block(child,container=container,list_info=info,depth=depth)
            return
        if kind == "taskList":
            for child in node.get("content",[]): block(child,container=container,depth=depth)
            return
        if kind in {"listItem", "taskItem"}:
            for index, child in enumerate(node.get("content", [])):
                marker = ("[x] " if node.get("attrs", {}).get("checked") else "[ ] ") if kind == "taskItem" and index == 0 else None
                block(child, "UnoWord List Continuation" if index and child["type"]=="paragraph" else None, marker, container, list_info if index==0 else None, depth+1 if child["type"] in {"bulletList","orderedList","taskList"} else depth)
            return
        if kind in {"doc", "blockquote"}:
            for child in node.get("content", []): block(child,"Quote" if kind=="blockquote" else list_style,container=container,depth=depth)
            return
        if kind == "pageBreak":
            container.add_page_break()
            return
        if kind == "table":
            from lib.writing_table_exports import docx_table
            docx_table(node, container, block, Inches, OxmlElement, qn)
            return
        if kind == "image":
            from lib.writing_table_exports import image_display_width
            data, (width, height) = png_image(node["attrs"]["src"])
            cell_width = getattr(container, "width", None)
            available = min(available_pixels, cell_width.inches * 96) if cell_width else available_pixels
            target = image_display_width(node["attrs"], width, available)
            scale = min(target / width, (document.sections[0].page_height - document.sections[0].top_margin - document.sections[0].bottom_margin) / 914400 * 96 / height)
            paragraph = container.add_paragraph()
            paragraph.alignment = {"left": WD_ALIGN_PARAGRAPH.LEFT, "center": WD_ALIGN_PARAGRAPH.CENTER, "right": WD_ALIGN_PARAGRAPH.RIGHT}.get(node["attrs"].get("align"), WD_ALIGN_PARAGRAPH.LEFT)
            picture = paragraph.add_run().add_picture(BytesIO(data), width=Inches(width / 96 * scale))
            picture._inline.docPr.set("descr", node["attrs"].get("alt", ""))
            if node.get("content"):
                block({"type": "paragraph", "attrs": {"textAlign": node["attrs"].get("align", "center")}, "content": node["content"]}, container=container)
                container.paragraphs[-1].style = "Caption"
            return
        paragraph = container.add_paragraph(style=list_style)
        if list_info:
            props=paragraph._p.get_or_add_pPr();num=OxmlElement("w:numPr")
            for tag,value in [("ilvl",list_info[1]),("numId",list_info[0])]:
                element=OxmlElement("w:"+tag);element.set(qn("w:val"),str(value));num.append(element)
            props.append(num)
        if task_marker:
            paragraph.style = "UnoWord Checklist"
            paragraph.paragraph_format.left_indent = Inches(depth*.25)
            paragraph.add_run(task_marker)
        attrs = node.get("attrs", {})
        if attrs.get("styleVariant") in {"title", "subtitle"}:
            paragraph.style = attrs["styleVariant"].title()
        if attrs.get("lineHeight") is not None:
            paragraph.paragraph_format.line_spacing = attrs["lineHeight"]
        if attrs.get("paragraphSpacing") is not None:
            paragraph.paragraph_format.space_after = Pt(attrs["paragraphSpacing"] * defaults["fontSize"] * .75)
        if attrs.get("indent"):
            paragraph.paragraph_format.left_indent = Inches(attrs["indent"] * .25)
        if kind == "heading" and not attrs.get("styleVariant"):
            paragraph.style = f'Heading {node.get("attrs",{}).get("level",1)}'
        alignment = node.get("attrs", {}).get("textAlign")
        if alignment:
            paragraph.alignment = {
                "left": WD_ALIGN_PARAGRAPH.LEFT,
                "center": WD_ALIGN_PARAGRAPH.CENTER,
                "right": WD_ALIGN_PARAGRAPH.RIGHT,
                "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
            }[alignment]
        if kind == "horizontalRule":
            border=OxmlElement("w:pBdr");bottom=OxmlElement("w:bottom");bottom.set(qn("w:val"),"single");bottom.set(qn("w:sz"),"6");bottom.set(qn("w:color"),"B8C5D9");border.append(bottom);paragraph._p.get_or_add_pPr().append(border)
            return
        for child in node.get("content", []):
            run = paragraph.add_run(
                "\n" if child["type"] == "hardBreak" else plain_text(child)
            )
            marks = {mark["type"] for mark in child.get("marks", [])}
            run.bold = "bold" in marks
            run.italic = "italic" in marks
            run.underline = "underline" in marks
            run.font.strike = "strike" in marks
            for mark in child.get("marks", []):
                attrs = mark.get("attrs", {})
                if mark["type"] == "textStyle":
                    if attrs.get("fontFamily") in font_names:
                        run.font.name = font_names[attrs["fontFamily"]]
                    if attrs.get("fontSize"):
                        run.font.size = Pt(attrs["fontSize"] * .75)
                    if color(attrs.get("color")):
                        run.font.color.rgb = RGBColor.from_string(attrs["color"][1:])
                elif mark["type"] == "highlight" and color(attrs.get("color")):
                    shade = OxmlElement("w:shd")
                    shade.set(qn("w:fill"), attrs["color"][1:])
                    run._r.get_or_add_rPr().append(shade)
            link = next(
                (mark for mark in child.get("marks", []) if mark["type"] == "link"),
                None,
            )
            if link:
                relationship = paragraph.part.relate_to(
                    link["attrs"]["href"], RELATIONSHIP_TYPE.HYPERLINK, is_external=True
                )
                hyperlink = OxmlElement("w:hyperlink")
                hyperlink.set(qn("r:id"), relationship)
                paragraph._p.remove(run._r)
                hyperlink.append(run._r)
                paragraph._p.append(hyperlink)

    block(content)
    document.core_properties.title = title
    output = BytesIO()
    document.save(output)
    return output.getvalue()


def to_pdf(content, title):
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, PageBreak, Image as PDFImage
    from reportlab.lib.styles import getSampleStyleSheet

    from reportlab.lib.pagesizes import A4, letter
    layout = content.get("attrs", {}).get("printLayout") or {"size": "letter", "margin": "normal"}
    page_options = {}
    available_points = 420
    if layout:
        page_size = A4 if layout["size"] == "a4" else letter
        margin = {"normal": 72, "narrow": 36, "wide": 90}[layout["margin"]]
        page_options = {"pagesize": page_size, "leftMargin": margin, "rightMargin": margin, "topMargin": margin, "bottomMargin": margin}
        available_points = page_size[0] - 2 * margin - 12
    styles = getSampleStyleSheet()
    defaults = typography(content.get("attrs", {}).get("typography"))
    from lib.writing_pdf_fonts import pdf_fonts
    font_names = pdf_fonts()
    for style_name in styles.byName:
        styles[style_name].fontName = font_names[defaults["fontFamily"]]
    styles["Italic"].fontName = font_names[defaults["fontFamily"]]+"-Italic"
    styles["BodyText"].splitLongWords = 1
    story = [Paragraph(escape(title), styles["Title"]), Spacer(1,12)]
    if document_subtitle(content):
        story.extend([Paragraph(escape(document_subtitle(content)).replace("\n", "<br/>"), styles["Italic"]), Spacer(1, 12)])

    def inline(node):
        if node["type"] == "hardBreak":
            return "<br/>"
        text = escape(node.get("text", "")).replace("\n", "<br/>")
        for mark in node.get("marks", []):
            wrapper = {
                "bold": "b",
                "italic": "i",
                "underline": "u",
                "strike": "strike",
            }.get(mark["type"])
            if mark["type"] == "textStyle":
                attrs = mark.get("attrs", {})
                values = []
                if attrs.get("fontFamily") in font_names:
                    values.append(f'name="{font_names[attrs["fontFamily"]]}"')
                if attrs.get("fontSize"):
                    values.append(f'size="{attrs["fontSize"] * .75}"')
                if color(attrs.get("color")):
                    values.append(f'color="{attrs["color"]}"')
                text = '<font ' + ' '.join(values) + '>' + text + '</font>' if values else text
            elif mark["type"] == "highlight" and color(mark.get("attrs", {}).get("color")):
                text = f'<span backColor="{mark["attrs"]["color"]}">{text}</span>'
            elif wrapper:
                text = f"<{wrapper}>{text}</{wrapper}>"
            elif mark["type"] == "link":
                text = f'<link href="{escape(mark["attrs"]["href"],quote=True)}" color="blue">{text}</link>'
        return text

    def block(node, prefix=None, quoted=False, target=None, available=None, depth=0):
        available = available_points if available is None else available
        target = story if target is None else target
        kind = node["type"]
        if kind == "pageBreak":
            target.append(PageBreak())
            return
        if kind == "table":
            from lib.writing_table_exports import pdf_table
            target.extend([pdf_table(node, block, available), Spacer(1, 12)])
            return
        if kind == "image":
            from lib.writing_table_exports import image_display_width
            data, (width, height) = png_image(node["attrs"]["src"])
            target_width = image_display_width(node["attrs"], width, available / .75) * .75
            usable_height = page_options.get("pagesize", (595,842))[1] - page_options.get("topMargin",72) - page_options.get("bottomMargin",72) - 40
            scale = min(target_width / width, min(600,usable_height) / height)
            target.extend([PDFImage(BytesIO(data), width=width*scale, height=height*scale, hAlign=node["attrs"].get("align", "left").upper()), Spacer(1, 8)])
            if node.get("content"):
                block({"type": "paragraph", "attrs": {"textAlign": node["attrs"].get("align", "center")}, "content": node["content"]}, target=target, available=available)
            return
        if kind == "horizontalRule":
            target.extend([HRFlowable(width="100%", color="#b8c5d9"), Spacer(1, 12)])
            return
        if kind in {"doc", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "blockquote"}:
            for index, child in enumerate(node.get("content", [])):
                marker = (
                    f'{node.get("attrs",{}).get("start",1)+index}.'
                    if kind == "orderedList"
                    else "•" if kind == "bulletList" else ("[x]" if child.get("attrs", {}).get("checked") else "[ ]") if kind == "taskList" else prefix
                )
                block(child, marker, quoted or kind == "blockquote", target, available, depth + (1 if kind in {"bulletList", "orderedList", "taskList"} else 0))
            return
        style = (
            styles[f'Heading{node.get("attrs",{}).get("level",1)}']
            if kind == "heading"
            else styles["BodyText"]
        )
        # Escape all user text before ReportLab's small markup parser.
        style = style.clone(
            "writing",
            alignment={"left": 0, "center": 1, "right": 2, "justify": 4}.get(
                node.get("attrs", {}).get("textAlign"), 0
            ),
            leftIndent=(18 if quoted else 0) + (18 * max(1, depth) if prefix else 0),
        )
        attrs = node.get("attrs", {})
        style.fontName = font_names[defaults["fontFamily"]] + ("-Bold" if kind=="heading" else "")
        style.splitLongWords = 1
        if attrs.get("styleVariant"):
            style.fontName = font_names[defaults["fontFamily"]]
            if kind == "heading" or attrs.get("styleVariant") == "title":
                style.fontName = font_names[defaults["fontFamily"]]+"-Bold"
            elif attrs.get("styleVariant") == "subtitle":
                style.fontName = font_names[defaults["fontFamily"]]+"-Italic"
        style.fontSize = defaults["fontSize"] * .75 * ({1:1.667,2:1.389,3:1.167}.get(attrs.get("level",1),1.667) if kind == "heading" else 1)
        if attrs.get("styleVariant") == "title":
            style.fontSize = defaults["fontSize"] * 1.5
        elif attrs.get("styleVariant") == "subtitle":
            style.fontSize = defaults["fontSize"] * .9
        style.leading = style.fontSize * (attrs.get("lineHeight") or defaults["lineHeight"])
        style.spaceAfter = style.fontSize * attrs.get("paragraphSpacing", defaults["paragraphSpacing"])
        style.leftIndent += attrs.get("indent", 0) * 18
        text = "".join(inline(child) for child in node.get("content", []))
        target.extend(
            [
                Paragraph(text or " ", style, bulletText=prefix),
                Spacer(1, 0),
            ]
        )

    block(content)
    output = BytesIO()
    SimpleDocTemplate(output, title=title, author="UnoWord", **page_options).build(story)
    return output.getvalue()


def import_docx(data):
    from lib.writing_docx_import import import_docx_result
    return import_docx_result(data)["content"]
