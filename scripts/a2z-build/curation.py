"""
Manual curation for the classic A2Z sheet (keys are the 1-based roadmap order).

Every LeetCode link the sheet provides was audited against the item it is attached to.
  LC_DROP     : link is for an unrelated problem (or a theory lesson) -> removed entirely
  LC_RELATED  : link is the sheet's practice problem but NOT the identical problem
                -> shown only as "Related practice (not identical)", never as the Solve link
  LC_FIX      : sheet link points at the wrong LeetCode problem; replaced by the exact one
  LC_ADD      : sheet has no LeetCode link, but the current official TUF sheet lists the
                exact LeetCode problem for the same item
NEW_MATCH maps each classic item to the matching item of the current official sheet
(site/data.json order), used for its verified GeeksforGeeks + TakeUForward practice links.
"""
import json, re

GK = '/tmp/striver-a2z-sheet'

# ---------------------------------------------------------------- auto match
def _auto():
    cl = json.load(open('/home/claude/a2z/codolio_ordered.json'))
    new = json.load(open(f'{GK}/site/data.json'))['problems']
    def tufslug(u):
        m = re.search(r'takeuforward\.org/(?:plus/dsa/problems|practice/dsa)/([^/?#\\]+)', u or '')
        return m.group(1) if m else None
    def lcslug(u):
        m = re.search(r'leetcode\.com/problems/([^/?#]+)', u or '')
        return m.group(1) if m else None
    norm = lambda s: re.sub(r'[^a-z0-9]', '', (s or '').lower())
    bytuf, bylc, bytitle = {}, {}, {}
    for p in new:
        bytuf.setdefault(p['slug'], p['order'])
        if p['lcSlug']: bylc.setdefault(p['lcSlug'], p['order'])
        bytitle.setdefault(norm(p['title']), p['order'])
    out = {}
    for i, x in enumerate(cl, 1):
        u = x['questionId'].get('problemUrl'); t = x.get('title') or x['questionId'].get('name')
        out[i] = bytuf.get(tufslug(u)) or bytitle.get(norm(t)) or bylc.get(lcslug(u))
    return out

NEW_MATCH = _auto()
NEW_MATCH.update({
    # Basics
    19: 31, 25: 52, 26: 57, 27: 55, 31: 40, 30: None,
    # Sorting
    34: 63, 36: None, 37: None,
    # Arrays
    41: 38, 43: 70, 44: 71, 48: 74, 50: 191, 51: 99, 52: 99, 53: 86, 56: 90, 57: 90,
    58: 350, 72: 102, 73: 206,
    # Binary search
    79: 103, 84: 108, 85: None, 99: 122,
    # Strings
    111: None, 112: 392, 119: None, 120: None, 121: None, 122: None, 123: None, 124: None, 125: 392,
    # Linked list
    126: None, 127: 156, 128: 152, 129: None, 130: None, 131: None, 133: None, 134: None,
    135: 174, 136: 172, 137: 172, 142: 169, 144: 175, 149: 168, 156: 186,
    # Recursion
    157: None, 159: None, 160: None, 161: None, 162: None, 163: 135, 164: 136, 165: None,
    170: 141, 171: 142, 178: None, 181: None,
    # Bit manipulation
    182: None, 183: None, 184: None, 185: None, 186: None, 187: None, 188: None,
    189: 194, 190: 190, 191: None, 192: 195, 193: 196, 194: 193, 195: 401, 196: 35,
    197: 400, 198: 401, 199: 134,
    # Stack & queue
    206: 228, 207: 235, 208: None, 209: None, 210: None, 211: None, 212: None, 213: None,
    214: 229, 216: None, 217: None, 227: 241, 228: 242,
    # Sliding window
    234: 219, 236: 218, 237: 211, 239: 221, 241: None,
    # Heaps
    242: None, 243: 290, 244: 292, 246: 295, 247: None, 248: None, 249: None, 250: None,
    251: None, 252: None, 253: None, 254: None, 256: None, 257: None, 258: None,
    # Greedy
    261: None, 265: 200, 266: 210, 270: 201, 271: None, 273: 206,
    # Binary trees
    275: None, 276: None, 277: None, 278: None,
    279: 245, 280: 244, 281: 246, 282: 247, 283: 245, 284: 244, 285: 246, 286: 246,
    288: 249, 289: 251, 293: 256, 294: 257, 295: 258, 298: 261, 299: 254, 300: None,
    301: 263, 302: 264, 304: 265, 306: 267, 308: 270, 309: 271, 310: 272, 311: 274, 312: 273,
    # BST
    314: None, 315: 275, 316: None, 319: 277, 320: 278, 321: 279, 322: 280, 323: 281,
    325: 283, 326: None, 327: 285, 328: 286,
    # Graphs
    330: None, 331: None, 332: None, 333: None, 336: 299, 339: 301, 342: 304, 343: 305,
    344: 302, 345: 317, 346: 318, 347: 306, 348: 308, 349: 310, 352: 310, 353: 312,
    361: 321, 363: 323, 364: None, 369: 328, 376: 335, 378: 333, 380: None,
    # DP
    384: None, 385: 339, 388: 342, 389: 343, 391: 345, 392: 346, 393: None, 394: 348,
    395: None, 396: 349, 397: 355, 398: 356, 399: 357, 400: 358, 401: 359, 402: 360,
    403: 361, 404: 362, 405: 363, 406: 364, 407: 365, 408: 372, 409: None, 410: 373,
    411: 374, 412: 375, 413: 376, 414: 377, 415: 378, 416: 379, 417: 380, 418: 350,
    419: 351, 420: 352, 421: 353, 422: None, 423: 354, 424: 366, 425: 367, 426: 366,
    433: None, 434: 382, 435: 385, 436: 383, 437: 384, 438: 239, 439: None,
    # Tries / strings (hard)
    440: 386, 444: None, 446: 391, 447: 393, 449: None, 450: 395, 451: 396, 452: 397, 455: None,
})

