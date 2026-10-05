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
    return getColorInput().value
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

// 自动平滑度：圆角半径随长宽比收敛。越接近方形越圆润（8%），越细长越平直（最低 4%），
// 避免细长截图被切得像胶囊。预览与导出走同一公式，所见即所得。
function autoCornerRadius(canvas) {
    var shortSide = Math.min(canvas.width, canvas.height)
    var longSide = Math.max(canvas.width, canvas.height)
    var ratio = longSide / shortSide
    var percent = 8 - 4 * Math.min(1, Math.max(0, (ratio - 1) / 1.5))
    return Math.round(shortSide * percent / 100)
}

// 给画布加描边和圆角：外扩式，画布四周各加一圈描边宽度，图片本身不遮挡像素
function applyOutline(canvas) {
    var borderSize = Math.round(Math.min(canvas.width, canvas.height) * getStrokePct() / 100)
    var cornerRadius = isRoundCorners() ? autoCornerRadius(canvas) : 0
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

async function saveCurrentImage() {
    if (!outlineImages.length || isExporting) {
        return
    }
    var saveButton = document.getElementById('photostack-outline-save-btn')
    var saveButtonText = document.getElementById('photostack-outline-save-btn-text')
    var bbSaveButton = document.getElementById('photostack-outline-bb-save-btn')
    saveButton.disabled = true
    bbSaveButton.disabled = true
    var originalText = saveButtonText.innerText
    saveButtonText.innerText = '正在处理…'
    try {
        var item = outlineImages[currentIndex]
        var canvas = await renderFullCanvas(item)
        var blob = await new Promise(function (resolve) {
            canvas.toBlob(resolve, 'image/png')
        })
        if (!blob) {
            errorToast.show()
            return
        }
        var file = new File([blob], item.name + '.png', {
            lastModified: Date.now(),
            type: 'image/png'
        })
        // 手机上优先调起系统分享（iOS 可直接存入相册），失败则降级为下载保存
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file] }).catch(function (e) {
                if (e && e.name !== 'AbortError') {
                    console.error('Share failed, falling back to download:', e)
                    saveAs(file)
                }
            })
        } else {
            saveAs(file)
        }
    } catch (error) {
        console.error('Save current image error:', error)
        errorToast.show()
    } finally {
        saveButtonText.innerText = originalText
        updateWorkspaceUI()
    }
}

// ── 批量导出 ZIP（严格串行：渲染一张打包一张，内存峰值恒定） ──

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
    var total = outlineImages.length
    var zip = new JSZip()
    var failed = 0
    var progressBar = document.getElementById('photostack-outline-export-progress-bar')
    var progressText = document.getElementById('photostack-outline-export-progress-text')
    try {
        for (var i = 0; i < total; i++) {
            var item = outlineImages[i]
            progressText.innerText = '正在处理 ' + (i + 1) + ' / ' + total + ' · ' + item.name
            try {
                var canvas = await renderFullCanvas(item)
                var blob = await new Promise(function (resolve) {
                    canvas.toBlob(resolve, 'image/png')
                })
                if (blob) {
                    // 文件名带序号前缀，保证解压后的排列顺序与导入顺序一致
                    var num = String(i + 1).padStart(3, '0')
                    zip.file(num + '-' + item.name + '.png', blob)
                } else {
                    failed++
                }
                // 尽早释放全尺寸画布
                canvas.width = 0
                canvas.height = 0
            } catch (error) {
                console.error('Export failed for ' + item.name, error)
                failed++
            }
            var percent = Math.round(((i + 1) / total) * 100)
            progressBar.setAttribute('aria-valuenow', percent)
            progressBar.setAttribute('style', 'width: ' + percent + '%')
        }
        var today = new Date()
        var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate()
        var zipData = await zip.generateAsync({ type: 'blob' })
        saveAs(zipData, '描边导出-' + date + '.zip')
        document.getElementById('photostack-outline-export-done-count').innerText = String(total - failed)
        document.getElementById('photostack-outline-export-done-failed').innerText = failed > 0 ? '（其中 ' + failed + ' 张处理失败已跳过）' : ''
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
    document.getElementById('photostack-outline-export-progress').classList.remove('d-none')
    document.getElementById('photostack-outline-export-done').classList.add('d-none')
    document.getElementById('photostack-outline-export-done-footer').classList.add('d-none')
    var progressBar = document.getElementById('photostack-outline-export-progress-bar')
    progressBar.setAttribute('aria-valuenow', '0')
    progressBar.setAttribute('style', 'width: 0%')
    document.getElementById('photostack-outline-export-progress-text').innerText = ''
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
    setActiveSwatch(colorInput.value)
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
    saveOutlinePrefs()
    renderPreview()
})
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

restoreOutlinePrefs()
initFormats()
