import {StreamLanguage, LanguageSupport, StreamParser, foldService, indentService} from "@codemirror/language"
import {Completion, CompletionContext, CompletionResult} from "@codemirror/autocomplete"

interface HledgerState {
  inBlockComment: boolean
  expectIndented: boolean
  lineType: string
  linePos: string
  directiveKw: string
}

function startState(): HledgerState {
  return {
    inBlockComment: false,
    expectIndented: false,
    lineType: "",
    linePos: "",
    directiveKw: "",
  }
}

const dateRe = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/
const shortDateRe = /^\d{1,2}[-/.]\d{1,2}/
const secondaryDateRe = /^=\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/
const secondaryShortDateRe = /^=\d{1,2}[-/.]\d{1,2}/

function tokenInlineComment(stream: any, _state: HledgerState): string {
  stream.skipToEnd()
  return "comment"
}

function tokenAmount(stream: any): string | null {
  // Try commodity symbol before number (e.g., $100)
  if (stream.match(/^"[^"]*"/)) return "unit"
  if (stream.match(/^[A-Z][A-Za-z0-9_]*(?=[\s;$0-9\-+.,]|$)/)) return "unit"
  if (stream.match(/^[$€£¥₹₽₿₩₪₺₴₦₡₣₤₧₨]/)) return "unit"

  // Sign
  if (stream.match(/^[-+]/)) return "operator"

  // Number
  if (stream.match(/^[\d][\d,. ]*/)) return "number"

  // Commodity symbol after number
  if (stream.match(/^"[^"]*"/)) return "unit"
  if (stream.match(/^[A-Z][A-Za-z0-9_]*/)) return "unit"
  if (stream.match(/^[$€£¥₹₽₿₩₪₺₴₦₡₣₤₧₨]/)) return "unit"

  return null
}

function tokenTxnHeader(stream: any, state: HledgerState): string | null {
  if (stream.eatSpace()) return null

  switch (state.linePos) {
    case "afterDate":
      // Secondary date
      if (stream.match(secondaryDateRe) || stream.match(secondaryShortDateRe)) {
        return "meta"
      }
      state.linePos = "status"
      return tokenTxnHeader(stream, state)

    case "status":
      if (stream.eat("*") || stream.eat("!")) {
        state.linePos = "code"
        return "keyword"
      }
      state.linePos = "code"
      return tokenTxnHeader(stream, state)

    case "code":
      if (stream.eat("(")) {
        state.linePos = "codeInner"
        return "paren"
      }
      state.linePos = "description"
      return tokenTxnHeader(stream, state)

    case "codeInner":
      if (stream.eat(")")) {
        state.linePos = "description"
        return "paren"
      }
      stream.match(/^[^)\n]+/)
      return "labelName"

    case "description":
      if (stream.eat(";")) {
        state.linePos = "comment"
        return tokenInlineComment(stream, state)
      }
      if (stream.match(/^[^;|\n]+(?=\|)/)) {
        return "string"
      }
      if (stream.eat("|")) {
        return "operator"
      }
      stream.match(/^[^;\n]+/)
      return "string"

    default:
      if (stream.eat(";")) {
        return tokenInlineComment(stream, state)
      }
      stream.next()
      return null
  }
}

function consumeAccountName(stream: any): boolean {
  // Account names can contain single spaces but are terminated by:
  // - 2+ spaces
  // - tab
  // - semicolon
  // - end of line
  let consumed = false
  while (!stream.eol()) {
    let ch = stream.peek()
    if (ch === ";") break
    if (ch === "\t") break
    if (ch === " ") {
      // Check if this is 2+ spaces (end of account name)
      let spaceCount = 0
      let pos = 0
      while (stream.peek(pos) === " " || stream.peek(pos) === undefined) {
        // peek only works without args in StreamLanguage
        break
      }
      // Use string matching to look ahead
      let rest = stream.string.slice(stream.pos)
      let spaceMatch = rest.match(/^ {2,}/)
      if (spaceMatch) break
      // Single space followed by tab
      if (rest.match(/^ \t/)) break
      // Single space followed by semicolon
      if (rest.match(/^ ;/)) break
      // Single space at end of line
      if (rest.match(/^ $/)) break
      // Single space - part of account name
      stream.next()
      consumed = true
    } else {
      stream.next()
      consumed = true
    }
  }
  return consumed
}

function tokenPosting(stream: any, state: HledgerState): string | null {
  if (state.linePos === "comment") {
    return tokenInlineComment(stream, state)
  }

  if (state.linePos === "start") {
    // Check for status
    if (stream.eatSpace()) return null
    if (stream.eat("*") || stream.eat("!")) {
      state.linePos = "preAccount"
      return "keyword"
    }
    state.linePos = "account"
    // Check for virtual posting brackets
    if (stream.eat("(") || stream.eat("[")) {
      return "paren"
    }
    if (consumeAccountName(stream)) {
      // Check if ends with ) or ]
      let cur = stream.current()
      if (cur.endsWith(")") || cur.endsWith("]")) {
        // Back up - handled differently
      }
      state.linePos = "afterAccount"
      return "variableName"
    }
    stream.next()
    return null
  }

  if (state.linePos === "preAccount") {
    if (stream.eatSpace()) return null
    state.linePos = "account"
    if (stream.eat("(") || stream.eat("[")) {
      return "paren"
    }
    if (consumeAccountName(stream)) {
      state.linePos = "afterAccount"
      return "variableName"
    }
    stream.next()
    return null
  }

  if (state.linePos === "account") {
    if (consumeAccountName(stream)) {
      state.linePos = "afterAccount"
      return "variableName"
    }
    // Closing bracket for virtual postings
    if (stream.eat(")") || stream.eat("]")) {
      state.linePos = "afterAccount"
      return "paren"
    }
    stream.next()
    state.linePos = "afterAccount"
    return null
  }

  if (state.linePos === "afterAccount") {
    if (stream.eatSpace()) return null
    if (stream.eat(";")) {
      state.linePos = "comment"
      return tokenInlineComment(stream, state)
    }
    // Balance assertion
    if (stream.match(/^==?\*?/)) {
      state.linePos = "balAmount"
      return "operator"
    }
    // Cost
    if (stream.match(/^@@?/)) {
      state.linePos = "costAmount"
      return "operator"
    }
    // Amount
    let result = tokenAmount(stream)
    if (result) return result
    stream.next()
    return null
  }

  if (state.linePos === "balAmount" || state.linePos === "costAmount") {
    if (stream.eatSpace()) return null
    if (stream.eat(";")) {
      state.linePos = "comment"
      return tokenInlineComment(stream, state)
    }
    // After balance/cost amount, might have more
    if (state.linePos === "balAmount") {
      let result = tokenAmount(stream)
      if (result) {
        state.linePos = "afterAccount"
        return result
      }
    }
    if (state.linePos === "costAmount") {
      let result = tokenAmount(stream)
      if (result) {
        state.linePos = "afterAccount"
        return result
      }
    }
    stream.next()
    return null
  }

  if (stream.eat(";")) {
    state.linePos = "comment"
    return tokenInlineComment(stream, state)
  }

  stream.next()
  return null
}

function tokenDirective(stream: any, state: HledgerState): string | null {
  if (stream.eatSpace()) return null

  if (stream.eat(";")) {
    return tokenInlineComment(stream, state)
  }

  let kw = state.directiveKw

  if (kw === "account") {
    if (state.linePos === "") {
      state.linePos = "done"
      if (consumeAccountName(stream)) return "variableName"
    }
    stream.skipToEnd()
    return null
  }

  if (kw === "include") {
    stream.skipToEnd()
    return "string"
  }

  if (kw === "P") {
    if (state.linePos === "") {
      // Date
      if (stream.match(dateRe) || stream.match(shortDateRe)) {
        state.linePos = "commodity"
        return "meta"
      }
    }
    if (state.linePos === "commodity") {
      if (stream.match(/^"[^"]*"/) || stream.match(/^[A-Z][A-Za-z0-9_]*/) || stream.match(/^[$€£¥₹₽₿₩₪₺₴₦₡₣₤₧₨]/)) {
        state.linePos = "amount"
        return "unit"
      }
    }
    if (state.linePos === "amount") {
      let result = tokenAmount(stream)
      if (result) return result
    }
    stream.skipToEnd()
    return null
  }

  if (kw === "commodity" || kw === "D") {
    let result = tokenAmount(stream)
    if (result) return result
    stream.skipToEnd()
    return null
  }

  if (kw === "alias") {
    if (state.linePos === "") {
      if (stream.match(/^[^=\n]+/)) {
        state.linePos = "eq"
        return "variableName"
      }
    }
    if (state.linePos === "eq") {
      if (stream.eat("=")) {
        state.linePos = "target"
        return "operator"
      }
    }
    if (state.linePos === "target") {
      stream.skipToEnd()
      return "variableName"
    }
    stream.skipToEnd()
    return null
  }

  if (kw === "Y" || kw === "year") {
    if (stream.match(/^\d{4}/)) return "number"
    stream.skipToEnd()
    return null
  }

  if (kw === "decimal-mark") {
    stream.skipToEnd()
    return "string"
  }

  // payee, tag, etc - just consume rest of line
  stream.skipToEnd()
  return "string"
}

const hledgerStreamParser: StreamParser<HledgerState> = {
  name: "hledger",
  startState,

  token(stream, state): string | null {
    // Block comment mode
    if (state.inBlockComment) {
      if (stream.sol() && stream.match(/^end comment\s*$/)) {
        state.inBlockComment = false
        return "keyword"
      }
      stream.skipToEnd()
      return "comment"
    }

    // Start of line
    if (stream.sol()) {
      state.lineType = ""
      state.linePos = ""
      state.directiveKw = ""

      // Blank line
      if (stream.eol()) {
        state.expectIndented = false
        return null
      }

      // Block comment start
      if (stream.match(/^comment\s*$/)) {
        state.inBlockComment = true
        return "keyword"
      }

      // Line comment
      if (stream.match(/^[;#*]/)) {
        stream.skipToEnd()
        return "comment"
      }

      // Periodic transaction
      if (stream.eat("~")) {
        state.lineType = "periodic"
        state.linePos = "description"
        state.expectIndented = true
        return "operator"
      }

      // Auto posting rule
      if (stream.peek() === "=" && !stream.match(/^==/, false)) {
        stream.next()
        state.lineType = "auto"
        state.linePos = "description"
        state.expectIndented = true
        return "operator"
      }

      // Transaction date
      if (stream.match(dateRe)) {
        state.lineType = "txnHeader"
        state.linePos = "afterDate"
        state.expectIndented = true
        return "meta"
      }

      // Short date (no year)
      if (stream.match(shortDateRe)) {
        state.lineType = "txnHeader"
        state.linePos = "afterDate"
        state.expectIndented = true
        return "meta"
      }

      // Price directive (P at start of line followed by space)
      if (stream.match(/^P\s/)) {
        state.lineType = "directive"
        state.directiveKw = "P"
        return "keyword"
      }

      // Default commodity directive (D at start followed by space)
      if (stream.match(/^D\s/)) {
        state.lineType = "directive"
        state.directiveKw = "D"
        return "keyword"
      }

      // Year directive
      if (stream.match(/^(Y|year)\s/)) {
        state.lineType = "directive"
        state.directiveKw = stream.current().trim()
        return "keyword"
      }

      // Other directives
      if (stream.match(/^(account|commodity|payee|tag|include|alias|decimal-mark|apply account|end aliases|end apply account)\b/)) {
        state.lineType = "directive"
        state.directiveKw = stream.current().trim()
        state.expectIndented = (state.directiveKw === "account" || state.directiveKw === "commodity")
        return "keyword"
      }

      // Indented line (posting or sub-directive)
      if (stream.match(/^[ \t]+/)) {
        if (stream.eol()) return null
        // Check for comment-only sub-directive line
        if (stream.peek() === ";") {
          stream.next()
          stream.skipToEnd()
          return "comment"
        }
        state.lineType = "posting"
        state.linePos = "start"
        return null
      }

      // Unknown - consume character
      stream.next()
      return null
    }

    // Within line, dispatch based on line type
    if (stream.eol()) return null

    switch (state.lineType) {
      case "txnHeader":
        return tokenTxnHeader(stream, state)
      case "posting":
        return tokenPosting(stream, state)
      case "directive":
        return tokenDirective(stream, state)
      case "periodic":
      case "auto":
        if (state.linePos === "description") {
          if (stream.eatSpace()) return null
          if (stream.eat(";")) {
            state.linePos = "comment"
            return tokenInlineComment(stream, state)
          }
          stream.match(/^[^;\n]+/)
          return "string"
        }
        if (stream.eat(";")) return tokenInlineComment(stream, state)
        stream.next()
        return null
      default:
        stream.next()
        return null
    }
  },

  blankLine(state) {
    if (!state.inBlockComment) {
      state.expectIndented = false
    }
  },

  indent(state, _textAfter, cx) {
    if (state.expectIndented) {
      return cx.unit
    }
    return null
  },

  languageData: {
    commentTokens: {line: ";"}
  }
}

export const hledgerLanguage = StreamLanguage.define(hledgerStreamParser)

const directiveCompletions: Completion[] = [
  {label: "account", type: "keyword"},
  {label: "commodity", type: "keyword"},
  {label: "payee", type: "keyword"},
  {label: "tag", type: "keyword"},
  {label: "include", type: "keyword"},
  {label: "alias", type: "keyword"},
  {label: "end aliases", type: "keyword"},
  {label: "decimal-mark", type: "keyword"},
  {label: "apply account", type: "keyword"},
  {label: "end apply account", type: "keyword"},
  {label: "comment", type: "keyword"},
  {label: "end comment", type: "keyword"},
  {label: "year", type: "keyword"},
]

const accountPrefixCompletions: Completion[] = [
  {label: "assets:", type: "variable"},
  {label: "liabilities:", type: "variable"},
  {label: "expenses:", type: "variable"},
  {label: "income:", type: "variable"},
  {label: "equity:", type: "variable"},
  {label: "revenues:", type: "variable"},
]

function hledgerCompletion(context: CompletionContext): CompletionResult | null {
  // Directive completion at start of line
  let lineStart = context.matchBefore(/^[a-z][\w -]*/m)
  if (lineStart && context.state.doc.lineAt(context.pos).from === lineStart.from) {
    return {
      from: lineStart.from,
      options: directiveCompletions,
      validFor: /^[a-z][\w -]*$/
    }
  }

  // Account name completion on indented lines
  let accountStart = context.matchBefore(/(?:^[ \t]+[*!]?\s*)([a-z][\w:]*)/m)
  if (accountStart) {
    let colonIdx = accountStart.text.lastIndexOf(":")
    let from = colonIdx >= 0 ? accountStart.from + colonIdx + 1 : accountStart.from
    // Only offer if we seem to be in account position
    let line = context.state.doc.lineAt(context.pos)
    let lineText = line.text
    if (/^[ \t]/.test(lineText)) {
      return {
        from: accountStart.from + accountStart.text.search(/[a-z]/),
        options: accountPrefixCompletions,
        validFor: /^[a-z][\w:]*$/
      }
    }
  }

  return null
}

const hledgerFolding = foldService.of((state, from, to) => {
  let line = state.doc.lineAt(from)
  let text = line.text

  // Fold transaction headers and directives that have indented sub-lines
  let isHeader = dateRe.test(text) || shortDateRe.test(text) || /^~/.test(text) || /^=/.test(text) ||
                 /^(account|commodity)\b/.test(text)

  if (!isHeader) return null

  let lastIndented = line.to
  let nextLineNum = line.number + 1
  let totalLines = state.doc.lines

  while (nextLineNum <= totalLines) {
    let nextLine = state.doc.line(nextLineNum)
    let nextText = nextLine.text
    if (/^[ \t]/.test(nextText) && nextText.trim().length > 0) {
      lastIndented = nextLine.to
      nextLineNum++
    } else if (nextText.trim().length === 0) {
      // Blank line - include it but check if more indented lines follow
      nextLineNum++
    } else {
      break
    }
  }

  if (lastIndented > line.to) {
    return {from: line.to, to: lastIndented}
  }
  return null
})

export function hledger() {
  return new LanguageSupport(hledgerLanguage, [
    hledgerLanguage.data.of({autocomplete: hledgerCompletion}),
    hledgerFolding,
  ])
}
