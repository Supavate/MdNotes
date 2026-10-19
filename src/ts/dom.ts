export function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
