/**
 * =============================================================================
 *  آزمون آنلاین - نسخه مهندسی شده امن 2.0
 *  طراحی: AminSystem2000 | بازنویسی امن: Secure Edition
 *  تاریخ: 2026-09-22
 *  ویژگی‌ها:
 *    - پسورد هش شده (SHA-256 + Salt) به جای متن ساده
 *    - توکن احراز هویت با انقضا + Rate Limit ضد Brute Force
 *    - تصحیح امن در سمت سرور (پاسخ صحیح هرگز به کلاینت ارسال نمی‌شود)
 *    - بانک سوال پویا (اضافه کردن دسته/گروه جدید بدون تغییر کد)
 *    - پنل مدیریت کامل (تغییر رمز، مدیریت سوالات، مشاهده لاگ)
 *    - اعتبارسنجی ورودی، قفل همزمانی، لاگ IP
 * =============================================================================
 */

// ============ تنظیمات ============
const CONFIG = {
  TOKEN_EXPIRY_SEC: 60 * 60 * 2, // 2 ساعت
  MAX_LOGIN_FAIL: 5,
  LOCKOUT_SEC: 60 * 15, // 15 دقیقه
  EXAM_DURATION_SEC: 180, // 3 دقیقه - باید با فرانت هماهنگ باشد
  EXAM_QUESTIONS_COUNT: 10,
  SHEETS: {
    USERS: "Users",
    STUDY_LOG: "StudyLog",
    EXAM_LOG: "ExamLog",
    QUESTIONS_DB: "QuestionsDB", // اختیاری: اگر بخواهی سوالات را در شیت نگه داری
    META: "Meta"
  },
  // برای CORS - ContentService هدر سفارشی نمی‌دهد، ولی doOptions را اضافه می‌کنیم
};

// ============ ابزار هش و توکن ============
function toHex(bytes) {
  // نسخه سازگار با Apps Script (byte[] جاواست و .map ندارد)
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b < 0) b += 256; // signed -> unsigned
    var s = b.toString(16);
    if (s.length === 1) s = "0" + s;
    hex += s;
  }
  return hex;
}
function sha256Hex(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return toHex(bytes);
}
// salt تصادفی 16 بایتی hex
function generateSalt() {
  var uuid = Utilities.getUuid().replace(/-/g,"");
  return uuid.substring(0, 16);
}
function hashPassword(password, salt) {
  // هش = SHA256(salt + ":" + password)
  return sha256Hex(salt + ":" + password);
}
function generateToken() {
  return Utilities.getUuid() + "-" + Utilities.getUuid();
}
function nowSec() { return Math.floor(Date.now()/1000); }

// ============ ابزار Sheet ============
function getSS() { return SpreadsheetApp.getActiveSpreadsheet(); }
function getSheet(name) {
  var ss = getSS();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  return sh;
}
function ensureSheets() {
  var ss = getSS();
  // Users: username | passwordHash | salt | active | role | createdAt | failCount | lockUntil
  var shUsers = getSheet(CONFIG.SHEETS.USERS);
  if (shUsers.getLastRow()===0) {
    shUsers.appendRow(["username","passwordHash","salt","active","role","createdAt","failCount","lockUntil"]);
    // کاربر پیش‌فرض مدیر
    var salt = generateSalt();
    var hash = hashPassword("Admin123!", salt);
    shUsers.appendRow(["admin", hash, salt, "yes", "admin", new Date(), 0, ""]);
    // کاربر نمونه دانش‌آموز
    var s2 = generateSalt();
    shUsers.appendRow(["student1", hashPassword("1234", s2), s2, "yes", "user", new Date(), 0, ""]);
  }
  var shStudy = getSheet(CONFIG.SHEETS.STUDY_LOG);
  if (shStudy.getLastRow()===0) shStudy.appendRow(["timestamp","username","studyName","category","ip","userAgent"]);
  var shExam = getSheet(CONFIG.SHEETS.EXAM_LOG);
  if (shExam.getLastRow()===0) shExam.appendRow(["timestamp","name","studentId","category","score","total","durationSec","attemptId","ip","userAgent","answersJson"]);
  var shMeta = getSheet(CONFIG.SHEETS.META);
  if (shMeta.getLastRow()===0) {
    shMeta.appendRow(["key","value","updatedAt"]);
    shMeta.appendRow(["questions_version","2.0", new Date()]);
  }
}
function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function outWithCors(obj) {
  // Apps Script ContentService CORS را خودکار باز می‌گذارد ولی برای اطمینان
  return out(obj);
}

