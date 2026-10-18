// Homepage Worker. Requests that match a file in dist-site/ (the homepage, also with a query string) are answered by
// Cloudflare before this script runs. Everything else lands here and goes on to the origin unchanged.
export default {
  fetch: (request) => fetch(request),
};
