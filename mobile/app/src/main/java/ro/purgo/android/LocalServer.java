package ro.purgo.android;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Serves the UI, thumbnails, app icons, file contents and bridge results from https://app.purgo.local/. */
final class LocalServer extends WebViewClient {
    static final String HOST = "app.purgo.local";
    static final String ORIGIN = "https://" + HOST;

    private final Context ctx;
    private final Bridge bridge;

    LocalServer(Context ctx, Bridge bridge) { this.ctx = ctx; this.bridge = bridge; }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
        Uri u = req.getUrl();
        if (HOST.equals(u.getHost())) return false;
        try { ctx.startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {}
        return true;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
        Uri u = req.getUrl();
        if (!HOST.equals(u.getHost())) return null;
        String path = u.getPath() == null ? "/" : u.getPath();
        try {
            switch (path) {
                case "/result": {
                    String json = bridge.takeResult(u.getQueryParameter("id"));
                    return bytes("application/json", (json == null ? "null" : json).getBytes(StandardCharsets.UTF_8), false);
                }
                case "/thumb": {
                    int size = parseInt(u.getQueryParameter("s"), 256);
                    byte[] b = Thumbs.get(ctx, u.getQueryParameter("p"), Math.min(512, size));
                    return b == null ? notFound() : bytes("image/jpeg", b, true);
                }
                case "/icon": {
                    byte[] b = Apps.icon(ctx, u.getQueryParameter("pkg"));
                    return b == null ? notFound() : bytes("image/png", b, true);
                }
                case "/file":
                    return file(u.getQueryParameter("p"), req.getRequestHeaders());
                default: {
                    String asset = path.equals("/") ? "index.html" : path.substring(1);
                    if (asset.contains("..")) return notFound();
                    InputStream in = ctx.getAssets().open("www/" + asset);
                    WebResourceResponse r = new WebResourceResponse(Util.mime(asset), "UTF-8", in);
                    Map<String, String> h = new HashMap<>();
                    h.put("Cache-Control", "no-cache");
                    r.setResponseHeaders(h);
                    return r;
                }
            }
        } catch (Exception e) {
            return notFound();
        }
    }

    private static WebResourceResponse file(String p, Map<String, String> headers) throws Exception {
        if (p == null) return notFound();
        File f = new File(p);
        if (!f.isFile()) return notFound();
        long len = f.length();
        String mime = Util.mime(p);
        String range = null;
        if (headers != null) for (Map.Entry<String, String> e : headers.entrySet()) {
            if ("range".equalsIgnoreCase(e.getKey())) range = e.getValue();
        }
        Map<String, String> h = new HashMap<>();
        h.put("Accept-Ranges", "bytes");
        h.put("Cache-Control", "no-store");
        if (range != null && range.toLowerCase(Locale.ROOT).startsWith("bytes=")) {
            String[] se = range.substring(6).split("-", 2);
            long start = se[0].isEmpty() ? 0 : Long.parseLong(se[0].trim());
            long end = se.length > 1 && !se[1].trim().isEmpty() ? Long.parseLong(se[1].trim()) : len - 1;
            end = Math.min(end, len - 1);
            if (start > end) start = 0;
            InputStream in = new FileInputStream(f);
            long skipped = 0;
            while (skipped < start) {
                long s = in.skip(start - skipped);
                if (s <= 0) break;
                skipped += s;
            }
            h.put("Content-Range", "bytes " + start + "-" + end + "/" + len);
            h.put("Content-Length", String.valueOf(end - start + 1));
            return new WebResourceResponse(mime, null, 206, "Partial Content", h, new LimitedStream(in, end - start + 1));
        }
        h.put("Content-Length", String.valueOf(len));
        return new WebResourceResponse(mime, null, 200, "OK", h, new FileInputStream(f));
    }

    private static WebResourceResponse bytes(String mime, byte[] b, boolean cache) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", cache ? "max-age=600" : "no-store");
        return new WebResourceResponse(mime, null, 200, "OK", h, new ByteArrayInputStream(b));
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private static int parseInt(String s, int def) {
        try { return Integer.parseInt(s); } catch (Exception e) { return def; }
    }

    private static final class LimitedStream extends InputStream {
        private final InputStream in;
        private long left;
        LimitedStream(InputStream in, long left) { this.in = in; this.left = left; }
        @Override public int read() throws java.io.IOException {
            if (left <= 0) return -1;
            int b = in.read();
            if (b >= 0) left--;
            return b;
        }
        @Override public int read(byte[] b, int off, int len) throws java.io.IOException {
            if (left <= 0) return -1;
            int n = in.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }
        @Override public void close() throws java.io.IOException { in.close(); }
    }
}
