# PhotoStack（批量描边工具）

PhotoStack is a free and open-source batch photo editor that runs in web browsers, complete with offline support. It can crop, resize, and convert many images at once. You can also create and save watermarks and apply them to images.

PhotoStack uses components from [Bootstrap](https://getbootstrap.com), [FileSaver.js](https://github.com/eligrey/FileSaver.js/), [JSZip](https://stuk.github.io/jszip/), and [Pica](https://github.com/nodeca/pica).

**[Open PhotoStack in your browser](https://photostack.app)**

![Screenshot of PhotoStack](screen.png)

## 中文说明：批量描边工具

本项目是一款纯中文界面的批量图片处理工具，主打批量描边，主要功能：

- **批量按顺序导入**：支持一次选择多张图片（也支持拖拽和 ZIP 包），导入顺序即处理和导出顺序，可点「按文件名排序」纠正顺序。
- **翻页预览**：预览区可逐张查看每张图的处理效果，支持「上一张 / 下一张」按钮、键盘 ←/→，手机上在预览图上左右滑动即可翻页。
- **描边与圆角**：可批量设置描边粗细（px）和颜色；描边向外扩展，不遮挡图片内容。开启「圆角平滑」后，圆角半径 = 图片短边 × 平滑度百分比，每张图按自身尺寸自动适配，也可用滑杆手动微调（1%–20%）。
- **单张保存**：点击「保存当前图片」导出当前预览的这张图（全分辨率）。手机上会调起系统分享面板，可直接存入相册；电脑上直接下载。
- **批量导出**：按导入顺序导出全部图片，支持逐张下载、保存到设备文件夹（部分浏览器）、系统分享、打包 ZIP 四种方式。
- **纯本地处理**：所有依赖库已本地化，图片不会上传到任何服务器。

### 在手机上使用

1. 电脑上在本目录运行本地服务器（推荐，自带禁用缓存，手机刷新即见最新版）：
   ```bash
   python3 serve.py
   ```
2. 手机连到同一个 Wi-Fi，浏览器打开 `http://电脑IP:8000/edit/`（电脑 IP 可用 `ipconfig getifaddr en0` 查看）。
3. 想要完整体验（添加到主屏幕、离线使用）：把仓库部署到任意 HTTPS 静态托管（如 GitHub Pages），然后用手机打开网站 → Safari「添加到主屏幕」/ Chrome「安装应用」。添加后断网也能用。

> 注意：浏览器安全策略限制，纯 HTTP 的局域网 IP 地址下 Service Worker 不会启用（不影响正常使用，只是不能离线）；HTTPS 或 localhost 下完全正常。

### 常见问题

- **HEIC 图片**：iPhone 拍摄的 HEIC 照片在 Safari（iPhone/iPad/Mac）上可以直接导入，其他浏览器不支持直接解码 HEIC；ZIP 包内的 HEIC 同样支持（Safari）。
- **水印数据**：保存在浏览器本地存储中，Safari 有七天自动清除限制，添加到主屏幕后可避免。