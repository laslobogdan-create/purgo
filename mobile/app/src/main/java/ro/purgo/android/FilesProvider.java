package ro.purgo.android;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/** Read-only provider so other apps can open or share a file Purgo shows. */
public class FilesProvider extends ContentProvider {
    static final String AUTHORITY = "ro.purgo.android.files";

    static Uri uriFor(String path) {
        return new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath("f").appendQueryParameter("p", path)
                .appendPath(new File(path).getName()).build();
    }

    private static File fileOf(Uri uri) throws FileNotFoundException {
        String p = uri.getQueryParameter("p");
        if (p == null) throw new FileNotFoundException();
        File f = new File(p);
        if (!f.isFile()) throw new FileNotFoundException(p);
        return f;
    }

    @Override public boolean onCreate() { return true; }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(fileOf(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        try {
            File f = fileOf(uri);
            String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
            MatrixCursor c = new MatrixCursor(cols, 1);
            Object[] row = new Object[cols.length];
            for (int i = 0; i < cols.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
                else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
            }
            c.addRow(row);
            return c;
        } catch (FileNotFoundException e) {
            return null;
        }
    }

    @Override public String getType(Uri uri) {
        String p = uri.getQueryParameter("p");
        return p == null ? null : Util.mime(p);
    }

    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }

    @SuppressWarnings("unused") private Context ctx() { return getContext(); }
}
