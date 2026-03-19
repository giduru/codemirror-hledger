# hledger Journal Syntax Reference

This document describes the hledger journal file format as supported by the `codemirror-lang-hledger` grammar. It serves as both a language reference and a guide to the AST node types produced by the parser.

## File Structure

A journal file is a sequence of top-level items separated by blank lines:

- **Transactions** — dated financial entries with postings
- **Periodic transactions** — templates for recurring entries
- **Auto postings** — rules that automatically add postings
- **Directives** — configuration and declarations
- **Comments** — line and block comments
- **Blank lines** — separators between items

---

## Transactions

A transaction starts with a date on an unindented line, followed by indented postings and comments.

```
DATE [STATUS] [DESCRIPTION] [; COMMENT]
    [STATUS] ACCOUNT  [AMOUNT] [COST] [BALANCE_ASSERTION] [; COMMENT]
    [STATUS] ACCOUNT  [AMOUNT] [COST] [BALANCE_ASSERTION] [; COMMENT]
    [; COMMENT]
```

### AST: `Transaction > TxnHeader, Posting*, IndentedComment*`

### Dates

Supported separators: `-`, `/`, `.` (must be consistent within a date).

```
2024-01-15 Grocery store
2024/01/15 Grocery store
2024.01.15 Grocery store
```

### Status Markers

Optional, after the date (transactions) or indentation (postings):

| Marker | Meaning   |
|--------|-----------|
| `*`    | Cleared   |
| `!`    | Pending   |
| _(none)_ | Unmarked |

```
2024-01-15 * Cleared transaction
    ! expenses:food  $50
    assets:bank
```

### AST: `Status`

---

## Postings

Each posting is an indented line within a transaction (or periodic/auto posting block).

```
    ACCOUNT  AMOUNT
    ACCOUNT                     ; elided amount (inferred)
    * ACCOUNT  AMOUNT           ; cleared posting
    (virtual:account)  AMOUNT   ; unbalanced virtual posting
    [virtual:account]  AMOUNT   ; balanced virtual posting
```

### AST: `Posting > PostingIndent, Status?, AccountName, Amount?, CostAnnotation?, BalanceAssertion?, InlineComment?`

### Account Names

Hierarchical, colon-separated. May contain single spaces within segments. Terminated by double-space, tab, semicolon, or end of line.

```
    assets:bank:td:checking_4506  $100
    expenses:alcohol & bars       $25
```

### AST: `AccountName`

### Amounts

Format: `[SIGN] [COMMODITY] [SIGN] NUMBER [COMMODITY]`

The sign (`+` or `-`) may appear before or after the commodity symbol.

```
    assets:bank  $100           ; prefix commodity
    assets:bank  100 EUR        ; suffix commodity
    assets:bank  -$50           ; sign before commodity
    assets:bank  $-50           ; sign after commodity
    assets:bank  $1,000.50      ; digit grouping
    assets:bank  10 "AAPL"      ; quoted commodity
    assets:bank  €100           ; unicode currency symbol
```

Supported currency symbols: `$`, `€`, `£`, `¥`, `₹`, `₽`, `₿`, `₩`, `₪`, `₺`, `₴`, `₦`, `₡`, `₣`, `₤`, `₧`, `₨`, and uppercase-letter commodities like `USD`, `EUR`, `BTC`.

### AST: `Amount > Sign?, Commodity?, Sign?, Number, Commodity?`

### Cost Annotations

Unit cost (`@`) or total cost (`@@`):

```
    assets:cash  -20 EUR @ 7.53 HRK       ; unit cost
    assets:cash  -20 EUR @@ 150.60 HRK    ; total cost
```

### AST: `CostAnnotation > CostOp, Sign?, Commodity?, Sign?, Number, Commodity?`

### Balance Assertions

Assert the account balance after a posting:

| Operator | Meaning                           |
|----------|-----------------------------------|
| `=`      | Assert single-commodity balance   |
| `==`     | Assert total (all commodities)    |
| `=*`     | Assert inclusive of subaccounts   |
| `==*`    | Assert total inclusive            |

