#!/usr/bin/env bash
# 推送并自动寻找可用代理出口。
#
# 背景：本机 github.com 无法直连，必须走本地代理；但代理端口会变
# （实测 10 分钟内从 7897 跳到 50523），写死一个端口会导致 push 随机失败。
# 这里先试当前配置，失败再扫本机监听端口，逐个验证能否访问 github.com。
# 探测超时给到 8s：github.com 握手在慢链路下 3s 会误判成不可用。
set -u
cd "$(dirname "$0")/.." || exit 1

try_push() {
  local proxy="${1:-}"
  if [ -n "$proxy" ]; then
    git -c "http.proxy=$proxy" -c "https.proxy=$proxy" push 2>&1
  else
    git push 2>&1
  fi
}

echo "== 1/2 使用当前配置推送 =="
if try_push ""; then
  echo "PUSH_OK (configured proxy)"
  exit 0
fi

echo "== 2/2 探测可用出口 =="
candidates="7897 7890 10809 1080 53433"
extra=$(netstat -ano 2>/dev/null | grep LISTENING | grep -oE "127\.0\.0\.1:[0-9]+" | cut -d: -f2 | sort -u)
# 并行探测：本机常有十几个监听端口，串行 8s 超时加起来会超过调用方的 timeout，
# 结果还没试到可用端口就被杀了（表现为"没有可用出口"，其实是没扫完）。
avail=$(printf '%s\n%s\n' "$candidates" "$extra" \
  | grep -E '^[0-9]+$' | sort -u \
  | xargs -P 10 -I{} sh -c 'c=$(curl -x "http://127.0.0.1:{}" -sS -o /dev/null -m 6 -w "%{http_code}" https://github.com/ 2>/dev/null); echo "$c {}"' \
  | awk '$1=="200" || $1=="301" {print $2}')
echo "-- 可用端口: $(echo "$avail" | tr '\n' ' ')"

for p in $avail; do
  echo "-- 尝试端口 $p"
  if try_push "http://127.0.0.1:$p"; then
    echo "PUSH_OK (port $p)"
    # 记住这次可用的端口，下次先用
    git config http.proxy "http://127.0.0.1:$p"
    exit 0
  fi
done

echo "PUSH_FAIL: 没有可用出口，请确认代理软件已启动"
exit 1
