package ro.purgo.android;

import android.app.usage.StorageStatsManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.storage.StorageManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * JS ⇄ native bridge. JS calls PurgoNative.call(id, method, argsJson); when done, native calls
 * __native.done(id, ok) and JS fetches the JSON result from https://app.purgo.local/result?id=…
 * Progress and other notifications arrive through __native.event(name, data).
 */
public final class Bridge {
    private final MainActivity act;
    private final WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private final Map<String, String> results = new ConcurrentHashMap<>();
    private final Map<String, Job> jobs = new ConcurrentHashMap<>();
    private final SharedPreferences prefs;

    Bridge(MainActivity act, WebView web) {
        this.act = act;
        this.web = web;
        this.prefs = act.getSharedPreferences("purgo", Context.MODE_PRIVATE);
        pool.submit(() -> { if (hasAllFiles()) Bin.purgeExpired(); });
    }

    @JavascriptInterface
    public void call(final String id, final String method, final String args) {
        pool.submit(() -> run(id, method, args));
    }

    @JavascriptInterface
    public void cancel(String id) {
        Job j = jobs.get(id);
        if (j != null) j.cancelled = true;
    }

    String takeResult(String id) { return id == null ? null : results.remove(id); }

    private void run(String id, String method, String argsStr) {
        JSONObject args;
        try { args = argsStr == null || argsStr.isEmpty() ? new JSONObject() : new JSONObject(argsStr); }
        catch (Exception e) { args = new JSONObject(); }
        Job job = new Job() {
            @Override void emit(JSONObject p) { event("progress", Util.obj("id", id, "data", p)); }
        };
        jobs.put(id, job);
        boolean ok = true;
        Object result;
        try {
            result = dispatch(method, args, job);
        } catch (InterruptedException e) {
            ok = false;
            result = Util.obj("error", "cancelled", "cancelled", true);
        } catch (Throwable t) {
            ok = false;
            result = Util.obj("error", t.getClass().getSimpleName() + ": " + t.getMessage());
        } finally {
            jobs.remove(id);
        }
        results.put(id, result == null ? "null" : result.toString());
        js("__native.done(" + JSONObject.quote(id) + "," + ok + ")");
    }

    void event(String name, JSONObject data) {
        js("__native.event(" + JSONObject.quote(name) + "," + data + ")");
    }

    private void js(final String code) {
        act.runOnUiThread(() -> web.evaluateJavascript("window.__native&&" + code, null));
    }

