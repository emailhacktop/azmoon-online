# راهنمای نصب گام‌به‌گام - آزمون آنلاین امن ۲.۰

> برای مبتدی تا پیشرفته - ۱۰ دقیقه

---

## مرحله ۰: پیش‌نیازها

- حساب Google (برای Sheets + Apps Script)
- یک هاست ساده برای فایل‌های استاتیک (اختیاری: می‌توان همه را حتی روی Google Drive/ GitHub Pages گذاشت)

---

## مرحله ۱: ساخت Google Sheet

1. به [sheets.google.com](https://sheets.google.com) برو → **Blank spreadsheet** بساز → نام بگذار `AzmoonDB`
2. فعلاً خالی بگذار؛ اسکریپت خودش شیت‌ها را می‌سازد.

---

## مرحله ۲: نصب بک‌اند (Code.gs)

1. در شیت، منو **Extensions → Apps Script** را باز کن.
2. هرچه در `Code.gs` قدیمی است پاک کن و محتوای فایل `gas/Code.gs` نسخه ۲.۰ را Paste کن.
3. فایل `appsscript.json`:
   - در Apps Script سمت چپ چرخ‌دنده **Project Settings** → تیک **Show "appsscript.json" manifest** را بزن.
   - برگرد به Editor → فایل `appsscript.json` را باز کن → محتوای `gas/appsscript.json` ما را جایگزین کن (TimeZone Asia/Tehran).

4. **یک‌بار اجرای اولیه:**
   - در Editor تابع `setup` را از کشویی بالا انتخاب کن → ▶️ **Run**
   - مجوزها را Allow کن (با حساب خودت).
   - اگر خطای Authorization آمد، دوباره Run کن.
   - برو به شیت `AzmoonDB`؛ باید ۴ شیت ببینی: `Users`, `StudyLog`, `ExamLog`, `Meta`
   - در `Users` ردیف `admin | <hash> | <salt> | yes | admin` باید باشد.

> **نکته مهاجرت:** اگر شیت قدیمی داشتی با رمزهای متن ساده، پس از نصب، تابع `migratePasswords` را یک‌بار Run کن تا همه هش شوند.

---

## مرحله ۳: انتشار Web App

1. در Apps Script دکمه **Deploy → New deployment** بزن.
2. نوع: **Web app**
3. تنظیمات:
   - Description: `Azmoon 2.0`
   - Execute as: **Me** (ایمیل خودت)
   - Who has access: **Anyone** (یا Anyone with link)
4. **Deploy** → **Copy URL** (چیزی شبیه `https://script.google.com/macros/s/AKfyc.../exec`)
5. این URL را **کپی نگه دار**.

### تست سلامت
در مرورگر URL را با `?action=health` باز کن:
```
https://script.google.com/macros/s/.../exec?action=health
```
باید ببینی:
```json
{"ok":true,"version":"2.0","time":"..."}
```

---

## مرحله ۴: تنظیم فرانت‌اند

1. پوشه `azmoon_online_v2` را دانلود/اکسترکت کن.
2. فایل‌های `index.html` و `admin.html` را با Notepad باز کن.
3. خط اول اسکریپت:
   ```js
   const WEB_APP_URL = "https://script.google.com/macros/s/.../exec";
   ```
   را با URL خودت جایگزین کن (هر دو فایل).
4. اگر می‌خواهی حالت امن **فعال** باشد، همین URL را بگذار؛ اگر خالی بگذاری `""` حالت آفلاین می‌شود.

---

## مرحله ۵: آپلود روی هاست

### گزینه A: هاست معمولی (cPanel, Netlify, Vercel)
- کل محتوای پوشه (نه خود پوشه) را آپلود کن:
  ```
  index.html
  admin.html
  assets/questions_db.json
  ```
- ساختار باید حفظ شود: `assets/questions_db.json` دقیقاً در همین مسیر باشد.

### گزینه B: GitHub Pages (رایگان)
```bash
git init
git add index.html admin.html assets/
git commit -m "azmoon 2.0"
git branch -M main
git remote add origin https://github.com/USERNAME/azmoon.git
git push -u origin main
# سپس در GitHub → Settings → Pages → Source: main / root
```

### گزینه C: بدون هاست (تست محلی)
- فقط `index.html` را دوبار کلیک کن؛ ولی به خاطر CORS مرورگر، `fetch` به `questions_db.json` ممکن است بلاک شود. برای تست محلی:
  ```bash
  # در پوشه پروژه
  python -m http.server 8000
  # سپس http://localhost:8000
  ```

---

## مرحله ۶: ورود به پنل مدیریت

1. مرورگر: `https://yourdomain.com/admin.html`
2. لاگین:
   - User: `admin`
   - Pass: `Admin123!`
3. اگر موفق بود، توکن ۲ ساعته می‌گیری.
4. **اولین کار:** تب **تنظیمات** → رمز را عوض کن.
5. تب **سوالات** → دکمه **بارگیری از سرور** → اگر خالی بود، **ذخیره در سرور** بزن تا ۴۰۰ سوال آپلود شود.
6. حالا `index.html` را باز کن؛ باید ۴ دسته را ببینی.

---

## مرحله ۷: افزودن دسته جدید (مثال علوم)

1. پنل → تب **دسته‌بندی‌ها**
2. پر کن:
   - شناسه: `science`
   - عنوان: `علوم تجربی`
   - آیکون: `🔬`
   - رنگ: `#0ea5e9`
   - گروه‌ها: `فیزیک, شیمی, زیست, ترکیبی`
3. **افزودن دسته**
4. تب **سوالات** → **افزودن سوال** → دسته `علوم تجربی` را انتخاب کن → گروه `فیزیک` → سوال بنویس → ذخیره
5. **ذخیره در سرور**
6. به `index.html` برگرد → دسته جدید ظاهر شد!

---

## مرحله ۸: مدیریت کاربران

- پنل → تب **کاربران**
- نام کاربری + رمز + نقش (`user` یا `admin`) → **ساخت کاربر**
- این کاربر می‌تواند برای **مرور سوالات** لاگین کند.

---

## مرحله ۹: مشاهده لاگ و خروجی

- پنل → تب **لاگ‌ها** → **لاگ آزمون** یا **لاگ مطالعه**
- دکمه **خروجی CSV** برای اکسل.

لاگ‌ها در شیت هم قابل دیدن هستند:
- `StudyLog`: timestamp, username, studyName, category, ip, userAgent
- `ExamLog`: timestamp, name, studentId, category, score, total, duration, attemptId, ip, ...

---

## عیب‌یابی

| مشکل | راه‌حل |
|---|---|
| `دسترسی غیرمجاز` در مرور سوالات | نام کاربری/رمز را چک کن؛ کاربر باید `active=yes` باشد |
| `توکن منقضی` | دوباره لاگین کن (۲ ساعت) |
| سوالات لود نمی‌شود | کنسول F12 → Network → ببین `questions_db.json` 404 است یا نه؛ مسیر `assets/` را چک کن |
| `script.google.com` خطای CORS | در Apps Script → Deploy → Who has access را **Anyone** بگذار، نه `Only myself` |
| نمره همیشه 0 | در حالت امن، باید از `index.html` با `WEB_APP_URL` پر آزمون بدهی، نه فایل محلی بدون سرور |
| رمز هش نشده | تابع `migratePasswords` را Run کن |

---

## نکات امنیتی نهایی

- URL وب‌اپ را عمومی نکن (در کد فرانت هست ولی اشکالی ندارد چون توکن لازم است).
- شیت را فقط با ادمین‌ها Share کن (حتی Viewer هش‌ها را می‌بیند).
- هر ۶ ماه رمز `admin` را عوض کن.
- بک‌آپ: پنل → **پشتیبان کامل JSON** را دانلود و جای امن نگه دار.

---

**تمام!** پروژه آماده است. سوالی بود فایل `docs/REPORT.md` را بخوان یا در پنل لاگ‌ها را چک کن.
