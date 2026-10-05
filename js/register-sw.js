// This is the "Offline copy of pages" service worker from PWA Builder

if ("serviceWorker" in navigator) {
	if (navigator.serviceWorker.controller) {
		console.log("Active service worker found, no need to register");
	} else {
		// Register the service worker
		// register-sw.js 固定位于站点根的 js/ 目录，据此推导站点根路径，
		// 兼容 GitHub Pages 项目站点（部署在 /仓库名/ 子路径下）
		var siteRoot = new URL("../", document.currentScript.src).href;
		navigator.serviceWorker
			.register(siteRoot + "sw.js", {
				scope: siteRoot
			})
			.then(function (reg) {
				console.log("Service worker has been registered for scope: " + reg.scope);
			});
	}
}