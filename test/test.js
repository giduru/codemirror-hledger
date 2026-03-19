import assert from "assert"
import {readFileSync} from "fs"
import path from "path"
import {fileURLToPath} from "url"
import {hledgerLanguage} from "../dist/index.js"

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures")

function inspectParse(input) {
  let tree = hledgerLanguage.parser.parse(input)
  let counts = new Map()
  let errors = []
  let nodes = []

  tree.iterate({
    enter(node) {
      counts.set(node.type.name, (counts.get(node.type.name) || 0) + 1)
      nodes.push({
        name: node.type.name,
        from: node.from,
        to: node.to,
        text: input.slice(node.from, node.to),
      })

      if (node.type.isError) {
        errors.push({
          at: offsetToLineColumn(input, node.from),
          text: input.slice(node.from, node.to),
        })
      }
    }
  })

  return {tree, counts, errors, nodes}
}

function offsetToLineColumn(input, offset) {
  let line = 1
  let column = 1

  for (let i = 0; i < offset; i++) {
    if (input.charCodeAt(i) === 10) {
      line++
      column = 1
    } else {
      column++
    }
  }

  return `${line}:${column}`
}

function count(summary, nodeName) {
  return summary.counts.get(nodeName) || 0
}

function readFixture(name) {
  return readFileSync(path.join(fixtureDir, name), "utf8")
}

function assertParsesWithoutErrors(summary, name) {
  assert.deepStrictEqual(
    summary.errors,
    [],
    `Unexpected parser errors in ${name}:\n${summary.errors.map(({at, text}) => `${at} ${JSON.stringify(text)}`).join("\n")}`
  )
}

function assertCounts(summary, expectedCounts, name) {
  for (let [nodeName, expectedCount] of Object.entries(expectedCounts)) {
    assert.strictEqual(
      count(summary, nodeName),
      expectedCount,
      `${name}: expected ${expectedCount} ${nodeName} nodes, got ${count(summary, nodeName)}`
    )
  }
}

function findNodes(summary, nodeName) {
  return summary.nodes.filter(n => n.name === nodeName)
}

function assertNodeText(summary, nodeName, index, expectedText, label) {
  let matches = findNodes(summary, nodeName)
  assert.ok(
    matches.length > index,
    `${label}: expected at least ${index + 1} ${nodeName} node(s), got ${matches.length}`
  )
  assert.strictEqual(
    matches[index].text,
    expectedText,
    `${label}: ${nodeName}[${index}] text mismatch`
  )
}

// --- Fixture tests ---

const fixtureCases = [
  {
    name: "finances main includes",
    file: "finance-main.journal",
    expectedCounts: {
      IncludeDirective: 4,
      IncludeKeyword: 4,
      IncludePath: 4,
    },
  },
  {
    name: "finances account declarations",
    file: "finance-accounts.journal",
    expectedCounts: {
      LineComment: 1,
      AccountDirective: 6,
      AccountKeyword: 6,
      DirectiveAccountName: 6,
    },
  },
  {
    name: "finances USD checking transactions",
    file: "finance-usd-checking-2024.journal",
    expectedCounts: {
      Transaction: 4,
      Posting: 8,
      Amount: 4,
      Commodity: 4,
      Sign: 2,
    },
  },
  {
    name: "quickstart directives and postings",
    file: "hledger-quickstart.journal",
    expectedCounts: {
      CommodityDirective: 1,
      CommodityKeyword: 1,
      AccountDirective: 3,
      AccountKeyword: 3,
      Transaction: 2,
      Posting: 4,
      InlineComment: 1,
      CommentBody: 1,
    },
  },
  {
    name: "multicurrency costs, assertions, and comments",
    file: "hledger-multicurrency.journal",
    expectedCounts: {
      LineComment: 1,
      BlockComment: 1,
      Transaction: 2,
      Posting: 4,
      CostAnnotation: 1,
      BalanceAssertion: 1,
    },
  },
  {
    name: "alias directives and forecast transactions",
    file: "hledger-forecast-alias.journal",
    expectedCounts: {
      AliasDirective: 2,
      AliasKeyword: 2,
      Transaction: 1,
      PeriodicTransaction: 1,
      Posting: 2,
    },
  },
  {
    name: "auto postings with numeric amounts",
    file: "hledger-auto-posting.journal",
    expectedCounts: {
      AutoPosting: 1,
      Posting: 1,
      Amount: 1,
      Sign: 1,
    },
  },
]