# Theory / lesson items that the classic sheet links to an official learning page
# (tufId in data/raw/base_items.json, layout == "learning").
LEARN_MATCH = {9: 1219, 10: 1216, 11: 1218, 12: 1217, 20: 1199, 29: 1203, 126: 1237,
               131: 1234, 182: 1155, 242: 1223, 275: 1154, 314: 1153, 330: 1222,
               370: 1221, 384: 1195}

# ---------------------------------------------------------------- LeetCode audit
LC_DROP = {
    31,   # frequency-of-the-most-frequent-element: different problem (sliding window w/ k ops)
    165,  # distinct-subsequences-ii attached to a theory lesson
    347,  # number-of-distinct-islands-ii: the sheet item is Distinct Islands (I), not II
    444,  # single-number attached to a theory lesson ("Bit PreRequisites for TRIE")
    402,  # mirror duplicated Step 12's "Assign Cookies" here; the item is 0/1 Knapsack
}
LC_RELATED = {
    26: 'Reverses a character array, not a general array.',
    27: 'LeetCode version ignores non-alphanumeric characters.',
    41: 'LeetCode version also allows a rotation.',
    43: 'LeetCode rotates right by k; the sheet item is a left rotation by one.',
    44: 'LeetCode rotates right by k; the sheet item rotates left by D.',
    74: 'LeetCode version gives the first array extra space to merge into.',
    122: 'Same counting technique on integer arrays instead of substrings.',
    128: 'LeetCode version only gives access to the node being deleted.',
    191: 'LeetCode version: every other number appears exactly twice.',
    197: 'Practice for the Sieve: count primes below n.',
    214: 'LeetCode version queries next-greater of a subset array.',
    248: 'Practice for the same heap-merge technique.',
    326: 'Iterator used as a building block for merging two BSTs.',
    333: 'Premium LeetCode problem on the same idea.',
    349: 'Cycle detection in a directed graph is the core of this problem.',
    399: 'LeetCode version requires two equal-sized halves.',
    435: 'Parses and evaluates one expression; the sheet item counts ways to get True.',
    447: 'Counts additions, not reversals.',
    449: 'Pattern-matching practice for string hashing.',
    450: 'Practice problem for Rabin-Karp.',
    451: 'Pattern-matching practice for the Z-function.',
    452: 'Pattern-matching practice for KMP / LPS.',
}
LC_FIX = {
    311: 'binary-tree-preorder-traversal',  # sheet linked the inorder problem for Morris *pre*order
}
LC_ADD = {
    227: 'find-the-celebrity',   # official sheet: Celebrity Problem (LeetCode premium)
    232: 'fruit-into-baskets',   # official sheet: Fruit Into Baskets
}

