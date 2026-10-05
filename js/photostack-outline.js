// 自动描边工具页：批量按顺序导入 → 翻页预览 → 统一描边/圆角 → 单张保存或按导入顺序批量导出 ZIP
// 渲染管线照抄 shared.js 的外扩描边算法（画布向外扩一圈描边宽度，图片一像素不被遮挡）

// ── 全局状态 ──

// 已导入图片：{ file, url（objectURL）, name（去扩展名） }，数组顺序即导出顺序
var outlineImages = []

// 当前预览的图片索引（翻页预览用）
var currentIndex = 0

// 上次滚动定位过的缩略图索引：只在切换图片时滚动缩略图条，
// 避免拖动滑杆调设置时页面被反复拽回缩略图处
var lastScrolledIndex = -1

// 预览渲染代数：拖动滑杆等高频操作时只保留最新一次渲染，避免旧结果覆盖新结果
var previewGeneration = 0

// 当前预览图的解码缓存：调设置时同一张图反复重绘，避免重复解码大图
var currentImgCache = null

var isExporting = false

const outlineImageTypes = [
    'image/jpeg', // .jpg
    'image/png', // .png
    'image/gif', // .gif
    'image/bmp', // .bmp
    'image/webp', // .webp
    'image/avif', // .avif
    'image/jxl', // .jxl
    'image/heic' // .heic
]

const outlineImageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'avif', 'jxl', 'heic']

// ── Bootstrap 组件 ──

var errorToast = new bootstrap.Toast(document.getElementById('photostack-outline-error-toast'))

var shareFallbackToast = new bootstrap.Toast(document.getElementById('photostack-outline-share-fallback-toast'))

var importToast = new bootstrap.Toast(document.getElementById('photostack-outline-import-toast'), {
    'autohide': false
})

var exportModal = new bootstrap.Modal(document.getElementById('photostack-outline-export-modal'))

var navCollapse = new bootstrap.Collapse('#navbarNav', {
    toggle: false
})

// Show errors in UI
window.onerror = function () {
    errorToast.show()
}

// Prevent unload
window.onbeforeunload = function () {
    if (outlineImages.length > 0) {
        return '确定要离开吗？已导入的图片可能会丢失。'
    }
}

// ── 设置读取 ──

function getWidthInput() {
    return document.getElementById('photostack-outline-width')
}

function getColorInput() {
    return document.getElementById('photostack-outline-color')
}

// 描边粗细：短边的百分比
function getStrokePct() {
    return parseFloat(getWidthInput().value) || 0
}

function getStrokeColor() {
    // 校验颜色合法性：取色器不可用的环境下 input 值可能为空，非法值会让 fillStyle 落到黑色
    return normalizeHexColor(getColorInput().value)
}

// 圆角是否开启（平滑模式）
function isRoundCorners() {
    var active = document.querySelector('#photostack-outline-corner-group button.active')
    return active ? active.dataset.corner === 'round' : false
}

// 导出最长边限制：0 表示不限
function getMaxEdge() {
    var active = document.querySelector('#photostack-outline-maxedge-group button.active')
    return active ? (parseInt(active.dataset.maxedge) || 0) : 0
}

// ── 渲染核心 ──

