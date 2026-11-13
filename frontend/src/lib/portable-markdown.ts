import type { JSONContent } from "@tiptap/core";
import { FONT_FAMILIES } from "./document-formatting";
import { toMarkdown } from "./writing-markdown";
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function portableHTML(node: JSONContent): string {
 const attrs=node.attrs||{}, children=(node.content||[]).map(portableHTML).join("");
 if(node.type==='text'){
  let text=escape(node.text);
  for(const mark of node.marks||[]){const a=mark.attrs||{},tag=({bold:'strong',italic:'em',underline:'u',strike:'s'} as Record<string,string>)[mark.type];if(tag)text=`<${tag}>${text}</${tag}>`;else if(mark.type==='link')text=`<a href="${escape(a.href)}">${text}</a>`;else if(mark.type==='highlight')text=`<mark style="background-color:${escape(a.color)}">${text}</mark>`;else if(mark.type==='textStyle'){const style=[a.fontFamily?`font-family:${FONT_FAMILIES[a.fontFamily as keyof typeof FONT_FAMILIES]}`:'',a.fontSize?`font-size:${a.fontSize}px`:'',a.color?`color:${a.color}`:''].filter(Boolean).join(';');text=`<span style="${escape(style)}">${text}</span>`;}}
  return text;
 }
 if(node.type==='hardBreak')return '<br>';
 if(node.type==='horizontalRule')return '<hr>';
 if(node.type==='pageBreak')return '<div data-page-break="true"></div>';
 if(node.type==='image')return `<figure data-document-image="true" data-size-mode="${escape(attrs.displayMode||'auto')}" data-display-width="${escape(attrs.displayWidth||'')}" data-align="${escape(attrs.align||'center')}"><img src="${escape(attrs.src)}" alt="${escape(attrs.alt)}" width="${escape(attrs.width)}" height="${escape(attrs.height)}"><figcaption>${children}</figcaption></figure>`;
 const tag=node.type==='heading'?`h${attrs.level||1}`:({doc:'div',paragraph:'p',blockquote:'blockquote',bulletList:'ul',orderedList:'ol',listItem:'li',taskList:'ul',taskItem:'li',table:'table',tableRow:'tr',tableCell:'td',tableHeader:'th'} as Record<string,string>)[node.type||''];
 if(!tag)return children;
 const extra:string[]=[];const style:string[]=[];
 if(attrs.textAlign)style.push(`text-align:${attrs.textAlign}`);
 if(attrs.lineHeight)style.push(`line-height:${attrs.lineHeight}`);
 if(attrs.paragraphSpacing!=null){extra.push(`data-paragraph-spacing="${attrs.paragraphSpacing}"`);style.push(`margin-bottom:${attrs.paragraphSpacing}em`)}
 if(attrs.indent)extra.push(`data-indent="${attrs.indent}"`);
 if(attrs.styleVariant)extra.push(`data-document-style="${escape(attrs.styleVariant)}"`);
 if(node.type==='orderedList')extra.push(`start="${attrs.start||1}"`);
 if(node.type==='taskList')extra.push('data-type="taskList"');
 if(node.type==='taskItem')extra.push(`data-type="taskItem" data-checked="${!!attrs.checked}"`);
 if(['tableCell','tableHeader'].includes(node.type||'')){extra.push(`colspan="${attrs.colspan||1}" rowspan="${attrs.rowspan||1}"`);if(attrs.colwidth)extra.push(`colwidth="${attrs.colwidth.join(',')}"`);if(attrs.align)extra.push(`align="${escape(attrs.align)}"`)}
 if(style.length)extra.push(`style="${escape(style.join(';'))}"`);
 return `<${tag}${extra.length?' '+extra.join(' '):''}>${children}</${tag}>`;
}
export function exportMarkdown(doc: JSONContent): string {
 const attrs=Object.fromEntries(Object.entries(doc.attrs||{}).filter(([key,value])=>['subtitle','typography','printLayout'].includes(key)&&value!=null));
 const rich=(node:JSONContent):boolean=>(['image','pageBreak'].includes(node.type||'')||(node.type==='table'&&(!(node.content?.[0]?.content||[]).every(cell=>cell.type==='tableHeader')||(node.content||[]).some(row=>(row.content||[]).some(cell=>(cell.attrs?.colspan||1)!==1||(cell.attrs?.rowspan||1)!==1||!!cell.attrs?.colwidth||!!cell.attrs?.align||cell.content?.length!==1||cell.content[0].type!=='paragraph')))))||!!node.marks?.some(mark=>['textStyle','highlight','underline'].includes(mark.type))||Object.entries(node.attrs||{}).some(([key,value])=>['textAlign','lineHeight','paragraphSpacing','indent','styleVariant'].includes(key)&&!!value)||(node.content||[]).some(rich);
 const meta=Object.keys(attrs).length?`<!-- unoword-document:${encodeURIComponent(JSON.stringify({version:1,attrs}))} -->\n\n`:'';
 const subtitle=attrs.subtitle?`<p data-document-subtitle="true">${escape(attrs.subtitle)}</p>\n\n`:'';
 return meta+subtitle+(doc.content||[]).map(node=>rich(node)?portableHTML(node):toMarkdown(node)).join('\n\n');
}
