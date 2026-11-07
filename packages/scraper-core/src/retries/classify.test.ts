import { describe, expect, it } from 'vitest';
import { classifyScraperError } from './classify.js';

function withStatus(statusCode: number): Error {
  return Object.assign(new Error(`HTTP ${statusCode} from https://www.willhaben.at/x`), {
    statusCode,
  });
}

describe('classifyScraperError', () => {
  it.each([
    ['page.goto: net::ERR_CONNECTION_RESET at https://www.willhaben.at/x', 'transient_network'],
    // The URL's "captcha" must not turn a network error into an anti-bot signal.
    ['page.goto: net::ERR_NAME_NOT_RESOLVED at https://captcha.example.at/', 'transient_network'],
    // A bare "not found" used to make these terminal, which reads as "listing gone".
    ['Price element not found', 'parse_failure'],
    ['Selector not found: #__NEXT_DATA__', 'parse_failure'],
    ['JSON-LD block not found on page', 'unknown'],
    ['Listing not found', 'terminal_page'],
  ])('classifies "%s" as %s', (message, expected) => {
    expect(classifyScraperError(new Error(message))).toBe(expected);
  });

  it.each([
    [404, 'terminal_page'],
    [403, 'soft_anti_bot'],
    [503, 'soft_anti_bot'],
    [502, 'transient_network'],
  ])('classifies statusCode %i as %s', (statusCode, expected) => {
    expect(classifyScraperError(withStatus(statusCode))).toBe(expected);
  });
});
