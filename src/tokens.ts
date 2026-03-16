import {ExternalTokenizer, InputStream} from "@lezer/lr"
import {
  TxnHeader, PeriodicHeader, AutoHeader, Directive, BlockComment,
  LineComment, BlankLine, PostingIndent, CommentIndent, AccountName,
  CommentBody, Newline
} from "./syntax.grammar.terms"

const CH_NEWLINE = 10
const CH_SPACE = 32
const CH_TAB = 9
const CH_SEMI = 59
const CH_HASH = 35
const CH_STAR = 42
const CH_TILDE = 126
const CH_EQUALS = 61

function isDigit(ch: number) { return ch >= 48 && ch <= 57 }
function isEOL(ch: number) { return ch === CH_NEWLINE || ch < 0 }

function atLineStart(input: InputStream): boolean {
  if (input.pos === 0) return true
  return input.peek(-1) === CH_NEWLINE
}

function skipToEOL(input: InputStream, offset: number): number {
  while (true) {
    let ch = input.peek(offset)
    if (isEOL(ch)) return offset
    offset++
  }
}

function matchDate(input: InputStream, offset: number): number {
  let i = offset
  if (!isDigit(input.peek(i))) return -1

  let digitCount = 0
  while (isDigit(input.peek(i))) { i++; digitCount++ }
  if (digitCount < 1 || digitCount > 4) return -1

  let sep = input.peek(i)
  if (sep !== 45 && sep !== 47 && sep !== 46) return -1
  i++

  let mCount = 0
  while (isDigit(input.peek(i))) { i++; mCount++ }
  if (mCount < 1 || mCount > 2) return -1

  if (digitCount >= 4) {
    if (input.peek(i) !== sep) return -1
    i++
    let dCount = 0
    while (isDigit(input.peek(i))) { i++; dCount++ }
    if (dCount < 1 || dCount > 2) return -1
  } else {
    if (input.peek(i) === sep) {
      i++
      let dCount = 0
      while (isDigit(input.peek(i))) { i++; dCount++ }
      if (dCount < 1 || dCount > 2) return -1
    }
  }

  return i - offset
}

function matchKeyword(input: InputStream, offset: number, kw: string): boolean {
  for (let i = 0; i < kw.length; i++) {
    if (input.peek(offset + i) !== kw.charCodeAt(i)) return false
  }
  let after = input.peek(offset + kw.length)
  return after === CH_SPACE || after === CH_TAB || after === CH_NEWLINE || after < 0
}

function matchKeywordExact(input: InputStream, offset: number, kw: string): boolean {
  for (let i = 0; i < kw.length; i++) {
    if (input.peek(offset + i) !== kw.charCodeAt(i)) return false
  }
  let after = input.peek(offset + kw.length)
  return after === CH_NEWLINE || after < 0 || after === CH_SPACE || after === CH_TAB
}

const DIRECTIVE_KEYWORDS = [
  "account", "commodity", "payee", "tag", "include", "alias",
  "decimal-mark", "apply account", "end aliases", "end apply account",
  "end apply year", "end apply tag", "end comment", "year"
]

