import assert from "node:assert/strict";
import { detectImageMime, requireImageMime } from "./image-format.js";
assert.equal(detectImageMime(new Uint8Array([255,216,255,224,...Array(10).fill(0)])),"image/jpeg");
assert.equal(detectImageMime(new Uint8Array([137,80,78,71,13,10,26,10,...Array(4).fill(0)])),"image/png");
assert.equal(detectImageMime(new TextEncoder().encode("RIFF\0\0\0\0WEBP")),"image/webp");
assert.equal(detectImageMime(new TextEncoder().encode("<!doctype html>")),null);
assert.throws(()=>requireImageMime(new Uint8Array(16)),/assinatura válida/);
console.log("image MIME tests passed");
