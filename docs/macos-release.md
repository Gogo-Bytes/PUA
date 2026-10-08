# macOS 签名候选包

`.github/workflows/macos-signed.yml` 由 Actions 手动触发，在 macOS 15 arm64 与 Intel x64 各自运行完整 `verify`，再以 `build/macos-release.mjs` 生成 Developer ID 签名、公证并附票的 DMG/ZIP。工作流检查 `codesign`、`stapler`、Gatekeeper 和打包应用离线烟测，只把安装包保存为工作流 artifact；不会创建公开 GitHub Release。日常三平台 CI 继续验证未签名安装包。

## 仓库 Secrets

在仓库 Actions Secrets 中配置以下五项，不要把证书、私钥或密码提交到仓库或发送到聊天中：

| 名称 | 内容 |
| --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | 导出的 **Developer ID Application** `.p12` 文件的 Base64 内容 |
| `MACOS_CERTIFICATE_PASSWORD` | 上述 `.p12` 的导出密码 |
| `APPLE_API_KEY_P8_BASE64` | App Store Connect API 私钥 `.p8` 文件的 Base64 内容 |
| `APPLE_API_KEY_ID` | 该 API 私钥的 Key ID |
| `APPLE_API_ISSUER` | 该 API 私钥的 Issuer ID |

工作流把 `.p8` 解码到 runner 临时目录，传其路径给当前锁定的 electron-builder 26.17.0；结束时删除临时文件。缺少任一项会在打包前明确失败。证书必须是仓库发布主体可用的 Developer ID Application 身份；App Store Distribution 身份不适用于这个仓库外分发流程。

配置后，在 Actions 中手动运行 **macOS signed candidate**。两个架构都通过后，下载 `pua-macos-arm64` 与 `pua-macos-x64` artifacts 进行安装、首次打开和升级实机验收。当前应用 ID `dev.pi.desktop`、产品名 `Pi Desktop` 及用户数据路径保持不变。

本机也可在已安装 Developer ID 身份、且 `APPLE_API_KEY` 指向 `.p8` 文件时运行：

```sh
npm run verify
npx electron-builder --config build/macos-release.mjs --mac --publish never
codesign --verify --deep --strict --verbose=2 'release/mac-arm64/Pi Desktop.app'
xcrun stapler validate 'release/mac-arm64/Pi Desktop.app'
spctl --assess --verbose --type exec 'release/mac-arm64/Pi Desktop.app'
```

Apple 对仓库外分发的软件要求 Developer ID、Hardened Runtime 和公证；electron-builder 26 的 `mac.notarize` 配置与 API Key 环境变量见[官方文档](https://www.electron.build/v26/docs/features/code-signing/notarization/)，Gatekeeper 与公证要求见 [Apple 文档](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)。
