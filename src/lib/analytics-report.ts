/** Where every route in this app lives. */
export const apiBase = "/api";

/** Where the player tells the server how a render went, since encoding happens
 * in the browser and the server never sees it otherwise. The route and the page
 * that posts to it both read this. */
export const renderReportPath = "/events/render";
export const renderReportUrl = `${apiBase}${renderReportPath}`;

/** The address table analytics reads, relative to the directory the server runs
 * in. `next.config.ts` is what copies it into the standalone output and
 * `analytics/track.ts` is what opens it. */
export const countryTableFile =
  "node_modules/@ip-location-db/dbip-country-mmdb/dbip-country.mmdb";