# ---------------------------------------------------------------- titles
# Spelling fixes only (no renames); 402 is a data error in the mirror: position DP-19
# of the sheet is "0/1 Knapsack" (confirmed by the current official sheet), not
# a second copy of Step 12's "Assign Cookies".
TITLE_FIX = {
    180: 'Sudoku Solver', 142: 'Segregate odd and even nodes in LL',
    111: 'Remove outermost Parenthesis', 119: 'Maximum Nesting Depth of Parenthesis',
    163: 'Generate Parentheses', 206: 'Check for balanced parenthesis',
    263: 'Valid Parenthesis Checker', 359: "Dijkstra's Algorithm",
    360: "Why priority Queue is used in Dijkstra's Algorithm", 340: 'Cycle Detection in undirected Graph (bfs)',
    368: 'Floyd Warshall Algorithm', 385: 'Climbing Stairs', 421: 'Buy and Sell Stock IV |(DP-38)',
    402: '0/1 Knapsack (DP - 19)', 2: 'What are arrays, strings?',
    9: 'Time Complexity [Learn Basics, and then analyse in next Steps]', 10: 'Patterns',
    11: 'C++ STL', 12: 'Java Collections', 29: 'Hashing Theory',
    254: 'Connect n ropes with minimal cost',
}

# ---------------------------------------------------------------- non-TUF "other" links
# Only links whose target page was fetched and confirmed to be this problem.
OTHER_KEEP = {
    8: ('https://www.hackerrank.com/challenges/c-tutorial-functions/problem', 'HackerRank'),
    216: ('https://www.interviewbit.com/problems/nearest-smaller-element/', 'InterviewBit'),
    256: ('https://www.interviewbit.com/problems/maximum-sum-combinations/', 'InterviewBit'),
}

THEORY = {2, 3, 6, 7, 9, 10, 11, 12, 20, 29, 126, 131, 165, 182, 242, 275, 276,
          277, 278, 307, 314, 330, 331, 332, 333, 360, 384, 444, 449}

# LeetCode slugs not in the API snapshot, confirmed by fetching the problem page
# during this build (2026-09-23): slug -> (title, number, difficulty, premium).
WEBFETCH_CONFIRMED_LC = {
    'missing-number': ('Missing Number', 268, 'Easy', False),
    'maximum-subarray': ('Maximum Subarray', 53, 'Medium', False),
    'remove-outermost-parentheses': ('Remove Outermost Parentheses', 1021, 'Easy', False),
    'maximum-nesting-depth-of-the-parentheses': ('Maximum Nesting Depth of the Parentheses', 1614, 'Easy', False),
    'roman-to-integer': ('Roman to Integer', 13, 'Easy', False),
    'string-to-integer-atoi': ('String to Integer (atoi)', 8, 'Medium', False),
    'longest-palindromic-substring': ('Longest Palindromic Substring', 5, 'Medium', False),
    'sum-of-beauty-of-all-substrings': ('Sum of Beauty of All Substrings', 1781, 'Medium', False),
    'count-good-numbers': ('Count Good Numbers', 1922, 'Medium', False),
    'word-break': ('Word Break', 139, 'Medium', False),
    'expression-add-operators': ('Expression Add Operators', 282, 'Hard', False),
    'power-of-two': ('Power of Two', 231, 'Easy', False),
    'minimum-window-subsequence': ('Minimum Window Subsequence', 727, 'Hard', True),
    'kth-largest-element-in-an-array': ('Kth Largest Element in an Array', 215, 'Medium', False),
    'merge-k-sorted-lists': ('Merge k Sorted Lists', 23, 'Hard', False),
    'task-scheduler': ('Task Scheduler', 621, 'Medium', False),
    'hand-of-straights': ('Hand of Straights', 846, 'Medium', False),
    'design-twitter': ('Design Twitter', 355, 'Medium', False),
    'find-median-from-data-stream': ('Find Median from Data Stream', 295, 'Hard', False),
    'top-k-frequent-elements': ('Top K Frequent Elements', 347, 'Medium', False),
    'network-delay-time': ('Network Delay Time', 743, 'Medium', False),
    'swim-in-rising-water': ('Swim in Rising Water', 778, 'Hard', False),
    'minimum-falling-path-sum': ('Minimum Falling Path Sum', 931, 'Medium', False),
    'best-time-to-buy-and-sell-stock-with-cooldown': ('Best Time to Buy and Sell Stock with Cooldown', 309, 'Medium', False),
    'minimum-cost-to-cut-a-stick': ('Minimum Cost to Cut a Stick', 1547, 'Hard', False),
    'count-square-submatrices-with-all-ones': ('Count Square Submatrices with All Ones', 1277, 'Medium', False),
}

