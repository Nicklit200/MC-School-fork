/** QR links enter through / because the public host may not serve SPA paths. */
export function phoneCameraEntryRoute(pathname: string, search: string, hash: string): string | null {
  if (pathname !== '/') return null;
  const params = new URLSearchParams(search);
  if (params.get('mindcraftiCamera') !== '1') return null;
  params.delete('mindcraftiCamera');
  const query = params.toString();
  // Pairing secrets stay in the fragment, never in a server-visible query.
  return `/phone-camera${query ? `?${query}` : ''}${hash}`;
}
