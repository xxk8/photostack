const watermarksStore = localforage.createInstance({
    name: 'Watermarks',
    driver: [localforage.WEBSQL, localforage.INDEXEDDB]
});

const SettingsStore = localforage.createInstance({
    name: 'Settings',
    driver: [localforage.WEBSQL, localforage.INDEXEDDB]
});

const currentUrl = new URL(window.location);

const isApplePlatform = /MacIntel|iPhone|iPod|iPad/.test(navigator.platform);

const containerFileTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.openxmlformats-officedocument.wordprocessingml.template', // .dotx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.template', // .xltx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    'application/vnd.openxmlformats-officedocument.presentationml.template', // .potx
    'application/vnd.openxmlformats-officedocument.presentationml.slideshow', // .ppsx
    'application/zip', // .zip
    'application/x-zip', // .zip
    'application/x-zip-compressed' // .zip
];

const imageFileTypes = [
    'image/jpeg', // .jpg
    'image/png', // .png
    'image/gif', // .gif
    'image/bmp', // .bmp
    'image/webp', // .webp
    'image/avif', // .avif
    'image/jxl', // .jxl
    'image/heic' // .jxl
];

const dragModal = new bootstrap.Modal(document.getElementById('photostack-drag-modal'));

const errorToast = new bootstrap.Toast(document.getElementById('photostack-error-toast'));

const importToast = new bootstrap.Toast(document.getElementById('photostack-import-toast'), {
    'autohide': false
});

const navCollapse = new bootstrap.Collapse('#navbarNav', {
    toggle: false
})


var globalFilesCount = 0;

// 当前预览的图片索引（翻页预览用）
var currentPreviewIndex = 0;

// 预览渲染代数：拖动滑杆等高频操作时只保留最新一次渲染，避免旧结果覆盖新结果
var previewGeneration = 0;

// 多选模式：挑选/删除不要的图片，统一设置仍然作用于全部保留的图片
var selectionMode = false;
var selectedSet = new Set();

// Prevent unload
window.onbeforeunload = function () {
    // Warn before navigating away if there are any files imported
    if (globalFilesCount > 0) {
        return '确定要离开吗？已导入的图片可能会丢失。'
    }
}

// Show errors in UI
window.onerror = function () {
    errorToast.show()
}

/*

    MAIN EDITOR

*/

// Update interface and form elements based on supported image formats
async function updateSupportedFormats() {
    const canvas = document.createElement('canvas');
    const importForm = document.getElementById('photostack-import-file');
    const supportedImportFormats = await checkSupportedImportFormats();
    // Check WebP for exports
    if (!canvas.toDataURL('image/webp').includes('data:image/webp')) {
        document.querySelector('#photostack-file-format option[value="image/webp"]').setAttribute('disabled', true);
    }
    // Check JPEG for exports
    if (!canvas.toDataURL('image/jpeg').includes('data:image/jpeg')) {
        document.querySelector('#photostack-file-format option[value="image/jpeg"]').setAttribute('disabled', true);
    }
    // Add supported file types to file picker
    importForm.setAttribute('accept', importForm.getAttribute('accept') + ',' + supportedImportFormats.mimeTypes.join(','))
    // Display all supported file types in interface
    document.getElementById('photostack-file-format-list').innerText = '支持：JPEG、PNG、GIF、BMP、ZIP、Office 文档、' + supportedImportFormats.formatList.join('、');
    console.log('Supported file formats for import:', importForm.getAttribute('accept').split(','));
}

// Increase image count after imports
function increaseImageCount(number) {
    // Any changes here should be mirrored in clearImportedImages()
    globalFilesCount += number
    document.querySelectorAll('.photostack-image-count').forEach(function (el) {
        el.textContent = globalFilesCount.toString()
    })
    var exportBtns = document.querySelectorAll('*[data-bs-target="#photostack-export-modal"]')
    exportBtns.forEach(function (el) {
        if ((globalFilesCount > 0) && (el.disabled)) {
            el.disabled = false
        }
    })
    // 启用单张保存与排序按钮
    if (globalFilesCount > 0) {
        document.getElementById('photostack-save-current-btn').disabled = false
        document.getElementById('photostack-sort-images-btn').disabled = false
        document.getElementById('photostack-bb-save-btn').disabled = false
        document.getElementById('photostack-multi-select-btn').disabled = false
        document.getElementById('photostack-quick-export-btn').disabled = false
    }
    // 底部栏导入按钮的计数徽标：无图片时隐藏
    var bottomBarBadge = document.querySelector('#photostack-bb-import-btn .photostack-image-count')
    if (bottomBarBadge) {
        bottomBarBadge.classList.toggle('d-none', globalFilesCount === 0)
    }
}

// Function to crop a canvas
function cropCanvas(canvas, top, bottom, left, right) {
    // Create a temp canvas
    const newCanvas = document.createElement('canvas')
    // Set its dimensions
    newCanvas.width = (canvas.width - left - right)
    newCanvas.height = (canvas.height - top - bottom)
    // Draw the canvas in the new resized temp canvas 
    // Helpful diagram: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage/canvas_drawimage.jpg
    newCanvas.getContext('2d').drawImage(
        canvas, // The original image
        (0 + left), // Source X
        (0 + top), // Source Y
        (canvas.width - left - right), // Source width
        (canvas.height - bottom - top), // Source height
        0, // Destination X
        0, // Destination Y
        newCanvas.width, // Destination width
        newCanvas.height // Destination height
    )
    return newCanvas
}

