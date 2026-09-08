import fs from 'node:fs';

const app = fs.readFileSync('web/app.js', 'utf8');
const workflow = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const hook = fs.readFileSync('.githooks/pre-commit', 'utf8');

const requiredEvents = [
  'deck_open',
  'guide_open',
  'decklog_click',
  'source_guide_click',
  'pwa_install_accept',
  'pwa_installed',
];

const failures = [];

for (const eventName of requiredEvents) {
  if (!app.includes(`'${eventName}'`)) {
    failures.push(`Missing GA key-event candidate: ${eventName}`);
  }
}

const requiredMarkers = [
  "trackGaEvent(openEventName",
  "trackKeyOutboundLink(link, url)",
  "data-ga-link=\"source_guide\"",
  "data-ga-link=\"decklog\"",
  "trackGaEvent('pwa_install_accept'",
  "trackGaEvent('pwa_installed'",
];

for (const marker of requiredMarkers) {
  if (!app.includes(marker) && !fs.readFileSync('web/components/deck-view.js', 'utf8').includes(marker) && !fs.readFileSync('web/components/tournament-view.js', 'utf8').includes(marker)) {
    failures.push(`Missing GA key-event marker: ${marker}`);
  }
}

if (!workflow.includes('node scripts/check_key_ga_events.mjs')) {
  failures.push('Deploy workflow must run key GA event contract check.');
}

if (!hook.includes('node scripts/check_key_ga_events.mjs')) {
  failures.push('Pre-commit hook must run key GA event contract check.');
}

// Every event name web/app.js emits must be documented in docs/analytics-events.md.
const eventsDoc = fs.readFileSync('docs/analytics-events.md', 'utf8');
const emittedEvents = new Set(requiredEvents);
for (const match of app.matchAll(/track(?:GaEvent|ContentOpen)\('([a-z_]+)'/g)) {
  emittedEvents.add(match[1]);
}
for (const eventName of emittedEvents) {
  if (!eventsDoc.includes(`\`${eventName}\``)) {
    failures.push(`Event ${eventName} is emitted by web/app.js but missing from docs/analytics-events.md`);
  }
}

if (failures.length) {
  console.error('GA key event contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('GA key event contract passed.');
