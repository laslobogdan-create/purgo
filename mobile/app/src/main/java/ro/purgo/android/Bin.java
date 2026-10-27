package ro.purgo.android;

import android.content.Context;
import android.media.MediaScannerConnection;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Purgo Bin: deleted items are moved to /storage/emulated/0/.PurgoBin and can be restored for 30 days.
 * Moving within the same storage is an instant rename, so it costs no extra space or time.
 */
final class Bin {
    private Bin() {}

    static final long KEEP_MS = 30L * 86_400_000L;
    private static final Object LOCK = new Object();

    private static File dir() {
        File d = new File(FileIndex.binPath());
        if (!d.exists()) {
            d.mkdirs();
            try { new File(d, ".nomedia").createNewFile(); } catch (Exception ignored) {}
        }
        return d;
    }

    private static File metaFile() { return new File(dir(), "bin.json"); }

    private static JSONArray load() {
        try {
            File f = metaFile();
            if (!f.exists()) return new JSONArray();
            byte[] b = readAll(f);
            return new JSONArray(new String(b, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static void save(JSONArray a) {
        try (OutputStream os = new FileOutputStream(metaFile())) {
            os.write(a.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {}
    }

    /** Deletes (or bins) the given paths. Reports progress per item. */
    static JSONObject delete(Context ctx, List<String> paths, boolean useBin, Job job) {
        int ok = 0, failed = 0;
        long bytes = 0;
        JSONArray errors = new JSONArray();
        Set<String> gone = new HashSet<>();
        List<String> scan = new ArrayList<>();
        FileIndex idx = FileIndex.current;
        String binRoot = FileIndex.binPath();
        synchronized (LOCK) {
            JSONArray meta = useBin ? load() : null;
            int i = 0;
            for (String p : paths) {
                i++;
                if (job != null && job.cancelled) break;
                File f = new File(p);
                if (!f.exists()) { ok++; gone.add(p); continue; }
                if (Util.under(p, binRoot) || p.equals(FileIndex.rootPath())) { failed++; continue; }
                long size = sizeOf(f, idx);
                boolean isDir = f.isDirectory();
                boolean done;
                if (isDir && sizeOfCount(f, idx) == 0 && emptyTree(f)) {
                    done = deleteTree(f);                         // empty folders: nothing to keep
                } else if (useBin) {
                    String id = System.currentTimeMillis() + "-" + i;
                    File slot = new File(dir(), id);
                    slot.mkdirs();
                    File target = new File(slot, f.getName());
                    done = f.renameTo(target) || (copyTree(f, target) && deleteTree(f));
                    if (done) {
                        JSONObject m = Util.obj("id", id, "orig", p, "name", f.getName(), "size", size, "dir", isDir,
                                "at", System.currentTimeMillis(), "t", isDir ? "folder" : FileIndex.TYPE_NAMES[FileIndex.typeOf(f.getName())]);
                        meta.put(m);
                    } else {
                        deleteTree(slot);
                    }
                } else {
                    done = deleteTree(f);
                }
                if (done) {
                    ok++; bytes += size; gone.add(p);
                    if (scan.size() < 3000) collectForScan(p, isDir, idx, scan);
                } else {
                    failed++;
                    errors.put(p);
                }
                if (job != null) job.progress(i == paths.size(), "done", i, "total", paths.size(), "path", p, "ok", done, "bytes", bytes);
            }
            if (useBin) save(meta);
        }
        if (idx != null) idx.remove(gone);
        mediaScan(ctx, scan);
        return Util.obj("ok", ok, "failed", failed, "bytes", bytes, "errors", errors, "binned", useBin);
    }

    static JSONObject list() {
        synchronized (LOCK) {
            JSONArray meta = load();
            long total = 0;
            JSONArray items = new JSONArray();
            for (int i = meta.length() - 1; i >= 0; i--) {
                JSONObject m = meta.optJSONObject(i);
                if (m == null) continue;
                File stored = new File(new File(dir(), m.optString("id")), m.optString("name"));
                if (!stored.exists()) continue;
                JSONObject o = Util.obj("id", m.optString("id"), "p", stored.getAbsolutePath(), "n", m.optString("name"),
                        "orig", m.optString("orig"), "s", m.optLong("size"), "m", m.optLong("at"), "t", m.optString("t"),
                        "expires", m.optLong("at") + KEEP_MS);
                items.put(o);
                total += m.optLong("size");
            }
            return Util.obj("items", items, "bytes", total);
        }
    }

    static JSONObject restore(Context ctx, Set<String> ids) {
        int ok = 0, failed = 0;
        List<String> scan = new ArrayList<>();
        synchronized (LOCK) {
            JSONArray meta = load(), keep = new JSONArray();
            for (int i = 0; i < meta.length(); i++) {
                JSONObject m = meta.optJSONObject(i);
                if (m == null) continue;
                if (!ids.contains(m.optString("id"))) { keep.put(m); continue; }
                File slot = new File(dir(), m.optString("id"));
                File stored = new File(slot, m.optString("name"));
                File dest = new File(m.optString("orig"));
                if (dest.exists()) dest = uniqueName(dest);
                File parent = dest.getParentFile();
                if (parent != null) parent.mkdirs();
                boolean done = stored.renameTo(dest) || (copyTree(stored, dest) && deleteTree(stored));
                if (done) {
                    ok++;
                    deleteTree(slot);
                    addToIndex(dest);
                    scan.add(dest.getAbsolutePath());
                } else { failed++; keep.put(m); }
            }
            save(keep);
        }
        mediaScan(ctx, scan);
        return Util.obj("ok", ok, "failed", failed);
    }

    /** Permanently removes the given ids (or everything when ids is null). */
    static JSONObject empty(Set<String> ids) {
        long bytes = 0; int n = 0;
        synchronized (LOCK) {
            JSONArray meta = load(), keep = new JSONArray();
            for (int i = 0; i < meta.length(); i++) {
                JSONObject m = meta.optJSONObject(i);
                if (m == null) continue;
                if (ids != null && !ids.contains(m.optString("id"))) { keep.put(m); continue; }
                if (deleteTree(new File(dir(), m.optString("id")))) { bytes += m.optLong("size"); n++; }
                else keep.put(m);
            }
            save(keep);
        }
        return Util.obj("ok", n, "bytes", bytes);
    }

    /** Drops items older than 30 days. */
    static void purgeExpired() {
        synchronized (LOCK) {
            if (!new File(FileIndex.binPath()).exists()) return;
            long cutoff = System.currentTimeMillis() - KEEP_MS;
            JSONArray meta = load(), keep = new JSONArray();
            for (int i = 0; i < meta.length(); i++) {
                JSONObject m = meta.optJSONObject(i);
                if (m == null) continue;
                if (m.optLong("at") < cutoff) deleteTree(new File(dir(), m.optString("id")));
                else keep.put(m);
            }
            save(keep);
        }
    }

    // ------------------------------------------------------------------
    private static void addToIndex(File f) {
        FileIndex idx = FileIndex.current;
        if (idx == null) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) addToIndex(k);
        } else idx.add(FileIndex.entryFor(f));
    }

    private static void collectForScan(String p, boolean isDir, FileIndex idx, List<String> out) {
        if (!isDir) { out.add(p); return; }
        if (idx == null) return;
        synchronized (idx) {
            for (FileIndex.Entry e : idx.files) if (Util.under(e.path, p)) { out.add(e.path); if (out.size() > 3000) return; }
        }
    }

    private static void mediaScan(Context ctx, List<String> paths) {
        if (paths.isEmpty()) return;
        // On Android 11+ the storage layer keeps the gallery in sync automatically; this is a safety net.
        try { MediaScannerConnection.scanFile(ctx, paths.toArray(new String[0]), null, null); } catch (Throwable ignored) {}
    }

    private static long sizeOf(File f, FileIndex idx) {
        if (!f.isDirectory()) return f.length();
        if (idx != null) {
            long[] t;
            synchronized (idx) { t = idx.dirs.get(f.getAbsolutePath()); }
            if (t != null) return t[0];
        }
        long s = 0;
        File[] k = f.listFiles();
        if (k != null) for (File c : k) s += sizeOf(c, null);
        return s;
    }

    private static long sizeOfCount(File f, FileIndex idx) {
        if (idx != null) {
            long[] t;
            synchronized (idx) { t = idx.dirs.get(f.getAbsolutePath()); }
            if (t != null) return t[1];
        }
        return -1;
    }

    private static boolean emptyTree(File d) {
        File[] k = d.listFiles();
        if (k == null) return false;
        for (File c : k) { if (!c.isDirectory() || !emptyTree(c)) return false; }
        return true;
    }

    static boolean deleteTree(File f) {
        if (f.isDirectory()) {
            File[] k = f.listFiles();
            if (k != null) for (File c : k) deleteTree(c);
        }
        return f.delete() || !f.exists();
    }

    private static boolean copyTree(File src, File dst) {
        try {
            if (src.isDirectory()) {
                if (!dst.mkdirs() && !dst.isDirectory()) return false;
                File[] k = src.listFiles();
                if (k != null) for (File c : k) if (!copyTree(c, new File(dst, c.getName()))) return false;
                return true;
            }
            try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dst)) {
                byte[] buf = new byte[262144];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            dst.setLastModified(src.lastModified());
            return dst.length() == src.length();
        } catch (Exception e) {
            return false;
        }
    }

    private static File uniqueName(File f) {
        String name = f.getName(), base = name, ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0 && !f.isDirectory()) { base = name.substring(0, dot); ext = name.substring(dot); }
        for (int i = 1; i < 1000; i++) {
            File c = new File(f.getParentFile(), base + " (" + i + ")" + ext);
            if (!c.exists()) return c;
        }
        return f;
    }

    private static byte[] readAll(File f) throws Exception {
        try (InputStream in = new FileInputStream(f)) {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        }
    }

    @SuppressWarnings("unused")
    private static boolean modernStorage() { return Build.VERSION.SDK_INT >= 30; }
}
