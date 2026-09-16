---
title: "实验 · W1-Day1-2-名字绑定与可变性"
slug: w1-day1-2-py
description: "通过实验代码验证 Python 的名字绑定、对象引用传递、is 与 == 的区别、可变默认参数陷阱、深浅拷贝以及元组的可变性边界。"
date: 2026-09-16
author: uu
category: agent01-Python补足
tags: [Python]
featured: false
draft: true
---
# W1-Day1-2-名字绑定与可变性

```python
"""W1 · Day 1-2 实测：名字绑定、对象模型、可变性

跑法（uv 工程要到 Day 6 才建，此时用裸 python；-W error 是零告警验收要求）：
    python -X utf8 -W error "docs/01-Python补足/产出/实验/W1-Day1-2-名字绑定与可变性.py"

本文件只放代码。完整讲解见配套课件 docs/01-Python补足/课件/同名 .md
（D34：课件与实验脚本同名配对，缺一视为该次课没上）；
沉淀出的语义差异条目落到 docs/01-Python补足/产出/差异清单-C++到Python.md。
"""

import copy

# --- 1. 赋值 = 给对象贴新名字，不是拷贝 -----------------------------------
a = [1, 2]
b = a
b.append(3)
print("1) 改 b 之后 a =", a, "| a is b =", a is b)

c = list(a)
c.append(99)
print("1) 改 c 之后 a =", a, "| a is c =", a is c)


# --- 2. 实参传递：call by object reference --------------------------------

def mutate(p):
    p.append("被改了")


def rebind(p):
    p = ["新对象"]


def replace_in_place(p):
    p[:] = ["整块替换"]


xs = ["原始"]
mutate(xs)
print("2) mutate 之后      xs =", xs)

rebind(xs)
print("2) rebind 之后      xs =", xs)

xs2 = ["a"]
replace_in_place(xs2)
print("2) p[:] = ... 之后 xs2 =", xs2)


# --- 3. is 是身份比较，== 是值比较 ----------------------------------------

like = [1, 2]
same = [1, 2]
print("3) 内容相同的两个列表：is =", like is same, "| == =", like == same)

x = 257
y = 257
print("3) 同一个 code object 里的 257（常量池去重）→ x is y =", x is y)

ns1, ns2 = {}, {}
exec(compile("X = 257", "<m1>", "exec"), ns1)
exec(compile("X = 257", "<m2>", "exec"), ns2)
print("3) 两个独立代码对象里的 257：is =", ns1["X"] is ns2["X"])

print("3) 小整数缓存 [-5, 256]：id(256) == id(256) →", id(256) == id(256))
print("3) 可变对象不缓存：      [] is [] →", [] is [])


# --- 4. 可变默认参数陷阱 --------------------------------------------------

def collect_bad(item, acc=[]):
    acc.append(item)
    return acc


print("4) collect_bad(1/2/3) =",
      collect_bad(1), collect_bad(2), collect_bad(3))
print("4) collect_bad.__defaults__ =", collect_bad.__defaults__)


def collect_ok(item, acc=None):
    if acc is None:
        acc = []
    acc.append(item)
    return acc


print("4) collect_ok(1/2/3)  =",
      collect_ok(1), collect_ok(2), collect_ok(3))


# --- 5. 浅拷贝 vs 深拷贝 --------------------------------------------------

inner = [1, 2]
src = {"k": inner}
print("5) 初始             src =", src)

shallow = copy.copy(src)
shallow["k"].append(99)
print("5) 浅拷贝改内层后   src =", src)

deep = copy.deepcopy(src)
deep["k"].append(100)
print("5) 深拷贝改内层后   src =", src)
print("5) 深拷贝改内层后  deep =", deep)

print("5) 浅拷贝的内层是同一个对象吗：", copy.copy(src)["k"] is src["k"])


# --- 6. tuple 不等于「完全不可变」 ----------------------------------------

t = (1, [2, 3])
t[1].append(4)
print("6) t[1].append(4) 之后 t =", t)

try:
    t[1] += [5]
except TypeError as e:
    print("6) t[1] += [5] 抛:", type(e).__name__, "-", e)
print("6) 异常之后 t =", t)

try:
    hash(t)
except TypeError as e:
    print("6) hash(t) 抛:", type(e).__name__, "-", e)
```





