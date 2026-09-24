# A2Z dataset — sources, verification and link audit

> **Round 1 audit.** The second audit (articles, GfG re-check, lesson links moved to articles) changed some counts below — the current numbers are in [A2Z_DATA_AUDIT.md](A2Z_DATA_AUDIT.md) and `npm run validate:data`.

`data/a2zProblems.ts` contains the **classic 18-step Striver A2Z DSA Sheet: 455 items** (426 practice problems + 29 theory/lesson items), in the sheet's own order, grouped as Step → Lecture (section) → item.

## Why 455 and not ~495

The classic A2Z sheet has 455 entries. The "495" figure you may see on takeuforward.org belongs to the 2026 re-organised version of the sheet (19 modules starting with *Beginner Problems*, 402 practice problems plus learning pages), which has a different structure and ordering from the Step 1–18 roadmap this app follows. No items were invented to reach a round number.

## Sources

| What | Source |
|---|---|
| Order, steps, lectures, titles, the sheet's own links | Codolio's public mirror of the classic sheet (`strivers-a2z-dsa-sheet`, 455 rows, fetched 2026-09-20), which links back to takeuforward.org's sheet |
| LeetCode confirmation (slug exists, title, difficulty, tags, premium flag) | LeetCode's GraphQL API snapshot from [geckguy/striver-a2z-sheet](https://github.com/geckguy/striver-a2z-sheet) (MIT, 2026-09-20), plus direct page fetches during this build (2026-09-23) |
| GeeksforGeeks links | the same repo's verified GfG matches (each page fetched and its slug/title checked) for the matching item in the current official sheet |
| TakeUForward links | current official sheet URLs (HTTP-200 checked 2026-09-20), or re-checked by fetching the page during this build |

## Verification level of every link

- **LeetCode: 249** — 222 confirmed via LeetCode's API, 27 confirmed by fetching the problem page (title + number + difficulty).
- **GeeksforGeeks: 77** — verified page matches.
- **TakeUForward: 410** — 358 HTTP-200 checked, 38 fetched and heading compared with the item, 14 learning pages taken from the official sheet's own navigation.
- **Other: 3** — #8 HackerRank, #216 InterviewBit, #256 InterviewBit (pages fetched and checked).
- **Code360: 0** — no Code360 URL could be verified, so none is listed (the UI shows *Not available*).

A link is only stored under `platforms` when it is the **same problem**. Nothing was guessed from a similar title.

## LeetCode link audit (changes vs. the sheet mirror)

### Removed — the linked LeetCode problem is a different problem

- #31 **Find the highest/lowest frequency element** — sheet linked `frequency-of-the-most-frequent-element`
- #165 **Learn All Patterns of Subsequences (Theory)** — sheet linked `distinct-subsequences-ii`
- #347 **Number of Distinct Islands [dfs multisource]** — sheet linked `number-of-distinct-islands-ii`
- #402 **0/1 Knapsack (DP - 19)** — sheet linked `assign-cookies`
- #444 **Bit PreRequisites for TRIE Problems** — sheet linked `single-number`

### Moved to *Related practice (not identical)* — never used as the Solve button