// 导出文件名：清理文件系统非法字符（ZIP 条目里的 / 会被当成文件夹，解压后数量看起来不对）
function safeExportName(name) {
    return String(name || '图片').replace(/[\\/:*?"<>|]/g, '_')
}

// 自动平滑度：圆角半径随长宽比收敛。越接近方形越圆润（8%），越细长越平直（最低 4%），
// 避免细长截图被切得像胶囊。预览与导出走同一公式，所见即所得。
function autoCornerRadius(canvas) {
    var shortSide = Math.min(canvas.width, canvas.height)
    var longSide = Math.max(canvas.width, canvas.height)
    var ratio = longSide / shortSide
    var percent = 8 - 4 * Math.min(1, Math.max(0, (ratio - 1) / 1.5))
    return Math.round(shortSide * percent / 100)
}

// 圆角平滑度：0 表示自动（按长宽比 4–8%），1–20 为手动百分比（按短边比例）
function getSmoothnessPct() {
    var slider = document.getElementById('photostack-outline-smoothness')
    var value = parseInt(slider.value) || 0
    return Math.min(20, Math.max(0, value))
}

// 最终圆角半径：手动值优先，0 走自动公式。调大手动手径可以盖住原图自带的圆角黑边
function getCornerRadius(canvas) {
    var manual = getSmoothnessPct()
    if (manual > 0) {
        return Math.round(Math.min(canvas.width, canvas.height) * manual / 100)
    }
    return autoCornerRadius(canvas)
}

// 给画布加描边和圆角：外扩式，画布四周各加一圈描边宽度，图片本身不遮挡像素
function applyOutline(canvas) {
    var borderSize = Math.round(Math.min(canvas.width, canvas.height) * getStrokePct() / 100)
    var cornerRadius = isRoundCorners() ? getCornerRadius(canvas) : 0
    if ((borderSize <= 0) && (cornerRadius <= 0)) {
        return canvas
    }
    var paddedCanvas = document.createElement('canvas')
    paddedCanvas.width = canvas.width + (borderSize * 2)
    paddedCanvas.height = canvas.height + (borderSize * 2)
    var paddedContext = paddedCanvas.getContext('2d')
    // 先填充描边底色；开启圆角时外圈半径 = 图片圆角 + 描边宽度，让描边贴合曲线
    paddedContext.fillStyle = getStrokeColor()
    var outerRadius = (cornerRadius > 0) ? (cornerRadius + borderSize) : 0
    roundedRectPath(paddedContext, 0, 0, paddedCanvas.width, paddedCanvas.height, outerRadius)
    paddedContext.fill()
    // 再把图片以圆角裁剪的方式绘制到中间
    paddedContext.save()
    roundedRectPath(paddedContext, borderSize, borderSize, canvas.width, canvas.height, cornerRadius)
    paddedContext.clip()
    paddedContext.drawImage(canvas, borderSize, borderSize)
    paddedContext.restore()
    return paddedCanvas
}

// 导出前可选地把最长边限制到设定值（用 pica 高质量缩放）
async function maybeCapLongEdge(canvas) {
    var maxEdge = getMaxEdge()
    var longEdge = Math.max(canvas.width, canvas.height)
    if (!maxEdge || (longEdge <= maxEdge)) {
        return canvas
    }
    var scale = maxEdge / longEdge
    var width = Math.max(1, Math.round(canvas.width * scale))
    var height = Math.max(1, Math.round(canvas.height * scale))
    return await resizeCanvas(canvas, width, height)
}

// ── 图片解码 ──

function decodeImage(url) {
    return new Promise(function (resolve, reject) {
        var img = new Image()
        img.onload = function () {
            resolve(img)
        }
        img.onerror = function () {
            reject(new Error('图片解码失败'))
        }
        img.src = url
    })
}

// 导入时快速验证文件能否被当前浏览器解码（例如安卓浏览器不支持 HEIC）
function canDecode(url) {
    return decodeImage(url).then(function () {
        return true
    }).catch(function () {
        return false
    })
}

// 带缓存的解码：只缓存当前预览的这一张
async function ensureDecoded(item) {
    if (currentImgCache && (currentImgCache.item === item)) {
        return currentImgCache.img
    }
    var img = await decodeImage(item.url)
    currentImgCache = { item: item, img: img }
    return img
}

// 渲染某张图的完整导出画布：原图 → 可选限边 → 描边圆角
async function renderFullCanvas(item) {
    var img = await decodeImage(item.url)
    var canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d').drawImage(img, 0, 0)
    // 超出画布安全面积的图先降采样，避免 iOS 上静默导出空白图
    canvas = await capCanvasPixels(canvas)
    canvas = await maybeCapLongEdge(canvas)
    return applyOutline(canvas)
}

// ── 预览渲染 ──

async function renderPreview() {
    var generation = ++previewGeneration
    if (!outlineImages.length) {
        return
    }
    // 索引越界保护（删除或清空后）
    if (currentIndex >= outlineImages.length) {
        currentIndex = outlineImages.length - 1
    }
    if (currentIndex < 0) {
        currentIndex = 0
    }
    updateWorkspaceUI()
    var item = outlineImages[currentIndex]
    var img
    try {
        img = await ensureDecoded(item)
    } catch (error) {
        console.error('Preview decode error:', error)
        errorToast.show()
        return
    }
    if (generation !== previewGeneration) {
        return
    }
    // 预览降采样：长边不超过 1100px，手机上拖动滑杆才流畅
    var longEdge = Math.max(img.naturalWidth, img.naturalHeight)
    var scale = longEdge > 1100 ? (1100 / longEdge) : 1
    var base = document.createElement('canvas')
    base.width = Math.max(1, Math.round(img.naturalWidth * scale))
    base.height = Math.max(1, Math.round(img.naturalHeight * scale))
    base.getContext('2d').drawImage(img, 0, 0, base.width, base.height)
    var out = applyOutline(base)
    if (generation !== previewGeneration) {
        return
    }
    var previewCanvas = document.getElementById('photostack-outline-preview')
    previewCanvas.width = out.width
    previewCanvas.height = out.height
    previewCanvas.getContext('2d').drawImage(out, 0, 0)
    // 预览稳定后后台预生成全尺寸导出文件，保存时即可同步调起分享面板
    scheduleSaveFile()
}

// 滑杆等高频操作：120ms 节流刷新预览，配合渲染代数防止旧图覆盖新图
var previewTimer = null
function schedulePreview() {
    if (previewTimer) {
        return
    }
    previewTimer = setTimeout(function () {
        previewTimer = null
        renderPreview()
    }, 120)
}

// ── 保存文件后台预生成（手机存相册的关键） ──
// iOS Safari 要求 navigator.share 必须在用户手势仍然有效的时机同步调用，
// 点击后再等全尺寸渲染 + PNG 编码（1 秒以上）手势就失效了，分享面板弹不出来。
// 因此预览稳定后在后台预生成当前图的全尺寸导出文件，点击保存时直接分享缓存文件。

var saveFileCache = null // { key, file }
var saveFileGeneration = 0

// 缓存键：同一张图 + 同一套描边参数才可复用
function saveFileKey(item) {
    return [
        item.url,
        getStrokePct(),
        getStrokeColor(),
        isRoundCorners() ? 'round' : 'square',
        getSmoothnessPct(),
        getMaxEdge()
    ].join('|')
}

// 预览渲染完成后延迟触发；翻页、改设置都会重新走到这里，旧的生成直接作废
function scheduleSaveFile() {
    var generation = ++saveFileGeneration
    setTimeout(async function () {
        if (generation !== saveFileGeneration || isExporting) {
            return
        }
        var item = outlineImages[currentIndex]
        if (!item || (saveFileCache && (saveFileCache.key === saveFileKey(item)))) {
            return
        }
        try {
            var canvas = await renderFullCanvas(item)
            var blob = await new Promise(function (resolve) {
                canvas.toBlob(resolve, 'image/png')
            })
            // 尽早释放全尺寸画布
            canvas.width = 0
            canvas.height = 0
            if (generation !== saveFileGeneration) {
                return
            }
            if (blob) {
                saveFileCache = {
                    key: saveFileKey(item),
                    file: new File([blob], item.name + '.png', {
                        lastModified: Date.now(),
                        type: 'image/png'
                    })
                }
            }
        } catch (error) {
            console.error('Pre-generate save file error:', error)
        }
    }, 350)
}

function getCachedSaveFile(item) {
    if (saveFileCache && (saveFileCache.key === saveFileKey(item))) {
        return saveFileCache.file
    }
    return null
}

// ── 界面状态同步 ──

function updateEmptyState() {
    var none = outlineImages.length === 0
    document.getElementById('photostack-outline-empty').classList.toggle('d-none', !none)
    document.getElementById('photostack-outline-workspace').classList.toggle('d-none', none)
}

function setActionButtonsDisabled(disabled) {
    ;[
        'photostack-outline-save-btn',
        'photostack-outline-export-btn',
        'photostack-outline-append-btn',
        'photostack-outline-clear-btn',
        'photostack-outline-bb-save-btn',
        'photostack-outline-bb-export-btn'
    ].forEach(function (id) {
        document.getElementById(id).disabled = disabled
    })
}

function updateWorkspaceUI() {
    var count = outlineImages.length
    if (count > 0) {
        document.getElementById('photostack-outline-counter').innerText = '第 ' + (currentIndex + 1) + ' / ' + count + ' 张'
        document.getElementById('photostack-outline-filename').innerText = outlineImages[currentIndex].name
    } else {
        document.getElementById('photostack-outline-counter').innerText = '第 1 / 1 张'
        document.getElementById('photostack-outline-filename').innerText = ''
    }
    setActionButtonsDisabled(count === 0 || isExporting)
    // 同步缩略图选中态；仅切换图片时滚动定位，避免调设置时页面跳动
    var thumbs = document.querySelectorAll('#photostack-outline-thumbs .photostack-thumb')
    thumbs.forEach(function (el, i) {
        el.classList.toggle('active', i === currentIndex)
    })
    if (currentIndex !== lastScrolledIndex) {
        var activeThumb = document.querySelector('#photostack-outline-thumbs .photostack-thumb.active')
        if (activeThumb && activeThumb.scrollIntoView) {
            activeThumb.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
        }
        lastScrolledIndex = currentIndex
    }
}

// ── 缩略图条 ──

function rebuildThumbs() {
    var row = document.getElementById('photostack-outline-thumbs')
    row.innerHTML = ''
    lastScrolledIndex = -1
    outlineImages.forEach(function (item, i) {
        var btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'photostack-thumb' + (i === currentIndex ? ' active' : '')
        btn.setAttribute('title', item.name)
        var img = document.createElement('img')
        img.src = item.url
        img.alt = item.name
        btn.appendChild(img)
        var num = document.createElement('span')
        num.className = 'photostack-thumb-num'
        num.innerText = String(i + 1)
        btn.appendChild(num)
        if (outlineImages.length > 1) {
            var del = document.createElement('span')
            del.className = 'photostack-thumb-del'
            del.innerHTML = '&times;'
            del.setAttribute('title', '删除这张')
            del.addEventListener('click', function (e) {
                e.stopPropagation()
                removeImage(i)
            })
            btn.appendChild(del)
        }
        btn.addEventListener('click', function () {
            currentIndex = i
            renderPreview()
        })
        row.appendChild(btn)
    })
}

// ── 导入 ──

function isImageFile(file) {
    if (outlineImageTypes.includes(file.type)) {
        return true
    }
    // 部分浏览器的 HEIC 文件 type 可能为空，按扩展名兜底
    var ext = (file.name.split('.').pop() || '').toLowerCase()
    return outlineImageExtensions.includes(ext)
}

async function importFiles(fileList, source) {
    var files = Array.from(fileList).filter(isImageFile)
    if (!files.length) {
        alert('没有找到可以导入的图片文件。')
        return
    }
    importToast.show()
    var wasEmpty = outlineImages.length === 0
    var added = 0
    var skipped = 0
    for (const file of files) {
        var item = {
            file: file,
            url: URL.createObjectURL(file),
            name: file.name.replace(/\.[^/.]+$/, '')
        }
        var decodable = await canDecode(item.url)
        if (!decodable) {
            URL.revokeObjectURL(item.url)
            skipped++
            console.warn('无法解码，已跳过：' + file.name)
            continue
        }
        outlineImages.push(item)
        added++
    }
    if (added > 0) {
        if (wasEmpty) {
            currentIndex = 0
        }
        if (currentIndex >= outlineImages.length) {
            currentIndex = outlineImages.length - 1
        }
        currentImgCache = null
        rebuildThumbs()
        updateEmptyState()
        renderPreview()
    }
    if (skipped > 0) {
        alert('有 ' + skipped + ' 个文件无法在此浏览器中解码（例如安卓浏览器不支持 HEIC），已跳过。')
    }
    setTimeout(function () {
        importToast.hide()
    }, 800)
    // 重置 file input，方便下次重复选择同一批文件
    document.getElementById('photostack-outline-import-file').value = ''
    navCollapse.hide()
}

// 删除单个图片（缩略图上的 × 按钮）
function removeImage(index) {
    var item = outlineImages[index]
    if (!item) {
        return
    }
    if (!confirm('删除第 ' + (index + 1) + ' 张「' + item.name + '」吗？')) {
        return
    }
    URL.revokeObjectURL(item.url)
    outlineImages.splice(index, 1)
    currentImgCache = null
    if (currentIndex >= outlineImages.length) {
        currentIndex = Math.max(0, outlineImages.length - 1)
    }
    rebuildThumbs()
    updateEmptyState()
    if (outlineImages.length) {
        renderPreview()
    } else {
        resetPreviewCanvas()
        updateWorkspaceUI()
    }
}

// 清空全部图片
function clearAllImages() {
    if (!outlineImages.length) {
        return
    }
    if (!confirm('确定要清空所有已导入的图片吗？')) {
        return
    }
    outlineImages.forEach(function (item) {
        URL.revokeObjectURL(item.url)
    })
    outlineImages = []
    currentImgCache = null
    currentIndex = 0
    rebuildThumbs()
    updateEmptyState()
    resetPreviewCanvas()
    updateWorkspaceUI()
}

function resetPreviewCanvas() {
    var previewCanvas = document.getElementById('photostack-outline-preview')
    previewCanvas.width = 1
    previewCanvas.height = 1
}

// ── 翻页 ──

function goToPrevImage() {
    if (isExporting) {
        return
    }
    if (currentIndex > 0) {
        currentIndex--
        renderPreview()
    }
}

function goToNextImage() {
    if (isExporting) {
        return
    }
    if (currentIndex < (outlineImages.length - 1)) {
        currentIndex++
        renderPreview()
    }
}

// ── 单张保存当前预览图（全分辨率） ──

// 手机上调起系统分享面板（iOS 选「存储图像」即保存到相册），不支持分享的环境降级为下载
function shareOrDownload(file) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file] }).catch(function (e) {
            if (e && e.name === 'AbortError') {
                return // 用户在分享面板点了取消
            }
            console.error('Share failed, falling back to download:', e)
            saveAs(file)
            shareFallbackToast.show()
        })
    } else {
        saveAs(file)
    }
}