// Render canvas of the currently selected image, apply settings, and show a preview
function renderPreviewCanvas() {
    var generation = ++previewGeneration
    return new Promise(async function (resolve) {
        var originalImages = document.querySelectorAll('#photostack-original-container img')
        // Silently fail if there are no images imported
        if (originalImages.length) {
            console.log('Rendering preview...')
        } else {
            console.log('Nothing to preview.')
            return
        }
        // 索引越界保护（清空或重新导入后）
        if (currentPreviewIndex >= originalImages.length) {
            currentPreviewIndex = originalImages.length - 1
        }
        if (currentPreviewIndex < 0) {
            currentPreviewIndex = 0
        }
        // 更新翻页控件
        updatePagingUI(originalImages.length)
        // Find elements
        var previewContainer = document.getElementById('photostack-editor-preview')
        var previewInfo = document.getElementById('photostack-preview-info')
        var canvasContainer = document.getElementById('photostack-canvas-container')
        // Create canvas element for the image currently being previewed
        var canvas = document.createElement('canvas')
        var originalImage = originalImages[currentPreviewIndex]
        canvas.width = originalImage.naturalWidth
        canvas.height = originalImage.naturalHeight
        // Add canvas element to canvas container
        canvasContainer.appendChild(canvas)
        canvas.getContext('2d').drawImage(originalImage, 0, 0)
        // Apply settings
        if (document.getElementById('photostack-watermark-select').value === 'no-watermark') {
            canvas = await applyCanvasSettings(canvas, null, true)
        } else {
            var watermarkName = document.getElementById('photostack-watermark-select').value
            var watermarkObject = await new Promise(function (resolve) {
                watermarksStore.getItem(watermarkName).then(function (value) {
                    resolve(value)
                }).catch(function (err) {
                    alert('Error: ' + err)
                })
            })
            canvas = await applyCanvasSettings(canvas, watermarkObject, true)
        }
        // 拖动滑杆等高频操作时，若已有更新的渲染请求，丢弃本次过期结果
        if (generation !== previewGeneration) {
            resolve()
            return
        }
        // Generate Data URL
        var previewData = canvas.toDataURL()
        // Create image element
        if (previewContainer.querySelector('img')) {
            var previewImage = previewContainer.querySelector('img')
            previewImage.onload = function () {
                resolve()
            }
            previewImage.setAttribute('src', previewData)
        } else {
            var previewImage = document.createElement('img')
            previewImage.onload = function () {
                previewInfo.classList.add('d-none')
                previewContainer.appendChild(previewImage)
                resolve()
            }
            previewImage.setAttribute('src', previewData)
        }
        // Set image in print preview
        document.getElementById('photostack-print-preview').setAttribute('src', previewData)
    })
}

// 更新翻页控件状态（计数、文件名、按钮可用性）
function updatePagingUI(imageCount) {
    var pagingControls = document.getElementById('photostack-paging-controls')
    if (!pagingControls) {
        return
    }
    if (imageCount > 0) {
        pagingControls.classList.remove('d-none')
        if (selectionMode) {
            document.getElementById('photostack-paging-counter').innerText = '已选 ' + selectedSet.size + ' / ' + imageCount + ' 张（标记要删除的图）'
        } else {
            document.getElementById('photostack-paging-counter').innerText = '第 ' + (currentPreviewIndex + 1) + ' / ' + imageCount + ' 张'
        }
        var currentImage = document.querySelectorAll('#photostack-original-container img')[currentPreviewIndex]
        document.getElementById('photostack-paging-filename').innerText = currentImage.getAttribute('data-filename') || ''
        document.getElementById('photostack-prev-image-btn').disabled = (currentPreviewIndex === 0)
        document.getElementById('photostack-next-image-btn').disabled = (currentPreviewIndex === imageCount - 1)
    } else {
        pagingControls.classList.add('d-none')
    }
}

// 上一张
function goToPrevImage() {
    if (currentPreviewIndex > 0) {
        currentPreviewIndex--
        renderPreviewCanvas().then(syncSelectionAfterNav)
    }
}

// 下一张
function goToNextImage() {
    var imageCount = document.querySelectorAll('#photostack-original-container img').length
    if (currentPreviewIndex < (imageCount - 1)) {
        currentPreviewIndex++
        renderPreviewCanvas().then(syncSelectionAfterNav)
    }
}

// 按文件名排序（导入时按选择顺序保留，此按钮用于纠正顺序）
function sortImagesByName() {
    var originalsContainer = document.getElementById('photostack-original-container')
    var images = Array.from(originalsContainer.querySelectorAll('img'))
    if (images.length < 2) {
        return
    }
    images.sort(function (a, b) {
        return (a.getAttribute('data-filename') || '').localeCompare(b.getAttribute('data-filename') || '', 'zh-Hans-CN', { numeric: true })
    })
    images.forEach(function (img) {
        originalsContainer.appendChild(img)
    })
    currentPreviewIndex = 0
    renderPreviewCanvas()
}

// 单张保存当前预览的图片（全分辨率处理）
async function saveCurrentImage() {
    var originalImages = document.querySelectorAll('#photostack-original-container img')
    if (!originalImages.length) {
        return
    }
    var saveButton = document.getElementById('photostack-save-current-btn')
    var saveButtonText = document.getElementById('photostack-save-current-btn-text')
    var bottomBarSaveButton = document.getElementById('photostack-bb-save-btn')
    saveButton.disabled = true
    bottomBarSaveButton.disabled = true
    var originalText = saveButtonText.innerText
    saveButtonText.innerText = '正在处理…'
    try {
        var originalImage = originalImages[currentPreviewIndex]
        // 读取导出设置中的格式与质量
        var imgFormat = document.getElementById('photostack-file-format').value
        var imgQuality = parseInt(document.getElementById('photostack-file-quality').value) / 100
        var canvas = document.createElement('canvas')
        canvas.width = originalImage.naturalWidth
        canvas.height = originalImage.naturalHeight
        canvas.getContext('2d').drawImage(originalImage, 0, 0)
        // 应用所有设置（不使用预览缩放）
        if (document.getElementById('photostack-watermark-select').value === 'no-watermark') {
            canvas = await applyCanvasSettings(canvas, null, false)
        } else {
            var watermarkName = document.getElementById('photostack-watermark-select').value
            var watermarkObject = await watermarksStore.getItem(watermarkName)
            canvas = await applyCanvasSettings(canvas, watermarkObject, false)
        }
        canvas.toBlob(function (blob) {
            if (!blob) {
                errorToast.show()
                return
            }
            if (imgFormat === 'image/jpeg') {
                var fileEnding = '.jpg'
            } else if (imgFormat === 'image/png') {
                var fileEnding = '.png'
            } else if (imgFormat === 'image/webp') {
                var fileEnding = '.webp'
            }
            var fileName = (originalImage.getAttribute('data-filename') || '图片') + fileEnding
            var file = new File([blob], fileName, {
                lastModified: Date.now(),
                type: imgFormat
            })
            // 手机上优先调起系统分享（iOS 可直接存入相册），否则用下载方式保存
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                navigator.share({ files: [file] }).catch(function (e) {
                    console.error(e)
                })
            } else {
                saveAs(file)
            }
        }, imgFormat, imgQuality)
    } catch (error) {
        console.error('Save current image error:', error)
        errorToast.show()
    } finally {
        saveButton.disabled = false
        bottomBarSaveButton.disabled = false
        saveButtonText.innerText = originalText
    }
}

