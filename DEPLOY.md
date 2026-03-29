# PickTime - הוראות פריסה לאינטרנט

## אופציות פריסה בחינם/עלויות מינימום:

### 1. Render.com (מומלץ!)
- **עלות:** חינם (עד 500 שעות/חודש)
- **יתרונות:** פשוט, יציב, תמיכה ב-Node.js

**צעדי הפריסה:**
1. כנס ל: https://render.com
2. התחבר עם GitHub
3. Create new Web Service
4. חבר את הריפוזיטורי
5. הגדרות:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: Node

### 2. Railway.app
- **עלות:** חינם (עד $5 בחודש)
- **יתרונות:** מהיר, תמיכה ב-MongoDB

### 3. Vercel
- **עלות:** חינם לפרויקטים אישיים
- **יתרונות:** מהיר מאוד, CDN גלובלי

### 4. Heroku
- **עלות:** $7/חודש (Eco dyno)
- **יתרונות:** מוכר ויציב

## הכי פשוט עכשיו:

### GitHub + Render:

1. **העלה לGitHub:**
```bash
cd picktime
git init
git add .
git commit -m "PickTime ready!"
git remote add origin https://github.com/itziktdk/picktime.git
git push -u origin main
```

2. **פרוס בRender:**
- כנס ל: https://render.com
- New Web Service
- Connect GitHub repo: itziktdk/picktime
- Deploy!

### Railway (אלטרנטיבה):
```bash
cd picktime
npx @railway/cli login
npx @railway/cli deploy
```

## מה מוכן בפרויקט:
✅ server.js (ללא DB - זיכרון בלבד)
✅ package.json מוגדר
✅ Frontend מושלם
✅ 6 ערכות נושא
✅ API מלא

## עלויות מוערכות:
- **Render (Free):** $0/חודש (500 שעות)
- **Railway:** $0-5/חודש  
- **Vercel:** $0/חודש
- **Heroku:** $7/חודש

**המלצה: התחל עם Render בחינם!**