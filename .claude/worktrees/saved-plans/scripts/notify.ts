/**
 * notify.ts
 *
 * CLI script to send email notifications to verified subscribers.
 *
 * Usage:
 *   npx tsx scripts/notify.ts --type new-term --state sc --term "Spring 2027"
 */

import { getVerifiedSubscribers } from "../lib/subscribers";
import { sendNewTermNotification } from "../lib/email";
import { isValidState } from "../lib/states/registry";

// Load .env.local for Supabase + Resend keys
import { loadEnv } from "./lib/load-env";

loadEnv();

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(): {
  type: string;
  state: string;
  term: string;
} {
  const args = process.argv.slice(2);
  const typeIdx = args.indexOf("--type");
  const stateIdx = args.indexOf("--state");
  const termIdx = args.indexOf("--term");

  if (typeIdx === -1 || stateIdx === -1 || termIdx === -1) {
    console.error(
      "Usage: npx tsx scripts/notify.ts --type new-term --state sc --term \"Spring 2027\""
    );
    process.exit(1);
  }

  return {
    type: args[typeIdx + 1],
    state: args[stateIdx + 1],
    term: args[termIdx + 1],
  };
}

async function main() {
  const { type, state, term } = parseArgs();

  if (type !== "new-term") {
    console.error(`Unknown notification type: "${type}". Supported: new-term`);
    process.exit(1);
  }

  if (!isValidState(state)) {
    console.error(`Invalid state: "${state}"`);
    process.exit(1);
  }

  console.log(`\nSending "${type}" notification for ${state}: ${term}`);

  const subscribers = await getVerifiedSubscribers(state);
  if (subscribers.length === 0) {
    console.log("No verified subscribers found. Nothing to send.");
    return;
  }

  console.log(`Found ${subscribers.length} verified subscriber(s).`);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    const batch = subscribers.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((sub) => sendNewTermNotification(sub.email, state, term, sub.token))
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        sent++;
      } else {
        failed++;
        console.error(`  Failed:`, r.reason);
      }
    }

    console.log(`  Progress: ${sent + failed}/${subscribers.length} (${sent} sent, ${failed} failed)`);

    if (i + BATCH_SIZE < subscribers.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(`\nDone. ${sent} sent, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
