package chat.amore.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

/** App settings: which server, its trusted certificate (internal TLS mode), background connection. */
final class Prefs {
    private Prefs() {}

    private static SharedPreferences p(Context c) {
        return c.getSharedPreferences("amore", Context.MODE_PRIVATE);
    }

    static String server(Context c) {
        return p(c).getString("server", null);
    }

    static String serverHost(Context c) {
        String s = server(c);
        return s == null ? null : Uri.parse(s).getHost();
    }

    static void setServer(Context c, String url, String caPem) {
        p(c).edit().putString("server", url).putString("ca", caPem).apply();
    }

    static void clearServer(Context c) {
        p(c).edit().remove("server").remove("ca").apply();
    }

    /** PEM of the server's own CA when it uses Caddy's internal certificates, else null. */
    static String ca(Context c) {
        return p(c).getString("ca", null);
    }

    static boolean background(Context c) {
        return p(c).getBoolean("background", true);
    }

    static void setBackground(Context c, boolean on) {
        p(c).edit().putBoolean("background", on).apply();
    }

    /** Random per-install key: only the app's own notifications may open a chat or answer a call. */
    static String intentKey(Context c) {
        String k = p(c).getString("ik", null);
        if (k == null) {
            k = java.util.UUID.randomUUID().toString();
            p(c).edit().putString("ik", k).apply();
        }
        return k;
    }

    static boolean askedPermissions(Context c) {
        return p(c).getBoolean("asked", false);
    }

    static void setAskedPermissions(Context c) {
        p(c).edit().putBoolean("asked", true).apply();
    }
}
