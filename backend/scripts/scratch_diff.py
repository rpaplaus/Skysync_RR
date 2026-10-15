import re

for name, fname in [('bad', 'bad_sundown.html'), ('good', 'good_handle.html')]:
    with open(fname, 'r', encoding='utf-8') as f:
        txt = f.read()
    print(f'=== {name} ===')
    for m in re.finditer(r'playability', txt, re.IGNORECASE):
        start = max(0, m.start() - 30)
        end = min(len(txt), m.end() + 150)
        print(txt[start:end])
        print('-'*40)
