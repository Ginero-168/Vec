import assert from "node:assert/strict";
import { test } from "node:test";
import { commitBounds, resolveTraceTarget, type ArtNode } from "./selection.ts";

function node(partial: Partial<ArtNode> & Pick<ArtNode, "typename" | "uuid" | "bounds">): ArtNode {
  return partial;
}

const raster: ArtNode = node({ typename: "RasterItem", uuid: "raster", bounds: [0, 40, 80, 0] });
const placed: ArtNode = node({ typename: "PlacedItem", uuid: "placed", bounds: [10, 30, 40, 5] });

test("a group unwraps to the image inside it", () => {
  const group = node({ typename: "GroupItem", uuid: "group", bounds: [0, 40, 80, 0], children: [raster] });
  const target = resolveTraceTarget(group, () => null);
  assert.equal(target.source.uuid, "raster");
  assert.equal(target.fromResult, false);
});

test("a nested group still finds the image", () => {
  const inner = node({ typename: "GroupItem", uuid: "inner", bounds: [0, 20, 20, 0], children: [placed] });
  const group = node({ typename: "GroupItem", uuid: "outer", bounds: [0, 40, 80, 0], children: [inner] });
  assert.equal(resolveTraceTarget(group, () => null).source.uuid, "placed");
});

test("several images in one group use the largest", () => {
  const small = node({ typename: "RasterItem", uuid: "small", bounds: [0, 10, 10, 0] });
  const group = node({ typename: "GroupItem", uuid: "group", bounds: [0, 40, 80, 0], children: [small, raster] });
  assert.equal(resolveTraceTarget(group, () => null).source.uuid, "raster");
});

test("a group with no image is traced as the group", () => {
  const group = node({ typename: "GroupItem", uuid: "art", bounds: [0, 50, 50, 0], children: [node({ typename: "PathItem", uuid: "path", bounds: [0, 10, 10, 0] })] });
  const target = resolveTraceTarget(group, () => null);
  assert.equal(target.source.uuid, "art");
  assert.equal(target.fromResult, false);
});

test("a previous result group follows its source even when that source sits in a group", () => {
  const wrapper = node({ typename: "GroupItem", uuid: "wrap", bounds: [0, 40, 80, 0], children: [raster] });
  const result = node({ typename: "GroupItem", uuid: "result", bounds: [0, 40, 80, 0], note: "VectorPanel/1|source=wrap|job=abc|" });
  const target = resolveTraceTarget(result, (uuid) => (uuid === "wrap" ? wrapper : null));
  assert.equal(target.source.uuid, "raster");
  assert.equal(target.fromResult, true);
});

test("placing the result does not require the original to stay a raster", () => {
  const recorded = [0, 40, 80, 0] as const;
  assert.deepEqual(commitBounds(null, recorded), { bounds: recorded, moved: false });
  const group = node({ typename: "GroupItem", uuid: "art", bounds: [5, 45, 85, 5] });
  assert.deepEqual(commitBounds(group, recorded), { bounds: recorded, moved: false });
  const same = node({ typename: "GroupItem", uuid: "art", bounds: recorded });
  assert.equal(commitBounds(same, recorded).moved, false);
  const moved = node({ typename: "RasterItem", uuid: "raster", bounds: [20, 40, 100, 0] });
  assert.equal(commitBounds(moved, recorded).moved, true);
  const wrapper = node({ typename: "GroupItem", uuid: "wrap", bounds: [0, 80, 80, 0], children: [node({ typename: "RasterItem", uuid: "raster", bounds: recorded })] });
  assert.deepEqual(commitBounds(wrapper, recorded).bounds, recorded);
  assert.equal(commitBounds(wrapper, recorded).moved, false);
});
