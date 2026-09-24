import json, collections, subprocess
from curation import (LC_DROP, LC_RELATED, LC_FIX, LC_ADD, GFG_DROP, GFG_RELATED, ARTICLE_REJECT)
a = json.load(open('a2z.json')); au = {x['order']: x for x in json.load(open('audit.json'))}
site = json.load(open('/tmp/striver-a2z-sheet/site/data.json'))['problems']
T = lambda i: a[i-1]['title']
TOPIC_NAMES = [('basics','Learn the Basics'),('sorting','Sorting'),('arrays','Arrays'),('binary-search','Binary Search'),
 ('strings','Strings'),('linked-list','Linked List'),('recursion','Recursion'),('bit-manipulation','Bit Manipulation'),
 ('stack-queue','Stack & Queue'),('sliding-window','Sliding Window'),('heap','Heap'),('greedy','Greedy'),
 ('trees','Binary Trees'),('bst','BST'),('graphs','Graphs'),('dp','Dynamic Programming'),('tries','Tries')]
cnt = collections.Counter(p['topic'] for p in a)
theory = sum(1 for p in a if p['kind']=='theory')
lc = sum(1 for p in a if 'leetcode' in p['platforms'])
rlc = sum(1 for p in a for r in p.get('related',[]) if r['platform']=='leetcode')
gfg = sum(1 for p in a if 'gfg' in p['platforms'])
rgfg = sum(1 for p in a for r in p.get('related',[]) if r['platform']=='gfg')
tuf = sum(1 for p in a if p.get('otherLabel')=='TakeUForward')
oth = sum(1 for p in a if p.get('otherLabel') and p['otherLabel']!='TakeUForward')
arts = sum(1 for p in a if p.get('article'))
nolink = [p for p in a if not p['platforms']]
none = [p for p in nolink if not p.get('article')]
alev = collections.Counter(x['article_level'] for x in au.values() if x.get('article'))
lclev = collections.Counter(x['lc_level'] for x in au.values() if x.get('lc'))
inherited = [x for x in au.values() if 'non-identical' in (x.get('diff_src') or '')]
used = {x['new'] for x in au.values() if x['new']}
not_in_classic = [p for p in site if p['order'] not in used]
moved_to_article = [x for x in au.values() if x.get('moved_to_article')]

L = []; w = L.append
w('# A2Z DATA AUDIT\n')
w('Generated from `scripts/a2z-build` (round 2 audit, 2026-09-23). Run `npm run validate:data` for the live check.\n')
w('```text')
w('A2Z DATA AUDIT'); w('==============\n')
w(f'Total entries:         {len(a)}'); w(f'Coding problems:       {len(a)-theory}'); w(f'Theory/Lesson entries: {theory}\n')
w('Topic breakdown:\n')
for tid, name in TOPIC_NAMES: w(f'{(name+":"):22} {cnt[tid]}')
w('\nLinks:\n')
w(f'Exact LeetCode:        {lc}'); w(f'Related LeetCode:      {rlc}'); w(f'Exact GFG:             {gfg}'); w(f'Related GFG:           {rgfg}')
w(f'TakeUForward practice: {tuf}'); w(f'Other (IB/HackerRank): {oth}'); w(f'Code360:               0')
w(f'Articles:              {arts}'); w(f'No practice link:      {len(nolink)}  ({len(nolink)-len(none)} of them have an article)')
w(f'No verified link at all: {len(none)}')
w('```\n')
w('## Source of truth and scope\n')
w('The app follows the **classic 18-step A2Z roadmap (455 entries)** — the Step 1–18 structure you asked for. '
  'Every entry was cross-checked against the **current official takeuforward.org sheet** (2026, 402 practice problems in 19 re-organised modules): '
  f'{len(used)} of its problems map onto classic entries and supplied verified GfG/TakeUForward/article links. '
  f'The other {len(not_in_classic)} current-sheet problems are *not in the classic roadmap* (mostly finer splits such as Pattern 1–22 '
  'and individual linked-list insert/delete variants). They were **not** added, because adding them would change the roadmap you chose '
  'and push the count toward an arbitrary number — see the list at the end. The count stays 455; nothing was invented.\n')