# TakeUForward pages for items the current official sheet no longer lists. The mirror's
# old /plus/dsa/problems/... urls now 404, so each was re-checked at its current
# /practice/dsa/<slug> (or article) address and the page heading compared with the
# item on 2026-09-23. Anything that 404'd or showed a different problem is left out.
_P = 'https://takeuforward.org/practice/dsa/'
TUF_CONFIRMED = {
    1: _P + 'input-output', 4: _P + 'if-elseif', 5: _P + 'switch-case',
    6: 'https://takeuforward.org/for-loop/understanding-for-loop/',
    21: 'https://takeuforward.org/recursion/print-name-n-times-using-recursion/',
    22: _P + 'print-1-to-n-using-recursion', 23: _P + 'print-n-to-1-using-recursion',
    30: _P + 'counting-frequencies-of-array-elements',
    36: _P + 'recursive-bubble-sort', 37: _P + 'recursive-insertion-sort',
    85: _P + 'count-occurrences-in-a-sorted-array',
    129: _P + 'find-the-length-of-the-linked-list', 130: _P + 'search-in-linked-list',
    133: _P + 'delete-head-of-dll', 134: _P + 'reverse-a-doubly-linked-list',
    160: _P + 'sort-a-stack', 161: _P + 'reverse-a-stack',
    162: _P + 'generate-binary-strings-without-consecutive-1s',
    183: _P + 'check-if-the-i-th-bit-is-set-or-not', 184: _P + 'check-if-a-number-is-odd-or-not',
    186: _P + 'count-the-number-of-set-bits', 188: _P + 'swap-two-numbers',
    208: _P + 'infix-to-postfix-conversion', 209: _P + 'prefix-to-infix-conversion',
    210: _P + 'prefix-to-postfix-conversion', 211: _P + 'postfix-to-prefix-conversion',
    212: _P + 'postfix-to-infix-conversion', 213: _P + 'infix-to-prefix-conversion',
    217: _P + 'number-of-greater-elements-to-the-right',
    247: _P + 'kth-smallest-element-in-an-array',
    250: 'https://takeuforward.org/data-structure/replace-elements-by-its-rank-in-the-array/',
    254: _P + 'minimum-cost-to-connect-sticks',
    276: 'https://takeuforward.org/binary-tree/binary-tree-representation-in-c/',
    277: 'https://takeuforward.org/binary-tree/binary-tree-representation-in-java/',
    278: 'https://takeuforward.org/binary-tree/binary-tree-traversal-inorder-preorder-postorder/',
    331: 'https://takeuforward.org/graph/graph-representation-in-c/',
    409: _P + 'print-longest-common-subsequence',
    455: _P + 'count-palindromic-subsequences',
}

# ================================================================ re-audit (round 2)
# GeeksforGeeks links from the current-sheet match that are NOT the identical problem.
GFG_DROP = {
    46: 'GfG page is "Binary Search", not linear search',
}
GFG_RELATED = {
    51: 'GfG version allows negative numbers (that is #52); this item is positives-only.',
    57: 'GfG version only returns the maximum sum, not the subarray itself.',
    243: 'GfG page covers the min-heap half only.',
    360: 'Practice for Dijkstra; this item is the theory of why a priority queue is used.',
}
# exact LeetCode equivalents confirmed in round 2
LC_ADD.update({
    426: 'longest-increasing-subsequence',  # DP-43 is LIS solved with binary search: same problem
})

