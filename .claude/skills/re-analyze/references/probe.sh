#!/bin/sh
# probe.sh — 环境探测：OS 平台 / CPU / 内存 / 已装逆向工具
# 输出约定：OS: / ARCH: / CORES: / MEM_GB: / HAVE:tool（逐个）/ MISS: tool tool …（汇总一行）
#   —— HAVE 是"优先用什么"的依据，逐个列出；MISS 只作提示，汇总成一行避免刷屏
# 工具清单由登记表生成（见下方 GENERATED-TOOLS 块），不要手改
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
    # 必须固定 LC_ALL=C：本地化的 free 会把 "Mem:" 译成"内存："等，awk 匹配不到（曾导致该项恒为空）
    echo "MEM_GB: $(LC_ALL=C free -g 2>/dev/null | awk '/^Mem:/{print $2}')"
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
# >>> GENERATED-TOOLS（源：docs/audit/tool-register.json；改清单请改登记表后跑 node bin/probelist.mjs）
# shellcheck disable=SC2034
PROBE_TOOLS="aapt2 adb afl-clang-fast afl-cmin afl-fuzz afl-tmin apksigner apktool arm-linux-gnueabi-readelf atos binwalk blkls canbusload candump cansniffer capinfos class-dump codesign cpuid cramfsck defaults dexdump diec docker dotnet dotnet-dump dpkg-deb driverquery eu-stack ffprobe firejail flashrom fls fltmc frida frida-dexdump frida-trace fsstat gcore gdb gdb-multiarch Get-WinEvent ghc hackrf_transfer hbc-decompiler hbc-disassembler hbc-file-parser icat idevicebackup2 iproxy iptables jadx jar java javap jdb js-beautify jtool2 keytool ld64.lld lipo lldb llvm-nm llvm-objdump llvm-readobj logman ltrace mactime mitmproxy mmls modprobe mono mp4dump netron nm npx objcopy objdump ocamlc ocamlobjinfo ocamlopt olevba one_gadget openocd openssl otool palera1n panoramix pdf-parser pdfid.py photorec picocom powershell procdump pwsh pycdc pyinstaller qemu-arm qemu-system-arm qemu-system-mips qemu-system-x86_64 readelf rg rizin ROPgadget ropper rr rtfobj rtl_sdr rz-diff rz-pm schtasks sdkmanager spctl strace sysctl systemctl tcpdump testdisk tshark tsk_recover uefiextract ueifind unblob unsquashfs upx VBoxManage vmrun vol wasm-decompile wasm-objdump wasm2wat wasm3 wasmtime yara zig zsteg"
# <<< GENERATED-TOOLS
MISS_LIST=""
for t in $PROBE_TOOLS; do
  if command -v "$t" >/dev/null 2>&1; then
    echo "HAVE: $t"
  else
    MISS_LIST="$MISS_LIST $t"
  fi
done
[ -n "$MISS_LIST" ] && echo "MISS:$MISS_LIST"

echo "== HINT =="
echo "已装工具(HAVE)优先使用；未装工具(MISS)按对应技能的「工具准备」章节引导安装，不中断分析流程。"
