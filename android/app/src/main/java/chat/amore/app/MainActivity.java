package chat.amore.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import javax.net.ssl.SSLException;

/**
 * The app: a full-screen WebView showing the AmoreChat server's own web app, plus the
 * native pieces a browser can't do (background notifications, ringing calls, sharing into
 * the app, downloads, trusting an offline server's certificate).
 */
public class MainActivity extends Activity {
    static volatile boolean visible;

    private static final int REQ_FILE = 1;
    private static final int REQ_MEDIA = 2;
    private static final int REQ_NOTIF = 3;
    private static final int REQ_STORAGE = 4;
    private static final String SHARE_HOST = "amore-share.invalid";
    private static final String SETUP_URL = "file:///android_asset/setup.html";
    private static final String OFFLINE_URL = "file:///android_asset/offline.html";

    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private PermissionRequest pendingPerm;
    private boolean pageReady;
    private final List<String> pendingJs = new ArrayList<>();
    private final Map<String, Uri> shared = new ConcurrentHashMap<>();
    private volatile X509Certificate setupCa;
    private String[] pendingDownload;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Notifs.channels(this);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        // Tests (debug builds only) can point the app at a server directly.
        String testServer = getIntent().getStringExtra("server");
        if (BuildConfig.DEBUG && testServer != null) Prefs.setServer(this, testServer, null);

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setUserAgentString(s.getUserAgentString() + " AmoreChat-Android/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.addJavascriptInterface(new Bridge(), "AmoreAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        // Links that download (backups, files, the app update) go to our downloader:
        // a WebView ignores them otherwise.
        web.setDownloadListener((url, userAgent, contentDisposition, mime, length) -> {
            Uri u = Uri.parse(url);
            if (!isServer(u)) return;
            if (url.endsWith(".apk") || "application/vnd.android.package-archive".equals(mime)) {
                Updater.install(this, url);
                return;
            }
            String name = android.webkit.URLUtil.guessFileName(url, contentDisposition, mime);
            Downloader.start(this, url, name, mime);
            Toast.makeText(this, "دانلود شروع شد", Toast.LENGTH_SHORT).show();
        });

        String server = Prefs.server(this);
        if (server == null) {
            web.loadUrl(SETUP_URL);
        } else {
            web.loadUrl(server + "/");
            startup();
        }
        handleIntent(getIntent());
    }

    /** Once a server is chosen: notification permission and the background connection. */
    private void startup() {
        if (Build.VERSION.SDK_INT >= 33 && !Prefs.askedPermissions(this)
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            Prefs.setAskedPermissions(this);
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        }
        NotifyService.start(this);
    }

    private boolean isServer(Uri u) {
        String host = Prefs.serverHost(this);
        return host != null && u != null && host.equalsIgnoreCase(u.getHost());
    }

    // ---------- Native -> web events ----------

    private void toWeb(JSONObject event) {
        String js = "(window.__amoreQ=window.__amoreQ||[]).push(" + event + ");window.dispatchEvent(new Event('amore-native'));";
        runOnUiThread(() -> {
            if (pageReady) web.evaluateJavascript(js, null);
            else pendingJs.add(js);
        });
    }

