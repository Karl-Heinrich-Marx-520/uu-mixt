---
title: "给 Qt 客户端配一个 INI 配置层：QSettings 的正确姿势"
slug: qt-qsettings-ini
description: "配置读写依赖工作目录的经典坑、CMake POST_BUILD 自动拷贝配置文件，以及为什么不要在构造函数里直接读相对路径，附一完整可抄的最小实现。"
date: 2025-11-11
author: uu
category: 工程实践
tags: [qt, qsettings]
featured: false
draft: false
---
## 问题现场

同一份程序，双击运行能读到配置，从 IDE 里跑就读不到——十有八九是**工作目录**在作怪：`QSettings` 的相对路径按进程 CWD 解析，而 IDE 默认 CWD 是 build 目录。

## 正确姿势

```cpp
// ① 启动早期把配置路径钉死为「可执行文件同目录」
const QString cfgPath = QCoreApplication::applicationDirPath() + "/config.ini";
QSettings settings(cfgPath, QSettings::IniFormat);

// ② 需要默认值的读取封装
template <typename T>
T readOr(QSettings& s, const QString& key, const T& def) {
    const QVariant v = s.value(key);
    return v.isValid() ? v.value<T>() : def;
}
```

```cmake
# ③ CMake：把配置文件拷到 exe 目录（不依赖 CWD）
add_executable(client main.cpp)
configure_file(config.ini.in ${CMAKE_BINARY_DIR}/config.ini)
add_custom_command(TARGET client POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            ${CMAKE_BINARY_DIR}/config.ini $<TARGET_FILE_DIR:client>)
```

## 三条纪律

1. 配置路径**永远**从 `applicationDirPath()` 推导，不信 CWD
2. 所有键给默认值，删掉配置文件也要能起
3. 写回时用 `sync()` 并检查 `status()`，静默失败等于没存