async function saveCurrentImage() {
    if (!outlineImages.length || isExporting) {
        return
    }
    var item = outlineImages[currentIndex]
    // 缓存命中：直接在手势内同步分享，分享面板必然弹出
    var file = getCachedSaveFile(item)
    if (file) {
        shareOrDownload(file)
        return
    }
    // 缓存未命中（刚导入或翻页就立刻点）：实时生成后再尝试分享
    var saveButton = document.getElementById('photostack-outline-save-btn')
    var saveButtonText = document.getElementById('photostack-outline-save-btn-text')
    var bbSaveButton = document.getElementById('photostack-outline-bb-save-btn')
    saveButton.disabled = true
    bbSaveButton.disabled = true
    var originalText = saveButtonText.innerText
    saveButtonText.innerText = '正在处理…'
    try {
        var canvas = await renderFullCanvas(item)
        var blob = await new Promise(function (resolve) {
            canvas.toBlob(resolve, 'image/png')
        })
        if (!blob) {
            errorToast.show()
            return
        }
        file = new File([blob], item.name + '.png', {
            lastModified: Date.now(),
            type: 'image/png'
        })
        // 顺便写入缓存，下次点击即可同步分享
        saveFileCache = { key: saveFileKey(item), file: file }
        shareOrDownload(file)
    } catch (error) {
        console.error('Save current image error:', error)
        errorToast.show()
    } finally {
        saveButtonText.innerText = originalText
        updateWorkspaceUI()
    }
}

