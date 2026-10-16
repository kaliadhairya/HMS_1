// Multilingual PDF text (completion C2). PDFKit's built-in Helvetica has no
// Indian scripts, so a patient name or instruction written in Hindi, Gujarati,
// Tamil and so on printed as nothing. enableUnicode(doc) registers the
// bundled Noto fonts (assets/fonts, SIL OFL 1.1) and makes doc.text() print
// each run of an Indian script in that script's font, keeping the document's
// Latin font, size, position and options for everything else. PDFKit shapes
// the text (conjuncts, vowel signs) through fontkit.
const fs = require('node:fs');
const path = require('node:path');

type Doc = {
  registerFont(name: string, src: string): unknown;
  font(name: string, ...rest: unknown[]): Doc;
  text(text: unknown, ...args: unknown[]): Doc;
};
type Run = { text: string; family: string | null };

const DIR = path.join(__dirname, '..', 'assets', 'fonts');
const SCRIPTS: Array<[RegExp, string]> = [
  [/[ऀ-ॿ꣠-ꣿ]/, 'NotoSansDevanagari'],
  [/[ঀ-৿]/, 'NotoSansBengali'],
  [/[਀-੿]/, 'NotoSansGurmukhi'],
  [/[઀-૿]/, 'NotoSansGujarati'],
  [/[଀-୿]/, 'NotoSansOriya'],
  [/[஀-௿]/, 'NotoSansTamil'],
  [/[ఀ-౿]/, 'NotoSansTelugu'],
  [/[ಀ-೿]/, 'NotoSansKannada'],
  [/[ഀ-ൿ]/, 'NotoSansMalayalam'],
];
const INDIC = /[ऀ-ൿ꣠-ꣿ]/;
// Characters that belong to whichever run they sit in: spaces, digits,
// punctuation, and the joiners Indian scripts use inside words.
const NEUTRAL = /[\s\d.,:;!?()\-/'"‌‍।॥]/;

function familyOf(ch: string): string | null {
  for (const [re, family] of SCRIPTS) if (re.test(ch)) return family;
  return null;
}

// Splits text into runs of one script; neutral characters join the run they follow.
function runs(text: string): Run[] {
  const out: Run[] = [];
  for (const ch of text) {
    const family = NEUTRAL.test(ch) && out.length ? out[out.length - 1].family : familyOf(ch);
    const last = out[out.length - 1];
    if (last && last.family === family) last.text += ch;
    else out.push({ text: ch, family });
  }
  return out;
}

const available = (file: string): boolean => fs.existsSync(path.join(DIR, `${file}.ttf`));

function enableUnicode(doc: Doc): Doc {
  for (const [, family] of SCRIPTS) {
    for (const weight of ['Regular', 'Bold']) {
      const file = available(`${family}-${weight}`) ? `${family}-${weight}` : `${family}-Regular`;
      if (available(file)) doc.registerFont(`${family}-${weight}`, path.join(DIR, `${file}.ttf`));
    }
  }
  const font = doc.font.bind(doc);
  const text = doc.text.bind(doc);
  let latin = 'Helvetica';
  doc.font = (name: string, ...rest: unknown[]) => { latin = name; return font(name, ...rest); };
  doc.text = (value: unknown, ...args: unknown[]) => {
    if (typeof value !== 'string' || !INDIC.test(value)) return text(value, ...args);
    const bold = /bold/i.test(latin);
    const positioned = typeof args[0] === 'number';
    const options = ((positioned ? args[2] : args[0]) || {}) as Record<string, unknown>;
    const parts = runs(value);
    parts.forEach((part, i) => {
      font(part.family ? `${part.family}-${bold ? 'Bold' : 'Regular'}` : latin);
      const last = i === parts.length - 1;
      const o = { ...(i === 0 ? options : {}), continued: last ? Boolean(options.continued) : true };
      if (i === 0 && positioned) text(part.text, args[0], args[1], o);
      else text(part.text, o);
    });
    font(latin);
    return doc;
  };
  return doc;
}

module.exports = { enableUnicode, runs, familyOf };
