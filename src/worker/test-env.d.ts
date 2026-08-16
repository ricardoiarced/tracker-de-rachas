declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    CREATION_RATE_LIMIT: RateLimit;
    DB: D1Database;
    REQUEST_RATE_LIMIT: RateLimit;
    SESSION_RATE_LIMIT: RateLimit;
  }
}
