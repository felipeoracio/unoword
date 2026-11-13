import { generateJSON, type Editor, type JSONContent } from "@tiptap/core";
import { TableMap } from "@tiptap/pm/tables";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { typography } from "./document-formatting";
import { safeImageSource, prepareDocumentImage } from "./document-image";
export type ImportPreview = { title: string; content: JSONContent; warnings: string[] };
export function validateImportedDocument(content: JSONContent, editor: Editor) {
 let nodes=0;
 const visit=(node:JSONContent,depth=0,inTable=false)=>{if(++nodes>15000||depth>30)throw Error('document_too_large');if(node.type==='text'&&node.text?.includes('\0'))throw Error('invalid_import_file');node.marks=node.marks?.filter(mark=>mark.type!=='sessionCredit');if(node.type==='table'){if(inTable||(node.content||[]).length>100)throw Error('invalid_document_table');inTable=true;(node.content||[]).forEach(row=>(row.content||[]).forEach(cell=>{if(!Number.isInteger(cell.attrs?.colspan||1)||(cell.attrs?.colspan||1)<1||(cell.attrs?.colspan||1)>20||!Number.isInteger(cell.attrs?.rowspan||1)||(cell.attrs?.rowspan||1)<1||(cell.attrs?.rowspan||1)>100)throw Error('invalid_document_table')}));const table=editor.schema.nodeFromJSON(node),map=TableMap.get(table);if(map.width>20||map.problems?.length)throw Error('invalid_document_table')}(node.content||[]).forEach(child=>visit(child,depth+1,inTable))};visit(content);
 const node=editor.schema.nodeFromJSON(content);node.check();if(node.textBetween(0,node.content.size,'\n').length>200000||new TextEncoder().encode(JSON.stringify(content)).byteLength>1048576)throw Error('document_too_large');return content;
}
export async function importTextFile(file: File, editor: Editor): Promise<ImportPreview> {
 const title=file.name.replace(/\.[^.]+$/,'').slice(0,300)||'Imported document';
 if(file.size>5*1024*1024)throw Error('file_too_large');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()).replace(/\r\n?/g,'\n');
 if(text.includes('\0'))throw Error('invalid_import_file');
 if(/\.txt$/i.test(file.name)){if(text.length>200000)throw Error('document_too_large');return {title,content:validateImportedDocument({type:'doc',content:text.split('\n').map(line=>({type:'paragraph',...(line?{content:[{type:'text',text:line}]}:{})}))},editor),warnings:['plain_text']}}
 if(!/\.(md|markdown)$/i.test(file.name)||text.length>5*1024*1024)throw Error('unsupported_import_format');
 const warnings=new Set<string>(['markdown_compatibility']);let source=text,attrs:Record<string,unknown>={};
 const metadata=source.match(/^<!-- unoword-document:([^\n]{1,20000}) -->\n*/);
 if(metadata){source=source.slice(metadata[0].length);try{const value=JSON.parse(decodeURIComponent(metadata[1]));if(value.version!==1||!value.attrs||typeof value.attrs!=='object')throw Error();const a=value.attrs;if(typeof a.subtitle==='string'&&a.subtitle.length<=500&&!a.subtitle.includes('\0'))attrs.subtitle=a.subtitle;if(a.typography&&typeof a.typography==='object')attrs.typography=typography(a.typography);if(a.printLayout&&['letter','a4'].includes(a.printLayout.size)&&['normal','narrow','wide'].includes(a.printLayout.margin))attrs.printLayout={size:a.printLayout.size,margin:a.printLayout.margin}}catch{warnings.add('unsupported_content')}}
 const fragment=DOMPurify.sanitize(await marked.parse(source,{async:false}),{ALLOWED_TAGS:['p','h1','h2','h3','strong','b','em','i','u','s','del','mark','span','ul','ol','li','blockquote','a','hr','br','img','figure','figcaption','div','table','thead','tbody','tr','td','th','colgroup','col','input','label'],ALLOWED_ATTR:['href','start','src','alt','title','width','height','style','colspan','rowspan','colwidth','align','type','checked','data-type','data-checked','data-document-style','data-document-subtitle','data-paragraph-spacing','data-indent','data-page-break','data-document-image','data-size-mode','data-display-width','data-align'],RETURN_DOM_FRAGMENT:true});
 fragment.querySelectorAll('input').forEach(input=>{if(input.type==='checkbox'){const item=input.closest('li');if(item){item.dataset.type='taskItem';item.dataset.checked=String(input.hasAttribute('checked'));const parent=item.parentElement;if(parent?.tagName==='UL')parent.dataset.type='taskList'}}input.remove()});
 fragment.querySelectorAll<HTMLElement>('[style]').forEach(element=>{for(const key of [...element.style])if(!['font-family','font-size','color','background-color','text-align','line-height','margin-bottom','margin-inline-start','width','max-width','height','margin-left','margin-right','min-width'].includes(key)||/url|expression|var\(|@|\\/i.test(element.style.getPropertyValue(key)))element.style.removeProperty(key)});
 for(const image of fragment.querySelectorAll('img')){
  const source=image.getAttribute('src');if(!safeImageSource(source)){image.remove();warnings.add('external_images');continue}
  try{const [header,data]=source!.split(',');const raw=Uint8Array.from(atob(data),char=>char.charCodeAt(0));const prepared=await prepareDocumentImage(new File([raw],'embedded',{type:header.slice(5,header.indexOf(';'))}));image.src=prepared.src;image.width=prepared.width;image.height=prepared.height}catch{image.remove();warnings.add('unsupported_images')}
 }
 fragment.querySelectorAll('figure').forEach(figure=>{if(!figure.querySelector('img'))figure.replaceWith(...figure.childNodes)});
 fragment.querySelectorAll('[data-document-subtitle]').forEach(element=>{if(attrs.subtitle!==undefined)element.remove();else{const value=element.textContent||'';if(value.length<=500){attrs.subtitle=value;element.remove()}}});
 const container=document.createElement('div');container.append(fragment);
 const content=generateJSON(container.innerHTML,editor.extensionManager.extensions);if(Object.keys(attrs).length)content.attrs=attrs;
 return {title,content:validateImportedDocument(content,editor),warnings:[...warnings]};
}
export const importNotes: Record<string,[string,string]>={
 plain_text:['Plain text has no formatting, images or page settings.','El texto sin formato no incluye imágenes ni ajustes de página.'],
 markdown_compatibility:['Supported Markdown and safe editor HTML are preserved. Unsupported styles or embeds may be omitted.','Se conservan Markdown y HTML seguros compatibles. Pueden omitirse estilos o elementos no compatibles.'],
 docx_compatibility:['Supported Word formatting is retained. Comments, tracked changes, headers/footers, footnotes, fields and complex layouts are not imported.','Se conserva el formato Word compatible. No se importan comentarios, cambios controlados, encabezados/pies, notas, campos ni diseños complejos.'],
 external_images:['Linked images were omitted; UnoWord never downloads external images during import.','Se omitieron imágenes enlazadas; UnoWord no descarga imágenes externas al importar.'],
 unsupported_images:['Some images could not be imported. Use embedded PNG, JPEG or WebP images.','No se pudieron importar algunas imágenes. Usa PNG, JPEG o WebP incrustados.'],
 floating_images:['Floating images use supported block placement.','Las imágenes flotantes se colocan como bloques.'],
 mapped_typography:['Some fonts or sizes were mapped to the available editor typography.','Algunas fuentes o tamaños se adaptaron a los disponibles.'],
 mapped_page_layout:['Page size, margins or multiple sections were mapped to one supported page layout.','El tamaño, los márgenes o las secciones se adaptaron a un diseño compatible.'],
 list_numbering:['Complex list numbering was simplified.','Se simplificó la numeración compleja.'],
 nested_breaks:['Page breaks inside table cells were omitted.','Se omitieron saltos de página dentro de tablas.'],
 merged_cell_content:['Unsupported continuation-cell content was omitted.','Se omitió contenido no compatible en celdas combinadas.'],
 unsupported_content:['Some unsupported document elements were omitted.','Se omitieron algunos elementos no compatibles.'],
};