// Convert a file to a data URL
async function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            resolve(event.target.result);
        };
        reader.onerror = (error) => {
            reject(error);
        };
        reader.readAsDataURL(file);
    });
}

// Load an image element and add it to the originals container if successful
async function processImage(imgEl, dataUrl, fileName) {
    return new Promise((resolve) => {
        imgEl.onload = function () {
            console.log('Processed image:', fileName);
            document.getElementById('photostack-original-container').appendChild(imgEl)
            increaseImageCount(1);
            resolve();
        }
        imgEl.onerror = function () {
            console.log('Could not import this image: ' + fileName);
            resolve()
        }
        // Load the image to strigger the onload() or onerror()
        imgEl.setAttribute('src', dataUrl);
    });
}

// Unified importer for local files (images and ZIPs)
async function importFiles(files, element = null) {
    const supportsWebP = document.getElementById('photostack-import-file').getAttribute('accept').includes('image/webp');
    const supportsJPEGXL = document.getElementById('photostack-import-file').getAttribute('accept').includes('image/jxl');
    const supportsAVIF = document.getElementById('photostack-import-file').getAttribute('accept').includes('image/avif');
    const supportsHEIC = document.getElementById('photostack-import-file').getAttribute('accept').includes('image/heic');
    // Show import toast, and hide drag and drop modal if needed
    dragModal.hide();
    importToast.show();
    // Process each file
    for (const file of files) {
        if (containerFileTypes.includes(file.type)) {
            // This is a container file
            const zipFile = await JSZip().loadAsync(file);
            const zippedFiles = Object.entries(zipFile.files);
            console.log('Detected container file with contents:', zippedFiles);
            for (const zippedFile of zippedFiles) {
                const zippedFileName = zippedFile[1].name.match(/([^\\/]+)$/)?.[1]; // Example: image.png
                const zippedFileExt = zippedFile[1].name.split('.').pop().toLowerCase(); // Example: png
                const imgEl = document.createElement('img');
                let dataUrl;
                // Add each compatible file to originals container
                if (zippedFile[1].dir || zippedFile[1].name.includes('__MACOSX/')) {
                    // Exit early for directories or files in a __MACOSX directory
                    continue;
                } else if (zippedFileExt === 'png') {
                    // PNG image
                    const imgData = await zippedFile[1].async('base64');
                    dataUrl = 'data:image/png;base64,' + imgData;
                    imgEl.setAttribute('data-filename', zippedFileName.replace('.png', ''));
                } else if ((zippedFileExt === 'jpg') || (zippedFileExt === 'jpeg')) {
                    // JPEG image
                    const imgData = await zippedFile[1].async('base64');
                    dataUrl = 'data:image/jpeg;base64,' + imgData;
                    imgEl.setAttribute('data-filename', zippedFileName.replace('.jpeg', '').replace('.jpeg', ''));
                } else if (zippedFileExt === 'bmp') {
                    // BMP image
                    const imgData = await zippedFile[1].async('base64');
                    dataUrl = 'data:image/bmp;base64,' + imgData;
                    imgEl.setAttribute('data-filename', zippedFileName.replace('.bmp', ''));
                } else if (supportsWebP && zippedFileExt === 'webp') {
                    // WebP image
                    const imgData = await zippedFile[1].async('base64');
                    dataUrl = 'data:image/webp;base64,' + imgData;
                    imgEl.setAttribute('data-filename', zippedFileName.replace('.webp', ''));
                } else if (supportsAVIF && (zippedFileExt === 'avif')) {
                    // AVIF file
                    const imgData = await zippedFile[1].async('base64');
                    dataUrl = 'data:image/avif;base64,' + imgData;
                    imgEl.setAttribute('data-filename', zippedFileName.replace('.avif', ''));
                } else if (supportsJPEGXL && (zippedFileExt === 'jxl')) {
                    // JPEG XL file
                    const imgData = await zippedFile[1].async('base64');
                    dataUrl = 'data:image/jxl;base64,' + imgData;
                    imgEl.setAttribute('data-filename', zippedFileName.replace('.jxl', ''));
                } else if (supportsHEIC && (zippedFileExt === 'heic')) {
                    // HEIC image
                    const imgData = await zippedFile[1].async('base64');
                    dataUrl = 'data:image/heic;base64,' + imgData;
                    imgEl.setAttribute('data-filename', zippedFileName.replace(/\.heic$/i, ''));
                } else {
                    // Unknown file type
                    continue;
                }
                // Add image to originals container
                await processImage(imgEl, dataUrl, zippedFileName);
            }
        } else if (imageFileTypes.includes(file.type)) {
            // This is an image file
            const imgEl = document.createElement('img');
            const imgFileName = file.name.replace(/\.[^/.]+$/, '');  // Example: image.png
            // Process image
            const dataUrl = await fileToDataURL(file);
            imgEl.setAttribute('data-filename', imgFileName);
            // Add image to originals container
            await processImage(imgEl, dataUrl, file.name);
        }
    }
    // Generate preview if needed
    await renderPreviewCanvas();
    // Hide import toast and reset <input> if needed
    setTimeout(function () {
        importToast.hide()
    }, 1000)
    if (element) {
        element.value = '';
    }
}

