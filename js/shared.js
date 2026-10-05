const editorMode = document.getElementsByTagName('html')[0].dataset.photostackMode

// Light and dark mode switching
// 存储访问统一走安全包装：隐私模式等禁用 localStorage 的环境不能让主题切换崩掉
function getStoredTheme() {
    try {
        return localStorage.getItem('theme')
    } catch (e) {
        return null
    }
}

function setStoredTheme(value) {
    try {
        localStorage.setItem('theme', value)
    } catch (e) {
        // 存储不可用时主题仍可即时生效，只是不能记住选择
    }
}

function applyTheme() {
    if (getStoredTheme() === 'light') {
        document.documentElement.setAttribute('data-bs-theme', 'light');
    } else if (getStoredTheme() === 'dark') {
        document.documentElement.setAttribute('data-bs-theme', 'dark');
    } else {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-bs-theme', 'dark');
        } else {
            document.documentElement.setAttribute('data-bs-theme', 'light');
        }
    }
}

// Add click events to theme switcher after the page has loaded
window.addEventListener('load', function () {
    document.querySelectorAll('.photostack-theme-btn').forEach(function (el) {
        el.addEventListener('click', function () {
            setStoredTheme(el.dataset.theme);
            applyTheme();
        })
    })
})

// Handle changes to system theme
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    applyTheme();
})

// Apply theme on initial page load
applyTheme();

// 画一个圆角矩形路径：优先使用原生 roundRect，旧浏览器回退到 arcTo
function roundedRectPath(context, x, y, width, height, radius) {
    // 限制半径不超过边长的一半，避免路径异常
    radius = Math.max(0, Math.min(radius, width / 2, height / 2))
    context.beginPath()
    if (typeof context.roundRect === 'function') {
        context.roundRect(x, y, width, height, radius)
    } else {
        context.moveTo(x + radius, y)
        context.arcTo(x + width, y, x + width, y + height, radius)
        context.arcTo(x + width, y + height, x, y + height, radius)
        context.arcTo(x, y + height, x, y, radius)
        context.arcTo(x, y, x + width, y, radius)
        context.closePath()
    }
}

// 校验并规整十六进制颜色：非法输入回退到 fallback。
// canvas fillStyle 遇到非法值会静默沿用旧颜色（初始为黑色），
// 在不支持取色器的浏览器里 input 值可能为空，必须在这里兜底，否则描边会莫名变黑。
function normalizeHexColor(value, fallback) {
    var match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(String(value || '').trim())
    if (!match) {
        return fallback || '#FFFFFF'
    }
    var hex = match[1]
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
    }
    return '#' + hex.toLowerCase()
}

// 内置色板弹层：取代系统取色器（微信内置浏览器等环境 input[type=color] 点不开）。
// input 仍保留在页面里（type=hidden），id 与取值逻辑不变；
// 色块按钮点击弹出扩展色板，选中后写回 input 并派发 input/change 事件联动预览。
var PHOTOSTACK_PALETTE_COLORS = [
    // 黑白灰
    '#FFFFFF', '#F8F9FA', '#E9ECEF', '#DEE2E6', '#ADB5BD', '#6C757D', '#495057', '#343A40', '#212529', '#000000',
    // 红橙
    '#DC3545', '#C92A2A', '#FF6B6B', '#FFA8A8', '#FD7E14', '#F76707', '#FF922B', '#FFC078',
    // 黄
    '#FFC107', '#FAB005', '#FFD43B', '#FFE066',
    // 绿
    '#198754', '#2B8A3E', '#51CF66', '#B2F2BB', '#20C997', '#0CA678',
    // 蓝青
    '#0D6EFD', '#1864AB', '#4DABF7', '#74C0FC', '#15AABF', '#0B7285',
    // 蓝紫粉
    '#6F42C1', '#5F3DC4', '#9775FA', '#D0BFFF', '#D6336C', '#A61E4D', '#F783AC', '#FFC9DE'
]

// 更新某个色板按钮上显示的当前颜色
function updateColorChip(inputId) {
    var chip = document.querySelector('.photostack-color-chip[data-color-input="' + inputId + '"]')
    if (chip) {
        chip.style.backgroundColor = normalizeHexColor(document.getElementById(inputId).value)
    }
}

