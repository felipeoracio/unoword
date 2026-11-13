"""Bounded OOXML import. Never fetch relationships or execute document content."""
from io import BytesIO
from zipfile import ZipFile
from copy import deepcopy
from fastapi import HTTPException
from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from docx.text.run import Run
from docx.table import Table
from lib.document_processing import _validate_docx_archive
from lib.writing_formatting import SIZES, LEADING, SPACING


def _read_docx_result(data):
    from lib.writing_document import clean_document, safe_link, plain_text
    from lib.writing_image import import_image, image_attributes
    _validate_docx_archive(data)
    with ZipFile(BytesIO(data)) as archive:
        for item in archive.infolist():
            if item.flag_bits & 1 or 'vbaproject' in item.filename.lower():
                raise ValueError('unsupported_active_document')
            if item.filename.endswith(('.xml', '.rels')):
                xml = archive.read(item)
                if b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper() or b'macroEnabled' in xml:
                    raise ValueError('unsupported_active_document')
    document = Document(BytesIO(data))
    warnings = {'docx_compatibility'}
    images = {}
    seen = 0
    fonts = {'georgia':'serif', 'times new roman':'serif', 'dejavu serif':'serif', 'arial':'sans', 'calibri':'sans', 'aptos':'sans', 'inter':'sans', 'dejavu sans':'sans', 'courier new':'mono', 'jetbrains mono':'mono', 'dejavu sans mono':'mono'}

    def bounded(value, options, default):
        if value is None: return None
        closest = min(options, key=lambda option: abs(option - value))
        if abs(closest - value) > .01: warnings.add('mapped_typography')
        return closest if closest is not None else default

    def family(name):
        if not name: return None
        result = fonts.get(name.lower())
        if not result: warnings.add('mapped_typography')
        return result or 'serif'

    def run_content(run, href=None):
        def inherited(name):
            value=getattr(run.font,name)
            if value is not None:return value
            for style in [run.style,run._parent.style]:
                visited=set()
                while style is not None and id(style.element) not in visited:
                    visited.add(id(style.element));value=getattr(style.font,name)
                    if value is not None:return value
                    style=style.base_style
            return None
        marks = [{'type':name} for name in ['bold','italic','underline','strike'] if inherited(name)]
        style = {}
        if run.font.name: style['fontFamily'] = family(run.font.name)
        if run.font.size: style['fontSize'] = bounded(run.font.size.pt / .75, SIZES, 18)
        if run.font.color.rgb: style['color'] = '#' + str(run.font.color.rgb).lower()
        if style: marks.append({'type':'textStyle','attrs':style})
        shading = run._r.xpath('./w:rPr/w:shd')
        if shading:
            value = shading[0].get(qn('w:fill'), '')
            if len(value)==6 and all(char in '0123456789abcdefABCDEF' for char in value): marks.append({'type':'highlight','attrs':{'color':'#'+value.lower()}})
        if href: marks.append({'type':'link','attrs':{'href':href}})
        output = []
        for child in run._r:
            tag = child.tag.rsplit('}',1)[-1]
            if tag == 't' and child.text: output.append({'type':'text','text':child.text,**({'marks':deepcopy(marks)} if marks else {})})
            elif tag == 'tab': output.append({'type':'text','text':'\t',**({'marks':deepcopy(marks)} if marks else {})})
            elif tag in {'br','cr'}:
                output.append({'type':'pageBreak'} if child.get(qn('w:type'))=='page' else {'type':'hardBreak'})
            elif tag == 'drawing':
                blips = child.xpath('.//a:blip')
                for blip in blips:
                    relation = blip.get(qn('r:embed'))
                    part = document.part.related_parts.get(relation)
                    if part is None: warnings.add('external_images'); continue
                    if relation not in images:
                        try: images[relation] = import_image(part.blob)
                        except (ValueError, HTTPException): warnings.add('unsupported_images'); images[relation] = None
                    if not images[relation]: continue
                    extent = child.xpath('.//wp:extent')
                    width = max(80,min(1600,round(int(extent[0].get('cx','0')) / 914400 * 96))) if extent else 560
                    descriptions = child.xpath('.//wp:docPr')
                    alt = descriptions[0].get('descr','')[:500] if descriptions else ''
                    output.append({'type':'image','attrs':image_attributes({'src':images[relation],'alt':alt,'displayMode':'custom','displayWidth':width,'align':'left'})})
                if child.xpath('.//wp:anchor'): warnings.add('floating_images')
        return output

    def number_info(paragraph):
        props = paragraph._p.xpath('./w:pPr/w:numPr')
        if props:
            number = props[0].find(qn('w:numId')); level = props[0].find(qn('w:ilvl'))
            num_id = number.get(qn('w:val')) if number is not None else None
            depth = max(0,min(6,int(level.get(qn('w:val'),'0')))) if level is not None else 0
            try:
                root = document.part.numbering_part.element
                nums = root.xpath(f'./w:num[@w:numId="{int(num_id)}"]/w:abstractNumId')
                abstract = int(nums[0].get(qn('w:val'))) if nums else -1
                levels = root.xpath(f'./w:abstractNum[@w:abstractNumId="{abstract}"]/w:lvl[@w:ilvl="{depth}"]')
                fmt = levels[0].find(qn('w:numFmt')).get(qn('w:val')) if levels else 'decimal'
                if fmt not in {'bullet','decimal'}: warnings.add('list_numbering')
                overrides=root.xpath(f'./w:num[@w:numId="{int(num_id)}"]/w:lvlOverride[@w:ilvl="{depth}"]/w:startOverride')
                start = levels[0].find(qn('w:start')) if levels else None
                return ('bulletList' if fmt=='bullet' else 'orderedList',depth,max(1,min(10000,int(overrides[0].get(qn('w:val'),'1')) if overrides else int(start.get(qn('w:val'),'1')) if start is not None else 1)),num_id)
            except (AttributeError,ValueError,IndexError): warnings.add('list_numbering')
        name = paragraph.style.name if paragraph.style else ''
        if name == 'UnoWord Checklist':
            indent=paragraph.paragraph_format.left_indent
            return ('taskList',max(0,min(6,round(indent.inches/.25))) if indent else 0,1,'checklist')
        if name.startswith(('List Bullet','List Number')):
            suffix = name.rsplit(' ',1)[-1]
            return ('bulletList' if name.startswith('List Bullet') else 'orderedList',min(6,max(0,int(suffix)-1)) if suffix.isdigit() else 0,1,name)
        return None

    def paragraph_nodes(paragraph, in_cell=False):
        name = paragraph.style.name if paragraph.style else ''
        if name == 'UnoWord Document Title': return [], None
        if not paragraph.text and paragraph._p.xpath('./w:pPr/w:pBdr'): return [{'type':'horizontalRule'}], None
        attrs = {}
        if paragraph.alignment in {0,1,2,3}: attrs['textAlign'] = {0:'left',1:'center',2:'right',3:'justify'}[paragraph.alignment]
        fmt = paragraph.paragraph_format
        if isinstance(fmt.line_spacing,float): attrs['lineHeight'] = bounded(fmt.line_spacing,LEADING,1.7)
        if fmt.left_indent and not number_info(paragraph): attrs['indent'] = min(6,max(0,round(fmt.left_indent.inches/.25)))
        if fmt.space_after is not None:
            base = document.styles['Normal'].font.size
            attrs['paragraphSpacing'] = bounded(fmt.space_after.pt / (base.pt if base else 13.5),SPACING,.9)
        kind = 'paragraph'
        if name.startswith('Heading ') and name[-1:] in {'1','2','3'}: kind='heading';attrs['level']=int(name[-1])
        elif name == 'Title': kind='heading';attrs.update(level=1,styleVariant='title')
        elif name == 'Subtitle': attrs['styleVariant']='subtitle'
        parts = []
        for item in paragraph._p:
            if item.tag == qn('w:r'): parts.extend(run_content(Run(item,paragraph)))
            elif item.tag == qn('w:hyperlink'):
                relation = document.part.rels.get(item.get(qn('r:id')))
                href = safe_link(relation.target_ref) if relation and relation.is_external else None
                for run in item.findall(qn('w:r')): parts.extend(run_content(Run(run,paragraph),href))
            elif item.tag in {qn('w:ins'),qn('w:del'),qn('w:sdt')}: warnings.add('unsupported_content')
        # Keep block pictures/breaks at their actual run position.
        result = []; inline = []
        def flush():
            nonlocal inline
            if inline: result.append({'type':kind,**({'attrs':deepcopy(attrs)} if attrs else {}),'content':inline});inline=[]
        if fmt.page_break_before:
            if in_cell: warnings.add('nested_breaks')
            else: result.append({'type':'pageBreak'})
        for part in parts:
            if part['type'] in {'image','pageBreak'}:
                flush()
                if part['type']=='pageBreak' and in_cell: warnings.add('nested_breaks');continue
                if part['type']=='image': part['attrs']['align']=attrs.get('textAlign','left') if attrs.get('textAlign') in {'left','center','right'} else 'left'
                result.append(part)
            else: inline.append(part)
        flush()
        if not result: result=[{'type':kind,**({'attrs':attrs} if attrs else {})}]
        if name == 'Quote': result=[{'type':'blockquote','content':result}]
        return result, number_info(paragraph)

    def table_node(table):
        rows = table._tbl.findall(qn('w:tr'))
        grid = table._tbl.tblGrid
        columns = len(grid.gridCol_lst) if grid is not None else 0
        if not 1<=len(rows)<=100 or not 1<=columns<=20: raise HTTPException(422,'invalid_document_table')
        widths = [max(80,min(1600,round(col.w / 914400 * 96))) if col.w else 120 for col in grid.gridCol_lst]
        output = []; vertical = {}
        for r,row in enumerate(rows):
            cells=[]; column=0; header=bool(row.xpath('./w:trPr/w:tblHeader'))
            for element in row.findall(qn('w:tc')):
                spans=element.xpath('./w:tcPr/w:gridSpan');span=int(spans[0].get(qn('w:val'),'1')) if spans else 1
                if not 1<=span<=20 or column+span>columns: raise HTTPException(422,'invalid_document_table')
                merge=element.xpath('./w:tcPr/w:vMerge');continuation=bool(merge) and merge[0].get(qn('w:val'),'continue')=='continue'
                if continuation:
                    above=vertical.get(column)
                    if not above or above['attrs']['colspan']!=span: raise HTTPException(422,'invalid_document_table')
                    above['attrs']['rowspan']+=1
                    if ''.join(element.itertext()).strip(): warnings.add('merged_cell_content')
                else:
                    content=parse_blocks(element,True)
                    cell={'type':'tableHeader' if header else 'tableCell','attrs':{'colspan':span,'rowspan':1,'colwidth':widths[column:column+span]},'content':content or [{'type':'paragraph'}]}
                    cells.append(cell)
                    for col in range(column,column+span): vertical.pop(col,None)
                    if merge:
                        for col in range(column,column+span): vertical[col]=cell
                column+=span
            if column!=columns: raise HTTPException(422,'invalid_document_table')
            output.append({'type':'tableRow','content':cells})
        return {'type':'table','content':output}

    def parse_blocks(element,in_cell=False):
        nonlocal seen
        output=[];stack=[];last_num=None
        for child in element:
            seen+=1
            if seen>15000: raise HTTPException(413,'document_too_large')
            if child.tag==qn('w:tbl'):
                if in_cell: raise HTTPException(422,'invalid_document_table')
                output.append(table_node(Table(child,document)));stack=[];continue
            if child.tag!=qn('w:p'): continue
            paragraph=Paragraph(child,document)
            nodes,number=paragraph_nodes(paragraph,in_cell)
            name=paragraph.style.name if paragraph.style else ''
            if name=='Caption' and output and output[-1]['type']=='image':
                caption=[part for node in nodes for part in node.get('content',[]) if part['type'] in {'text','hardBreak'}]
                output[-1]['content']=caption;output[-1]['attrs']['captionVisible']=True;continue
            if name=='UnoWord List Continuation' and stack and stack[-1]['content']:
                stack[-1]['content'][-1]['content'].extend(nodes);continue
            if number:
                kind,depth,start,num=number
                # A missing parent level is flattened rather than inventing prose.
                if depth>len(stack): warnings.add('list_numbering')
                depth=min(depth,len(stack))
                if depth<len(stack) and (stack[depth]['type']!=kind or stack[depth].get('_num')!=num): stack=stack[:depth]
                else: stack=stack[:depth+1]
                if depth==len(stack):
                    listing={'type':kind,'_num':num,**({'attrs':{'start':max(1,min(10000,start))}} if kind=='orderedList' else {}),'content':[]}
                    if depth and stack[-1]['content']: stack[-1]['content'][-1]['content'].append(listing)
                    else: output.append(listing)
                    stack.append(listing)
                item={'type':'taskItem' if kind=='taskList' else 'listItem','content':nodes}
                if kind=='taskList':
                    first=nodes[0].get('content',[]) if nodes else []
                    checked=bool(first and first[0].get('text','').startswith('[x] '))
                    if first and first[0].get('text','').startswith(('[x] ','[ ] ')):
                        first[0]['text']=first[0]['text'][4:]
                        if not first[0]['text']: first.pop(0)
                    item['attrs']={'checked':checked}
                stack[-1]['content'].append(item);last_num=num
            else: output.extend(nodes);stack=[];last_num=None
        return output

    blocks=parse_blocks(document.element.body)
    attrs={}
    # Retain the existing legacy leading Subtitle convention.
    if blocks and blocks[0].get('attrs',{}).get('styleVariant')=='subtitle' and len(plain_text(blocks[0]))<=500:
        attrs['subtitle']=plain_text(blocks.pop(0))
    normal=document.styles['Normal']
    style={}
    if normal.font.name: style['fontFamily']=family(normal.font.name)
    if normal.font.size: style['fontSize']=bounded(normal.font.size.pt/.75,SIZES,18)
    if isinstance(normal.paragraph_format.line_spacing,float): style['lineHeight']=bounded(normal.paragraph_format.line_spacing,LEADING,1.7)
    if normal.paragraph_format.space_after is not None: style['paragraphSpacing']=bounded(normal.paragraph_format.space_after.pt/(normal.font.size.pt if normal.font.size else 13.5),SPACING,.9)
    if style: attrs['typography']={'fontFamily':'serif','fontSize':18,'lineHeight':1.7,'paragraphSpacing':.9,**style}
    section=document.sections[0]
    width=section.page_width.inches if section.page_width else 8.5
    margin=section.left_margin.inches if section.left_margin else 1
    size='a4' if abs(width-210/25.4)<.05 else 'letter'
    if min(abs(width-8.5),abs(width-210/25.4))>.05: warnings.add('mapped_page_layout')
    margins={'normal':1,'narrow':.5,'wide':1.25};preset=min(margins,key=lambda key:abs(margins[key]-margin))
    if any(abs((getattr(section,edge).inches if getattr(section,edge) else 0)-margins[preset])>.05 for edge in ['left_margin','right_margin','top_margin','bottom_margin']): warnings.add('mapped_page_layout')
    attrs['printLayout']={'size':size,'margin':preset}
    if len(document.sections)>1: warnings.add('mapped_page_layout')
    content=clean_document({'type':'doc','attrs':attrs,'content':blocks or [{'type':'paragraph'}]})
    return {'content':content,'warnings':sorted(warnings),'title':(document.core_properties.title or '')[:300]}


def import_docx_result(data):
    try:
        return _read_docx_result(data)
    except HTTPException:
        raise
    except Exception as error:
        raise ValueError("invalid_import_file") from error
