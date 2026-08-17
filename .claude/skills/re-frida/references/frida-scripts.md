# Frida 脚本模板

按场景选用模板，替换占位符（`<pkg>` 包名、`<cls>` 类名、`<method>` 方法名）。统一骨架：**先保存 original 引用再带 `this` 调用原方法**；输出双格式（可打印 ASCII + hex）；`try/catch` 包裹；全部在沙箱内执行。通用对抗方法论见 [[anti-dynamic-workflow]]。

## 通用骨架

```javascript
Java.perform(function () {
  try {
    var Cls = Java.use('<cls>');
    var orig = Cls.<method>.overloads[0].implementation;
    Cls.<method>.overloads[0].implementation = function () {
      var ret = orig.call(this, ...arguments);
      console.log(JSON.stringify({ method: '<cls>.<method>', ret: String(ret) }));
      return ret;
    };
  } catch (e) { console.log(JSON.stringify({ error: String(e) })); }
});
```

## TLS 密钥日志（SSLKEYLOGFILE 路线）

hook BoringSSL 的 `SSL_CTX_new`，onLeave 对每个新 SSL_CTX 注入 keylog 回调——输出可直接存为 SSLKEYLOGFILE 喂 Wireshark 解密 HTTPS 明文：

```javascript
var ssl = Process.findModuleByName('libssl.so');
if (!ssl) { console.log(JSON.stringify({ error: 'libssl not found' })); }
else {
  var keyLogCallback = new NativeCallback(function (sslPtr, line) {
    console.log(new NativePointer(line).readCString());
  }, 'void', ['pointer', 'pointer']);
  var setKeylog = new NativeFunction(
    Module.findExportByName('libssl.so', 'SSL_CTX_set_keylog_callback'), 'void', ['pointer', 'pointer']);
  Interceptor.attach(Module.findExportByName('libssl.so', 'SSL_CTX_new'), {
    onLeave: function (retval) { setKeylog(new NativePointer(retval), keyLogCallback); }
  });
}
// 局限：仅 Android 系统自带 BoringSSL；App 内置/静态链接的 TLS 栈不覆盖
```

## SSL 固定绕过（TrustManager trust-all + CertificatePinner）

`SSLContext.init` 时替换为 trust-all 的 `X509TrustManager`（信任任意证书链）；OkHttp 的 `CertificatePinner` 是独立校验层，另行置空：

```javascript
Java.perform(function () {
  try {
    var X509TrustManager = Java.use('javax.net.ssl.X509TrustManager');
    var TrustAll = Java.registerClass({
      name: 'com.bypass.TrustAll',
      implements: [X509TrustManager],
      methods: { checkClientTrusted: function () {}, checkServerTrusted: function () {},
                 getAcceptedIssuers: function () { return []; } }
    });
    var SSLContext = Java.use('javax.net.ssl.SSLContext');
    SSLContext.init.implementation = function (km, tm, sr) {
      console.log(JSON.stringify({ event: 'ssl_trust_all', keystore: String(km), secureRandom: String(sr) }));
      this.init(km, [TrustAll.$new()], sr);
    };
    var Pinner = Java.use('okhttp3.CertificatePinner');
    Pinner.check.overload('java.lang.String', 'java.util.List').implementation = function (host, certs) {
      console.log(JSON.stringify({ event: 'cert_pinner_bypass', host: host }));
    };
  } catch (e) { console.log(JSON.stringify({ error: String(e) })); }
});
// 局限：仅覆盖 Java 层（OkHttp / HttpsURLConnection 等）校验；原生层直调 BoringSSL / libssl 的固定校验不走此路径
```

## 内存 DEX dump（类加载点抓取）

hook `art::ClassLinker::DefineClass`（libart.so mangled 符号特征匹配），类加载点从参数取 DexFile 读 `begin_`/`size_`，校验 dex magic 后整段落盘：

