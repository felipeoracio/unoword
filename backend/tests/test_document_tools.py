from copy import deepcopy
from io import BytesIO
import pytest
from fastapi import HTTPException
from docx import Document
from pypdf import PdfReader
from lib.writing_document import clean_document, plain_text, markdown, to_docx, to_pdf


def document():
    return {"type":"doc","attrs":{"printLayout":{"size":"a4","margin":"wide"}},"content":[
        {"type":"paragraph","content":[{"type":"text","text":"Before the break"}]},
        {"type":"pageBreak"},
        {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"After the break"}]}]}


def test_breaks_and_layout_roundtrip_without_changing_plain_words():
    source=document()
    assert clean_document(deepcopy(source))==source
    assert plain_text(source).split()==["Before","the","break","After","the","break"]
    assert '<div data-page-break="true"></div>' in markdown(source)


def test_docx_has_real_page_break_and_requested_paper_margins():
    doc=Document(BytesIO(to_docx(clean_document(document()),"Print sample")))
    section=doc.sections[0]
    assert abs(section.page_width.inches-8.27)<.01
    assert section.left_margin.inches==1.25
    assert 'w:type="page"' in doc._element.xml


def test_pdf_has_two_a4_pages_with_content_on_correct_side_of_break():
    pdf=PdfReader(BytesIO(to_pdf(clean_document(document()),"Print sample")))
    assert len(pdf.pages)==2
    assert "Before the break" in pdf.pages[0].extract_text()
    assert "After the break" in pdf.pages[1].extract_text()
    assert abs(float(pdf.pages[0].mediabox.width)-595.28)<1


@pytest.mark.parametrize("layout",["a4",{}, {"size":"evil","margin":"normal"},{"size":"a4","margin":"-99"}])
def test_invalid_print_settings_rejected(layout):
    source=document();source["attrs"]["printLayout"]=layout
    with pytest.raises(HTTPException):clean_document(source)


def test_page_breaks_cannot_enter_table_cells():
    source=document();source["content"]=[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"pageBreak"}]}]}]}]
    with pytest.raises(HTTPException):clean_document(source)


def test_docx_table_width_tracks_printable_page_area():
    source=document()
    source['attrs']['printLayout']={'size':'letter','margin':'wide'}
    source['content']=[{'type':'table','content':[{'type':'tableRow','content':[
        {'type':'tableCell','attrs':{'colspan':1,'rowspan':1,'colwidth':[120]},'content':[{'type':'paragraph','content':[{'type':'text','text':'Idea'}]}]},
        {'type':'tableCell','attrs':{'colspan':1,'rowspan':1,'colwidth':[240]},'content':[{'type':'paragraph','content':[{'type':'text','text':'Detail'}]}]}
    ]}]}]
    doc=Document(BytesIO(to_docx(clean_document(source),'Table print')))
    assert abs(sum(column.width.inches for column in doc.tables[0].columns)-6)<.01
    assert abs(doc.tables[0].columns[1].width.inches-4)<.01
