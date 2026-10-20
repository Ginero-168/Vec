// These are budgets from docs/roadmap-th.md, not measured timings.
// §7 and §8 call 4 MP the preview size. §8 calls 20 MP the post-beta target.
export const MAX_TRACE_PIXELS = 4000000;
export const MAX_DECODE_PIXELS = 20000000;
export const TARGET_CAPTURE_PPI = 144;

// Relative tolerance for "did the placed box crop the file?" A stretched
// image fails this and takes the capture path, which still fits the result
// to the placed box. An equal crop on every side keeps the aspect and is
// not detected here.
export const ASPECT_TOLERANCE = 0.02;