```
    assets:bank  $100 = $1000
    income       ==* 0
```

### AST: `BalanceAssertion > BalanceOp, Sign?, Commodity?, Sign?, Number, Commodity?`

---

## Periodic Transactions

Templates for recurring entries, starting with `~`:

```
~ monthly from 2024-01
    expenses:rent  $1,200
    assets:bank
```

### AST: `PeriodicTransaction > PeriodicHeader, Posting*, IndentedComment*`

---

## Auto Postings (Transaction Modifiers)

Rules that automatically add postings to matching transactions, starting with `=`:

```
= expenses:food
    budget:food  -1
```

### AST: `AutoPosting > AutoHeader, Posting*, IndentedComment*`

---

## Directives

All directives start at the beginning of a line (no indentation). Each directive has a keyword node and an argument node.

### Account Declaration

Declares an account name. May have indented sub-comments for metadata.

```
account assets:bank:checking
    ; type: Asset
    ; description: Main checking account
```

**AST:** `AccountDirective > AccountKeyword, DirectiveAccountName, Newline, IndentedComment*`

### Commodity Declaration

Declares a commodity with display format. May have indented subdirectives.

```
commodity $1,000.00
commodity EUR
    ; format: EUR 1.000,00
```

**AST:** `CommodityDirective > CommodityKeyword, DirectiveArgument, Newline, IndentedComment*`

### Include

Includes another journal file. Supports glob patterns.

```
include ./accounts.journal
include transactions/*.journal
include **/*.journal
```

**AST:** `IncludeDirective > IncludeKeyword, IncludePath, Newline`

### Alias

Defines account name aliases (literal or regex-based).

```
alias expenses = equity:draw:personal
```

**AST:** `AliasDirective > AliasKeyword, DirectiveArgument, Newline`

### Payee

Declares a payee name.

```
payee Amazon
```

**AST:** `PayeeDirective > PayeeKeyword, DirectiveArgument, Newline`

### Tag

Declares a tag. May have indented sub-comments.

```
tag project
    ; description: Project tracking tag
```

**AST:** `TagDirective > TagKeyword, DirectiveArgument, Newline, IndentedComment*`

### Price (P)

Declares a market price for a commodity.

```
P 2024-01-01 EUR $1.10
```

**AST:** `PriceDirective > PriceKeyword, DirectiveArgument, Newline`

### Default Commodity (D)

Sets the default commodity for amounts without one.

```
D $1,000.00
```

**AST:** `DefaultCommodityDirective > DefaultCommodityKeyword, DirectiveArgument, Newline`

### Year (Y / year)

Sets the default year for partial dates.

```
Y 2024
year 2025
```

**AST:** `YearDirective > YearKeyword, DirectiveArgument, Newline`

### Decimal Mark

Sets the decimal separator character (period or comma).

```
decimal-mark .
decimal-mark ,
```

**AST:** `DecimalMarkDirective > DecimalMarkKeyword, DirectiveArgument, Newline`

### Commodity Conversion (C)

Declares a commodity conversion rate.

```
C 1h = $50.00
```

**AST:** `CommodityConversionDirective > CommodityConversionKeyword, DirectiveArgument, Newline`

### Bucket (A / bucket)

Sets the default balancing account.

```
A assets:bank:checking
bucket expenses:misc
```

**AST:** `BucketDirective > BucketKeyword, DirectiveArgument, Newline`

### Ignored Price Commodity (N)

Excludes a commodity from price calculations.

```
N EUR
```

**AST:** `IgnoredPriceDirective > IgnoredPriceKeyword, DirectiveArgument, Newline`

### Apply Directives

Temporarily apply settings to subsequent entries.

```
apply account assets:bank
apply year 2024
apply tag project
apply fixed EUR $1.10
```

**AST:** `ApplyAccountDirective`, `ApplyYearDirective`, `ApplyTagDirective`, `ApplyFixedDirective`
Each: `*Keyword, DirectiveArgument, Newline`

### End Directives

Close an apply block or alias scope.

