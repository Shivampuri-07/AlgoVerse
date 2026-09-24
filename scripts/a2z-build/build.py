"""
Build data/a2zProblems.ts from the classic Striver A2Z sheet structure.

Sources (all local copies, see SOURCES.md):
  codolio_ordered.json  - classic 18-step A2Z sheet (455 items): order, step, lecture,
                          title, difficulty and the sheet's own problem links.
  /tmp/striver-a2z-sheet (geckguy/striver-a2z-sheet, MIT, snapshot 2026-09-20):
      data/raw/leetcode.json, leetcode_extra.json  - LeetCode slugs confirmed via
                                                     LeetCode's own GraphQL API
      site/data.json, data/raw/base_items.json     - current official TUF sheet with
                                                     verified GfG links + TUF urls
      data/raw/verify_links.json                   - HTTP-200 checks of TUF urls
Manual curation lives in curation.py (equivalence audit of every LeetCode link).
"""
import json, re, sys
from collections import Counter, OrderedDict
from curation import (NEW_MATCH, LEARN_MATCH, LC_DROP, LC_RELATED, LC_FIX, LC_ADD,
                      TITLE_FIX, OTHER_KEEP, THEORY, WEBFETCH_CONFIRMED_LC,
                      TUF_CONFIRMED, GFG_DROP, GFG_RELATED, ARTICLE_MANUAL, ARTICLE_REJECT)

GK = '/tmp/striver-a2z-sheet'
cl = json.load(open('/home/claude/a2z/codolio_ordered.json'))
lcapi = json.load(open(f'{GK}/data/raw/leetcode.json'))
lcx = json.load(open(f'{GK}/data/raw/leetcode_extra.json'))
site = {p['order']: p for p in json.load(open(f'{GK}/site/data.json'))['problems']}
base = {b['tufId']: b for b in json.load(open(f'{GK}/data/raw/base_items.json'))}
vlinks = json.load(open(f'{GK}/data/raw/verify_links.json'))
lhealth = json.load(open(f'{GK}/data/raw/link_health.json'))

# LeetCode slugs whose existence/title/difficulty were confirmed by LeetCode's API
LC_CONFIRMED = dict(lcapi)
for v in lcx['extra'].values():
    s = re.search(r'/problems/([^/]+)/', v['url']).group(1)
    LC_CONFIRMED.setdefault(s, {'title': v['title'], 'difficulty': v['difficulty'],
                                'isPaidOnly': v['isPaidOnly'], 'topicTags': []})
for s_, (t_, n_, d_, p_) in WEBFETCH_CONFIRMED_LC.items():
    LC_CONFIRMED.setdefault(s_, {'title': t_, 'difficulty': d_, 'isPaidOnly': p_,
                                 'topicTags': [], '_via': 'page-fetch'})
for old, v in lcx['canonical'].items():
    s = re.search(r'/problems/([^/]+)/', v['url']).group(1)
    LC_CONFIRMED.setdefault(s, {'title': v['title'], 'difficulty': v['difficulty'],
                                'isPaidOnly': v['isPaidOnly'], 'topicTags': []})

CANON = {'coin-change-2': 'coin-change-ii', 'implement-strstr':
         'find-the-index-of-the-first-occurrence-in-a-string'}

STEP_TOPIC = {1: 'basics', 2: 'sorting', 3: 'arrays', 4: 'binary-search', 5: 'strings',
              6: 'linked-list', 7: 'recursion', 8: 'bit-manipulation', 9: 'stack-queue',
              10: 'sliding-window', 11: 'heap', 12: 'greedy', 13: 'trees', 14: 'bst',
              15: 'graphs', 16: 'dp', 17: 'tries', 18: 'strings'}
TOPIC_TAG = {'basics': 'Basics', 'sorting': 'Sorting', 'arrays': 'Array',
             'binary-search': 'Binary Search', 'strings': 'String', 'linked-list': 'Linked List',
             'recursion': 'Recursion', 'bit-manipulation': 'Bit Manipulation',
             'stack-queue': 'Stack', 'sliding-window': 'Sliding Window', 'heap': 'Heap',
             'greedy': 'Greedy', 'trees': 'Binary Tree', 'bst': 'Binary Search Tree',
             'graphs': 'Graph', 'dp': 'Dynamic Programming', 'tries': 'Trie'}