    /** The WebView keeps running in the background (calls!), so tell the page when it's really hidden. */
    private void setHidden(boolean hidden) {
        if (!pageReady) return;
        web.evaluateJavascript(
                "(function(h){try{Object.defineProperty(document,'hidden',{configurable:true,get:function(){return h}});"
                        + "Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return h?'hidden':'visible'}});"
                        + "document.dispatchEvent(new Event('visibilitychange'))}catch(e){}})(" + hidden + ")",
                null);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        try {
            String action = intent.getAction();
            if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                handleShare(intent);
                setIntent(new Intent(this, MainActivity.class));
                return;
            }
            // Other apps can start this activity too: only trust extras from our own notifications.
            if (!Prefs.intentKey(this).equals(intent.getStringExtra("k"))) return;
            String chatId = intent.getStringExtra("chatId");
            if (chatId != null) toWeb(new JSONObject().put("type", "open-chat").put("chatId", Long.parseLong(chatId)));
            String answer = intent.getStringExtra("answerCall");
            if (answer != null) {
                Notifs.cancelCall(this);
                toWeb(new JSONObject().put("type", "answer").put("callId", answer));
            }
            if (intent.getStringExtra("ringingCall") != null) Notifs.cancelCall(this);
        } catch (Exception ignored) {
        }
    }

    private void handleShare(Intent intent) throws Exception {
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        JSONArray files = new JSONArray();
        for (Uri u : uris) {
            String id = Long.toHexString(System.nanoTime()) + files.length();
            shared.put(id, u);
            String name = "file";
            long size = -1;
            try (Cursor c = getContentResolver().query(u, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    int z = c.getColumnIndex(OpenableColumns.SIZE);
                    if (n >= 0) name = c.getString(n);
                    if (z >= 0) size = c.getLong(z);
                }
            } catch (Exception ignored) {
            }
            String type = getContentResolver().getType(u);
            files.put(new JSONObject().put("url", "https://" + SHARE_HOST + "/" + id).put("name", name).put("type", type == null ? "" : type).put("size", size));
        }
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (files.length() == 0 && text == null) return;
        toWeb(new JSONObject().put("type", "share").put("files", files).put("text", text == null ? "" : text));
    }

    // ---------- Lifecycle ----------

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        Notifs.cancelAllMessages(this);
        setHidden(false);
    }

    @Override
    protected void onPause() {
        visible = false;
        setHidden(true);
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("AmoreAndroid");
            web.destroy();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCb = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == REQ_MEDIA && pendingPerm != null) {
            List<String> grant = new ArrayList<>();
            for (String r : pendingPerm.getResources()) {
                String p = PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) ? Manifest.permission.RECORD_AUDIO
                        : PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) ? Manifest.permission.CAMERA : null;
                if (p != null && checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED) grant.add(r);
            }
            if (grant.isEmpty()) pendingPerm.deny();
            else pendingPerm.grant(grant.toArray(new String[0]));
            pendingPerm = null;
        }
        if (requestCode == REQ_STORAGE && pendingDownload != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) Downloader.start(this, pendingDownload[0], pendingDownload[1], pendingDownload[2]);
            pendingDownload = null;
        }
    }

    // ---------- WebView clients ----------

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String scheme = u.getScheme();
            if ("file".equals(scheme) || "blob".equals(scheme) || "data".equals(scheme) || isServer(u)) return false;
            // Links to other sites open in the browser, never inside the app.
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (ActivityNotFoundException ignored) {
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            pageReady = false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageReady = true;
            for (String js : pendingJs) view.evaluateJavascript(js, null);
            pendingJs.clear();
            if (!visible) setHidden(true);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
            if (req.isForMainFrame() && isServer(req.getUrl())) view.loadUrl(OFFLINE_URL);
        }

        /** Offline servers with their own CA: accept only certificates that chain to the stored CA. */
        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            Uri u = Uri.parse(error.getUrl());
            X509Certificate ca = Trust.storedCa(MainActivity.this);
            X509Certificate leaf = Trust.leafOf(error.getCertificate());
            if (!isServer(u) || ca == null || leaf == null) {
                handler.cancel();
                return;
            }
            String fp = Trust.sha256(leaf);
            if (Trust.verifiedLeaves.contains(fp)) {
                handler.proceed();
                return;
            }
            new Thread(() -> {
                boolean ok = false;
                try {
                    X509Certificate[] chain = Trust.fetchChain(u.getHost(), u.getPort() > 0 ? u.getPort() : 443);
                    ok = chain != null && chain.length > 0 && Trust.sha256(chain[0]).equals(fp) && Trust.chainTrusted(chain, ca);
                } catch (Exception ignored) {
                }
                final boolean trusted = ok;
                if (trusted) Trust.verifiedLeaves.add(fp);
                runOnUiThread(() -> {
                    if (trusted) handler.proceed();
                    else handler.cancel();
                });
            }).start();
        }

        /** Files shared into the app are served to the page from a private fake host. */
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!SHARE_HOST.equals(u.getHost())) return null;
            Uri file = shared.get(u.getLastPathSegment());
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            if (file == null) return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, null);
            try {
                InputStream in = getContentResolver().openInputStream(file);
                String type = getContentResolver().getType(file);
                return new WebResourceResponse(type == null ? "application/octet-stream" : type, null, 200, "OK", headers, in);
            } catch (Exception e) {
                return new WebResourceResponse("text/plain", "utf-8", 500, "Error", headers, null);
            }
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest req) {
            runOnUiThread(() -> {
                if (!isServer(req.getOrigin())) {
                    req.deny();
                    return;
                }
                List<String> missing = new ArrayList<>();
                for (String r : req.getResources()) {
                    String p = PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) ? Manifest.permission.RECORD_AUDIO
                            : PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) ? Manifest.permission.CAMERA : null;
                    if (p != null && checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
                }
                if (missing.isEmpty()) {
                    req.grant(req.getResources());
                } else {
                    if (pendingPerm != null) pendingPerm.deny();
                    pendingPerm = req;
                    requestPermissions(missing.toArray(new String[0]), REQ_MEDIA);
                }
            });
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            Intent i = params.createIntent();
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(Intent.createChooser(i, null), REQ_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCb = null;
                return false;
            }
        }
    }

    // ---------- JS bridge: window.AmoreAndroid ----------

    private class Bridge {
        @JavascriptInterface
        public String info() {
            try {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                return new JSONObject()
                        .put("version", BuildConfig.VERSION_NAME)
                        .put("versionCode", BuildConfig.VERSION_CODE)
                        .put("background", Prefs.background(MainActivity.this))
                        .put("batteryUnrestricted", pm.isIgnoringBatteryOptimizations(getPackageName()))
                        .put("notifications", NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled())
                        .put("server", Prefs.server(MainActivity.this))
                        .put("status", NotifyService.lastStatus)
                        .put("connected", NotifyService.connected)
                        .put("fullScreen", Build.VERSION.SDK_INT < 34 || ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).canUseFullScreenIntent())
                        .toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void setBackground(boolean on) {
            Prefs.setBackground(MainActivity.this, on);
            runOnUiThread(() -> {
                if (on) NotifyService.start(MainActivity.this);
                else NotifyService.stop(MainActivity.this);
            });
        }

        @JavascriptInterface
        public void batterySettings() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
                } catch (Exception e) {
                    startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                }
            });
        }

        @JavascriptInterface
        public void notificationSettings() {
            runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())));
        }

        /** Download the newer APK from the server and open Android's installer. */
        @JavascriptInterface
        public void installUpdate() {
            String server = Prefs.server(MainActivity.this);
            if (server != null) runOnUiThread(() -> Updater.install(MainActivity.this, server + "/app/amorechat.apk"));
        }

        @JavascriptInterface
        public void fullScreenSettings() {
            if (Build.VERSION.SDK_INT < 34) return;
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getPackageName())));
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void changeServer() {
            runOnUiThread(() -> {
                NotifyService.stop(MainActivity.this);
                Prefs.clearServer(MainActivity.this);
                Trust.verifiedLeaves.clear();
                web.clearHistory();
                web.loadUrl(SETUP_URL);
            });
        }

        @JavascriptInterface
        public void signedIn() {
            NotifyService.kick(MainActivity.this);
        }

        @JavascriptInterface
        public void reload() {
            runOnUiThread(() -> {
                String server = Prefs.server(MainActivity.this);
                web.loadUrl(server == null ? SETUP_URL : server + "/");
            });
        }

        @JavascriptInterface
        public void inCall(boolean on, String title) {
            runOnUiThread(() -> {
                if (on) CallService.start(MainActivity.this, title);
                else CallService.stop(MainActivity.this);
            });
        }

        @JavascriptInterface
        public void download(String url, String name, String mime) {
            String server = Prefs.server(MainActivity.this);
            if (server == null) return;
            String abs = url.startsWith("http") ? url : server + (url.startsWith("/") ? "" : "/") + url;
            if (!isServer(Uri.parse(abs))) return;
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    pendingDownload = new String[] {abs, name, mime};
                    requestPermissions(new String[] {Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
                    return;
                }
                Downloader.start(MainActivity.this, abs, name, mime);
                Toast.makeText(MainActivity.this, "دانلود شروع شد", Toast.LENGTH_SHORT).show();
            });
        }

        // ----- First-run setup page -----

        @JavascriptInterface
        public void checkServer(String input) {
            new Thread(() -> setupReply(check(input))).start();
        }

        @JavascriptInterface
        public void useServer(String url, boolean withCa) {
            runOnUiThread(() -> {
                String pem = null;
                try {
                    if (withCa && setupCa != null) pem = Trust.toPem(setupCa);
                } catch (Exception ignored) {
                }
                Prefs.setServer(MainActivity.this, url, pem);
                Trust.verifiedLeaves.clear();
                web.clearHistory();
                web.loadUrl(url + "/");
                startup();
            });
        }
    }

    private void setupReply(JSONObject r) {
        runOnUiThread(() -> web.evaluateJavascript("window.onNative && window.onNative(" + r + ")", null));
    }

    /** Is there an AmoreChat server at this address? Handles offline servers with their own CA. */
    private JSONObject check(String input) {
        JSONObject r = new JSONObject();
        try {
            String in = input.trim().replaceAll("/+$", "");
            boolean explicit = in.startsWith("http://") || in.startsWith("https://");
            Uri u = Uri.parse(explicit ? in : "https://" + in);
            if (u.getHost() == null || u.getHost().isEmpty()) return r.put("error", "آدرس نامعتبر است");
            String url = u.getScheme() + "://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
            try {
                String site = siteName(url, null);
                return r.put("ok", true).put("url", url).put("site", site).put("secure", url.startsWith("https"));
            } catch (SSLException e) {
                // Offline install (TLS_MODE=internal): get the server's CA over plain HTTP and let the
                // user compare its fingerprint with the one shown on the server's /ca page.
                X509Certificate ca = fetchCa(u.getHost());
                X509Certificate[] chain = Trust.fetchChain(u.getHost(), u.getPort() > 0 ? u.getPort() : 443);
                if (ca == null || !Trust.chainTrusted(chain, ca)) return r.put("error", "گواهی امنیتی این سرور معتبر نیست");
                String site = siteName(url, ca);
                setupCa = ca;
                return r.put("trust", true).put("url", url).put("site", site).put("fingerprint", Trust.sha256(ca));
            } catch (Exception e) {
                if (!explicit) {
                    String http = "http://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
                    try {
                        String site = siteName(http, null);
                        return r.put("ok", true).put("url", http).put("site", site).put("secure", false);
                    } catch (Exception ignored) {
                    }
                }
                return r.put("error", "سرور پیدا نشد یا در دسترس نیست");
            }
        } catch (Exception e) {
            try {
                return r.put("error", "خطا: " + e.getMessage());
            } catch (Exception ignored) {
                return r;
            }
        }
    }

    private String siteName(String url, X509Certificate ca) throws Exception {
        HttpURLConnection c = Net.open(this, url + "/api/config", "GET", ca);
        c.setConnectTimeout(8000);
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            JSONObject o = new JSONObject(Net.readAll(c.getInputStream()));
            if (!o.has("version")) throw new Exception("not AmoreChat");
            return o.optString("siteName", "AmoreChat");
        } finally {
            c.disconnect();
        }
    }

    private X509Certificate fetchCa(String host) {
        try {
            HttpURLConnection c = (HttpURLConnection) new java.net.URL("http://" + host + "/ca.crt").openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setInstanceFollowRedirects(false);
            try (InputStream in = c.getInputStream()) {
                return Trust.parse(Net.readBytes(in));
            } finally {
                c.disconnect();
            }
        } catch (Exception e) {
            return null;
        }
    }

}
