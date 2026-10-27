package ro.purgo.android;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.media.ThumbnailUtils;
import android.os.Build;
import android.provider.MediaStore;
import android.util.LruCache;
import android.util.Size;

import java.io.ByteArrayOutputStream;
import java.io.File;

/** Small JPEG/PNG previews for the UI grids, cached in memory. */
final class Thumbs {
    private Thumbs() {}

    private static final LruCache<String, byte[]> CACHE = new LruCache<String, byte[]>(24 * 1024 * 1024) {
        @Override protected int sizeOf(String k, byte[] v) { return v.length; }
    };

    static byte[] get(Context ctx, String path, int size) {
        File f = new File(path);
        String key = path + "|" + size + "|" + f.lastModified();
        byte[] b = CACHE.get(key);
        if (b != null) return b;
        Bitmap bmp = null;
        boolean png = false;
        try {
            switch (FileIndex.typeOf(f.getName())) {
                case FileIndex.IMAGE:
                    bmp = Photos.smallBitmap(path, size);
                    break;
                case FileIndex.VIDEO:
                    if (Build.VERSION.SDK_INT >= 29) bmp = ThumbnailUtils.createVideoThumbnail(f, new Size(size, size), null);
                    else bmp = legacyVideo(path);
                    break;
                case FileIndex.AUDIO:
                    bmp = albumArt(path, size);
                    break;
                case FileIndex.APK: {
                    PackageManager pm = ctx.getPackageManager();
                    PackageInfo pi = pm.getPackageArchiveInfo(path, 0);
                    if (pi != null && pi.applicationInfo != null) {
                        pi.applicationInfo.sourceDir = path;
                        pi.applicationInfo.publicSourceDir = path;
                        b = Apps.png(pi.applicationInfo.loadIcon(pm), 96);
                        CACHE.put(key, b);
                        return b;
                    }
                    break;
                }
                default:
                    break;
            }
        } catch (Throwable ignored) {}
        if (bmp == null) return null;
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            bmp.compress(png ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG, 82, bos);
            b = bos.toByteArray();
            CACHE.put(key, b);
            return b;
        } finally {
            bmp.recycle();
        }
    }

    @SuppressWarnings("deprecation")
    private static Bitmap legacyVideo(String path) {
        return ThumbnailUtils.createVideoThumbnail(path, MediaStore.Video.Thumbnails.MINI_KIND);
    }

    private static Bitmap albumArt(String path, int size) {
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(path);
            byte[] art = r.getEmbeddedPicture();
            if (art == null) return null;
            android.graphics.BitmapFactory.Options o = new android.graphics.BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            android.graphics.BitmapFactory.decodeByteArray(art, 0, art.length, o);
            int s = 1;
            while (Math.max(o.outWidth, o.outHeight) / (s * 2) >= size) s *= 2;
            o = new android.graphics.BitmapFactory.Options();
            o.inSampleSize = s;
            return android.graphics.BitmapFactory.decodeByteArray(art, 0, art.length, o);
        } catch (Throwable t) {
            return null;
        } finally {
            try { r.release(); } catch (Throwable ignored) {}
        }
    }
}
