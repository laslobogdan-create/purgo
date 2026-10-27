package ro.purgo.android;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.ThumbnailUtils;
import android.os.Build;
import android.util.Size;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Similar shots, blurry photos, very dark photos and screenshots. */
final class Photos {
    private Photos() {}

    static final class Info {
        long hash; float sharp; float bright;
    }

    private static final long WINDOW = 30 * 60_000L;   // similar shots must be taken within 30 minutes
    private static final int MAX_DIST = 9;             // max differing bits of the 64-bit dHash
    static final float BLUR_LIMIT = 9f;    // std-dev of the Laplacian at 128 px; sharp photos are usually 20+
    static final float DARK_LIMIT = 26f;

    static JSONObject analyse(Context ctx, FileIndex idx, Job job) throws Exception {
        List<FileIndex.Entry> photos = new ArrayList<>();
        synchronized (idx) {
            for (FileIndex.Entry e : idx.files) {
                if (e.type != FileIndex.IMAGE || e.size < 15_000) continue;
                String lp = e.path.toLowerCase(Locale.ROOT);
                if (lp.contains("/.thumbnails/") || lp.contains("stickers") || lp.contains("/android/data/")
                        || e.name().startsWith(".") || lp.endsWith(".gif")) continue;
                photos.add(e);
            }
        }
        Collections.sort(photos, (a, b) -> Long.compare(a.mtime, b.mtime));

        File cacheFile = new File(ctx.getFilesDir(), "photo-analysis.tsv");
        Map<String, Info> cache = loadCache(cacheFile);
        Map<String, Info> results = new ConcurrentHashMap<>();
        AtomicInteger done = new AtomicInteger();
        int total = photos.size();

        ExecutorService pool = Executors.newFixedThreadPool(Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors() - 1)));
        try {
            List<Future<?>> fs = new ArrayList<>();
            for (FileIndex.Entry e : photos) {
                fs.add(pool.submit(() -> {
                    if (job.cancelled) return;
                    String key = e.path + "|" + e.mtime + "|" + e.size;
                    Info info = cache.get(key);
                    if (info == null) info = analyseOne(e.path);
                    if (info != null) results.put(key, info);
                    int d = done.incrementAndGet();
                    job.progress(false, "stage", "Looking at your photos", "done", d, "total", total,
                            "pct", (double) d / Math.max(1, total), "current", e.path);
                }));
            }
            for (Future<?> f : fs) {
                if (job.cancelled) break;
                try { f.get(); } catch (Exception ignored) {}
            }
        } finally {
            pool.shutdownNow();
            pool.awaitTermination(2, TimeUnit.SECONDS);
        }
        if (job.cancelled) throw new InterruptedException();
        saveCache(cacheFile, results);

        // ---- group similar shots (union-find over a sliding time window) ----
        int n = photos.size();
        int[] parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        Info[] infos = new Info[n];
        for (int i = 0; i < n; i++) {
            FileIndex.Entry e = photos.get(i);
            infos[i] = results.get(e.path + "|" + e.mtime + "|" + e.size);
        }
        for (int i = 0; i < n; i++) {
            if (infos[i] == null) continue;
            for (int j = i + 1; j < n && photos.get(j).mtime - photos.get(i).mtime <= WINDOW; j++) {
                if (infos[j] == null) continue;
                if (Long.bitCount(infos[i].hash ^ infos[j].hash) <= MAX_DIST) union(parent, i, j);
            }
        }
        Map<Integer, List<Integer>> groups = new HashMap<>();
        for (int i = 0; i < n; i++) {
            if (infos[i] == null) continue;
            int r = find(parent, i);
            List<Integer> g = groups.get(r);
            if (g == null) { g = new ArrayList<>(); groups.put(r, g); }
            g.add(i);
        }
        List<List<Integer>> similar = new ArrayList<>();
        for (List<Integer> g : groups.values()) if (g.size() > 1) similar.add(g);
        Collections.sort(similar, (a, b) -> Long.compare(photos.get(b.get(0)).mtime, photos.get(a.get(0)).mtime));

        JSONArray simOut = new JSONArray();
        long simBytes = 0;
        for (List<Integer> g : similar) {
            int best = g.get(0);
            for (int i : g) if (infos[i].sharp > infos[best].sharp) best = i;
            JSONArray items = new JSONArray();
            for (int i : g) {
                JSONObject o = photoJson(photos.get(i), infos[i]);
                Util.put(o, "keep", i == best);
                Util.put(o, "rec", i != best);
                if (i != best) simBytes += photos.get(i).size;
                items.put(o);
            }
            simOut.put(Util.obj("items", items, "count", g.size()));
        }

        JSONArray blurry = new JSONArray(), dark = new JSONArray(), shots = new JSONArray();
        long blurBytes = 0, darkBytes = 0, shotBytes = 0;
        for (int i = n - 1; i >= 0; i--) {
            FileIndex.Entry e = photos.get(i);
            Info in = infos[i];
            if (e.path.toLowerCase(Locale.ROOT).contains("/screenshots/")) {
                JSONObject o = photoJson(e, in);
                Util.put(o, "rec", System.currentTimeMillis() - e.mtime > 30L * 86_400_000L);
                shots.put(o); shotBytes += e.size;
                continue;
            }
            if (in == null) continue;
            if (in.bright < DARK_LIMIT) { dark.put(photoJson(e, in)); darkBytes += e.size; }
            else if (in.sharp < BLUR_LIMIT) { blurry.put(photoJson(e, in)); blurBytes += e.size; }
        }
        return Util.obj(
                "similar", Util.obj("groups", simOut, "bytes", simBytes),
                "blurry", Util.obj("items", blurry, "bytes", blurBytes),
                "dark", Util.obj("items", dark, "bytes", darkBytes),
                "screenshots", Util.obj("items", shots, "bytes", shotBytes),
                "analysed", total);
    }

    private static JSONObject photoJson(FileIndex.Entry e, Info in) {
        JSONObject o = Util.fileJson(e);
        if (in != null) {
            Util.put(o, "sharp", Math.round(in.sharp));
            Util.put(o, "bright", Math.round(in.bright));
        }
        return o;
    }

    private static int find(int[] p, int i) { while (p[i] != i) { p[i] = p[p[i]]; i = p[i]; } return i; }
    private static void union(int[] p, int a, int b) { int ra = find(p, a), rb = find(p, b); if (ra != rb) p[rb] = ra; }

    static Info analyseOne(String path) {
        Bitmap bmp = null;
        try {
            bmp = smallBitmap(path, 160);
            if (bmp == null) return null;
            Info info = new Info();
            // dHash on 9x8 grayscale
            Bitmap h = Bitmap.createScaledBitmap(bmp, 9, 8, true);
            int[] px = new int[72];
            h.getPixels(px, 0, 9, 0, 0, 9, 8);
            if (h != bmp) h.recycle();
            long hash = 0;
            for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
                hash <<= 1;
                if (lum(px[y * 9 + x]) > lum(px[y * 9 + x + 1])) hash |= 1;
            }
            info.hash = hash;
            // sharpness (variance of the Laplacian) and mean brightness at ~128 px
            int w = bmp.getWidth(), ht = bmp.getHeight();
            float scale = 128f / Math.max(w, ht);
            int sw = Math.max(8, Math.round(w * scale)), sh = Math.max(8, Math.round(ht * scale));
            Bitmap s = Bitmap.createScaledBitmap(bmp, sw, sh, true);
            int[] p = new int[sw * sh];
            s.getPixels(p, 0, sw, 0, 0, sw, sh);
            if (s != bmp) s.recycle();
            float[] g = new float[p.length];
            double sum = 0;
            for (int i = 0; i < p.length; i++) { g[i] = lum(p[i]); sum += g[i]; }
            info.bright = (float) (sum / p.length);
            double ls = 0, ls2 = 0; int cnt = 0;
            for (int y = 1; y < sh - 1; y++) for (int x = 1; x < sw - 1; x++) {
                int i = y * sw + x;
                float l = g[i - 1] + g[i + 1] + g[i - sw] + g[i + sw] - 4 * g[i];
                ls += l; ls2 += l * l; cnt++;
            }
            double mean = ls / Math.max(1, cnt);
            info.sharp = (float) Math.sqrt(Math.max(0, ls2 / Math.max(1, cnt) - mean * mean));
            return info;
        } catch (Throwable t) {
            return null;
        } finally {
            if (bmp != null) bmp.recycle();
        }
    }

    static Bitmap smallBitmap(String path, int target) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                return ThumbnailUtils.createImageThumbnail(new File(path), new Size(target, target), null);
            }
        } catch (Throwable ignored) {}
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, o);
        if (o.outWidth <= 0) return null;
        int sample = 1;
        while (Math.max(o.outWidth, o.outHeight) / (sample * 2) >= target) sample *= 2;
        o = new BitmapFactory.Options();
        o.inSampleSize = sample;
        return BitmapFactory.decodeFile(path, o);
    }

    private static float lum(int c) {
        return 0.299f * ((c >> 16) & 255) + 0.587f * ((c >> 8) & 255) + 0.114f * (c & 255);
    }

    private static Map<String, Info> loadCache(File f) {
        Map<String, Info> m = new HashMap<>();
        if (!f.exists()) return m;
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) {
                String[] a = line.split("\t");
                if (a.length != 4) continue;
                Info i = new Info();
                i.hash = Long.parseUnsignedLong(a[1], 16);
                i.sharp = Float.parseFloat(a[2]);
                i.bright = Float.parseFloat(a[3]);
                m.put(a[0], i);
            }
        } catch (Exception ignored) {}
        return m;
    }

    private static void saveCache(File f, Map<String, Info> m) {
        try (PrintWriter w = new PrintWriter(new FileWriter(f))) {
            for (Map.Entry<String, Info> e : m.entrySet()) {
                if (e.getKey().indexOf('\t') >= 0 || e.getKey().indexOf('\n') >= 0) continue;
                w.print(e.getKey()); w.print('\t');
                w.print(Long.toHexString(e.getValue().hash)); w.print('\t');
                w.print(e.getValue().sharp); w.print('\t');
                w.println(e.getValue().bright);
            }
        } catch (Exception ignored) {}
    }
}
