#!/bin/sh
# ==========================================================================
# UU&Mixt uum-server 冒烟自测（docs/09 T5-1：curl 即可跑通全部接口）
# 用法：
#   BASE=http://127.0.0.1:8791 UU_TOKEN=<token> MIXT_TOKEN=<token> sh selftest.sh
# 缺省 token 为本地开发值（对应 config.dev.json 里的 hash）。
# 覆盖：verify(401/200/限流) · list(跨面403) · read(404) · write(新建/409/更新/
#       路径穿越/绝对路径/超限413) · 站点级友链 · multipart 图片(200/后缀400/
#       超限413) · delete(409/200/404) · 桌宠路由(502 无 Key) · healthz
# ==========================================================================
set -u
BASE="${BASE:-http://127.0.0.1:8791}"
UU_TOKEN="${UU_TOKEN:-dev-uu-token}"
MIXT_TOKEN="${MIXT_TOKEN:-dev-mixt-token}"
export no_proxy="*" NO_PROXY="*"   # 本机自测必须直连：沙箱/系统代理会拦 127.0.0.1
TMP="${TMPDIR:-/tmp}/uum-selftest.$$"
mkdir -p "$TMP"
BODY="$TMP/body.json"

pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; echo "      body: $(head -c 200 "$BODY" 2>/dev/null)"; }

# check <名称> <期望码> <实际码> [body 必含字符串]
check() {
  if [ "$2" = "$3" ] && { [ -z "$4" ] || grep -q "$4" "$BODY" 2>/dev/null; }; then
    ok "$1"
  else
    bad "$1（期望 $2 实得 $3）"
  fi
}

# req METHOD PATH TOKEN [DATA] [CONTENT_TYPE] —— 响应体落 $BODY
req() {
  m="$1"; p="$2"; t="$3"; d="${4:-}"; c="${5:-application/json}"
  if [ -n "$d" ]; then
    code=$(curl -s -o "$BODY" -w '%{http_code}' -X "$m" "$BASE$p" \
      -H "Authorization: Bearer $t" -H "Content-Type: $c" --data-binary "$d")
  else
    code=$(curl -s -o "$BODY" -w '%{http_code}' -X "$m" "$BASE$p" -H "Authorization: Bearer $t")
  fi
}

# reqfile METHOD PATH TOKEN DATA_FILE —— 大体走文件，避免命令行超长
reqfile() {
  m="$1"; p="$2"; t="$3"; f="$4"
  code=$(curl -s -o "$BODY" -w '%{http_code}' -X "$m" "$BASE$p" \
    -H "Authorization: Bearer $t" -H "Content-Type: application/json" --data-binary @"$f")
}

echo "=== 1. verify ==="
req POST /api/verify "" '{"token":"wrong-token"}'
check "verify 错误 token → 401" 401 "$code" "凭据无效"
req POST /api/verify "" "{\"token\":\"$UU_TOKEN\"}"
check "verify UU → 200 face=uu" 200 "$code" '"face":"uu"'
req POST /api/verify "" "{\"token\":\"$MIXT_TOKEN\"}"
check "verify Mixt → 200 face=mixt" 200 "$code" '"face":"mixt"'

echo "=== 2. list ==="
req GET "/api/list?path=src/content/mixt" "$MIXT_TOKEN"
check "list 本人面目录 → 200" 200 "$code" "tcache-layout"
req GET "/api/list?path=src/content/uu" "$MIXT_TOKEN"
check "list 他人面目录 → 403" 403 "$code" "越权"

echo "=== 3. read ==="
req GET "/api/read?path=src/content/mixt/tcache-layout.md" "$MIXT_TOKEN"
check "read 本人文章 → 200" 200 "$code" '"sha"'
req GET "/api/read?path=src/content/mixt/no-such.md" "$MIXT_TOKEN"
check "read 不存在 → 404" 404 "$code" "404"

echo "=== 4. write（文本） ==="
NEW='{"path":"src/content/mixt/hello.md","content":"---\ntitle: hello\n---\n\nhi\n","message":"content(mixt): 新增 hello"}'
req POST /api/write "$MIXT_TOKEN" "$NEW"
check "write 新建 → 200 带 sha" 200 "$code" '"sha"'
req POST /api/write "$MIXT_TOKEN" "$NEW"
check "write 同路径无 sha → 409 乐观锁" 409 "$code" "409"
req POST /api/write "$MIXT_TOKEN" '{"path":"src/content/uu/other.md","content":"x","message":"m"}'
check "write 他人面 → 403" 403 "$code" "越权"
req POST /api/write "$MIXT_TOKEN" '{"path":"../evil.md","content":"x"}'
check "write 路径穿越 → 400" 400 "$code" "400"
req POST /api/write "$MIXT_TOKEN" '{"path":"/etc/passwd","content":"x"}'
check "write 绝对路径 → 400" 400 "$code" "400"
printf '{"path":"src/content/mixt/big.md","content":"%s"}' "$(printf 'a%.0s' $(seq 1 206000))" > "$TMP/big.json"
reqfile POST /api/write "$MIXT_TOKEN" "$TMP/big.json"
check "write 201KB 超限 → 413" 413 "$code" "413"
req POST /api/write "$MIXT_TOKEN" '{"path":"src/data/friends.json","content":"[]","message":"content(friends): 清空"}'
check "write 站点级友链（Mixt）→ 200" 200 "$code" '"ok"'
req POST /api/write "$MIXT_TOKEN" '{"path":"src/config/categories-uu.json","content":"[]","message":"m"}'
check "write 他人分类配置 → 403" 403 "$code" "越权"

