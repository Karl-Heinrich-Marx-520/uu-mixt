---
title: "kgadget草稿"
slug: kgadget
description: "分析 kgadget 内核驱动的 ioctl 反汇编，利用 qmemcpy 覆盖 pt_regs 并借寄存器间接调用实现 ROP 劫持。"
date: 2026-09-20
author: mixt
category: IO_FILE
tags: [linux kernel pwn, ROP, Linux, C++]
featured: false
draft: true
---
### kgadget_ioctl

```kgadget_ioctl
__int64 __fastcall kgadget_ioctl(file *__file, unsigned int cmd, unsigned __int64 param)
{
  void (__fastcall **v3)(void *, _QWORD); // rdx
  void (__fastcall *v4)(void *, _QWORD); // rbx
  void (__fastcall *v5)(void *, _QWORD); // rsi

  _fentry__(__file, cmd, param);
  if ( cmd == 114514 )
  {
    v4 = *v3;
    v5 = *v3;
    printk(&unk_370);
    printk(&unk_3A0);
    qmemcpy(
      (void *)(((unsigned __int64)&STACK[0x1000] & 0xFFFFFFFFFFFFF000LL) - 168),
      "arttnba3arttnba3arttnba3arttnba3arttnba3arttnba3",
      48);
    *(_QWORD *)(((unsigned __int64)&STACK[0x1000] & 0xFFFFFFFFFFFFF000LL) - 112) = 0x3361626E74747261LL;
    printk(&unk_3F8);
    v4(&unk_3F8, v5);
    return 0;
  }
  else
  {
    printk(&unk_420);
    return -1;
  }
}
```

---

__`__fentry__`__是内核`ftrace`函数追踪的入口钩子，分析时可以忽略

> 这是唯一有用的函数

* qmemcpy的操作有些迷惑，看不太懂

```qmemcpy
.text.unlikely:000000000000011C                 mov     rbx, [param]
.text.unlikely:000000000000011F kgadget_ptr = rbx                       ; void (*)(void)
.text.unlikely:000000000000011F                 mov     __file, offset unk_370
.text.unlikely:0000000000000126                 mov     cmd, kgadget_ptr
.text.unlikely:0000000000000129                 call    printk          ; PIC mode
.text.unlikely:000000000000012E                 mov     rdi, offset unk_3A0
.text.unlikely:0000000000000135                 call    printk          ; PIC mode
.text.unlikely:000000000000013A                 mov     [rbp-18h], rsp
.text.unlikely:000000000000013E                 mov     rax, [rbp-18h]
.text.unlikely:0000000000000142                 mov     rdi, offset unk_3F8
.text.unlikely:0000000000000149                 add     rax, 1000h
.text.unlikely:000000000000014F                 and     rax, 0FFFFFFFFFFFFF000h
.text.unlikely:0000000000000155                 lea     rdx, [rax-0A8h] #0A8h = 168
.text.unlikely:000000000000015C                 mov     [rbp-18h], rdx
.text.unlikely:0000000000000160 regs = rdx                              ; pt_regs *
.text.unlikely:0000000000000160                 mov     regs, 3361626E74747261h #arttnba3
.text.unlikely:000000000000016A                 mov     [rax-0A8h], rdx
.text.unlikely:0000000000000171                 mov     [rax-0A0h], rdx
.text.unlikely:0000000000000178                 mov     [rax-98h], rdx
.text.unlikely:000000000000017F                 mov     [rax-90h], rdx
.text.unlikely:0000000000000186                 mov     [rax-88h], rdx
.text.unlikely:000000000000018D                 mov     [rax-80h], rdx
.text.unlikely:0000000000000191                 mov     [rax-70h], rdx #70h = 112
.text.unlikely:0000000000000195                 call    printk          ; PIC mode
.text.unlikely:000000000000019A                 call    __x86_indirect_thunk_rbx ; PIC mode
.text.unlikely:000000000000019F                 xor     eax, eax
.text.unlikely:00000000000001A1                 jmp     short loc_1B3
```

