package ro.purgo.android;

import android.webkit.MimeTypeMap;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

final class Util {
    private Util() {}

    static JSONObject fileJson(FileIndex.Entry e) {
        JSONObject o = new JSONObject();
        try {
            o.put("p", e.path);
            o.put("n", e.name());
            o.put("s", e.size);
            o.put("m", e.mtime);
            o.put("t", FileIndex.TYPE_NAMES[e.type]);
        } catch (JSONException ignored) {}
        return o;
    }

    static JSONObject dirJson(String path, long bytes, long count) {
        JSONObject o = new JSONObject();
        try {
            o.put("p", path);
            o.put("n", path.substring(path.lastIndexOf('/') + 1));
            o.put("s", bytes);
            o.put("c", count);
            o.put("m", new File(path).lastModified());
            o.put("t", "folder");
        } catch (JSONException ignored) {}
        return o;
    }

    static JSONObject put(JSONObject o, String k, Object v) {
        try { o.put(k, v); } catch (JSONException ignored) {}
        return o;
    }

    static JSONObject obj(Object... kv) {
        JSONObject o = new JSONObject();
        for (int i = 0; i + 1 < kv.length; i += 2) put(o, (String) kv[i], kv[i + 1]);
        return o;
    }

    static String mime(String path) {
        int dot = path.lastIndexOf('.');
        if (dot < 0) return "application/octet-stream";
        String ext = path.substring(dot + 1).toLowerCase(Locale.ROOT);
        String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        if (m == null) {
            switch (ext) {
                case "opus": return "audio/ogg";
                case "heic": return "image/heic";
                case "apk": return "application/vnd.android.package-archive";
                case "mkv": return "video/x-matroska";
                default: return "application/octet-stream";
            }
        }
        return m;
    }

    static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }

    /** Hash of size + first and last 64 KB — cheap pre-filter for duplicates. */
    static String quickHash(File f, long size) throws Exception {
        MessageDigest md = MessageDigest.getInstance("MD5");
        md.update(Long.toString(size).getBytes());
        byte[] buf = new byte[65536];
        try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "r")) {
            int n = raf.read(buf);
            if (n > 0) md.update(buf, 0, n);
            if (size > buf.length * 2L) {
                raf.seek(size - buf.length);
                n = raf.read(buf);
                if (n > 0) md.update(buf, 0, n);
            }
        }
        return hex(md.digest());
    }

    interface ByteProgress { boolean onBytes(long n); }

    static String fullHash(File f, ByteProgress p) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        byte[] buf = new byte[262144];
        try (InputStream in = new FileInputStream(f)) {
            int n;
            while ((n = in.read(buf)) > 0) {
                md.update(buf, 0, n);
                if (p != null && !p.onBytes(n)) throw new InterruptedException("cancelled");
            }
        }
        return hex(md.digest());
    }

    static JSONArray arr(Iterable<?> items) {
        JSONArray a = new JSONArray();
        for (Object o : items) a.put(o);
        return a;
    }

    static boolean under(String path, String dir) {
        return path.equals(dir) || path.startsWith(dir + "/");
    }
}
