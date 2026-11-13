from io import BytesIO
from copy import deepcopy
from zipfile import ZipFile
import pytest
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from pypdf import PdfReader
from lib.writing_document import clean_document, plain_text, markdown, to_docx, to_pdf, import_docx
from lib.writing_docx_import import import_docx_result
from tests.test_editor_media import document as media_document


def paragraph(text):return {'type':'paragraph','content':[{'type':'text','text':text}]}


def sample():
    media=media_document()['content']
    return clean_document({'type':'doc','attrs':{'subtitle':'A patient beginning','typography':{'fontFamily':'sans','fontSize':18,'lineHeight':1.7,'paragraphSpacing':.9},'printLayout':{'size':'a4','margin':'normal'}},'content':[
        {'type':'heading','attrs':{'level':2},'content':[{'type':'text','text':'Chapter one'}]},
        {'type':'paragraph','attrs':{'textAlign':'right','lineHeight':2,'paragraphSpacing':1.5,'indent':1},'content':[{'type':'text','text':'Café Ελληνικά Привет','marks':[{'type':'bold'},{'type':'italic'},{'type':'underline'},{'type':'textStyle','attrs':{'fontFamily':'mono','fontSize':22,'color':'#7136a2'}},{'type':'highlight','attrs':{'color':'#fff0a6'}}]}]},
        media[1],paragraph('Between the table and image.'),media[0],
        {'type':'orderedList','attrs':{'start':4},'content':[{'type':'listItem','content':[paragraph('First item'),{'type':'bulletList','content':[{'type':'listItem','content':[paragraph('Nested idea')]}]}]},{'type':'listItem','content':[paragraph('Second item')]}]},
        {'type':'taskList','content':[{'type':'taskItem','attrs':{'checked':True},'content':[paragraph('Keep the detail')]}]},
        {'type':'pageBreak'},paragraph('On the next page.') ]})


def descendants(node):
    yield node
    for child in node.get('content',[]):yield from descendants(child)


def test_docx_preserves_body_order_tables_captions_and_supported_styles():
    source=sample();result=import_docx_result(to_docx(source,'A portable story'));doc=result['content'];nodes=list(descendants(doc))
    assert [node['type'] for node in doc['content']][:5]==['heading','paragraph','table','paragraph','image']
    assert 'A portable story'==result['title']
    assert doc['attrs']['subtitle']=='A patient beginning'
    assert doc['attrs']['typography']['fontFamily']=='sans'
    assert doc['attrs']['printLayout']=={'size':'a4','margin':'normal'}
    styled=next(node for node in nodes if node.get('text')=='Café Ελληνικά Привет')
    assert {mark['type'] for mark in styled['marks']}=={'bold','italic','underline','textStyle','highlight'}
    table=next(node for node in nodes if node['type']=='table');assert table['content'][0]['content'][0]['attrs']['colspan']==2
    image=next(node for node in nodes if node['type']=='image');assert image['attrs']['displayWidth']==240;assert image['attrs']['align']=='right';assert 'Figure 1' in plain_text(image)
    ordered=next(node for node in nodes if node['type']=='orderedList');assert ordered['attrs']['start']==4;assert len(ordered['content'])==2
    assert any(node['type']=='bulletList' for node in descendants(ordered))
    task=next(node for node in nodes if node['type']=='taskItem');assert task['attrs']['checked'] is True;assert plain_text(task)=='Keep the detail'
    assert any(node['type']=='pageBreak' for node in nodes)
    assert all(mark['type']!='sessionCredit' for node in nodes for mark in node.get('marks',[]))


def test_vertical_merges_roundtrip_without_duplicate_cell_text():
    source=media_document();table=source['content'][1]
    table['content'][0]['content']=[{'type':'tableHeader','attrs':{'colspan':1,'rowspan':2,'colwidth':[120]},'content':[paragraph('Shared cell')]},{'type':'tableHeader','content':[paragraph('Top right')]}]
    table['content'][1]['content']=[{'type':'tableCell','content':[paragraph('Bottom right')]}]
    result=import_docx(to_docx(clean_document(source),'Vertical merge'))
    restored=next(node for node in result['content'] if node['type']=='table')
    assert restored['content'][0]['content'][0]['attrs']['rowspan']==2
    assert plain_text(restored).count('Shared cell')==1


def test_unicode_pdf_and_page_breaks_are_readable():
    pdf=PdfReader(BytesIO(to_pdf(sample(),'A portable story')))
    text='\n'.join(page.extract_text() for page in pdf.pages)
    for expected in ['Café','Ελληνικά','Привет','Between the table','Figure 1','On the next page.']:assert expected in text
    assert len(pdf.pages)>=2
    assert 'On the next page.' in pdf.pages[-1].extract_text()


