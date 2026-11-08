import { test } from "node:test";
import assert from "node:assert/strict";
import { apiBase, cachedPublicConnection, PRIMARY_API_URL } from "../src/domain/site";
test("API migration keeps explicit previews and converts only known production aliases", () => {
  assert.equal(apiBase(),PRIMARY_API_URL);
  assert.equal(apiBase("https://unoword.vercel.app/api/"),PRIMARY_API_URL);
  assert.equal(apiBase("https://www.unoword.app/api"),PRIMARY_API_URL);
  assert.equal(apiBase("https://sandbox.example.com/api/"),"https://sandbox.example.com/api");
});
test("offline startup can read the old public connection cache without deleting it",async()=>{
  const entries=new Map([["uno.mobile.public-config:https://unoword.vercel.app/api",'{"public":"fixture"}']]);
  assert.equal(await cachedPublicConnection(PRIMARY_API_URL,async key=>entries.get(key)||null),'{"public":"fixture"}');
  assert.equal(entries.size,1);
  assert.equal(await cachedPublicConnection('https://sandbox.example.com/api',async key=>entries.get(key)||null),null);
});
