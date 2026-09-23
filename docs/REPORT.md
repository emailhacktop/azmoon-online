# گزارش بررسی مهندسی دقیق - آزمون آنلاین

**تاریخ بررسی:** ۳۱ شهریور ۱۴۰۵ (2026-09-22)  
**فایل‌های بررسی شده:** `code.gs` (نسخه اولیه ۵۱ خط) + `index.html` (۳۳۹ خط) + ۴ فایل بانک 100 سوالی  
**کل سوالات:** ۴۰۰ (هر دسته 100 = 40+40+20)

---

## 1) خلاصه اجرایی

پروژه در حالت فعلی **کار می‌کند ولی ناامن و غیرقابل توسعه** است. بزرگ‌ترین ریسک: **لو رفتن پاسخ‌ها در کلاینت** و **ذخیره رمز متن ساده**. با ۵ دقیقه کار در DevTools هر دانش‌آموز می‌تواند ۱۰۰٪ بگیرد یا لاگ را اسپم کند.

نسخه ۲.۰ این ایرادات را بدون شکستن سازگاری (Backward Compatible) برطرف کرده و معماری را ماژولار کرده است.

---

## 2) ایرادات امنیتی - بحرانی

### 2.1 ذخیره رمز متن ساده (CRITICAL)
**کد فعلی:**
```js
const [u, p, active] = rows[i];
if (String(u).trim()===username && String(p).trim()===password) // مقایسه مستقیم
  ss.getSheetByName("StudyLog").appendRow([...])
```
- شیت `Users` ستون B رمز را عیناً نگه می‌دارد. هر کس دسترسی View به شیت داشته باشد همه رمزها لو می‌رود.
- لاگ Apps Script و حتی `e.postData.contents` رمز را متن ساده منتقل می‌کند.
**پیامد:** اگر شیت به اشتباه Share شود یا کارمند سابق دسترسی داشته باشد، همه حساب‌ها قابل سوءاستفاده است.

**رفع ۲.۰:**
```js
salt = generateSalt(); // 16 hex
hash = sha256Hex(salt + ":" + password);
store: [username, hash, salt, active, role]
// ورود:
calc = sha256Hex(salt + ":" + inputPass);
if (calc === storedHash) ok
```
- مهاجرت خودکار: اگر شیت قدیمی ۳ ستونه بود، در اولین لاگین موفق هش می‌شود.
- `migratePasswords()` برای مهاجرت دسته‌جمعی.

### 2.2 لو رفتن پاسخ صحیح در کلاینت (CRITICAL)
**کد فعلی `index.html`:**
```js
qs[i].c // پاسخ صحیح در آرایه سوالات موجود است
answersLog.push({q:qs[i].q, user:x, correct:qs[i].c, ok:x===qs[i].c})
// فایل questions_*.js:
{ id:1, cat:"تاریخ", q:"...", a:[...], c:"شوش"}
```
- هر کاربر با F12 → Sources → `questions_math_iq.js` همه 400 پاسخ را می‌بیند.
- حتی بدون دیدن، می‌تواند در کنسول بنویسد: `qs[0].c` و تقلب کند.

**رفع ۲.۰ - حالت امن:**
- `handleGetExam` سوالات را فیلتر کرده **بدون فیلد `c`** می‌فرستد + گزینه‌ها شافل شده.
- نگاشت `uid -> correct` فقط در `CacheService` سرور با کلید `attempt_<uuid>` نگه‌داری می‌شود (۳۰ دقیقه).
- `handleSubmitExam` با `attemptId` نمره را حساب و `Cache` را پاک می‌کند. کلاینت هرگز `c` را نمی‌بیند.

### 2.3 ثبت نمره جعلی بدون احراز هویت (HIGH)
```js
if (data.action==="examResult"){
  ss.getSheetByName("ExamLog").appendRow([data.name, data.studentId, data.category, data.score, new Date()])
  return out({ok:true})
}
```
- هیچ چک توکن، IP، یا امضای درخواست نیست. با یک `curl` می‌توان هزار رکورد 10/10 جعلی ساخت:
  ```bash
  curl -X POST $WEB_APP_URL -d '{"action":"examResult","name":"هکر","score":10}'
  ```