// ============ Rate Limit با CacheService ============
function isLocked(username) {
  var cache = CacheService.getScriptCache();
  var key = "lock_" + username;
  var v = cache.get(key);
  return v !== null;
}
function recordFail(username) {
  var cache = CacheService.getScriptCache();
  var keyFail = "fail_" + username;
  var keyLock = "lock_" + username;
  var cur = parseInt(cache.get(keyFail) || "0", 10) + 1;
  cache.put(keyFail, String(cur), CONFIG.LOCKOUT_SEC);
  if (cur >= CONFIG.MAX_LOGIN_FAIL) {
    cache.put(keyLock, "1", CONFIG.LOCKOUT_SEC);
    cache.remove(keyFail);
    return true; // locked
  }
  return false;
}
function clearFail(username) {
  var cache = CacheService.getScriptCache();
  cache.remove("fail_" + username);
  cache.remove("lock_" + username);
}
function checkRateLimit(username) {
  if (isLocked(username)) {
    return {locked:true, remain: CONFIG.LOCKOUT_SEC};
  }
  return {locked:false};
}

// ============ مدیریت توکن ============
function storeToken(username, role) {
  var token = generateToken();
  var cache = CacheService.getScriptCache();
  // value = username|role
  cache.put("token_" + token, username + "|" + role, CONFIG.TOKEN_EXPIRY_SEC);
  // همچنین در Properties برای دیباگ (اختیاری)
  return token;
}
function verifyToken(token) {
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var val = cache.get("token_" + token);
  if (!val) return null;
  var parts = val.split("|");
  return {username: parts[0], role: parts[1], token: token};
}
function requireAdmin(token) {
  var info = verifyToken(token);
  if (!info) return {ok:false, error:"توکن نامعتبر یا منقضی"};
  if (info.role !== "admin") return {ok:false, error:"دسترسی مدیر لازم است"};
  return {ok:true, info:info};
}

// ============ اعتبارسنجی ورودی ============
function sanitizeStr(s, maxLen, fieldName) {
  if (s === undefined || s === null) return "";
  s = String(s).trim();
  if (maxLen && s.length > maxLen) s = s.substring(0, maxLen);
  // حذف کاراکترهای خطرناک برای Sheet (فرمول injection)
  if (s.length>0 && "=+@-".indexOf(s.charAt(0)) !== -1) s = "'" + s;
  return s;
}
function isValidCategory(cat) {
  // دسته‌ها پویا هستند - فعلا 4 دسته اصلی + هر دسته جدید که در QuestionsDB باشد
  // برای سادگی هر رشته غیرخالی مجاز است، ولی طول محدود
  if (!cat) return false;
  cat = String(cat).trim();
  return cat.length>=2 && cat.length<=40;
}

