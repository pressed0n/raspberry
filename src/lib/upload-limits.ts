/**
 * The size at which an upload stops travelling through the app.
 *
 * Vercel refuses a function request body over **4.5 MB** at the platform edge — before
 * any handler runs — so no limit the app sets can rescue a larger file posted to
 * `/api/files`. Above this threshold the browser PUTs the bytes straight into object
 * storage and reports back to `/api/files/complete`.
 *
 * 3.5 MB, not 4.5 MB: the ceiling counts headers too, and a photo that fails at 4.49 MB
 * with a platform error is worse than one that takes the direct path a megabyte early.
 *
 * This lives in `src/lib` because both halves need it and they must agree: the server
 * decides what it will accept, the client decides which door to knock on. Importing the
 * server module from a component would drag `node:crypto` into the browser bundle.
 */
export const DIRECT_UPLOAD_THRESHOLD = 3.5 * 1024 * 1024;