```javascript
var libart = Process.findModuleByName('libart.so');
if (libart) {
  var sym = libart.enumerateSymbolsSync().find(s =>
    s.name.includes('ClassLinker') && s.name.includes('DefineClass') && s.name.includes('DexFile'));
  if (sym) Interceptor.attach(sym.address, {
    onEnter: function (args) {
      // 参数位次与字段偏移为版本相关经验值（Android 9：DexFile 引用在第 6 参；begin_=+8、size_=+16）
      var dexFile = args[5];
      if (dexFile.isNull()) return;
      var begin = dexFile.add(Process.pointerSize).readPointer();
      var size = dexFile.add(Process.pointerSize * 2).readUInt();
      if (size < 4 || begin.isNull() || begin.readCString(3) !== 'dex') return;
      // 以 base 去重后 readByteArray(size) 写盘到 files 目录
      console.log(JSON.stringify({ event: 'dex', base: begin.toString(), size: size }));
    }
  });
  // dlopen / android_dlopen_ext onLeave 再挂一次，兜底 libart 晚加载设备
}
```

## 内存 SO dump（运行时解密/加固）

```javascript
function dumpSo(name) {
  var m = Process.getModuleByName(name);
  if (!m) return;
  Memory.protect(m.base, m.size, 'rwx');
  var buf = m.base.readByteArray(m.size);
  var out = new File('/data/local/tmp/' + name + '_' + m.base + '.so', 'wb');
  out.write(buf); out.close();
  console.log(JSON.stringify({ event: 'so_dump', name: name, base: m.base.toString(), size: m.size }));
}
```

## JNI 动态注册还原（RegisterNatives + 汇聚点双 hook）

libart.so 符号特征匹配（统一排除 CheckJNI）；`JNI::RegisterNatives` 建 fnPtr→方法名映射，`ArtMethod::RegisterNative` 是注册汇聚点，直接拿 native 地址与 SO 内偏移：

```javascript
var libart = Process.findModuleByName('libart.so');
var map = {};
var parseTable = function (methods, count) {
  var rows = [];
  for (var i = 0; i < count.toInt32(); i++) {
    var p = methods.add(i * Process.pointerSize * 3);   // 每项 3 指针：name/sig/fnPtr
    rows.push({ name: p.readPointer().readCString(), sig: p.add(Process.pointerSize).readPointer().readCString(),
                fn: p.add(Process.pointerSize * 2).readPointer().toString() });
  }
  return rows;
};
if (libart) libart.enumerateSymbolsSync().forEach(function (s) {
  if (s.name.includes('JNI') && s.name.includes('RegisterNatives') && !s.name.includes('CheckJNI')) {
    Interceptor.attach(s.address, {
      onEnter: function (args) {
        var cls = Java.vm.tryGetEnv().getClassName(args[1]);
        parseTable(args[2], args[3]).forEach(function (r) { map[r.fn] = cls + '.' + r.name + r.sig; });
      }
    });
  }
  if (s.name.includes('ArtMethod') && s.name.includes('RegisterNative') && !s.name.includes('Callback')) {
    Interceptor.attach(s.address, {
      onEnter: function (args) {
        var fnPtr = args[1], mod = Process.findModuleByAddress(fnPtr);
        if (mod) console.log(JSON.stringify({ event: 'registerNative', method: map[fnPtr.toString()] || '(unresolved)',
          so: mod.name, off: '0x' + fnPtr.sub(mod.base).toString(16) }));
      }
    });
  }
});
```

## Java 加密算法拦截（overload 全覆盖）

