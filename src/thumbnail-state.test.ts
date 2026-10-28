import assert from "node:assert/strict";
import { test } from "node:test";
import { initialThumbnailState, reduceThumbnailState } from "./thumbnail-state.ts";

test("only the latest capture can set the thumbnail", () => {
  let state = initialThumbnailState();
  state = reduceThumbnailState(state, { kind: "capture-started", generation: 1 });
  state = reduceThumbnailState(state, { kind: "capture-started", generation: 2 });
  const latestState = reduceThumbnailState(state, { kind: "capture-completed", generation: 2, dataUrl: "data:image/png;base64,new" });

  assert.deepEqual(latestState, { kind: "ready", generation: 2, dataUrl: "data:image/png;base64,new" });
  assert.equal(reduceThumbnailState(latestState, { kind: "capture-completed", generation: 1, dataUrl: "data:image/png;base64,old" }), latestState);
});

test("a failed current capture clears the thumbnail", () => {
  const loading = reduceThumbnailState(initialThumbnailState(), { kind: "capture-started", generation: 1 });

  assert.deepEqual(reduceThumbnailState(loading, { kind: "capture-failed", generation: 1 }), { kind: "empty", generation: 1 });
});
