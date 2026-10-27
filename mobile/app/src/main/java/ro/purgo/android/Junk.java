package ro.purgo.android;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Finds files that are safe (or likely safe) to delete. */
final class Junk {
    private Junk() {}

    private static final Pattern PKG = Pattern.compile("^[a-z][a-z0-9_]*(\\.[a-z0-9_]+){1,}$");
    private static final long DAY = 86_400_000L;

    static JSONObject scan(Context ctx, FileIndex idx) {
        PackageManager pm = ctx.getPackageManager();
        Set<String> installed = new HashSet<>();
        try {
            for (android.content.pm.ApplicationInfo ai : pm.getInstalledApplications(0)) installed.add(ai.packageName);
        } catch (Throwable ignored) {}

        String root = idx.root;
        JSONArray apks = new JSONArray(), thumbs = new JSONArray(), temp = new JSONArray(), trashed = new JSONArray(),
                empty = new JSONArray(), residual = new JSONArray(), oldDl = new JSONArray();
        long now = System.currentTimeMillis();
        String download = root + "/Download";

        List<FileIndex.Entry> files;
        synchronized (idx) { files = new ArrayList<>(idx.files); }

        for (FileIndex.Entry e : files) {
            String name = e.name();
            String lower = name.toLowerCase(Locale.ROOT);
            String p = e.path;

            if (p.contains("/.thumbnails/")) {
                thumbs.put(item(e, true, "Gallery thumbnail cache — Android rebuilds it when needed"));
                continue;
            }
            if (lower.startsWith(".trashed-")) {
                trashed.put(item(e, true, "Already in the system trash — would be erased automatically later"));
                continue;
            }
            if (lower.endsWith(".tmp") || lower.endsWith(".temp") || lower.endsWith(".log") || lower.endsWith(".dmp")
                    || lower.equals("thumbs.db") || lower.equals(".ds_store")) {
                temp.put(item(e, true, lower.endsWith(".log") ? "Log file" : "Temporary file"));
                continue;
            }
            if (e.type == FileIndex.APK && lower.endsWith(".apk")) {
                JSONObject it = item(e, false, "Installer file");
                try {
                    PackageInfo arch = pm.getPackageArchiveInfo(p, 0);
                    if (arch == null) {
                        Util.put(it, "why", "Damaged or incomplete installer");
                    } else {
                        Util.put(it, "pkg", arch.packageName);
                        PackageInfo inst = null;
                        try { inst = pm.getPackageInfo(arch.packageName, 0); } catch (PackageManager.NameNotFoundException ignored) {}
                        long av = versionCode(arch), iv = inst == null ? -1 : versionCode(inst);
                        if (inst != null && iv >= av) {
                            Util.put(it, "why", "Already installed — this installer is no longer needed");
                            Util.put(it, "rec", true);
                        } else if (inst != null) {
                            Util.put(it, "why", "Newer than the installed version (" + arch.versionName + ")");
                        } else {
                            Util.put(it, "why", "App not installed (v" + arch.versionName + ")");
                        }
                    }
                } catch (Throwable ignored) {}
                apks.put(it);
                continue;
            }
            if (Util.under(p, download) && now - e.mtime > 90 * DAY) {
                oldDl.put(item(e, false, "Downloaded more than 3 months ago"));
            }
        }

        synchronized (idx) {
            for (String d : idx.emptyDirs) {
                JSONObject o = Util.dirJson(d, 0, 0);
                Util.put(o, "rec", true);
                Util.put(o, "why", "Empty folder");
                empty.put(o);
            }
            // Folders left by uninstalled apps
            String media = root + "/Android/media";
            File[] mediaKids = new File(media).listFiles();
            if (mediaKids != null) for (File f : mediaKids) {
                String n = f.getName();
                if (f.isDirectory() && PKG.matcher(n).matches() && !installed.contains(n)) {
                    long[] t = idx.dirs.get(f.getAbsolutePath());
                    JSONObject o = Util.dirJson(f.getAbsolutePath(), t == null ? 0 : t[0], t == null ? 0 : t[1]);
                    Util.put(o, "rec", true);
                    Util.put(o, "why", "Media folder of an app that is no longer installed");
                    residual.put(o);
                }
            }
            File[] rootKids = new File(root).listFiles();
            if (rootKids != null) for (File f : rootKids) {
                String n = f.getName();
                if (f.isDirectory() && PKG.matcher(n).matches() && !installed.contains(n)) {
                    long[] t = idx.dirs.get(f.getAbsolutePath());
                    JSONObject o = Util.dirJson(f.getAbsolutePath(), t == null ? 0 : t[0], t == null ? 0 : t[1]);
                    Util.put(o, "rec", false);
                    Util.put(o, "why", "Folder named after an app that is not installed — check before deleting");
                    residual.put(o);
                }
            }
        }

        JSONArray cats = new JSONArray();
        cats.put(cat("temp", "Temporary & log files", "Files apps leave behind while working", temp));
        cats.put(cat("thumbs", "Thumbnail cache", "Small preview images your gallery can rebuild", thumbs));
        cats.put(cat("apks", "Installer files (APK)", "Setup files of apps you already installed", apks));
        cats.put(cat("residual", "Leftovers of removed apps", "Folders that belonged to uninstalled apps", residual));
        cats.put(cat("empty", "Empty folders", "Folders with nothing inside", empty));
        cats.put(cat("trashed", "System trash", "Items you already deleted in the gallery", trashed));
        cats.put(cat("olddl", "Old downloads", "Downloads you haven't touched in months — review them", oldDl));
        return Util.obj("categories", cats);
    }

    private static long versionCode(PackageInfo p) {
        return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
    }

    private static JSONObject item(FileIndex.Entry e, boolean rec, String why) {
        JSONObject o = Util.fileJson(e);
        Util.put(o, "rec", rec);
        Util.put(o, "why", why);
        return o;
    }

    private static JSONObject cat(String id, String title, String desc, JSONArray items) {
        long bytes = 0;
        for (int i = 0; i < items.length(); i++) bytes += items.optJSONObject(i).optLong("s");
        return Util.obj("id", id, "title", title, "desc", desc, "items", items, "bytes", bytes);
    }
}