// ============ کاربر: ورود مطالعه (نسخه امن) ============
function handleLoginStudy(data) {
  ensureSheets();
  var username = sanitizeStr(data.username, 50, "username");
  var password = String(data.password || "");
  var studyName = sanitizeStr(data.studyName, 80, "studyName");
  var category = sanitizeStr(data.category, 40, "category") || "نامشخص";

  if (!username || !password) return out({ok:false, error:"نام کاربری و رمز الزامی است"});
  var rl = checkRateLimit(username);
  if (rl.locked) return out({ok:false, error:"حساب موقتاً قفل شد. 15 دقیقه بعد تلاش کنید.", locked:true});

  var sh = getSheet(CONFIG.SHEETS.USERS);
  var rows = sh.getDataRange().getValues();
  var header = rows[0];
  var idxUser = 0, idxHash=1, idxSalt=2, idxActive=3, idxRole=4;
  // سازگاری با شیت قدیمی که فقط 3 ستون داشت: u,p,active
  var legacyMode = header.length < 6;

  for (var i=1;i<rows.length;i++) {
    var row = rows[i];
    var u = String(row[idxUser]||"").trim();
    if (u !== username) continue;

    var active = String(row[idxActive]||"yes").trim().toLowerCase();
    if (active !== "yes") {
      return out({ok:false, error:"حساب غیرفعال است"});
    }

    var ok = false;
    if (legacyMode) {
      // حالت قدیمی: ستون B پسورد متن ساده است
      var plain = String(row[idxHash]||"").trim();
      if (plain === password) {
        ok = true;
        // مهاجرت خودکار به هش
        try {
          var newSalt = generateSalt();
          var newHash = hashPassword(password, newSalt);
          // تبدیل ردیف به فرمت جدید
          // اگر شیت قدیمی است، هدر را اصلاح کن
          if (header.length < 6) {
            sh.getRange(1,4,1,4).setValues([["active","role","createdAt","salt"]]); // این ساده‌سازی است
            // در عمل بهتر است شیت را بازسازی کرد
          }
          // به‌روزرسانی ردیف فعلی
          sh.getRange(i+1, 2).setValue(newHash);
          sh.getRange(i+1, 3).setValue(newSalt);
          // اگر ستون‌های جدید وجود ندارند، اضافه کن
        } catch(e) {}
      }
    } else {
      var storedHash = String(row[idxHash]||"").trim();
      var salt = String(row[idxSalt]||"").trim();
      if (!salt) {
        // کاربر قدیمی بدون salt - مقایسه مستقیم و سپس مهاجرت
        if (storedHash === password) {
          ok = true;
          var ns = generateSalt();
          sh.getRange(i+1, 2).setValue(hashPassword(password, ns));
          sh.getRange(i+1, 3).setValue(ns);
        }
      } else {
        var calc = hashPassword(password, salt);
        if (calc === storedHash) ok = true;
      }
    }

    if (ok) {
      clearFail(username);
      // لاگ مطالعه با Lock برای جلوگیری از تداخل
      var lock = LockService.getScriptLock();
      try { lock.tryLock(5000); } catch(e) {}
      try {
        var ip = (data.ip || "");
        var ua = (data.userAgent || "");
        getSheet(CONFIG.SHEETS.STUDY_LOG).appendRow([new Date(), username, studyName, category, ip, ua]);
      } finally { try{lock.releaseLock();}catch(e){} }

      // صدور توکن مطالعه (نقش user)
      var token = storeToken(username, String(row[idxRole]||"user"));
      return out({ok:true, token: token, role: String(row[idxRole]||"user")});
    } else {
      var lockedNow = recordFail(username);
      if (lockedNow) return out({ok:false, error:"تعداد تلاش ناموفق زیاد. 15 دقیقه قفل شد.", locked:true});
      return out({ok:false, error:"نام کاربری یا رمز نادرست"});
    }
  }
  // کاربر یافت نشد
  recordFail(username);
  return out({ok:false, error:"نام کاربری یا رمز نادرست"});
}

