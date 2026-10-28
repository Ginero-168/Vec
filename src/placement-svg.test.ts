import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { serializeSvgForIllustrator, validateSvgForPlacement } from "./placement-svg.ts";
import { writeResultSvgAtomically } from "./result-svg-file.ts";

const capturedBugSvg = readFileSync(new URL("./fixtures/bug1-result.svg", import.meta.url), "utf8");
const placementSvg = serializeSvgForIllustrator(capturedBugSvg);

test("prepares the captured Illustrator failure as a framed, editable placement SVG", () => {
  assert.equal(validateSvgForPlacement(placementSvg, capturedBugSvg).kind, "valid");
  assert.match(placementSvg, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(placementSvg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="704" height="162" viewBox="0 0 704 162">/);
  assert.match(placementSvg, /^<\?xml[^\n]+\n<svg[^>]+><rect id="vp-frame" x="0" y="0" width="704" height="162" fill="none" stroke="none"\/>/);
  assert.match(capturedBugSvg, /-23\.53/);
  assert.match(capturedBugSvg, /stroke-width="1\.9"/);
  assert.doesNotMatch(placementSvg, /<g\b|<circle\b|<ellipse\b/);
  assert.match(placementSvg, /<path d="[^"]+"/);
  const pathData = [...placementSvg.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1] ?? "");
  assert.ok(pathData.length > 0);
  for (const data of pathData) assert.doesNotMatch(data, /[AHQSTVahqstv]/);
});

test("converts relative, horizontal, vertical, smooth, quadratic, and arc commands", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"><path d="M2 2h5v5q3 3 6 0t6 0s3 -3 6 0a4 4 0 0 1 4 4z" fill="#123456"/></svg>';
  const serialized = serializeSvgForIllustrator(svg);
  assert.equal(validateSvgForPlacement(serialized).kind, "valid");
  const path = /<path d="([^"]+)"/.exec(serialized)?.[1] ?? "";
  assert.match(path, /^M2 2 L7 2 L7 7 C/);
  assert.doesNotMatch(path, /[AHQSTVahqstv]/);
  assert.match(path, /C/);
  assert.match(path, /Z$/);
});

test("flattens the trace pipeline's untransformed fill groups without changing path order", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10"><g id="color-a"><path fill="#111111" d="M0 0H2V2Z"/><path fill="#111111" d="M3 0H5V2Z"/></g><g id="color-b"><path fill="#222222" d="M6 0H8V2Z"/></g></svg>';
  const serialized = serializeSvgForIllustrator(svg);
  assert.equal(validateSvgForPlacement(serialized, svg).kind, "valid");
  assert.doesNotMatch(serialized, /<g\b/);
  const colors = [...serialized.matchAll(/fill="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(colors, ["none", "#111111", "#111111", "#222222"]);
});

test("adds the declaration once and strips a source BOM", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>';
  const withBom = serializeSvgForIllustrator("\uFEFF" + svg);
  const withDeclaration = serializeSvgForIllustrator('<?xml version="1.0" encoding="UTF-8"?>\n' + svg);
  assert.equal(withBom, withDeclaration);
  assert.equal(withBom.slice(0, withBom.indexOf("\n")), '<?xml version="1.0" encoding="UTF-8"?>');
});

test("rejects malformed, non-finite, dimensionless, unsafe, noncanonical, and stale SVG data", () => {
  assert.equal(validateSvgForPlacement(" ").kind, "invalid");
  assert.equal(validateSvgForPlacement("\uFEFF" + placementSvg).kind, "invalid");
  assert.equal(validateSvgForPlacement(placementSvg.replace("</svg>", "")).kind, "invalid");
  assert.equal(validateSvgForPlacement(placementSvg.replace('width="704"', 'width="Infinity"')).kind, "invalid");
  assert.equal(validateSvgForPlacement(placementSvg.replace('viewBox="0 0 704 162"', 'viewBox="0 0 NaN 162"')).kind, "invalid");
  assert.equal(validateSvgForPlacement(placementSvg.replace('<path d="', '<g id="color"><path d="').replace("</svg>", "</g></svg>")).kind, "invalid");
  assert.equal(validateSvgForPlacement(placementSvg.replace('<path d="', '<path style="filter:blur(2px)" d="')).kind, "invalid");
  assert.equal(validateSvgForPlacement(placementSvg.replace(" L", " h")).kind, "invalid");
  assert.equal(validateSvgForPlacement(placementSvg, capturedBugSvg.replace("-23.53", "-22.53")).kind, "invalid");
});

test("placement validation requires explicit dimensions and rejects unsupported SVG content", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>';
  const valid = serializeSvgForIllustrator(svg);
  assert.equal(validateSvgForPlacement(valid).kind, "valid");
  assert.equal(validateSvgForPlacement(valid.replace(' width="10"', "")).kind, "invalid");
  assert.equal(validateSvgForPlacement(valid.replace(' height="10"', "")).kind, "invalid");
  assert.equal(validateSvgForPlacement(valid.replace(' viewBox="0 0 10 10"', "")).kind, "invalid");
  assert.equal(validateSvgForPlacement(valid.replace('<path d="', '<path vector-effect="non-scaling-stroke" d="')).kind, "invalid");
  assert.equal(validateSvgForPlacement(valid.replace(" L10 10", " Q5 5 10 10")).kind, "invalid");
  assert.equal(validateSvgForPlacement(valid.replace(" L10 10", " LNaN 10")).kind, "invalid");
  assert.equal(validateSvgForPlacement(valid.replace(" L10 10", " LInfinity 10")).kind, "invalid");

  const pathPrefix = '<path d="M0 0 L10 10"';
  for (const command of ["H10", "V10", "Q5 5 10 10", "T10 10", "S5 5 10 10", "A2 2 0 0 1 10 10", "h10"]) {
    assert.equal(validateSvgForPlacement(valid.replace(pathPrefix, '<path d="M0 0 ' + command + '"')).kind, "invalid", command);
  }
  const allowedCommands = serializeSvgForIllustrator('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><path d="M0 0L10 0C10 0 10 10 10 10L0 10Z"/></svg>');
  assert.equal(validateSvgForPlacement(allowedCommands).kind, "valid");
});

test("result SVG writes a same-directory temporary file before renaming it", () => {
  const calls: string[] = [];
  let writtenPath = "";
  let writtenText = "";
  const svgPath = "/jobs/job-1/result.svg";
  writeResultSvgAtomically(svgPath, "run-2", capturedBugSvg, {
    writeFileSync(filePath, data, options) {
      calls.push("write");
      writtenPath = filePath;
      writtenText = data;
      assert.deepEqual(options, { encoding: "utf8", flag: "wx" });
    },
    renameSync(sourcePath, destinationPath) {
      calls.push("rename");
      assert.equal(sourcePath, writtenPath);
      assert.equal(destinationPath, svgPath);
    },
    rmSync() {
      calls.push("cleanup");
    }
  });
  assert.deepEqual(calls, ["write", "rename"]);
  assert.equal(path.dirname(writtenPath), path.dirname(svgPath));
  assert.equal(path.basename(writtenPath), "result.svg.run-2.tmp");
  assert.equal(writtenText, placementSvg);
});