function initColorPalette(inputId) {
    var input = document.getElementById(inputId)
    var chip = document.querySelector('.photostack-color-chip[data-color-input="' + inputId + '"]')
    if (!input || !chip) {
        return
    }
    updateColorChip(inputId)
    // 任何途径改了颜色（快捷色板、模板、恢复偏好）都同步色块按钮
    input.addEventListener('change', function () {
        updateColorChip(inputId)
    })

    var backdrop = document.createElement('div')
    backdrop.className = 'photostack-color-backdrop d-none'
    var panel = document.createElement('div')
    panel.className = 'photostack-color-panel d-none'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', '选择颜色')
    var grid = document.createElement('div')
    grid.className = 'photostack-color-grid'
    PHOTOSTACK_PALETTE_COLORS.forEach(function (color) {
        var cell = document.createElement('button')
        cell.type = 'button'
        cell.className = 'photostack-color-cell'
        cell.style.backgroundColor = color
        cell.setAttribute('title', color.toUpperCase())
        cell.setAttribute('aria-label', '颜色 ' + color.toUpperCase())
        cell.addEventListener('click', function () {
            input.value = color
            input.dispatchEvent(new Event('input', { bubbles: true }))
            input.dispatchEvent(new Event('change', { bubbles: true }))
            closePalette()
        })
        grid.appendChild(cell)
    })
    panel.appendChild(grid)
    document.body.appendChild(backdrop)
    document.body.appendChild(panel)

    function openPalette() {
        backdrop.classList.remove('d-none')
        panel.classList.remove('d-none')
    }
    function closePalette() {
        backdrop.classList.add('d-none')
        panel.classList.add('d-none')
    }
    chip.addEventListener('click', openPalette)
    backdrop.addEventListener('click', closePalette)
}

// JPEG 不支持透明：导出前垫一层背景色，避免圆角外侧等透明区域被编码成黑色
function flattenCanvasBackground(canvas, background) {
    var flattened = document.createElement('canvas')
    flattened.width = canvas.width
    flattened.height = canvas.height
    var context = flattened.getContext('2d')
    context.fillStyle = background || '#FFFFFF'
    context.fillRect(0, 0, flattened.width, flattened.height)
    context.drawImage(canvas, 0, 0)
    return flattened
}

// 触屏设备判断：导出方式分流用（手机上 ZIP 难以解压，默认路径必须是图片：相册或逐张下载）
function isMobileDevice() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
}

// 存相册的提示按平台自适应：iOS 分享面板是「存储图像」，安卓是选「相册 / 图库」目标
function albumSaveHint() {
    if (/Android/i.test(navigator.userAgent)) {
        return '在分享面板选择「相册 / 图库」'
    }
    return '在分享面板点「存储图像」'
}

// 是否安卓设备：安卓上下载文件夹的图片多数相册会自动显示，可提供逐张下载的备选通道
function isAndroidDevice() {
    return /Android/i.test(navigator.userAgent)
}

// 移动端判断：支持文件分享且带触摸屏（桌面 Chrome 可能声明支持 share，但场景不对）
function canShareFiles() {
    try {
        var probe = new File(['x'], 'probe.png', { type: 'image/png' })
        return !!(navigator.canShare && navigator.canShare({ files: [probe] }) && isMobileDevice())
    } catch (e) {
        return false
    }
}

// 逐张串行下载：连环触发 saveAs 会被浏览器拦截（Chrome 多下载确认、iOS Safari 只存一张），
// 每张之间稍作停顿，onProgress 用于在按钮上显示进度
async function sequentialDownload(files, onProgress) {
    for (var i = 0; i < files.length; i++) {
        if (onProgress) {
            onProgress(i, files.length)
        }
        saveAs(files[i])
        await new Promise(function (resolve) {
            setTimeout(resolve, 350)
        })
    }
}