- `score` اعتبارسنجی نمی‌شود (می‌تواند 100 یا -5 باشد).

**رفع ۲.۰:**
- حالت امن: `submitExam` فقط با `attemptId` معتبر و `answers[]` کار می‌کند؛ `score` را سرور حساب می‌کند، نه کلاینت.
- حالت سازگار قدیمی (`examResult`) هم محدود شد: `score` بین 0-10، Rate Limit هر IP هر 30 ثانیه یک‌بار، `attemptId` الزامی.

### 2.4 Brute Force روی لاگین مطالعه (MEDIUM)
- حلقه `for` روی همه ردیف‌ها بدون محدودیت تعداد تلاش. ابزار ساده می‌تواند دیکشنری ۱۰۰۰ پسورد را در یک دقیقه تست کند.

**رفع ۲.۰:**
- `CacheService` : کلید `fail_<username>` شمارنده، `lock_<username>` قفل ۱۵ دقیقه پس از ۵ خطا.
- پاسخ `locked:true` به فرانت تا پیام مناسب نشان دهد.

### 2.5 XSS از طریق `innerHTML` (MEDIUM)
```js
opts.innerHTML += '<button onclick="ans(\'' + x.replace(/'/g, "\\'") + '\')">' + x + '</button>';
review.innerHTML = t + "</table>";
q.innerText = qs[i].q; // این یکی امن است ولی opts نه
```
- اگر سوال حاوی `'><img src=x onerror=alert(1)>` باشد، اجرا می‌شود.
- `replace(/'/g, ...)` فقط `'` را هندل می‌کند، نه `"` یا `<`.

**رفع ۲.۰:**
```js
const btn=document.createElement("button");
btn.textContent = sanitizeText(optText); // textContent خودکار escape
btn.onclick = ()=> ans(optText, cur);
```
- همه خروجی‌ها `textContent` یا `escapeHtml()`.

### 2.6 تایمر قابل دستکاری (MEDIUM)
```js
let time=180;
timer=setInterval(()=>{ time--; if(time<0) finish() },1000)
// کاربر در کنسول: time=9999 یا clearInterval(timer)
```
**رفع ۲.۰:**
- ذخیره `startTimeMs = Date.now()` و هر ثانیه `remain = total - floor((now-start)/1000)`
- سرور هم `elapsed` را محاسبه و اگر `> duration+60` پرچم `overtime` می‌زند.

### 2.7 آسیب‌پذیری‌های دیگر
| مورد | توضیح | رفع |
|---|---|---|
| `user-select:none` فقط ظاهری | کپی با پرینت‌اسکرین، OCR، یا Inspect قابل دور زدن | هشدار داده شد که اتکا نکنید؛ لاگ سرور مهم است |
| CDN بدون SRI | `confetti` اگر هک شود کد مخرب تزریق می‌شود | `integrity` و `crossorigin` اضافه شد |
| Formula Injection | اگر نام `=CMD|...` باشد در شیت اجرا می‌شود | `sanitizeStr` اگر با `=+@-` شروع شد `'` اضافه می‌کند |
| عدم قفل همزمانی | دو `appendRow` همزمان ممکن است ردیف را خراب کند | `LockService.getScriptLock().tryLock(5000)` |
| No CORS preflight | برخی مرورگرها POST را بلاک می‌کنند | `doOptions()` اضافه شد |

---

## 3) ایرادات منطقی / برنامه‌نویسی

### 3.1 شافل بایاس‌دار
```js
function shuffle(a){ return a.sort(()=> Math.random()-0.5) }
```
این الگوریتم توزیع یکنواخت ندارد (مقاله 2015).  
**رفع:** Fisher-Yates استاندارد.

### 3.2 دابل‌کلیک = دو پاسخ
`ans()` بلافاصله `i++` می‌کند؛ اگر کاربر دوبار سریع کلیک کند، همان سوال دو بار ثبت می‌شود.  
**رفع:** پرچم `answered` + `disabled`.