// ── 批量导出 ZIP（严格串行：渲染一张打包一张，内存峰值恒定） ──

// ── 批量导出（按设备分流） ──
// 手机（支持文件分享）：主流程直接进相册——不打包 ZIP，按批生成、逐批点按存入；
// 电脑：渲染全部并打包 ZIP 下载。

// 渲染全部图片并打包为 ZIP；onProgress(i, total) 用于在进度条或按钮上显示进度
async function renderAllToZip(onProgress) {
    var zip = new JSZip()
    var failed = 0
    var countWhenStarted = outlineImages.length
    for (var i = 0; i < countWhenStarted; i++) {
        if (outlineImages.length !== countWhenStarted) {
            break // 导入列表被改动（弹窗关闭后清空等），终止
        }
        if (onProgress) {
            onProgress(i, countWhenStarted)
        }
        try {
            var canvas = await renderFullCanvas(outlineImages[i])
            var blob = await new Promise(function (resolve) {
                canvas.toBlob(resolve, 'image/png')
            })
            // 尽早释放全尺寸画布
            canvas.width = 0
            canvas.height = 0
            if (blob) {
                // 文件名带序号前缀，保证解压后的排列顺序与导入顺序一致
                var num = String(i + 1).padStart(3, '0')
                zip.file(num + '-' + safeExportName(outlineImages[i].name) + '.png', blob)
            } else {
                failed++
            }
        } catch (error) {
            console.error('Export failed for ' + outlineImages[i].name, error)
            failed++
        }
    }
    var today = new Date()
    var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate()
    return { zip: zip, failed: failed, fileName: '描边导出-' + date + '.zip' }
}

