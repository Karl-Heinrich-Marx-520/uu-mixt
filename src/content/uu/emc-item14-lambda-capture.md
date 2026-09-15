---
title: "Effective Modern C++ 精读：条款 14 与 lambda 的捕获陷阱"
slug: emc-item14-lambda-capture
description: "按值捕获、按引用捕获、init capture、广义捕获——四种形式各配一段会在生产环境炸掉的代码与修复姿势，最后给出一团队代码评审清单。"
date: 2025-12-30
author: uu
category: C++
tags: [effective-modern-cpp, lambda]
featured: false
draft: false
---
## 四种捕获形式，四种炸法

```cpp
std::vector<int> data{1, 2, 3};

// ① 按引用捕获：lambda 比变量活得久 → 悬垂
auto f1 = [&data] { return data.size(); };   // data 析构后调用即 UB

// ② 按值捕获：捕获的是指针的值，不是对象
auto ptr = std::make_unique<std::vector<int>>(3, 0);
auto f2 = [ptr] {};                          // 编不过（unique_ptr 不可复制）

// ③ init capture（C++14）：move 进闭包，正确姿势
auto f3 = [v = std::move(data)] { return v.size(); };

// ④ 默认捕获 [=] / [&]：看不见的依赖，重构时最容易漏
struct Widget { int x; };
auto w = Widget{42};
auto f4 = [=] { return w.x; };               // 捕获的是 this？不，这里拷贝了 w
```

## 评审清单

1. 捕获列表**显式列出**每个名字，禁用 `[=]` / `[&]`
2. 生命周期超过当前作用域的 lambda，一律 init capture + move
3. 捕获 `this` 的 lambda 不许逃出对象生命周期
4. 成员函数里的 lambda 需要成员值时，先拷贝到局部再捕获

条款 14 的原话是「使用 init capture 把对象 move 进闭包」——而实践中更重要的，是让评审者一眼看出**捕获了什么**。