    // ----------------------------------------------------------------------------------------
    private Object dispatch(String m, JSONObject a, Job job) throws Exception {
        switch (m) {
            case "env": return env();
            case "requestAllFiles": act.runOnUiThread(this::requestAllFiles); return true;
            case "requestUsage": act.runOnUiThread(this::requestUsage); return true;
            case "scan": {
                FileIndex idx = a.optBoolean("reuse") && FileIndex.current != null ? FileIndex.current : buildIndex(job);
                return summary(idx);
            }
            case "large": return large(index(job), a.optLong("min", 50L * 1024 * 1024), a.optString("type", "all"));
            case "junk": return Junk.scan(act, index(job));
            case "duplicates": return Duplicates.find(index(job), job);
            case "photos": return Photos.analyse(act, index(job), job);
            case "chat": return ChatMedia.overview(index(job));
            case "chatFiles": return ChatMedia.files(index(job), a.getString("dir"));
            case "apps": return Apps.list(act, job);
            case "uninstall": {
                List<String> pkgs = strings(a.optJSONArray("pkgs"));
                act.runOnUiThread(() -> act.uninstall(pkgs));
                return true;
            }
            case "appSettings": {
                String pkg = a.getString("pkg");
                act.runOnUiThread(() -> {
                    Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
                    try { act.startActivity(i); } catch (Exception ignored) {}
                });
                return true;
            }
            case "cacheTotal": return Util.obj("bytes", Apps.totalCache(act));
            case "clearAllCache": {
                if (Build.VERSION.SDK_INT < 30 || !hasAllFiles()) return Util.obj("supported", false);
                long before = Apps.totalCache(act);
                act.runOnUiThread(() -> act.clearAllCaches(before));
                return Util.obj("supported", true);
            }
            case "delete": {
                List<String> paths = strings(a.optJSONArray("paths"));
                boolean bin = a.has("bin") ? a.optBoolean("bin") : prefs.getBoolean("bin", true);
                return Bin.delete(act, paths, bin, job);
            }
            case "bin": return Bin.list();
            case "restore": return Bin.restore(act, new HashSet<>(strings(a.optJSONArray("ids"))));
            case "emptyBin": {
                JSONArray ids = a.optJSONArray("ids");
                return Bin.empty(ids == null ? null : new HashSet<>(strings(ids)));
            }
            case "browse": return browse(index(job), a.optString("path", FileIndex.rootPath()));
            case "open": {
                String p = a.getString("path");
                act.runOnUiThread(() -> open(p));
                return true;
            }
            case "share": {
                List<String> paths = strings(a.optJSONArray("paths"));
                act.runOnUiThread(() -> share(paths));
                return true;
            }
            case "setSetting": {
                prefs.edit().putBoolean(a.getString("key"), a.optBoolean("value")).apply();
                return true;
            }
            case "openUrl": {
                String url = a.getString("url");
                act.runOnUiThread(() -> { try { act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {} });
                return true;
            }
            default:
                throw new IllegalArgumentException("Unknown method " + m);
        }
    }

    private FileIndex index(Job job) throws Exception {
        FileIndex idx = FileIndex.current;
        return idx != null ? idx : buildIndex(job);
    }

    private FileIndex buildIndex(Job job) throws Exception {
        if (!hasAllFiles()) throw new SecurityException("Storage permission missing");
        return FileIndex.build((files, bytes, dir) ->
                job.progress(false, "stage", "Scanning storage", "files", files, "bytes", bytes, "dir", dir));
    }

    boolean hasAllFiles() {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return act.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private JSONObject env() {
        long total = 0, free = 0;
        try {
            StorageStatsManager ssm = (StorageStatsManager) act.getSystemService(Context.STORAGE_STATS_SERVICE);
            total = ssm.getTotalBytes(StorageManager.UUID_DEFAULT);
            free = ssm.getFreeBytes(StorageManager.UUID_DEFAULT);
        } catch (Throwable t) {
            File d = Environment.getDataDirectory();
            total = d.getTotalSpace(); free = d.getUsableSpace();
        }
        String ver = "";
        try { ver = act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName; } catch (Exception ignored) {}
        return Util.obj("sdk", Build.VERSION.SDK_INT, "allFiles", hasAllFiles(), "usage", Apps.hasUsageAccess(act),
                "total", total, "free", free, "version", ver, "device", Build.MANUFACTURER + " " + Build.MODEL,
                "bin", prefs.getBoolean("bin", true), "canClearAllCache", Build.VERSION.SDK_INT >= 30,
                "indexed", FileIndex.current != null, "insets", act.insetsJson());
    }

    private void requestAllFiles() {
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                act.startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + act.getPackageName())));
            } catch (ActivityNotFoundException e) {
                act.startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
            }
        } else {
            act.requestPermissions(new String[]{android.Manifest.permission.READ_EXTERNAL_STORAGE,
                    android.Manifest.permission.WRITE_EXTERNAL_STORAGE}, 7);
        }
    }

    private void requestUsage() {
        Intent i = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
        if (Build.VERSION.SDK_INT >= 29) i.setData(Uri.parse("package:" + act.getPackageName()));
        try { act.startActivity(i); }
        catch (Exception e) { try { act.startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)); } catch (Exception ignored) {} }
    }

    private static JSONObject summary(FileIndex idx) {
        long[][] cat = new long[FileIndex.TYPE_NAMES.length][2];
        synchronized (idx) {
            for (FileIndex.Entry e : idx.files) { cat[e.type][0] += e.size; cat[e.type][1]++; }
        }
        JSONObject cats = new JSONObject();
        for (int i = 0; i < cat.length; i++) Util.put(cats, FileIndex.TYPE_NAMES[i], Util.obj("bytes", cat[i][0], "count", cat[i][1]));
        return Util.obj("files", idx.files.size(), "bytes", idx.totalBytes, "categories", cats, "scannedAt", idx.scannedAt);
    }

    private static JSONObject large(FileIndex idx, long min, String type) {
        List<FileIndex.Entry> l = new ArrayList<>();
        synchronized (idx) {
            for (FileIndex.Entry e : idx.files) {
                if (e.size < min) continue;
                if (!"all".equals(type) && !FileIndex.TYPE_NAMES[e.type].equals(type)) continue;
                l.add(e);
            }
        }
        Collections.sort(l, (x, y) -> Long.compare(y.size, x.size));
        JSONArray out = new JSONArray();
        long bytes = 0;
        for (int i = 0; i < l.size() && i < 2000; i++) { out.put(Util.fileJson(l.get(i))); bytes += l.get(i).size; }
        return Util.obj("items", out, "bytes", bytes, "count", l.size());
    }

    private static JSONObject browse(FileIndex idx, String path) {
        List<JSONObject> items = new ArrayList<>();
        File[] kids = new File(path).listFiles();
        String bin = FileIndex.binPath();
        if (kids != null) {
            synchronized (idx) {
                for (File k : kids) {
                    String p = k.getAbsolutePath();
                    if (p.equals(bin)) continue;
                    if (k.isDirectory()) {
                        long[] t = idx.dirs.get(p);
                        JSONObject o = Util.dirJson(p, t == null ? 0 : t[0], t == null ? 0 : t[1]);
                        if (t == null) Util.put(o, "locked", true);
                        items.add(o);
                    } else items.add(Util.fileJson(FileIndex.entryFor(k)));
                }
            }
        }
        Collections.sort(items, (x, y) -> Long.compare(y.optLong("s"), x.optLong("s")));
        long[] t;
        synchronized (idx) { t = idx.dirs.get(path); }
        return Util.obj("path", path, "root", idx.root, "items", Util.arr(items), "bytes", t == null ? 0 : t[0]);
    }

    private void open(String p) {
        Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(FilesProvider.uriFor(p), Util.mime(p))
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { act.startActivity(Intent.createChooser(i, "Open with")); }
        catch (Exception e) { event("toast", Util.obj("text", "No app can open this file")); }
    }

    private void share(List<String> paths) {
        ArrayList<Uri> uris = new ArrayList<>();
        for (String p : paths) uris.add(FilesProvider.uriFor(p));
        Intent i;
        if (uris.size() == 1) i = new Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris.get(0)).setType(Util.mime(paths.get(0)));
        else i = new Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris).setType("*/*");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { act.startActivity(Intent.createChooser(i, "Share")); } catch (Exception ignored) {}
    }

    private static List<String> strings(JSONArray a) {
        List<String> l = new ArrayList<>();
        if (a != null) for (int i = 0; i < a.length(); i++) l.add(a.optString(i));
        return l;
    }

    @SuppressWarnings("unused") private Set<String> none() { return new HashSet<>(); }
}
