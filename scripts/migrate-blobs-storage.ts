/**
 * Copy the uploaded bytes from this machine into object storage.
 *
 * Why this exists: `scripts/migrate-to-postgres.ts` moves the *rows* — the file ids,
 * names, types, sizes and the sha256 each one is addressed by — and moves no bytes at
 * all, because bytes were never in the database. The blobs are in `data/uploads` on the
 * laptop. A hosted deployment with the rows and no objects serves a 404 for every image
 * on every page.
 *
 * Three decisions worth knowing:
 *
 * 1. **Content-addressed, so it is a copy and never a rewrite.** The key is
 *    `w/<workspace>/<sha256>` and the sha256 is already in the row, so the object this
 *    writes is the object `serve` will look for. Nothing is renamed, nothing is hashed
 *    again, and the row is not touched.
 *
 * 2. **Idempotent, and it says so.** An object already in the bucket is skipped, so a
 *    second run reports "already there" for everything and uploads nothing. That is the
 *    same standard the row migration meets.
 *
 * 3. **A missing local blob is reported, not invented.** If the bytes are not on disk
 *    this prints the id and the hash and moves on. Uploading a placeholder would turn a
 *    known gap into a broken image nobody could account for.
 *
 * Usage:
 *   tsx scripts/migrate-blobs-storage.ts --dry-run
 *   tsx scripts/migrate-blobs-storage.ts
 *   tsx scripts/migrate-blobs-storage.ts --dir /path/to/uploads
 *
 * Reads the same environment as the app: `DATABASE_URL` for the rows, and the
 * `RASPBERRY_S3_*` / `AWS_*` variables for the bucket.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../src/server/database";
import { blobKey, blobs, readS3Config, storageConfigured, uploadsDir } from "../src/server/storage";

type Args = { dryRun: boolean; dir: string };

function parse(argv: string[]): Args {
  const dirFlag = argv.indexOf("--dir");
  return {
    dryRun: argv.includes("--dry-run"),
    dir: dirFlag === -1 ? uploadsDir() : argv[dirFlag + 1]!,
  };
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (!storageConfigured()) {
    throw new Error(
      "No object storage is configured, so there is nowhere to copy to. " +
        "Set RASPBERRY_S3_BUCKET, RASPBERRY_S3_ENDPOINT, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.",
    );
  }
  const config = readS3Config()!;
  const store = blobs();
  console.log(`\nFrom ${args.dir}\nTo   ${config.endpoint}/${config.bucket} (${config.region})\n`);

  const database = await openDatabase();
  let rows: Record<string, unknown>[] = [];
  try {
    rows = (await database.transaction(async (sql) =>
      sql.query("SELECT id, workspace_id, sha256, name, size FROM files ORDER BY created_at"),
    )) as Record<string, unknown>[];
  } finally {
    await database.close();
  }

  let uploaded = 0;
  let present = 0;
  const missing: string[] = [];

  for (const row of rows) {
    const key = blobKey(String(row.workspace_id), String(row.sha256));
    const local = join(args.dir, String(row.sha256));
    if (await store.head(key)) {
      present += 1;
      continue;
    }
    if (!existsSync(local)) {
      missing.push(`${String(row.id)}  ${String(row.name)}  ${String(row.sha256)}`);
      continue;
    }
    if (args.dryRun) {
      uploaded += 1;
      continue;
    }
    await store.put(key, local, String(row.sha256));
    uploaded += 1;
    console.log(`  uploaded ${String(row.name)} (${Number(row.size)} bytes)`);
  }

  console.log(args.dryRun ? "\nDry run — nothing written.\n" : "\nDone.\n");
  console.log(`  ${String(rows.length).padStart(6)} file rows`);
  console.log(`  ${String(present).padStart(6)} already in storage`);
  console.log(`  ${String(uploaded).padStart(6)} ${args.dryRun ? "would be uploaded" : "uploaded"}`);
  if (missing.length) {
    console.log(`  ${String(missing.length).padStart(6)} bytes not found on this machine:`);
    for (const line of missing) console.log(`         ${line}`);
    console.log(`\n  Put those blobs in ${args.dir} and run again — the row is already in the database.`);
  }
  if (!args.dryRun && !missing.length) console.log("\nRe-run to confirm idempotence: it must upload nothing.");
}

await main();