# ---------------------------------------------------------------- articles
# TakeUForward blog articles, reviewed one by one against the item (slug listed in
# takeuforward.org/sitemap.xml on 2026-09-23; ambiguous ones were opened and read).
_B = 'https://takeuforward.org/blogs/data-structure-and-algorithm/'
ARTICLE_MANUAL = {
    31: 'highest-freq-element', 48: 'missing-number-solutions', 54: 'sort-array-0s-1s-2s',
    58: 'best-time-to-buy-and-sell-stock', 62: 'longest-consecutive-sequence-in-an-array',
    73: 'merge-overlapping-intervals', 76: 'count-inversions-in-an-array-using-merge-sort',
    90: 'single-element-in-a-sorted-array', 100: 'book-allocation-problem',
    104: 'median-of-2-sorted-arrays', 105: 'kth-element-of-two-sorted-arrays',
    107: 'search-in-sorted-2d-matrix', 112: 'reverse-every-word-in-a-string',
    118: 'sort-characters-by-frequency', 125: 'reverse-every-word-in-a-string',
    135: 'find-middle-of-linked-list', 136: 'reverse-a-singly-linked-list',
    138: 'detect-cycle-linked-list', 139: 'find-start-of-cycle-linked-list',
    141: 'check-if-a-linked-list-is-a-palindrome', 142: 'segregate-odd-and-even-nodes-in-linked-list',
    143: 'remove-the-nth-node-from-the-end-of-a-linked-list', 147: 'intersection-of-two-linked-lists',
    149: 'add-two-numbers-linked-lists-reverse-order', 151: 'find-pairs-with-given-sum-in-doubly-linked-list',
    153: 'reverse-linked-list-k-groups', 154: 'rotate-linked-list-right-k-places',
    155: 'flatten-linked-list',
    158: 'fast-power-one-shot-binary-exponentiation-modular-exponentiation-and-powx-n',
    159: 'count-good-numbers',
    199: 'fast-power-one-shot-binary-exponentiation-modular-exponentiation-and-powx-n',
    230: 'longest-substring-without-repeating-characters', 240: 'minimum-window-substring',
    242: 'introduction-to-heap', 243: 'introduction-to-heap',
    246: 'k-th-largest-element-in-an-array', 247: 'k-th-smallest-element-in-an-array',
    249: 'merge-k-sorted-linked-lists', 251: 'task-scheduler', 255: 'kth-largest-element-stream',
    257: 'find-median-data-stream', 258: 'top-k-frequent-elements', 259: 'assign-cookies',
    261: 'minimum-number-of-coins', 273: 'merge-overlapping-intervals',
    275: 'binary-tree-data-structure', 298: 'left-and-right-views-of-a-binary-tree',
    299: 'symmetric-binary-tree', 307: 'requirements-needed-to-construct-a-unique-binary-tree',
    311: 'morris-preorder-traversal', 312: 'morris-inorder-traversal',
    315: 'search-in-a-binary-search-tree', 317: 'floor-and-ceil-in-a-bst', 318: 'floor-and-ceil-in-a-bst',
    319: 'insert-into-a-binary-search-tree', 320: 'delete-node-in-a-bst',
    321: 'kth-smallest-and-largest-elements-in-a-bst', 322: 'validate-binary-search-tree',
    323: 'lowest-common-ancestor-of-a-binary-search-tree', 324: 'construct-a-bst-from-preorder-traversal',
    325: 'inorder-successor-and-predecessor-in-a-bst', 327: 'two-sum-in-bst',
    328: 'recover-binary-search-tree', 329: 'largest-bst-in-binary-tree', 330: 'introduction-to-graph',
    339: 'flood-fill-algorithm', 340: 'detect-a-cycle-in-an-undirected-graph',
    341: 'detect-a-cycle-in-an-undirected-graph', 347: 'number-of-distinct-islands',
    349: 'detect-a-cycle-in-a-directed-graph', 352: 'detect-a-cycle-in-a-directed-graph',
    353: 'course-schedule-i', 354: 'course-schedule-ii', 355: 'find-eventual-safe-states',
    359: 'dijkstras-algorithm', 364: 'network-delay-time', 367: 'bellman-ford-algorithm',
    371: 'prims-algorithm', 374: 'kruskals-algorithm-minimum-spanning-tree',
    379: 'making-a-large-island', 383: 'kosarajus-algorithm',
    388: 'maximum-sum-of-non-adjacent-elements', 391: 'grid-unique-paths', 393: 'minimum-path-sum',
    395: 'minimum-falling-path-sum', 397: 'subset-sum-equal-to-target', 405: 'coin-change-ii-combinations',
    407: 'rod-cutting-problem', 418: 'best-time-to-buy-and-sell-stock',
    422: 'best-time-to-buy-and-sell-stock-with-cooldown', 425: 'print-longest-increasing-subsequence',
    442: 'longest-word-with-all-prefixes', 443: 'number-of-distinct-substrings-in-a-string',
    449: 'string-hashing-rolling-hash', 451: 'z-function', 453: 'shortest-palindrome',
}
ARTICLE_MANUAL = {k: _B + v for k, v in ARTICLE_MANUAL.items()}
# Auto-matched articles rejected on review (article covers a different variant).
ARTICLE_REJECT = {137: 'article covers the iterative approach only'}
