package ro.purgo.android;

import android.os.Environment;

import java.io.File;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** A snapshot of every file on shared storage, with folder totals. */
public final class FileIndex {

    public static final int OTHER = 0, IMAGE = 1, VIDEO = 2, AUDIO = 3, DOC = 4, APK = 5, ARCHIVE = 6;
    public static final String[] TYPE_NAMES = {"other", "image", "video", "audio", "doc", "apk", "archive"};

    public static final class Entry {
        public final String path;
        public final long size, mtime;
        public final int type;
        Entry(String path, long size, long mtime, int type) {
            this.path = path; this.size = size; this.mtime = mtime; this.type = type;
        }
        public String name() { return path.substring(path.lastIndexOf('/') + 1); }
        public String dir() { return path.substring(0, path.lastIndexOf('/')); }
    }

    public interface Progress { void onProgress(int files, long bytes, String dir); }

    public static volatile FileIndex current;

    public final String root;
    public final List<Entry> files = new ArrayList<>();
    /** folder path -> {bytes, fileCount} for the whole subtree */
    public final Map<String, long[]> dirs = new HashMap<>();
    /** folders whose whole subtree contains no files (top-most only) */
    public final List<String> emptyDirs = new ArrayList<>();
    public long totalBytes;
    public final long scannedAt = System.currentTimeMillis();

    private FileIndex(String root) { this.root = root; }

    public static String rootPath() {
        return Environment.getExternalStorageDirectory().getAbsolutePath();
    }

    public static String binPath() { return rootPath() + "/.PurgoBin"; }

    private static final Set<String> STANDARD_DIRS = new HashSet<>();
    static {
        Collections.addAll(STANDARD_DIRS, "dcim", "pictures", "music", "movies", "download", "documents", "alarms",
                "notifications", "ringtones", "podcasts", "audiobooks", "recordings", "android", "screenshots");
    }

    public static FileIndex build(Progress progress) {
        String root = rootPath();
        FileIndex idx = new FileIndex(root);
        String skipData = root + "/Android/data", skipObb = root + "/Android/obb", skipBin = binPath();

        // Iterative post-order walk so folder totals can be accumulated bottom-up.
        ArrayDeque<Object[]> stack = new ArrayDeque<>();
        stack.push(new Object[]{new File(root), null, Boolean.FALSE});
        long lastTick = 0, running = 0;
        while (!stack.isEmpty()) {
            Object[] frame = stack.peek();
            File dir = (File) frame[0];
            if (frame[2] == Boolean.FALSE) {
                frame[2] = Boolean.TRUE;
                File[] kids = dir.listFiles();
                long bytes = 0, count = 0;
                List<File> subdirs = new ArrayList<>();
                if (kids != null) {
                    for (File f : kids) {
                        String p = f.getAbsolutePath();
                        if (f.isDirectory()) {
                            if (p.equals(skipData) || p.equals(skipObb) || p.equals(skipBin)) continue;
                            if (isSymlink(f)) continue;
                            subdirs.add(f);
                        } else {
                            long s = f.length();
                            idx.files.add(new Entry(p, s, f.lastModified(), typeOf(f.getName())));
                            bytes += s; count++; running += s;
                        }
                    }
                }
                frame[1] = new long[]{bytes, count, kids == null ? -1 : kids.length};
                for (File s : subdirs) stack.push(new Object[]{s, null, Boolean.FALSE});
                long now = System.currentTimeMillis();
                if (progress != null && now - lastTick > 150) {
                    lastTick = now;
                    progress.onProgress(idx.files.size(), running, dir.getAbsolutePath());
                }
                continue;
            }
            // all children processed
            stack.pop();
            long[] own = (long[]) frame[1];
            String p = dir.getAbsolutePath();
            long[] tot = idx.dirs.get(p);
            if (tot == null) { tot = new long[]{0, 0}; idx.dirs.put(p, tot); }
            tot[0] += own[0]; tot[1] += own[1];
            String parent = dir.getParent();
            if (parent != null && !p.equals(root)) {
                long[] pt = idx.dirs.get(parent);
                if (pt == null) { pt = new long[]{0, 0}; idx.dirs.put(parent, pt); }
                pt[0] += tot[0]; pt[1] += tot[1];
            }
        }
        long[] r = idx.dirs.get(root);
        idx.totalBytes = r == null ? 0 : r[0];
        idx.findEmptyDirs();
        current = idx;
        return idx;
    }


