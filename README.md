# 🔥 PickTime - פלטפורמת ניהול תורים מהפכנית

פלטפורמה חכמה לניהול תורים שמיועדת לבעלי מקצוע - מספרות, מכוני יופי, מורים פרטיים, פילאטיס ועוד.

## ✨ תכונות מרכזיות

### 📅 ניהול תורים חכם
- יומן אינטואיטיבי עם תמיכה במטפלים מרובים
- הגדרת שירותים לפי זמן ומטפל: "ג'ל - ירדן - 30 דק׳"
- רשימת המתנה לתורים תפוסים
- התראות אוטומטיות על תורים שהתפנו

### 🎨 עיצוב מותאם אישית
- 6 ערכות נושא מקצועיות
- התאמה מלאה לסוג העסק
- אייקונים מהמם מ-HeroIcons
- פאלטת צבעים ממוקדת

### 👥 ניהול לקוחות מתקדם
- פרופיל מלא לכל לקוח
- היסטוריית טיפולים
- מערכת נקודות נאמנות
- העדפות וזכרונות

### 📱 חוויית משתמש מושלמת
- ממשק מובייל מותאם
- QR קוד ולינק אישי לכל עסק
- הזמנות מהירות בקליק
- תמיכה בעברית מלאה

## 🚀 התקנה מהירה

### דרישות מקדימות
- Node.js 18+
- MongoDB
- חשבון Azure (להעלאה לענן)

### הקמה מקומית
```bash
# שכפול הפרויקט
git clone <repository-url>
cd picktime

# התקנת תלותיות
npm install

# הגדרת משתני סביבה
cp .env.example .env
# ערוך את .env עם הגדרות שלך

# הפעלת MongoDB (אם מקומי)
mongod

# הפעלת השרת
npm run dev
```

### פריסה ל-Azure
```bash
# התחברות ל-Azure
az login

# פריסה אוטומטית
./deploy-azure.sh
```

## 🏗️ מבנה הפרויקט

```
picktime/
├── server.js              # שרת Express ראשי
├── models/                 # מודלי MongoDB
│   ├── Business.js         # עסק
│   ├── Service.js          # שירותים
│   ├── Customer.js         # לקוחות
│   ├── Appointment.js      # תורים
│   └── Provider.js         # מטפלים
├── public/                 # קבצים סטטיים
│   ├── index.html          # דף הבית
│   └── js/app.js          # לוגיקת פרונט-אנד
├── package.json            # תלותיות וסקריפטים
├── deploy-azure.sh         # סקריפט פריסה
└── .env.example           # דוגמא למשתני סביבה
```

## 🎨 ערכות נושא

### 💄 מכון יופי (Beauty)
- צבע ראשי: ורוד (#FF6B9D)
- מיועד למכוני יופי, קוסמטיקאיות
- אייקון: ✨ sparkles

### ✂️ מספרה (Hair) 
- צבע ראשי: סגול (#6C5CE7)
- מיועד למספרות וסטיליסטים
- אייקון: ✂️ scissors

### 💪 כושר ואימונים (Fitness)
- צבע ראשי: ירוק (#00B894)
- מיועד למדרכי כושר ופילאטיס
- אייקון: 🔥 fire

### 🎓 שיעורים פרטיים (Tutoring)
- צבע ראשי: כחול (#0984E3)
- מיועד למורים ומדריכים
- אייקון: 🎓 academic-cap

### 🩺 שירותי בריאות (Medical)
- צבע ראשי: ירוק רפואי (#00B894)
- מיועד לטיפולים רפואיים
- אייקון: ❤️ heart

### ⚙️ שירותים טכניים (Tech)
- צבע ראשי: אפור (#636E72)
- מיועד למתקינים וטכנאים
- אייקון: ⚙️ cog

## 📊 API Endpoints

### עסקים
- `POST /api/businesses` - יצירת עסק חדש
- `GET /api/businesses/:slug` - קבלת פרטי עסק

### תורים
- `POST /api/appointments` - יצירת תור חדש
- `GET /api/appointments/:businessId` - קבלת תורים לעסק

### שירותים
- `GET /api/services/:businessId` - קבלת שירותי העסק

### לקוחות
- `POST /api/customers` - יצירת לקוח חדש

### מערכת
- `GET /api/health` - בדיקת תקינות
- `GET /api/themes` - קבלת ערכות נושא

## 🔧 הגדרות מתקדמות

### משתני סביבה חשובים
```env
# בסיס נתונים
MONGODB_URI=mongodb://localhost:27017/picktime

# הצפנה
JWT_SECRET=your-secret-key

# התראות
EMAIL_HOST=smtp.gmail.com
EMAIL_USER=your-email@gmail.com
WHATSAPP_TOKEN=your-business-token

# תשלומים (אופציונלי)
STRIPE_SECRET_KEY=sk_test_your-key
```

### תכונות ניתנות להפעלה
- `ENABLE_ANALYTICS` - אנליטיקס מתקדם
- `ENABLE_PAYMENTS` - מערכת תשלומים
- `ENABLE_SMS_NOTIFICATIONS` - התראות SMS
- `ENABLE_WHATSAPP_NOTIFICATIONS` - התראות WhatsApp

## 🎯 דוגמאות שימוש

### יצירת עסק חדש
```javascript
const businessData = {
  name: "סלון יופי של שרה",
  category: "beauty", 
  theme: "beauty",
  owner: {
    name: "שרה כהן",
    email: "sarah@example.com",
    phone: "050-1234567"
  }
};

const response = await fetch('/api/businesses', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(businessData)
});
```

### הזמנת תור
```javascript
const appointment = {
  business: "business-id",
  customer: "customer-id", 
  service: "service-id",
  provider: "provider-id",
  scheduling: {
    dateTime: "2024-03-30T10:00:00Z",
    duration: 60
  }
};
```

## 🛡️ אבטחה

- הצפנת סיסמאות עם bcrypt
- JWT tokens להזדהות
- Rate limiting למניעת התקפות
- CORS protection
- Helmet.js לאבטחת headers
- Validation קפדני של קלט

## 📱 תמיכה בנייד

- Responsive design מלא
- Touch-friendly interface
- הותאם לכל גדלי מסכים
- PWA ready (Progressive Web App)

## 🌟 תכונות עתידיות

- [ ] אפליקציית נייד נייטיבית
- [ ] מערכת ביקורות ודירוגים
- [ ] אינטגרציה עם Google Calendar
- [ ] בוט WhatsApp אוטומטי
- [ ] מערכת קופונים והנחות
- [ ] דוחות אנליטיקס מתקדמים

## 🤝 תרומה

מוזמנים לתרום לפרויקט! 

1. Fork את הפרויקט
2. צרו branch חדש (`git checkout -b feature/amazing-feature`)
3. Commit השינויים (`git commit -m 'Add amazing feature'`)
4. Push ל-branch (`git push origin feature/amazing-feature`)
5. פתחו Pull Request

## 📄 רישיון

MIT License - ראה קובץ LICENSE לפרטים

## 👨‍💻 מפתח

**Johnny Tzadaka** - מפתח מלא ואוהב חדשנות

---

## 🎉 בואו נתחיל!

PickTime מוכן לעבודה! צרו את העסק שלכם תוך 5 דקות והתחילו לקבל הזמנות.

**🔗 לינק לדמו**: [https://picktime.azurewebsites.net](https://picktime.azurewebsites.net)

**📞 תמיכה**: support@picktime.co.il