async function exportAllImages() {
    if (!outlineImages.length || isExporting) {
        return
    }
    isExporting = true
    updateWorkspaceUI()
    // 切到进度界面
    document.getElementById('photostack-outline-export-progress').classList.remove('d-none')
    document.getElementById('photostack-outline-export-done').classList.add('d-none')
    document.getElementById('photostack-outline-export-done-footer').classList.add('d-none')
    exportModal.show()
    var progressBar = document.getElementById('photostack-outline-export-progress-bar')
    var progressText = document.getElementById('photostack-outline-export-progress-text')
    try {
        if (albumSupported()) {
            // 手机：直接进相册。不打包 ZIP，第一批在后台生成好即交给用户逐批分享
            albumJob = { total: outlineImages.length, next: 0, saved: 0, skipped: 0, batchNo: 1, chunk: [], phase: 'idle', mode: 'share' }
            document.getElementById('photostack-outline-album-btn').classList.remove('d-none')
            document.getElementById('photostack-outline-zip-btn').classList.remove('d-none')
            progressText.innerText = '正在生成第 1 批图片…'
            await renderAlbumChunk()
            if (!albumJob) {
                return // 弹窗被关闭
            }
            var albumFailedText = albumJob.skipped > 0 ? '，<span class="text-danger">' + albumJob.skipped + ' 张处理失败已跳过</span>' : ''
            document.getElementById('photostack-outline-export-done-text').innerHTML =
                '已按导入顺序生成 <strong>' + albumJob.total + '</strong> 张图片，点按下方按钮分批存入相册（分享面板选「存储图像」）' + albumFailedText + '。'
        } else {
            // 电脑：打包 ZIP 下载
            var result = await renderAllToZip(function (i, total) {
                progressText.innerText = '正在处理 ' + (i + 1) + ' / ' + total + ' · ' + outlineImages[i].name
                var percent = Math.round(((i + 1) / total) * 100)
                progressBar.setAttribute('aria-valuenow', percent)
                progressBar.setAttribute('style', 'width: ' + percent + '%')
            })
            var zipData = await result.zip.generateAsync({ type: 'blob' })
            saveAs(zipData, result.fileName)
            var zipFailedText = result.failed > 0 ? '，<span class="text-danger">' + result.failed + ' 张处理失败已跳过</span>' : ''
            document.getElementById('photostack-outline-export-done-text').innerHTML =
                '已按导入顺序打包 <strong>' + (outlineImages.length - result.failed) + '</strong> 张图片，ZIP 文件正在保存' + zipFailedText + '。'
            // 电脑上的补充选项：逐张下载
            var albumButton = document.getElementById('photostack-outline-album-btn')
            albumButton.classList.remove('d-none')
            albumButton.innerText = '批量导出图片（逐张下载）'
        }
        document.getElementById('photostack-outline-export-progress').classList.add('d-none')
        document.getElementById('photostack-outline-export-done').classList.remove('d-none')
        document.getElementById('photostack-outline-export-done-footer').classList.remove('d-none')
    } catch (error) {
        console.error('Export error:', error)
        errorToast.show()
        exportModal.hide()
    } finally {
        isExporting = false
        updateWorkspaceUI()
    }
}

// 关闭导出弹窗时重置进度界面
document.getElementById('photostack-outline-export-modal').addEventListener('hidden.bs.modal', function () {
    albumJob = null
    albumDownloading = false
    var albumButton = document.getElementById('photostack-outline-album-btn')
    albumButton.classList.add('d-none')
    albumButton.disabled = false
    albumButton.innerText = '批量导出图片'
    var zipButton = document.getElementById('photostack-outline-zip-btn')
    zipButton.classList.add('d-none')
    zipButton.disabled = false
    zipButton.innerText = '保存为 ZIP'
    document.getElementById('photostack-outline-export-progress').classList.remove('d-none')
    document.getElementById('photostack-outline-export-done').classList.add('d-none')
    document.getElementById('photostack-outline-export-done-footer').classList.add('d-none')
    var progressBar = document.getElementById('photostack-outline-export-progress-bar')
    progressBar.setAttribute('aria-valuenow', '0')
    progressBar.setAttribute('style', 'width: 0%')
    document.getElementById('photostack-outline-export-progress-text').innerText = ''
})

// ── 批量导出图片（导出完成弹窗里） ──
// 手机：ZIP 解压后无法直接进相册；iOS 分享面板选「存储图像」可整批入相册，
// 但 navigator.share 每次都要用户手势、单次载荷太大也会失败，
// 所以按「每批最多 6 张 / 60MB」分批：后台生成一批 → 用户点一下分享一批。
// 电脑：逐张串行下载（连续触发 saveAs 会被浏览器拦截），按钮上显示进度与最终张数。

