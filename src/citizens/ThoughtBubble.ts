const FALLBACK_THOUGHTS = [
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
  'I should commit more often...',
  'The code compiles. Life is good.',
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
