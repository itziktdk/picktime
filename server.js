const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔒 Security & Performance
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: true,
  credentials: true
}));

// 📊 Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);

// 📦 Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 🎨 Theme configurations
const themes = {
  beauty: {
    name: 'מכון יופי',
    colors: {
      primary: '#FF6B9D',
      secondary: '#C44569',
      accent: '#F8B500',
      background: '#FFF5F8',
      surface: '#FFFFFF',
      text: '#2C2C54'
    },
    icon: 'sparkles'
  },
  hair: {
    name: 'מספרה',
    colors: {
      primary: '#6C5CE7',
      secondary: '#A29BFE',
      accent: '#FD79A8',
      background: '#F8F7FF',
      surface: '#FFFFFF',
      text: '#2D3436'
    },
    icon: 'scissors'
  },
  fitness: {
    name: 'כושר ואימונים',
    colors: {
      primary: '#00B894',
      secondary: '#00CEC9',
      accent: '#FDCB6E',
      background: '#F0FFF4',
      surface: '#FFFFFF',
      text: '#2D3436'
    },
    icon: 'fire'
  },
  tutoring: {
    name: 'שיעורים פרטיים',
    colors: {
      primary: '#0984E3',
      secondary: '#74B9FF',
      accent: '#E17055',
      background: '#F0F8FF',
      surface: '#FFFFFF',
      text: '#2D3436'
    },
    icon: 'academic-cap'
  },
  medical: {
    name: 'שירותי בריאות',
    colors: {
      primary: '#00B894',
      secondary: '#55A3FF',
      accent: '#FF7675',
      background: '#F8FFFA',
      surface: '#FFFFFF',
      text: '#2D3436'
    },
    icon: 'heart'
  },
  tech: {
    name: 'שירותים טכניים',
    colors: {
      primary: '#636E72',
      secondary: '#74B9FF',
      accent: '#FDCB6E',
      background: '#F8F9FA',
      surface: '#FFFFFF',
      text: '#2D3436'
    },
    icon: 'cog'
  }
};

// In-memory storage for demo (replace with MongoDB in production)
const businesses = new Map();
const appointments = new Map();
const customers = new Map();

// 🔄 API Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'PickTime API (Demo)',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mode: 'demo'
  });
});

// 🎨 Get available themes
app.get('/api/themes', (req, res) => {
  res.json(themes);
});

// 🏢 Business routes
app.post('/api/businesses', (req, res) => {
  try {
    const business = {
      _id: Date.now().toString(),
      ...req.body,
      slug: req.body.name
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/[\s_]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || `business-${Date.now()}`,
      createdAt: new Date().toISOString(),
      isActive: true
    };
    
    // Apply theme colors
    if (themes[business.theme]) {
      business.customization = {
        colors: themes[business.theme].colors
      };
    }
    
    businesses.set(business._id, business);
    res.status(201).json(business);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/businesses/:slug', (req, res) => {
  try {
    const business = Array.from(businesses.values())
      .find(b => b.slug === req.params.slug);
    
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }
    
    res.json(business);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📅 Appointment routes
app.post('/api/appointments', (req, res) => {
  try {
    const appointment = {
      _id: Date.now().toString(),
      ...req.body,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
    
    appointments.set(appointment._id, appointment);
    res.status(201).json(appointment);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 👥 Customer routes
app.post('/api/customers', (req, res) => {
  try {
    const customer = {
      _id: Date.now().toString(),
      ...req.body,
      createdAt: new Date().toISOString()
    };
    
    customers.set(customer._id, customer);
    res.status(201).json(customer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 📱 Main client app route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 🌟 Business booking page route
app.get('/:slug', async (req, res) => {
  try {
    const business = Array.from(businesses.values())
      .find(b => b.slug === req.params.slug);
    
    if (!business) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="he" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>העסק לא נמצא - PickTime</title>
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-50 min-h-screen flex items-center justify-center">
            <div class="text-center">
                <h1 class="text-3xl font-bold text-gray-900 mb-4">😅 העסק לא נמצא</h1>
                <p class="text-gray-600 mb-6">העסק "${req.params.slug}" לא קיים במערכת</p>
                <a href="/" class="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600">
                    🏠 חזרה לדף הבית
                </a>
            </div>
        </body>
        </html>
      `);
    }
    
    // Return booking page for this business
    res.send(`
      <!DOCTYPE html>
      <html lang="he" dir="rtl">
      <head>
          <meta charset="UTF-8">
          <title>${business.name} - הזמנת תור</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
              * { font-family: 'Assistant', sans-serif; }
              .business-theme {
                  --primary: ${business.customization?.colors?.primary || '#6366f1'};
                  --secondary: ${business.customization?.colors?.secondary || '#8b5cf6'};
              }
          </style>
      </head>
      <body class="bg-gray-50 business-theme" style="background-color: ${business.customization?.colors?.background || '#f9fafb'}">
          <div class="max-w-4xl mx-auto py-8 px-4">
              <div class="bg-white rounded-xl shadow-lg p-8">
                  <div class="text-center mb-8">
                      <h1 class="text-3xl font-bold mb-2" style="color: var(--primary)">${business.name}</h1>
                      <p class="text-gray-600">${business.description || 'ברוכים הבאים!'}</p>
                  </div>
                  
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div class="space-y-6">
                          <h2 class="text-xl font-semibold">📅 הזמן תור</h2>
                          <div class="bg-gray-50 p-6 rounded-lg">
                              <p class="text-center text-gray-600">
                                  🚧 מערכת ההזמנות בבנייה<br>
                                  בקרוב תוכלו להזמין תורים ישירות דרך האתר!
                              </p>
                          </div>
                          
                          <div>
                              <h3 class="font-semibold mb-2">📞 פרטי יצירת קשר</h3>
                              <p>טלפון: ${business.contact?.phone || 'לא צוין'}</p>
                              <p>אימייל: ${business.contact?.email || 'לא צוין'}</p>
                          </div>
                      </div>
                      
                      <div class="space-y-6">
                          <h2 class="text-xl font-semibold">🎨 עיצוב מותאם</h2>
                          <div class="flex space-x-2">
                              <div class="w-8 h-8 rounded" style="background-color: ${business.customization?.colors?.primary}"></div>
                              <div class="w-8 h-8 rounded" style="background-color: ${business.customization?.colors?.secondary}"></div>
                              <div class="w-8 h-8 rounded" style="background-color: ${business.customization?.colors?.accent}"></div>
                          </div>
                          
                          <div class="bg-gradient-to-r p-6 rounded-lg text-white" 
                               style="background: linear-gradient(135deg, ${business.customization?.colors?.primary}, ${business.customization?.colors?.secondary})">
                              <h3 class="font-bold mb-2">✨ ${themes[business.theme]?.name}</h3>
                              <p class="text-sm opacity-90">עיצוב מותאם במיוחד לתחום שלכם</p>
                          </div>
                      </div>
                  </div>
                  
                  <div class="mt-8 text-center">
                      <a href="/" class="text-blue-500 hover:text-blue-600">
                          ← חזרה לדף הבית של PickTime
                      </a>
                  </div>
              </div>
          </div>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// 🚀 Server startup
app.listen(PORT, () => {
  console.log(`🔥 PickTime Demo server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📱 Web app: http://localhost:${PORT}`);
  console.log(`📊 Demo mode: In-memory storage (no database needed)`);
});

module.exports = app;