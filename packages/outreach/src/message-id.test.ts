import { describe, expect, it } from 'vitest';
import { extractMessageIds } from './message-id.js';

describe('extractMessageIds', () => {
  // Some clients fold References without spaces; a whitespace split read this as one bogus ID.
  it('reads back-to-back bracketed IDs, drops comments and duplicates', () => {
    expect(extractMessageIds('<a@x.at><b@y.at> (reply to Max) <a@x.at>')).toEqual([
      'a@x.at',
      'b@y.at',
    ]);
  });

  it('reads bare IDs and arrays', () => {
    expect(extractMessageIds(['a@x.at b@y.at', '<c@z.at>'])).toEqual([
      'a@x.at',
      'b@y.at',
      'c@z.at',
    ]);
  });
});
