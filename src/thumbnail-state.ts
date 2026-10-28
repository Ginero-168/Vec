export type ThumbnailState =
  | { readonly kind: "empty"; readonly generation: number }
  | { readonly kind: "loading"; readonly generation: number }
  | { readonly kind: "ready"; readonly generation: number; readonly dataUrl: string };

export type ThumbnailEvent =
  | { readonly kind: "capture-started"; readonly generation: number }
  | { readonly kind: "capture-completed"; readonly generation: number; readonly dataUrl: string }
  | { readonly kind: "capture-failed"; readonly generation: number };

export function initialThumbnailState(): ThumbnailState {
  return { kind: "empty", generation: 0 };
}

export function isCurrentThumbnailCapture(state: ThumbnailState, generation: number): boolean {
  return state.kind === "loading" && state.generation === generation;
}

export function reduceThumbnailState(state: ThumbnailState, event: ThumbnailEvent): ThumbnailState {
  switch (event.kind) {
    case "capture-started":
      return event.generation > state.generation ? { kind: "loading", generation: event.generation } : state;
    case "capture-completed":
      return isCurrentThumbnailCapture(state, event.generation)
        ? { kind: "ready", generation: event.generation, dataUrl: event.dataUrl }
        : state;
    case "capture-failed":
      return isCurrentThumbnailCapture(state, event.generation)
        ? { kind: "empty", generation: event.generation }
        : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
