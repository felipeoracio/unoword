"""Portable Markdown uses safe HTML only for formatting Markdown cannot express."""
import json
from html import escape
from urllib.parse import quote
FONTS={'serif':'Georgia, "Times New Roman", serif','sans':'"Inter Variable", Inter, system-ui, sans-serif','mono':'"JetBrains Mono Variable", monospace'}


def portable_html(node):
    kind=node['type'];a=node.get('attrs',{});children=''.join(portable_html(child) for child in node.get('content',[]))
    if kind=='text':
        text=escape(node.get('text',''),quote=True)
        for mark in node.get('marks',[]):
            name=mark['type'];m=mark.get('attrs',{});tag={'bold':'strong','italic':'em','underline':'u','strike':'s'}.get(name)
            if tag:text=f'<{tag}>{text}</{tag}>'
            elif name=='link':text=f'<a href="{escape(m["href"],quote=True)}">{text}</a>'
            elif name=='highlight':text=f'<mark style="background-color:{m["color"]}">{text}</mark>'
            elif name=='textStyle':
                styles=[]
                if m.get('fontFamily'):styles.append('font-family:'+FONTS[m['fontFamily']])
                if m.get('fontSize'):styles.append(f'font-size:{m["fontSize"]}px')
                if m.get('color'):styles.append('color:'+m['color'])
                text=f'<span style="{escape(";".join(styles),quote=True)}">{text}</span>'
        return text
    if kind=='hardBreak':return '<br>'
    if kind=='horizontalRule':return '<hr>'
    if kind=='pageBreak':return '<div data-page-break="true"></div>'
    if kind=='image':
        return f'<figure data-document-image="true" data-size-mode="{a.get("displayMode","auto")}" data-display-width="{a.get("displayWidth") or ""}" data-align="{a.get("align","center")}"><img src="{escape(a["src"],quote=True)}" alt="{escape(a.get("alt",""),quote=True)}" width="{a["width"]}" height="{a["height"]}"><figcaption>{children}</figcaption></figure>'
    tag=f'h{a.get("level",1)}' if kind=='heading' else {'doc':'div','paragraph':'p','blockquote':'blockquote','bulletList':'ul','orderedList':'ol','listItem':'li','taskList':'ul','taskItem':'li','table':'table','tableRow':'tr','tableCell':'td','tableHeader':'th'}.get(kind)
    if not tag:return children
    extra=[];styles=[]
    if a.get('textAlign'):styles.append('text-align:'+a['textAlign'])
    if a.get('lineHeight'):styles.append(f'line-height:{a["lineHeight"]}')
    if a.get('paragraphSpacing') is not None:extra.append(f'data-paragraph-spacing="{a["paragraphSpacing"]}"');styles.append(f'margin-bottom:{a["paragraphSpacing"]}em')
    if a.get('indent'):extra.append(f'data-indent="{a["indent"]}"')
    if a.get('styleVariant'):extra.append(f'data-document-style="{a["styleVariant"]}"')
    if kind=='orderedList':extra.append(f'start="{a.get("start",1)}"')
    if kind=='taskList':extra.append('data-type="taskList"')
    if kind=='taskItem':extra.append(f'data-type="taskItem" data-checked="{str(bool(a.get("checked"))).lower()}"')
    if kind in {'tableCell','tableHeader'}:
        extra.append(f'colspan="{a.get("colspan",1)}" rowspan="{a.get("rowspan",1)}"')
        if a.get('colwidth'):extra.append(f'colwidth="{",".join(str(n) for n in a["colwidth"])}"')
        if a.get('align'):extra.append(f'align="{a["align"]}"')
    if styles:extra.append(f'style="{escape(";".join(styles),quote=True)}"')
    attributes=' '+ ' '.join(extra) if extra else ''
    return f'<{tag}{attributes}>{children}</{tag}>'


def portable_markdown(doc, render):
    attrs={key:value for key,value in doc.get('attrs',{}).items() if key in {'subtitle','typography','printLayout'} and value is not None}
    def rich(node):
        return ((node['type'] in {'image','pageBreak'} or (node['type']=='table' and (not all(cell['type']=='tableHeader' for cell in node.get('content',[{}])[0].get('content',[])) or any(cell.get('attrs',{}).get('colspan',1)!=1 or cell.get('attrs',{}).get('rowspan',1)!=1 or cell.get('attrs',{}).get('colwidth') or cell.get('attrs',{}).get('align') or len(cell.get('content',[]))!=1 or cell['content'][0]['type']!='paragraph' for row in node.get('content',[]) for cell in row.get('content',[]))))) or any(mark['type'] in {'textStyle','highlight','underline'} for mark in node.get('marks',[])) or any(node.get('attrs',{}).get(key) for key in ['textAlign','lineHeight','paragraphSpacing','indent','styleVariant']) or any(rich(child) for child in node.get('content',[])))
    meta='<!-- unoword-document:'+quote(json.dumps({'version':1,'attrs':attrs},ensure_ascii=False,separators=(',',':')),safe="~!*'()-._")+' -->\n\n' if attrs else ''
    subtitle=f'<p data-document-subtitle="true">{escape(attrs["subtitle"])}</p>\n\n' if attrs.get('subtitle') else ''
    content='\n\n'.join(portable_html(child) if rich(child) else render(child) for child in doc.get('content',[]))
    return meta+subtitle+content
