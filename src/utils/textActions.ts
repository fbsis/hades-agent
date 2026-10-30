import type { SelectedTextPayload, TextActionKind } from '../types/electron';

export function shouldAutoReplace(action: TextActionKind, capture: SelectedTextPayload): boolean {
  return Boolean(capture.canReplace && capture.selectionId && action !== 'summarize' && action !== 'explain');
}
