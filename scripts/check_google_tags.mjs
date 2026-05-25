import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_SITE_VERIFICATION = 'eMj5B-o8zvCf4EeEdcR3iRCgsoGeBQBm_a2FMwr4atM';
const EXPECTED_GA_MEASUREMENT_ID = 'G-8WS4X0WWQQ';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = process.env.GOOGLE_TAG_GUARD_INDEX_PATH
  ? path.resolve(process.env.GOOGLE_TAG_GUARD_INDEX_PATH)
  : path.resolve(__dirname, '../web/index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const failures = [];

function getAttr(tag, attrName) {
  const attr = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match?.[1] || '';
}

const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
const verificationTags = metaTags.filter(tag => getAttr(tag, 'name') === 'google-site-verification');

if (verificationTags.length !== 1) {
  failures.push(`Expected exactly one google-site-verification meta tag, found ${verificationTags.length}.`);
} else {
  const actualVerification = getAttr(verificationTags[0], 'content');
  if (actualVerification !== EXPECTED_SITE_VERIFICATION) {
    failures.push(
      `google-site-verification changed: expected ${EXPECTED_SITE_VERIFICATION}, found ${actualVerification || '(empty)'}.`,
    );
  }
}

const measurementIds = new Set(html.match(/\bG-[A-Z0-9]+\b/g) || []);
if (measurementIds.size !== 1 || !measurementIds.has(EXPECTED_GA_MEASUREMENT_ID)) {
  failures.push(
    `GA measurement ID changed: expected only ${EXPECTED_GA_MEASUREMENT_ID}, found ${[...measurementIds].join(', ') || '(none)'}.`,
  );
}

const requiredSnippets = [
  `window.HOLOCARD_GA_ID = '${EXPECTED_GA_MEASUREMENT_ID}'`,
  `window.gtag('config', window.HOLOCARD_GA_ID, { send_page_view: false })`,
  `https://www.googletagmanager.com/gtag/js?id=' + window.HOLOCARD_GA_ID`,
  'window.holocardLoadGoogleTag = load',
];

for (const snippet of requiredSnippets) {
  if (!html.includes(snippet)) {
    failures.push(`Missing required Google tag snippet: ${snippet}`);
  }
}

if (failures.length) {
  console.error('Google tag guard failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Google tag guard passed.');
