# A2Z DATA AUDIT

Generated from `scripts/a2z-build` (round 2 audit, 2026-09-23). Run `npm run validate:data` for the live check.

```text
A2Z DATA AUDIT
==============

Total entries:         455
Coding problems:       426
Theory/Lesson entries: 29

Topic breakdown:

Learn the Basics:      31
Sorting:               7
Arrays:                40
Binary Search:         32
Strings:               24
Linked List:           31
Recursion:             25
Bit Manipulation:      18
Stack & Queue:         30
Sliding Window:        12
Heap:                  17
Greedy:                16
Binary Trees:          39
BST:                   16
Graphs:                54
Dynamic Programming:   56
Tries:                 7

Links:

Exact LeetCode:        250
Related LeetCode:      22
Exact GFG:             72
Related GFG:           4
TakeUForward practice: 389
Other (IB/HackerRank): 3
Code360:               0
Articles:              267
No practice link:      38  (23 of them have an article)
No verified link at all: 15
```

## Source of truth and scope

The app follows the **classic 18-step A2Z roadmap (455 entries)** — the Step 1–18 structure you asked for. Every entry was cross-checked against the **current official takeuforward.org sheet** (2026, 402 practice problems in 19 re-organised modules): 333 of its problems map onto classic entries and supplied verified GfG/TakeUForward/article links. The other 69 current-sheet problems are *not in the classic roadmap* (mostly finer splits such as Pattern 1–22 and individual linked-list insert/delete variants). They were **not** added, because adding them would change the roadmap you chose and push the count toward an arbitrary number — see the list at the end. The count stays 455; nothing was invented.

## Verification level of every link

- LeetCode (250): 223 confirmed by LeetCode's own API, 27 by opening the problem page (title, number, difficulty).
- GeeksforGeeks (72): each page fetched and its title/slug matched to the problem (geckguy/striver-a2z-sheet, 2026-09-20), then re-reviewed by hand in this audit.
- TakeUForward practice (389): HTTP-200 checked 2026-09-20 or opened during the audit.
- Articles (267): 158 HTTP-200 checked (official-sheet article links), 96 listed in takeuforward.org/sitemap.xml and matched by hand (ambiguous ones opened and read), 7 opened and read, 6 official lesson pages from the sheet's own navigation.

## Issues found and fixed in this audit

- #46 **Linear Search** — GfG link removed: GfG page is "Binary Search", not linear search.
- #51 **Longest subarray with given sum K(positives)** — GfG link moved to *Related practice*: GfG version allows negative numbers (that is #52); this item is positives-only.
- #57 **Print subarray with maximum subarray sum (extended version of above problem)** — GfG link moved to *Related practice*: GfG version only returns the maximum sum, not the subarray itself.
- #243 **Min Heap and Max Heap Implementation** — GfG link moved to *Related practice*: GfG page covers the min-heap half only.
- #360 **Why priority Queue is used in Dijkstra's Algorithm** — GfG link moved to *Related practice*: Practice for Dijkstra; this item is the theory of why a priority queue is used.
- #426 **Longest Increasing Subsequence |(DP-43)** — missing exact LeetCode link added: `longest-increasing-subsequence`.
- 21 lesson/article pages were being shown as "Solve on TakeUForward"; they are now **Read Article** links and no longer count as practice links (#6, #9, #10, #11, #12, #20, #21, #29, #126, #131, #182, #242, #250, #275, #276, #277, #278, #314, #330, #331, #384).
- #137 **Reverse a LL [Recursive]** — auto-matched article rejected: article covers the iterative approach only.
- Articles added: 0 → 267; every one is for the same problem (TakeUForward).
- Difficulty for #347 and #402 now comes from their verified GfG page instead of the (removed) LeetCode link.
- Validator extended: required fields, duplicate external URLs (must be in a reviewed group), exact-vs-related classification (look-alike links must be reviewed), article URL rules, counts by topic.

**Issues fixed in this audit: 11** (plus the 5 removed, 22 related-only and 1 corrected LeetCode links from the first audit, still enforced).

## Issues remaining (documented, not guessed)

- **15 entries have no verified practice link or article:** #2 What are arrays, strings?; #3 Data Types; #7 While loops; #122 Count Number of Substrings; #165 Learn All Patterns of Subsequences (Theory); #187 Set/Unset the rightmost unset bit; #191 Find the number that appears odd number of times; #248 Sort K sorted array; #271 Program for Least Recently Used (LRU) Page Replacement Algorithm; #300 Root to Node Path in Binary Tree; #316 Find Min/Max in BST; #326 Merge 2 BST's; #332 Graph Representation | Java; #333 Connected Components | Logic Explanation; #444 Bit PreRequisites for TRIE Problems.
- **23 difficulties** come from the sheet mirror, which took them from a non-identical linked problem; no independent source was found: #26, #27, #31, #43, #44, #74, #122, #128, #165, #191, #197, #214, #248, #326, #333, #349, #399, #435, #444, #447, #449, #450, #452.
- **Code360:** no link could be verified, so none is listed.
- **96 sitemap-matched articles** exist in TakeUForward's sitemap and were matched by slug + manual review, but were not each opened individually.
- **69 current-sheet problems are outside the classic roadmap** (listed below).

## Current-sheet problems not in the classic roadmap

- **Beginner Problems**: Pattern 1, Pattern 2, Pattern 3, Pattern 4, Pattern 5, Pattern 6, Pattern 7, Pattern 8, Pattern 9, Pattern 10, Pattern 11, Pattern 12, Pattern 13, Pattern 14, Pattern 15, Pattern 16, Pattern 17, Pattern 18, Pattern 19, Pattern 20, Pattern 21, Pattern 22, Count number of odd digits in a number, Return the Largest Digit in a Number, Factorial of a given number, Check for Perfect Number, Count of Prime Numbers till N, LCM of two numbers, Sum of Array Elements, Count of odd numbers in Array, Reverse an array, Second Highest Occurring Element, Sum of Highest and Lowest Frequency, Reverse a String II, Palindrome Check, Sum of Array Elements II, Reverse a String I, Check if a Number is Prime or Not, Check if the Array is Sorted II, Sum of Digits in a Given Number
- **Arrays**: Intersection of two sorted arrays, Pascal's Triangle II, Pascal's Triangle III
- **Linked-List**: Traversal in Linked List, Deletion of the tail of Linked List, Deletion of the Kth element of Linked List, Delete the element with value X, Insertion at the tail of Linked List, Insertion at the Kth position of Linked List, Insertion before the value X in Linked List, Convert Array to Doubly Linked List, Delete Tail of Doubly Linked List, Delete Kth Element of Doubly Linked List, Removing given node in Doubly Linked List, Insert node before tail in Doubly Linked List, Insert node before (kth node) in Doubly Linked List, Insert before given node in Doubly Linked List, Merge two Sorted Lists
- **Bit Manipulation**: Single Number - II
- **Binary Trees**: Print root to leaf path in BT
- **Binary Search Trees**: BST iterator
- **Heaps**: Heapify Algorithm, Build heap from a given Array, Implement Max Heap, Heap Sort
- **Graphs**: Number of islands, Print Shortest Path
- **Dynamic Programming**: Minimum Falling Path Sum
- **Maths**: Count primes in range L to R
