// App-shell cache so the tablets still open the app with no signal.
const CACHE_PREFIX = "boord-packhouse-";
const CACHE = "boord-packhouse-v2";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./shared/styles.css",
  "./shared/api.js",
  "./shared/sw-core.js",
  "./shared/tailwind.js",
  "./shared/vendor/fontawesome/css/all.min.css",
  "./shared/vendor/fontawesome/webfonts/fa-solid-900.woff2",
];

// Install/activate/fetch handling is Boord's - see shared/sw-core.js.
importScripts("./shared/sw-core.js");