```javascript
Java.perform(function () {
  var hex = function (b) { var s = ''; for (var i = 0; i < b.length; i++) s += ('0' + (b[i] & 0xff).toString(16)).slice(-2); return s; };
  var SKS = Java.use('javax.crypto.spec.SecretKeySpec');
  SKS.$init.overload('[B', 'java.lang.String').implementation = function (key, algo) {
    console.log(JSON.stringify({ event: 'secret_key', algo: algo, keyHex: hex(key) }));
    this.$init(key, algo);
  };
  var Cipher = Java.use('javax.crypto.Cipher');
  ['(int,java.security.Key)', '(int,java.security.Certificate)',
   '(int,java.security.Key,java.security.spec.AlgorithmParameterSpec)',
   '(int,java.security.Key,java.security.SecureRandom)',
   '(int,java.security.Certificate,java.security.SecureRandom)',
   '(int,java.security.Key,java.security.AlgorithmParameters)',
   '(int,java.security.Key,java.security.AlgorithmParameters,java.security.SecureRandom)',
   '(int,java.security.Key,java.security.spec.AlgorithmParameterSpec,java.security.SecureRandom)'
  ].forEach(function (sig) {
    try {
      Cipher.init.overload.apply(Cipher, sig.split(',').map(function (s) { return s.trim(); })).implementation = function (mode, key) {
        var enc = key.getEncoded ? key.getEncoded() : null;
        console.log(JSON.stringify({ event: 'cipher_init', mode: mode, keyHex: enc ? hex(enc) : null }));
        this.init.apply(this, arguments);
      };
    } catch (e) {}
  });
  // doFinal/update 输入输出双向记录；IvParameterSpec.$init 打 IV；DESKeySpec/RSAPublicKeySpec/KeyPairGenerator 同模式
});
```

## 双向 TLS 客户端证书导出（keystore dump）

hook `KeyStore$PrivateKeyEntry.getPrivateKey` / `getCertificateChain`（双向认证读客户端证书必经点），经 BouncyCastle PKCS12 导出 p12：

```javascript
Java.perform(function () {
  var PKE = Java.use('java.security.KeyStore$PrivateKeyEntry');
  PKE.getCertificateChain.implementation = function () {
    var chain = this.getCertificateChain();
    try {
      var ks = Java.use('java.security.KeyStore').getInstance('PKCS12', 'BC');
      ks.load(null, null);
      ks.setKeyEntry('client', this.getPrivateKey(), 'hooker'.toCharArray(), chain);
      var f = Java.use('java.io.FileOutputStream').$new('/data/local/tmp/client.p12');
      ks.store(f, 'hooker'.toCharArray()); f.close();
      console.log(JSON.stringify({ event: 'keystore_dump', path: '/data/local/tmp/client.p12' }));
    } catch (e) {}
    return chain;
  };
});
```

## Root / 插桩检测绕过（检测点表）

| 检测点 | hook 目标 | 手法 |
|---|---|---|
| 包名 | `ApplicationPackageManager.getPackageInfo` | 命中 root/xposed 包名列表 → 替换为假包名 |
| 文件 | `java.io.File.exists` | 命中 su/busybox 等路径 → false |
| 命令 | `Runtime.exec` 全部 overload / `ProcessBuilder.start` | "su" → 不存在命令；getprop/mount → "grep" |
| 属性 | `SystemProperties.get` | ro.debuggable="0"、ro.secure="1"、ro.kernel.qemu="0" |
| test-keys | `String.contains` / `BufferedReader.readLine` | "test-keys" → false / 改写 "release-keys" |
| native 文件 | libc `fopen` | basename 命中 → 路径改写 /notexists |
| native 命令 | libc `system` | 命令命中 → 改写假命令 |
| 裸系统调用 | svc 指令特征码扫描（arm64: `01 00 00 D4`，SYS_OPENAT=56，无 open 系统调用） | 捕获绕过 libc 的文件访问（arm64 openat 路径参数在 x1，x0 是 dirfd） |

绕过策略不预置全家桶：基线跑原样目标 → 崩溃特征反推保护点（对照表见 [[anti-dynamic-workflow]]）→ 定点 hook；迭代 3-5 层是常态。

## 实现教训（内化）

- 返回值只能在 **onLeave 用 `retval.replace()`** 改；保存 original 后必须带原 `this` 调用
- `Java.use` 同一类有缓存，多个 `.implementation` 赋值**静默覆盖**——相关 hook 合并进一个
- 符号定位统一 `enumerateSymbolsSync` + mangled 名特征匹配，排除 CheckJNI / `__va_list`
- 参数索引与字段偏移是版本相关经验值（跨版本需对照目标符号核实）
- 客户端 hook 无法伪造**服务端** attestation 结论——服务端校验只写「无法绕过」

## 使用注意

- 全部在沙箱内执行（见 [[platform-tips]] 最高原则）；`--pause` 覆盖早期代码检查
- 输出 JSON 供 [[analysis-contract]] 数据契约消费（证据存档）
