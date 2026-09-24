"""Emit data/a2zLinkReview.ts — human-reviewed exceptions the validator checks against."""
import json
J = lambda v: json.dumps(v, ensure_ascii=False)
SHARED = [
    ([18, 196], 'The sheet lists "all divisors" twice (Basic Maths and Advanced Maths).'),
    ([51, 52], 'One TakeUForward practice page covers both the positives-only and the general variant.'),
    ([56, 57], 'Kadane: #57 extends #56 to print the subarray; same practice page.'),
    ([58, 418], 'The sheet lists this problem twice (Arrays and DP on Stocks).'),
    ([73, 273], 'The sheet lists Merge Intervals twice (Arrays and Greedy).'),
    ([112, 125], 'The sheet lists reverse-words twice (Strings basic and medium).'),
    ([121, 157], 'Same problem: iterative (#121) vs recursive (#157) implementation.'),
    ([136, 137], 'Same problem: iterative vs recursive reversal.'),
    ([158, 199], 'The sheet lists Pow(x, n) twice (Recursion and Advanced Maths).'),
    ([164, 192], 'Same problem: power set by recursion (#164) vs bit masks (#192).'),
    ([195, 198], 'Same problem: trial division (#195) vs sieve (#198).'),
    ([224, 438], 'The sheet lists Maximal Rectangle twice (Stack and DP on Squares).'),
    ([242, 243], 'One introductory heap article covers both lessons.'),
    ([279, 283, 311], 'Same traversal: recursive, iterative and Morris.'),
    ([280, 284, 312], 'Same traversal: recursive, iterative and Morris.'),
    ([281, 285, 286], 'Same traversal: recursive, two-stack and one-stack.'),
    ([317, 318], 'One practice page / article covers floor and ceil together.'),
    ([334, 335], 'One practice page covers both BFS and DFS traversal.'),
    ([340, 341], 'Same problem: BFS vs DFS cycle detection.'),
    ([349, 352], 'Same problem: DFS vs BFS (Kahn) cycle detection.'),
    ([350, 351], "Kahn's algorithm is a topological sort: same practice problem."),
    ([359, 360], 'Theory lesson paired with the Dijkstra practice page.'),
    ([370, 371, 374], 'MST theory, Prim and Kruskal all practise on the MST-weight problem.'),
    ([372, 373], 'Union by rank vs union by size: same disjoint-set problem.'),
    ([424, 426], 'Same problem: LIS by DP (#424) vs binary search (#426).'),
    ([431, 432], 'Same problem: memoization (#431) vs tabulation (#432).'),
]
EQUIV = {
    '16:gfg': 'GCD and HCF are the same thing.',
    '47:gfg': 'Union of two sorted arrays.',
    '53:leetcode': 'Two Sum.',
    '59:leetcode': 'Rearrange by sign, alternating positive/negative (variant 1).',
    '66:leetcode': 'Count subarrays whose sum equals k.',
    '69:leetcode': '3Sum.', '70:leetcode': '4Sum.',
    '76:gfg': 'Count inversions.',
    '110:gfg': 'Median of a row-wise sorted matrix.',
    '121:leetcode': 'atoi.', '157:leetcode': 'atoi (solved recursively).',
    '135:leetcode': 'Middle of the linked list.',
    '136:leetcode': 'Reverse a linked list.', '137:leetcode': 'Reverse a linked list (recursively).',
    '138:leetcode': 'Detect a cycle.', '139:leetcode': 'Start of the cycle.',
    '141:leetcode': 'Palindrome linked list.', '147:leetcode': 'Intersection point of two lists.',
    '155:gfg': 'Flatten a list with sorted bottom pointers.',
    '164:leetcode': 'Power set = all subsets.', '192:leetcode': 'Power set = all subsets.',
    '171:leetcode': 'Unique subsets (Subsets II).',
    '190:leetcode': 'Bits to flip from A to B.',
    '206:leetcode': 'Balanced parentheses.', '218:leetcode': 'Trapping rain water.',
    '292:leetcode': 'Identical trees.', '301:leetcode': 'Lowest common ancestor.',
    '322:leetcode': 'Validate BST.', '328:leetcode': 'Recover a BST with two swapped nodes.',
    '337:gfg': 'Graph given as an adjacency matrix: GfG names it Number of Provinces.',
    '351:gfg': "Kahn's algorithm is topological sort.",
    '358:gfg': 'Shortest path in a DAG.', '359:gfg': "Dijkstra's algorithm.",
    '381:leetcode': 'Bridges = critical connections.',
    '388:leetcode': 'Max sum of non-adjacent elements is House Robber.',
    '394:leetcode': 'Minimum path sum in a triangle.',
    '396:gfg': '"Ninja and his friends" is Cherry/Chocolate Pickup II.',
    '403:leetcode': 'Minimum coins for an amount (DP) is Coin Change.',
    '413:leetcode': 'Min insertions/deletions to convert = Delete Operation for Two Strings.',
    '420:leetcode': 'Stock III.',
}
out = ['''/**
 * Human-reviewed exceptions used by the dataset validator (npm run validate:data).
 *
 * SHARED_LINK_GROUPS — the same external URL may appear on several items ONLY when
 *   listed here with the reason (the sheet repeats a problem, or teaches one problem with
 *   several techniques). Any other repeated URL fails validation.
 * REVIEWED_EQUIVALENTS — exact links whose platform slug looks different from the sheet's
 *   title. Each was checked to be the same problem; unreviewed look-alikes fail validation.
 */
export const SHARED_LINK_GROUPS: { ids: number[]; reason: string }[] = [''']
for ids, r in SHARED: out.append(f'  {{ ids: {J(ids)}, reason: {J(r)} }},')
out.append('];\n')
out.append('export const REVIEWED_EQUIVALENTS: Record<string, string> = {')
for k, v in EQUIV.items(): out.append(f'  {J(k)}: {J(v)},')
out.append('};\n')
open('/home/claude/dsa-roadmap/data/a2zLinkReview.ts', 'w').write('\n'.join(out))
print('ok', len(SHARED), len(EQUIV))