w('## Verification level of every link\n')
w(f'- LeetCode ({lc}): {lclev["leetcode-api"]} confirmed by LeetCode\'s own API, {lclev["page-fetch"]} by opening the problem page (title, number, difficulty).')
w(f'- GeeksforGeeks ({gfg}): each page fetched and its title/slug matched to the problem (geckguy/striver-a2z-sheet, 2026-09-20), then re-reviewed by hand in this audit.')
w(f'- TakeUForward practice ({tuf}): HTTP-200 checked 2026-09-20 or opened during the audit.')
w(f'- Articles ({arts}): {alev["http-200"]} HTTP-200 checked (official-sheet article links), {alev["sitemap-reviewed"]} listed in takeuforward.org/sitemap.xml and matched by hand '
  f'(ambiguous ones opened and read), {alev["page-fetch"]} opened and read, {alev["official-sheet"]} official lesson pages from the sheet\'s own navigation.\n')
w('## Issues found and fixed in this audit\n')
fixed = []
for i, r in GFG_DROP.items(): fixed.append(f'#{i} **{T(i)}** — GfG link removed: {r}.')
for i, r in GFG_RELATED.items(): fixed.append(f'#{i} **{T(i)}** — GfG link moved to *Related practice*: {r}')
for i, s in LC_ADD.items():
    if i == 426: fixed.append(f'#{i} **{T(i)}** — missing exact LeetCode link added: `{s}`.')
fixed.append(f'{len(moved_to_article)} lesson/article pages were being shown as "Solve on TakeUForward"; they are now **Read Article** links and no longer count as practice links '
             '(' + ', '.join(f'#{x["order"]}' for x in sorted(moved_to_article, key=lambda x: x["order"])) + ').')
for i, r in ARTICLE_REJECT.items(): fixed.append(f'#{i} **{T(i)}** — auto-matched article rejected: {r}.')
fixed.append(f'Articles added: 0 → {arts}; every one is for the same problem (TakeUForward).')
fixed.append('Difficulty for #347 and #402 now comes from their verified GfG page instead of the (removed) LeetCode link.')
fixed.append('Validator extended: required fields, duplicate external URLs (must be in a reviewed group), exact-vs-related classification (look-alike links must be reviewed), article URL rules, counts by topic.')
for f in fixed: w(f'- {f}')
w(f'\n**Issues fixed in this audit: {len(fixed)}** (plus the {len(LC_DROP)} removed, {len(LC_RELATED)} related-only and {len(LC_FIX)} corrected LeetCode links from the first audit, still enforced).\n')
w('## Issues remaining (documented, not guessed)\n')
w(f'- **{len(none)} entries have no verified practice link or article:** ' + '; '.join(f'#{p["order"]} {p["title"]}' for p in none) + '.')
w(f'- **{len(inherited)} difficulties** come from the sheet mirror, which took them from a non-identical linked problem; no independent source was found: '
  + ', '.join(f'#{x["order"]}' for x in sorted(inherited, key=lambda x: x['order'])) + '.')
w('- **Code360:** no link could be verified, so none is listed.')
w(f'- **{alev["sitemap-reviewed"]} sitemap-matched articles** exist in TakeUForward\'s sitemap and were matched by slug + manual review, but were not each opened individually.')
w(f'- **{len(not_in_classic)} current-sheet problems are outside the classic roadmap** (listed below).\n')
w('## Current-sheet problems not in the classic roadmap\n')
by = collections.defaultdict(list)
for p in not_in_classic: by[p['stepTitle']].append(p['title'])
for k, v in by.items(): w(f'- **{k}**: ' + ', '.join(v))
w('')
open('/home/claude/dsa-roadmap/docs/A2Z_DATA_AUDIT.md', 'w').write('\n'.join(L))
print('\n'.join(L[:40]))