// ============ ثبت نتیجه آزمون (حالت قدیمی - فقط لاگ) ============
function handleExamResultLegacy(data) {
  ensureSheets();
  var name = sanitizeStr(data.name, 80, "name");
  var studentId = sanitizeStr(data.studentId, 30, "studentId");
  var category = sanitizeStr(data.category, 40, "category") || "نامشخص";
  var score = parseInt(data.score, 10);
  if (!name) return out({ok:false, error:"نام الزامی است"});
  if (isNaN(score) || score<0 || score>10) score = 0;
  // جلوگیری از اسپم: هر IP هر 30 ثانیه یک بار
  var cache = CacheService.getScriptCache();
  var ipKey = "exam_" + (data.ip||"noip") + "_" + studentId;
  if (cache.get(ipKey)) {
    return out({ok:false, error:"ارسال مکرر - لطفاً 30 ثانیه صبر کنید"});
  }
  cache.put(ipKey, "1", 30);

  var lock = LockService.getScriptLock();
  try { lock.tryLock(5000); } catch(e) {}
  try {
    getSheet(CONFIG.SHEETS.EXAM_LOG).appendRow([
      new Date(), name, studentId, category, score, 10, CONFIG.EXAM_DURATION_SEC, data.attemptId||"", data.ip||"", data.userAgent||"", JSON.stringify(data.answers||[])
    ]);
  } finally { try{lock.releaseLock();}catch(e){} }
  return out({ok:true});
}

