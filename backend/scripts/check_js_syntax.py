import glob

files = [
    'frontend/js/player/spotify-adapter.js',
    'frontend/js/player/player-manager.js',
    'frontend/js/main.js',
    'frontend/js/reader.js'
]

for f in files:
    with open(f, 'r', encoding='utf-8') as fp:
        content = fp.read()
    braces = 0
    parens = 0
    brackets = 0
    in_str = False
    quote = ''
    in_comment = False
    in_line_comment = False
    i = 0
    while i < len(content):
        c = content[i]
        nxt = content[i+1] if i+1 < len(content) else ''
        if in_line_comment:
            if c == '\n': in_line_comment = False
        elif in_comment:
            if c == '*' and nxt == '/':
                in_comment = False
                i += 1
        elif in_str:
            if c == '\\':
                i += 1
            elif c == quote:
                in_str = False
        else:
            if c == '/' and nxt == '/':
                in_line_comment = True
                i += 1
            elif c == '/' and nxt == '*':
                in_comment = True
                i += 1
            elif c in ('"', "'", '`'):
                in_str = True
                quote = c
            elif c == '{': braces += 1
            elif c == '}': braces -= 1
            elif c == '(': parens += 1
            elif c == ')': parens -= 1
            elif c == '[': brackets += 1
            elif c == ']': brackets -= 1
        i += 1
    print(f"{f}: braces={braces}, parens={parens}, brackets={brackets}")
