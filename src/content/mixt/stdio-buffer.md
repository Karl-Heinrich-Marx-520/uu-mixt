---
title: "libc_stdio_buffer初始化"
slug: stdio-buffer
description: "分析 stdio 流首次读写时缓冲区的延迟分配过程，说明控制 malloc 返回值可将 puts 数据写入任意地址。"
date: 2026-09-16
author: mixt
category: IO_FILE
tags: [C++, Linux, 网络编程, 面试]
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
漏洞类型：
/images/mixt/c3d97da6b99988dab7c595230e56da36.png
c2有着一个任意地址释放
/images/mixt/9784b1d3dabe6008127a69d875a75d8d.png
如果能成功将target中的内容修改，就可以拿到flag
/images/mixt/3d38d8ce3b70deaff2d6240741c498a6.png
c1在使用过chunk后会立即释放
导致我在了解过libc_stdio_buffer之前的多次尝试全部失败
（即使将chunk申请到了target程序也会因为无法过free检查而崩溃）

利用：通过c2释放掉tcache_pthread_struct，申请回来的同时将0x280的count设为8，这样再释放它就会进入unsortbin
将其切割（布置好count），再合并，会在tcache_pthread_struct上留下libc指针
修改对应count，并准备好0x1010的count，并通过字节爆破(1/16)到mp_区域
/images/mixt/bins.png
修改mp_.tcache_bins，让0x1010的chunk也被视为tcache
/images/mixt/mp_.png
之后再进入c3，可以看到target被成功修改