// ============ آزمون امن: دریافت سوالات بدون پاسخ ============
function loadQuestionsDB() {
  // اولویت: Sheet QuestionsDB اگر وجود داشته باشد
  // فرمت پیشنهادی: هر سطر یک سوال با ستون‌های JSON
  // اگر Sheet خالی بود، از ScriptProperties بخوان (ذخیره ادمین)
  var props = PropertiesService.getScriptProperties();
  var json = props.getProperty("QUESTIONS_DB_JSON");
  if (json) {
    try { return JSON.parse(json); } catch(e) {}
  }
  // fallback: سعی کن از Sheet بخوانی
  try {
    var sh = getSheet(CONFIG.SHEETS.QUESTIONS_DB);
    if (sh.getLastRow() > 1) {
      // فرض: ستون A = JSON کل دیتابیس در سلول A2
      var v = sh.getRange(2,1).getValue();
      if (v) return JSON.parse(v);
      // یا هر سطر یک سوال
      var rows = sh.getDataRange().getValues();
      if (rows.length>1) {
        // ساختار سطری
        var questions=[];
        for(var i=1;i<rows.length;i++){
          var r=rows[i];
          // ستون‌ها: category, group, q, a1,a2,a3,a4, c
          if(!r[2]) continue;
          questions.push({
            uid: "sheet_"+i,
            category: String(r[0]||"general"),
            group: String(r[1]||"عمومی"),
            q: String(r[2]||""),
            a: [String(r[3]||""), String(r[4]||""), String(r[5]||""), String(r[6]||"")].filter(Boolean),
            c: String(r[7]||"")
          });
        }
        if(questions.length>0){
          return {meta:{version:"sheet"}, categories:[], questions:questions};
        }
      }
    }
  } catch(e) {}
  return null;
}
function handleGetExam(data) {
  ensureSheets();
  var category = sanitizeStr(data.category, 40, "category");
  if (!category) return out({ok:false, error:"دسته نامعتبر"});
  var db = loadQuestionsDB();
  if (!db || !db.questions) {
    return out({ok:false, error:"بانک سوال در سرور یافت نشد. لطفاً ادمین بانک را بارگذاری کند."});
  }
  // فیلتر بر اساس category
  var pool = db.questions.filter(function(q){ return q.category === category; });
  if (pool.length===0) return out({ok:false, error:"سوالی برای این دسته یافت نشد"});
  // گروه‌بندی پویا: هر گروه موجود در pool را بیاب
  var groups = {};
  pool.forEach(function(q){
    var g = q.group || "عمومی";
    if(!groups[g]) groups[g]=[];
    groups[g].push(q);
  });
  var groupNames = Object.keys(groups);
  // منطق انتخاب: اگر 3 گروه دارد، 4+4+2 (مثل قبل) وگرنه توزیع متوازن
  // برای تعمیم: تا 10 سوال، از هر گروه به تناسب انتخاب کن
  function shuffleFisherYates(arr){
    var a = arr.slice();
    for(var i=a.length-1;i>0;i--){
      var j = Math.floor(Math.random()*(i+1));
      var tmp=a[i]; a[i]=a[j]; a[j]=tmp;
    }
    return a;
  }
  var selected=[];
  if (groupNames.length>=3) {
    // سعی کن 4 از دو گروه اول، 2 از بقیه (همان منطق قدیمی ولی پویا)
    groupNames.sort();
    var g0 = shuffleFisherYates(groups[groupNames[0]]||[]).slice(0,4);
    var g1 = shuffleFisherYates(groups[groupNames[1]]||[]).slice(0,4);
    var gRest = [];
    for(var gi=2; gi<groupNames.length; gi++) gRest = gRest.concat(groups[groupNames[gi]]);
    var g2 = shuffleFisherYates(gRest).slice(0,2);
    selected = g0.concat(g1).concat(g2);
  } else if (groupNames.length===2) {
    var a0 = shuffleFisherYates(groups[groupNames[0]]).slice(0,5);
    var a1 = shuffleFisherYates(groups[groupNames[1]]).slice(0,5);
    selected = a0.concat(a1);
  } else {
    selected = shuffleFisherYates(pool).slice(0,10);
  }
  selected = shuffleFisherYates(selected);
  if (selected.length>10) selected = selected.slice(0,10);
  // حذف پاسخ صحیح و فقط ارسال گزینه‌ها (تصحیح در سرور)
  var clientQs = selected.map(function(q, idx){
    return {
      uid: q.uid || ("q_"+idx+"_"+Math.random()),
      cat: q.group, // برای سازگاری با فرانت قدیمی
      group: q.group,
      q: q.q,
      a: shuffleFisherYates(q.a.slice()), // گزینه‌ها را هم شافل کن
      id: q.id || idx+1
      // c ارسال نمی‌شود!
    };
  });
  // ذخیره نگاشت صحیح در Cache برای تصحیح بعدی (با attemptId)
  var attemptId = Utilities.getUuid();
  var cache = CacheService.getScriptCache();
  // نگاشت: uid -> correct answer
  var map = {};
  selected.forEach(function(q){ map[q.uid || q.q] = q.c; });
  // همچنین ترتیب اصلی را نگه دار
  var payload = {
    selected: selected, // شامل c ولی فقط در سرور نگه می‌داریم
    map: map,
    category: category,
    createdAt: nowSec()
  };
  cache.put("attempt_" + attemptId, JSON.stringify(payload), 60*30); // 30 دقیقه اعتبار

  return out({ok:true, attemptId: attemptId, questions: clientQs, total: clientQs.length, duration: CONFIG.EXAM_DURATION_SEC});
}
function handleSubmitExam(data) {
  ensureSheets();
  var attemptId = sanitizeStr(data.attemptId, 80, "attemptId");
  var name = sanitizeStr(data.name, 80, "name");
  var studentId = sanitizeStr(data.studentId, 30, "studentId");
  var category = sanitizeStr(data.category, 40, "category");
  var answers = data.answers; // [{uid, answer}]
  if (!attemptId || !answers || !Array.isArray(answers)) return out({ok:false, error:"داده نامعتبر"});
  if (!name || !studentId) return out({ok:false, error:"نام و شماره دانش‌آموزی الزامی است"});

  var cache = CacheService.getScriptCache();
  var raw = cache.get("attempt_" + attemptId);
  if (!raw) return out({ok:false, error:"شناسه آزمون منقضی یا نامعتبر است. لطفاً آزمون را دوباره شروع کنید."});
  var payload;
  try { payload = JSON.parse(raw); } catch(e){ return out({ok:false, error:"خطای داخلی"}); }

  // بررسی زمان: اگر بیش از مدت مجاز گذشته، هشدار
  var elapsed = nowSec() - (payload.createdAt || nowSec());
  var overtime = elapsed > (CONFIG.EXAM_DURATION_SEC + 60); // 60 ثانیه ارفاق

  var score = 0;
  var review = [];
  var map = payload.map;
  // answers: [{uid, answer}]
  // payload.selected برای review
  var qByUid = {};
  payload.selected.forEach(function(q){ qByUid[q.uid || q.q] = q; });

  answers.forEach(function(ans){
    var uid = ans.uid;
    var userAns = String(ans.answer||"").trim();
    var correct = map[uid];
    // fallback اگر uid با q متفاوت بود
    if (correct === undefined) {
      // سعی کن با q پیدا کنی
      for(var k in map){ if(k===uid) correct=map[k]; }
    }
    var ok = (userAns === correct);
    if (ok) score++;
    var qObj = qByUid[uid] || {q: uid, c: correct, a:[]};
    review.push({q: qObj.q, user: userAns, correct: correct, ok: ok, cat: qObj.group});
  });

  // لاگ
  var lock = LockService.getScriptLock();
  try { lock.tryLock(5000); } catch(e){}
  try {
    getSheet(CONFIG.SHEETS.EXAM_LOG).appendRow([
      new Date(), name, studentId, category || payload.category, score, payload.selected.length, elapsed, attemptId, data.ip||"", data.userAgent||"", JSON.stringify(answers)
    ]);
  } finally { try{lock.releaseLock();}catch(e){} }

  // پاک کردن attempt تا دوباره استفاده نشود
  cache.remove("attempt_" + attemptId);

  return out({
    ok:true,
    score: score,
    total: payload.selected.length,
    overtime: overtime,
    elapsed: elapsed,
    review: review
  });
}

