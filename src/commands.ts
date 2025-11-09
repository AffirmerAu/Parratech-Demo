export type CommandAction =
  | { action: 'NEXT' }
  | { action: 'REPLAY' }
  | { action: 'SHOW'; id: string };

const NEXT_REGEX = /\[SHOW:NEXT\]/i;
const REPLAY_REGEX = /\[REPLAY\]/i;
const SHOW_REGEX = /\[SHOW:([^\]]+)\]/i;

export function parse(text: string): CommandAction | null {
  if (!text) return null;

  if (NEXT_REGEX.test(text)) {
    return { action: 'NEXT' };
  }

  if (REPLAY_REGEX.test(text)) {
    return { action: 'REPLAY' };
  }

  const match = text.match(SHOW_REGEX);
  if (match && match[1]) {
    const id = match[1].trim();
    if (id.length > 0) {
      if (id.toUpperCase() === 'NEXT') {
        return { action: 'NEXT' };
      }
      return { action: 'SHOW', id };
    }
  }

  return null;
}