### 3.3 بارگذاری سوالات شکننده
```js
const script=document.createElement('script');
script.src=`questions_${category}.js`;
script.onload=()=>{ qs=selectQuestions(); ... }
```
- اگر `category` دستکاری شود (`../../etc`) مسیر اشتباه می‌شود.
- اگر فایل لود نشود، `qs` خالی و `selectQuestions` خطا می‌دهد ولی `catch` فقط `alert` می‌کند.

**رفع:** `DB_URL` ثابت + `fetch` + `try/catch` + fallback.

### 3.4 تکرار سوالات در تاریخ/جغرافیا
`MIXED` ردیف 81-90 عیناً 95-100 تکرار شده با اندک اختلاف نگارشی (مثلاً «راه ابریشم چه نقشی...» دو بار).  
**رفع:** در `questions_db.json` یکپارچه دی-دیاپ شد ولی برای سازگاری نگه داشته شد؛ پنل امکان حذف تکراری را می‌دهد.

### 3.5 متن انگلیسی در بانک ادبیات
سوال 26 ادبیات: `q:"foundation of Persian poetry"` انگلیسی است.  
**رفع:** در بانک جدید علامت‌گذاری شد؛ پنل امکان ویرایش دارد.

### 3.6 رنگ‌های ناخوانا
```css
.cat-ریاضی{color:#00ff00} /* سبز جیغ روی سفید */
```
**رفع:** پالت جدید با کنتراست کافی (`#0d6efd`).

### 3.7 عدم اعتبارسنجی طول ورودی
`nameInput.value.trim()` بدون محدودیت؛ می‌تواند 10KB متن بفرستد و شیت را پر کند.  
**رفع:** `sanitizeStr(s, maxLen)` + محدودیت 80/30 کاراکتر.

---

## 4) معماری پیشنهادی ۲.۰

```
[مرورگر] --fetch--> [GAS Web App]
   |                    |
   +-- index.html       +-- Code.gs (Router: doPost)
   +-- admin.html       +-- CacheService (Token, Attempt)
   +-- questions_db.json+-- PropertiesService (DB JSON)
                        +-- Spreadsheet (Logs + Users)
```

- **دو حالت کار:** اگر `WEB_APP_URL` خالی باشد، برنامه ۱۰۰٪ آفلاین کار می‌کند (برای دمو). اگر پر باشد، حالت امن فعال می‌شود.
- **دسته پویا:** `DB.categories` آرایه‌ای است؛ افزودن دسته جدید فقط Push به آرایه است. فرانت `populateCategorySelect()` را از روی همین آرایه می‌سازد؛ هیچ `switch(category)` هاردکدی باقی نمانده (فقط fallback قدیمی).
- **سوال پویا:** هر سوال `uid` یکتا دارد. انتخاب ۱۰ سوال بر اساس گروه‌های موجود هر دسته انجام می‌شود، نه ۴ دسته ثابت.

---

## 5) چک‌لیست تست

- [x] لاگین با رمز اشتباه 5 بار → قفل 15 دقیقه
- [x] تغییر رمز و هش شدن در شیت
- [x] آزمون امن: `c` در Network tab دیده نمی‌شود
- [x] ارسال `attemptId` اشتباه → خطای «منقضی»
- [x] افزودن دسته `science` و 5 سوال → در `index.html` ظاهر می‌شود
- [x] تایمر: تغییر `Date` سیستم → سرور `overtime` را تشخیص می‌دهد
- [x] XSS: سوال با `<script>` → به صورت متن نشان داده می‌شود، اجرا نمی‌شود

---

## 6) توصیه‌های استقرار

1. شیت را فقط با ادمین‌های مطمئن Share کنید (Viewer هم رمز هش‌شده را می‌بیند).
2. در GAS → Project Settings → `Script Properties` کلید `QUESTIONS_DB_JSON` را بک‌آپ بگیرید.
3. هر ترم یک‌بار `migratePasswords()` را اجرا کنید اگر کاربر دستی به شیت اضافه کردید.
4. برای لاگ‌های حجیم، شیت `ExamLog` را سالانه آرشیو کنید (200 ردیف آخر در پنل نمایش داده می‌شود).

---

**نتیجه:** پروژه از «نمونه اولیه آسیب‌پذیر» به «محصول قابل استقرار» ارتقا یافت؛ بدون از دست دادن داده‌های قبلی.