var albumJob = null // { total, next, saved, skipped, batchNo, chunk, phase, mode }
var albumDownloading = false

// 仅在支持文件分享的移动设备上走分享分支，其余设备逐张下载
function albumSupported() {
    return canShareFiles()
}

function updateAlbumButton() {
    var btn = document.getElementById('photostack-outline-album-btn')
    if (!btn || !albumJob) {
        return
    }
    btn.disabled = (albumJob.phase === 'rendering') || (albumJob.phase === 'done')
    if (albumJob.mode === 'download') {
        return // 逐张下载分支的文案由 downloadAllImages 自己维护
    }
    if (albumJob.phase === 'rendering') {
        btn.innerText = albumJob.saved === 0 ? '正在生成图片…' : '正在生成下一批…'
    } else if (albumJob.phase === 'ready') {
        btn.innerText = '存入相册：第 ' + albumJob.batchNo + ' 批（' + albumJob.chunk.length + ' 张）'
    } else if (albumJob.phase === 'done') {
        var skipped = albumJob.skipped > 0 ? '，' + albumJob.skipped + ' 张处理失败已跳过' : ''
        btn.innerText = '已存入相册 ' + albumJob.saved + ' 张' + skipped + ' ✓'
    }
}

// 渲染下一批导出文件（随时可被弹窗关闭中断）
async function renderAlbumChunk() {
    var MAX_FILES = 6
    var MAX_BYTES = 60 * 1024 * 1024
    var chunk = []
    var bytes = 0
    while (albumJob && (albumJob.next < albumJob.total) && (chunk.length < MAX_FILES) && ((chunk.length === 0) || (bytes < MAX_BYTES))) {
        var item = outlineImages[albumJob.next]
        try {
            var canvas = await renderFullCanvas(item)
            var blob = await new Promise(function (resolve) {
                canvas.toBlob(resolve, 'image/png')
            })
            canvas.width = 0
            canvas.height = 0
            if (!albumJob) {
                return
            }
            if (blob) {
                // 文件名带序号前缀，与 ZIP 导出一致，便于识别顺序
                var num = String(albumJob.next + 1).padStart(3, '0')
                chunk.push(new File([blob], num + '-' + safeExportName(item.name) + '.png', {
                    lastModified: Date.now(),
                    type: 'image/png'
                }))
                bytes += blob.size
            } else {
                albumJob.skipped++
            }
        } catch (error) {
            console.error('Album render failed for ' + item.name, error)
            if (!albumJob) {
                return
            }
            albumJob.skipped++
        }
        albumJob.next++
    }
    if (!albumJob) {
        return
    }
    albumJob.chunk = chunk
    albumJob.phase = chunk.length ? 'ready' : 'done'
    updateAlbumButton()
}

// 电脑端批量导出：逐张渲染并串行下载，按钮上实时显示进度与最终张数
async function downloadAllImages() {
    if (albumDownloading || !albumJob) {
        return
    }
    albumDownloading = true
    var job = albumJob
    var btn = document.getElementById('photostack-outline-album-btn')
    btn.disabled = true
    var total = outlineImages.length
    var failed = 0
    for (var i = 0; i < total; i++) {
        if (albumJob !== job) {
            albumDownloading = false
            return // 弹窗已关闭，终止下载
        }
        btn.innerText = '正在导出 ' + (i + 1) + ' / ' + total + '…'
        var blob = null
        try {
            var canvas = await renderFullCanvas(outlineImages[i])
            blob = await new Promise(function (resolve) {
                canvas.toBlob(resolve, 'image/png')
            })
            canvas.width = 0
            canvas.height = 0
        } catch (error) {
            console.error('Album download failed for ' + outlineImages[i].name, error)
        }
        if (blob) {
            var num = String(i + 1).padStart(3, '0')
            saveAs(new File([blob], num + '-' + safeExportName(outlineImages[i].name) + '.png', {
                lastModified: Date.now(),
                type: 'image/png'
            }))
            job.saved++
        } else {
            job.skipped++
            failed++
        }
        // 间隔触发，避免浏览器把连续下载判定为骚扰行为而拦截
        await new Promise(function (resolve) {
            setTimeout(resolve, 350)
        })
    }
    if (albumJob !== job) {
        albumDownloading = false
        return
    }
    var skippedText = failed > 0 ? '，' + failed + ' 张失败' : ''
    btn.innerText = '已下载 ' + (total - failed) + ' 张' + skippedText + ' ✓'
    btn.disabled = false
    albumDownloading = false
}

async function onAlbumButtonClick() {
    if (!albumJob || (albumJob.phase === 'rendering') || albumDownloading) {
        return
    }
    // 电脑：逐张下载
    if (albumJob.mode === 'download') {
        await downloadAllImages()
        return
    }
    var btn = document.getElementById('photostack-outline-album-btn')
    if (albumJob.phase === 'idle') {
        albumJob.phase = 'rendering'
        updateAlbumButton()
        await renderAlbumChunk()
        return
    }
    if (albumJob.phase === 'ready') {
        // 分享调用同步发生在手势内；await 等用户操作完分享面板再准备下一批
        try {
            await navigator.share({ files: albumJob.chunk })
        } catch (error) {
            if (error && (error.name === 'AbortError')) {
                // 用户取消本批，保留进度可重试
                btn.innerText = '已跳过，重试第 ' + albumJob.batchNo + ' 批'
                return
            }
            console.error('Album share failed:', error)
            errorToast.show()
            btn.innerText = '重试第 ' + albumJob.batchNo + ' 批'
            return
        }
        albumJob.saved += albumJob.chunk.length
        albumJob.batchNo++
        albumJob.phase = 'rendering'
        updateAlbumButton()
        await renderAlbumChunk()
        return
    }
    // done：无需操作
}