// Clear all imported images and reset preview box
function clearImportedImages() {
    // Confirm action
    if (!confirm('确定要清空所有已导入的图片吗？')) {
        return
    }
    // Remove imported images
    var originalsContainer = document.getElementById('photostack-original-container')
    while (originalsContainer.firstChild) {
        originalsContainer.removeChild(originalsContainer.firstChild)
    }
    // Remove already-exported images
    var canvasContainer = document.getElementById('photostack-canvas-container')
    while (canvasContainer.firstChild) {
        canvasContainer.removeChild(canvasContainer.firstChild)
    }
    // Reset image count
    globalFilesCount = 0
    document.querySelectorAll('.photostack-image-count').forEach(function (el) {
        el.textContent = '0'
    })
    var exportBtns = document.querySelectorAll('*[data-bs-target="#photostack-export-modal"]')
    exportBtns.forEach(function (el) {
        el.disabled = true
    })
    // 重置翻页索引并禁用单张保存与排序按钮
    currentPreviewIndex = 0
    updatePagingUI(0)
    document.getElementById('photostack-save-current-btn').disabled = true
    document.getElementById('photostack-sort-images-btn').disabled = true
    document.getElementById('photostack-bb-save-btn').disabled = true
    document.getElementById('photostack-multi-select-btn').disabled = true
    document.getElementById('photostack-quick-export-btn').disabled = true
    // 退出多选模式并清空已选
    selectionMode = false
    selectedSet.clear()
    document.getElementById('photostack-select-controls').classList.add('d-none')
    document.getElementById('photostack-multi-select-btn').classList.remove('active')
    var bottomBarBadge = document.querySelector('#photostack-bb-import-btn .photostack-image-count')
    if (bottomBarBadge) {
        bottomBarBadge.classList.add('d-none')
    }
    // Reset preview
    document.querySelector('#photostack-editor-preview img').remove()
    document.querySelector('#photostack-preview-info').classList.remove('d-none')
}

// ── 导出偏好记忆：上次用的格式/质量/命名，下次（含一键导出）直接沿用 ──
function loadExportPrefs() {
    try {
        return JSON.parse(localStorage.getItem('photostack-export-prefs') || '{}')
    } catch (e) {
        return {}
    }
}

// 记住用户在完成界面选择的保存方式，作为下次一键导出的默认方式
function rememberExportMethod(method) {
    try {
        var prefs = loadExportPrefs()
        prefs.method = method
        localStorage.setItem('photostack-export-prefs', JSON.stringify(prefs))
    } catch (e) {
        // 存储不可用时不影响导出
    }
}

function saveExportPrefs() {
    try {
        localStorage.setItem('photostack-export-prefs', JSON.stringify({
            format: document.getElementById('photostack-file-format').value,
            quality: document.getElementById('photostack-file-quality').value,
            keepName: document.getElementById('photostack-file-keep-name').checked,
            pattern: document.getElementById('photostack-file-name-pattern').value
        }))
    } catch (e) {
        // 存储不可用时不影响导出
    }
}

function restoreExportPrefs() {
    var prefs = loadExportPrefs()
    if (prefs.format) {
        document.getElementById('photostack-file-format').value = prefs.format
    }
    if (prefs.quality) {
        document.getElementById('photostack-file-quality').value = prefs.quality
    }
    if (typeof prefs.keepName === 'boolean') {
        document.getElementById('photostack-file-keep-name').checked = prefs.keepName
        document.getElementById('photostack-file-use-pattern').checked = !prefs.keepName
        document.getElementById('photostack-file-name-pattern').disabled = prefs.keepName
    }
    if (prefs.pattern) {
        document.getElementById('photostack-file-name-pattern').value = prefs.pattern
    }
}

