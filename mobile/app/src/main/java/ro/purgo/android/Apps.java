package ro.purgo.android;

import android.app.AppOpsManager;
import android.app.usage.StorageStats;
import android.app.usage.StorageStatsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Process;
import android.os.storage.StorageManager;
import android.util.LruCache;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Installed apps with sizes, cache and last-used time. */
final class Apps {
    private Apps() {}

    static boolean hasUsageAccess(Context ctx) {
        try {
            AppOpsManager ops = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
            int mode;
            if (Build.VERSION.SDK_INT >= 29) {
                mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.getPackageName());
            } else {
                mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.getPackageName());
            }
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Throwable t) {
            return false;
        }
    }

    static JSONObject list(Context ctx, Job job) {
        PackageManager pm = ctx.getPackageManager();
        boolean usage = hasUsageAccess(ctx);
        StorageStatsManager ssm = (StorageStatsManager) ctx.getSystemService(Context.STORAGE_STATS_SERVICE);
        Map<String, UsageStats> used = null;
        if (usage) {
            try {
                UsageStatsManager usm = (UsageStatsManager) ctx.getSystemService(Context.USAGE_STATS_SERVICE);
                long now = System.currentTimeMillis();
                used = usm.queryAndAggregateUsageStats(now - 2L * 365 * 86_400_000L, now);
            } catch (Throwable ignored) {}
        }

        List<ApplicationInfo> infos = pm.getInstalledApplications(0);
        List<JSONObject> out = new ArrayList<>();
        long totalApp = 0, totalData = 0, totalCache = 0;
        int i = 0;
        for (ApplicationInfo ai : infos) {
            i++;
            boolean system = (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
            boolean updatedSystem = (ai.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0;
            if (system && !updatedSystem) continue;
            if (ai.packageName.equals(ctx.getPackageName())) continue;
            if (job != null) job.progress(false, "stage", "Reading apps", "done", i, "total", infos.size(), "pct", (double) i / infos.size());
            JSONObject o = new JSONObject();
            Util.put(o, "pkg", ai.packageName);
            Util.put(o, "name", String.valueOf(pm.getApplicationLabel(ai)));
            Util.put(o, "system", system);
            try {
                PackageInfo pi = pm.getPackageInfo(ai.packageName, 0);
                Util.put(o, "version", pi.versionName == null ? "" : pi.versionName);
                Util.put(o, "installed", pi.firstInstallTime);
                Util.put(o, "updated", pi.lastUpdateTime);
            } catch (Throwable ignored) {}
            if (usage) {
                try {
                    StorageStats st = ssm.queryStatsForPackage(StorageManager.UUID_DEFAULT, ai.packageName, Process.myUserHandle());
                    Util.put(o, "app", st.getAppBytes());
                    Util.put(o, "data", Math.max(0, st.getDataBytes() - st.getCacheBytes()));
                    Util.put(o, "cache", st.getCacheBytes());
                    Util.put(o, "total", st.getAppBytes() + st.getDataBytes());
                    totalApp += st.getAppBytes(); totalData += st.getDataBytes(); totalCache += st.getCacheBytes();
                } catch (Throwable ignored) {}
                UsageStats us = used == null ? null : used.get(ai.packageName);
                if (us != null && us.getLastTimeUsed() > 0) Util.put(o, "lastUsed", us.getLastTimeUsed());
            }
            out.add(o);
        }
        Collections.sort(out, (a, b) -> Long.compare(b.optLong("total"), a.optLong("total")));
        JSONArray arr = Util.arr(out);
        return Util.obj("apps", arr, "usage", usage, "totalApp", totalApp, "totalData", totalData, "totalCache", totalCache);
    }

    static long totalCache(Context ctx) {
        if (!hasUsageAccess(ctx)) return -1;
        long sum = 0;
        try {
            StorageStatsManager ssm = (StorageStatsManager) ctx.getSystemService(Context.STORAGE_STATS_SERVICE);
            for (ApplicationInfo ai : ctx.getPackageManager().getInstalledApplications(0)) {
                try {
                    sum += ssm.queryStatsForPackage(StorageManager.UUID_DEFAULT, ai.packageName, Process.myUserHandle()).getCacheBytes();
                } catch (Throwable ignored) {}
            }
        } catch (Throwable ignored) {}
        return sum;
    }

    static boolean isInstalled(Context ctx, String pkg) {
        try { ctx.getPackageManager().getPackageInfo(pkg, 0); return true; }
        catch (PackageManager.NameNotFoundException e) { return false; }
    }

    private static final LruCache<String, byte[]> ICONS = new LruCache<String, byte[]>(6 * 1024 * 1024) {
        @Override protected int sizeOf(String k, byte[] v) { return v.length; }
    };

    static byte[] icon(Context ctx, String pkg) {
        byte[] b = ICONS.get(pkg);
        if (b != null) return b;
        try {
            Drawable d = ctx.getPackageManager().getApplicationIcon(pkg);
            b = png(d, 96);
            ICONS.put(pkg, b);
            return b;
        } catch (Throwable t) {
            return null;
        }
    }

    static byte[] png(Drawable d, int size) {
        Bitmap bmp;
        if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null) {
            bmp = Bitmap.createScaledBitmap(((BitmapDrawable) d).getBitmap(), size, size, true);
        } else {
            bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(bmp);
            d.setBounds(0, 0, size, size);
            d.draw(c);
        }
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.PNG, 100, bos);
        return bos.toByteArray();
    }
}
