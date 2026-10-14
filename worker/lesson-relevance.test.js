import assert from "node:assert/strict";
import { selectRelevantLessons } from "./lesson-relevance.js";
const lessons = [
  {taskType:"image",confidence:.9,trigger:"Ao editar cavalo preservar rosto e anatomia",guidance:"Preserve a anatomia do cavalo",at:2},
  {taskType:"image",confidence:.9,trigger:"Ao criar cartaz de pizzaria",guidance:"Mantenha promoção e preços",at:3},
  {taskType:"image",confidence:.2,trigger:"Ao editar cavalo",guidance:"Troque a pessoa",at:4}
];
const selected=selectRelevantLessons(lessons,"edite a foto do cavalo sem mudar sua anatomia");
assert.equal(selected.length,1);
assert.match(selected[0].guidance,/anatomia/);
assert.deepEqual(selectRelevantLessons(lessons,"oi"),[]);
assert.deepEqual(selectRelevantLessons(lessons,"imagem desconhecida"),[]);
console.log("Context-scoped learning tests: OK");
