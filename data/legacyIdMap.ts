/**
 * Migration map from the original 152-problem starter dataset (storage version 1) to the
 * A2Z dataset (storage version 2). Used once, automatically, by the persisted store's
 * `migrate` step and when importing an old export file.
 *
 *  - number -> the A2Z problem that is the SAME LeetCode problem (first occurrence in
 *    roadmap order). Completion date, bookmark, notes, mistakes and code move over.
 *  - null   -> no identical problem in the A2Z sheet. Nothing is deleted: that progress is
 *    kept in `legacy` storage, included in exports, and listed under Settings.
 */
export const LEGACY_ID_MAP: Record<number, number | null> = {
  1: 14, // Reverse Integer
  2: 15, // Palindrome Number
  3: null, // Plus One
  4: 42, // Remove Duplicates from Sorted Array
  5: null, // Contains Duplicate
  6: 50, // Single Number
  7: 48, // Missing Number
  8: 55, // Majority Element
  9: null, // Sort an Array
  10: 54, // Sort Colors
  11: null, // Merge Sorted Array
  12: 246, // Kth Largest Element in an Array
  13: 53, // Two Sum
  14: 58, // Best Time to Buy and Sell Stock
  15: 56, // Maximum Subarray
  16: null, // Rotate Array
  17: 60, // Next Permutation
  18: 63, // Set Matrix Zeroes
  19: null, // Product of Array Except Self
  20: 218, // Trapping Rain Water
  21: 69, // 3Sum
  22: 73, // Merge Intervals
  23: 272, // Insert Interval
  24: null, // Find the Duplicate Number
  25: 65, // Spiral Matrix
  26: 79, // Binary Search
  27: 82, // Search Insert Position
  28: 86, // Search in Rotated Sorted Array
  29: 88, // Find Minimum in Rotated Sorted Array
  30: 84, // Find First and Last Position of Element in Sorted Array
  31: 107, // Search a 2D Matrix
  32: 94, // Koko Eating Bananas
  33: 97, // Capacity To Ship Packages Within D Days
  34: 104, // Median of Two Sorted Arrays
  35: null, // Sqrt(x)
  36: 136, // Reverse Linked List
  37: 135, // Middle of the Linked List
  38: null, // Merge Two Sorted Lists
  39: 143, // Remove Nth Node From End of List
  40: 138, // Linked List Cycle
  41: 139, // Linked List Cycle II
  42: null, // Reorder List
  43: 149, // Add Two Numbers
  44: 156, // Copy List with Random Pointer
  45: 249, // Merge k Sorted Lists
  46: 141, // Palindrome Linked List
  47: 147, // Intersection of Two Linked Lists
  48: 228, // LRU Cache
  49: 164, // Subsets
  50: 171, // Subsets II
  51: null, // Permutations
  52: 168, // Combination Sum
  53: 169, // Combination Sum II
  54: 163, // Generate Parentheses
  55: 173, // Letter Combinations of a Phone Number
  56: 176, // N-Queens
  57: 175, // Word Search
  58: 174, // Palindrome Partitioning
  59: null, // Single Number II
  60: null, // Single Number III
  61: null, // Number of 1 Bits
  62: null, // Counting Bits
  63: null, // Reverse Bits
  64: null, // Sum of Two Integers
  65: 185, // Power of Two
  66: null, // Bitwise AND of Numbers Range
  67: 206, // Valid Parentheses
  68: 207, // Min Stack
  69: null, // Evaluate Reverse Polish Notation
  70: null, // Daily Temperatures
  71: null, // Next Greater Element I
  72: 223, // Largest Rectangle in Histogram
  73: 203, // Implement Queue using Stacks
  74: 220, // Asteroid Collision
  75: null, // Two Sum II - Input Array Is Sorted
  76: 230, // Longest Substring Without Repeating Characters
  77: 233, // Longest Repeating Character Replacement
  78: null, // Permutation in String
  79: 240, // Minimum Window Substring
  80: 225, // Sliding Window Maximum
  81: null, // Container With Most Water
  82: 232, // Fruit Into Baskets
  83: 258, // Top K Frequent Elements
  84: 257, // Find Median from Data Stream
  85: 251, // Task Scheduler
  86: null, // K Closest Points to Origin
  87: null, // Last Stone Weight
  88: null, // Kth Smallest Element in a Sorted Matrix
  89: 265, // Jump Game
  90: 266, // Jump Game II
  91: null, // Gas Station
  92: 269, // Candy
  93: null, // Partition Labels
  94: 274, // Non-overlapping Intervals
  95: 288, // Maximum Depth of Binary Tree
  96: 292, // Same Tree
  97: null, // Invert Binary Tree
  98: 282, // Binary Tree Level Order Traversal
  99: 290, // Diameter of Binary Tree
  100: 289, // Balanced Binary Tree
  101: null, // Path Sum
  102: 298, // Binary Tree Right Side View
  103: 301, // Lowest Common Ancestor of a Binary Tree
  104: 308, // Construct Binary Tree from Preorder and Inorder Traversal
  105: 291, // Binary Tree Maximum Path Sum
  106: 299, // Symmetric Tree
  107: null, // Subtree of Another Tree
  108: 310, // Serialize and Deserialize Binary Tree
  109: 322, // Validate Binary Search Tree
  110: 323, // Lowest Common Ancestor of a Binary Search Tree
  111: 321, // Kth Smallest Element in a BST
  112: 319, // Insert into a Binary Search Tree
  113: 320, // Delete Node in a BST
  114: null, // Convert Sorted Array to Binary Search Tree
  115: 327, // Two Sum IV - Input is a BST
  116: null, // Number of Islands
  117: null, // Clone Graph
  118: 353, // Course Schedule
  119: 354, // Course Schedule II
  120: null, // Pacific Atlantic Water Flow
  121: 338, // Rotting Oranges
  122: 345, // Word Ladder
  123: null, // Redundant Connection
  124: 364, // Network Delay Time
  125: 336, // Number of Provinces
  126: 343, // Surrounded Regions
  127: 348, // Is Graph Bipartite?
  128: 363, // Cheapest Flights Within K Stops
  129: 385, // Climbing Stairs
  130: 388, // House Robber
  131: 389, // House Robber II
  132: 424, // Longest Increasing Subsequence
  133: 403, // Coin Change
  134: 405, // Coin Change II
  135: 391, // Unique Paths
  136: 392, // Unique Paths II
  137: 408, // Longest Common Subsequence
  138: 416, // Edit Distance
  139: 178, // Word Break
  140: 398, // Partition Equal Subset Sum
  141: 404, // Target Sum
  142: null, // Decode Ways
  143: 78, // Maximum Product Subarray
  144: 422, // Best Time to Buy and Sell Stock with Cooldown
  145: 123, // Longest Palindromic Substring
  146: null, // Palindromic Substrings
  147: null, // Interleaving String
  148: 440, // Implement Trie (Prefix Tree)
  149: null, // Design Add and Search Words Data Structure
  150: null, // Word Search II
  151: null, // Replace Words
  152: null, // Longest Word in Dictionary
};