逐步分析一下吧

`param=rdx`，那么`rbx=[rdx]`，最后会`call rbx`，所以只需要让`rdx`为`physmap`中用户段ROP的地址即可

`rax = rsp`，`rax += 1000h`，`nd rax, 0FFFFFFFFFFFFF000h`，`现在rax还是页对齐的栈地址`

`lead rdx, [rax-0A8h] ; mov [rbp-18h], rdx`这两步是存个地址吧

后面一堆`mov就是纯qmemcpy`的赋值操作了，`rdx`为`arttnba3`，在栈上放7个`arttnba3`。。。

它清理了`pt_rgs`区域

```pt_rgs
struct pt_regs {
    unsigned long r15;      // +0x00
    unsigned long r14;      // +0x08
    unsigned long r13;      // +0x10
    unsigned long r12;      // +0x18
    unsigned long rbp;      // +0x20
    unsigned long rbx;      // +0x28
    unsigned long r11;      // +0x30
    unsigned long r10;      // +0x38
    unsigned long r9;       // +0x40
    unsigned long r8;       // +0x48
    unsigned long rax;      // +0x50
    unsigned long rcx;      // +0x58
    unsigned long rdx;      // +0x60
    unsigned long rsi;      // +0x68
    unsigned long rdi;      // +0x70
    unsigned long orig_rax; // +0x78
    unsigned long rip;      // +0x80
    unsigned long cs;       // +0x88
    unsigned long eflags;   // +0x90
    unsigned long rsp;      // +0x98
    unsigned long ss;       // +0xA0
};
```

最后只剩下`r8和r9能用了`，因为`r11会被syscall设置成rflags`，`rax为系统调用号`，`rcx会被syscall设置成返回地址`

`rdx是param`，`rsi存cmd`，`rdi存fd`

`rip,cs,rflags,rsp,ss更是不能动` 

其他七个寄存器被改成神秘`arttnba3`了

> 要把 "寄存器 rdx" 和 "pt_regs->rdx 内存槽" 这两个概念分开

备注：`pt_regs`是在进行系统调用切换到内核态时形成的结构体（基础没打好啊）

`pt_regs`是在进入`ioctl`函数之后借助`syscall`进入内核态形成的，就是`ioctl(fd，114514，param)`，并在之后存`rdx，rsi，rdi`

```regs
.text.unlikely:00000000000000F3 regs_addr       = qword ptr -20h
.text.unlikely:00000000000000F3
.text.unlikely:00000000000000F3 __file = rdi                            ; file *
.text.unlikely:00000000000000F3 cmd = rsi                               ; unsigned int
.text.unlikely:00000000000000F3 param = rdx                             ; unsigned __int64
```



---



### kgadget_write

```kgadget_write
__int64 __fastcall kgadget_write(__int64 a1, __int64 a2)
{
  _fentry__(a1, a2);
  raw_spin_lock(&spin);
  printk(&unk_440);
  pv_ops[85](&spin);
  return -14;
}
```

---

`raw_spin_lock(&spin)`获取一个自旋锁，spin是全局变量，用于保护临界区，防止多核并发访问

`pv_ops[85](&spin)`其中`pv_ops`是一个虚表，用于在虚拟化环境执行某些操作

> 这里不知道虚表里面85到底代表什么操作，初步推断是自旋锁的相关操作
>
> 经过分析可以看到这个函数没用

---



### kgadget_read

```kgadget_read
ssize_t __fastcall kgadget_read(file *__file, char *user_buf, size_t size, loff_t *__loff)
{
  _fentry__(__file, user_buf);
  raw_spin_lock(&spin);
  printk(&unk_440);
  pv_ops[85](&spin);
  return -14;
}
```

---

> 这个函数没用

---



### kgadget_open

```kgadget_open
int __fastcall kgadget_open(inode *__inode, file *__file)
{
  _fentry__(__inode, __file);
  raw_spin_lock(&spin);
  printk(&unk_6C4);
  pv_ops[85](&spin);
  return 0;
}
```

> 这个函数也没用

