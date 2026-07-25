import test from "node:test";
import assert from "node:assert/strict";
import { createEditorState } from "../apps/web/public/editor-state.mjs";

const geometry = {
  type: "LineString",
  coordinates: [[67.1, 37.8], [67.2, 37.9]],
};

test("saqlash xatosida chizilgan geometriya yo‘qolmaydi", async () => {
  const editor = createEditorState({
    saveRoad: async () => {
      throw new Error("Server xatosi");
    },
  });
  editor.setGeometry(geometry);
  const result = await editor.save({ name: "Test" });
  assert.equal(result.ok, false);
  assert.deepEqual(editor.getState().geometry, geometry);
  assert.equal(editor.getState().error, "Server xatosi");
});

test("muvaffaqiyatli saqlashdan keyin draft tozalanadi", async () => {
  const editor = createEditorState({ saveRoad: async () => ({ id: "road-1" }) });
  editor.setGeometry(geometry);
  const result = await editor.save({ name: "Test" });
  assert.equal(result.ok, true);
  assert.equal(editor.getState().geometry, null);
});
