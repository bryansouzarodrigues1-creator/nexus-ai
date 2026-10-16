import assert from "node:assert/strict";
import {
  requiresVisibleImageChange, isBroadImageEdit, prioritizeRequestedImageEdit,
  buildEditFulfillmentInstruction, cloudflareEditGuidance, imageBytesMatchSource, exactCopyEditFailure,
} from "./image-edit-fulfillment.js";

assert.equal(requiresVisibleImageChange("Mude a cor da roupa para azul", true), true);
assert.equal(requiresVisibleImageChange("Coloque outra pessoa do meu lado", true), true);
assert.equal(requiresVisibleImageChange("Não mude nada", true), false);
assert.equal(requiresVisibleImageChange("Troque o cenário", false), false);
assert.equal(isBroadImageEdit("Me coloque ao lado do Bolsonaro nesta foto"), true);
assert.equal(isBroadImageEdit("Acrescente uma pessoa do meu lado"), true);
assert.equal(isBroadImageEdit("Remova um ponto pequeno da blusa"), false);

const base={ mode: "strict_edit", editStrength: 0.22, localized: true, preservationLevel: "maximum", successCriteria: [] };
const broad=prioritizeRequestedImageEdit(base, "Me coloque ao lado de um político", true);
assert.equal(broad.preservationLevel, "high");
assert.equal(broad.localized, false);
assert(broad.editStrength>=0.56);
assert.equal(base.editStrength,0.22,"Do not mutate input plan");
const local=prioritizeRequestedImageEdit(base,"Remova um objeto da foto",true);
assert(local.editStrength>=0.38);
assert.equal(local.preservationLevel,"maximum");
assert.equal(prioritizeRequestedImageEdit(base,"Não altere nada",true),base);
assert.equal(prioritizeRequestedImageEdit({...base,mode:"enhance"},"Aumente a nitidez",true).mode,"enhance");
assert.match(buildEditFulfillmentInstruction("Coloque um cachorro ao meu lado",true),/MUST change/);
assert.equal(buildEditFulfillmentInstruction("Não mude nada",true),"");
assert.equal(cloudflareEditGuidance({hasSourceImage:false}),3.5);
assert(cloudflareEditGuidance({hasSourceImage:true,editStrength:0.6})>
       cloudflareEditGuidance({hasSourceImage:true,editStrength:0.2}));
assert(cloudflareEditGuidance({hasSourceImage:true,editStrength:5})<=6.22);
const source=new Blob([new Uint8Array([1,2,3,4])]);
assert.equal(await imageBytesMatchSource(source,new Uint8Array([1,2,3,4])),true);
assert.equal(await imageBytesMatchSource(source,new Uint8Array([1,2,3,5])),false);
assert.equal(await imageBytesMatchSource(source,new Uint8Array([1,2,3])),false);
assert.equal(exactCopyEditFailure().requestFulfillment,0);
assert.equal(exactCopyEditFailure().pass,false);
console.log("image-edit fulfillment tests passed");
