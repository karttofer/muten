// Lexer: .muten source text → a flat token stream (each token carries its start index).
// Kept separate from the parser so each file stays focused (and under the size limit).
// All matched characters/operators come from vocab (Tk/Pn): no magic strings.

import { Tk, Pn } from '#engine/shared/vocab.js';
import { ParseError } from '#engine/shared/diagnostics.js';
import type { Token, Loc } from '#engine/shared/types.js';

const PUNCT_CHARS = Object.values(Pn).join(''); // the single-char punctuation set

// two-character operators, matched (as a table) before single-char punctuation.
const OPERATORS: Array<[string, Tk]> = [
  ['->', Tk.Arrow], ['<-', Tk.LArrow], ['==', Tk.Eq], ['=>', Tk.FatArrow],
  ['!=', Tk.Neq], ['<=', Tk.Lte], ['>=', Tk.Gte],
];

// character classes (named, so the scanners read like prose).
const isSpace = (char: string): boolean => char === ' ' || char === '\t' || char === '\r' || char === '\n';
const isDigit = (char: string): boolean => char >= '0' && char <= '9';
const isWordStart = (char: string): boolean => (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_';
const isWord = (char: string): boolean => isWordStart(char) || isDigit(char);

// 1-based line/col for a source index (used when the lexer hits a bad character).
function locFromIndex(source: string, index: number): Loc {
  let line = 1, col = 1;
  for (let scan = 0; scan < index && scan < source.length; scan++) { if (source[scan] === '\n') { line++; col = 1; } else col++; }
  return { line, col };
}

// The Lexer holds the cursor (source + index + tokens) and one scan method per token shape,
// so the main loop is a flat dispatch instead of a growing chain of inline scanners.
class Lexer {
  private index = 0;
  private readonly tokens: Token[] = [];
  constructor(private readonly source: string) {}

  tokenize(): Token[] {
    const { source } = this;
    while (this.index < source.length) {
      const start = this.index;
      const char = source[this.index];
      if (isSpace(char)) { this.index++; continue; }
      if (char === '#') { this.skipComment(); continue; }
      if (char === '"') { this.scanString(start); continue; }
      if (char === '@') { this.scanSigil(start, Tk.Ref, '@'); continue; }   // @state
      if (char === '$') { this.scanSigil(start, Tk.Param, ''); continue; }  // $partParam
      if (this.scanOperator(start)) continue;                              // ->, <-, ==, =>, !=, <=, >=
      if (isDigit(char) || (char === Pn.Dash && isDigit(source[this.index + 1]))) { this.scanNumber(start); continue; }
      if (PUNCT_CHARS.includes(char)) { this.push(Tk.Punct, char, start); this.index++; continue; }
      if (isWordStart(char)) { this.scanWord(start); continue; }           // ident / keyword
      throw new ParseError(`unexpected character ${JSON.stringify(char)}`, locFromIndex(source, this.index));
    }
    this.push(Tk.Eof, '', this.index);
    return this.tokens;
  }

  private push(kind: Tk, value: string, pos: number): void { this.tokens.push({ t: kind, v: value, pos }); }

  private skipComment(): void { while (this.index < this.source.length && this.source[this.index] !== '\n') this.index++; }

  // "...": read until the closing quote.
  private scanString(start: number): void {
    const { source } = this; let end = this.index + 1; let value = '';
    while (end < source.length && source[end] !== '"') { value += source[end]; end++; }
    this.push(Tk.String, value, start); this.index = end + 1;
  }

  // a sigil (@ / $) followed by an identifier → a ref or part-param token.
  private scanSigil(start: number, kind: Tk, prefix: string): void {
    const { source } = this; let end = this.index + 1; let name = '';
    while (end < source.length && isWord(source[end])) { name += source[end]; end++; }
    this.push(kind, prefix + name, start); this.index = end;
  }

  // a two-char operator from OPERATORS; returns false (no advance) if none matches here.
  private scanOperator(start: number): boolean {
    const pair = this.source.slice(this.index, this.index + 2);
    const op = OPERATORS.find(([text]) => text === pair);
    if (!op) return false;
    this.push(op[1], pair, start); this.index += 2;
    return true;
  }

  // integer or decimal (leading '-' allowed): consume digits, then an optional .digits.
  private scanNumber(start: number): void {
    const { source } = this; let end = this.index + (source[this.index] === Pn.Dash ? 1 : 0);
    while (end < source.length && isDigit(source[end])) end++;
    if (source[end] === Pn.Dot) { end++; while (end < source.length && isDigit(source[end])) end++; }
    this.push(Tk.Number, source.slice(this.index, end), start); this.index = end;
  }

  // an identifier or keyword (letters/digits/_).
  private scanWord(start: number): void {
    const { source } = this; let end = this.index;
    while (end < source.length && isWord(source[end])) end++;
    this.push(Tk.Ident, source.slice(this.index, end), start); this.index = end;
  }
}

export function tokenize(source: string): Token[] { return new Lexer(source).tokenize(); }
