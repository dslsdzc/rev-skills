import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// system-fingerprints.md 的维护约定是「新增系统分支须同步加行」——本测试把它变成检查：
// 任何一个分支文件必须出现在 MAPPED（映射到指纹表里的某个名字）或 EXEMPT（非系统文件，须写明理由）。
// 新增分支却两处都没登记 → 红线；这样"约定"就不会随时间失效。
const FP = '.claude/skills/re-analyze/references/system-fingerprints.md';
const ROOT = '.claude/skills/';
const DIRS = ['re-kernel', 're-rtos', 're-hypervisor', 're-automotive', 're-uefi'];

// 分支文件 → 指纹表里应出现的关键字（可用多个，任选其一命中即可）
const MAPPED = {
  're-kernel/windows-kernel': ['Windows'],
  're-kernel/linux-kernel': ['Linux'],
  're-kernel/macos-kernel': ['macOS'],
  're-kernel/android-kernel': ['Android'],
  're-kernel/sel4-kernel': ['seL4'],
  're-kernel/zircon-kernel': ['Fuchsia'],
  're-kernel/freebsd-kernel': ['FreeBSD'],
  're-kernel/netbsd-kernel': ['NetBSD'],
  're-kernel/openbsd-kernel': ['OpenBSD'],
  're-kernel/illumos-kernel': ['illumos'],
  're-kernel/genode': ['Genode'],
  're-kernel/minix3': ['MINIX 3'],
  're-kernel/plan9': ['Plan 9'],
  're-kernel/helenos': ['HelenOS'],
  're-kernel/redox': ['Redox'],
  're-kernel/haiku': ['Haiku'],
  're-kernel/hic': ['HIC'],
  're-kernel/zos': ['z/OS'],
  're-kernel/ibmi': ['IBM i'],
  're-kernel/openvms': ['OpenVMS'],
  're-kernel/unikraft-mirageos': ['Unikraft', 'MirageOS'],
  're-rtos/qnx': ['QNX Neutrino'],
  're-rtos/vxworks': ['VxWorks'],
  're-rtos/zephyr': ['Zephyr'],
  're-rtos/rtems': ['RTEMS'],
  're-rtos/nuttx': ['NuttX'],
  're-rtos/ecos': ['eCos'],
  're-rtos/freertos-context': ['FreeRTOS'],
  're-rtos/threadx-modules': ['ThreadX Modules', 'ThreadX'],
  're-rtos/safertos-rtx5': ['SAFERTOS'],
  're-rtos/tkernel-toppers': ['T-Kernel', 'TOPPERS'],
  're-rtos/ose-oseck': ['OSE / OSEck', 'OSE'],
  're-rtos/nucleus': ['Nucleus'],
  're-rtos/ucos-sysbios': ['µC/OS', 'SYS/BIOS'],
  're-rtos/partitioned-rtos': ['INTEGRITY', 'PikeOS', 'ARINC 653', 'Deos'],
  're-hypervisor/xen': ['Xen'],
  're-hypervisor/qnx-hypervisor': ['QNX Hypervisor'],
  're-hypervisor/jailhouse': ['Jailhouse'],
  're-hypervisor/acrn': ['ACRN'],
  're-hypervisor/bao': ['Bao'],
  're-hypervisor/hyperv-vmbus': ['Hyper-V'],
  're-hypervisor/xtratum': ['XtratuM'],
  're-hypervisor/lynxsecure': ['LynxSecure'],
  're-hypervisor/questv': ['Quest-V'],
  're-automotive/autosar-classic': ['AUTOSAR Classic'],
  're-automotive/autosar-adaptive': ['AUTOSAR Adaptive'],
  're-uefi/pi-stages': ['UEFI'],
};

// 非系统分支（平台专属补充资料，不属于"某个系统"）
const EXEMPT = {
  're-kernel/windows-gotchas': 'Windows 版本差异组，随 windows-kernel 分支',
  're-kernel/windows-decision-tree': 'Windows 场景决策树，随 windows-kernel 分支',
};

function branchFiles() {
  const out = [];
  for (const d of DIRS) {
    let names;
    try { names = readdirSync(`${ROOT}${d}/references`); } catch { continue; }
    for (const n of names) {
      if (n.endsWith('.md')) out.push(`${d}/${n.replace(/\.md$/, '')}`);
    }
  }
  return out.sort();
}

test('每个系统分支都在指纹表里有对应条目', () => {
  const fp = readFileSync(FP, 'utf8');
  const bad = [];
  for (const [file, keys] of Object.entries(MAPPED)) {
    if (!keys.some((k) => fp.includes(k))) bad.push(`${file}：指纹表里找不到 ${keys.join(' / ')}`);
  }
  assert.deepEqual(bad, [], `指纹表缺条目：\n${bad.join('\n')}`);
});

test('新增分支必须登记到映射或豁免表（防约定失效）', () => {
  const known = new Set([...Object.keys(MAPPED), ...Object.keys(EXEMPT)]);
  const unregistered = branchFiles().filter((f) => !known.has(f));
  assert.deepEqual(unregistered, [],
    `以下分支既未映射到指纹表、也未列入豁免——请补 MAPPED（并在指纹表加行）或写明豁免理由：\n${unregistered.join('\n')}`);
});

test('映射表引用的分支文件都还存在（防改名后残留）', () => {
  const files = new Set(branchFiles());
  const stale = [...Object.keys(MAPPED), ...Object.keys(EXEMPT)].filter((f) => !files.has(f));
  assert.deepEqual(stale, [], `映射表里有已不存在的分支：${stale.join(' ')}`);
});

test('豁免项必须写明理由', () => {
  const empty = Object.entries(EXEMPT).filter(([, why]) => !why || why.length < 4).map(([f]) => f);
  assert.deepEqual(empty, [], `豁免项缺理由：${empty.join(' ')}`);
});
