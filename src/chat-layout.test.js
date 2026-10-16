import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./chat-layout.css", import.meta.url), "utf8");
const jsx = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");

const block = (start, end) => {
  const from = css.indexOf(start);
  assert(from >= 0, "CSS selector missing: " + start);
  const to = css.indexOf(end, from + start.length);
  return css.slice(from, to < 0 ? undefined : to);
};

const app = block(".app {", ".app > main {");
assert.match(app, /height:\s*100dvh/);
assert.match(app, /overflow:\s*hidden/);

const chat = block(".app > main > .chat {", ".app .messages {");
assert.match(chat, /overflow-y:\s*auto/);
assert.match(chat, /min-height:\s*0/);

const composer = block(".app > main > .composer-wrap {", ".app > main > .composer-wrap .composer");
assert.match(composer, /position:\s*relative/);
assert.match(composer, /flex:\s*0 0 auto/);
assert.doesNotMatch(composer, /position:\s*fixed/);

assert.match(css, /\.app \.msg > div:last-child\s*\{[^}]*min-width:\s*0/s);
assert.match(css, /\.app \.markdown pre,[\s\S]*?overflow-x:\s*auto/s);
assert.match(jsx, /import '\.\/chat-layout\.css';/);
assert.match(jsx, /className="chat" ref=\{chatScrollRef\}/);
assert.match(jsx, /list\.scrollTop=list\.scrollHeight/);
console.log("responsive chat layout contract tests passed");
