/** One writer owns an element's transform, including its associated listeners. */
export const perspectiveOwners = new WeakMap<HTMLElement, { dispose(): void }>();