// Async export with Promises（autoSaveMethod='zip' 时为一键导出：渲染完自动打包下载）
function asyncExport(autoSaveMethod) {
    // Start timer
    console.time('Async export')
    saveExportPrefs()
    // Set variables
    const imgFormat = document.getElementById('photostack-file-format').value
    const imgQuality = parseInt(document.getElementById('photostack-file-quality').value) / 100
    const imgUseOriginalNames = document.getElementById('photostack-file-keep-name').checked
    const imgNamePattern = document.getElementById('photostack-file-name-pattern').value || 'Image'
    const imgTotal = document.querySelectorAll('#photostack-original-container img').length
    const imgStep = Math.round(100 / imgTotal)
    const progressBar = document.getElementById('photostack-export-modal-progress')
    // Switch modal content to progress indicator
    document.querySelector('.photostack-export-modal-initial').style.display = 'none'
    document.querySelector('.photostack-export-modal-loading').style.display = 'block'
    // Start rendering canvases
    var originals = document.querySelectorAll('#photostack-original-container img')
    var canvasContainer = document.getElementById('photostack-canvas-container')
    // Clear current canvas elements
    while (canvasContainer.firstChild) {
        canvasContainer.removeChild(canvasContainer.firstChild)
    }
    // Render canvas for each original image
    var originalsArray = Array.from(originals)
    var canvasPromises = originalsArray.map(function (original) {
        return new Promise(async function (resolve) {
            // Create canvas element
            var canvas = document.createElement('canvas')
            // Add canvas element to canvas container
            canvasContainer.appendChild(canvas)
            canvas.width = original.naturalWidth
            canvas.height = original.naturalHeight
            canvas.getContext('2d').drawImage(original, 0, 0)
            // Apply settings
            if (document.getElementById('photostack-watermark-select').value === 'no-watermark') {
                // No watermark selected
                canvas = await applyCanvasSettings(canvas)
            } else {
                // Get selected watermark
                var watermarkName = document.getElementById('photostack-watermark-select').value
                var watermarkObject = await new Promise(function (resolve) {
                    watermarksStore.getItem(watermarkName).then(function (value) {
                        resolve(value)
                    })
                })
                canvas = await applyCanvasSettings(canvas, watermarkObject)
            }
            // Retain file name
            canvas.dataset.filename = original.dataset.filename
            // Update progress bar and page title
            const previousProgress = parseInt(progressBar.getAttribute('aria-valuenow'))
            const newProgress = previousProgress + imgStep
            progressBar.setAttribute('aria-valuenow', newProgress)
            progressBar.setAttribute('style', 'width: ' + newProgress + '%')
            // Return rendered canvas
            resolve(canvas)
        })
    })
    // Continue once all canvases are rendered
    Promise.all(canvasPromises).then(function (canvases) {
        // Create promises for final render of each image
        var promises = canvases.map(function (canvas) {
            return new Promise(function (resolve) {
                canvas.toBlob(function (blob) {
                    resolve([blob, canvas.getAttribute('data-filename')])
                }, imgFormat, imgQuality)
            })
        })
        // Show the final export screen when all renders are completed
        Promise.all(promises).then(function (blobs) {
            // Create final array of blobs with file names
            var files = []
            blobs.forEach(function (blob, i) {
                // Set file ending
                if (imgFormat === 'image/jpeg') {
                    var fileEnding = '.jpg'
                } else if (imgFormat === 'image/png') {
                    var fileEnding = '.png'
                } else if (imgFormat === 'image/webp') {
                    var fileEnding = '.webp'
                }
                // Set file name
                if (imgUseOriginalNames) {
                    var fileName = blob[1] + fileEnding
                } else {
                    var num = i + 1
                    var fileName = imgNamePattern + ' ' + num + fileEnding
                }
                // Add to files array
                var file = new File([blob[0]], fileName, {
                    lastModified: Date.now(),
                    type: imgFormat
                })
                files.push(file)
            })
            // Show badge on PWA icon
            if ('setAppBadge' in navigator) {
                navigator.setAppBadge()
            }
            // File System Access API
                if ('showDirectoryPicker' in window) {                // Add functionality for File System save button
                    document.getElementById('photostack-export-filesystem-api-button').addEventListener('click', async function () {
                        rememberExportMethod('dir')
                    // Ask for export directory
                    var directory = await window.showDirectoryPicker({
                        mode: 'readwrite',
                        startIn: 'pictures'
                    })
                    if (directory) {
                        // Save each file
                        console.log('Saving files in ' + directory.name + ' directory...')
                        files.forEach(async function (file) {
                            var writeableFile = await directory.getFileHandle(file.name, { create: true })
                            var writer = await writeableFile.createWritable()
                            await writer.write(file)
                            await writer.close()
                        })
                    }
                })
                // Hide legacy download method
                document.getElementById('photostack-legacy-download').style.display = 'none'
            } else {
                // Hide the File System Access button if the API isn't available
                document.getElementById('photostack-export-filesystem-api-button').style.display = 'none'
            }
            // Web Share API
            var shareData = { files: files }
            if (navigator.canShare && navigator.canShare(shareData)) {
                document.getElementById('photostack-export-web-share-button').addEventListener('click', function () {
                    rememberExportMethod('share')
                    navigator.share(shareData)
                        .then(function () {
                            console.log('Share successful.')
                        })
                        .catch(function (e) {
                            console.error(e)
                        })
                })
            } else {
                // Disable the native app share button if the API isn't available
                document.getElementById('photostack-export-web-share-button').setAttribute('disabled', 'true')
            }
            // Download files separately
            document.getElementById('photostack-export-separate-button').addEventListener('click', function () {
                rememberExportMethod('download')
                files.forEach(function (file) {
                    saveAs(file)
                })
            })
            // Download as ZIP
            document.getElementById('photostack-export-zip-button').addEventListener('click', function () {
                rememberExportMethod('zip')
                // Change button appearance
                document.getElementById('photostack-export-zip-button').disabled = true
                document.getElementById('photostack-export-zip-button').innerText = '正在打包…'
                // Generate zip
                var zip = new JSZip()
                files.forEach(function (file) {
                    zip.file(file.name, file)
                })
                zip.generateAsync({ type: 'blob' }).then(function (zipData) {
                    var today = new Date()
                    var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate()
                    saveAs(zipData, 'photostack-export-' + date + '.zip')
                    // Reset button appearance
                    document.getElementById('photostack-export-zip-button').disabled = false
                    document.getElementById('photostack-export-zip-button').innerText = '保存为 ZIP'
                })
            })
            // 一键导出：按记住的方式自动保存。逐张下载时图片落在「下载」文件夹，相册应用会自动显示
            if (autoSaveMethod === 'download') {
                files.forEach(function (file) {
                    saveAs(file)
                })
            } else if (autoSaveMethod === 'zip') {
                var quickZip = new JSZip()
                files.forEach(function (file) {
                    quickZip.file(file.name, file)
                })
                quickZip.generateAsync({ type: 'blob' }).then(function (zipData) {
                    var today = new Date()
                    var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate()
                    saveAs(zipData, 'photostack-export-' + date + '.zip')
                })
            }
            // Stop time
            console.timeEnd('Async export')
            // Switch modal content to finished result
            document.querySelector('.photostack-export-modal-loading').style.display = 'none'
            document.querySelector('.photostack-export-modal-finished').style.display = 'block'
        })
    })
}

// Export button in modal
document.getElementById('photostack-start-export-btn').addEventListener('click', function () {
    asyncExport()
})

// 一键导出：直接按上次的导出设置渲染全部图片并自动保存。默认逐张下载（图片直接进手机相册），上次选了 ZIP 则沿用
document.getElementById('photostack-quick-export-btn').addEventListener('click', function () {
    var exportModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('photostack-export-modal'))
    // 直接进入进度界面，跳过格式选择
    document.querySelector('.photostack-export-modal-initial').style.display = 'none'
    document.querySelector('.photostack-export-modal-loading').style.display = 'block'
    document.querySelector('.photostack-export-modal-finished').style.display = 'none'
    exportModal.show()
    asyncExport(loadExportPrefs().method === 'zip' ? 'zip' : 'download')
})

