# 播客台 v0.1

手机本地的播客播放器。音频和字幕都存在手机浏览器里，不上传任何地方。

## 文件

```
index.html   全部逻辑（单文件 1300+ 行，无外部依赖）
manifest.json  PWA 清单
sw.js         外壳缓存（改内容必须 VERSION +1）
icons/        图标
```

## 本地试用

双击 `index.html` 就能用（file:// 下 IndexedDB 可用，但 PWA 安装和 Service Worker 不生效）。

## 部署

```
git init
git add .
git commit -m "podcast player v0.1"
git remote add origin git@github.com:<账号>/podcast.git
git push -u origin main
```

GitHub 仓库 → Settings → Pages → 选 main 分支根目录。之后手机打开
`https://<账号>.github.io/podcast/`，Chrome 菜单 →「添加到主屏幕」。

## 手机上怎么用

1. 点右上角 `＋`，从「文件」或「下载」里多选 mp3 / m4a
2. 选一个专辑，或新建一个
3. 点曲目开始播；锁屏后会显示标题和封面，耳机键可以暂停/切集

### 配合 SRT 字幕

字幕文件名必须和音频一致：

```
黑袍学院-ep01.mp3
黑袍学院-ep01.srt
```

导入音频后，点曲目右侧 `⋯` →「添加 SRT 字幕」逐条添加；
或在专辑页 `⋯` →「批量添加字幕」一次多选，按文件名自动配对。

播放时当前句高亮并自动滚动，点任意一句可以跳过去。
字幕对不齐就用 `−0.5s` / `+0.5s` 微调，偏移会按集记住。

## 数据存在哪

| 内容 | 位置 |
|---|---|
| 音频、SRT 原件 | IndexedDB `podcast-db` |
| 专辑、标题、进度、倍速 | localStorage `podcast.meta.v1` |

**别在浏览器设置里「清除网站数据」**，那会把音频一起删掉。
卸载 PWA 图标一般不会删数据，但清站点数据会。

## v0.1 范围

已经能做：多专辑、导入、连播、倍速 0.75–2×、断点续播、±15 秒、字幕同步高亮、字幕偏移、锁屏控制、删除/重命名。

还没做：跨设备同步、搜索、排序切换、后台自动导入、文字稿导出。

## 已知限制

- 音频只在本机：换手机、换浏览器要重新导入
- 30 集 × 30 分钟约 900MB，安卓 Chrome 一般够用，但低端机可能紧张
- file:// 下 localStorage 按文件路径隔离，移动文件会丢进度（部署成 https 后没这问题）
- 改 `index.html` 后必须把 `sw.js` 的 `VERSION` +1，否则手机还会读缓存里的旧版

## 版本

- v0.1.0 · 2026-11-15 · 首版