```
end apply account
end apply year
end apply tag
end apply fixed
end aliases
end tag
```

**AST:** `EndDirective > EndKeyword, DirectiveArgument?, Newline`

---

## Comments

### Line Comments

Start with `;`, `#`, or `*` at the beginning of a line:

```
; This is a comment
# This is also a comment
* This is a comment too
```

**AST:** `LineComment`

### Block Comments

Multi-line comments enclosed between `comment` and `end comment`:

```
comment
This entire block
is a comment.
end comment
```

**AST:** `BlockComment`

### Indented Comments

Inside transactions or directives, indented lines starting with `;`:

```
2024-01-15 Grocery
    ; This is a transaction comment
    expenses:food  $50  ; This is an inline posting comment
    assets:bank
```

**AST:** `IndentedComment > CommentIndent, CommentBody, Newline`
**AST:** `InlineComment > CommentMark, CommentBody`

---

## AST Node Summary

| Node | Style Tag | Description |
|------|-----------|-------------|
| `TxnHeader` | `meta` | Transaction header line (date + description) |
| `PeriodicHeader` | `meta` | Periodic transaction header (`~` line) |
| `AutoHeader` | `meta` | Auto posting header (`=` line) |
| `AccountKeyword` | `keyword` | The word `account` |
| `CommodityKeyword` | `keyword` | The word `commodity` |
| `IncludeKeyword` | `keyword` | The word `include` |
| `AliasKeyword` | `keyword` | The word `alias` |
| `PayeeKeyword` | `keyword` | The word `payee` |
| `TagKeyword` | `keyword` | The word `tag` |
| `PriceKeyword` | `keyword` | The letter `P` |
| `DefaultCommodityKeyword` | `keyword` | The letter `D` |
| `YearKeyword` | `keyword` | `Y` or `year` |
| `DecimalMarkKeyword` | `keyword` | `decimal-mark` |
| `ApplyAccountKeyword` | `keyword` | `apply account` |
| `ApplyYearKeyword` | `keyword` | `apply year` |
| `ApplyTagKeyword` | `keyword` | `apply tag` |
| `ApplyFixedKeyword` | `keyword` | `apply fixed` |
| `CommodityConversionKeyword` | `keyword` | The letter `C` |
| `BucketKeyword` | `keyword` | `A` or `bucket` |
| `IgnoredPriceKeyword` | `keyword` | The letter `N` |
| `EndKeyword` | `keyword` | `end ...` variants |
| `DirectiveAccountName` | `variableName` | Account name in account directive |
| `DirectiveArgument` | `string` | Generic directive argument text |
| `IncludePath` | `string` | File path/glob in include directive |
| `AccountName` | `variableName` | Account name in postings |
| `Amount` | _(container)_ | Amount with commodity and number |
| `Number` | `number` | Numeric value |
| `Sign` | `operator` | `+` or `-` |
| `Commodity` | `unit` | Currency/commodity symbol |
| `CostOp` | `operator` | `@` or `@@` |
| `BalanceOp` | `operator` | `=`, `==`, `=*`, `==*` |
| `Status` | `keyword` | `*` or `!` |
| `CommentMark` | `lineComment` | `;` in inline comments |
| `CommentBody` | `lineComment` | Comment text content |
| `LineComment` | `lineComment` | Full line comment |
| `BlockComment` | `blockComment` | Block comment |
| `BlankLine` | _(none)_ | Empty line |

---

## Known Limitations

- **Auto posting multiplier prefix** (`*0.5`, `*-1`): The `*` multiplier in auto posting rules conflicts with the `Status` marker. The grammar parses `*` as a status marker rather than a multiplier.
- **Lot costs** (`{COST}`, `{{TOTAL_COST}}`): Not yet supported as distinct nodes.
- **Lot dates** (`[DATE]` in posting modifiers): Not yet supported as distinct nodes.
- **Secondary dates** (`DATE=DATE2`): Captured within `TxnHeader` but not as separate sub-nodes.
- **Transaction codes** (`(CODE)`): Captured within `TxnHeader` but not as separate sub-nodes.