document.getElementById('photostack-outline-album-btn').addEventListener('click', onAlbumButtonClick)

// ── 手机完成弹窗里的备选：按需打包 ZIP ──
var zipGenerating = false

document.getElementById('photostack-outline-zip-btn').addEventListener('click', async function () {
    if (zipGenerating) {
        return
    }
    zipGenerating = true
    var btn = this
    btn.disabled = true
    try {
        var result = await renderAllToZip(function (i, total) {
            btn.innerText = '正在打包 ' + (i + 1) + ' / ' + total + '…'
        })
        var zipData = await result.zip.generateAsync({ type: 'blob' })
        saveAs(zipData, result.fileName)
        btn.innerText = 'ZIP 已保存 ✓' + (result.failed > 0 ? '（' + result.failed + ' 张失败）' : '')
    } catch (error) {
        console.error('Zip export error:', error)
        errorToast.show()
        btn.innerText = '保存为 ZIP'
    }
    btn.disabled = false
    zipGenerating = false
})

// ── 设置偏好记忆 ──

function loadOutlinePrefs() {
    try {
        return JSON.parse(localStorage.getItem('photostack-outline-prefs') || '{}')
    } catch (e) {
        return {}
    }
}

function saveOutlinePrefs() {
    try {
        localStorage.setItem('photostack-outline-prefs', JSON.stringify({
            width: getStrokePct(),
            color: getStrokeColor(),
            round: isRoundCorners(),
            smoothness: getSmoothnessPct(),
            maxEdge: getMaxEdge()
        }))
    } catch (e) {
        // 存储不可用时不影响使用
    }
}

// 分段按钮组：切换选中态
function setSegmented(group, value) {
    group.querySelectorAll('button').forEach(function (btn) {
        var active = (btn.dataset.corner === value) || (btn.dataset.maxedge === value)
        btn.classList.toggle('active', active)
        btn.setAttribute('aria-pressed', active ? 'true' : 'false')
    })
}

// 常用描边颜色色板：一键切换并实时预览
function setActiveSwatch(color) {
    document.querySelectorAll('#photostack-outline-swatches .photostack-swatch').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.color.toLowerCase() === String(color).toLowerCase())
    })
}

function restoreOutlinePrefs() {
    var prefs = loadOutlinePrefs()
    var widthInput = getWidthInput()
    if (typeof prefs.width === 'number' && prefs.width >= 0 && prefs.width <= 10) {
        widthInput.value = prefs.width
    }
    document.getElementById('photostack-outline-width-value').innerText = widthInput.value + '%'
    var colorInput = getColorInput()
    if (prefs.color && /^#[0-9a-fA-F]{6}$/.test(prefs.color)) {
        colorInput.value = prefs.color
    }
    if (typeof prefs.round === 'boolean') {
        setSegmented(document.getElementById('photostack-outline-corner-group'), prefs.round ? 'round' : 'square')
    }
    if ([0, 2048, 4096].includes(prefs.maxEdge)) {
        setSegmented(document.getElementById('photostack-outline-maxedge-group'), String(prefs.maxEdge))
    }
    if (typeof prefs.smoothness === 'number' && prefs.smoothness >= 0 && prefs.smoothness <= 20) {
        document.getElementById('photostack-outline-smoothness').value = String(prefs.smoothness)
    }
    updateSmoothnessBadge()
    document.getElementById('photostack-outline-smoothness').disabled = !isRoundCorners()
    setActiveSwatch(colorInput.value)
    // change 事件同步内置色板的色块按钮显示
    colorInput.dispatchEvent(new Event('change', { bubbles: true }))
}

// ── 支持的导入格式 ──

async function initFormats() {
    var input = document.getElementById('photostack-outline-import-file')
    var supported = await checkSupportedImportFormats()
    input.setAttribute('accept', input.getAttribute('accept') + ',' + supported.mimeTypes.join(','))
    document.getElementById('photostack-outline-format-list').innerText = '支持：JPEG、PNG、GIF、BMP' + (supported.formatList.length ? '、' + supported.formatList.join('、') : '')
}

// ── 事件绑定 ──

// 导入入口：空状态按钮 / 追加按钮 / 底部栏按钮
document.getElementById('photostack-outline-import-btn').addEventListener('click', function () {
    document.getElementById('photostack-outline-import-file').click()
})
document.getElementById('photostack-outline-append-btn').addEventListener('click', function () {
    document.getElementById('photostack-outline-import-file').click()
})
document.getElementById('photostack-outline-bb-import-btn').addEventListener('click', function () {
    document.getElementById('photostack-outline-import-file').click()
})

document.getElementById('photostack-outline-import-file').addEventListener('change', function () {
    importFiles(this.files, 'Local file picker')
})

