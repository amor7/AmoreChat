package chat.amore.app;

import android.content.Context;
import android.webkit.CookieManager;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;

import javax.net.ssl.HttpsURLConnection;

/** HTTP to the AmoreChat server with the app's session cookie and certificate trust. */
final class Net {
    private Net() {}

    static HttpURLConnection open(Context c, String url, String method, X509Certificate extraCa) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        if (conn instanceof HttpsURLConnection) ((HttpsURLConnection) conn).setSSLSocketFactory(Trust.socketFactory(c, extraCa));
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null) conn.setRequestProperty("Cookie", cookie);
        conn.setRequestProperty("x-requested-with", "amorechat");
        conn.setRequestProperty("User-Agent", "AmoreChat-Android/" + BuildConfig.VERSION_NAME);
        conn.setRequestMethod(method);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        return conn;
    }

    static HttpURLConnection open(Context c, String url, String method) throws IOException {
        return open(c, url, method, null);
    }

    static byte[] readBytes(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    static String readAll(InputStream in) throws IOException {
        return new String(readBytes(in), StandardCharsets.UTF_8);
    }

    /** Fire-and-forget POST with an empty JSON body (e.g. declining a call from the notification). */
    static int post(Context c, String path) {
        String server = Prefs.server(c);
        if (server == null) return 0;
        try {
            HttpURLConnection conn = open(c, server + path, "POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("content-type", "application/json");
            conn.getOutputStream().write("{}".getBytes(StandardCharsets.UTF_8));
            int code = conn.getResponseCode();
            conn.disconnect();
            return code;
        } catch (IOException e) {
            return 0;
        }
    }
}