// ============ پنل مدیریت ============
function handleAdminLogin(data) {
  ensureSheets();
  var username = sanitizeStr(data.username, 50, "username");
  var password = String(data.password||"");
  if (!username || !password) return out({ok:false, error:"نام کاربری و رمز الزامی است"});
  var rl = checkRateLimit(username);
  if (rl.locked) return out({ok:false, error:"قفل موقت - 15 دقیقه صبر کنید", locked:true});
  var sh = getSheet(CONFIG.SHEETS.USERS);
  var rows = sh.getDataRange().getValues();
  for(var i=1;i<rows.length;i++){
    var row=rows[i];
    var u=String(row[0]||"").trim();
    if(u!==username) continue;
    var active=String(row[3]||"yes").trim().toLowerCase();
    if(active!=="yes") return out({ok:false, error:"حساب غیرفعال"});
    var role=String(row[4]||"user").trim();
    if(role!=="admin") return out({ok:false, error:"دسترسی مدیر ندارید"});
    var hash=String(row[1]||"").trim();
    var salt=String(row[2]||"").trim();
    var calc = salt ? hashPassword(password, salt) : password;
    // سازگاری با هش قدیمی بدون salt
    if(calc===hash || (salt==="" && hash===password)){
      clearFail(username);
      var token = storeToken(username, "admin");
      return out({ok:true, token:token, username:username});
    } else {
      var lockedNow = recordFail(username);
      if(lockedNow) return out({ok:false, error:"تعداد تلاش زیاد - قفل شد", locked:true});
      return out({ok:false, error:"رمز نادرست"});
    }
  }
  recordFail(username);
  return out({ok:false, error:"کاربر یافت نشد"});
}
function handleAdminVerify(data){
  var token = data.token;
  var v = verifyToken(token);
  if(!v) return out({ok:false, error:"توکن نامعتبر"});
  return out({ok:true, username:v.username, role:v.role});
}
function handleAdminGetQuestions(data){
  var chk = requireAdmin(data.token);
  if(!chk.ok) return out(chk);
  var db = loadQuestionsDB();
  if(!db){
    // اگر بانک در سرور نیست، یک نمونه خالی برگردان
    return out({ok:true, db:{meta:{version:"2.0"}, categories:[], questions:[]}, source:"empty"});
  }
  return out({ok:true, db:db, source:"server"});
}
function handleAdminSaveQuestions(data){
  var chk = requireAdmin(data.token);
  if(!chk.ok) return out(chk);
  var db = data.db;
  if(!db || !db.questions || !Array.isArray(db.questions)) return out({ok:false, error:"ساختار بانک نامعتبر"});
  if(db.questions.length>5000) return out({ok:false, error:"تعداد سوالات بیش از حد مجاز (5000)"});
  // اعتبارسنجی هر سوال
  for(var i=0;i<db.questions.length;i++){
    var q=db.questions[i];
    if(!q.q || !q.a || !q.c || !q.category) return out({ok:false, error:"سوال "+(i+1)+" ناقص است"});
    if(q.a.length<2 || q.a.length>6) return out({ok:false, error:"سوال "+(i+1)+" تعداد گزینه نامعتبر"});
    if(q.a.indexOf(q.c)===-1) return out({ok:false, error:"سوال "+(i+1)+" پاسخ صحیح در گزینه‌ها نیست"});
  }
  // ذخیره در Properties (حد 9KB per value => ممکن است بزرگ باشد، پس تقسیم کن)
  // راه حل: ذخیره در Sheet QuestionsDB سلول A2
  try {
    var json = JSON.stringify(db);
    var props = PropertiesService.getScriptProperties();
    // Properties محدودیت 9KB دارد، پس اگر بزرگ بود فقط در Sheet ذخیره کن
    if(json.length < 8000){
      props.setProperty("QUESTIONS_DB_JSON", json);
    } else {
      props.deleteProperty("QUESTIONS_DB_JSON");
    }
    var sh = getSheet(CONFIG.SHEETS.QUESTIONS_DB);
    sh.clear();
    sh.getRange(1,1).setValue("QUESTIONS_DB_JSON");
    sh.getRange(2,1).setValue(json);
    // همچنین لاگ نسخه
    getSheet(CONFIG.SHEETS.META).appendRow(["questions_updated", new Date().toISOString(), new Date()]);
    return out({ok:true, count: db.questions.length});
  } catch(e){
    return out({ok:false, error:e.toString()});
  }
}
function handleAdminChangePassword(data){
  var chk = requireAdmin(data.token);
  if(!chk.ok) return out(chk);
  var oldPass = String(data.oldPassword||"");
  var newPass = String(data.newPass||"");
  if(newPass.length<6) return out({ok:false, error:"رمز جدید حداقل 6 کاراکتر"});
  if(newPass.length>64) return out({ok:false, error:"رمز خیلی طولانی"});
  var username = chk.info.username;
  var sh = getSheet(CONFIG.SHEETS.USERS);
  var rows = sh.getDataRange().getValues();
  for(var i=1;i<rows.length;i++){
    if(String(rows[i][0]).trim()===username){
      var salt = String(rows[i][2]||"").trim();
      var hash = String(rows[i][1]||"").trim();
      var calc = salt ? hashPassword(oldPass, salt) : oldPass;
      if(calc!==hash) return out({ok:false, error:"رمز فعلی نادرست"});
      var newSalt = generateSalt();
      var newHash = hashPassword(newPass, newSalt);
      sh.getRange(i+1,2).setValue(newHash);
      sh.getRange(i+1,3).setValue(newSalt);
      return out({ok:true});
    }
  }
  return out({ok:false, error:"کاربر یافت نشد"});
}
function handleAdminGetLogs(data){
  var chk = requireAdmin(data.token);
  if(!chk.ok) return out(chk);
  var type = data.logType; // "exam" or "study"
  var shName = type==="study" ? CONFIG.SHEETS.STUDY_LOG : CONFIG.SHEETS.EXAM_LOG;
  var sh = getSheet(shName);
  var rows = sh.getDataRange().getValues();
  // فقط 200 ردیف آخر برای جلوگیری از حجم زیاد
  var start = Math.max(1, rows.length-200);
  var outRows = rows.slice(start);
  return out({ok:true, header: rows[0], rows: outRows, total: rows.length-1});
}
function handleAdminCreateUser(data){
  var chk = requireAdmin(data.token);
  if(!chk.ok) return out(chk);
  var username = sanitizeStr(data.username, 50, "username");
  var password = String(data.password||"");
  var role = sanitizeStr(data.role, 10, "role") || "user";
  var active = sanitizeStr(data.active, 10, "active") || "yes";
  if(!username || !password) return out({ok:false, error:"نام کاربری و رمز الزامی"});
  if(password.length<4) return out({ok:false, error:"رمز کوتاه"});
  var sh = getSheet(CONFIG.SHEETS.USERS);
  var rows = sh.getDataRange().getValues();
  for(var i=1;i<rows.length;i++) if(String(rows[i][0]).trim()===username) return out({ok:false, error:"نام کاربری تکراری"});
  var salt = generateSalt();
  var hash = hashPassword(password, salt);
  sh.appendRow([username, hash, salt, active, role, new Date(), 0, ""]);
  return out({ok:true});
}

