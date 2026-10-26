import { createGithubClient, type GithubClient } from './github-api.js';
import { newPollState, pollOnce } from './poller.js';
import { createReceiverServer } from './receiver.js';
import { fixtureClient, replayPoll, replayWebhooks } from './replay.js';
import { createSink, keyTrust } from './sink.js';

const USAGE = [
  'usage: debrief-witness-github <webhook | poll | replay>',
  '  webhook  receive GitHub webhooks (GITHUB_WEBHOOK_SECRET; optional GITHUB_TOKEN adds job counts)',
  '  poll     read the REST API on a timer (GITHUB_TOKEN, GITHUB_REPOS=owner/name,...)',
  '  replay   post the recorded fixtures through both paths (needs only the Debrief variables)',
  'env: DEBRIEF_API_URL (default http://localhost:4000), DEBRIEF_API_KEY, GITHUB_API_URL',
  '     GITHUB_WEBHOOK_PORT (8787), GITHUB_POLL_INTERVAL_S (60)',
  '',
].join('\n');

const log = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

function fail(message: string): never {
  log(`${message}\n${USAGE}`);
  process.exit(2);
}

const env = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
};

const mode = process.argv[2];
const apiKey = env('DEBRIEF_API_KEY') ?? fail('DEBRIEF_API_KEY is required');
const debrief = { apiUrl: env('DEBRIEF_API_URL') ?? 'http://localhost:4000', apiKey };
const sink = createSink(debrief);

try {
  const trust = await keyTrust(debrief);
  if (trust !== 'third-party') {
    fail(
      `DEBRIEF_API_KEY holds ${String(trust)} trust; GitHub events need a third-party key (D-084)`,
    );
  }
} catch (error) {
  log(`could not read the key's trust (${String(error)}); a key below third-party will be refused`);
}

const token = env('GITHUB_TOKEN');
const client: GithubClient | undefined =
  token === undefined
    ? undefined
    : createGithubClient({
        token,
        log,
        ...(env('GITHUB_API_URL') ? { apiUrl: env('GITHUB_API_URL') } : {}),
      });

if (mode === 'replay') {
  const web = await replayWebhooks(sink, fixtureClient());
  log(`webhooks: ${String(web.accepted)} stored, ${String(web.duplicates)} duplicate`);
  const poll = await replayPoll(sink);
  log(`poller: ${String(poll.accepted)} stored, ${String(poll.duplicates)} duplicate`);
} else if (mode === 'webhook') {
  const secret = env('GITHUB_WEBHOOK_SECRET') ?? fail('GITHUB_WEBHOOK_SECRET is required');
  const port = Number(env('GITHUB_WEBHOOK_PORT') ?? '8787');
  createReceiverServer({
    secret,
    sink,
    log,
    ...(client === undefined ? {} : { github: client }),
  }).listen(port, () => {
    log(`github witness listening on :${String(port)}/webhook`);
  });
} else if (mode === 'poll') {
  if (client === undefined) fail('GITHUB_TOKEN is required');
  const repos = (env('GITHUB_REPOS') ?? fail('GITHUB_REPOS is required'))
    .split(',')
    .map((repo) => repo.trim())
    .filter((repo) => repo !== '');
  const seconds = Number(env('GITHUB_POLL_INTERVAL_S') ?? '60');
  const state = newPollState();
  const tick = async (): Promise<void> => {
    let pause = seconds;
    try {
      const outcome = await pollOnce(client, sink, repos, state);
      log(`poll: ${String(outcome.accepted)} stored, ${String(outcome.duplicates)} duplicate`);
      for (const error of outcome.errors) log(`poll: ${error}`);
      pause = Math.max(seconds, outcome.retryAfterS ?? 0);
    } catch (error) {
      log(`poll: ${String(error)}`);
    }
    setTimeout(() => {
      void tick();
    }, pause * 1000);
  };
  await tick();
} else {
  fail('choose webhook, poll or replay');
}
