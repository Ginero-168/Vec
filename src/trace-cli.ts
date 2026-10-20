import * as fs from "fs";

import { parseSpec, runSelfCheck, traceFile } from "./engine";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-check")) {
    const errors = runSelfCheck();
    if (errors.length > 0) {
      console.error(errors.join("\n"));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, selfCheck: "passed" }));
    return;
  }
  const binary = arg("--binary");
  const input = arg("--input");
  const output = arg("--output");
  const specText = arg("--spec");
  if (binary === undefined || input === undefined || output === undefined || specText === undefined) {
    throw new Error("usage: trace-cli --binary --input --output --spec '{...}'");
  }
  const spec = parseSpec(JSON.parse(specText));
  const prepared = output.replace(/\.svg$/i, "") + ".prepared.png";
  const report = await traceFile({
    binary,
    inputPath: input,
    outputPath: output,
    preparedPath: prepared,
    spec
  });
  fs.writeFileSync(output + ".report.json", JSON.stringify(report));
  process.stdout.write(JSON.stringify(report) + "\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
  process.exit(1);
});
