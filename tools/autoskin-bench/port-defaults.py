# Switch the bench's default reference rig to the optimised project (2026-09-20,
# user decision: test against this one from now on). Env vars still override.
import os, glob
HERE = os.path.dirname(os.path.abspath(__file__))
OLD = "'D:/foyo_new/立绘/女角色 (2)/伽夜立绘/新建文件夹 (2)/a.json'"
NEW = "'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json'"
n = 0
for f in glob.glob(os.path.join(HERE, "*.cjs")):
    s = open(f, encoding="utf-8").read()
    if OLD in s:
        open(f, "w", encoding="utf-8", newline="\n").write(s.replace(OLD, NEW))
        n += 1
        print("updated", os.path.basename(f))
print("files updated:", n)
