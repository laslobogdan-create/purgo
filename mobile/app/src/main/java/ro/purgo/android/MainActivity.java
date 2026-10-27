package ro.purgo.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.storage.StorageManager;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.List;

public class MainActivity extends Activity {
    private static final int REQ_UNINSTALL = 41, REQ_CLEAR_CACHE = 42;

    private WebView web;
    private Bridge bridge;
    private final ArrayDeque<String> uninstallQueue = new ArrayDeque<>();
    private String uninstalling;
    private int uninstallTotal;
    private long cacheBefore;
    private float insetTop, insetBottom;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        edgeToEdge();

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(9, 10, 20));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);

        bridge = new Bridge(this, web);
        web.addJavascriptInterface(bridge, "PurgoNative");
        web.setWebViewClient(new LocalServer(this, bridge));
        web.setWebChromeClient(new WebChromeClient());

        web.setOnApplyWindowInsetsListener((v, insets) -> {
            float d = getResources().getDisplayMetrics().density;
            int top, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                top = i.top; bottom = i.bottom;
            } else {
                top = insets.getSystemWindowInsetTop(); bottom = insets.getSystemWindowInsetBottom();
            }
            insetTop = top / d; insetBottom = bottom / d;
            bridge.event("insets", insetsJson());
            return insets;
        });

        setContentView(web);
        web.loadUrl(LocalServer.ORIGIN + "/index.html");
    }

    @SuppressWarnings("deprecation")
    private void edgeToEdge() {
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            w.setNavigationBarContrastEnforced(false);
            w.setStatusBarContrastEnforced(false);
        }
    }

    JSONObject insetsJson() { return Util.obj("top", insetTop, "bottom", insetBottom); }

    @Override
    protected void onResume() {
        super.onResume();
        if (bridge != null) bridge.event("resume", Util.obj("t", System.currentTimeMillis()));
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__native ? String(__native.back()) : 'false'", v -> {
            if (v == null || !v.contains("true")) finish();
        });
    }

    // ---------------- uninstall queue ----------------
    void uninstall(List<String> pkgs) {
        uninstallQueue.addAll(pkgs);
        uninstallTotal = uninstallQueue.size() + (uninstalling != null ? 1 : 0);
        if (uninstalling == null) nextUninstall();
    }

    @SuppressWarnings("deprecation")
    private void nextUninstall() {
        uninstalling = uninstallQueue.poll();
        if (uninstalling == null) { bridge.event("uninstallDone", Util.obj("total", uninstallTotal)); return; }
        bridge.event("uninstallStart", Util.obj("pkg", uninstalling, "left", uninstallQueue.size()));
        Intent i = new Intent(Intent.ACTION_UNINSTALL_PACKAGE, Uri.parse("package:" + uninstalling));
        i.putExtra(Intent.EXTRA_RETURN_RESULT, true);
        try {
            startActivityForResult(i, REQ_UNINSTALL);
        } catch (Exception e) {
            bridge.event("uninstall", Util.obj("pkg", uninstalling, "ok", false, "left", uninstallQueue.size()));
            nextUninstall();
        }
    }

    void clearAllCaches(long before) {
        cacheBefore = before;
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                startActivityForResult(new Intent(StorageManager.ACTION_CLEAR_APP_CACHE), REQ_CLEAR_CACHE);
            } catch (Exception e) {
                bridge.event("cacheCleared", Util.obj("ok", false));
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_UNINSTALL && uninstalling != null) {
            final String pkg = uninstalling;
            // Some launchers report "cancelled" even after removing the app, so check for real.
            web.postDelayed(() -> {
                boolean ok = !Apps.isInstalled(this, pkg);
                bridge.event("uninstall", Util.obj("pkg", pkg, "ok", ok, "left", uninstallQueue.size()));
                nextUninstall();
            }, 350);
        } else if (requestCode == REQ_CLEAR_CACHE) {
            final boolean accepted = resultCode == RESULT_OK;
            new Thread(() -> {
                long after = Apps.totalCache(this);
                long freed = cacheBefore >= 0 && after >= 0 ? Math.max(0, cacheBefore - after) : -1;
                bridge.event("cacheCleared", Util.obj("ok", accepted, "freed", freed, "after", after));
            }).start();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        bridge.event("resume", Util.obj("t", System.currentTimeMillis()));
    }
}
