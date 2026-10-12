package chat.amore.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;

/** Downloads the new APK from the server and hands it to Android's installer. */
final class Updater {
    private Updater() {}

    private static volatile boolean busy;
    private static final int NOTIF_ID = 4900;

    static void install(Activity a, String url) {
        if (busy) {
            Toast.makeText(a, "دانلود نسخه جدید در جریان است…", Toast.LENGTH_SHORT).show();
            return;
        }
        // Android 8+: the user allows "install unknown apps" for AmoreChat once.
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
            Toast.makeText(a, "اجازه «نصب برنامه‌های ناشناس» را برای AmoreChat بدهید و دوباره بزنید", Toast.LENGTH_LONG).show();
            a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
            return;
        }
        busy = true;
        Toast.makeText(a, "در حال دانلود نسخه جدید…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            File dir = new File(a.getCacheDir(), "updates");
            dir.mkdirs();
            File apk = new File(dir, "amorechat.apk");
            try {
                HttpURLConnection c = Net.open(a, url, "GET");
                c.setReadTimeout(60000);
                if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
                long total = c.getContentLengthLong();
                long got = 0;
                long lastPaint = 0;
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        got += n;
                        if (System.currentTimeMillis() - lastPaint > 400) {
                            lastPaint = System.currentTimeMillis();
                            Notifs.download(a, NOTIF_ID, "نسخه جدید AmoreChat", total > 0 ? (int) (got * 100 / total) : -1, false, null);
                        }
                    }
                }
                c.disconnect();
                androidx.core.app.NotificationManagerCompat.from(a).cancel(NOTIF_ID);
                Uri uri = FileProvider.getUriForFile(a, a.getPackageName() + ".files", apk);
                Intent i = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                a.runOnUiThread(() -> a.startActivity(i));
            } catch (Exception e) {
                Notifs.downloadFailed(a, NOTIF_ID, "نسخه جدید AmoreChat");
                a.runOnUiThread(() -> Toast.makeText(a, "دانلود نسخه جدید ناموفق بود", Toast.LENGTH_LONG).show());
            } finally {
                busy = false;
            }
        }, "amore-update").start();
    }
}