LC_TAG_RENAME = {'Hash Table': 'Hashing', 'Depth-First Search': 'DFS',
                 'Breadth-First Search': 'BFS', 'Union Find': 'Union Find',
                 'Heap (Priority Queue)': 'Heap', 'Monotonic Stack': 'Monotonic Stack',
                 'Two Pointers': 'Two Pointers', 'Tree': 'Tree',
                 'Binary Search Tree': 'Binary Search Tree', 'Dynamic Programming': 'Dynamic Programming'}

def lcslug(u):
    m = re.search(r'leetcode\.com/(?:accounts/login/\?next=/)?problems/([^/?#]+)', u or '')
    return m.group(1) if m else None

def clean_section(s):
    return re.sub(r'^Lec\s*\d+\s*:\s*', '', s).strip()

def step_no(topic):
    return int(re.match(r'Step\s*(\d+)', topic).group(1))

def gfg_of(newp):
    if not newp: return None
    if newp['platform'] == 'gfg': return newp['url']
    for a in newp.get('altUrls', []):
        if a['platform'] == 'gfg': return a['url']
    return None

def tuf_of(newp):
    if not newp: return None
    if newp['platform'] == 'takeuforward': return newp['url']
    for a in newp.get('altUrls', []):
        if a['platform'] == 'takeuforward': return a['url']
    return None

def clean_tuf(u):
    # strip tracking query params; keep canonical page
    return u.split('?')[0] if u else u

gfg_titles, gfg_diff = {}, {}
for f in ['gfg_final.json', 'gfg_verified.json']:
    for x in json.load(open(f'{GK}/data/raw/{f}')).values():
        gfg_titles[x['url']] = (x.get('gfgTitle') or '').replace(' | Practice | GeeksforGeeks', '').replace('&#x27;', "'")
        if x.get('gfgDifficulty'): gfg_diff[x['url']] = x['gfgDifficulty']

