const FALLBACK_THOUGHTS = [
  // RPG flavor
  'The realm is peaceful today...',
  'I serve the {kingdom} kingdom faithfully',
  'Another day in {city}...',
  'These are prosperous times...',
  'I wonder what lies beyond the border...',
  'The buildings grow taller every day',
  'So many stars in the sky tonight...',
  'I heard a new citizen arrived recently',
  'The kingdom grows stronger each day',
  'What a time to be alive in {kingdom}...',
  // Dev inside jokes
  'I should commit more often...',
  'The code compiles. Life is good.',
  'It works on my machine...',
  'Have you tried turning it off and on?',
  'TODO: add thought here',
  'Mass-assigned to null. Send help.',
  '// this should never happen',
  'git push --force and pray',
  'My PR has been open for 47 days...',
  'Whoever wrote this code... oh wait, it was me',
  'Is it a bug or a feature? Yes.',
  'I dream in {kingdom} syntax',
  'One does not simply merge to main',
  'I swear this worked yesterday',
  'rm -rf node_modules && npm install',
  'Segfault? In this economy?',
  'undefined is not a function of my patience',
  'Tabs vs spaces? We settle this at dawn.',
  '404: thought not found',
  'My code review comments go unread...',
  'Still waiting on that dependency update',
  'The tests pass. Ship it!',
  'Rebasing is just time travel for code',
  'They said {kingdom} was the future...',
  'Why is the CI pipeline failing again',
];

export function getThought(
  commitMessage: string | undefined | null,
  kingdom: string,
  city: string,
): string {
  if (commitMessage && commitMessage.trim().length > 0) {
    return commitMessage.length > 40
      ? commitMessage.slice(0, 37) + '...'
      : commitMessage;
  }
  const template = FALLBACK_THOUGHTS[Math.floor(Math.random() * FALLBACK_THOUGHTS.length)];
  return template.replace('{kingdom}', kingdom).replace('{city}', city);
}

export function getFullThought(
  commitMessage: string | undefined | null,
  kingdom: string,
  city: string,
): string {
  if (commitMessage && commitMessage.trim().length > 0) {
    return commitMessage;
  }
  const template = FALLBACK_THOUGHTS[Math.floor(Math.random() * FALLBACK_THOUGHTS.length)];
  return template.replace('{kingdom}', kingdom).replace('{city}', city);
}
