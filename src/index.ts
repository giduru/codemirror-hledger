import {parser as hledgerParser} from "./syntax.grammar"
import {LRParser} from "@lezer/lr"
import {LRLanguage, LanguageSupport, indentNodeProp, foldNodeProp} from "@codemirror/language"
import {styleTags, tags as t} from "@lezer/highlight"
import {Completion, CompletionContext, CompletionResult} from "@codemirror/autocomplete"

export const parser: LRParser = hledgerParser

export const hledgerLanguage = LRLanguage.define({
  parser: hledgerParser.configure({
    props: [
      styleTags({
        TxnDate: t.meta,
        TxnDescription: t.string,
        PeriodicMark: t.meta,
        PeriodicExpression: t.string,
        AutoMark: t.meta,
        AutoQuery: t.string,
        BlockComment: t.blockComment,
        LineComment: t.lineComment,

        // Directive keywords
        AccountKeyword: t.keyword,
        CommodityKeyword: t.keyword,
        IncludeKeyword: t.keyword,
        AliasKeyword: t.keyword,
        PayeeKeyword: t.keyword,
        TagKeyword: t.keyword,
        PriceKeyword: t.keyword,
        DefaultCommodityKeyword: t.keyword,
        YearKeyword: t.keyword,
        DecimalMarkKeyword: t.keyword,
        ApplyAccountKeyword: t.keyword,
        ApplyYearKeyword: t.keyword,
        ApplyTagKeyword: t.keyword,
        ApplyFixedKeyword: t.keyword,
        CommodityConversionKeyword: t.keyword,
        BucketKeyword: t.keyword,
        IgnoredPriceKeyword: t.keyword,
        EndKeyword: t.keyword,

        // Directive arguments
        DirectiveAccountName: t.variableName,
        DirectiveArgument: t.string,
        IncludePath: t.string,

        // Posting nodes
        AccountName: t.variableName,
        Number: t.number,
        Sign: t.operator,
        Commodity: t.unit,
        CostOp: t.operator,
        BalanceOp: t.operator,
        Status: t.keyword,
        CommentMark: t.lineComment,
        CommentBody: t.lineComment,
        "( )": t.paren,
      }),
      indentNodeProp.add({
        Transaction: () => 4,
        PeriodicTransaction: () => 4,
        AutoPosting: () => 4,
        AccountDirective: () => 4,
      }),
      foldNodeProp.add({
        Transaction(node) {
          let first = node.firstChild
          if (!first) return null
          return {from: first.to, to: node.to}
        },
        PeriodicTransaction(node) {
          let first = node.firstChild
          if (!first) return null
          return {from: first.to, to: node.to}
        },
        AutoPosting(node) {
          let first = node.firstChild
          if (!first) return null
          return {from: first.to, to: node.to}
        },
        AccountDirective(node) {
          let first = node.firstChild
          if (!first) return null
          return {from: first.to, to: node.to}
        },
        CommodityDirective(node) {
          let first = node.firstChild
          if (!first) return null
          return {from: first.to, to: node.to}
        },
        TagDirective(node) {
          let first = node.firstChild
          if (!first) return null
          return {from: first.to, to: node.to}
        },
      }),
    ]
  }),
  languageData: {
    commentTokens: {line: ";"}
  }
})

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
  {label: "apply year", type: "keyword"},
  {label: "end apply year", type: "keyword"},
  {label: "apply tag", type: "keyword"},
  {label: "end apply tag", type: "keyword"},
  {label: "apply fixed", type: "keyword"},
  {label: "end apply fixed", type: "keyword"},
  {label: "bucket", type: "keyword"},
]

const accountPrefixCompletions: Completion[] = [
  {label: "assets:", type: "variable"},
  {label: "liabilities:", type: "variable"},
  {label: "expenses:", type: "variable"},
  {label: "income:", type: "variable"},
  {label: "equity:", type: "variable"},
  {label: "revenues:", type: "variable"},
]

export function hledgerCompletion(context: CompletionContext): CompletionResult | null {
  let lineStart = context.matchBefore(/^[a-z][\w -]*/m)
  if (lineStart && context.state.doc.lineAt(context.pos).from === lineStart.from) {
    return {
      from: lineStart.from,
      options: directiveCompletions,
      validFor: /^[a-z][\w -]*$/
    }
  }

  let accountStart = context.matchBefore(/(?:^[ \t]+[*!]?\s*)([a-z][\w:]*)/m)
  if (accountStart) {
    let line = context.state.doc.lineAt(context.pos)
    if (/^[ \t]/.test(line.text)) {
      return {
        from: accountStart.from + accountStart.text.search(/[a-z]/),
        options: accountPrefixCompletions,
        validFor: /^[a-z][\w:]*$/
      }
    }
  }

  return null
}

export function hledger(): LanguageSupport {
  return new LanguageSupport(hledgerLanguage, [
    hledgerLanguage.data.of({autocomplete: hledgerCompletion}),
  ])
}
