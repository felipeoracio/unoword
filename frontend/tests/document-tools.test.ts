import { expect, it } from "vitest";
import { getSchema, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { SessionCredit, sessionCreditWords } from "../src/lib/session-credit";
import { DocumentSearch, findMatches, searchKey, setSearch, replaceMatches } from "../src/lib/document-search";
import { DocumentPageBreak, PrintSettings, documentStatistics, documentOutline } from "../src/lib/document-tools";
import { DocumentImage } from "../src/lib/document-image";
const schema=getSchema([StarterKit,SessionCredit,DocumentSearch,DocumentPageBreak,PrintSettings,DocumentImage]);
const p=(text:string)=>schema.node("paragraph",null,text?schema.text(text):undefined);
function harness(doc=schema.node("doc",null,[p("old word")])) {
 const creditPlugins=SessionCredit.config.addProseMirrorPlugins!.call({type:schema.marks.sessionCredit,options:{credit:()=>({session:"current",kind:"typed"})}} as never);
 const searchPlugins=DocumentSearch.config.addProseMirrorPlugins!.call({} as never);
 let state=EditorState.create({schema,doc,plugins:[history(),...creditPlugins,...searchPlugins]});
 const apply=(tr:typeof state.tr)=>{state=state.applyTransaction(tr).state};
 const editor={get state(){return state},schema,isEditable:true,view:{dispatch:apply}} as unknown as Editor;
 return {editor,get state(){return state},undo:()=>undo(state,apply),redo:()=>redo(state,apply)};
}
it("finds literals across formatting but not block/hard-break boundaries",()=>{
 const doc=schema.node("doc",null,[schema.node("paragraph",null,[schema.text("Hello "),schema.text("world",[schema.marks.bold.create()]),schema.node("hardBreak"),schema.text("next")]),p("WORLD a+b")]);
 expect(findMatches(doc,"hello world",false).matches).toHaveLength(1);expect(findMatches(doc,"world",true).matches).toHaveLength(1);expect(findMatches(doc,"a+b",false).matches).toHaveLength(1);expect(findMatches(doc,"worldnext",false).matches).toHaveLength(0);expect(findMatches(doc,"nextWORLD",false).matches).toHaveLength(0);
});
it("replace-all preserves old/pasted credit and is one undo step",()=>{
 const credit=schema.marks.sessionCredit,doc=schema.node("doc",null,[p("old word"),schema.node("paragraph",null,schema.text("word",[credit.create({session:"current",kind:"pasted"})])),schema.node("paragraph",null,schema.text("word",[credit.create({session:"current",kind:"typed"})]))]);
 const h=harness(doc);setSearch(h.editor,"word",false);expect(searchKey.getState(h.state)?.matches).toHaveLength(3);replaceMatches(h.editor,"new word",true);
 expect(h.state.doc.textContent).toBe("old new wordnew wordnew word");expect(sessionCreditWords(h.state.doc,"current")).toEqual({typedWords:2,pastedWords:2});h.undo();expect(h.state.doc.eq(doc)).toBe(true);h.redo();expect(sessionCreditWords(h.state.doc,"current")).toEqual({typedWords:2,pastedWords:2});
});
it("a mixed old/current match cannot lend current credit to replaced words",()=>{
 const h=harness(schema.node("doc",null,[schema.node("paragraph",null,[schema.text("wo"),schema.text("rd",[schema.marks.sessionCredit.create({session:"current",kind:"typed"})])])]));setSearch(h.editor,"word",false);replaceMatches(h.editor,"several replacement words");expect(sessionCreditWords(h.state.doc,"current").typedWords).toBe(0);
});
it("replacement dollar signs are literal and an empty replacement deletes",()=>{
 const h=harness();setSearch(h.editor,"word",false);replaceMatches(h.editor,"$&");expect(h.state.doc.textContent).toBe("old $&");setSearch(h.editor,"$&",true);replaceMatches(h.editor,"");expect(h.state.doc.textContent).toBe("old ");
});
it("bounds long repetitive searches and refuses partial replace-all",()=>{
 const h=harness(schema.node("doc",null,[p("a ".repeat(40000))]));setSearch(h.editor,"a",false);expect(searchKey.getState(h.state)?.limited).toBe(true);expect(searchKey.getState(h.state)?.matches).toHaveLength(10000);expect(replaceMatches(h.editor,"b",true)).toBe(false);
});
it("statistics count Unicode and selections and outline uses semantic headings",()=>{
 const doc=schema.node("doc",null,[schema.node("heading",{level:2},schema.text("A chapter")),p("Hi 😀 café"),schema.node("pageBreak"),p("Next")]);
 expect(documentStatistics(doc,1,10)).toMatchObject({words:5,paragraphs:2,readingMinutes:1,selectedWords:2});const stats=documentStatistics(doc,0,0);expect(stats.characters).toBe(Array.from(doc.textBetween(0,doc.content.size,"\n","\n")).length);expect(stats.withoutSpaces).toBeLessThan(stats.characters);expect(documentOutline(doc)).toEqual([{pos:0,level:2,text:"A chapter"}]);
});

it("oversized replacement is rejected before mutating the document or its credit",()=>{
 const h=harness(schema.node("doc",null,[p("word ".repeat(2000))])),before=h.state.doc;setSearch(h.editor,"word",false);expect(replaceMatches(h.editor,"x".repeat(2000),true)).toBe(false);expect(h.state.doc.eq(before)).toBe(true);
});

it("replacement cannot grow an image caption past the storage limit",()=>{
 const h=harness(schema.node("doc",null,[schema.node("image",{src:"data:image/png;base64,AA==",width:800,height:400},schema.text("cap".repeat(500)))]));setSearch(h.editor,"cap",false);expect(replaceMatches(h.editor,"large",true)).toBe(false);expect(h.state.doc.firstChild?.textContent.length).toBe(1500);
});
