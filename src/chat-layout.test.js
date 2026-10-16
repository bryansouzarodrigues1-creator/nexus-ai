import assert from "node:assert/strict";
import { reserveComposerHeight, isNearConversationBottom } from "./chat-layout.js";

assert.equal(reserveComposerHeight(251.2), 252);
assert.equal(reserveComposerHeight(-2), 0);
assert.equal(reserveComposerHeight(undefined), 0);
assert.equal(isNearConversationBottom(3000, 2370, 640), true);
assert.equal(isNearConversationBottom(3000, 1800, 640), false);
assert.equal(isNearConversationBottom(2500, 1660, 720), true);
assert.equal(isNearConversationBottom(2500, 1000, 720), false);
assert.equal(isNearConversationBottom(NaN, 100, 700), false);
console.log("mobile chat layout tests passed");