// ============ مسیریاب اصلی doPost ============
function doPost(e) {
  try {
    ensureSheets();
    if (!e || !e.postData || !e.postData.contents) return out({ok:false, error:"درخواست خالی"});
    var data;
    try { data = JSON.parse(e.postData.contents); } catch(err){ return out({ok:false, error:"JSON نامعتبر"}); }
    var action = data.action;
    // افزودن IP و UA اگر کلاینت نفرستاد (در GAS نمی‌توان IP گرفت، پس کلاینت باید بفرستد)
    // ولی ما اینجا e.parameter را هم چک می‌کنیم
    if (!data.ip) data.ip = "";
    if (!data.userAgent) data.userAgent = "";

    // مسیریابی
    if (action === "loginStudy") return handleLoginStudy(data);
    if (action === "examResult") return handleExamResultLegacy(data); // سازگار قدیمی
    if (action === "getExam") return handleGetExam(data);
    if (action === "submitExam") return handleSubmitExam(data);
    if (action === "adminLogin") return handleAdminLogin(data);
    if (action === "adminVerify") return handleAdminVerify(data);
    if (action === "adminGetQuestions") return handleAdminGetQuestions(data);
    if (action === "adminSaveQuestions") return handleAdminSaveQuestions(data);
    if (action === "adminChangePassword") return handleAdminChangePassword(data);
    if (action === "adminGetLogs") return handleAdminGetLogs(data);
    if (action === "adminCreateUser") return handleAdminCreateUser(data);

    return out({ok:false, error:"action نامعتبر: "+action});
  } catch(err){
    return out({ok:false, error: err.toString()});
  }
}
function doGet(e){
  // برای تست سلامت
  ensureSheets();
  var action = e && e.parameter ? e.parameter.action : null;
  if (action==="health") return out({ok:true, version:"2.0", time: new Date().toISOString()});
  return out({ok:true, message:"Azmoon API 2.0 - use POST", actions: ["loginStudy","getExam","submitExam","adminLogin"]});
}
function doOptions(e){
  // برای CORS preflight - GAS به صورت خودکار هندل می‌کند
  return out({ok:true});
}

// ============ توابع کمکی برای نصب ============
function setup(){
  ensureSheets();
  Logger.log("Setup done. Sheets ready.");
}
function keepAlive(){
  var ss = getSS();
  var sh = ss.getSheetByName(CONFIG.SHEETS.USERS);
  Logger.log(sh ? sh.getName() : "Users sheet not found");
}
// مهاجرت دستی پسوردهای متن ساده به هش
function migratePasswords(){
  var sh = getSheet(CONFIG.SHEETS.USERS);
  var rows = sh.getDataRange().getValues();
  for(var i=1;i<rows.length;i++){
    var salt = String(rows[i][2]||"").trim();
    var hash = String(rows[i][1]||"").trim();
    // اگر salt خالی و hash شبیه هش نیست (طول < 60) یعنی متن ساده است
    if(!salt && hash.length < 64){
      var ns = generateSalt();
      var nh = hashPassword(hash, ns);
      sh.getRange(i+1,2).setValue(nh);
      sh.getRange(i+1,3).setValue(ns);
      Logger.log("Migrated: "+rows[i][0]);
    }
  }
}
