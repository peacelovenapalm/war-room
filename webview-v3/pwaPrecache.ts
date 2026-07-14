/**
 * Keep the offline app shell without pulling every dynamic-import chunk into
 * Workbox's install-time precache. Vite writes every JavaScript module needed
 * for the initial render into index.html as a script or modulepreload URL;
 * deferred panels are deliberately absent from that document.
 */
export function retainStaticShellPrecacheEntries<T extends { url: string }>(
  entries: readonly T[],
  indexHtml: string,
): T[] {
  const shellScripts = new Set(
    [...indexHtml.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="\.\/([^"]+\.js)"[^>]*>/g)]
      .map((match) => match[1])
      .filter((url): url is string => url !== undefined),
  );

  return entries.filter((entry) => !entry.url.endsWith('.js') || shellScripts.has(entry.url));
}
