package ro.purgo.android;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Byte-identical duplicate files: size → quick hash → full SHA-1. */
final class Duplicates {
    private Duplicates() {}

    static JSONObject find(FileIndex idx, Job job) throws Exception {
        List<FileIndex.Entry> files;
        synchronized (idx) { files = new ArrayList<>(idx.files); }

        Map<Long, List<FileIndex.Entry>> bySize = new HashMap<>();
        for (FileIndex.Entry e : files) {
            if (e.size < 4096) continue;                               // tiny files aren't worth it
            if (e.path.contains("/.thumbnails/") || e.name().startsWith(".trashed-")) continue;
            List<FileIndex.Entry> l = bySize.get(e.size);
            if (l == null) { l = new ArrayList<>(); bySize.put(e.size, l); }
            l.add(e);
        }
        List<List<FileIndex.Entry>> cands = new ArrayList<>();
        long totalBytes = 0;
        for (List<FileIndex.Entry> l : bySize.values()) if (l.size() > 1) { cands.add(l); totalBytes += l.get(0).size * l.size(); }

        // Stage 1: quick hash
        List<List<FileIndex.Entry>> stage2 = new ArrayList<>();
        int done = 0, total = 0;
        for (List<FileIndex.Entry> l : cands) total += l.size();
        for (List<FileIndex.Entry> l : cands) {
            Map<String, List<FileIndex.Entry>> byQuick = new HashMap<>();
            for (FileIndex.Entry e : l) {
                if (job.cancelled) throw new InterruptedException();
                try {
                    String q = Util.quickHash(new File(e.path), e.size);
                    List<FileIndex.Entry> g = byQuick.get(q);
                    if (g == null) { g = new ArrayList<>(); byQuick.put(q, g); }
                    g.add(e);
                } catch (Exception ignored) {}
                done++;
                job.progress(false, "stage", "Comparing files", "done", done, "total", total, "pct", 0.4 * done / Math.max(1, total));
            }
            for (List<FileIndex.Entry> g : byQuick.values()) if (g.size() > 1) stage2.add(g);
        }

        // Stage 2: full hash (only for files whose quick hash matched)
        long need = 0;
        for (List<FileIndex.Entry> g : stage2) need += g.get(0).size * g.size();
        final long needF = Math.max(1, need);
        final long[] hashed = {0};
        List<List<FileIndex.Entry>> groups = new ArrayList<>();
        for (List<FileIndex.Entry> g : stage2) {
            Map<String, List<FileIndex.Entry>> byFull = new HashMap<>();
            for (FileIndex.Entry e : g) {
                if (job.cancelled) throw new InterruptedException();
                try {
                    String h = Util.fullHash(new File(e.path), n -> {
                        hashed[0] += n;
                        job.progress(false, "stage", "Verifying duplicates", "pct", 0.4 + 0.6 * hashed[0] / needF);
                        return !job.cancelled;
                    });
                    List<FileIndex.Entry> l = byFull.get(h);
                    if (l == null) { l = new ArrayList<>(); byFull.put(h, l); }
                    l.add(e);
                } catch (InterruptedException ie) { throw ie; } catch (Exception ignored) {}
            }
            for (List<FileIndex.Entry> l : byFull.values()) if (l.size() > 1) groups.add(l);
        }

        // Order groups by wasted space; choose which copy to keep
        Collections.sort(groups, (a, b) -> Long.compare(b.get(0).size * (b.size() - 1), a.get(0).size * (a.size() - 1)));
        JSONArray out = new JSONArray();
        long wasted = 0;
        for (List<FileIndex.Entry> g : groups) {
            FileIndex.Entry keep = pickOriginal(g);
            JSONArray items = new JSONArray();
            for (FileIndex.Entry e : g) {
                JSONObject o = Util.fileJson(e);
                Util.put(o, "keep", e == keep);
                Util.put(o, "rec", e != keep);
                items.put(o);
            }
            wasted += g.get(0).size * (g.size() - 1);
            out.put(Util.obj("size", g.get(0).size, "count", g.size(), "items", items, "t", FileIndex.TYPE_NAMES[g.get(0).type]));
        }
        return Util.obj("groups", out, "wasted", wasted);
    }

    /** Prefer the camera original, then anything outside chat/download folders, then the oldest. */
    private static FileIndex.Entry pickOriginal(List<FileIndex.Entry> g) {
        FileIndex.Entry best = null;
        int bestScore = Integer.MIN_VALUE;
        for (FileIndex.Entry e : g) {
            String p = e.path.toLowerCase(Locale.ROOT);
            int score = 0;
            if (p.contains("/dcim/camera/")) score += 100;
            else if (p.contains("/dcim/")) score += 60;
            if (p.contains("/pictures/") || p.contains("/documents/") || p.contains("/music/")) score += 40;
            if (p.contains("whatsapp") || p.contains("telegram") || p.contains("/download")) score -= 30;
            if (p.contains("/sent/")) score -= 10;
            if (e.name().matches(".*\\(\\d+\\)\\.[^.]+$") || e.name().toLowerCase(Locale.ROOT).contains("copy")) score -= 20;
            if (score > bestScore || (score == bestScore && best != null && e.mtime < best.mtime)) { best = e; bestScore = score; }
        }
        return best;
    }
}