problems, audit = [], []
for i, x in enumerate(cl, 1):
    q = x['questionId']
    step = step_no(x['topic'])
    topic = STEP_TOPIC[step]
    section = clean_section(x['subTopic'])
    title = TITLE_FIX.get(i, x.get('title') or q.get('name')).strip()
    src_url = q.get('problemUrl') or ''
    rec = {'order': i, 'title': title, 'src': src_url}

    # ---- LeetCode (exact equivalents only) -----------------------------------
    lc = lcslug(src_url)
    lc = CANON.get(lc, lc)
    related = None
    if i in LC_FIX:
        lc = LC_FIX[i]
    elif lc and i in LC_DROP:
        rec['lc_dropped'] = lc; lc = None
    elif lc and i in LC_RELATED:
        related = {'platform': 'leetcode', 'url': f'https://leetcode.com/problems/{lc}/',
                   'title': (LC_CONFIRMED.get(lc) or {}).get('title') or lc,
                   'note': LC_RELATED[i]}
        rec['lc_related'] = lc; lc = None
    if not lc and i in LC_ADD:
        lc = LC_ADD[i]
    lc_level = None
    if lc:
        if lc in WEBFETCH_CONFIRMED_LC: lc_level = 'page-fetch'
        elif lc in LC_CONFIRMED: lc_level = 'leetcode-api'
        else: lc_level = 'UNVERIFIED'
    rec['lc'] = lc; rec['lc_level'] = lc_level

    # ---- matched item in current official sheet (GfG + TUF practice page) ----
    newp = None
    if i in NEW_MATCH:
        newp = site.get(NEW_MATCH[i]) if NEW_MATCH[i] else None
    gfg = gfg_of(newp)
    tuf = clean_tuf(tuf_of(newp))
    tuf_level = None
    if tuf_of(newp):
        tuf_level = 'http-200' if tuf_of(newp) in vlinks else 'official-sheet'
    if not tuf and i in TUF_CONFIRMED:
        tuf = TUF_CONFIRMED[i]; tuf_level = 'page-fetch'
    if not tuf and i in LEARN_MATCH:
        b = base[LEARN_MATCH[i]]
        # learning pages need their ?category= to resolve; drop only the tracking param
        tuf = re.sub(r'[&?]source=[^&]*', '', b['tufUrl']); tuf_level = 'official-sheet'
    rec['new'] = newp['order'] if newp else None
    related_list = [related] if related else []
    if gfg and i in GFG_DROP:
        rec['gfg_dropped'] = gfg; gfg = None
    elif gfg and i in GFG_RELATED:
        related_list.append({'platform': 'gfg', 'url': gfg, 'title': gfg_titles.get(gfg, 'GeeksforGeeks'),
                             'note': GFG_RELATED[i]})
        rec['gfg_related'] = gfg; gfg = None
    rec['gfg'] = gfg; rec['tuf'] = tuf; rec['tuf_level'] = tuf_level

    # ---- article (educational explanation, never a "solve" page) --------------
    article, art_level = None, None
    if newp and newp.get('article') and i not in ARTICLE_REJECT:
        article = newp['article']
        art_level = 'http-200' if (lhealth.get(article) or {}).get('status') == 200 else 'official-sheet'
    if not article and i in LEARN_MATCH and base[LEARN_MATCH[i]].get('articleUrl'):
        article = base[LEARN_MATCH[i]]['articleUrl']
        art_level = 'http-200' if (lhealth.get(article) or {}).get('status') == 200 else 'official-sheet'
    if not article and i in ARTICLE_MANUAL:
        article, art_level = ARTICLE_MANUAL[i], 'sitemap-reviewed'
    # TUF pages that are lessons/articles (not practice pages) are articles, not "Solve" links
    if tuf and '/practice/dsa/' not in tuf:
        if not article:
            article, art_level = tuf, tuf_level
        tuf, tuf_level = None, None
        rec['moved_to_article'] = True
        rec['tuf'] = None; rec['tuf_level'] = None
    rec['article'] = article; rec['article_level'] = art_level

    other, other_label = None, None
    if tuf:
        other, other_label = tuf, 'TakeUForward'
    elif i in OTHER_KEEP:
        other, other_label = OTHER_KEEP[i]
    rec['other'] = other

    # ---- difficulty ----------------------------------------------------------
    diff = q.get('difficulty'); rec['diff_src'] = 'sheet-mirror'
    if lc and lc in LC_CONFIRMED:
        diff = LC_CONFIRMED[lc]['difficulty']; rec['diff_src'] = 'leetcode'
    elif (rec.get('lc_related') or rec.get('lc_dropped')) and gfg and gfg_diff.get(gfg):
        diff = gfg_diff[gfg]; rec['diff_src'] = 'gfg'
    elif newp and newp.get('difficulty') and newp.get('difficultySource') != 'leetcode':
        diff = newp['difficulty']; rec['diff_src'] = newp.get('difficultySource')
    elif rec.get('lc_related') or rec.get('lc_dropped'):
        rec['diff_src'] = 'sheet-mirror (taken from a non-identical linked problem)'
    if diff == 'Basic' or not diff: diff = 'Easy'
    assert diff in ('Easy', 'Medium', 'Hard'), (i, diff)

    # ---- tags ----------------------------------------------------------------
    tags = [TOPIC_TAG[topic]]
    if lc and lc in LC_CONFIRMED:
        for t in LC_CONFIRMED[lc].get('topicTags', []):
            n = LC_TAG_RENAME.get(t['name'], t['name'])
            if n not in tags: tags.append(n)
    kind = 'theory' if i in THEORY else 'practice'
    if kind == 'theory': tags.append('Theory')
    tags = tags[:5]

    platforms = OrderedDict()
    if lc: platforms['leetcode'] = f'https://leetcode.com/problems/{lc}/'
    if gfg: platforms['gfg'] = gfg
    if other: platforms['other'] = other

    p = OrderedDict(id=i, order=i, step=step, topic=topic, section=section, title=title,
                    difficulty=diff, kind=kind, platforms=platforms)
    if other_label: p['otherLabel'] = other_label
    if lc and (LC_CONFIRMED.get(lc) or {}).get('isPaidOnly'): p['premium'] = True
    if article: p['article'] = OrderedDict(url=article, source='TakeUForward')
    if related_list: p['related'] = related_list
    p['tags'] = tags
    problems.append(p); audit.append(rec)

json.dump(problems, open('/home/claude/a2z/a2z.json', 'w'), indent=1)
json.dump(audit, open('/home/claude/a2z/audit.json', 'w'), indent=1)
print('built', len(problems))
print('lc levels', Counter(a['lc_level'] for a in audit))
print('tuf levels', Counter(a['tuf_level'] for a in audit))
unv = [(a['order'], a['title'], a['lc']) for a in audit if a['lc_level'] == 'UNVERIFIED']
print('UNVERIFIED LC:', len(unv))
for u in unv: print('  ', u)
print('articles', Counter(a['article_level'] for a in audit if a['article']))
nolink = [(a['order'], a['title']) for a, p in zip(audit, problems) if not p['platforms']]
print('no link:', len(nolink))
for n in nolink: print('  ', n)