// 翻页与操作
document.getElementById('photostack-outline-save-btn').addEventListener('click', saveCurrentImage)
document.getElementById('photostack-outline-bb-save-btn').addEventListener('click', saveCurrentImage)
document.getElementById('photostack-outline-export-btn').addEventListener('click', exportAllImages)
document.getElementById('photostack-outline-bb-export-btn').addEventListener('click', exportAllImages)
document.getElementById('photostack-outline-clear-btn').addEventListener('click', clearAllImages)

// 描边粗细滑杆：实时显示百分比 + 节流刷新预览
var widthInput = getWidthInput()
widthInput.addEventListener('input', function () {
    document.getElementById('photostack-outline-width-value').innerText = this.value + '%'
    schedulePreview()
})
widthInput.addEventListener('change', saveOutlinePrefs)

// 描边颜色：色板一键切换，取色器自定义
var colorInput = getColorInput()
document.getElementById('photostack-outline-swatches').addEventListener('click', function (e) {
    var btn = e.target.closest('.photostack-swatch')
    if (!btn) {
        return
    }
    colorInput.value = btn.dataset.color
    setActiveSwatch(btn.dataset.color)
    // change 事件同步内置色板的色块按钮显示
    colorInput.dispatchEvent(new Event('change', { bubbles: true }))
    saveOutlinePrefs()
    renderPreview()
})
colorInput.addEventListener('input', function () {
    setActiveSwatch('')
    schedulePreview()
})
colorInput.addEventListener('change', saveOutlinePrefs)

// 圆角 / 导出尺寸：分段切换
document.getElementById('photostack-outline-corner-group').addEventListener('click', function (e) {
    var btn = e.target.closest('button')
    if (!btn) {
        return
    }
    setSegmented(this, btn.dataset.corner)
    outlineSmoothnessSlider.disabled = (btn.dataset.corner !== 'round')
    saveOutlinePrefs()
    renderPreview()
})

// 圆角平滑度：拖动实时预览，直角模式下置灰
var outlineSmoothnessSlider = document.getElementById('photostack-outline-smoothness')
var outlineSmoothnessBadge = document.getElementById('photostack-outline-smoothness-value')

function updateSmoothnessBadge() {
    var value = getSmoothnessPct()
    outlineSmoothnessBadge.innerText = value > 0 ? (value + '%') : '自动'
}

outlineSmoothnessSlider.addEventListener('input', function () {
    updateSmoothnessBadge()
    schedulePreview()
})
outlineSmoothnessSlider.addEventListener('change', saveOutlinePrefs)
document.getElementById('photostack-outline-maxedge-group').addEventListener('click', function (e) {
    var btn = e.target.closest('button')
    if (!btn) {
        return
    }
    setSegmented(this, btn.dataset.maxedge)
    saveOutlinePrefs()
    renderPreview()
})

// 预览图左右拖动切换图片（手机触摸滑动 + 电脑按住鼠标拖动）
var swipeStartX = 0
var swipeStartY = 0
var previewCanvas = document.getElementById('photostack-outline-preview')

function handleSwipeEnd(deltaX, deltaY) {
    // 拖动距离太小或是竖向滚动则忽略，避免误触
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY)) {
        return
    }
    if (deltaX < 0) {
        goToNextImage()
    } else {
        goToPrevImage()
    }
}

previewCanvas.addEventListener('touchstart', function (e) {
    swipeStartX = e.changedTouches[0].screenX
    swipeStartY = e.changedTouches[0].screenY
}, { passive: true })
previewCanvas.addEventListener('touchend', function (e) {
    handleSwipeEnd(
        e.changedTouches[0].screenX - swipeStartX,
        e.changedTouches[0].screenY - swipeStartY
    )
}, { passive: true })

previewCanvas.addEventListener('mousedown', function (e) {
    swipeStartX = e.clientX
    swipeStartY = e.clientY
})
previewCanvas.addEventListener('mouseup', function (e) {
    handleSwipeEnd(e.clientX - swipeStartX, e.clientY - swipeStartY)
})

// 键盘左右方向键翻页（桌面）
document.addEventListener('keydown', function (event) {
    if (document.querySelectorAll('.modal.show').length) {
        return
    }
    var activeElement = document.activeElement
    var typingInField = activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(activeElement.tagName)
    if ((event.code === 'ArrowLeft') && !typingInField) {
        event.preventDefault()
        goToPrevImage()
    } else if ((event.code === 'ArrowRight') && !typingInField) {
        event.preventDefault()
        goToNextImage()
    }
})

// 桌面拖拽导入
;['dragover', 'drop'].forEach(function (eventName) {
    document.body.addEventListener(eventName, function (e) {
        e.preventDefault()
    }, false)
})
document.body.addEventListener('drop', function (e) {
    if (isExporting) {
        return
    }
    if (e.dataTransfer && e.dataTransfer.files.length) {
        importFiles(e.dataTransfer.files, 'Drag and drop')
    }
})

// ── 初始化 ──

initColorPalette('photostack-outline-color')
restoreOutlinePrefs()
initFormats()

// 手机上导出主流程即分批存入相册，按钮文案说清楚（保留图标节点，只改文字）
if (canShareFiles()) {
    var mainExportBtn = document.getElementById('photostack-outline-export-btn')
    if (mainExportBtn && mainExportBtn.lastChild) {
        mainExportBtn.lastChild.textContent = '批量导出到相册'
    }
}