// Apply settings to a canvas
function applyCanvasSettings(canvas, watermarkObject = null, previewMode = false) {
    return new Promise(async function (resolve) {
        // Create aspect ratio from original canvas size
        var ratio = (canvas.width / canvas.height)
        // Crop image
        var cropNeeded = false;
        if (editorMode === 'photo-editor') {
            cropNeeded = (
                (document.getElementById('photostack-crop-top').value != 0) ||
                (document.getElementById('photostack-crop-bottom').value != 0) ||
                (document.getElementById('photostack-crop-left').value != 0) ||
                (document.getElementById('photostack-crop-right').value != 0)
            )
        }
        if (cropNeeded) {
            canvas = cropCanvas(canvas, document.getElementById('photostack-crop-top').value, document.getElementById('photostack-crop-bottom').value, document.getElementById('photostack-crop-left').value, document.getElementById('photostack-crop-right').value)
            // Update ratio
            ratio = (canvas.width / canvas.height)
        }
        // Resize image
        if ((editorMode === 'photo-editor') && (document.getElementById('photostack-image-width').value != '')) {
            // Set new canvas size
            var width = parseInt(document.getElementById('photostack-image-width').value)
            if (previewMode && (width > 800)) {
                width = 800
            }
            var height = width / ratio
            // Do the resize
            canvas = await resizeCanvas(canvas, width, height)
        } else if (previewMode) {
            // Set new canvas size
            var width = 800
            var height = width / ratio
            // Do the resize
            canvas = await resizeCanvas(canvas, width, height)
        }
        // 应用描边与圆角
        if (editorMode === 'photo-editor') {
            var borderSize = parseInt(document.getElementById('photostack-border-width').value) || 0
            var roundCorners = document.getElementById('photostack-corners-round').checked
            var smoothness = parseInt(document.getElementById('photostack-corner-smoothness').value) || 0
            if ((borderSize > 0) || roundCorners) {
                // 圆角半径按图片短边的百分比计算，不同尺寸、不同宽高比的图片视觉上圆角一致
                var cornerRadius = roundCorners ? (Math.min(canvas.width, canvas.height) * (smoothness / 100)) : 0
                // 描边向外扩展：画布四周各加一圈描边宽度，图片本身不遮挡像素
                var paddedCanvas = document.createElement('canvas')
                paddedCanvas.width = canvas.width + (borderSize * 2)
                paddedCanvas.height = canvas.height + (borderSize * 2)
                var paddedContext = paddedCanvas.getContext('2d')
                // 先填充描边底色；开启圆角时外圈半径 = 图片圆角 + 描边宽度，让描边贴合曲线
                paddedContext.fillStyle = normalizeHexColor(document.getElementById('photostack-border-color').value)
                var outerRadius = (cornerRadius > 0) ? (cornerRadius + borderSize) : 0
                roundedRectPath(paddedContext, 0, 0, paddedCanvas.width, paddedCanvas.height, outerRadius)
                paddedContext.fill()
                // 再把图片以圆角裁剪的方式绘制到中间
                paddedContext.save()
                roundedRectPath(paddedContext, borderSize, borderSize, canvas.width, canvas.height, cornerRadius)
                paddedContext.clip()
                paddedContext.drawImage(canvas, borderSize, borderSize)
                paddedContext.restore()
                canvas = paddedCanvas
            }
        }
        // Apply watermark
        if (watermarkObject) {
            // Load the watermark image
            if (watermarkObject.image.length === document.getElementById('photostack-watermark-cache').src.length) {
                // If the current image has already been loaded, avoid loading it again
                var watermarkImage = document.getElementById('photostack-watermark-cache')
            } else {
                // Load the image and add it to cache
                var watermarkImage = await new Promise(function (resolve) {
                    var tempImage = document.getElementById('photostack-watermark-cache')
                    tempImage.onload = function () {
                        resolve(tempImage)
                    }
                    tempImage.src = watermarkObject.image
                })
            }
            // Create temporary canvas for the watermark
            var watermarkCanvas = document.createElement('canvas')
            watermarkCanvas.width = watermarkImage.naturalWidth
            watermarkCanvas.height = watermarkImage.naturalHeight
            // Set opacity
            var opacity = parseInt(watermarkObject.opacity) / 100
            // Draw watermark to temporary canvas
            watermarkCanvas.getContext('2d').drawImage(watermarkImage, 0, 0)
            // Calculate new size of watermark
            var resizeRatio = watermarkImage.naturalHeight / watermarkImage.naturalWidth
            var userSize = parseInt(watermarkObject.size)
            watermarkFinalWidth = canvas.width * (userSize / 100)
            watermarkFinalHeight = watermarkFinalWidth * resizeRatio
            // Do the resize
            watermarkCanvas = await resizeCanvas(watermarkImage, watermarkFinalWidth, watermarkFinalHeight, opacity)
            // Set horizontal and vertical insets
            var horizontalInset = canvas.width * (watermarkObject.horizontalInset / 100)
            var veritcalInset = canvas.height * (watermarkObject.veritcalInset / 100)
            // Set anchor position
            if (watermarkObject.anchorPosition === 1) {
                // Top-left alignment
                // Because the X and Y values start from the top-left, nothing happens here
            } else if (watermarkObject.anchorPosition === 2) {
                // Top-center alignment (Ignore: Horizontal)
                horizontalInset = (canvas.width / 2) - (watermarkCanvas.width / 2)
            } else if (watermarkObject.anchorPosition === 3) {
                // Top-right alignment
                horizontalInset = canvas.width - watermarkCanvas.width - horizontalInset
            } else if (watermarkObject.anchorPosition === 4) {
                // Middle-left alignment (Ignore: Vertical)
                veritcalInset = (canvas.height / 2) - (watermarkCanvas.height / 2)
            } else if (watermarkObject.anchorPosition === 5) {
                // Middle-center alignment (Ignore: Vertical & Horizontal)
                horizontalInset = (canvas.width / 2) - (watermarkCanvas.width / 2)
                veritcalInset = (canvas.height / 2) - (watermarkCanvas.height / 2)
            } else if (watermarkObject.anchorPosition === 6) {
                // Middle-right alignment (Ignore: Vertical)
                horizontalInset = canvas.width - watermarkCanvas.width - horizontalInset
                veritcalInset = (canvas.height / 2) - (watermarkCanvas.height / 2)
            } else if (watermarkObject.anchorPosition === 7) {
                // Bottom-left alignment
                veritcalInset = canvas.height - watermarkCanvas.height - veritcalInset
            } else if (watermarkObject.anchorPosition === 8) {
                // Bottom-center alignment (Ignore: Horizontal)
                veritcalInset = canvas.height - watermarkCanvas.height - veritcalInset
                horizontalInset = (canvas.width / 2) - (watermarkCanvas.width / 2)
            } else if (watermarkObject.anchorPosition === 9) {
                // Bottom-right alignment
                veritcalInset = canvas.height - watermarkCanvas.height - veritcalInset
                horizontalInset = canvas.width - watermarkCanvas.width - horizontalInset
            }
            // Draw completed image to temporary canvas
            canvas.getContext('2d').drawImage(watermarkCanvas, horizontalInset, veritcalInset)
        }
        resolve(canvas)
    })
}