/// Header-level tokenizer: recognizes complete first lines of top-level entries.
export const headerTokens = new ExternalTokenizer((input) => {
  if (!atLineStart(input)) return

  let ch = input.peek(0)

  if (ch === CH_NEWLINE) {
    input.acceptToken(BlankLine, 1)
    return
  }
  if (ch < 0) return

  // Block comment
  if (matchKeyword(input, 0, "comment")) {
    let i = 7
    while (input.peek(i) === CH_SPACE || input.peek(i) === CH_TAB) i++
    if (isEOL(input.peek(i))) {
      if (input.peek(i) === CH_NEWLINE) i++
      while (true) {
        if (input.peek(i) < 0) {
          input.acceptToken(BlockComment, i)
          return
        }
        if (matchKeywordExact(input, i, "end comment")) {
          let j = i + 11
          while (input.peek(j) === CH_SPACE || input.peek(j) === CH_TAB) j++
          if (input.peek(j) === CH_NEWLINE) j++
          input.acceptToken(BlockComment, j)
          return
        }
        i = skipToEOL(input, i)
        if (input.peek(i) === CH_NEWLINE) i++
        else {
          input.acceptToken(BlockComment, i)
          return
        }
      }
    }
  }

  // Line comment
  if (ch === CH_SEMI || ch === CH_HASH || ch === CH_STAR) {
    let i = skipToEOL(input, 0)
    if (input.peek(i) === CH_NEWLINE) i++
    input.acceptToken(LineComment, i)
    return
  }

  // Periodic transaction
  if (ch === CH_TILDE) {
    let i = skipToEOL(input, 1)
    if (input.peek(i) === CH_NEWLINE) i++
    input.acceptToken(PeriodicHeader, i)
    return
  }

  // Auto posting
  if (ch === CH_EQUALS && input.peek(1) !== CH_EQUALS) {
    let i = skipToEOL(input, 1)
    if (input.peek(i) === CH_NEWLINE) i++
    input.acceptToken(AutoHeader, i)
    return
  }

  // Transaction date
  let dateLen = matchDate(input, 0)
  if (dateLen > 0) {
    let afterDate = input.peek(dateLen)
    if (afterDate === CH_SPACE || afterDate === CH_TAB || isEOL(afterDate)) {
      let i = skipToEOL(input, dateLen)
      if (input.peek(i) === CH_NEWLINE) i++
      input.acceptToken(TxnHeader, i)
      return
    }
  }

  // Single-letter directives P, D, Y
  if ((ch === 80 || ch === 68 || ch === 89) &&
      (input.peek(1) === CH_SPACE || input.peek(1) === CH_TAB)) {
    let i = skipToEOL(input, 0)
    if (input.peek(i) === CH_NEWLINE) i++
    input.acceptToken(Directive, i)
    return
  }

  // Multi-word directives
  for (let kw of DIRECTIVE_KEYWORDS) {
    if (matchKeyword(input, 0, kw)) {
      let i = skipToEOL(input, kw.length)
      if (input.peek(i) === CH_NEWLINE) i++
      input.acceptToken(Directive, i)
      return
    }
  }

  // Unknown non-indented line - treat as comment
  if (ch !== CH_SPACE && ch !== CH_TAB) {
    let i = skipToEOL(input, 0)
    if (input.peek(i) === CH_NEWLINE) i++
    input.acceptToken(LineComment, i)
    return
  }
}, {contextual: false})


/// Posting-level tokenizer: PostingIndent, CommentIndent, Newline.
export const postingTokens = new ExternalTokenizer((input) => {
  let ch = input.peek(0)

  if (ch === CH_NEWLINE) {
    input.acceptToken(Newline, 1)
    return
  }
  if (ch < 0) {
    input.acceptToken(Newline, 0)
    return
  }

  if (atLineStart(input) && (ch === CH_SPACE || ch === CH_TAB)) {
    let i = 0
    while (input.peek(i) === CH_SPACE || input.peek(i) === CH_TAB) i++
    let next = input.peek(i)
    if (isEOL(next)) return

    if (next === CH_SEMI) {
      input.acceptToken(CommentIndent, i)
    } else {
      input.acceptToken(PostingIndent, i)
    }
    return
  }
}, {contextual: true})

/// Comment body tokenizer: everything to end of line. Only matches after CommentMark.
export const commentBodyToken = new ExternalTokenizer((input, stack) => {
  if (!stack.canShift(CommentBody)) return
  let i = 0
  while (!isEOL(input.peek(i))) i++
  if (i > 0) {
    input.acceptToken(CommentBody, i)
  }
}, {contextual: true})

/// Account name tokenizer: consumes chars until 2+ spaces, tab, semicolon, or EOL.
export const accountNameToken = new ExternalTokenizer((input) => {
  let i = 0
  let lastNonSpace = -1

  while (true) {
    let ch = input.peek(i)
    if (isEOL(ch)) break
    if (ch === CH_SEMI) break
    if (ch === CH_TAB) break

    if (ch === CH_SPACE) {
      let j = i
      while (input.peek(j) === CH_SPACE) j++
      if (j - i >= 2) break
      let after = input.peek(j)
      if (after === CH_SEMI || after === CH_TAB || isEOL(after)) break
      i = j
      continue
    }

    lastNonSpace = i
    i++
  }

  let end = lastNonSpace + 1
  if (end > 0) {
    input.acceptToken(AccountName, end)
  }
}, {contextual: true})
