export type IllustratorBounds = readonly [left: number, top: number, right: number, bottom: number];

export type FramePlacementTransform = {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly translateX: number;
  readonly translateY: number;
};

/** Return the nonuniform scale and document-origin translation that maps a frame onto target bounds. */
export function framePlacementTransform(frameBounds: IllustratorBounds, targetBounds: IllustratorBounds): FramePlacementTransform {
  const values = [...frameBounds, ...targetBounds];
  if (values.some((value) => !Number.isFinite(value))) throw new RangeError("Placement bounds must be finite");
  const frameWidth = frameBounds[2] - frameBounds[0];
  const frameHeight = frameBounds[1] - frameBounds[3];
  const targetWidth = targetBounds[2] - targetBounds[0];
  const targetHeight = targetBounds[1] - targetBounds[3];
  if (frameWidth <= 0 || frameHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    throw new RangeError("Placement bounds must have positive width and height");
  }
  const scaleX = targetWidth / frameWidth;
  const scaleY = targetHeight / frameHeight;
  return {
    scaleX,
    scaleY,
    translateX: targetBounds[0] - frameBounds[0] * scaleX,
    translateY: targetBounds[1] - frameBounds[1] * scaleY
  };
}