echo "=== 5. write（multipart 图片） ==="
printf '\x89PNG\r\n\x1a\n' > "$TMP/t.png"
code=$(curl -s -o "$BODY" -w '%{http_code}' -X POST "$BASE/api/write" \
  -H "Authorization: Bearer $MIXT_TOKEN" \
  -F "path=public/images/mixt/pic.png" -F "message=media(mixt): 上传" -F "file=@$TMP/t.png")
check "multipart 图片上传 → 200" 200 "$code" '"ok"'
printf 'MZ-fake' > "$TMP/t.exe"
code=$(curl -s -o "$BODY" -w '%{http_code}' -X POST "$BASE/api/write" \
  -H "Authorization: Bearer $MIXT_TOKEN" \
  -F "path=public/images/mixt/evil.exe" -F "message=m" -F "file=@$TMP/t.exe")
check "multipart .exe 后缀 → 400" 400 "$code" "图片文件"
head -c 2200000 /dev/zero > "$TMP/big.png"
code=$(curl -s -o "$BODY" -w '%{http_code}' -X POST "$BASE/api/write" \
  -H "Authorization: Bearer $MIXT_TOKEN" \
  -F "path=public/images/mixt/big.png" -F "message=m" -F "file=@$TMP/big.png")
check "multipart 2.1MB 超限 → 413" 413 "$code" "413"
code=$(curl -s -o "$BODY" -w '%{http_code}' -X POST "$BASE/api/write" \
  -H "Authorization: Bearer $MIXT_TOKEN" \
  -F "path=public/images/uu/steal.png" -F "message=m" -F "file=@$TMP/t.png")
check "multipart 他人图片目录 → 403" 403 "$code" "越权"

echo "=== 6. delete ==="
req GET "/api/read?path=src/content/mixt/hello.md" "$MIXT_TOKEN"
HELLO_SHA=$(grep -o '"sha":"[a-f0-9]*"' "$BODY" | head -1 | cut -d'"' -f4)
req DELETE "/api/file?path=src/content/mixt/hello.md&sha=deadbeef&message=m" "$MIXT_TOKEN"
check "delete 错 sha → 409" 409 "$code" "409"
# 真实客户端（server.js）对 query 做 encodeURIComponent；此处 message 不带空格即可直发
req DELETE "/api/file?path=src/content/mixt/hello.md&sha=$HELLO_SHA&message=content(mixt):删除hello" "$MIXT_TOKEN"
check "delete 正确 sha → 200" 200 "$code" '"ok"'
req DELETE "/api/file?path=src/content/mixt/hello.md&sha=$HELLO_SHA&message=m" "$MIXT_TOKEN"
check "delete 已删除 → 404" 404 "$code" "404"

echo "=== 7. 桌宠路由（无 Key 上游 → 502 优雅报错）==="
req POST /api/pet/chat "" '{"messages":[{"role":"user","content":"你好呀"}]}'
check "pet/chat → 502 小鹿走神" 502 "$code" "小鹿走神"
req POST /api/chat "" '{"messages":[{"role":"user","content":"你好呀"}]}'
check "chat 兼容别名 → 502 同语义" 502 "$code" "小鹿走神"

echo "=== 8. healthz ==="
req GET /healthz ""
check "healthz → 200" 200 "$code" '"ok"'

echo "=== 9. 限流（verify 连发 35 次，30/分上限应触发 429） ==="
i=0; hit429=0
while [ $i -lt 35 ]; do
  c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/verify" -H "Content-Type: application/json" -d '{"token":"x"}')
  [ "$c" = "429" ] && hit429=$((hit429+1))
  i=$((i+1))
done
if [ "$hit429" -ge 1 ]; then ok "verify 限流 429 触发（$hit429 次）"; else bad "verify 限流未触发"; fi

rm -rf "$TMP"
echo ""
echo "结果：PASS=$pass FAIL=$fail"
[ "$fail" = 0 ]
