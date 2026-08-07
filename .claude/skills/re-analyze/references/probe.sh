#!/bin/sh
# probe.sh — 环境探测：OS 平台 / CPU / 内存 / 已装逆向工具
# 输出约定：OS: / ARCH: / CORES: / MEM_GB: / HAVE:tool / MISS:tool
# 通用原则：空白环境（无任何工具）也必须正常输出，绝不中断。

echo "== ENV =="
if command -v uname >/dev/null 2>&1; then
  case "$(uname -s)" in
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        echo "OS: WSL-Linux"
      else
        echo "OS: Linux"
      fi
      ;;
    Darwin) echo "OS: macOS" ;;
    MINGW*|MSYS*|CYGWIN*) echo "OS: Windows(msys)" ;;
    *) echo "OS: $(uname -s)" ;;
  esac
  echo "ARCH: $(uname -m)"
  if command -v nproc >/dev/null 2>&1; then echo "CORES: $(nproc)"; else echo "CORES: unknown"; fi
  if command -v free >/dev/null 2>&1; then
    echo "MEM_GB: $(free -g 2>/dev/null | awk '/^Mem:/{print $2}')"
  else
    echo "MEM_GB: unknown"
  fi
else
  echo "OS: Windows"
  echo "ARCH: unknown"
  echo "CORES: unknown"
  echo "MEM_GB: unknown"
fi

echo "== TOOLS =="
for t in ghidra radare2 rizin rz-bin gdb lldb x64dbg frida frida-server \
         binwalk unblob qemu-system-x86_64 qemu-system-aarch64 qemu-aarch64 \
         jadx apktool angr z3 capa floss strings objdump readelf file; do
  if command -v "$t" >/dev/null 2>&1; then
    echo "HAVE: $t"
  else
    echo "MISS: $t"
  fi
done

echo "== HINT =="
echo "已装工具(H)优先使用；未装工具(M)按对应技能的「工具准备」章节引导安装，不中断分析流程。"
