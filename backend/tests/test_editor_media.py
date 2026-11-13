from copy import deepcopy
from io import BytesIO
import base64
import pytest
from fastapi import HTTPException
from PIL import Image
from docx import Document
from pypdf import PdfReader
from lib.writing_document import clean_document, plain_text, markdown, to_docx, to_pdf


def picture(width=800, height=400):
    buffer = BytesIO()
    Image.new("RGB", (width, height), "#5da9f6").save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def paragraph(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def document():
    return {"type": "doc", "content": [
        {"type": "image", "attrs": {"src": picture(), "alt": "Landscape", "title": None, "width": 800, "height": 400,
            "displayMode": "custom", "displayWidth": 240, "align": "right", "captionVisible": True},
         "content": [{"type": "text", "text": "Figure 1 — A small beginning", "marks": [{"type": "sessionCredit", "attrs": {"session": "current", "kind": "typed"}}]}]},
        {"type": "table", "content": [
            {"type": "tableRow", "content": [
                {"type": "tableHeader", "attrs": {"colspan": 2, "rowspan": 1, "colwidth": [120, 180]}, "content": [paragraph("A shared heading")]}]},
            {"type": "tableRow", "content": [
                {"type": "tableCell", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": [120]}, "content": [paragraph("First idea")]},
                {"type": "tableCell", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": [180]}, "content": [paragraph("Second idea")]}]},
        ]},
    ]}


def test_media_roundtrip_keeps_source_dimensions_caption_marks_and_merges():
    source = document()
    assert clean_document(deepcopy(source)) == source
    text = plain_text(source)
    assert "Figure 1 — A small beginning" in text
    assert "First idea\tSecond idea" in text
    assert "800" not in text


def test_docx_preserves_image_size_caption_and_real_merged_table():
    doc = Document(BytesIO(to_docx(clean_document(document()), "Media sample")))
    assert abs(doc.inline_shapes[0].width.inches - 2.5) < .01
    assert any(p.text == "Figure 1 — A small beginning" for p in doc.paragraphs)
    assert len(doc.tables) == 1
    assert doc.tables[0].cell(0, 0)._tc is doc.tables[0].cell(0, 1)._tc
    assert doc.tables[0].cell(1, 0).text == "First idea"
    assert doc.tables[0].cell(1, 1).text == "Second idea"


def test_pdf_contains_caption_and_table_text():
    pdf = to_pdf(clean_document(document()), "Media sample")
    text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(pdf)).pages)
    for expected in ["Figure 1", "A shared heading", "First idea", "Second idea"]:
        assert expected in text


def test_markdown_retains_caption_and_safe_merged_table():
    result = markdown(clean_document(document()))
    assert "Figure 1" in result
    assert '<th colspan="2" rowspan="1" colwidth="120,180">' in result
    assert "First idea" in result and "Second idea" in result


@pytest.mark.parametrize("key,value", [("displayWidth", -1), ("displayWidth", 1601), ("displayWidth", True), ("align", "float"), ("displayMode", "url(x)"), ("captionVisible", "false")])
def test_unsafe_image_layout_is_rejected(key, value):
    source = document()
    source["content"][0]["attrs"][key] = value
    with pytest.raises(HTTPException) as error:
        clean_document(source)
    assert error.value.status_code == 422


@pytest.mark.parametrize("key,value", [("colspan", 21), ("rowspan", 101), ("colwidth", [9000]), ("colwidth", [80, 80]), ("colspan", True)])
def test_unsafe_cell_dimensions_are_rejected(key, value):
    source = document()
    source["content"][1]["content"][1]["content"][0]["attrs"][key] = value
    with pytest.raises(HTTPException):
        clean_document(source)


def test_ragged_overlapping_or_nested_tables_are_rejected():
    source = document()
    source["content"][1]["content"][1]["content"].pop()
    with pytest.raises(HTTPException):
        clean_document(source)
    source = document()
    source["content"][1]["content"][0]["content"][0]["attrs"]["rowspan"] = 2
    with pytest.raises(HTTPException):
        clean_document(source)
    source = document()
    source["content"][1]["content"][1]["content"][0]["content"] = [{"type": "blockquote", "content": [deepcopy(source["content"][1])]}]
    with pytest.raises(HTTPException):
        clean_document(source)


def test_caption_is_inline_and_bounded():
    source = document()
    source["content"][0]["content"] = [paragraph("Nested blocks are not captions")]
    with pytest.raises(HTTPException):
        clean_document(source)
    source["content"][0]["content"] = [{"type": "text", "text": "x" * 2001}]
    with pytest.raises(HTTPException):
        clean_document(source)


def test_simple_tables_export_as_markdown_with_escaped_pipes():
    source = document()
    source["content"][1]["content"][0]["content"] = [
        {"type": "tableHeader", "content": [paragraph("Moment")]},
        {"type": "tableHeader", "content": [paragraph("Detail")]},
    ]
    source["content"][1]["content"][1]["content"][1]["content"] = [paragraph("a | b")]
    for row in source["content"][1]["content"]:
        for cell in row["content"]:
            cell.get("attrs", {}).pop("colwidth", None)
    result = markdown(clean_document(source))
    assert "| Moment | Detail |\n| --- | --- |" in result
    assert "a \\| b" in result


def test_vertical_merge_survives_docx_pdf_and_markdown():
    source = document()
    table = source["content"][1]
    table["content"][1]["content"][0]["attrs"]["rowspan"] = 2
    table["content"].append({"type": "tableRow", "content": [
        {"type": "tableCell", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": [180]}, "content": [paragraph("Third idea")]},
    ]})
    cleaned = clean_document(source)
    doc = Document(BytesIO(to_docx(cleaned, "Vertical merge")))
    assert doc.tables[0].cell(1, 0)._tc is doc.tables[0].cell(2, 0)._tc
    assert 'rowspan="2"' in markdown(cleaned)
    text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(to_pdf(cleaned, "Vertical merge"))).pages)
    assert "Third idea" in text


def test_native_cell_alignment_survives_storage_and_docx():
    source = document()
    source["content"][1]["content"][1]["content"][0]["attrs"]["align"] = "right"
    cleaned = clean_document(source)
    assert cleaned["content"][1]["content"][1]["content"][0]["attrs"]["align"] == "right"
    doc = Document(BytesIO(to_docx(cleaned, "Aligned table")))
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    assert doc.tables[0].cell(1, 0).paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.RIGHT
