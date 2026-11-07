import { describe, expect, it } from 'vitest';
import { headlineText } from './headline-text.js';

describe('headlineText', () => {
  it('returns the title and h1 text, without the body text around them', () => {
    const html = `<!doctype html><html><head>
      <title>3-Zimmer-Wohnung &amp; Balkon | willhaben</title></head>
      <body><h1 class="headline">Gr&ouml;&szlig;e <span>78&nbsp;m&#178;</span></h1>
      <section><h2>&Auml;hnliche Objekte</h2><p>Diese Wohnung wurde verkauft</p></section>
      <h1>VERMIETET: Dachgeschoss</h1></body></html>`;

    expect(headlineText(html)).toBe(
      '3-Zimmer-Wohnung & Balkon | willhaben\nGröße 78 m²\nVERMIETET: Dachgeschoss',
    );
  });

  it('ignores headlines inside scripts, templates and comments', () => {
    const html = `<title>Wohnung Wien</title>
      <script>const tpl = "<h1>verkauft</h1>";</script>
      <template><h1>vermietet</h1></template>
      <!-- <h1>verkauft</h1> -->`;

    expect(headlineText(html)).toBe('Wohnung Wien');
  });
});
