// Served at http://<server>/ca (via Caddy) when TLS_MODE=internal: how to trust this
// server's own certificate authority on each kind of device. Plain HTML, no app needed.
const PAGE = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>نصب گواهی امنیتی</title>
<style>
  body { font-family: Vazirmatn, Tahoma, sans-serif; margin: 0; background: #eef1f8; color: #121628; line-height: 1.9; }
  main { max-width: 680px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 22px; }
  .card { background: #fff; border-radius: 16px; padding: 16px 20px; margin: 14px 0; box-shadow: 0 2px 10px rgb(30 34 70 / .08); }
  .btn { display: inline-block; background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; text-decoration: none;
         padding: 12px 22px; border-radius: 12px; font-weight: 700; margin: 6px 0; }
  ol { padding-inline-start: 22px; margin: 6px 0; }
  .muted { color: #6b7390; font-size: 14px; }
  code { background: #eef1f8; padding: 1px 6px; border-radius: 6px; }
</style>
</head>
<body>
<main>
  <h1>🔐 نصب گواهی امنیتی سرور</h1>
  <p>این سرور گواهی امنیتی (SSL) خودش را صادر می‌کند تا بدون اینترنت بین‌الملل هم ارتباط رمزنگاری‌شده باشد.
  برای اینکه مرورگر به آن اعتماد کند، <b>یک بار</b> روی هر دستگاه این گواهی را نصب کنید.</p>
  <p><a class="btn" href="/ca.crt">⬇ دانلود گواهی</a></p>
  <p class="muted">فقط گواهی را از همین سرور و شبکه‌ای که به آن اعتماد دارید نصب کنید.</p>

  <div class="card"><h3>📱 اندروید</h3><ol>
    <li>فایل را دانلود کنید.</li>
    <li>تنظیمات ← امنیت ← رمزگذاری و اعتبارنامه‌ها ← <b>نصب گواهی</b> ← <b>گواهی CA</b> (در بعضی گوشی‌ها: تنظیمات ← امنیت ← نصب از حافظه).</li>
    <li>فایل <code>amorechat-ca.crt</code> را انتخاب کنید و تأیید کنید.</li>
    <li>مرورگر را کامل ببندید و دوباره باز کنید.</li>
  </ol></div>

  <div class="card"><h3>🍏 آیفون / آیپد</h3><ol>
    <li>این صفحه را در <b>Safari</b> باز کنید و فایل را دانلود کنید؛ پیام «Profile Downloaded» می‌آید.</li>
    <li>Settings ← General ← VPN & Device Management ← پروفایل دانلودشده ← <b>Install</b>.</li>
    <li>Settings ← General ← About ← <b>Certificate Trust Settings</b> ← گواهی را <b>روشن</b> کنید.</li>
  </ol></div>

  <div class="card"><h3>💻 ویندوز</h3><ol>
    <li>فایل را دانلود و روی آن دوبار کلیک کنید ← <b>Install Certificate</b>.</li>
    <li>Local Machine (یا Current User) ← <b>Place all certificates in the following store</b> ← <b>Trusted Root Certification Authorities</b>.</li>
    <li>مرورگر را دوباره باز کنید. (فایرفاکس: Settings ← Certificates ← View Certificates ← Authorities ← Import)</li>
  </ol></div>

  <div class="card"><h3>🍎 مک</h3><ol>
    <li>فایل را باز کنید تا در Keychain Access اضافه شود.</li>
    <li>روی گواهی دوبار کلیک ← Trust ← <b>Always Trust</b>.</li>
  </ol></div>

  <p>بعد از نصب، برنامه را از <b>https</b> باز کنید.</p>
</main>
</body>
</html>`;

export default async function caHelpRoutes(app) {
  app.get('/ca-help', { config: { public: true } }, async (_req, reply) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(PAGE));
}