def test_markdown_preserves_advanced_html_and_has_no_credit_marks():
    result=markdown(sample())
    for expected in ['<!-- unoword-document:','data-document-subtitle','font-size:22px','background-color:#fff0a6','colwidth=','data-document-image','figcaption','data-page-break','- [x] Keep the detail']:assert expected in result
    assert 'sessionCredit' not in result


def test_malicious_archive_entity_and_macros_are_rejected():
    original=to_docx({'type':'doc','content':[paragraph('Safe text')]},'Safe')
    for macro in [False,True]:
        output=BytesIO()
        with ZipFile(BytesIO(original)) as source,ZipFile(output,'w') as target:
            for item in source.infolist():
                value=source.read(item)
                if item.filename=='word/document.xml' and not macro:value=b'<!DOCTYPE x [<!ENTITY unsafe SYSTEM "file:///etc/passwd">]>'+value
                target.writestr(item,value)
            if macro:target.writestr('word/vbaProject.bin',b'not executed')
        with pytest.raises(ValueError):import_docx(output.getvalue())


def test_external_image_relationships_are_never_fetched():
    doc=Document();p=doc.add_paragraph('Image: ')
    relation=doc.part.relate_to('https://tracker.invalid/pixel','http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',is_external=True)
    drawing=OxmlElement('w:drawing');inline=OxmlElement('wp:inline');graphic=OxmlElement('a:graphic');data=OxmlElement('a:graphicData');blip=OxmlElement('a:blip');blip.set(qn('r:link'),relation);data.append(blip);graphic.append(data);inline.append(graphic);drawing.append(inline);p.add_run()._r.append(drawing)
    output=BytesIO();doc.save(output);result=import_docx_result(output.getvalue())
    assert 'external_images' in result['warnings'];assert not any(node['type']=='image' for node in descendants(result['content']))


def test_pdf_highlight_is_painted_not_only_parsed_as_markup():
    pdf=PdfReader(BytesIO(to_pdf(sample(),'Highlighted sample')))
    colors=[args for page in pdf.pages for args,operator in page.get_contents().operations if operator==b'rg']
    assert any(len(args)==3 and all(abs(float(actual)-expected)<.00001 for actual,expected in zip(args,[1,240/255,166/255])) for args in colors)


def test_exported_heading_hierarchy_and_document_font_are_retained():
    source=sample()
    source['attrs']['typography']['fontFamily']='mono'
    source['content']=[{'type':'heading','attrs':{'level':level},'content':[{'type':'text','text':label}]} for level,label in [(1,'First heading'),(2,'Second heading'),(3,'Third heading')]]
    word=Document(BytesIO(to_docx(source,'Hierarchy')))
    assert all(word.styles['Heading '+str(level)].font.name=='Courier New' for level in [1,2,3])
    sizes={}
    def record(text,cm,tm,font,size):
        for label in ['First heading','Second heading','Third heading']:
            if label in text:sizes[label]=size
    PdfReader(BytesIO(to_pdf(source,'Hierarchy'))).pages[0].extract_text(visitor_text=record)
    assert sizes['First heading']>sizes['Second heading']>sizes['Third heading']


def test_missing_metadata_uses_the_editor_defaults_in_both_portable_formats():
    source={'type':'doc','content':[paragraph('A default document')]}
    word=Document(BytesIO(to_docx(source,'Defaults')))
    assert word.sections[0].left_margin.inches==1
    assert word.styles['Normal'].font.name=='Georgia'
    assert word.styles['Normal'].font.size.pt==13.5
    pdf=PdfReader(BytesIO(to_pdf(source,'Defaults')))
    assert float(pdf.pages[0].mediabox.width)==612
    sizes=[]
    pdf.pages[0].extract_text(visitor_text=lambda text,cm,tm,font,size:sizes.append(size) if 'A default document' in text else None)
    assert sizes==[13.5]


def test_pdf_can_split_a_long_table_cell_across_pages():
    def cell(kind,text):return {'type':kind,'content':[paragraph(text)]}
    source={'type':'doc','content':[{'type':'table','content':[{'type':'tableRow','content':[cell('tableHeader','Observation'),cell('tableHeader','Context')]},{'type':'tableRow','content':[cell('tableCell','A patient observation. '*1000+'Final cell detail.'),cell('tableCell','Companion cell')]}]}]}
    reader=PdfReader(BytesIO(to_pdf(clean_document(source),'Long table')))
    assert len(reader.pages)>1
    assert 'Final cell detail.' in '\n'.join(page.extract_text() for page in reader.pages)