- #26 **Reverse an array** → `reverse-string` — Reverses a character array, not a general array.
- #27 **Check if a string is palindrome or not** → `valid-palindrome` — LeetCode version ignores non-alphanumeric characters.
- #41 **Check if the array is sorted** → `check-if-array-is-sorted-and-rotated` — LeetCode version also allows a rotation.
- #43 **Left Rotate an array by one place** → `rotate-array` — LeetCode rotates right by k; the sheet item is a left rotation by one.
- #44 **Left rotate an array by D places** → `rotate-array` — LeetCode rotates right by k; the sheet item rotates left by D.
- #74 **Merge two sorted arrays without extra space** → `merge-sorted-array` — LeetCode version gives the first array extra space to merge into.
- #122 **Count Number of Substrings** → `subarrays-with-k-different-integers` — Same counting technique on integer arrays instead of substrings.
- #128 **Deleting a node in LinkedList** → `delete-node-in-a-linked-list` — LeetCode version only gives access to the node being deleted.
- #191 **Find the number that appears odd number of times** → `single-number` — LeetCode version: every other number appears exactly twice.
- #197 **Sieve of Eratosthenes** → `count-primes` — Practice for the Sieve: count primes below n.
- #214 **Next Greater Element** → `next-greater-element-i` — LeetCode version queries next-greater of a subset array.
- #248 **Sort K sorted array** → `merge-k-sorted-lists` — Practice for the same heap-merge technique.
- #326 **Merge 2 BST's** → `binary-search-tree-iterator` — Iterator used as a building block for merging two BSTs.
- #333 **Connected Components | Logic Explanation** → `number-of-connected-components-in-an-undirected-graph` — Premium LeetCode problem on the same idea.
- #349 **Cycle Detection in Directed Graph (DFS)** → `course-schedule-ii` — Cycle detection in a directed graph is the core of this problem.
- #399 **Partition Set Into 2 Subsets With Min Absolute Sum Diff (DP- 16)** → `partition-array-into-two-arrays-to-minimize-sum-difference` — LeetCode version requires two equal-sized halves.
- #435 **Evaluate Boolean Expression to True|(DP-52)** → `parsing-a-boolean-expression` — Parses and evaluates one expression; the sheet item counts ways to get True.
- #447 **Minimum number of bracket reversals needed to make an expression balanced** → `minimum-add-to-make-parentheses-valid` — Counts additions, not reversals.
- #449 **Hashing In Strings | Theory** → `find-the-index-of-the-first-occurrence-in-a-string` — Pattern-matching practice for string hashing.
- #450 **Rabin Karp** → `repeated-string-match` — Practice problem for Rabin-Karp.
- #451 **Z-Function** → `find-the-index-of-the-first-occurrence-in-a-string` — Pattern-matching practice for the Z-function.
- #452 **KMP algo / LPS(pi) array** → `find-the-index-of-the-first-occurrence-in-a-string` — Pattern-matching practice for KMP / LPS.

### Corrected

- #311 **Morris Preorder Traversal of a Binary Tree** → `binary-tree-preorder-traversal` (the sheet linked the *inorder* traversal problem)

### Added from the current official sheet (same problem)

- #227 **The Celebrity Problem** → `find-the-celebrity`
- #232 **Fruit Into Baskets** → `fruit-into-baskets`

## Data fixes

- #402: the mirror repeated Step 12's *Assign Cookies* at position DP-19. The sheet's DP-19 is **0/1 Knapsack** (confirmed by the current official sheet), so the title and links were corrected.
- The mirror's old `takeuforward.org/plus/dsa/problems/...` URLs now return 404 and were **not** used; current `practice/dsa/...` pages were used instead where they exist.
- Spelling only (no renames): #111 “Remove outermost Parenthesis”, #119 “Maximum Nesting Depth of Parenthesis”, #142 “Segregate odd and even nodes in LL”, #163 “Generate Parentheses”, #180 “Sudoku Solver”, #206 “Check for balanced parenthesis”, #254 “Connect n ropes with minimal cost”, #263 “Valid Parenthesis Checker”, #340 “Cycle Detection in undirected Graph (bfs)”, #359 “Dijkstra's Algorithm”, #360 “Why priority Queue is used in Dijkstra's Algorithm”, #368 “Floyd Warshall Algorithm”, #385 “Climbing Stairs”, #421 “Buy and Sell Stock IV |(DP-38)”.

## Items with no verified link (17)

Left empty on purpose rather than pointing at a guess. Several still show a *Related practice* link.

- #2 What are arrays, strings?
- #3 Data Types
- #7 While loops
- #122 Count Number of Substrings — has related practice link
- #165 Learn All Patterns of Subsequences (Theory)
- #187 Set/Unset the rightmost unset bit
- #191 Find the number that appears odd number of times — has related practice link
- #248 Sort K sorted array — has related practice link
- #261 Greedy algorithm to find minimum number of coins
- #271 Program for Least Recently Used (LRU) Page Replacement Algorithm
- #300 Root to Node Path in Binary Tree
- #316 Find Min/Max in BST
- #326 Merge 2 BST's — has related practice link
- #332 Graph Representation | Java
- #333 Connected Components | Logic Explanation — has related practice link
- #444 Bit PreRequisites for TRIE Problems
- #449 Hashing In Strings | Theory — has related practice link

## Regenerating

`scripts/a2z-build/` holds the Python used to produce the data file (`build.py` + the hand-curated `curation.py` + `emit.py`). Normally you just edit `data/a2zProblems.ts` directly and run `npm run validate:data`.