/** Titles of the original starter-dataset problems, for showing preserved legacy progress. */
export const LEGACY_TITLES: Record<number, string> = {
  1: "Reverse Integer",
  2: "Palindrome Number",
  3: "Plus One",
  4: "Remove Duplicates from Sorted Array",
  5: "Contains Duplicate",
  6: "Single Number",
  7: "Missing Number",
  8: "Majority Element",
  9: "Sort an Array",
  10: "Sort Colors",
  11: "Merge Sorted Array",
  12: "Kth Largest Element in an Array",
  13: "Two Sum",
  14: "Best Time to Buy and Sell Stock",
  15: "Maximum Subarray",
  16: "Rotate Array",
  17: "Next Permutation",
  18: "Set Matrix Zeroes",
  19: "Product of Array Except Self",
  20: "Trapping Rain Water",
  21: "3Sum",
  22: "Merge Intervals",
  23: "Insert Interval",
  24: "Find the Duplicate Number",
  25: "Spiral Matrix",
  26: "Binary Search",
  27: "Search Insert Position",
  28: "Search in Rotated Sorted Array",
  29: "Find Minimum in Rotated Sorted Array",
  30: "Find First and Last Position of Element in Sorted Array",
  31: "Search a 2D Matrix",
  32: "Koko Eating Bananas",
  33: "Capacity To Ship Packages Within D Days",
  34: "Median of Two Sorted Arrays",
  35: "Sqrt(x)",
  36: "Reverse Linked List",
  37: "Middle of the Linked List",
  38: "Merge Two Sorted Lists",
  39: "Remove Nth Node From End of List",
  40: "Linked List Cycle",
  41: "Linked List Cycle II",
  42: "Reorder List",
  43: "Add Two Numbers",
  44: "Copy List with Random Pointer",
  45: "Merge k Sorted Lists",
  46: "Palindrome Linked List",
  47: "Intersection of Two Linked Lists",
  48: "LRU Cache",
  49: "Subsets",
  50: "Subsets II",
  51: "Permutations",
  52: "Combination Sum",
  53: "Combination Sum II",
  54: "Generate Parentheses",
  55: "Letter Combinations of a Phone Number",
  56: "N-Queens",
  57: "Word Search",
  58: "Palindrome Partitioning",
  59: "Single Number II",
  60: "Single Number III",
  61: "Number of 1 Bits",
  62: "Counting Bits",
  63: "Reverse Bits",
  64: "Sum of Two Integers",
  65: "Power of Two",
  66: "Bitwise AND of Numbers Range",
  67: "Valid Parentheses",
  68: "Min Stack",
  69: "Evaluate Reverse Polish Notation",
  70: "Daily Temperatures",
  71: "Next Greater Element I",
  72: "Largest Rectangle in Histogram",
  73: "Implement Queue using Stacks",
  74: "Asteroid Collision",
  75: "Two Sum II - Input Array Is Sorted",
  76: "Longest Substring Without Repeating Characters",
  77: "Longest Repeating Character Replacement",
  78: "Permutation in String",
  79: "Minimum Window Substring",
  80: "Sliding Window Maximum",
  81: "Container With Most Water",
  82: "Fruit Into Baskets",
  83: "Top K Frequent Elements",
  84: "Find Median from Data Stream",
  85: "Task Scheduler",
  86: "K Closest Points to Origin",
  87: "Last Stone Weight",
  88: "Kth Smallest Element in a Sorted Matrix",
  89: "Jump Game",
  90: "Jump Game II",
  91: "Gas Station",
  92: "Candy",
  93: "Partition Labels",
  94: "Non-overlapping Intervals",
  95: "Maximum Depth of Binary Tree",
  96: "Same Tree",
  97: "Invert Binary Tree",
  98: "Binary Tree Level Order Traversal",
  99: "Diameter of Binary Tree",
  100: "Balanced Binary Tree",
  101: "Path Sum",
  102: "Binary Tree Right Side View",
  103: "Lowest Common Ancestor of a Binary Tree",
  104: "Construct Binary Tree from Preorder and Inorder Traversal",
  105: "Binary Tree Maximum Path Sum",
  106: "Symmetric Tree",
  107: "Subtree of Another Tree",
  108: "Serialize and Deserialize Binary Tree",
  109: "Validate Binary Search Tree",
  110: "Lowest Common Ancestor of a Binary Search Tree",
  111: "Kth Smallest Element in a BST",
  112: "Insert into a Binary Search Tree",
  113: "Delete Node in a BST",
  114: "Convert Sorted Array to Binary Search Tree",
  115: "Two Sum IV - Input is a BST",
  116: "Number of Islands",
  117: "Clone Graph",
  118: "Course Schedule",
  119: "Course Schedule II",
  120: "Pacific Atlantic Water Flow",
  121: "Rotting Oranges",
  122: "Word Ladder",
  123: "Redundant Connection",
  124: "Network Delay Time",
  125: "Number of Provinces",
  126: "Surrounded Regions",
  127: "Is Graph Bipartite?",
  128: "Cheapest Flights Within K Stops",
  129: "Climbing Stairs",
  130: "House Robber",
  131: "House Robber II",
  132: "Longest Increasing Subsequence",
  133: "Coin Change",
  134: "Coin Change II",
  135: "Unique Paths",
  136: "Unique Paths II",
  137: "Longest Common Subsequence",
  138: "Edit Distance",
  139: "Word Break",
  140: "Partition Equal Subset Sum",
  141: "Target Sum",
  142: "Decode Ways",
  143: "Maximum Product Subarray",
  144: "Best Time to Buy and Sell Stock with Cooldown",
  145: "Longest Palindromic Substring",
  146: "Palindromic Substrings",
  147: "Interleaving String",
  148: "Implement Trie (Prefix Tree)",
  149: "Design Add and Search Words Data Structure",
  150: "Word Search II",
  151: "Replace Words",
  152: "Longest Word in Dictionary",
};
