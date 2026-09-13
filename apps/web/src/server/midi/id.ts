// Ids are interpolated into a source's file path, so anything that could climb
// out of it or truncate the URL is refused. Slashes are allowed because a
// source (mutopia) nests its files, but "..", a leading separator, a scheme, a
// query or a fragment are not.
const pattern = /^[A-Za-z0-9](?:[A-Za-z0-9._~/-]*[A-Za-z0-9._~-])?$/;

export function isSafeId(id: string): boolean {
  return pattern.test(id) && !id.includes("..");
}