// 画布面积安全上限：iOS Safari 等环境画布超限后 drawImage/toBlob 会静默失败（导出空白图），
// 超过上限的图先用 pica 降采样到限内，保证导出一定成功。
var MAX_CANVAS_PIXELS = 32 * 1024 * 1024

async function capCanvasPixels(canvas) {
    var pixels = canvas.width * canvas.height
    if (pixels <= MAX_CANVAS_PIXELS) {
        return canvas
    }
    var scale = Math.sqrt(MAX_CANVAS_PIXELS / pixels)
    var width = Math.max(1, Math.round(canvas.width * scale))
    var height = Math.max(1, Math.round(canvas.height * scale))
    console.warn('Canvas ' + canvas.width + 'x' + canvas.height + ' exceeds safe area, downscaling to ' + width + 'x' + height)
    return await resizeCanvas(canvas, width, height)
}

// Resize a canvas using Pica library
function resizeCanvas(oldCanvas, width, height, globalAlpha = 1.0) {    return new Promise(function (resolve, reject) {
        // Create canvas with new size
        var newCanvas = document.createElement('canvas')
        newCanvas.width = width
        newCanvas.height = height
        // Get settings
        if (editorMode === 'photo-editor') {
            var unsharpAmount = parseInt(document.getElementById('photostack-resize-unsharp-amount').value)
        } else {
            var unsharpAmount = 50
        }
        const options = {
            unsharpAmount: (unsharpAmount * 2),
            unsharpRadius: 0.5,
            unsharpThreshold: 1,
            alpha: true
        }
        // Configure Pica without Web Workers support, because it's broken in Safari and possibly other browsers
        const picaObj = pica({
            features: [ 'js', 'wasm' ]
        });
        // Do the resize
        picaObj.resize(oldCanvas, newCanvas, options).then(function () {
            // We have to create ANOTHER canvas to apply transparency
            if (globalAlpha != 1.0) {
                var tempCanvas = document.createElement('canvas')
                tempCanvas.width = newCanvas.width
                tempCanvas.height = newCanvas.height
                tempCanvas.getContext('2d').globalAlpha = globalAlpha
                tempCanvas.getContext('2d').drawImage(newCanvas, 0, 0)
                resolve(tempCanvas)
            } else {
                resolve(newCanvas)
            }
        }).catch(function (error) {
            console.error('Resize error:', error);
            reject(error);
        });
    })
}

