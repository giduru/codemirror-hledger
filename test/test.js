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

  tree.iterate({
    enter(node) {
      counts.set(node.type.name, (counts.get(node.type.name) || 0) + 1)

      if (node.type.isError) {
        errors.push({
          at: offsetToLineColumn(input, node.from),
          text: input.slice(node.from, node.to),
        })
      }
    }
  })

  return {tree, counts, errors}
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

const fixtureCases = [
  {
    name: "finances main includes",
    file: "finance-main.journal",
    expectedCounts: {
      Directive: 4,
    },
  },
  {
    name: "finances account declarations",
    file: "finance-accounts.journal",
    expectedCounts: {
      LineComment: 1,
      Directive: 6,
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
      Directive: 4,
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
      Directive: 2,
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

  describe("targeted constructs", () => {
    it("parses supported transaction date separators", () => {
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

    it("parses price and year directives", () => {
      let input = "P 2024-01-15 EUR $1.08\nY 2024\nyear 2025\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "price-and-year")
      assertCounts(summary, {Directive: 3}, "price-and-year")
    })

    it("parses include directives with glob-like arguments", () => {
      let inputs = [
        "include nosuchfile*\n",
        "include **foo\n",
        "include ***\n",
      ]

      for (let input of inputs) {
        let summary = inspectParse(input)
        assertParsesWithoutErrors(summary, "include-glob")
        assertCounts(summary, {Directive: 1}, "include-glob")
      }
    })

    it("parses include directives with trailing comments", () => {
      let inputs = [
        "include other.journal ; note\n",
        "include foo*.journal ; glob note\n",
      ]

      for (let input of inputs) {
        let summary = inspectParse(input)
        assertParsesWithoutErrors(summary, "include-comment")
        assertCounts(summary, {Directive: 1}, "include-comment")
        assertCounts(summary, {InlineComment: 0, CommentBody: 0}, "include-comment")
      }
    })

    it("parses virtual postings", () => {
      let input = "2024-01-15 envelope\n    (budget:food)  $50\n    [assets:checking]  $50\n"
      let summary = inspectParse(input)

      assertParsesWithoutErrors(summary, "virtual-postings")
      assertCounts(summary, {Transaction: 1, Posting: 2, Amount: 2, Commodity: 2}, "virtual-postings")
    })
  })
})
