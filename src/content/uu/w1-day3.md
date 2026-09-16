---
title: "实验 · W1 Day3：作用域与闭包"
slug: w1-day3
description: "通过可运行实验演示 Python 作用域与闭包：无块作用域、赋值即声明、LEGB 查找、nonlocal 与晚绑定陷阱。"
date: 2026-09-16
author: uu
category: agent01-Python补足
tags: [Python]
featured: false
draft: true
---
# W1-Day3-作用域与闭包

```python
"""W1 · Day 3 实测：作用域、闭包与晚绑定

跑法（uv 工程要到 Day 6 才建，此时用裸 python；-W error 是零告警验收要求）：
    python -X utf8 -W error "docs/01-Python补足/产出/实验/W1-Day3-作用域与闭包.py"

本文件只放代码。完整讲解见配套课件 docs/01-Python补足/课件/同名 .md
（D34：课件与实验脚本同名配对，缺一视为该次课没上）；
沉淀出的语义差异条目落到 docs/01-Python补足/产出/差异清单-C++到Python.md。
"""

# --- 1. Python 没有块作用域 ----------------------------------------------

for i in range(3):
    last = i
print("1) for 结束后 i =", i, "| last =", last)

debug = True
if debug:
    block_var = "在 if 里绑定的"
print("1) if 块里的名字，外面可见 =", block_var)


# --- 2. 赋值即声明：UnboundLocalError ------------------------------------

count = 0


def inc_bad():
    count += 1
    return count


try:
    inc_bad()
except UnboundLocalError as e:
    print("2) inc_bad() 抛:", type(e).__name__, "-", e)

print("2) 异常之后 count 仍是", count)


def inc_global():
    global count
    count += 1
    return count


print("2) inc_global() 之后 count =", inc_global())


# --- 3. LEGB：四层查找顺序 -----------------------------------------------

scope_x = "global"


def outer():
    scope_x = "enclosing"

    def inner():
        return scope_x

    return inner()


print("3) inner 拿到的是:", outer())
print("3) builtin 层（len 无需 import）:", len("abc"))


# --- 4. nonlocal：闭包持有变量本身 ---------------------------------------


def make_counter():
    n = 0

    def step():
        nonlocal n
        n += 1
        return n

    return step


counter = make_counter()
print("4) 同一个计数器:", counter(), counter(), counter())
print("4) 另一个实例互不干扰:", make_counter()())


# --- 5. 晚绑定陷阱：三个 lambda 返回同一个值 -----------------------------

funcs = [lambda: k for k in range(3)]
print("5) 未修复:", [f() for f in funcs])

funcs_fixed = [lambda k=k: k for k in range(3)]
print("5) 用默认参数修复:", [f() for f in funcs_fixed])


# --- 6. 闭包内部长什么样 -------------------------------------------------


def make_adder(base):
    def add(v):
        return base + v

    return add


add10 = make_adder(10)
print("6) co_freevars =", add10.__code__.co_freevars)
print("6) cell 内容 =", [c.cell_contents for c in add10.__closure__])
print("6) add10(5) =", add10(5))


# --- 7. def 是运行时语句：名字在那一刻才存在 -----------------------------

try:
    later()
except NameError as e:
    print("7) 定义之前调用:", type(e).__name__, "-", e)


def later():
    return "现在有了"


print("7) 定义之后调用:", later())
```





