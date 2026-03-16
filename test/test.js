import {hledgerLanguage} from "../dist/index.js"
import assert from "assert"

// Helper: tokenize a string and return array of {text, style} objects
function tokenize(input) {
  let lang = hledgerLanguage
  let tree = lang.parser.parse(input)
  let tokens = []
  tree.iterate({
    enter(node) {
      if (node.firstChild) return
      let text = input.slice(node.from, node.to)
      let styles = lang.highlight(node)
      tokens.push({text, type: node.type.name, from: node.from, to: node.to})
    }
  })
  return tokens
}

function printTree(input) {
  let tree = hledgerLanguage.parser.parse(input)
  let lines = []
  tree.iterate({
    enter(node) {
      let indent = "  ".repeat(node.depth || 0)
      let text = input.slice(node.from, node.to).replace(/\n/g, "\\n")
      if (text.length > 50) text = text.slice(0, 47) + "..."
      lines.push(`${indent}${node.type.name} [${node.from}-${node.to}] "${text}"`)
    }
  })
  return lines.join("\n")
}

function getNodeNames(input) {
  let tree = hledgerLanguage.parser.parse(input)
  let names = []
  tree.iterate({
    enter(node) {
      if (node.type.name !== "⚠") names.push(node.type.name)
    }
  })
  return names
}

describe("hledger language", () => {
  it("should export hledgerLanguage", () => {
    assert.ok(hledgerLanguage)
    assert.ok(hledgerLanguage.parser)
  })

  it("should parse a simple transaction without error", () => {
    let input = "2024-01-15 Grocery store\n    expenses:food  $50.00\n    assets:checking\n"
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
    assert.ok(tree.length > 0)
  })

  it("should parse directives without error", () => {
    let input = "account assets:checking\ncommodity $1,000.00\ninclude other.journal\n"
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
  })

  it("should parse comments without error", () => {
    let input = "; This is a comment\n# Another comment\n* Star comment\n"
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
  })

  it("should parse block comments without error", () => {
    let input = "comment\nThis is a block comment\nwith multiple lines\nend comment\n"
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
  })

  it("should parse periodic transactions without error", () => {
    let input = "~ monthly\n    expenses:rent  $1000\n    assets:checking\n"
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
  })

  it("should parse auto postings without error", () => {
    let input = "= expenses:food\n    budget:food  *-1\n"
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
  })

  it("should parse transactions with status and code", () => {
    let input = "2024-01-15 * (123) Grocery store\n    expenses:food  $50\n    assets:checking\n"
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
  })

  it("should parse transactions with inline comments", () => {
    let input = "2024-01-15 Grocery store  ; some comment\n    expenses:food  $50  ; food tag\n    assets:checking\n"
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
  })

  it("should parse various date formats", () => {
    let inputs = [
      "2024-01-15 test\n    a  1\n    b\n",
      "2024/01/15 test\n    a  1\n    b\n",
      "2024.01.15 test\n    a  1\n    b\n",
    ]
    for (let input of inputs) {
      let tree = hledgerLanguage.parser.parse(input)
      assert.ok(tree)
    }
  })

  it("should parse price directives", () => {
    let input = "P 2024-01-15 EUR $1.08\n"
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
  })

  it("should parse alias directives", () => {
    let input = "alias savings = assets:bank:savings\n"
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
  })

  it("should parse year directives", () => {
    let inputs = ["Y 2024\n", "year 2024\n"]
    for (let input of inputs) {
      let tree = hledgerLanguage.parser.parse(input)
      assert.ok(tree)
    }
  })

  it("should parse balance assertions", () => {
    let input = "2024-01-15 test\n    assets:checking  $100 = $1000\n    income\n"
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
  })

  it("should parse cost notation", () => {
    let input = "2024-01-15 test\n    assets:eur  100 EUR @ $1.08\n    assets:usd\n"
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
  })

  it("should parse virtual postings", () => {
    let input = "2024-01-15 test\n    (budget:food)  $50\n    [assets:checking]  $50\n"
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
  })

  it("should produce Transaction nodes with Posting children", () => {
    let input = "2024-01-15 Grocery store\n    expenses:food  $50.00\n    assets:checking\n"
    let names = getNodeNames(input)
    assert.ok(names.includes("Journal"))
    assert.ok(names.includes("Transaction"))
    assert.ok(names.includes("TxnHeader"))
    assert.ok(names.includes("Posting"))
    assert.ok(names.includes("AccountName"))
  })

  it("should produce Amount nodes with Commodity and Number", () => {
    let input = "2024-01-15 test\n    expenses:food  $50.00\n    assets:checking\n"
    let names = getNodeNames(input)
    assert.ok(names.includes("Amount"))
    assert.ok(names.includes("Number"))
    assert.ok(names.includes("Commodity"))
  })

  it("should parse complex journal", () => {
    let input = `; Main journal file
account assets:checking
account expenses:food
commodity $1,000.00

2024-01-15 * (1001) Grocery Store | Weekly shopping  ; trip:weekly
    expenses:food:groceries  $45.50
    expenses:food:snacks     $12.30  ; junk food
    assets:checking

2024-01-16 ! Landlord
    expenses:rent  $1,500.00
    assets:checking  = $3,500.00

~ monthly
    expenses:utilities  $200
    assets:checking

P 2024-01-15 EUR $1.08
`
    let tree = hledgerLanguage.parser.parse(input)
    assert.ok(tree)
    assert.ok(tree.length > 0)
  })
})
