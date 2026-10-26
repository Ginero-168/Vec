import assert from "node:assert/strict";
import { test } from "node:test";
import { holeNote, scoreSvg } from "./score.ts";

const tracedLogo = `<?xml version="1.0" encoding="UTF-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="320" height="240">
<path d="M0,240c106.67,0,213.33,0,320,0c0-80,0-160,0-240C213.33,0,106.67,0,0,0C0,80,0,160,0,240ZM62,76c3.74-11.46,13.59-18.86,24-24c51.53-25.45,97.78,30.11,70.89,78.73c-4.48,8.11-13.9,14.32-21.89,18.27c-37.13,18.34-78.91-7-79.25-48.92C55.68,92.14,56.98,82.42,62,76ZM175,176c0-40.33,0-80.67,0-121c32,0,64,0,96,0c0,40.33,0,80.67,0,121c-32,0-64,0-96,0Zm-37,34c-6.9,2.16-27.66,2.95-34.62,.83C99.59,209.68,40.75,172.37,40,171c-.97-1.78-.1-8.74,0-11c4.95-.14,13.12-1.33,17.69,.05C63.7,161.87,72.38,169.44,78,173c18.93,11.97,39.88,27.66,60,37Z" fill="#FFFFFF"/>
<path d="M62,76c-5.02,6.42-6.32,16.14-6.25,24.08C56.09,142,97.87,167.34,135,149c7.99-3.95,17.41-10.16,21.89-18.27C183.78,82.11,137.53,26.55,86,52C75.59,57.14,65.74,64.54,62,76Z" fill="#D6363E"/>
<path d="M175,176c0-40.33,0-80.67,0-121c32,0,64,0,96,0c0,40.33,0,80.67,0,121c-32,0-64,0-96,0Z" fill="#2E66D6"/>
<path d="M138,210c-20.12-9.34-41.07-25.03-60-37c-5.62-3.56-14.3-11.13-20.31-12.95c-4.57-1.38-12.74-.19-17.69-.05c-.1,2.26-.97,9.22,0,11c.75,1.37,59.59,38.68,63.38,39.83c6.96,2.12,27.72,1.33,34.62-.83Z" fill="#F2B830"/>
</svg>`;

test("a closed rectangle is four anchors and no hole", () => {
  const facts = scoreSvg('<svg><path d="M0,0 H10 V10 H0 Z" fill="#000"/></svg>');
  assert.deepEqual(facts, { paths: 1, anchors: 4, holes: 0, colors: 1 });
});

test("an opposite winding ring inside a shape is one hole", () => {
  const facts = scoreSvg('<svg><path d="M0,0 H10 V10 H0 Z M2,2 V8 H8 V2 Z" fill="black"/></svg>');
  assert.equal(facts.holes, 1);
  assert.equal(facts.anchors, 8);
  assert.equal(holeNote(facts.holes), "มีรู 1 จุด");
});

test("a same-winding island is not a hole", () => {
  const facts = scoreSvg('<svg><path d="M0,0 H10 V10 H0 Z M2,2 H8 V8 H2 Z" fill="#abc"/></svg>');
  assert.equal(facts.holes, 0);
  assert.equal(facts.colors, 1);
  assert.equal(holeNote(0), null);
});

test("shorthand fills and style fills count as colors", () => {
  const facts = scoreSvg('<svg><path d="M0,0 H1 V1 Z" fill="#fff"/><path d="M2,2 H3 V3 Z" style="fill:#0F0;stroke:none"/></svg>');
  assert.equal(facts.paths, 2);
  assert.equal(facts.colors, 2);
});

test("the traced logo reports paths, anchors, holes, and colors", () => {
  const facts = scoreSvg(tracedLogo);
  assert.deepEqual(facts, { paths: 4, anchors: 34, holes: 3, colors: 4 });
  assert.equal(holeNote(facts.holes), "มีรู 3 จุด");
});
