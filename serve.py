#!/usr/bin/env python3
"""批量描边工具本地服务器：静态文件 + 禁止缓存 HTML/JS/CSS（保证手机刷新即见最新版）
用法：python3 serve.py  （然后手机访问 http://电脑IP:8000/edit/）"""
import http.server
import socketserver
import os

PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))
NO_CACHE_EXT = ('.html', '.js', '.css', '.webmanifest', '.json')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        path = self.translate_path(self.path)
        ext = os.path.splitext(path)[1].lower()
        if ext in NO_CACHE_EXT:
            # 每次都向服务器校验新鲜度，避免手机端看到旧页面
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


class ThreadedServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    with ThreadedServer(('0.0.0.0', PORT), Handler) as httpd:
        print(f'批量描边工具服务器已启动: http://0.0.0.0:{PORT}/edit/')
        httpd.serve_forever()
