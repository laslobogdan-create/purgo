package ro.purgo.android;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/** Media received and sent through WhatsApp, WhatsApp Business and Telegram. */
final class ChatMedia {
    private ChatMedia() {}

    private static final String[][] APPS = {
            // id, display name, media roots (relative to shared storage), prefix to strip from folder names
            {"whatsapp", "WhatsApp", "Android/media/com.whatsapp/WhatsApp/Media|WhatsApp/Media", "WhatsApp "},
            {"wabusiness", "WhatsApp Business", "Android/media/com.whatsapp.w4b/WhatsApp Business/Media|WhatsApp Business/Media", "WhatsApp Business "},
            {"telegram", "Telegram", "Android/media/org.telegram.messenger/Telegram|Telegram", "Telegram "},
    };

    static JSONObject overview(FileIndex idx) {
        JSONArray apps = new JSONArray();
        for (String[] a : APPS) {
            List<JSONObject> cats = new ArrayList<>();
            long total = 0, count = 0;
            for (String rel : a[2].split("\\|")) {
                File root = new File(idx.root + "/" + rel);
                File[] kids = root.listFiles();
                if (kids == null) continue;
                for (File k : kids) {
                    if (!k.isDirectory()) continue;
                    long[] t;
                    synchronized (idx) { t = idx.dirs.get(k.getAbsolutePath()); }
                    if (t == null || t[1] == 0) continue;
                    String title = k.getName();
                    if (title.startsWith(a[3])) title = title.substring(a[3].length());
                    if (title.startsWith(".")) title = title.substring(1);
                    cats.add(Util.obj("id", k.getAbsolutePath(), "title", title, "path", k.getAbsolutePath(),
                            "bytes", t[0], "count", t[1], "kind", kindOf(title)));
                    total += t[0]; count += t[1];
                }
            }
            if (cats.isEmpty()) continue;
            Collections.sort(cats, (x, y) -> Long.compare(y.optLong("bytes"), x.optLong("bytes")));
            apps.put(Util.obj("id", a[0], "name", a[1], "bytes", total, "count", count, "cats", Util.arr(cats)));
        }
        return Util.obj("apps", apps);
    }

    static JSONObject files(FileIndex idx, String dir) {
        List<FileIndex.Entry> l = new ArrayList<>();
        synchronized (idx) {
            for (FileIndex.Entry e : idx.files) {
                if (Util.under(e.path, dir) && !e.name().equals(".nomedia")) l.add(e);
            }
        }
        Collections.sort(l, (x, y) -> Long.compare(y.size, x.size));
        JSONArray out = new JSONArray();
        long now = System.currentTimeMillis();
        for (FileIndex.Entry e : l) {
            JSONObject o = Util.fileJson(e);
            String lp = e.path.toLowerCase(Locale.ROOT);
            Util.put(o, "sent", lp.contains("/sent/"));
            Util.put(o, "old", now - e.mtime > 180L * 86_400_000L);
            out.put(o);
        }
        return Util.obj("items", out);
    }

    private static String kindOf(String title) {
        String t = title.toLowerCase(Locale.ROOT);
        if (t.contains("image") || t.contains("photo") || t.contains("sticker") || t.contains("gif") || t.contains("status")) return "image";
        if (t.contains("video")) return "video";
        if (t.contains("voice") || t.contains("audio")) return "audio";
        if (t.contains("doc") || t.contains("file")) return "doc";
        return "other";
    }
}
