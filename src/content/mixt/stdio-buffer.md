---
title: "stdio的首次buffer分配初始化"
slug: stdio-buffer
description: "分析 stdio 流首次读写时缓冲区的延迟分配过程，说明控制 malloc 返回值可将 puts 数据写入任意地址。"
date: 2026-09-16
author: mixt
category: IO_FILE
tags: [C++, 网络编程, Linux, 面试]
featured: false
draft: true
---
程序启动时，stdout/stderr/stdin三个流的缓冲区_IO_buf_base为NULL
而只有第一次读写这个流时(如调用puts)
会执行下述代码
f (fp->_IO_buf_base == NULL)
    _IO_file_doallocate(fp);   
在_IO_file_doallocate中,有以下操作：
    size=_IO_BUFSIZ ; (一般为0x1000)
    p = malloc(size);
    fp -> _IO_buf_base = p;
    fp -> _IO_buf_end = p + size;
之后puts("...")把字符串复制进申请的缓冲区
如果我们能控制malloc(size)的返回值，让它返回我们想要的地址Target 
那么Target就会被写入puts的参数

例：[TQLCTF 2022]unbelievable write