// Reset export status when the close button is clicked
document.getElementById('photostack-export-modal').addEventListener('hidden.bs.modal', function () {
    // Clear event listeners
    document.getElementById('photostack-export-web-share-button').replaceWith(document.getElementById('photostack-export-web-share-button').cloneNode(true))
    document.getElementById('photostack-export-separate-button').replaceWith(document.getElementById('photostack-export-separate-button').cloneNode(true))
    document.getElementById('photostack-export-filesystem-api-button').replaceWith(document.getElementById('photostack-export-filesystem-api-button').cloneNode(true))
    document.getElementById('photostack-export-zip-button').replaceWith(document.getElementById('photostack-export-zip-button').cloneNode(true))
    // Clear content
    document.querySelector('.photostack-export-modal-loading').style.display = 'none'
    document.querySelector('.photostack-export-modal-finished').style.display = 'none'
    document.querySelector('.photostack-export-modal-initial').style.display = 'block'
    document.getElementById('photostack-export-modal-progress').setAttribute('aria-valuenow', '0')
    document.getElementById('photostack-export-modal-progress').setAttribute('style', 'width: 0%')
    // Clear PWA icon
    if ('setAppBadge' in navigator) {
        navigator.clearAppBadge()
    }
})

// Update list of supported formats
updateSupportedFormats();

// 恢复上次使用的导出设置
restoreExportPrefs();

// Add warning for Safari users
const ifSafari = (navigator.userAgent.includes('Safari') && (!navigator.userAgent.includes('Chrome')))
if (ifSafari) {
    var warningBlock = document.querySelector('.photostack-safari-warning')
    warningBlock.style.display = 'block'
}

// Set initial name pattern radio value
if (document.querySelector('input[name="photostack-file-name"]:checked').id === 'photostack-file-keep-name') {
    document.getElementById('photostack-file-name-pattern').disabled = true
} else {
    document.getElementById('photostack-file-name-pattern').disabled = false
}

// Enable/disable name pattern field based on radio button
document.querySelectorAll('input[name="photostack-file-name"]').forEach(function (el) {
    el.addEventListener('click', function () {
        if (document.querySelector('input[name="photostack-file-name"]:checked').id === 'photostack-file-keep-name') {
            document.getElementById('photostack-file-name-pattern').disabled = true
        } else {
            document.getElementById('photostack-file-name-pattern').disabled = false
        }
    })
})

// Append event listeners to buttons and other elements

document.querySelector('#photostack-clear-images-btn').addEventListener('click', function () {
    clearImportedImages()
})

document.querySelector('#photostack-import-file-btn').addEventListener('click', function () {
    document.getElementById('photostack-import-file').click()
})

document.getElementById('photostack-import-file').addEventListener('change', function () {
    importFiles(this.files, this)
})

document.querySelectorAll('.photostack-preview-update').forEach(function (item) {
    item.addEventListener('change', function () {
        renderPreviewCanvas()
    })
})

document.getElementById('photostack-reset-image-width-button').addEventListener('click', function () {
    document.getElementById('photostack-image-width').value = ''
    renderPreviewCanvas()
})

document.getElementById('photostack-print-btn').addEventListener('click', function () {
    window.print()
})

// 翻页按钮、单张保存与排序
document.getElementById('photostack-prev-image-btn').addEventListener('click', goToPrevImage)

document.getElementById('photostack-next-image-btn').addEventListener('click', goToNextImage)

document.getElementById('photostack-save-current-btn').addEventListener('click', saveCurrentImage)

document.getElementById('photostack-sort-images-btn').addEventListener('click', sortImagesByName)

// 手机底部快捷栏
document.getElementById('photostack-bb-import-btn').addEventListener('click', function () {
    document.getElementById('photostack-import-file').click()
})

document.getElementById('photostack-bb-save-btn').addEventListener('click', saveCurrentImage)

// 平滑度滑杆：实时显示百分比，并在关闭圆角时置灰
var smoothnessSlider = document.getElementById('photostack-corner-smoothness')
var smoothnessValueBadge = document.getElementById('photostack-corner-smoothness-value')
var cornersRoundCheckbox = document.getElementById('photostack-corners-round')
smoothnessSlider.addEventListener('input', function () {
    smoothnessValueBadge.innerText = this.value + '%'
})
smoothnessSlider.disabled = !cornersRoundCheckbox.checked
cornersRoundCheckbox.addEventListener('change', function () {
    smoothnessSlider.disabled = !cornersRoundCheckbox.checked
})

// 平滑度滑杆：拖动过程实时刷新预览（120ms 节流，配合渲染代数防止旧图覆盖新图）
var smoothnessPreviewTimer = null
smoothnessSlider.addEventListener('input', function () {
    if (smoothnessPreviewTimer) {
        return
    }
    smoothnessPreviewTimer = setTimeout(function () {
        smoothnessPreviewTimer = null
        renderPreviewCanvas()
    }, 120)
})

// 裁剪滑杆：拖动实时预览 + 数值徽标
;['top', 'left', 'right', 'bottom'].forEach(function (side) {
    var cropSlider = document.getElementById('photostack-crop-' + side)
    var cropBadge = document.getElementById('photostack-crop-' + side + '-value')
    var cropTimer = null
    cropSlider.addEventListener('input', function () {
        cropBadge.innerText = cropSlider.value
        if (cropTimer) {
            return
        }
        cropTimer = setTimeout(function () {
            cropTimer = null
            renderPreviewCanvas()
        }, 120)
    })
})

// 裁剪全部清零
document.getElementById('photostack-crop-reset').addEventListener('click', function () {
    ;['top', 'left', 'right', 'bottom'].forEach(function (side) {
        document.getElementById('photostack-crop-' + side).value = 0
        document.getElementById('photostack-crop-' + side + '-value').innerText = '0'
    })
    renderPreviewCanvas()
})

// ── 多选模式：选当前 / 全选 / 删除所选 ──

// 同步多选操作行的按钮状态
function updateSelectionUI() {
    var total = document.querySelectorAll('#photostack-original-container img').length
    var currentImage = document.querySelectorAll('#photostack-original-container img')[currentPreviewIndex]
    var isCurrentSelected = currentImage && selectedSet.has(currentImage)
    var selectCurrentBtn = document.getElementById('photostack-select-current-btn')
    selectCurrentBtn.innerText = isCurrentSelected ? '✓ 已选当前' : '选当前'
    selectCurrentBtn.classList.toggle('btn-success', !!isCurrentSelected)
    selectCurrentBtn.classList.toggle('btn-outline-secondary', !isCurrentSelected)
    var deleteBtn = document.getElementById('photostack-delete-selected-btn')
    deleteBtn.disabled = selectedSet.size === 0
    deleteBtn.innerText = '删除所选(' + selectedSet.size + ')'
    document.getElementById('photostack-select-all-btn').innerText = (total > 0 && selectedSet.size === total) ? '全不选' : '全选'
}

