import {EditorView, basicSetup} from "codemirror"
import {hledger, parser} from "../dist/index.js"

const sampleJournal = `; Main journal file
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

2024-01-17 Currency Exchange
    assets:eur       100 EUR @ $1.08
    assets:usd

~ monthly
    (expenses:rent)   $1000
    (expenses:food)    $500

= expenses:food
    budget:food  *-1
    budget:food:available  *1

P 2024-01-15 EUR $1.08

include other.journal

comment
This is a block comment.
Multiple lines are ignored.
end comment

# hash comment
; semicolon comment
* star comment

alias savings = assets:bank:savings
decimal-mark .
year 2024
`

const astOutput = document.getElementById("ast")

function formatAst(doc: string) {
  const cursor = parser.parse(doc).cursor()
  const lines: string[] = []

  function walk(depth = 0) {
    lines.push(`${"  ".repeat(depth)}${cursor.name} [${cursor.from}, ${cursor.to}]`)
    if (cursor.firstChild()) {
      do walk(depth + 1)
      while (cursor.nextSibling())
      cursor.parent()
    }
  }

  walk()
  return lines.join("\n")
}

function renderAst(view: EditorView) {
  if (astOutput) astOutput.textContent = formatAst(view.state.doc.toString())
}

const view = new EditorView({
  doc: sampleJournal,
  extensions: [
    basicSetup,
    hledger(),
    EditorView.updateListener.of(update => {
      if (update.docChanged) renderAst(update.view)
    }),
  ],
  parent: document.getElementById("editor")!
})

renderAst(view)
