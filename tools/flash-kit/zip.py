# يضغط مجلد الفلاشة بأسماء عربية صحيحة (UTF-8) — يفتح عادي بويندوز 10 و 11
import os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for dp, dn, fn in os.walk(root):
        dn.sort()
        for f in sorted(fn):
            z.write(os.path.join(dp, f))
print(out, os.path.getsize(out), 'bytes')