// 进入多选模式
document.getElementById('photostack-multi-select-btn').addEventListener('click', function () {
    selectionMode = true
    selectedSet.clear()
    document.getElementById('photostack-select-controls').classList.remove('d-none')
    document.getElementById('photostack-multi-select-btn').classList.add('active')
    updatePagingUI(document.querySelectorAll('#photostack-original-container img').length)
    updateSelectionUI()
})

// 退出多选模式（完成）
document.getElementById('photostack-select-done-btn').addEventListener('click', function () {
    selectionMode = false
    selectedSet.clear()
    document.getElementById('photostack-select-controls').classList.add('d-none')
    document.getElementById('photostack-multi-select-btn').classList.remove('active')
    updatePagingUI(document.querySelectorAll('#photostack-original-container img').length)
})

// 选当前 / 取消选当前
document.getElementById('photostack-select-current-btn').addEventListener('click', function () {
    var currentImage = document.querySelectorAll('#photostack-original-container img')[currentPreviewIndex]
    if (!currentImage) {
        return
    }
    if (selectedSet.has(currentImage)) {
        selectedSet.delete(currentImage)
    } else {
        selectedSet.add(currentImage)
    }
    updatePagingUI(document.querySelectorAll('#photostack-original-container img').length)
    updateSelectionUI()
})

// 全选 / 全不选
document.getElementById('photostack-select-all-btn').addEventListener('click', function () {
    var allImages = document.querySelectorAll('#photostack-original-container img')
    if (selectedSet.size === allImages.length && allImages.length > 0) {
        selectedSet.clear()
    } else {
        allImages.forEach(function (img) {
            selectedSet.add(img)
        })
    }
    updatePagingUI(allImages.length)
    updateSelectionUI()
})

// 删除所选：把勾选的图片从批次里移除，剩余图片继续统一操作
document.getElementById('photostack-delete-selected-btn').addEventListener('click', function () {
    var count = selectedSet.size
    if (!count) {
        return
    }
    if (!confirm('确定删除已选的 ' + count + ' 张图片吗？此操作不可撤销。')) {
        return
    }
    selectedSet.forEach(function (el) {
        el.remove()
    })
    selectedSet.clear()
    globalFilesCount = document.querySelectorAll('#photostack-original-container img').length
    document.querySelectorAll('.photostack-image-count').forEach(function (el) {
        el.textContent = globalFilesCount.toString()
    })
    var bottomBarBadge = document.querySelector('#photostack-bb-import-btn .photostack-image-count')
    if (bottomBarBadge) {
        bottomBarBadge.classList.toggle('d-none', globalFilesCount === 0)
    }
    var none = globalFilesCount === 0
    document.querySelectorAll('*[data-bs-target="#photostack-export-modal"]').forEach(function (el) {
        el.disabled = none
    })
    document.getElementById('photostack-save-current-btn').disabled = none
    document.getElementById('photostack-sort-images-btn').disabled = none
    document.getElementById('photostack-multi-select-btn').disabled = none
    document.getElementById('photostack-bb-save-btn').disabled = none
    document.getElementById('photostack-quick-export-btn').disabled = none
    if (none) {
        // 全部删光：退出多选并恢复空状态
        selectionMode = false
        document.getElementById('photostack-select-controls').classList.add('d-none')
        document.getElementById('photostack-multi-select-btn').classList.remove('active')
        currentPreviewIndex = 0
        updatePagingUI(0)
        var oldPreview = document.querySelector('#photostack-editor-preview img')
        if (oldPreview) {
            oldPreview.remove()
        }
        document.getElementById('photostack-preview-info').classList.remove('d-none')
    } else {
        currentPreviewIndex = 0
        renderPreviewCanvas()
        updateSelectionUI()
    }
})

// 翻页时同步多选按钮状态
function syncSelectionAfterNav() {
    if (selectionMode) {
        updateSelectionUI()
    }
}

// 常用描边颜色色板：一键切换并实时预览
var borderColorInput = document.getElementById('photostack-border-color')
function setActiveSwatch(color) {
    document.querySelectorAll('.photostack-swatch').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.color.toLowerCase() === String(color).toLowerCase())
    })
}
var swatchRow = document.querySelector('.photostack-swatch-row')
if (swatchRow) {
    swatchRow.addEventListener('click', function (e) {
        var btn = e.target.closest('.photostack-swatch')
        if (!btn) {
            return
        }
        borderColorInput.value = btn.dataset.color
        borderColorInput.dispatchEvent(new Event('change', { bubbles: true }))
        setActiveSwatch(btn.dataset.color)
    })
    // 用取色器自定义颜色时取消色板高亮
    borderColorInput.addEventListener('input', function () {
        setActiveSwatch('')
    })
}
setActiveSwatch(borderColorInput.value)

// ── 我的样式模板：保存当前描边与圆角设置，一键应用到全部图片 ──
function loadPresets() {
    try {
        return JSON.parse(localStorage.getItem('photostack-presets') || '[]')
    } catch (e) {
        return []
    }
}

function savePresets(list) {
    try {
        localStorage.setItem('photostack-presets', JSON.stringify(list))
    } catch (e) {
        // 存储不可用时模板仅本次会话有效
    }
}

function applyPreset(preset) {
    document.getElementById('photostack-border-width').value = preset.width
    borderColorInput.value = preset.color
    var roundCheckbox = document.getElementById('photostack-corners-round')
    roundCheckbox.checked = !!preset.round
    roundCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
    var smoothnessSlider = document.getElementById('photostack-corner-smoothness')
    smoothnessSlider.value = preset.smoothness
    smoothnessSlider.dispatchEvent(new Event('input', { bubbles: true }))
    setActiveSwatch(preset.color)
    renderPreviewCanvas()
}

