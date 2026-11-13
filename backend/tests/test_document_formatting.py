from copy import deepcopy
from io import BytesIO
import pytest
from docx import Document
from pypdf import PdfReader
from lib.writing_document import clean_document, markdown, plain_text, to_docx, to_pdf


def sample():
    return {"type": "doc", "attrs": {"typography": {"fontFamily": "sans", "fontSize": 20, "lineHeight": 1.75, "paragraphSpacing": 1.5}}, "content": [
        {"type": "heading", "attrs": {"level": 1, "styleVariant": "title"}, "content": [{"type": "text", "text": "A thoughtful title"}]},
        {"type": "paragraph", "attrs": {"textAlign": "justify", "indent": 2, "lineHeight": 2, "paragraphSpacing": .5}, "content": [{"type": "text", "text": "A careful observation.", "marks": [
            {"type": "textStyle", "attrs": {"fontFamily": "mono", "fontSize": 24, "color": "#0757ce"}},
            {"type": "highlight", "attrs": {"color": "#fff0a6"}},
            {"type": "sessionCredit", "attrs": {"session": "current", "kind": "typed"}}, {"type": "bold"}]}]},
        {"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": True}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Remember the detail"}]}]},
            {"type": "taskItem", "attrs": {"checked": False}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Ask a question"}]},
                {"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": False}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Explore its meaning"}]}]}]}]},
        ]},
    ]}


def test_roundtrip_preserves_supported_formatting_and_provenance():
    source = sample()
    assert clean_document(deepcopy(source)) == source
    assert "Remember the detail\nAsk a question" in plain_text(source)
    assert "[x]" not in plain_text(source)


def test_markdown_keeps_nested_checklist_state():
    result = markdown(clean_document(sample()))
    assert "- [x] Remember the detail" in result
    assert "- [ ] Ask a question" in result
    assert "  - [ ] Explore its meaning" in result


def test_docx_keeps_font_color_spacing_and_checklist_content():
    doc = Document(BytesIO(to_docx(clean_document(sample()), "Sample")))
    p = next(p for p in doc.paragraphs if p.text == "A careful observation.")
    assert p.paragraph_format.line_spacing == 2
    assert p.paragraph_format.left_indent.inches == .5
    assert p.runs[0].font.name == "Courier New"
    assert p.runs[0].font.size.pt == 18
    assert str(p.runs[0].font.color.rgb) == "0757CE"
    assert "FFF0A6" in p.runs[0]._r.xml.upper()
    assert any(p.text == "[x] Remember the detail" for p in doc.paragraphs)
    assert any(p.text == "[ ] Explore its meaning" for p in doc.paragraphs)
    assert doc.styles["Normal"].font.size.pt == 15


def test_pdf_renders_new_formats_without_losing_checklist_text():
    data = to_pdf(clean_document(sample()), "Sample")
    text = "\n".join(p.extract_text() for p in PdfReader(BytesIO(data)).pages)
    for expected in ["A thoughtful title", "A careful observation.", "Remember the detail", "Explore its meaning"]:
        assert expected in text


@pytest.mark.parametrize("value", ["url(javascript:evil)", "#fff;position:fixed", {"bad": True}, ["red"], None])
def test_unsafe_colors_are_removed(value):
    source = sample()
    marks = source["content"][1]["content"][0]["marks"]
    marks[0]["attrs"]["color"] = value
    marks[1]["attrs"]["color"] = value
    cleaned = clean_document(source)["content"][1]["content"][0]["marks"]
    assert "color" not in cleaned[0]["attrs"]
    assert not any(m["type"] == "highlight" for m in cleaned)


def test_invalid_values_cannot_escape_bounded_schema():
    source = sample()
    source["attrs"]["typography"] = {"fontFamily": "evil", "fontSize": 9999, "lineHeight": -5, "paragraphSpacing": "url(x)", "style": "position:fixed"}
    source["content"][1]["attrs"].update(indent=999, lineHeight=999, paragraphSpacing=-1, styleVariant="script")
    cleaned = clean_document(source)
    assert cleaned["attrs"]["typography"] == {"fontFamily": "serif", "fontSize": 18, "lineHeight": 1.7, "paragraphSpacing": .9}
    assert cleaned["content"][1]["attrs"] == {"textAlign": "justify"}