    private void findEmptyDirs() {
        String androidDir = root + "/Android";
        for (Map.Entry<String, long[]> e : dirs.entrySet()) {
            String p = e.getKey();
            if (e.getValue()[1] != 0 || p.equals(root)) continue;
            if (p.equals(androidDir) || p.startsWith(androidDir + "/")) continue;
            String parent = p.substring(0, p.lastIndexOf('/'));
            String name = p.substring(p.lastIndexOf('/') + 1).toLowerCase(Locale.ROOT);
            if (parent.equals(root) && STANDARD_DIRS.contains(name)) continue;
            if (STANDARD_DIRS.contains(name) && parent.startsWith(root + "/DCIM")) continue;
            // only the top-most empty folder
            long[] pt = dirs.get(parent);
            boolean parentEmpty = pt != null && pt[1] == 0 && !parent.equals(root)
                    && !(parent.substring(0, parent.lastIndexOf('/')).equals(root)
                         && STANDARD_DIRS.contains(parent.substring(parent.lastIndexOf('/') + 1).toLowerCase(Locale.ROOT)))
                    && !(parent.equals(androidDir) || parent.startsWith(androidDir + "/"));
            if (!parentEmpty) emptyDirs.add(p);
        }
        Collections.sort(emptyDirs);
    }

    /** Removes deleted paths (files or folders) from the index and fixes folder totals. */
    public synchronized void remove(Set<String> paths) {
        if (paths.isEmpty()) return;
        List<Entry> keep = new ArrayList<>(files.size());
        for (Entry e : files) {
            boolean gone = false;
            for (String p : paths) {
                if (e.path.equals(p) || e.path.startsWith(p + "/")) { gone = true; break; }
            }
            if (gone) {
                totalBytes -= e.size;
                String d = e.dir();
                while (d != null && d.length() >= root.length()) {
                    long[] t = dirs.get(d);
                    if (t != null) { t[0] -= e.size; t[1]--; }
                    if (d.equals(root)) break;
                    d = d.substring(0, d.lastIndexOf('/'));
                }
            } else keep.add(e);
        }
        files.clear();
        files.addAll(keep);
        for (String p : paths) {
            dirs.keySet().removeIf(k -> k.equals(p) || k.startsWith(p + "/"));
            emptyDirs.removeIf(k -> k.equals(p) || k.startsWith(p + "/"));
        }
    }

    public synchronized void add(Entry e) {
        files.add(e);
        totalBytes += e.size;
        String d = e.dir();
        while (d.length() >= root.length()) {
            long[] t = dirs.get(d);
            if (t == null) { t = new long[]{0, 0}; dirs.put(d, t); }
            t[0] += e.size; t[1]++;
            if (d.equals(root)) break;
            d = d.substring(0, d.lastIndexOf('/'));
        }
    }

    public static Entry entryFor(File f) {
        return new Entry(f.getAbsolutePath(), f.length(), f.lastModified(), typeOf(f.getName()));
    }

    private static boolean isSymlink(File f) {
        try { return java.nio.file.Files.isSymbolicLink(f.toPath()); } catch (Throwable t) { return false; }
    }

    public static int typeOf(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0) return OTHER;
        switch (name.substring(dot + 1).toLowerCase(Locale.ROOT)) {
            case "jpg": case "jpeg": case "png": case "gif": case "webp": case "heic": case "heif": case "bmp": case "dng": case "avif":
                return IMAGE;
            case "mp4": case "mkv": case "mov": case "3gp": case "webm": case "avi": case "m4v": case "ts": case "wmv": case "flv":
                return VIDEO;
            case "mp3": case "m4a": case "aac": case "ogg": case "opus": case "wav": case "flac": case "amr": case "wma": case "mid":
                return AUDIO;
            case "pdf": case "doc": case "docx": case "xls": case "xlsx": case "ppt": case "pptx": case "txt": case "odt": case "ods":
            case "odp": case "rtf": case "csv": case "epub": case "md": case "html": case "htm":
                return DOC;
            case "apk": case "apks": case "xapk": case "apkm":
                return APK;
            case "zip": case "rar": case "7z": case "tar": case "gz": case "bz2": case "xz": case "obb":
                return ARCHIVE;
            default:
                return OTHER;
        }
    }
}