function renderPresets() {
    var row = document.getElementById('photostack-preset-row')
    if (!row) {
        return
    }
    row.innerHTML = ''
    var presets = loadPresets()
    if (!presets.length) {
        var emptyHint = document.createElement('span')
        emptyHint.className = 'text-muted small'
        emptyHint.innerText = '还没有模板，调好样式后点「存为模板」'
        row.appendChild(emptyHint)
    }
    presets.forEach(function (preset, index) {
        var chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'photostack-preset-chip'
        chip.setAttribute('title', '应用模板「' + preset.name + '」')
        var nameSpan = document.createElement('span')
        nameSpan.innerText = preset.name
        chip.appendChild(nameSpan)
        var del = document.createElement('span')
        del.className = 'photostack-preset-del'
        del.innerHTML = '&times;'
        del.setAttribute('title', '删除模板')
        del.addEventListener('click', function (e) {
            e.stopPropagation()
            if (confirm('删除模板「' + preset.name + '」？')) {
                var list = loadPresets()
                list.splice(index, 1)
                savePresets(list)
                renderPresets()
            }
        })
        chip.appendChild(del)
        chip.addEventListener('click', function () {
            applyPreset(preset)
        })
        row.appendChild(chip)
    })
    var addBtn = document.createElement('button')
    addBtn.type = 'button'
    addBtn.className = 'photostack-preset-chip photostack-preset-add'
    addBtn.innerHTML = '<i class="bi bi-plus-lg me-1"></i>存为模板'
    addBtn.addEventListener('click', function () {
        var name = prompt('给这组样式起个名字：')
        if (!name || name.trim() === '') {
            return
        }
        var list = loadPresets()
        list.push({
            name: name.trim(),
            width: document.getElementById('photostack-border-width').value || '0',
            color: document.getElementById('photostack-border-color').value,
            round: document.getElementById('photostack-corners-round').checked,
            smoothness: document.getElementById('photostack-corner-smoothness').value
        })
        savePresets(list)
        renderPresets()
    })
    row.appendChild(addBtn)
}

renderPresets()

// 预览区域左右滑动翻页（手机）
var swipeStartX = 0
var previewArea = document.getElementById('photostack-editor-preview')
previewArea.addEventListener('touchstart', function (e) {
    swipeStartX = e.changedTouches[0].screenX
}, { passive: true })
previewArea.addEventListener('touchend', function (e) {
    var deltaX = e.changedTouches[0].screenX - swipeStartX
    // 滑动距离太小则忽略，避免误触
    if (Math.abs(deltaX) < 50) {
        return
    }
    if (deltaX < 0) {
        goToNextImage()
    } else {
        goToPrevImage()
    }
}, { passive: true })

// Drag and drop file upload

document.body.addEventListener('dragenter', function (e) {
    console.log('Drag enter detected')
    dragModal.show()
})

document.body.addEventListener('dragleave', function (e) {
    console.log('Drag leave detected')
    dragModal.hide()
})

document.body.addEventListener('drop', function (e) {
    var files = e.dataTransfer.files
    importFiles(files)
})

document.getElementById('photostack-import-file').addEventListener('change', function () {
    // This prevents the modal from getting stuck when the 'drop' listener doesn't fire correctly
    dragModal.hide()
    // This hides the navbar dropdown after a file is selected on small screens
    navCollapse.hide()
})

// Prevent default browser drag/drop actions

var eventNames = ['dragenter', 'dragover', 'dragleave', 'drop']
eventNames.forEach(function (eventName) {
    document.body.addEventListener(eventName, function (e) {
        e.preventDefault()
        e.stopPropagation()
    }, false)
})

// Get list of watermarks when page is loaded

async function refreshWatermarks() {
    // Add watermarks to editor dropdown menu and watermark manager
    await watermarksStore.iterate(function (value, key, iterationNumber) {
        var option = document.createElement('option')
        option.innerText = key
        option.value = key
        document.getElementById('photostack-watermark-select').appendChild(option)
        console.log('Loaded watermark:', [key, value])
    })
}

refreshWatermarks()

// Keyboard shortcuts
// Some shortcuts are cloned from Adobe Lightroom: https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html
document.addEventListener('keydown', function (event) {
    var exportModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('photostack-export-modal'))
    // Ignore if a modal is open
    if (document.querySelectorAll('.modal.show').length) {
        return
    }
    // 正在输入框中打字时不响应翻页快捷键
    var activeElement = document.activeElement
    var typingInField = activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(activeElement.tagName)
    // All keyboard shortcuts
    if (event.metaKey && event.shiftKey && (event.code === 'KeyI') && isApplePlatform) {
        // Import on Mac: Command+Shift+I
        event.preventDefault()
        document.getElementById('photostack-import-file').click()
    } else if (event.ctrlKey && event.shiftKey && (event.code === 'KeyI') && (!isApplePlatform)) {
        // Import on PC: Ctrl+Shift+I
        event.preventDefault()
        document.getElementById('photostack-import-file').click()
    } else if (event.metaKey && (event.code === 'KeyD') && (globalFilesCount > 0) && isApplePlatform) {
        // Delete imported images on Mac: Command+D
        clearImportedImages()
    } else if (event.ctrlKey && (event.code === 'KeyD') && (globalFilesCount > 0) && (!isApplePlatform)) {
        // Delete imported images on PC: Ctrl+D
        clearImportedImages()
    } else if (event.shiftKey && (event.code === 'KeyE') && (globalFilesCount > 0)) {
        // Export: Shift + E
        exportModal.show()
    } else if (event.metaKey && (event.code === 'KeyS') && (globalFilesCount > 0) && isApplePlatform) {
        // Export on Mac: Command+S
        event.preventDefault()
        exportModal.show()
    } else if (event.ctrlKey && (event.code === 'KeyS') && (globalFilesCount > 0) && (!isApplePlatform)) {
        // Export on PC: Ctrl+S
        event.preventDefault()
        exportModal.show()
    } else if ((event.code === 'ArrowLeft') && !typingInField) {
        // 上一张：←
        event.preventDefault()
        goToPrevImage()
    } else if ((event.code === 'ArrowRight') && !typingInField) {
        // 下一张：→
        event.preventDefault()
        goToNextImage()
    }
})