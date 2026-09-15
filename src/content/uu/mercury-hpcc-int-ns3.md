---
title: "Mercury 复现笔记（一）：把 HPCC 的 INT 反馈链路跑进 NS-3.17"
slug: mercury-hpcc-int-ns3
description: "从 OURS 模拟器源码与原始论文出发，梳理 HPCC 基于 INT 的反馈机制与 U 驱动的窗口调整，记录在 Ubuntu 18.04 + gcc-5 环境下跑通基线的全过程。"
date: 2026-08-28
author: uu
category: 科研复现
tags: [ns-3, hpcc, 拥塞控制]
featured: false
draft: false
---
## 复现目标

把 HPCC 的 INT 反馈链路搬进 NS-3.17 的 master tree，先跑通单链路基线，再换真实流量分布。这篇只记录「跑起来」这一段：环境、编译、第一次出图。

## 环境与依赖

- Ubuntu 18.04 + Docker（宿主机不装任何仿真依赖）
- NS-3.17 + waf 1.7 + gcc-5 + Python 2（run.py 是 py2 语法）
- OURS 模拟器源码与 HPCC master tree 基线各一套

## 关键改动

HPCC 靠 INT 把链路利用率 U 带回发送端，再用 U 调整窗口。复现时最容易出错的是**反馈的时延**：

```cpp
// 伪代码：INT 头携带的 U，回到发送端后才参与窗口更新
if (ack.int_valid) {
    u = ack.u;                      // 链路利用率
    w = (u < U_LOW) ? w * (1 + alpha) :
        (u > U_HIGH) ? w * (1 - beta) : w;
}
```

> 注意：U 的采样窗口与窗口更新的时间尺度必须对齐，否则会出现「反馈振荡」——曲线看起来很公平，实际吞吐在抖。

## 首次结果

1. 单链路：吞吐达到链路容量，收敛时间与论文量级一致
2. 多链路：公平性指标偏乐观，怀疑是采样窗口偏小
3. 待办：换真实 AI 流量分布，跑三算法对比矩阵

## 下一步

把 PC4 拉进来做对照，并固定同一套流量分布与随机种子。
