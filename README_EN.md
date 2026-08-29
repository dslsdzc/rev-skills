# rev-skills — A General-Purpose Reverse Engineering AI Skills Library

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE) [![License: CC BY 4.0](https://img.shields.io/badge/License-CC_BY_4.0-lightgrey.svg)](LICENSE-docs.md)

[中文版](README.md) | English

121 reverse engineering skills covering malware analysis, software reversing, firmware/embedded, protocol reversing, mobile apps, packing/obfuscation, cracking, vulnerability research, managed code, forensics/threat intel, and CTF. **General-purpose and distributable**: no tool is assumed to be installed — every skill ships with cross-OS installation guidance.

> **Usage boundary**: This library is intended **only for security research and authorized analysis**. Obtain authorization from the target owner before use; unauthorized reversing, cracking, bypassing protections, or malicious activity is prohibited. The legality of reverse engineering varies by jurisdiction (e.g., the US DMCA anti-circumvention provisions, regional software protection laws). Users are responsible for complying with local law and for any consequences of misuse. This library contains general methodology and targets no specific entity.

## Installation

### Option 1: npx installer (supports 7 AI tools)

> The custom installer additionally handles rule aggregation for Cursor / Copilot / Windsurf (`.mdc` / instruction files), a capability the standard skills CLI lacks. For Claude Code-family tools only, Option 2 works too.

```bash
npx rev-skills install                     # interactive, defaults to Claude Code
npx rev-skills install --target all        # install into all 7 tools
npx rev-skills install --target cursor     # generate Cursor rules
npx rev-skills install --target gemini     # Gemini CLI native skills
npx rev-skills install --global            # global install
npx rev-skills install --project           # current project only
npx rev-skills install --dry-run           # show plan without installing
npx rev-skills uninstall                   # uninstall
```

### Option 2: Standard skills CLI (agentskills.io compatible)

This library follows the [Agent Skills specification](https://agentskills.io) and can be discovered and installed by any compatible runtime (Claude Code / Codex / Cursor / Gemini CLI and 50+ other tools):

```bash
npx skills add dslsdzc/rev-skills          # project scope (.claude/skills/)
npx skills add dslsdzc/rev-skills -g       # global (~/.claude/skills/)
npx skills add dslsdzc/rev-skills -l       # list skills without installing
```

### Option 3: Manual copy

Copy the skill directories under `.claude/skills/` into `~/.claude/skills/` (Claude Code) or the corresponding directory of your tool.

### Option 4: Claude Code plugin marketplace

This repo ships its own `.claude-plugin/marketplace.json` and can be added as a self-hosted plugin marketplace:

```text
/plugin marketplace add dslsdzc/rev-skills
/plugin install rev-skills
```

(If a plugin with the same name comes from multiple marketplaces, disambiguate with `rev-skills@rev-skills`.)

## Tool support

| Tool | Install method | Experience |
|---|---|---|
| Claude Code | `--target claude` | native skills (on-demand loading) |
| Gemini CLI | `--target gemini` | native skills |
| Cline | `--target cline` | native skills (compatible) |
| Codex CLI | `--target codex` | native skills |
| Cursor | `--target cursor` → `.cursor/rules/*.mdc` | rule aggregation (knowledge + flow, no on-demand loading) |
| GitHub Copilot | `--target copilot` → `.github/copilot-instructions.md` | rule aggregation |
| Windsurf | `--target windsurf` → `.windsurf/rules/*.md` | rule aggregation |

## Skill map (121)

Entry → 12 category gateways → 108 atomic skills. See `.claude/skills/` and `docs/skill-template.md` for details. Quick index:

- **re-analyze**: entry point (probe → preference → identification → orchestration)
- **re-binary-core**: re-address-space (address translation), re-triage, re-format-pe/elf/macho, re-imports, re-ghidra, re-ida, re-radare2, re-gdb, re-x64dbg, re-lldb, re-tracing, re-memdump, re-windbg, re-binaryninja, re-emulation, re-shellcode, re-kernel, re-ebpf, re-game, re-console, re-go, re-rust, re-plugin-dev, re-hypervisor, re-anti-cheat, re-cpp-abi, re-swift, re-zig, re-nim, re-fp-runtime, re-variant, re-mips, re-arm, re-riscv
- **re-malware**: re-sandbox, re-behavior, re-ioc, re-ransomware, re-loader, re-fileless, re-doc-malware
- **re-firmware**: re-fw-extract, re-fw-rootfs, re-fw-emulate, re-hardware-io, re-automotive, re-uefi, re-rtos, re-tee
- **re-protocol**: re-netcap, re-proto-rev, re-crypto-id, re-crypto-keys, re-crypto-decrypt, re-ics, re-iot-proto, re-whitebox, re-tls
- **re-mobile**: re-apk, re-ios, re-frida, re-frida-script-author, re-mobile-pack, re-hybrid-app, re-android-native, re-android-crypto (crypto audit), re-ios-jb, re-flutter, re-harmonyos
- **re-anti-analysis**: re-packer-id, re-unpack-simple, re-unpack-advanced, re-deobfuscate, re-evasion
- **re-cracking**: re-license, re-patching, re-keygen, re-drm
- **re-vuln**: re-fuzzing, re-crash-triage, re-exploit
- **re-ctf**: re-angr, re-z3, re-pwn, re-stego
- **re-managed**: re-dotnet, re-java, re-script-deob, re-wasm, re-ai-triage (AI triage) → re-ai-model, re-ai-attack, re-blockchain, re-python, re-browser-ext, re-electron, re-javacard
- **re-forensics**: re-mem-forensics, re-disk-forensics, re-ti, re-attribution, re-hunting, re-mobile-forensics
- **re-macos**: macOS app reversing (signing/entitlements/Secure Enclave)
- **re-hw-chip**: chip/PCB physical layer (decapping/die analysis/trojan detection)
- **re-ai-attack**: AI model security assessment (behavior layer: extraction/fingerprinting/membership inference/robustness)
- **re-sdr**: RF reversing (capture/demodulation/frame recovery)
- **re-feedback**: experience feedback meta-gateway — three sources (session review / article scanning / manual input) → distillation with desensitization → domain routing → three-tier handling (publish issue / store locally / discard), hooked into step 4 of re-analyze

## Design principles

- Blank-slate environment by default: tool missing → guided install via the "Tool preparation" section inside the skill, no interruption
- Sandbox by default: dynamic analysis always requires a sandbox first
- Dump-first by default: memory reads default to `gcore` dumps
- Platform experience base: `.claude/skills/re-analyze/references/platform-tips.md`

## License

This repository is dual-licensed:

- **Skill documentation content** (`.claude/skills/` and doc files): [CC BY 4.0](LICENSE-docs.md) — copy/modify/commercial use permitted, attribution required
- **Tool code** (`bin/`, `validate.mjs`, `tests/`): [Apache-2.0](LICENSE)

## Development

```bash
npm test   # structural validation (frontmatter/dead links/tool-prep sections) + installer unit tests
```

Release flow: `npm test` passes → git tag → npm publish → sync marketplace.json version.
