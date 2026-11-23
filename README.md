# Lumen PWA

Cloudflare Worker `lumen-go-pwa`. The original editable repository was not available. The `base/` directory contains the assets and Worker recovered from Cloudflare production version 53. New code lives under `client/` and `worker/`. The build applies verified changes to the recovered bundles to retain the existing login, conversation history, settings, Markdown display, and IndexedDB records.

## Lumen reading interface

Lumen has an original reading layout with paper and pine colors, serif text for replies, a left-aligned home screen, and a split navigation layout on desktop. EPUB can be selected through the file picker or dropped into the desktop composer. Model and chapter pickers leave the draft in place and respond to Escape, backdrop clicks, or a downward drag. Animations respect the reduced-motion preference.

The existing Cloudflare API serves the EPUB, model, and conversation flows. The design does not require a new runtime dependency.

## Build and verify

1. Run `npm ci`.
2. Run `python3 tools/build.py`. This produces the Worker entry point in `built/worker.mjs` and the PWA assets in `public/`.
3. Start the local test server with `node tools/local.mjs`. The local service simulates the model providers and uses `local-test-only` as the test login.
4. Run `python3 tools/smoke.py` with Playwright and Chromium installed. Set `LUMEN_CHROME` to the path of a different Chromium binary if needed.

The browser test exercises the EPUB API, downloading the Markdown, a long book with markers in each chapter, token totals, automatic model discovery after a provider change, three provider response formats, and seven viewport widths.

## Behavior

EPUBs are converted on the Worker in EPUB reading order. The app keeps the converted text in the device's existing IndexedDB database and lets the user download it as Markdown. The EPUB upload limit is 16 MiB and the converted Markdown limit is 4 MiB. An upload fails on a missing chapter rather than reporting a complete conversion. Image-only sections are reported when text cannot be extracted.

When the model context can accommodate the requested source, the app sends the full Markdown for the requested scope. For longer material, it sends every segment in that scope in batches and passes the resulting notes to the final answer. The final response therefore receives analysis notes for books above the model context limit. The chosen model provider receives the text required for the request.

The usage counter records input and output reported by the provider, including intermediate book analysis requests. It is stored on the current device. Requests that did not return usage are counted separately in Settings.

## Deployment

Copy `wrangler.example.jsonc` to `wrangler.jsonc` and replace the Worker name and KV namespace ID with your own values. Configure `APP_ACCESS_TOKEN` and `OPENCODE_GO_API_KEY` as Cloudflare Worker secrets, and set the provider URL and model for your environment. Build the project before publishing with Wrangler.