describe("hledger parser", () => {
  it("exports a parser", () => {
    assert.ok(hledgerLanguage)
    assert.ok(hledgerLanguage.parser)
  })

  describe("fixture journals", () => {
    for (let testCase of fixtureCases) {
      it(`parses ${testCase.name} without errors`, () => {
        let input = readFixture(testCase.file)
        let summary = inspectParse(input)

        assert.ok(summary.tree.length > 0)
        assertParsesWithoutErrors(summary, testCase.file)
        assertCounts(summary, testCase.expectedCounts, testCase.file)
      })
    }
  })

  // --- Directive keyword/argument structure tests ---

  describe("directive structure", () => {
    it("parses account directive with keyword and account name", () => {
      let input = "account assets:bank:checking\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "account-directive")
      assertCounts(summary, {AccountDirective: 1, AccountKeyword: 1, DirectiveAccountName: 1}, "account-directive")
      assertNodeText(summary, "AccountKeyword", 0, "account", "account-directive")
      assertNodeText(summary, "DirectiveAccountName", 0, "assets:bank:checking", "account-directive")
    })

    it("parses account directive with spaces in account name", () => {
      let input = "account expenses:alcohol & bars\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "account-spaces")
      assertNodeText(summary, "DirectiveAccountName", 0, "expenses:alcohol & bars", "account-spaces")
    })

    it("parses account directive with indented sub-comments", () => {
      let input = "account assets:bank:checking\n    ; type: Asset\n    ; description: Main checking\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "account-subcomments")
      assertCounts(summary, {AccountDirective: 1, IndentedComment: 2}, "account-subcomments")
    })

    it("parses commodity directive with format argument", () => {
      let input = "commodity USD 1,000.00\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "commodity-directive")
      assertCounts(summary, {CommodityDirective: 1, CommodityKeyword: 1, DirectiveArgument: 1}, "commodity-directive")
      assertNodeText(summary, "CommodityKeyword", 0, "commodity", "commodity-directive")
      assertNodeText(summary, "DirectiveArgument", 0, "USD 1,000.00", "commodity-directive")
    })

    it("parses commodity directive with indented format subdirective", () => {
      let input = "commodity EUR\n    ; format: EUR 1.000,00\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "commodity-subdir")
      assertCounts(summary, {CommodityDirective: 1, IndentedComment: 1}, "commodity-subdir")
    })

    it("parses include directive with path", () => {
      let input = "include ./accounts.journal\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "include-directive")
      assertCounts(summary, {IncludeDirective: 1, IncludeKeyword: 1, IncludePath: 1}, "include-directive")
      assertNodeText(summary, "IncludeKeyword", 0, "include", "include-directive")
      assertNodeText(summary, "IncludePath", 0, "./accounts.journal", "include-directive")
    })

    it("parses include directive with glob", () => {
      let input = "include transactions/*.journal\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "include-glob")
      assertNodeText(summary, "IncludePath", 0, "transactions/*.journal", "include-glob")
    })

    it("parses include directive with double-star glob", () => {
      let input = "include **/*.journal\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "include-doubleglob")
      assertNodeText(summary, "IncludePath", 0, "**/*.journal", "include-doubleglob")
    })

    it("parses alias directive", () => {
      let input = "alias expenses = equity:draw:personal\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "alias-directive")
      assertCounts(summary, {AliasDirective: 1, AliasKeyword: 1, DirectiveArgument: 1}, "alias-directive")
      assertNodeText(summary, "AliasKeyword", 0, "alias", "alias-directive")
      assertNodeText(summary, "DirectiveArgument", 0, "expenses = equity:draw:personal", "alias-directive")
    })

    it("parses payee directive", () => {
      let input = "payee Amazon\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "payee-directive")
      assertCounts(summary, {PayeeDirective: 1, PayeeKeyword: 1, DirectiveArgument: 1}, "payee-directive")
      assertNodeText(summary, "DirectiveArgument", 0, "Amazon", "payee-directive")
    })

    it("parses tag directive", () => {
      let input = "tag project\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "tag-directive")
      assertCounts(summary, {TagDirective: 1, TagKeyword: 1, DirectiveArgument: 1}, "tag-directive")
    })

    it("parses tag directive with indented sub-comments", () => {
      let input = "tag project\n    ; description: Project tag\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "tag-subcomments")
      assertCounts(summary, {TagDirective: 1, IndentedComment: 1}, "tag-subcomments")
    })

    it("parses decimal-mark directive", () => {
      let input = "decimal-mark .\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "decimal-mark")
      assertCounts(summary, {DecimalMarkDirective: 1, DecimalMarkKeyword: 1, DirectiveArgument: 1}, "decimal-mark")
      assertNodeText(summary, "DecimalMarkKeyword", 0, "decimal-mark", "decimal-mark")
      assertNodeText(summary, "DirectiveArgument", 0, ".", "decimal-mark")
    })

    it("parses decimal-mark with comma", () => {
      let input = "decimal-mark ,\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "decimal-mark-comma")
      assertNodeText(summary, "DirectiveArgument", 0, ",", "decimal-mark-comma")
    })
  })

  // --- Single-letter directive tests ---

  describe("single-letter directives", () => {
    it("parses P (price) directive", () => {
      let input = "P 2024-01-15 EUR $1.08\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "price-directive")
      assertCounts(summary, {PriceDirective: 1, PriceKeyword: 1, DirectiveArgument: 1}, "price-directive")
      assertNodeText(summary, "PriceKeyword", 0, "P", "price-directive")
      assertNodeText(summary, "DirectiveArgument", 0, "2024-01-15 EUR $1.08", "price-directive")
    })

    it("parses D (default commodity) directive", () => {
      let input = "D $1,000.00\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "default-commodity")
      assertCounts(summary, {DefaultCommodityDirective: 1, DefaultCommodityKeyword: 1}, "default-commodity")
      assertNodeText(summary, "DefaultCommodityKeyword", 0, "D", "default-commodity")
    })

    it("parses Y (year) directive", () => {
      let input = "Y 2024\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "year-Y")
      assertCounts(summary, {YearDirective: 1, YearKeyword: 1}, "year-Y")
      assertNodeText(summary, "YearKeyword", 0, "Y", "year-Y")
    })

    it("parses year (word) directive", () => {
      let input = "year 2025\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "year-word")
      assertCounts(summary, {YearDirective: 1, YearKeyword: 1}, "year-word")
      assertNodeText(summary, "YearKeyword", 0, "year", "year-word")
    })

    it("parses C (commodity conversion) directive", () => {
      let input = "C 1h = $50.00\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "conversion")
      assertCounts(summary, {CommodityConversionDirective: 1, CommodityConversionKeyword: 1}, "conversion")
      assertNodeText(summary, "CommodityConversionKeyword", 0, "C", "conversion")
      assertNodeText(summary, "DirectiveArgument", 0, "1h = $50.00", "conversion")
    })

    it("parses A (bucket) directive", () => {
      let input = "A assets:bank:checking\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "bucket-A")
      assertCounts(summary, {BucketDirective: 1, BucketKeyword: 1}, "bucket-A")
      assertNodeText(summary, "BucketKeyword", 0, "A", "bucket-A")
    })

    it("parses bucket (word) directive", () => {
      let input = "bucket expenses:misc\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "bucket-word")
      assertCounts(summary, {BucketDirective: 1, BucketKeyword: 1}, "bucket-word")
      assertNodeText(summary, "BucketKeyword", 0, "bucket", "bucket-word")
    })

    it("parses N (ignored price) directive", () => {
      let input = "N EUR\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "ignored-price")
      assertCounts(summary, {IgnoredPriceDirective: 1, IgnoredPriceKeyword: 1}, "ignored-price")
      assertNodeText(summary, "IgnoredPriceKeyword", 0, "N", "ignored-price")
    })
  })

  // --- Apply/End directive tests ---

  describe("apply and end directives", () => {
    it("parses apply account directive", () => {
      let input = "apply account assets:bank\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "apply-account")
      assertCounts(summary, {ApplyAccountDirective: 1, ApplyAccountKeyword: 1}, "apply-account")
      assertNodeText(summary, "ApplyAccountKeyword", 0, "apply account", "apply-account")
      assertNodeText(summary, "DirectiveArgument", 0, "assets:bank", "apply-account")
    })

    it("parses apply year directive", () => {
      let input = "apply year 2024\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "apply-year")
      assertCounts(summary, {ApplyYearDirective: 1, ApplyYearKeyword: 1}, "apply-year")
      assertNodeText(summary, "ApplyYearKeyword", 0, "apply year", "apply-year")
    })

    it("parses apply tag directive", () => {
      let input = "apply tag project\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "apply-tag")
      assertCounts(summary, {ApplyTagDirective: 1, ApplyTagKeyword: 1}, "apply-tag")
    })

    it("parses apply fixed directive", () => {
      let input = "apply fixed EUR $1.10\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "apply-fixed")
      assertCounts(summary, {ApplyFixedDirective: 1, ApplyFixedKeyword: 1}, "apply-fixed")
    })

    it("parses end apply account", () => {
      let input = "end apply account\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "end-apply-account")
      assertCounts(summary, {EndDirective: 1, EndKeyword: 1}, "end-apply-account")
      assertNodeText(summary, "EndKeyword", 0, "end apply account", "end-apply-account")
    })

    it("parses end apply year", () => {
      let input = "end apply year\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "end-apply-year")
      assertCounts(summary, {EndDirective: 1, EndKeyword: 1}, "end-apply-year")
      assertNodeText(summary, "EndKeyword", 0, "end apply year", "end-apply-year")
    })

    it("parses end apply tag", () => {
      let input = "end apply tag\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "end-apply-tag")
      assertCounts(summary, {EndDirective: 1, EndKeyword: 1}, "end-apply-tag")
    })

    it("parses end apply fixed", () => {
      let input = "end apply fixed\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "end-apply-fixed")
      assertCounts(summary, {EndDirective: 1, EndKeyword: 1}, "end-apply-fixed")
    })

    it("parses end aliases", () => {
      let input = "end aliases\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "end-aliases")
      assertCounts(summary, {EndDirective: 1, EndKeyword: 1}, "end-aliases")
      assertNodeText(summary, "EndKeyword", 0, "end aliases", "end-aliases")
    })

    it("parses end tag", () => {
      let input = "end tag\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "end-tag")
      assertCounts(summary, {EndDirective: 1, EndKeyword: 1}, "end-tag")
    })
  })

  // --- Transaction format tests ---

  describe("transaction format", () => {
    it("parses supported date separators", () => {
      let inputs = [
        "2024-01-15 test\n    assets:checking  $1\n    income\n",
        "2024/01/15 test\n    assets:checking  $1\n    income\n",
        "2024.01.15 test\n    assets:checking  $1\n    income\n",
      ]

      for (let input of inputs) {
        let summary = inspectParse(input)
        assertParsesWithoutErrors(summary, "date-variant")
        assertCounts(summary, {Transaction: 1, Posting: 2, Amount: 1}, "date-variant")
      }
    })

    it("parses transaction with status marker *", () => {
      let input = "2024-01-15 * Grocery store\n    expenses:food  $50\n    assets:bank\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "txn-cleared")
      assertCounts(summary, {Transaction: 1, Posting: 2}, "txn-cleared")
    })

    it("parses transaction with status marker !", () => {
      let input = "2024-01-15 ! Pending purchase\n    expenses:food  $50\n    assets:bank\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "txn-pending")
      assertCounts(summary, {Transaction: 1, Posting: 2}, "txn-pending")
    })

    it("parses transaction with no description", () => {
      let input = "2024-01-15\n    expenses:food  $50\n    assets:bank\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "txn-no-desc")
      assertCounts(summary, {Transaction: 1, Posting: 2}, "txn-no-desc")
    })

    it("parses transaction with inline comment", () => {
      let input = "2024-01-15 test\n    expenses:food  $50  ; a note\n    assets:bank\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "posting-comment")
      assertCounts(summary, {InlineComment: 1, CommentBody: 1}, "posting-comment")
    })

    it("parses transaction with indented comment lines", () => {
      let input = "2024-01-15 test\n    ; transaction note\n    expenses:food  $50\n    assets:bank\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "txn-comment-lines")
      assertCounts(summary, {IndentedComment: 1, Posting: 2}, "txn-comment-lines")
    })
  })

  // --- Posting format tests ---

  describe("posting format", () => {
    it("parses posting with elided amount", () => {
      let input = "2024-01-15 test\n    expenses:food  $50\n    assets:bank\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "elided-amount")
      assertCounts(summary, {Amount: 1}, "elided-amount")
    })

    it("parses posting with negative amount", () => {
      let input = "2024-01-15 test\n    assets:bank  -$50\n    income\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "negative-amount")
      assertCounts(summary, {Sign: 1, Amount: 1}, "negative-amount")
    })

    it("parses posting with suffix commodity", () => {
      let input = "2024-01-15 test\n    assets:bank  100 EUR\n    income\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "suffix-commodity")
      assertCounts(summary, {Commodity: 1, Amount: 1}, "suffix-commodity")
    })

    it("parses posting with prefix commodity", () => {
      let input = "2024-01-15 test\n    assets:bank  $100\n    income\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "prefix-commodity")
      assertCounts(summary, {Commodity: 1, Amount: 1}, "prefix-commodity")
    })

    it("parses cost annotation with @", () => {
      let input = "2024-01-15 test\n    assets:cash  -20 EUR @ 7.53 HRK\n    assets:cash\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "cost-unit")
      assertCounts(summary, {CostAnnotation: 1, CostOp: 1}, "cost-unit")
    })

    it("parses cost annotation with @@", () => {
      let input = "2024-01-15 test\n    assets:cash  -20 EUR @@ 150.60 HRK\n    assets:cash\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "cost-total")
      assertCounts(summary, {CostAnnotation: 1, CostOp: 1}, "cost-total")
    })

    it("parses balance assertion with =", () => {
      let input = "2024-01-15 test\n    assets:bank  $100 = $1000\n    income\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "balance-assert")
      assertCounts(summary, {BalanceAssertion: 1, BalanceOp: 1}, "balance-assert")
    })

    it("parses total balance assertion with ==", () => {
      let input = "2024-01-15 test\n    income  ==* 0\n    equity\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "balance-total")
      assertCounts(summary, {BalanceAssertion: 1, BalanceOp: 1}, "balance-total")
    })

    it("parses virtual posting with parentheses", () => {
      let input = "2024-01-15 envelope\n    (budget:food)  $50\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "virtual-unbalanced")
      assertCounts(summary, {Posting: 1, Amount: 1}, "virtual-unbalanced")
    })

    it("parses virtual posting with brackets", () => {
      let input = "2024-01-15 envelope\n    [assets:checking]  $50\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "virtual-balanced")
      assertCounts(summary, {Posting: 1, Amount: 1}, "virtual-balanced")
    })

    it("parses posting with status marker", () => {
      let input = "2024-01-15 test\n    * assets:bank  $100\n    income\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "posting-status")
      assertCounts(summary, {Status: 1}, "posting-status")
    })

    it("parses digit grouping in amounts", () => {
      let input = "2024-01-15 test\n    assets:bank  $1,000.50\n    income\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "digit-grouping")
      assertCounts(summary, {Amount: 1, Number: 1}, "digit-grouping")
    })

    it("parses quoted commodity symbol", () => {
      let input = '2024-01-15 test\n    assets:stock  10 "AAPL"\n    assets:bank\n'
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "quoted-commodity")
      assertCounts(summary, {Commodity: 1}, "quoted-commodity")
    })

    it("parses unicode currency symbols", () => {
      let inputs = [
        "2024-01-15 test\n    assets:bank  €100\n    income\n",
        "2024-01-15 test\n    assets:bank  £100\n    income\n",
        "2024-01-15 test\n    assets:bank  ¥100\n    income\n",
        "2024-01-15 test\n    assets:bank  ₿1\n    income\n",
      ]

      for (let input of inputs) {
        let summary = inspectParse(input)
        assertParsesWithoutErrors(summary, "unicode-currency")
        assertCounts(summary, {Commodity: 1, Amount: 1}, "unicode-currency")
      }
    })
  })

  // --- Comment tests ---

  describe("comments", () => {
    it("parses semicolon line comment", () => {
      let input = "; this is a comment\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "semicolon-comment")
      assertCounts(summary, {LineComment: 1}, "semicolon-comment")
    })

    it("parses hash line comment", () => {
      let input = "# this is a comment\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "hash-comment")
      assertCounts(summary, {LineComment: 1}, "hash-comment")
    })

    it("parses star line comment", () => {
      let input = "* this is a comment\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "star-comment")
      assertCounts(summary, {LineComment: 1}, "star-comment")
    })

    it("parses block comment", () => {
      let input = "comment\nthis is a block\nof comments\nend comment\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "block-comment")
      assertCounts(summary, {BlockComment: 1}, "block-comment")
    })

    it("parses block comment at end of file", () => {
      let input = "comment\nthis is a block\nof comments"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "block-comment-eof")
      assertCounts(summary, {BlockComment: 1}, "block-comment-eof")
    })
  })

  // --- Periodic and auto posting tests ---

  describe("periodic and auto postings", () => {
    it("parses periodic transaction", () => {
      let input = "~ monthly from 2021 to 2023 forecast\n    [assets:checking]    3\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "periodic")
      assertCounts(summary, {PeriodicTransaction: 1, PeriodicHeader: 1, Posting: 1}, "periodic")
    })

    it("parses auto posting rule", () => {
      let input = "= expenses:food\n    budget:food  -1\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "auto-posting")
      assertCounts(summary, {AutoPosting: 1, AutoHeader: 1, Posting: 1}, "auto-posting")
    })

    it("parses auto posting with multiple postings", () => {
      let input = "= expenses:food\n    budget:food  -1\n    budget:available  1\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "auto-multi")
      assertCounts(summary, {AutoPosting: 1, Posting: 2}, "auto-multi")
    })

    // Note: the * multiplier prefix (e.g. *-1, *0.5) in auto postings is a
    // niche hledger feature that the grammar does not yet distinguish from
    // the posting status marker. This is a known limitation.
    it("parses auto posting without multiplier prefix", () => {
      let input = "= expenses:food\n    budget:food  -1\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "auto-no-mult")
      assertCounts(summary, {AutoPosting: 1, Posting: 1, Sign: 1}, "auto-no-mult")
    })
  })

  // --- Edge cases ---

  describe("edge cases", () => {
    it("handles empty input", () => {
      let summary = inspectParse("")
      assertParsesWithoutErrors(summary, "empty")
    })

    it("handles blank lines only", () => {
      let summary = inspectParse("\n\n\n")
      assertParsesWithoutErrors(summary, "blank-lines")
      assertCounts(summary, {BlankLine: 3}, "blank-lines")
    })

    it("handles input without trailing newline", () => {
      let input = "account assets:bank"
      let summary = inspectParse(input)
      // Should not crash; may or may not have errors depending on parser behavior
      assert.ok(summary.tree.length > 0)
    })

    it("parses multiple directives in sequence", () => {
      let input = "account assets:bank\naccount expenses:food\ncommodity USD 1,000.00\ninclude other.journal\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "multi-directives")
      assertCounts(summary, {
        AccountDirective: 2,
        CommodityDirective: 1,
        IncludeDirective: 1,
      }, "multi-directives")
    })

    it("parses mixed content (directives, transactions, comments)", () => {
      let input = [
        "; Header comment",
        "account assets:bank",
        "commodity $1,000.00",
        "",
        "2024-01-15 Grocery",
        "    expenses:food  $50",
        "    assets:bank",
        "",
        "# Footer note",
        "",
      ].join("\n")
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "mixed-content")
      assertCounts(summary, {
        LineComment: 2,
        AccountDirective: 1,
        CommodityDirective: 1,
        Transaction: 1,
        Posting: 2,
      }, "mixed-content")
    })

    it("treats unknown non-indented lines as comments", () => {
      let input = "thisisnotavalidkeyword something\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "unknown-line")
      assertCounts(summary, {LineComment: 1}, "unknown-line")
    })

    it("parses account names with colons and subaccounts", () => {
      let input = "2024-01-15 test\n    assets:bank:td:checking_4506  $100\n    income\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "deep-accounts")
      assertNodeText(summary, "AccountName", 0, "assets:bank:td:checking_4506", "deep-accounts")
    })

    it("parses account name with trailing double-space separator", () => {
      let input = "2024-01-15 test\n    expenses:food  $50\n    assets:bank\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "double-space-sep")
      assertNodeText(summary, "AccountName", 0, "expenses:food", "double-space-sep")
    })
  })

  // --- Full journal integration test ---

  describe("full journal integration", () => {
    it("parses a complete realistic journal", () => {
      let input = [
        "; My finances 2024",
        "",
        "commodity $1,000.00",
        "commodity CAD 1,000.00",
        "",
        "account assets:bank:checking",
        "account assets:bank:savings",
        "account expenses:food",
        "account expenses:rent",
        "account income:salary",
        "account equity:opening",
        "",
        "include ./transactions/*.journal",
        "",
        "P 2024-01-01 CAD $0.75",
        "D $1,000.00",
        "Y 2024",
        "",
        "2024-01-01 Opening balances",
        "    assets:bank:checking  $5,000.00",
        "    equity:opening",
        "",
        "2024-01-15 * Grocery store",
        "    expenses:food  $50.00",
        "    assets:bank:checking",
        "",
        "2024-02-01 ! Rent payment",
        "    expenses:rent  $1,200.00",
        "    assets:bank:checking  $-1,200.00",
        "",
        "~ monthly from 2024-01",
        "    expenses:rent  $1,200.00",
        "    assets:bank:checking",
        "",
        "= expenses:food",
        "    budget:food  -1",
        "",
      ].join("\n")

      let summary = inspectParse(input)
      assertParsesWithoutErrors(summary, "full-journal")
      assertCounts(summary, {
        CommodityDirective: 2,
        AccountDirective: 6,
        IncludeDirective: 1,
        PriceDirective: 1,
        DefaultCommodityDirective: 1,
        YearDirective: 1,
        Transaction: 3,
        PeriodicTransaction: 1,
        AutoPosting: 1,
      }, "full-journal")
    })
  })
})