// Function to check if the browser can import JPEG Xl, AVIF, or WebP images
async function checkSupportedImportFormats() {
    const mimeTypes = []
    const formatList = [];
    // Check JPEG XL
    await new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = 'data:image/jxl;base64,/woAEJAUNwIAE4gCALQAtZ8gAAAVKqOMG7yc6/nyQ4fFtI3rDG21bWEJY7O9MEhIOGyY4s3xwRATlSQA';
    })
        .then(function () {
            formatList.push('JPEG XL');
            mimeTypes.push('image/jxl');
        })
        .catch(function () {
            // JPEG XL is not supported
        });
    // Check AVIF
    await new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = 'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAD6AAEAAAAAAAAAGgAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgQAMAAAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAibWRhdBIACggYAAYICGg0IDIMGAAKKKKEAACwEpqY';
    })
        .then(function () {
            formatList.push('AVIF');
            mimeTypes.push('image/avif');
        })
        .catch(function () {
            // AVIF is not supported
        });
    // Check WebP
    await new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=';
    })
        .then(function () {
            formatList.push('WebP');
            mimeTypes.push('image/webp');
        })
        .catch(function () {
            // WebP is not supported
        });
    // Check HEIC
    await new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = 'data:image/heic;base64,AAAAGGZ0eXBoZWljAAAAAG1pZjFoZWljAAABaW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAADnBpdG0AAAAAAAEAAAAiaWxvYwAAAABEQAABAAEAAAAAAYkAAQAAAAAAAAAiAAAAI2lpbmYAAAAAAAEAAAAVaW5mZQIAAAAAAQAAaHZjMQAAAADpaXBycAAAAMppcGNvAAAAdmh2Y0MBA3AAAAAAAAAAAAAe8AD8/fj4AAAPAyAAAQAYQAEMAf//A3AAAAMAkAAAAwAAAwAeugJAIQABACpCAQEDcAAAAwCQAAADAAADAB6gIIEFluqumubgIaDAgAAAAwCAAAADAIQiAAEABkQBwXPBiQAAABRpc3BlAAAAAAAAAEAAAABAAAAAKGNsYXAAAAABAAAAAQAAAAEAAAAB////wQAAAAL////BAAAAAgAAABBwaXhpAAAAAAMICAgAAAAXaXBtYQAAAAAAAAABAAEEgQIEgwAAACptZGF0AAAAHigBrwUSEkzg+gO95VbllohZgK+7ZVijmVxgk1O3gA==';
    })
        .then(function () {
            formatList.push('HEIC');
            mimeTypes.push('image/heic');
        })
        .catch(function () {
            // HEIC is not supported
        });
    // Return supported formats
    const returnData = {
        'mimeTypes': mimeTypes,
        'formatList': formatList
    };
    return returnData;
}