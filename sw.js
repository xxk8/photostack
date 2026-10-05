// This is the "Offline copy of pages" service worker（PWA Builder 模板 + 预缓存应用外壳）

// 缓存名带版本号：更新 sw.js 后在 activate 阶段自动清理旧缓存
const CACHE = "photostack-offline-v10";

// 首次安装即预缓存全部页面与静态资源，断网后整个站点直接可用。
// 注意：列表中的 ?v= 缓存戳必须与页面引用保持一致；变更缓存戳时同步改这里。
// 逐条 catch：单个资源失败不影响整体外壳缓存。
// 预缓存列表使用相对路径，基于 registration.scope 解析，
// 因此同时兼容根路径部署与 GitHub Pages 项目站点的子路径部署。
// 注意：列表中的 ?v= 缓存戳必须与页面引用保持一致；变更缓存戳时同步改这里。
const BASE = new URL('./', self.registration.scope).href;
const PRECACHE_URLS = [
    "",                        // 首页
    "outline/",                // 自动描边
    "edit/",                   // 编辑器
    "watermarks/",             // 水印管理
    "editor.html",             // 旧地址跳转页
    "watermark.html",
    "site.webmanifest",
    // 样式与字体
    "css/bootstrap.min.css?v=20261010",
    "css/bootstrap-icons.css?v=20261010",
    "css/photostack-styles.css?v=20261012",
    "css/fonts/bootstrap-icons.woff2?8bd4575acf83c7696dc7a14a966660a3",
    "css/fonts/bootstrap-icons.woff?8bd4575acf83c7696dc7a14a966660a3",
    // 脚本
    "js/shared.js?v=20261013",
    "js/FileSaver.min.js?v=20261010",
    "js/jszip.min.js?v=20261010",
    "js/localforage.min.js?v=20261010",
    "js/pica.min.js?v=20261010",
    "js/bootstrap.bundle.min.js?v=20261010",
    "js/photostack-editor.js?v=20261013",
    "js/photostack-outline.js?v=20261013",
    "js/watermarks.js?v=20261010",
    "js/register-sw.js?v=20261010",
    // 图标
    "img/icon_x24.png",
    "img/icon_x192.png",
    "img/icon_x512.png",
    "img/maskable_icon_x192.png",
    "img/maskable_icon_x512.png",
    "img/apple-touch-icon.png"
];

// Install stage sets up the app shell and opens a new cache
self.addEventListener("install", function (event) {
    console.log("[PWA Builder] Install Event processing");

    event.waitUntil(
        caches.open(CACHE).then(function (cache) {
            return Promise.all(
                PRECACHE_URLS.map(function (url) {
                    return cache.add(new URL(url, BASE).href).catch(function (error) {
                        console.warn("[PWA Builder] Precache failed for " + url, error);
                    });
                })
            );
        }).then(function () {
            // 预缓存完成后立即接管页面，不等旧标签页关闭
            return self.skipWaiting();
        })
    );
});

// Take control of open pages right away and clean up old caches
self.addEventListener("activate", function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys
                    .filter(function (key) { return key !== CACHE; })
                    .map(function (key) { return caches.delete(key); })
            );
        }).then(function () {
            return self.clients.claim();
        })
    );
});

// If any fetch fails, it will look for the request in the cache and serve it from there first
self.addEventListener("fetch", function (event) {
    if (event.request.method !== "GET") return;
    // 只处理同源资源，跳过广告、统计等外部请求
    var requestOrigin;
    try {
        requestOrigin = new URL(event.request.url).origin;
    } catch (e) {
        return;
    }
    if (requestOrigin !== self.location.origin) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(function (response) {
                console.log("Add page to offline cache: " + response.url);

                // If request was success, add or update it in the cache
                event.waitUntil(updateCache(event.request, response.clone()));

                return response;
            })
            .catch(function (error) {
                console.log("Network request Failed. Serving content from cache: " + error);
                return fromCache(event.request);
            })
    );
});

function fromCache(request) {
    // Check to see if you have it in the cache
    // Return response
    return caches.open(CACHE).then(function (cache) {
        return cache.match(request).then(function (matching) {
            if (!matching || matching.status === 404) {
                return Promise.reject("no-match");
            }

            return matching;
        });
    });
}

function updateCache(request, response) {
    return caches.open(CACHE).then(function (cache) {
        return cache.put(request, response);
    });
}
