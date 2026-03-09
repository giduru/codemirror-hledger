import {EditorView, basicSetup} from "codemirror"
import {hledger} from "../src/index"

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

new EditorView({
  doc: sampleJournal,
  extensions: [basicSetup, hledger()],
  parent: document.getElementById("editor")!
})
