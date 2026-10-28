import { serializeSvgForIllustrator } from "./placement-svg.ts";

type AtomicWriteFileSystem = {
  writeFileSync(filePath: string, data: string, options: { readonly encoding: "utf8"; readonly flag: "wx" }): unknown;
  renameSync(sourcePath: string, destinationPath: string): unknown;
  rmSync(filePath: string, options: { readonly force: true }): unknown;
};

export function writeResultSvgAtomically(
  svgPath: string,
  jobId: string,
  svgText: string,
  fileSystem: AtomicWriteFileSystem
): void {
  const temporaryPath = svgPath + "." + jobId + ".tmp";
  try {
    fileSystem.writeFileSync(temporaryPath, serializeSvgForIllustrator(svgText), { encoding: "utf8", flag: "wx" });
    fileSystem.renameSync(temporaryPath, svgPath);
  } catch (error) {
    try { fileSystem.rmSync(temporaryPath, { force: true }); } catch (_) {}
    throw error;
  }
}
